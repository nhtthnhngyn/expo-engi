/**
 * Minimal, fully deterministic ZIP reader/writer.
 *
 * A `.docx`/`.dotx` is a ZIP container. We hand-roll it rather than pulling in a zip library for
 * one reason: **determinism** (NFR in spec section 3). Third-party zippers stamp `new Date()` into
 * every local file header, which makes byte-identical re-export impossible. Here every entry gets a
 * fixed DOS timestamp, entries are written in the caller's order, and the compression level is
 * pinned — so the same parts always produce the same bytes.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

/** 1980-01-01 00:00:00 in DOS date/time format — the ZIP epoch. Fixed for determinism. */
const DOS_EPOCH_TIME = 0;
const DOS_EPOCH_DATE = 0x0021;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Pinned so the deflate stream for a given input is always the same bytes. */
const DEFLATE_LEVEL = 9;

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** Store (no compression) instead of deflate. Used for `mimetype`-style parts if ever needed. */
  store?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]!) & 0xff]!;
  }
  return (c ^ -1) >>> 0;
}

/**
 * Writes a ZIP archive. Output depends only on the entries passed in — no clock, no locale, no
 * filesystem state.
 */
export function zipWrite(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const useStore = entry.store === true;
    const compressed = useStore ? entry.data : deflateRawSync(entry.data, { level: DEFLATE_LEVEL });
    const method = useStore ? METHOD_STORE : METHOD_DEFLATE;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags — no UTF-8 bit; names are ASCII in OOXML
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_EPOCH_TIME, 10);
    local.writeUInt16LE(DOS_EPOCH_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(local, 30);

    localChunks.push(local, compressed);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_EPOCH_TIME, 12);
    central.writeUInt16LE(DOS_EPOCH_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralChunks.push(central);

    offset += local.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

/** Reads a ZIP archive into a name -> bytes map, preserving central-directory order in `names`. */
export function zipRead(buf: Buffer): { files: Map<string, Buffer>; names: string[] } {
  const eocdOffset = findEocd(buf);
  if (eocdOffset < 0) throw new Error('Not a ZIP archive: end-of-central-directory record not found');

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  let ptr = buf.readUInt32LE(eocdOffset + 16);

  const files = new Map<string, Buffer>();
  const names: string[] = [];

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== SIG_CENTRAL) throw new Error(`Corrupt ZIP: bad central header at ${ptr}`);
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === METHOD_STORE) data = Buffer.from(raw);
    else if (method === METHOD_DEFLATE) data = inflateRawSync(raw);
    else throw new Error(`Unsupported ZIP compression method ${method} for entry ${name}`);

    files.set(name, data);
    names.push(name);
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return { files, names };
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}
