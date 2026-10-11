import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { makeDb } from "./helpers/d1.ts"
import { splitStatements } from "../app/server/migrate.server.ts"

test("migration 0005 keeps existing licences, files and activity", () => {
  const { raw } = makeDb("0004_file_release_rules.sql")
  const now = Date.now()
  raw.prepare("INSERT INTO licenses (id, name, client, license_key, status, expires_at, domains, message, notes, created_at, updated_at, external_ref) VALUES ('lic_1', 'Harbor Studio', 'Harbor Group', 'WRD-AAAAA-BBBBB-CCCCC-DDDDD', 'active', NULL, 'example.org', 'hi', 'n', ?, ?, 'order-1')").run(now, now)
  raw.prepare("INSERT INTO files (id, license_id, name, version, notes, statuses, check_domain, size, content_type, r2_key, uploaded_at, download_count) VALUES ('fil_1', 'lic_1', 'theme.zip', '1.0.0', '', 'completed', 0, 10, 'application/zip', 'lic_1/fil_1', ?, 3)").run(now)
  raw.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail) VALUES ('lic_1', ?, 'check', 'active', 'example.org', '')").run(now)

  const sql = readFileSync(join(import.meta.dirname, "..", "migrations", "0005_apps.sql"), "utf8")
  for (const statement of splitStatements(sql)) raw.exec(statement)

  const lic = raw.prepare("SELECT * FROM licenses WHERE id = 'lic_1'").get() as Record<string, unknown>
  assert.deepEqual([lic.customer_name, lic.customer_email, lic.app_id, lic.max_sites, lic.external_ref, lic.domains], ["Harbor Group", "", null, null, "order-1", "example.org"])
  const file = raw.prepare("SELECT * FROM files WHERE id = 'fil_1'").get() as Record<string, unknown>
  assert.deepEqual([file.license_id, file.app_id, file.statuses, file.check_domain, file.download_count], ["lic_1", null, "completed", 0, 3])
  assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM activity").get() as { c: number }).c, 1)

  // a file belongs to a licence or to an app, never both and never neither
  raw.prepare("INSERT INTO apps (id, name, slug, created_at, updated_at) VALUES ('app_1', 'A', 'a', 1, 1)").run()
  const insert = (licenseId: string | null, appId: string | null) =>
    raw.prepare("INSERT INTO files (id, license_id, app_id, name, size, content_type, r2_key, uploaded_at) VALUES (?, ?, ?, 'x', 1, 't', 'k', 1)").run(`fil_${Math.random()}`, licenseId, appId)
  assert.doesNotThrow(() => insert(null, "app_1"))
  assert.throws(() => insert("lic_1", "app_1"))
  assert.throws(() => insert(null, null))
})

test("migration 0014 does not report what happened before it: licences already expired or silent are marked", () => {
  const { raw } = makeDb("0013_release_tracks.sql")
  const now = Date.now()
  const day = 86_400_000
  const insert = raw.prepare(
    "INSERT INTO licenses (id, name, customer_name, license_key, status, expires_at, domains, message, notes, created_at, updated_at, last_check_at) VALUES (?, ?, '', ?, 'active', ?, '', '', '', ?, ?, ?)",
  )
  insert.run("lic_old", "Expired long ago", "WRD-AAAAA-BBBBB-CCCCC-DDDD1", now - 30 * day, now - 60 * day, now, now - 10 * day)
  insert.run("lic_new", "Expires later", "WRD-AAAAA-BBBBB-CCCCC-DDDD2", now + 30 * day, now - 60 * day, now, now)

  const sql = readFileSync(join(import.meta.dirname, "..", "migrations", "0014_grace_and_webhooks.sql"), "utf8")
  for (const statement of splitStatements(sql)) raw.exec(statement)

  const row = (id: string) => raw.prepare("SELECT * FROM licenses WHERE id = ?").get(id) as Record<string, unknown>
  const old = row("lic_old")
  assert.deepEqual([old.grace_notified_for, old.expired_notified_for, old.silent_notified_for, old.grace_days], [now - 30 * day, now - 30 * day, now - 10 * day, null])
  const fresh = row("lic_new")
  assert.deepEqual([fresh.grace_notified_for, fresh.expired_notified_for, fresh.silent_notified_for], [null, null, null])
})
