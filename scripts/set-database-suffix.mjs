// Optional build step: if the DB_SUFFIX build variable is set, the D1 database is named
// "<worker-name>-<suffix>" (for example "warden-x7k2"). If it is not set, nothing changes and
// Wrangler names the database "<worker-name>-db".
//
// Why a build step: wrangler.jsonc is static, so it cannot read variables. The Cloudflare vite plugin
// writes the config that `wrangler deploy` actually uses to build/server/wrangler.json; we patch that file.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SUFFIX_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i

/**
 * Pure: returns the patched config, or throws with a message meant for the build log.
 * The suffix is lower-cased and "_" becomes "-", matching how Wrangler names auto-created databases.
 */
export function applyDatabaseSuffix(config, rawSuffix) {
  const input = (rawSuffix ?? "").trim()
  if (!input) return { config, changed: false }

  if (!SUFFIX_RE.test(input)) {
    throw new Error(
      `DB_SUFFIX "${input}" is not valid. Use 1-32 letters, numbers, "-" or "_", starting with a letter or number. ` +
        `Fix or remove the DB_SUFFIX build variable.`
    )
  }
  const db = (config.d1_databases ?? []).find((d) => d.binding === "DB")
  if (!db) throw new Error('Could not find the "DB" D1 binding in the generated Worker config.')
  if (!config.name) throw new Error("The generated Worker config has no name.")

  const suffix = input.toLowerCase().replaceAll("_", "-")
  const name = `${config.name.toLowerCase()}-${suffix}`
  db.database_name = name
  return { config, changed: true, name }
}

function locateGeneratedConfig(root) {
  // The vite plugin leaves a pointer to the config it generated.
  const redirect = path.join(root, ".wrangler", "deploy", "config.json")
  if (fs.existsSync(redirect)) {
    const { configPath } = JSON.parse(fs.readFileSync(redirect, "utf8"))
    return path.resolve(path.dirname(redirect), configPath)
  }
  return path.join(root, "build", "server", "wrangler.json")
}

function main() {
  const raw = process.env.DB_SUFFIX
  if (!(raw ?? "").trim()) {
    console.log("[warden] DB_SUFFIX is not set: the database will be named <worker-name>-db.")
    return
  }
  const file = locateGeneratedConfig(process.cwd())
  if (!fs.existsSync(file)) throw new Error(`Generated Worker config not found at ${file}. Run this after the build.`)
  const { config, name } = applyDatabaseSuffix(JSON.parse(fs.readFileSync(file, "utf8")), raw)
  fs.writeFileSync(file, JSON.stringify(config))
  console.log(`[warden] DB_SUFFIX set: the database will be named "${name}".`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`[warden] ${error.message}`)
    process.exit(1)
  }
}
