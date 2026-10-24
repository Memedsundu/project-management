/**
 * Reads a ZIP file without loading it into memory: the central directory at
 * the end lists every entry with its size and place, and each entry is then a
 * slice of the file. Stored entries come back as slices (no copy); deflated
 * ones go through the browser's DecompressionStream. Handles ZIP64.
 */

export type ZipEntryInfo = {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  isDir: boolean;
};

const decoder = new TextDecoder("utf-8");

async function bytes(blob: Blob, start: number, end: number) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

function u64(v: DataView, at: number) {
  return Number(v.getBigUint64(at, true));
}

export async function readZipEntries(file: Blob): Promise<ZipEntryInfo[]> {
  const size = file.size;
  if (size < 22) throw new Error("not a zip");
  // The end record is in the last 22 bytes plus at most a 64 KB comment.
  const tailStart = Math.max(0, size - 22 - 0xffff);
  const tail = await bytes(file, tailStart, size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip");
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locAt = eocd - 20;
    if (locAt < 0 || tail.getUint32(locAt, true) !== 0x07064b50) throw new Error("zip64 locator missing");
    const recAt = u64(tail, locAt + 8);
    const rec = await bytes(file, recAt, recAt + 56);
    if (rec.getUint32(0, true) !== 0x06064b50) throw new Error("zip64 record missing");
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }
  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const out: ZipEntryInfo[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error("bad central directory");
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let usize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // ZIP64 extra field: only the values that overflowed are present, in this order.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (usize === 0xffffffff) {
          usize = u64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(cd, q);
          q += 8;
        }
        if (offset === 0xffffffff) offset = u64(cd, q);
      }
      e += 4 + len;
    }
    out.push({ name, method, crc, compressedSize, size: usize, offset, isDir: name.endsWith("/") });
    p = extraEnd + commentLen;
  }
  return out;
}

/** Where an entry's bytes start: after its local header, whose name and extra lengths can differ from the central copy. */
async function dataStart(file: Blob, e: ZipEntryInfo) {
  const h = await bytes(file, e.offset, e.offset + 30);
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error("bad local header");
  return e.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
}

export async function entryBlob(file: Blob, e: ZipEntryInfo, type = ""): Promise<Blob> {
  const start = await dataStart(file, e);
  const raw = file.slice(start, start + e.compressedSize, type);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error(`unsupported compression ${e.method}`);
  const stream = raw.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).blob().then((b) => (type ? new Blob([b], { type }) : b));
}

export async function entryText(file: Blob, e: ZipEntryInfo) {
  return (await entryBlob(file, e)).text();
}
