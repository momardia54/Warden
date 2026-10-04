import { DatabaseSync } from "node:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { splitStatements } from "../../app/server/migrate.server.ts"

type Param = string | number | null

/** A stand-in for Cloudflare D1 on top of Node's built-in SQLite, good enough to run the app's real SQL in tests. */
class Statement {
  constructor(private db: DatabaseSync, readonly sql: string, private params: Param[] = []) {}
  bind(...params: Param[]) {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : p)))
  }
  private isRead() {
    return /^\s*(select|with)\b/i.test(this.sql) && !/\breturning\b/i.test(this.sql)
  }
  private changes(): number {
    return Number((this.db.prepare("SELECT changes() AS c").get() as { c: number }).c)
  }
  async all<T = Record<string, unknown>>() {
    const results = this.db.prepare(this.sql).all(...this.params) as T[]
    return { results, success: true, meta: { changes: this.isRead() ? 0 : this.changes() } }
  }
  async first<T = Record<string, unknown>>(column?: string) {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined
    if (!row) return null
    return (column ? row[column] : row) as T
  }
  async run() {
    const res = this.db.prepare(this.sql).run(...this.params)
    return { success: true, meta: { changes: Number(res.changes), last_row_id: Number(res.lastInsertRowid) } }
  }
}

export type TestDb = { DB: D1Database; raw: DatabaseSync }

/** An empty database with the migrations applied, up to and including `upTo` (a file name) when given. */
export function makeDb(upTo?: string): TestDb {
  const raw = new DatabaseSync(":memory:")
  raw.exec("PRAGMA foreign_keys = ON")
  const dir = join(import.meta.dirname, "..", "..", "migrations")
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (upTo && file > upTo) break
    for (const statement of splitStatements(readFileSync(join(dir, file), "utf8"))) raw.exec(statement)
  }
  const DB = {
    prepare: (sql: string) => new Statement(raw, sql),
    async batch(statements: Statement[]) {
      const out: unknown[] = []
      raw.exec("BEGIN")
      try {
        for (const s of statements) out.push(await s.all())
        raw.exec("COMMIT")
      } catch (error) {
        raw.exec("ROLLBACK")
        throw error
      }
      return out
    },
  } as unknown as D1Database
  return { DB, raw }
}

/** A stand-in for the execution context that lets a test wait for background work. */
export function makeCtx() {
  const pending: Promise<unknown>[] = []
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(() => {})), passThroughOnException() {} } as unknown as ExecutionContext,
    async settle() {
      while (pending.length) await Promise.all(pending.splice(0))
    },
  }
}

export type Sent = { url: string; method: string; headers: Headers; body: string }

/** Replaces fetch with a recorder. `answer` decides the response for each request. */
export function mockFetch(answer: (sent: Sent) => Response | Promise<Response> = () => new Response("ok", { status: 200 })) {
  const sent: Sent[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const s = { url: String(url), method: String(init.method ?? "GET"), headers: new Headers(init.headers as HeadersInit), body: String(init.body ?? "") }
    sent.push(s)
    return answer(s)
  }) as typeof fetch
  return { sent, restore: () => void (globalThis.fetch = real) }
}
