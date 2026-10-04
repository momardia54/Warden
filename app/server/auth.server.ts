import { redirect } from "react-router"
import { clientIp, hmacHex, safeEqual, serverSecret, sha256Hex } from "./util.server"
import { memo } from "./request-cache.server"

const COOKIE = "wd_session"
const MAX_AGE = 60 * 60 * 24 * 7

export function authConfigured(env: Env): boolean {
  return Boolean(env.ADMIN_USERNAME?.trim() && env.ADMIN_PASSWORD)
}

export async function checkCredentials(env: Env, username: string, password: string): Promise<boolean> {
  if (!authConfigured(env)) return false
  // Hash both sides so the comparison is constant-time and length-independent.
  const [u1, u2, p1, p2] = await Promise.all([
    sha256Hex(username),
    sha256Hex(env.ADMIN_USERNAME.trim()),
    sha256Hex(password),
    sha256Hex(env.ADMIN_PASSWORD),
  ])
  const userOk = safeEqual(u1, u2)
  const passOk = safeEqual(p1, p2)
  return userOk && passOk
}

/** Fingerprint of the current credentials. Stored with each session so a password change logs everyone out. */
async function credentialFingerprint(env: Env): Promise<string> {
  return hmacHex(serverSecret(env), `cred:${env.ADMIN_USERNAME.trim()}:${env.ADMIN_PASSWORD}`)
}

async function sessionId(token: string): Promise<string> {
  return sha256Hex(`session:${token}`)
}

function cookie(value: string, maxAge: number, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie")
  if (!header) return null
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=")
    if (k === name) return rest.join("=")
  }
  return null
}

/**
 * Creates a server-side session and returns the Set-Cookie value. The cookie is an opaque random
 * token: it carries no data, so it cannot be forged, inspected or used to guess the password.
 */
export async function createSession(env: Env, request: Request): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (id, cred, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(
      await sessionId(token),
      await credentialFingerprint(env),
      now,
      now + MAX_AGE * 1000
    ),
  ])
  return cookie(token, MAX_AGE, request)
}

/** Deletes the session on the server (so a copied cookie stops working) and returns an expiring cookie. */
export async function destroySession(env: Env, request: Request): Promise<string> {
  const token = readCookie(request, COOKIE)
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sessionId(token)).run()
  }
  return cookie("", 0, request)
}

export type Session = { username: string }

export function getSession(request: Request, env: Env): Promise<Session | null> {
  // Every loader of a page authenticates; do the database lookup once per request.
  return memo(env, "session", () => loadSession(request, env))
}

async function loadSession(request: Request, env: Env): Promise<Session | null> {
  if (!authConfigured(env)) return null
  const token = readCookie(request, COOKIE)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const row = await env.DB.prepare("SELECT cred, expires_at FROM sessions WHERE id = ?")
    .bind(await sessionId(token))
    .first<{ cred: string; expires_at: number }>()
  if (!row || row.expires_at < Date.now()) return null
  if (!safeEqual(row.cred, await credentialFingerprint(env))) return null
  return { username: env.ADMIN_USERNAME.trim() }
}

/** Blocks cross-site form posts against dashboard actions (defence in depth on top of SameSite=Lax). */
function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return
  const origin = request.headers.get("origin")
  if (!origin) return
  let host = ""
  try {
    host = new URL(origin).host
  } catch {}
  if (host !== new URL(request.url).host) throw new Response("Cross-origin request blocked", { status: 403 })
}

export async function requireAuth(request: Request, env: Env): Promise<Session> {
  assertSameOrigin(request)
  const session = await getSession(request, env)
  if (!session) throw redirect("/login")
  return session
}

/** Non-blocking hints shown in the dashboard. */
export function securityWarnings(env: Env): string[] {
  const warnings: string[] = []
  if ((env.ADMIN_PASSWORD ?? "").length < 12) {
    warnings.push("Your ADMIN_PASSWORD is shorter than 12 characters. Use a long random password.")
  }
  return warnings
}

// ---- login throttling -------------------------------------------------------

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 8

async function ipKey(request: Request, env: Env): Promise<string> {
  return sha256Hex(`login:${serverSecret(env)}:${clientIp(request)}`)
}

export async function isLoginThrottled(request: Request, env: Env): Promise<boolean> {
  const key = await ipKey(request, env)
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM login_attempts WHERE ip_hash = ? AND created_at > ?"
  )
    .bind(key, Date.now() - WINDOW_MS)
    .first<{ c: number }>()
  return (row?.c ?? 0) >= MAX_FAILURES
}

export async function recordLoginFailure(request: Request, env: Env): Promise<void> {
  const key = await ipKey(request, env)
  await env.DB.prepare("INSERT INTO login_attempts (ip_hash, created_at) VALUES (?, ?)")
    .bind(key, Date.now())
    .run()
}

export async function clearLoginFailures(request: Request, env: Env): Promise<void> {
  const key = await ipKey(request, env)
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(key).run()
}

/** Slows guessing when many failures pile up across all IPs (a distributed attack), without locking the admin out. */
export async function globalFailureDelay(env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE created_at > ?")
    .bind(Date.now() - WINDOW_MS)
    .first<{ c: number }>()
  const ms = Math.min(3000, (row?.c ?? 0) * 40)
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
}
