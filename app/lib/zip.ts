/**
 * Renames the top-level folder of a zip archive without decompressing it. Only the headers are rewritten: each entry's
 * compressed data, CRC and sizes are copied unchanged, because none of them depend on the entry's name. The new archive
 * is planned from the central directory alone, then written part by part from ranges of the original, so an archive
 * of any size is repacked with a few megabytes of memory and a handful of large copies.
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

/** Where the central directory sits, read from the end-of-central-directory record. */
export type ZipDirectory = { centralOffset: number; centralSize: number; count: number; endOffset: number }

/**
 * One stretch of the repacked archive: `length` bytes at output offset `at`, copied from the original archive at
 * `from`, or given as `bytes`. A segment that starts a local header carries `header`, the entry's expected name length
 * and the room before the next entry, so the header can be verified when its bytes are read.
 */
export type ZipSegment = { at: number; length: number } & ({ from: number; header?: { nameLength: number; room: number } } | { bytes: Uint8Array })

export type RepackPlan = {
  /** Size of the repacked archive. */
  size: number
  segments: ZipSegment[]
  /** The top-level folder the archive had, or null when its entries were not all inside one folder. */
  previousFolder: string | null
  entries: number
}

type Entry = { central: number; nameStart: number; nameLength: number; extraLength: number; commentLength: number; localOffset: number }

export class ZipError extends Error {}

/** Bytes to read from the end of an archive of `size` bytes to find its end-of-central-directory record. */
export const tailLength = (size: number) => Math.min(size, END_RECORD + 0xffff)

/**
 * Reads the end-of-central-directory record from the last bytes of an archive (`tail`, which starts at offset
 * `tailOffset` of the archive). Throws ZipError for a damaged or unsupported archive (ZIP64, split archives).
 */
export function readDirectory(tail: Uint8Array, tailOffset: number): ZipDirectory {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  const end = findEndRecord(view)
  if (end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR_SIGNATURE) throw new ZipError("ZIP64 archives (over 4 GB or 65,535 files) are not supported.")
  const count = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 8, true) !== count) throw new ZipError("Split zip archives are not supported.")
  if (centralOffset + centralSize > tailOffset + end) throw new ZipError("The zip archive is damaged: its central directory is out of range.")
  if (count === 0) throw new ZipError("The zip archive is empty.")
  return { centralOffset, centralSize, count, endOffset: tailOffset + end }
}

/**
 * Plans the archive with every entry inside `folder/`. When all entries share one top-level folder, that folder is
 * replaced; otherwise the entries are moved into the new folder. `central` holds the original archive from the start
 * of its central directory to its end, so a plan needs no other part of the archive in memory. Every new offset
 * follows from the central directory because a local header repeats its entry's name; `fillPart` verifies that as
 * the header's bytes are copied.
 */
export function planRepack(central: Uint8Array, directory: ZipDirectory, folder: string): RepackPlan {
  if (!PACKAGE_FOLDER_PATTERN.test(folder)) throw new ZipError("The package folder name may contain only letters, digits, dots, dashes and underscores.")
  const { centralOffset, centralSize, count, endOffset } = directory
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength)
  const centralEnd = centralSize

  // Read the central directory. Offsets in `Entry` are relative to `central`, except localOffset.
  const entries: Entry[] = []
  let at = 0
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_HEADER > centralEnd || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new ZipError("The zip archive is damaged: a central directory entry is missing.")
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
    if (at > centralEnd) throw new ZipError("The zip archive is damaged: a central directory entry is out of range.")
  }

  const name = (e: Entry) => central.subarray(e.nameStart, e.nameStart + e.nameLength)
  const prefix = commonFolder(entries.map(name))
  const folderBytes = new TextEncoder().encode(`${folder}/`)
  const rename = (e: Entry) => concat(folderBytes, name(e).subarray(prefix))

  // Local entries in file order: each one runs until the next one (or the central directory) starts, which also
  // covers a data descriptor after the compressed data. Its header is copied with the name length replaced.
  const byOffset = [...entries].sort((a, b) => a.localOffset - b.localOffset)
  if (byOffset[0].localOffset !== 0) throw new ZipError("The zip archive has data before its first entry.")
  const segments: ZipSegment[] = []
  const newOffset = new Map<Entry, number>()
  let size = 0
  const copy = (from: number, length: number, header?: { nameLength: number; room: number }) => {
    if (length > 0) segments.push(header ? { at: size, length, from, header } : { at: size, length, from })
    size += length
  }
  const add = (bytes: Uint8Array) => {
    if (bytes.byteLength > 0) segments.push({ at: size, length: bytes.byteLength, bytes })
    size += bytes.byteLength
  }
  byOffset.forEach((e, i) => {
    const start = e.localOffset
    const next = i + 1 < byOffset.length ? byOffset[i + 1].localOffset : centralOffset
    const dataStart = start + LOCAL_HEADER + e.nameLength
    if (dataStart > next) throw new ZipError("The zip archive is damaged: a file entry is out of range.")
    const newName = rename(e)
    const nameLength = new Uint8Array(2)
    new DataView(nameLength.buffer).setUint16(0, newName.byteLength, true)
    newOffset.set(e, size)
    copy(start, 26, { nameLength: e.nameLength, room: next - start })
    add(nameLength)
    copy(start + 28, 2)
    add(newName)
    copy(dataStart, next - dataStart)
  })

  // The central directory, in its original order, pointing at the new offsets, then the end record.
  const newCentralOffset = size
  const parts: Uint8Array[] = []
  for (const e of entries) {
    const newName = rename(e)
    const header = central.slice(e.central, e.central + CENTRAL_HEADER)
    const h = new DataView(header.buffer)
    h.setUint16(28, newName.byteLength, true)
    h.setUint32(42, newOffset.get(e)!, true)
    parts.push(header, newName, central.subarray(e.nameStart + e.nameLength, e.nameStart + e.nameLength + e.extraLength + e.commentLength))
  }
  const newCentralSize = parts.reduce((total, part) => total + part.byteLength, 0)
  const record = central.slice(endOffset - centralOffset)
  const r = new DataView(record.buffer)
  r.setUint32(12, newCentralSize, true)
  r.setUint32(16, newCentralOffset, true)
  parts.push(record)
  for (const part of parts) add(part)
  if (size > 0xffffffff) throw new ZipError("The repacked archive would exceed 4 GB.")

  return { size, segments, previousFolder: prefix > 0 ? new TextDecoder().decode(name(entries[0]).subarray(0, prefix - 1)) : null, entries: count }
}

