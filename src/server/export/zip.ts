import "server-only";
import zlib from "node:zlib";
import { TZDate } from "@date-fns/tz";
import { APP_TZ } from "@/lib/dates";

/**
 * A small ZIP writer that streams: each entry's bytes are known before it is
 * written (sizes and CRC sit in the local header, no data descriptors), so
 * any unzip tool can read the result. Text compresses; files that are already
 * compressed (PDF, Word, images) are stored as they are. ZIP64 records are
 * added only when the archive passes 4 GB or 65,535 entries.
 */

export type ZipSource = {
  /** Path inside the archive, with "/" between folders. */
  name: string;
  /** Deflate the bytes (text, JSON, HTML); leave false for files that are already compressed. */
  compress?: boolean;
  modified?: Date;
} & ({ data: Uint8Array | string } | { load: () => Promise<Uint8Array | null> });

const encoder = new TextEncoder();
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
// Hand big files over in pieces so the response keeps flowing.
const CHUNK = 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  if (typeof zlib.crc32 === "function") return zlib.crc32(data) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time in Istanbul, which is what unzip tools show. */
function dosDateTime(d: Date) {
  const t = new TZDate(d, APP_TZ);
  const year = Math.min(Math.max(t.getFullYear(), 1980), 2107);
  return {
    time: ((t.getHours() << 11) | (t.getMinutes() << 5) | Math.floor(t.getSeconds() / 2)) & 0xffff,
    date: (((year - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate()) & 0xffff,
  };
}

type Written = { name: Uint8Array; crc: number; csize: number; usize: number; method: number; time: number; date: number; unix: number; offset: number };

/**
 * The extended timestamp field ("UT"): the exact modification time in UTC.
 * Written to both headers so that unzip treats every name the same way; it
 * converts UTF-8 names only for entries that carry an extra field, and a
 * difference between the two headers shows up as a warning.
 */
function timestampExtra(unix: number) {
  const b = Buffer.alloc(9);
  b.writeUInt16LE(0x5455, 0);
  b.writeUInt16LE(5, 2);
  b.writeUInt8(1, 4); // modification time present
  b.writeUInt32LE(unix >>> 0, 5);
  return b;
}

function localHeader(w: Omit<Written, "offset">) {
  const extra = timestampExtra(w.unix);
  const b = Buffer.alloc(30 + w.name.length + extra.length);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(20, 4); // version needed
  b.writeUInt16LE(0x0800, 6); // UTF-8 names
  b.writeUInt16LE(w.method, 8);
  b.writeUInt16LE(w.time, 10);
  b.writeUInt16LE(w.date, 12);
  b.writeUInt32LE(w.crc, 14);
  b.writeUInt32LE(w.csize, 18);
  b.writeUInt32LE(w.usize, 22);
  b.writeUInt16LE(w.name.length, 26);
  b.writeUInt16LE(extra.length, 28);
  b.set(w.name, 30);
  b.set(extra, 30 + w.name.length);
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}

function centralHeader(w: Written, zip64At: number) {
  const big = w.offset >= zip64At;
  const zip64 = Buffer.alloc(big ? 12 : 0);
  if (big) {
    zip64.writeUInt16LE(0x0001, 0);
    zip64.writeUInt16LE(8, 2);
    zip64.writeBigUInt64LE(BigInt(w.offset), 4);
  }
  const extra = Buffer.concat([zip64, timestampExtra(w.unix)]);
  const b = Buffer.alloc(46 + w.name.length + extra.length);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE((3 << 8) | (big ? 45 : 20), 4); // made by: Unix
  b.writeUInt16LE(big ? 45 : 20, 6);
  b.writeUInt16LE(0x0800, 8);
  b.writeUInt16LE(w.method, 10);
  b.writeUInt16LE(w.time, 12);
  b.writeUInt16LE(w.date, 14);
  b.writeUInt32LE(w.crc, 16);
  b.writeUInt32LE(w.csize, 20);
  b.writeUInt32LE(w.usize, 24);
  b.writeUInt16LE(w.name.length, 28);
  b.writeUInt16LE(extra.length, 30);
  b.writeUInt16LE(0, 32); // comment
  b.writeUInt16LE(0, 34); // disk
  b.writeUInt16LE(0, 36); // internal attributes
  b.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
  b.writeUInt32LE(big ? MAX32 : w.offset, 42);
  b.set(w.name, 46);
  b.set(extra, 46 + w.name.length);
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}

function endRecords(count: number, cdOffset: number, cdSize: number, zip64At: number) {
  const parts: Uint8Array[] = [];
  const needs64 = count >= MAX16 || cdOffset >= zip64At || cdSize >= zip64At;
  if (needs64) {
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(BigInt(44), 4);
    rec.writeUInt16LE((3 << 8) | 45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeUInt32LE(0, 16);
    rec.writeUInt32LE(0, 20);
    rec.writeBigUInt64LE(BigInt(count), 24);
    rec.writeBigUInt64LE(BigInt(count), 32);
    rec.writeBigUInt64LE(BigInt(cdSize), 40);
    rec.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeUInt32LE(0, 4);
    loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    loc.writeUInt32LE(1, 16);
    parts.push(rec, loc);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, MAX16), 8);
  end.writeUInt16LE(Math.min(count, MAX16), 10);
  end.writeUInt32LE(needs64 ? MAX32 : cdSize, 12);
  end.writeUInt32LE(needs64 ? MAX32 : cdOffset, 16);
  parts.push(end);
  return parts.map((p) => new Uint8Array(p.buffer, p.byteOffset, p.length));
}

/**
 * The archive as a sequence of chunks. `zip64At` exists for tests; leave it
 * at its default (4 GB) otherwise.
 */
export async function* zipChunks(entries: AsyncIterable<ZipSource> | Iterable<ZipSource>, opts: { zip64At?: number; onSkip?: (name: string) => void } = {}) {
  const zip64At = opts.zip64At ?? MAX32;
  const written: Written[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for await (const e of entries) {
    const path = e.name.replace(/^\/+/, "");
    if (!path || seen.has(path)) {
      opts.onSkip?.(e.name);
      continue;
    }
    const raw = "data" in e ? (typeof e.data === "string" ? encoder.encode(e.data) : e.data) : await e.load();
    if (!raw) {
      opts.onSkip?.(e.name);
      continue;
    }
    if (raw.length >= MAX32) throw new Error(`File too large for the archive: ${e.name}`);
    seen.add(path);
    const method = e.compress ? 8 : 0;
    const body = method === 8 ? new Uint8Array(zlib.deflateRawSync(raw, { level: 6 })) : raw;
    const modified = e.modified ?? new Date();
    const { time, date } = dosDateTime(modified);
    const unix = Math.max(0, Math.floor(modified.getTime() / 1000));
    const entry: Written = { name: encoder.encode(path), crc: crc32(raw), csize: body.length, usize: raw.length, method, time, date, unix, offset };
    const header = localHeader(entry);
    yield header;
    for (let i = 0; i < body.length; i += CHUNK) yield body.subarray(i, i + CHUNK);
    written.push(entry);
    offset += header.length + body.length;
  }
  const cdOffset = offset;
  for (const w of written) {
    const h = centralHeader(w, zip64At);
    yield h;
    offset += h.length;
  }
  for (const part of endRecords(written.length, cdOffset, offset - cdOffset, zip64At)) yield part;
}

/** The archive as a web stream, for a Response. Pulled chunk by chunk, so memory stays flat. */
export function zipStream(entries: AsyncIterable<ZipSource> | Iterable<ZipSource>, opts: Parameters<typeof zipChunks>[1] = {}) {
  const it = zipChunks(entries, opts);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        console.error("[zip]", err);
        controller.error(err);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}
