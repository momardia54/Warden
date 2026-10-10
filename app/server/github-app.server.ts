import type { AppRepository } from "../lib/github-app"
import { base64url } from "./util.server"

/**
 * The install's GitHub App: its credentials (from the manifest flow), the short-lived tokens it signs, and the
 * repositories its installations can access. Stored in settings under the key github_app.
 */

const KEY = "github_app"
const API = "https://api.github.com"

export type GitHubApp = {
  app_id: number
  slug: string
  name: string
  client_id: string
  client_secret: string
  webhook_secret: string
  /** The app's private key (PEM), used to sign the app's tokens. */
  pem: string
  /** The account or organisation that owns the app. */
  owner: string
  html_url: string
  created_at: number
  /** Time of the last webhook delivery from GitHub. */
  last_delivery_at?: number
}

export type Failure = { error: string; status: number }

export async function getGitHubApp(env: Env): Promise<GitHubApp | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(KEY).first<{ value: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.value) as GitHubApp
  } catch {
    return null
  }
}

/** The app as the dashboard and the API show it: without its secrets. */
export const publicGitHubApp = (app: GitHubApp) => ({
  app_id: app.app_id,
  slug: app.slug,
  name: app.name,
  owner: app.owner,
  html_url: app.html_url,
  created_at: app.created_at,
  last_delivery_at: app.last_delivery_at ?? null,
})

const apiHeaders = (authorization?: string): HeadersInit => ({
  accept: "application/vnd.github+json",
  "user-agent": "Warden",
  "x-github-api-version": "2022-11-28",
  ...(authorization ? { authorization } : {}),
})

/**
 * Completes the manifest flow: exchanges the one-time code GitHub sent back for the new app's credentials, and stores
 * them. The code is valid for one hour and can be exchanged once.
 */
export async function completeManifest(env: Env, code: string, now = Date.now()): Promise<{ app: GitHubApp } | Failure> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(code)) return { error: "GitHub sent an invalid code. Start again.", status: 400 }
  const response = await fetch(`${API}/app-manifests/${code}/conversions`, { method: "POST", headers: apiHeaders() })
  if (!response.ok) return { error: `GitHub did not complete the app creation (${response.status}). The link may have expired; start again.`, status: 502 }
  const body = (await response.json()) as { id: number; slug: string; name: string; client_id: string; client_secret: string; webhook_secret: string; pem: string; html_url: string; owner?: { login?: string } }
  const app: GitHubApp = {
    app_id: body.id,
    slug: body.slug,
    name: body.name,
    client_id: body.client_id,
    client_secret: body.client_secret,
    webhook_secret: body.webhook_secret,
    pem: body.pem,
    owner: body.owner?.login ?? "",
    html_url: body.html_url,
    created_at: now,
  }
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(KEY, JSON.stringify(app), now)
    .run()
  tokens.clear()
  signingKeys.clear()
  return { app }
}

/** Forgets the app. Refused while release sources still use it. */
export async function removeGitHubApp(env: Env): Promise<{ ok: true } | Failure> {
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM release_sources WHERE installation_id IS NOT NULL").first<{ n: number }>()
  if ((used?.n ?? 0) > 0) {
    return { error: `${used!.n} repositor${used!.n === 1 ? "y is" : "ies are"} connected through the GitHub App. Disconnect ${used!.n === 1 ? "it" : "them"}, or switch ${used!.n === 1 ? "it" : "them"} to an access token, first.`, status: 409 }
  }
  await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(KEY).run()
  tokens.clear()
  signingKeys.clear()
  return { ok: true }
}

// ---- tokens ---------------------------------------------------------------------------------------

const signingKeys = new Map<number, Promise<CryptoKey>>()

/** DER length: short form below 128, otherwise the number of length bytes followed by the length. */
function derLength(length: number): number[] {
  if (length < 0x80) return [length]
  const bytes: number[] = []
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256)
  return [0x80 | bytes.length, ...bytes]
}

/**
 * Web Crypto imports private keys as PKCS#8, and GitHub issues PKCS#1 ("BEGIN RSA PRIVATE KEY"). A PKCS#1 key is
 * wrapped in the PKCS#8 structure: version 0, the rsaEncryption algorithm identifier, and the key as an octet string.
 */
export function privateKeyDer(pem: string): Uint8Array<ArrayBuffer> {
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY")
  const der = Uint8Array.from(atob(pem.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0))
  if (!pkcs1) return der
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const octets = [0x04, ...derLength(der.length)]
  const content = 3 + algorithm.length + octets.length + der.length
  const out = new Uint8Array([0x30, ...derLength(content), 0x02, 0x01, 0x00, ...algorithm, ...octets, ...der])
  return out
}

