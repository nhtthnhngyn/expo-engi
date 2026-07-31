/**
 * Image intake for figures.
 *
 * Two sources are supported: a `data:` URI (self-contained, the common case for editor content)
 * and a filesystem path resolved against an explicit base directory. A remote URL is deliberately
 * **not** fetched — an export must be reproducible and must not make network calls mid-render, so a
 * remote figure degrades to its caption/alt text instead.
 *
 * Dimensions are sniffed from the file header so the drawing gets a correct aspect ratio without a
 * decoding dependency.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const EMU_PER_PIXEL = 9525;
/** 6.5in of content width on US Letter with 1in margins. */
export const MAX_CONTENT_WIDTH_EMU = 5943600;

export interface LoadedImage {
  bytes: Buffer;
  extension: 'png' | 'jpeg' | 'gif' | 'bmp';
  widthPx: number;
  heightPx: number;
}

const DEFAULT_SIZE = { widthPx: 600, heightPx: 400 };

export function loadImage(src: string, baseDir?: string): LoadedImage | null {
  const bytes = readBytes(src, baseDir);
  if (!bytes) return null;
  const extension = sniffExtension(bytes);
  if (!extension) return null;
  const size = sniffSize(bytes, extension) ?? DEFAULT_SIZE;
  return { bytes, extension, widthPx: size.widthPx, heightPx: size.heightPx };
}

function readBytes(src: string, baseDir?: string): Buffer | null {
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',');
    if (comma < 0) return null;
    const header = src.slice(5, comma);
    const payload = src.slice(comma + 1);
    if (header.endsWith(';base64')) return Buffer.from(payload, 'base64');
    return Buffer.from(decodeURIComponent(payload), 'binary');
  }
  if (/^https?:\/\//i.test(src)) return null; // never fetched — see module docblock
  if (!baseDir) return null;
  const path = isAbsolute(src) ? src : resolve(baseDir, src);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

function sniffExtension(bytes: Buffer): LoadedImage['extension'] | null {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes.length >= 6 && bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString('ascii') === 'BM') return 'bmp';
  return null;
}

function sniffSize(bytes: Buffer, extension: LoadedImage['extension']): { widthPx: number; heightPx: number } | null {
  try {
    if (extension === 'png' && bytes.length >= 24) {
      return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) };
    }
    if (extension === 'gif' && bytes.length >= 10) {
      return { widthPx: bytes.readUInt16LE(6), heightPx: bytes.readUInt16LE(8) };
    }
    if (extension === 'bmp' && bytes.length >= 26) {
      return { widthPx: bytes.readInt32LE(18), heightPx: Math.abs(bytes.readInt32LE(22)) };
    }
    if (extension === 'jpeg') return sniffJpeg(bytes);
  } catch {
    return null;
  }
  return null;
}

function sniffJpeg(bytes: Buffer): { widthPx: number; heightPx: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // SOF0–SOF15, excluding the non-frame markers DHT (c4), JPG (c8) and DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { heightPx: bytes.readUInt16BE(offset + 5), widthPx: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

/** Scales an image to fit the content width, preserving aspect ratio. Returns EMUs. */
export function fitToContentWidth(image: LoadedImage): { cx: number; cy: number } {
  const cx = image.widthPx * EMU_PER_PIXEL;
  const cy = image.heightPx * EMU_PER_PIXEL;
  if (cx <= MAX_CONTENT_WIDTH_EMU) return { cx, cy };
  const scale = MAX_CONTENT_WIDTH_EMU / cx;
  return { cx: MAX_CONTENT_WIDTH_EMU, cy: Math.round(cy * scale) };
}
