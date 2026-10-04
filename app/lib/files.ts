import { buildAnswer, effectiveStatus, isInForce } from "./license"

export const FILE_KINDS = ["update", "final"] as const
export type FileKind = (typeof FILE_KINDS)[number]

export const KIND_LABEL: Record<FileKind, string> = { update: "Update", final: "Final" }
export const KIND_HINT: Record<FileKind, string> = {
  update: "Downloadable while the licence is active or completed (and the domain matches, if the licence lists domains).",
  final: "Downloadable only once the licence is completed (paid in full). Domains are not checked.",
}

/** 100 MB: the largest request body a Worker accepts on the Free plan. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024

export function isFileKind(value: unknown): value is FileKind {
  return typeof value === "string" && (FILE_KINDS as readonly string[]).includes(value)
}

/** A safe download name: no folders, no control characters, at most 150 characters. null when nothing usable is left. */
export function cleanFileName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? ""
  const name = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").trim().replace(/^\.+/, "").slice(0, 150)
  return name || null
}

export type Access = { allowed: boolean; status: string; message: string }

type LicenseLike = { name: string; status: string; expires_at: number | null; domains: string; message: string }

/**
 * Whether a file may be downloaded right now. `domain` is what the downloader sent; pass `ignoreDomain`
 * in the dashboard, where there is no site to ask.
 */
export function fileAccess(license: LicenseLike, kind: FileKind, domain: string | null, now = Date.now(), ignoreDomain = false): Access {
  if (kind === "final") {
    const status = effectiveStatus(license, now)
    return status === "completed"
      ? { allowed: true, status, message: "" }
      : { allowed: false, status, message: "This file is released when the licence is paid in full (status completed)." }
  }
  const answer = buildAnswer(license, ignoreDomain && license.domains ? license.domains.split(",")[0].trim() : domain, now)
  return { allowed: answer.valid && isInForce(answer.status), status: answer.status, message: answer.message }
}