function signingKey(app: GitHubApp): Promise<CryptoKey> {
  let key = signingKeys.get(app.app_id)
  if (!key) {
    key = crypto.subtle.importKey("pkcs8", privateKeyDer(app.pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
    signingKeys.set(app.app_id, key)
  }
  return key
}

/** A JSON Web Token that authenticates as the app itself, valid for nine minutes (GitHub accepts at most ten). */
export async function appJwt(app: GitHubApp, now = Date.now()): Promise<string> {
  const seconds = Math.floor(now / 1000)
  // Issued a minute in the past to allow for clock drift between Cloudflare and GitHub.
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: String(app.app_id) }))}`
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(app), new TextEncoder().encode(unsigned))
  return `${unsigned}.${base64url(new Uint8Array(signature))}`
}

/** Installation tokens last an hour; each instance reuses one until ten minutes before it expires. */
const tokens = new Map<number, { token: string; expires: number }>()

export async function installationToken(app: GitHubApp, installationId: number, now = Date.now()): Promise<{ token: string } | Failure> {
  const cached = tokens.get(installationId)
  if (cached && cached.expires - now > 10 * 60_000) return { token: cached.token }
  const response = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: apiHeaders(`Bearer ${await appJwt(app, now)}`),
    body: JSON.stringify({ permissions: { contents: "read", metadata: "read" } }),
  })
  if (response.status === 404) return { error: "The GitHub App is no longer installed on the account that owns this repository. Install it again from Integrations.", status: 502 }
  if (!response.ok) return { error: `GitHub refused a token for the GitHub App (${response.status}).`, status: 502 }
  const body = (await response.json()) as { token: string; expires_at: string }
  tokens.set(installationId, { token: body.token, expires: Date.parse(body.expires_at) || now + 60 * 60_000 })
  return { token: body.token }
}

export type Installation = { id: number; account: string; account_type: string; repository_selection: "all" | "selected"; html_url: string }

export async function listInstallations(app: GitHubApp, now = Date.now()): Promise<Installation[] | Failure> {
  // A damaged key or an unreachable GitHub is reported to the page instead of failing it.
  let response: Response
  try {
    response = await fetch(`${API}/app/installations?per_page=100`, { headers: apiHeaders(`Bearer ${await appJwt(app, now)}`) })
  } catch (error) {
    return { error: `GitHub could not be reached with the app's credentials: ${error instanceof Error ? error.message : String(error)}`, status: 502 }
  }
  if (response.status === 401 || response.status === 404) {
    return { error: `GitHub rejected the app's credentials (${response.status}). If the app was deleted on GitHub, remove it from Warden and create it again.`, status: 502 }
  }
  if (!response.ok) return { error: `GitHub did not list the app's installations (${response.status}).`, status: 502 }
  const rows = (await response.json()) as { id: number; account?: { login?: string; type?: string }; repository_selection: "all" | "selected"; html_url: string }[]
  return rows.map((r) => ({ id: r.id, account: r.account?.login ?? "", account_type: r.account?.type ?? "", repository_selection: r.repository_selection, html_url: r.html_url }))
}

/** Every repository the app's installations can access, sorted by name. At most 1,000 per installation. */
export async function listAppRepositories(app: GitHubApp, now = Date.now()): Promise<AppRepository[] | Failure> {
  const installations = await listInstallations(app, now)
  if ("error" in installations) return installations
  const repositories: AppRepository[] = []
  for (const installation of installations) {
    const token = await installationToken(app, installation.id, now)
    if ("error" in token) continue
    for (let page = 1; page <= 10; page++) {
      const response = await fetch(`${API}/installation/repositories?per_page=100&page=${page}`, { headers: apiHeaders(`Bearer ${token.token}`) })
      if (!response.ok) break
      const body = (await response.json()) as { repositories: { id: number; full_name: string; private: boolean }[] }
      for (const r of body.repositories) repositories.push({ id: r.id, full_name: r.full_name, private: r.private, account: installation.account })
      if (body.repositories.length < 100) break
    }
  }
  return repositories.sort((a, b) => a.full_name.localeCompare(b.full_name))
}

/** The installation that can access a repository, and the repository's id and current name. */
export async function findAppRepository(app: GitHubApp, repository: string, now = Date.now()): Promise<{ installation_id: number; repository_id: number; full_name: string } | Failure> {
  const path = repository.split("/").map(encodeURIComponent).join("/")
  const response = await fetch(`${API}/repos/${path}/installation`, { headers: apiHeaders(`Bearer ${await appJwt(app, now)}`) })
  if (response.status === 404) {
    return { error: `The GitHub App cannot access ${repository}. Add the repository to the app's installation on GitHub (Integrations, Configure), or check the name.`, status: 422 }
  }
  if (!response.ok) return { error: `GitHub returned ${response.status} for the app's access to ${repository}.`, status: 502 }
  const installationId = ((await response.json()) as { id: number }).id
  const token = await installationToken(app, installationId, now)
  if ("error" in token) return token
  const repo = await fetch(`${API}/repos/${path}`, { headers: apiHeaders(`Bearer ${token.token}`) })
  if (!repo.ok) return { error: `GitHub returned ${repo.status} for ${repository}.`, status: 502 }
  const body = (await repo.json()) as { id: number; full_name: string }
  return { installation_id: installationId, repository_id: body.id, full_name: body.full_name }
}

/** Clears the per-instance caches. For tests. */
export function resetGitHubAppCache(): void {
  tokens.clear()
  signingKeys.clear()
}
