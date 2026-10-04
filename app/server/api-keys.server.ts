import type { Scope } from "../lib/license"
import { newId, randomString, sha256Hex } from "./util.server"

export type ApiKeyRow = { id: string; name: string; prefix: string; scope: Scope; created_at: number; last_used_at: number | null }

/** Creates an API key. Only a SHA-256 hash is stored; the secret is returned once and cannot be recovered. */
export async function createApiKey(env: Env, name: string, scope: Scope): Promise<{ id: string; secret: string }> {
  const secret = `wk_${randomString(40)}`
  const id = newId("key")
  await env.DB.prepare("INSERT INTO api_keys (id, name, prefix, key_hash, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, name, secret.slice(0, 7), await sha256Hex(secret), scope, Date.now())
    .run()
  return { id, secret }
}

export async function listApiKeys(env: Env): Promise<ApiKeyRow[]> {
  return (await env.DB.prepare("SELECT id, name, prefix, scope, created_at, last_used_at FROM api_keys ORDER BY created_at DESC").all<ApiKeyRow>()).results
}

export async function revokeApiKey(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM api_keys WHERE id = ?").bind(id).run()
}

/** Resolves the API key from the Authorization (Bearer) or X-API-Key header and records when it was last used. */
export async function authenticate(request: Request, env: Env, ctx: ExecutionContext): Promise<ApiKeyRow | null> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (request.headers.get("x-api-key") ?? "").trim()
  if (!/^wk_[A-Za-z0-9]{40}$/.test(token)) return null
  const row = await env.DB.prepare("SELECT id, name, prefix, scope, created_at, last_used_at FROM api_keys WHERE key_hash = ?").bind(await sha256Hex(token)).first<ApiKeyRow>()
  // Update the timestamp at most once a minute per key.
  if (row && (!row.last_used_at || Date.now() - row.last_used_at > 60_000)) {
    ctx.waitUntil(env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), row.id).run().then(() => {}, () => {}))
  }
  return row
}
