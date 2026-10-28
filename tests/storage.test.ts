import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { makeBucket } from "./helpers/d1.ts"
import { hashObject, setBlockSizeForTests, uploadStream } from "../app/server/storage.server.ts"

const data = new Uint8Array(1000).map((_, i) => (i * 31) % 251)

/** A stream of `data` in chunks of `size`, as a byte stream (BYOB reads) or a plain one. */
function chunks(size: number, bytes: boolean): ReadableStream<Uint8Array> {
  let at = 0
  const pull = (controller: ReadableStreamDefaultController<Uint8Array> | ReadableByteStreamController) => {
    if (at >= data.length) {
      controller.close()
      // A byte stream closed during a BYOB read answers that read with no bytes.
      if ("byobRequest" in controller) controller.byobRequest?.respond(0)
      return
    }
    controller.enqueue(data.slice(at, at + size))
    at += size
  }
  return bytes ? new ReadableStream({ type: "bytes", pull }) : new ReadableStream({ pull })
}

test("a stream of unknown length is stored in blocks, whatever its chunk sizes", async (t) => {
  setBlockSizeForTests(128)
  t.after(() => setBlockSizeForTests(10 * 1024 * 1024))
  for (const bytes of [true, false]) {
    for (const size of [1, 37, 128, 300, 1000]) {
      const { bucket, objects } = makeBucket()
      const env = { FILES: bucket } as unknown as Env
      let uploadId = ""
      const stored = await uploadStream(env, "a.zip", chunks(size, bytes), 10_000, async (id) => void (uploadId = id))
      assert.equal(stored, data.length, `chunks of ${size}`)
      assert.ok(uploadId)
      assert.deepEqual(objects.get("a.zip")!.bytes, data)
      assert.equal(await hashObject(env, "a.zip", data.length), createHash("sha256").update(data).digest("hex"))
    }
  }

  // Over the limit: the upload is abandoned and nothing is kept.
  const { bucket, objects, uploads } = makeBucket()
  assert.equal(await uploadStream({ FILES: bucket } as unknown as Env, "b.zip", chunks(50, false), 500, async () => {}), null)
  assert.equal(objects.size, 0)
  assert.equal(uploads.size, 0)
})
