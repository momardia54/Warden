/**
 * Large-file work on R2 within the CPU limit of the Workers free plan. JavaScript that handles a body chunk by chunk
 * pays for every chunk (a 70 MB archive arrives in thousands of them), so files are moved and hashed in blocks of
 * BLOCK_BYTES (10 MiB): one read, one copy and one write per block, the rest done natively by the runtime.
 */
import { toHex } from "./util.server"

/** Block size for multipart uploads, range reads and hashing. R2 requires parts of at least 5 MiB, all equal but the last. */
export const BLOCK_BYTES = 10 * 1024 * 1024
let blockBytes = BLOCK_BYTES

/** The block size in use. */
export const blockSize = () => blockBytes

/** Tests use small blocks to cover files of several blocks. */
export function setBlockSizeForTests(size: number): void {
  blockBytes = size
}

/** Feeds bytes to SHA-256. Workers have a streaming digest; elsewhere (tests) the bytes are collected first. */
export function sha256Hasher(): { update: (chunk: Uint8Array) => Promise<void>; digest: () => Promise<string> } {
  const Native = (crypto as unknown as { DigestStream?: new (algorithm: string) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> } }).DigestStream
  if (typeof Native === "function") {
    const stream = new Native("SHA-256")
    const writer = stream.getWriter()
    return {
      update: (chunk) => writer.write(chunk),
      digest: async () => {
        await writer.close()
        return toHex(await stream.digest)
      },
    }
  }
  const chunks: Uint8Array[] = []
  return {
    update: async (chunk) => void chunks.push(chunk),
    digest: async () => toHex(await crypto.subtle.digest("SHA-256", await new Blob(chunks as BlobPart[]).arrayBuffer())),
  }
}

/** Reads `length` bytes of an object from `offset`. */
export async function readRange(env: Env, key: string, offset: number, length: number): Promise<Uint8Array> {
  const object = await env.FILES.get(key, { range: { offset, length } })
  if (!object) throw new Error(`Stored object ${key} is missing.`)
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (bytes.byteLength !== length) throw new Error(`Stored object ${key} is shorter than expected.`)
  return bytes
}

/** SHA-256 of a stored object, read in blocks. */
export async function hashObject(env: Env, key: string, size: number): Promise<string> {
  const hasher = sha256Hasher()
  for (let offset = 0; offset < size; offset += blockBytes) await hasher.update(await readRange(env, key, offset, Math.min(blockBytes, size - offset)))
  return hasher.digest()
}

/**
 * Reads a stream in blocks of `size` bytes (the last one shorter, then empty). A Workers byte stream fills a block in
 * one call (readAtLeast); elsewhere the block is filled from as many reads as it takes.
 */
function blockReader(body: ReadableStream<Uint8Array>, size: number): { next: () => Promise<Uint8Array>; cancel: () => Promise<void> } {
  let byob: ReadableStreamBYOBReader | null = null
  try {
    byob = body.getReader({ mode: "byob" })
  } catch {
    // Not a byte stream: read it chunk by chunk below.
  }
  if (byob) {
    // readAtLeast is a Workers extension of the BYOB reader.
    const reader = byob as ReadableStreamBYOBReader & { readAtLeast?: (min: number, view: Uint8Array) => Promise<{ value?: Uint8Array; done: boolean }> }
    return {
      async next() {
        if (typeof reader.readAtLeast === "function") return (await reader.readAtLeast(size, new Uint8Array(size))).value ?? new Uint8Array(0)
        let buffer = new ArrayBuffer(size)
        let filled = 0
        while (filled < size) {
          const { value, done } = await reader.read(new Uint8Array(buffer, filled, size - filled))
          if (value) buffer = value.buffer as ArrayBuffer
          if (done || !value) break
          filled += value.byteLength
        }
        return new Uint8Array(buffer, 0, filled)
      },
      cancel: () => reader.cancel(),
    }
  }
  const reader = body.getReader()
  let leftover: Uint8Array = new Uint8Array(0)
  return {
    async next() {
      const block = new Uint8Array(size)
      let filled = 0
      for (;;) {
        const take = Math.min(leftover.byteLength, size - filled)
        block.set(leftover.subarray(0, take), filled)
        filled += take
        leftover = leftover.subarray(take)
        if (filled === size) break
        const { value, done } = await reader.read()
        if (done || !value) break
        leftover = value
      }
      return block.subarray(0, filled)
    },
    cancel: () => reader.cancel(),
  }
}

/**
 * Writes a stream of unknown length to R2 as a multipart upload, one block per part, so memory stays at one block
 * whatever the size. Returns the size, or null when the stream exceeds `maxBytes` (nothing is kept then).
 * `onUpload` receives the upload id as soon as it exists, so an interrupted upload can be aborted later.
 */
export async function uploadStream(env: Env, key: string, body: ReadableStream<Uint8Array>, maxBytes: number, onUpload: (uploadId: string) => Promise<void>): Promise<number | null> {
  const upload = await env.FILES.createMultipartUpload(key)
  await onUpload(upload.uploadId)
  const reader = blockReader(body, blockBytes)
  const parts: R2UploadedPart[] = []
  // The next block is read while the previous one uploads: two blocks in memory, about half the waiting.
  let uploading: Promise<R2UploadedPart> | null = null
  let size = 0
  try {
    for (;;) {
      const block = await reader.next()
      if (uploading) parts.push(await uploading)
      uploading = null
      if (block.byteLength === 0) break
      size += block.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        await upload.abort().catch(() => {})
        return null
      }
      uploading = upload.uploadPart(parts.length + 1, block)
      if (block.byteLength < blockBytes) break
    }
    if (uploading) parts.push(await uploading)
    if (parts.length === 0) throw new Error("The download is empty.")
    await upload.complete(parts)
    return size
  } catch (error) {
    uploading?.catch(() => {})
    await upload.abort().catch(() => {})
    throw error
  }
}
