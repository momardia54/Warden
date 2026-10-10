/**
 * Renames the top-level folder of a zip archive without decompressing it. Only the headers are rewritten: each entry's
 * compressed data, CRC and sizes are copied unchanged, because none of them depend on the entry's name. The result is
 * returned as a list of parts that mostly point into the original bytes, so repacking needs no second copy of the
 * file data.
 *
 * Repository archives from hosting services wrap everything in one folder named after the commit
 * (harbor-studio-harbor-theme-3f2a9c1/). WordPress and similar installers use that folder as the install directory,
 * so it must have the same name in every release.
 */

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const LOCAL_HEADER = 30
const CENTRAL_HEADER = 46
const END_RECORD = 22
const SLASH = 0x2f

/** Folder names accepted for a package: letters, digits, dot, dash and underscore, not starting with a dot. */
export const PACKAGE_FOLDER_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/

export type RepackedZip = {
  /** The archive, in order. Concatenated, they are the new zip file. */
  parts: Uint8Array[]
  size: number
  /** The top-level folder the archive had, or null when its entries were not all inside one folder. */
  previousFolder: string | null
  entries: number
}

type Entry = { central: number; nameStart: number; nameLength: number; extraLength: number; commentLength: number; localOffset: number }

export class ZipError extends Error {}

/**
 * Returns the archive with every entry inside `folder/`. When all entries share one top-level folder, that folder is
 * replaced; otherwise the entries are moved into the new folder. Throws ZipError for a damaged or unsupported archive
 * (ZIP64, split archives, data before the first entry).
 */
export function repackZip(bytes: Uint8Array, folder: string): RepackedZip {
  if (!PACKAGE_FOLDER_PATTERN.test(folder)) throw new ZipError("The package folder name may contain only letters, digits, dots, dashes and underscores.")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEndRecord(view)
  if (end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR_SIGNATURE) throw new ZipError("ZIP64 archives (over 4 GB or 65,535 files) are not supported.")
  const count = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 8, true) !== count) throw new ZipError("Split zip archives are not supported.")
  if (centralOffset + centralSize > end) throw new ZipError("The zip archive is damaged: its central directory is out of range.")
  if (count === 0) throw new ZipError("The zip archive is empty.")

  // Read the central directory.
  const entries: Entry[] = []
  let at = centralOffset
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_HEADER > end || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new ZipError("The zip archive is damaged: a central directory entry is missing.")
    const entry = {
      central: at,
      nameStart: at + CENTRAL_HEADER,
      nameLength: view.getUint16(at + 28, true),
      extraLength: view.getUint16(at + 30, true),
      commentLength: view.getUint16(at + 32, true),
      localOffset: view.getUint32(at + 42, true),
    }
    entries.push(entry)
    at += CENTRAL_HEADER + entry.nameLength + entry.extraLength + entry.commentLength
    if (at > end) throw new ZipError("The zip archive is damaged: a central directory entry is out of range.")
  }

  const name = (e: Entry) => bytes.subarray(e.nameStart, e.nameStart + e.nameLength)
  const prefix = commonFolder(entries.map(name))
  const folderBytes = new TextEncoder().encode(`${folder}/`)
  const rename = (e: Entry) => concat(folderBytes, name(e).subarray(prefix))

  // Local entries in file order: each one runs until the next one (or the central directory) starts, which also
  // covers a data descriptor after the compressed data.
  const byOffset = [...entries].sort((a, b) => a.localOffset - b.localOffset)
  if (byOffset[0].localOffset !== 0) throw new ZipError("The zip archive has data before its first entry.")
  const parts: Uint8Array[] = []
  const newOffset = new Map<Entry, number>()
  let size = 0
  const push = (part: Uint8Array) => {
    if (part.byteLength === 0) return
    parts.push(part)
    size += part.byteLength
  }
  byOffset.forEach((e, i) => {
    const start = e.localOffset
    const next = i + 1 < byOffset.length ? byOffset[i + 1].localOffset : centralOffset
    if (start + LOCAL_HEADER > next || view.getUint32(start, true) !== LOCAL_SIGNATURE) throw new ZipError("The zip archive is damaged: a file entry is missing.")
    const localName = view.getUint16(start + 26, true)
    const localExtra = view.getUint16(start + 28, true)
    const dataStart = start + LOCAL_HEADER + localName + localExtra
    if (dataStart > next) throw new ZipError("The zip archive is damaged: a file entry is out of range.")
    const newName = rename(e)
    const header = bytes.slice(start, start + LOCAL_HEADER)
    new DataView(header.buffer).setUint16(26, newName.byteLength, true)
    newOffset.set(e, size)
    push(header)
    push(newName)
    push(bytes.subarray(start + LOCAL_HEADER + localName, next))
  })

  // The central directory, in its original order, pointing at the new offsets.
  const newCentralOffset = size
  for (const e of entries) {
    const newName = rename(e)
    const header = bytes.slice(e.central, e.central + CENTRAL_HEADER)
    const h = new DataView(header.buffer)
    h.setUint16(28, newName.byteLength, true)
    h.setUint32(42, newOffset.get(e)!, true)
    push(header)
    push(newName)
    push(bytes.subarray(e.nameStart + e.nameLength, e.nameStart + e.nameLength + e.extraLength + e.commentLength))
  }
  const newCentralSize = size - newCentralOffset
  if (size > 0xffffffff) throw new ZipError("The repacked archive would exceed 4 GB.")

  const record = bytes.slice(end, bytes.byteLength)
  const r = new DataView(record.buffer)
  r.setUint32(12, newCentralSize, true)
  r.setUint32(16, newCentralOffset, true)
  push(record)

  return { parts, size, previousFolder: prefix > 0 ? new TextDecoder().decode(name(entries[0]).subarray(0, prefix - 1)) : null, entries: count }
}

/** Finds the end-of-central-directory record, which sits at the end of the file before an optional comment. */
function findEndRecord(view: DataView): number {
  const last = view.byteLength - END_RECORD
  const first = Math.max(0, last - 0xffff)
  for (let i = last; i >= first; i--) {
    if (view.getUint32(i, true) === END_SIGNATURE && i + END_RECORD + view.getUint16(i + 20, true) === view.byteLength) return i
  }
  throw new ZipError("The file is not a zip archive.")
}

/** Length of the top-level folder prefix ("folder/") shared by every name, or 0 when there is none. */
function commonFolder(names: Uint8Array[]): number {
  const first = names[0]
  const slash = first.indexOf(SLASH)
  if (slash <= 0) return 0
  const length = slash + 1
  for (const n of names) {
    if (n.byteLength < length) return 0
    for (let i = 0; i < length; i++) if (n[i] !== first[i]) return 0
  }
  return length
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(a, 0)
  out.set(b, a.byteLength)
  return out
}

/** A stream over the parts of a repacked archive. */
export function partsStream(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < parts.length) controller.enqueue(parts[i++])
      else controller.close()
    },
  })
}
