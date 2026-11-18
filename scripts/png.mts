// Reading PNG files with no dependencies: the size from the header, and the pixels, so `npm run cards`
// can tell whether a fresh render shows the same picture as the committed card (contracts/social-cards.md).
// It decodes what Chrome's screenshots are (8-bit, non-interlaced, grey, RGB, palette or with alpha);
// anything else throws, and a caller that only wants to know "same picture?" treats that as "no".
//
// This file does not draw a card, so it is not one of the card's staleness inputs.

import zlib from "node:zlib";

/** A PNG's size, read from its IHDR. */
export interface PngSize { width: number; height: number }

/** Decoded pixels: `rgba` holds width × height × 4 bytes, row by row. */
export interface PngImage extends PngSize { rgba: Buffer }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The size of a PNG, or null when `b` does not start like one. */
export function pngSize(b: Buffer): PngSize | null {
  if (b.length < 33 || !b.subarray(0, 8).equals(SIGNATURE) || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** The chunks of a PNG, in order, up to and including IEND. */
function chunks(b: Buffer): { type: string; data: Buffer }[] {
  const out: { type: string; data: Buffer }[] = [];
  for (let p = 8; p + 12 <= b.length;) {
    const len = b.readUInt32BE(p), type = b.toString("ascii", p + 4, p + 8);
    if (p + 12 + len > b.length) throw new Error(`truncated ${type} chunk`);
    out.push({ type, data: b.subarray(p + 8, p + 8 + len) });
    if (type === "IEND") return out;
    p += 12 + len;
  }
  throw new Error("no IEND chunk");
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Undo the per-row filters (PNG spec, section 9) in place; `bpp` is bytes per pixel. */
function unfilter(raw: Buffer, height: number, stride: number, bpp: number): Buffer {
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp]! : 0, up = y ? out[prev + x]! : 0, c = x >= bpp && y ? out[prev + x - bpp]! : 0;
      let v = raw[src + x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      } else if (filter !== 0) throw new Error(`unknown row filter ${filter}`);
      out[row + x] = v & 0xff;
    }
  }
  return out;
}

/** The pixels of an 8-bit, non-interlaced PNG as RGBA. Throws on anything else. */
export function decodePng(b: Buffer): PngImage {
  const size = pngSize(b);
  if (!size) throw new Error("not a PNG");
  const list = chunks(b), ihdr = list[0]!.data;
  const depth = ihdr[8]!, colour = ihdr[9]!, interlace = ihdr[12]!;
  const channels = CHANNELS[colour];
  if (depth !== 8 || !channels || interlace !== 0) throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${colour}, interlace ${interlace})`);
  const { width, height } = size, stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(list.filter((c) => c.type === "IDAT").map((c) => c.data)));
  if (raw.length !== height * (stride + 1)) throw new Error("the image data is not the size the header says");
  const px = unfilter(raw, height, stride, channels);
  const palette = list.find((c) => c.type === "PLTE")?.data, trns = list.find((c) => c.type === "tRNS")?.data;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < px.length; i += channels, o += 4) {
    if (colour === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[i]!; rgba[o + 3] = 255; }
    else if (colour === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[i]!; rgba[o + 3] = px[i + 1]!; }
    else if (colour === 2) { rgba[o] = px[i]!; rgba[o + 1] = px[i + 1]!; rgba[o + 2] = px[i + 2]!; rgba[o + 3] = 255; }
    else if (colour === 6) px.copy(rgba, o, i, i + 4);
    else {
      const k = px[i]!;
      if (!palette || 3 * k + 2 >= palette.length) throw new Error("palette index out of range");
      palette.copy(rgba, o, 3 * k, 3 * k + 3);
      rgba[o + 3] = trns && k < trns.length ? trns[k]! : 255;
    }
  }
  return { width, height, rgba };
}

/** How two pictures differ: how many pixels differ at all, and the largest difference in any one channel (0–255). */
export interface PixelDiff { pixels: number; maxDelta: number }

/** The difference between two decoded pictures of the same size, or null when their sizes differ. */
export function pixelDiff(a: PngImage, b: PngImage): PixelDiff | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  let pixels = 0, maxDelta = 0;
  for (let o = 0; o < a.rgba.length; o += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a.rgba[o + k]! - b.rgba[o + k]!));
    if (d) { pixels++; if (d > maxDelta) maxDelta = d; }
  }
  return { pixels, maxDelta };
}

/** Whether two PNG files show exactly the same pixels (their bytes, metadata and compression may differ). False when either cannot be decoded. */
export function samePixels(a: Buffer, b: Buffer): boolean {
  if (a.equals(b)) return true;
  try {
    const d = pixelDiff(decodePng(a), decodePng(b));
    return d !== null && d.pixels === 0;
  } catch { return false; }
}