/**
 * The range of the original archive that `fillPart` needs to write bytes `start` to `end` of the repacked one, or
 * null when that stretch holds no original bytes. It includes the whole local header of every entry that begins
 * there, so each header is verified.
 */
export function sourceRange(plan: RepackPlan, start: number, end: number): { from: number; to: number } | null {
  let from = Infinity
  let to = -Infinity
  for (let i = firstSegment(plan, start); i < plan.segments.length && plan.segments[i].at < end; i++) {
    const s = plan.segments[i]
    if (!("from" in s)) continue
    const lo = s.from + Math.max(0, start - s.at)
    const hi = s.from + Math.min(s.length, end - s.at)
    from = Math.min(from, s.header ? s.from : lo)
    to = Math.max(to, s.header ? s.from + LOCAL_HEADER : hi)
  }
  return from === Infinity ? null : { from, to }
}

/**
 * Writes bytes `start` to `start + out.byteLength` of the repacked archive into `out`. `source` holds the original
 * archive from offset `sourceStart`, covering at least `sourceRange` of the same stretch. Throws ZipError when a
 * local header does not match the central directory.
 */
export function fillPart(plan: RepackPlan, start: number, out: Uint8Array, source: Uint8Array, sourceStart: number): void {
  const end = start + out.byteLength
  for (let i = firstSegment(plan, start); i < plan.segments.length && plan.segments[i].at < end; i++) {
    const s = plan.segments[i]
    const lo = Math.max(start, s.at)
    const hi = Math.min(end, s.at + s.length)
    if ("bytes" in s) {
      out.set(s.bytes.subarray(lo - s.at, hi - s.at), lo - start)
      continue
    }
    if (s.header) checkLocalHeader(source, s.from - sourceStart, s.header)
    const from = s.from + (lo - s.at) - sourceStart
    if (from < 0 || from + (hi - lo) > source.byteLength) throw new RangeError("fillPart: the source does not cover the requested range.")
    out.set(source.subarray(from, from + (hi - lo)), lo - start)
  }
}

function checkLocalHeader(source: Uint8Array, at: number, expected: { nameLength: number; room: number }): void {
  if (at < 0 || at + LOCAL_HEADER > source.byteLength) throw new RangeError("fillPart: the source does not cover a local header.")
  const view = new DataView(source.buffer, source.byteOffset + at, LOCAL_HEADER)
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ZipError("The zip archive is damaged: a file entry is missing.")
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  if (nameLength !== expected.nameLength) throw new ZipError("The zip archive is not supported: a file entry's name differs from its central directory entry.")
  if (LOCAL_HEADER + nameLength + extraLength > expected.room) throw new ZipError("The zip archive is damaged: a file entry is out of range.")
}

/** Index of the segment that contains output offset `at` (segments are contiguous and sorted). */
function firstSegment(plan: RepackPlan, at: number): number {
  let lo = 0
  let hi = plan.segments.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (plan.segments[mid].at <= at) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Repacks an archive held in memory. Used by tests; imports repack part by part from storage. */
export function repackZip(bytes: Uint8Array, folder: string): RepackPlan & { bytes: Uint8Array } {
  const tailOffset = bytes.byteLength - tailLength(bytes.byteLength)
  const directory = readDirectory(bytes.subarray(tailOffset), tailOffset)
  const plan = planRepack(bytes.subarray(directory.centralOffset), directory, folder)
  const out = new Uint8Array(plan.size)
  fillPart(plan, 0, out, bytes, 0)
  return { ...plan, bytes: out }
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
