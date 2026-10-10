import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { VERSION } from "../app/lib/version.ts"

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")

test("one version everywhere: package.json, the lock file and the changelog's latest section", () => {
  assert.equal(JSON.parse(read("package.json")).version, VERSION)
  const lock = JSON.parse(read("package-lock.json"))
  assert.equal(lock.version, VERSION)
  assert.equal(lock.packages[""].version, VERSION)
  const latest = read("CHANGELOG.md").match(/^## (\S+)/m)?.[1]
  assert.equal(latest, VERSION)
})
