import assert from "node:assert/strict"

// ---- a minimal zip writer and reader, independent of the code under test ------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Builds a zip of stored (uncompressed) entries; `descriptor` writes sizes after the data, as streaming writers do. */
export function buildZip(files: [string, string][], { comment = "", descriptor = false } = {}): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const add = (b: Uint8Array) => {
    chunks.push(b)
    offset += b.length
  }
  for (const [name, text] of files) {
    const n = enc.encode(name)
    const data = enc.encode(text)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, descriptor ? 8 : 0, true)
    if (!descriptor) {
      local.setUint32(14, crc, true)
      local.setUint32(18, data.length, true)
      local.setUint32(22, data.length, true)
    }
    local.setUint16(26, n.length, true)
    const at = offset
    add(new Uint8Array(local.buffer))
    add(n)
    add(data)
    if (descriptor) {
      const d = new DataView(new ArrayBuffer(16))
      d.setUint32(0, 0x08074b50, true)
      d.setUint32(4, crc, true)
      d.setUint32(8, data.length, true)
      d.setUint32(12, data.length, true)
      add(new Uint8Array(d.buffer))
    }
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, descriptor ? 8 : 0, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, n.length, true)
    c.setUint32(42, at, true)
    central.push(new Uint8Array(c.buffer), n)
  }
  const cdStart = offset
  for (const c of central) add(c)
  const cm = enc.encode(comment)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, offset - cdStart, true)
  end.setUint32(16, cdStart, true)
  end.setUint16(20, cm.length, true)
  add(new Uint8Array(end.buffer))
  add(cm)
  return new Uint8Array(Buffer.concat(chunks))
}

/** Reads every entry through the central directory and its local header, checking names agree and CRCs match. */
export function readZip(bytes: Uint8Array): { files: Record<string, string>; comment: string } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dec = new TextDecoder()
  let end = bytes.length - 22
  while (v.getUint32(end, true) !== 0x06054b50) end--
  const count = v.getUint16(end + 10, true)
  let at = v.getUint32(end + 16, true)
  const files: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(at, true), 0x02014b50)
    const nameLength = v.getUint16(at + 28, true)
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    const size = v.getUint32(at + 20, true)
    const crc = v.getUint32(at + 16, true)
    const local = v.getUint32(at + 42, true)
    assert.equal(v.getUint32(local, true), 0x04034b50, `local header of ${name}`)
    const localName = dec.decode(bytes.subarray(local + 30, local + 30 + v.getUint16(local + 26, true)))
    assert.equal(localName, name)
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + size)
    assert.equal(crc32(data), crc, `CRC of ${name}`)
    files[name] = dec.decode(data)
    at += 46 + nameLength + v.getUint16(at + 30, true) + v.getUint16(at + 32, true)
  }
  return { files, comment: dec.decode(bytes.subarray(end + 22)) }
}

