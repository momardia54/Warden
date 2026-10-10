/**
 * Release sources: a repository connected to an app or a licence, published as releases when its trigger fires.
 * Pure and client-safe. Providers and triggers are listed here so the dashboard, the API and the server share one
 * definition; adding a provider or a trigger means adding an entry here and its implementation in
 * app/server/source-providers/.
 */

import { isValidVersion } from "./releases"
import { PACKAGE_FOLDER_PATTERN } from "./zip"

export const PROVIDERS = ["github"] as const
export type ProviderKey = (typeof PROVIDERS)[number]

export const PROVIDER_INFO: Record<ProviderKey, { label: string; host: string; repositoryHint: string; tokenHelp: string }> = {
  github: {
    label: "GitHub",
    host: "github.com",
    repositoryHint: "owner/repository, or its github.com address",
    tokenHelp:
      "Required for a private repository. Create a fine-grained personal access token limited to this repository, with read-only access to Contents. Leave empty for a public repository.",
  },
}

export const TRIGGERS = ["tag"] as const
export type TriggerKey = (typeof TRIGGERS)[number]

export const TRIGGER_INFO: Record<TriggerKey, { label: string; help: string }> = {
  tag: {
    label: "New tag",
    help: "Pushing a tag such as v1.4.0 publishes version 1.4.0. A tag with a pre-release suffix, such as v2.0.0-beta.1, is published on the beta channel. Tags that are not versions are skipped.",
  },
}

export const IMPORT_STATES = ["pending", "imported", "skipped", "failed"] as const
export type ImportState = (typeof IMPORT_STATES)[number]

export const IMPORT_STATE_LABELS: Record<ImportState, string> = { pending: "In progress", imported: "Published", skipped: "Skipped", failed: "Failed" }

/** An import still pending after this long is reported as failed: the Worker that ran it has stopped. */
export const IMPORT_TIMEOUT_MS = 15 * 60_000

export const isProvider = (value: unknown): value is ProviderKey => typeof value === "string" && (PROVIDERS as readonly string[]).includes(value)
export const isTrigger = (value: unknown): value is TriggerKey => typeof value === "string" && (TRIGGERS as readonly string[]).includes(value)

const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/

/**
 * Reads a repository as owner/name from "owner/name", "https://github.com/owner/name(.git)" or "git@github.com:owner/name.git".
 * Returns null when it is not one.
 */
export function parseRepository(provider: ProviderKey, raw: string): string | null {
  const host = PROVIDER_INFO[provider].host.replace(/\./g, "\\.")
  const text = raw
    .trim()
    .replace(new RegExp(`^(?:https?://)?(?:www\\.)?${host}/`, "i"), "")
    .replace(new RegExp(`^git@${host}:`, "i"), "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
  const parts = text.split("/")
  if (parts.length !== 2 || !parts.every((p) => REPOSITORY_PART.test(p) && p !== "." && p !== "..")) return null
  return `${parts[0]}/${parts[1]}`
}

/** The version a tag publishes: v1.4.0 and 1.4.0 give 1.4.0. Null when the tag is not a version. */
export function versionFromTag(tag: string): string | null {
  const version = tag.trim().replace(/^v(?=\d)/i, "")
  return isValidVersion(version) ? version : null
}

/** Releases with a pre-release suffix (2.0.0-beta.1, 3.0-rc1) are published on the beta channel. */
export const channelForVersion = (version: string): "stable" | "beta" => (version.includes("-") ? "beta" : "stable")

/** Validates the folder name a package is repacked into. Returns an error message, or null when valid. */
export function packageFolderError(folder: string): string | null {
  if (!folder.trim()) return "Enter the folder name the package installs into, for example harbor-theme."
  return PACKAGE_FOLDER_PATTERN.test(folder.trim()) ? null : "The folder name may contain only letters, digits, dots, dashes and underscores, and cannot start with a dot."
}

/** The file name of a published package: <folder>-<version>.zip. */
export const packageFileName = (folder: string, version: string) => `${folder}-${version}.zip`
