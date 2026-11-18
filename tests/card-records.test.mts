// The two pieces `npm run cards` and `check` share without a browser: the PNG decoder that decides
// whether a fresh render is the same picture as the committed card, and the text of social-cards.txt
// (contracts/social-cards.md). The rules `check` builds on them are in tests/checker-rules.test.mts,
// and the render itself, which needs Chrome, in tests/cards.test.mts.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { decodePng, pixelDiff, pngSize, samePixels } from "../scripts/png.mts";
import { CARD_RECORDS_FILE, CARD_RECORDS_HEADER, parseCardRecords, renderCardRecords, type CardRecord } from "../scripts/card-records.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- a tiny PNG encoder, written from the spec, so the decoder is tested against something other than itself

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A PNG of `rows` (bytes per row, already in the colour type's layout), each row written with filter `filters[y]`. */
function encode(width: number, colour: number, channels: number, rows: number[][], filters: number[], extra: Buffer[] = [], level = 9): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(rows.length, 4);
  ihdr[8] = 8; ihdr[9] = colour;
  const raw: number[] = [];
  rows.forEach((row, y) => {
    const f = filters[y]!, up = y ? rows[y - 1]! : row.map(() => 0);
    raw.push(f);
    row.forEach((v, x) => {
      const a = x >= channels ? row[x - channels]! : 0, b = up[x]!, c = x >= channels ? up[x - channels]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      raw.push((v - pred) & 0xff);
    });
  });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra,
    chunk("IDAT", zlib.deflateSync(Buffer.from(raw), { level })), chunk("IEND", Buffer.alloc(0))]);
}

// 3×5 RGB, one row per filter type, values chosen so every predictor matters (and wraps past 255).
const RGB = [
  [10, 20, 30, 200, 210, 220, 255, 0, 128],
  [11, 22, 33, 199, 209, 219, 254, 1, 127],
  [250, 5, 60, 3, 250, 90, 128, 128, 128],
  [0, 255, 0, 255, 0, 255, 17, 34, 51],
  [90, 80, 70, 60, 50, 40, 30, 20, 10],
];

test("png: decodes every row filter of an RGB image to the pixels that were encoded", () => {
  const img = decodePng(encode(3, 2, 3, RGB, [0, 1, 2, 3, 4]));
  assert.deepEqual([img.width, img.height], [3, 5]);
  const want = RGB.flatMap((row) => [0, 1, 2].flatMap((x) => [...row.slice(3 * x, 3 * x + 3), 255]));
  assert.deepEqual([...img.rgba], want);
});

test("png: grey, grey with alpha, RGBA and palette images decode to RGBA", () => {
  assert.deepEqual([...decodePng(encode(2, 0, 1, [[7, 250]], [1])).rgba], [7, 7, 7, 255, 250, 250, 250, 255]);
  assert.deepEqual([...decodePng(encode(1, 4, 2, [[9, 128]], [0])).rgba], [9, 9, 9, 128]);
  assert.deepEqual([...decodePng(encode(1, 6, 4, [[1, 2, 3, 4], [5, 6, 7, 8]], [0, 2])).rgba], [1, 2, 3, 4, 5, 6, 7, 8]);
  const palette = chunk("PLTE", Buffer.from([255, 0, 0, 0, 0, 255])), trns = chunk("tRNS", Buffer.from([64]));
  assert.deepEqual([...decodePng(encode(2, 3, 1, [[1, 0]], [0], [palette, trns])).rgba], [0, 0, 255, 255, 255, 0, 0, 64]);
});

test("png: what it cannot decode throws, and is the same picture only as the very same bytes", () => {
  const sixteenBit = encode(1, 2, 3, [[1, 2, 3]], [0]);
  sixteenBit[24] = 16; // bit depth, in IHDR (the CRC no longer matches, which the decoder does not check)
  assert.throws(() => decodePng(sixteenBit), /unsupported PNG/);
  assert.throws(() => decodePng(Buffer.from("not a png")), /not a PNG/);
  assert.equal(pngSize(Buffer.from("not a png")), null);
  assert.equal(samePixels(sixteenBit, Buffer.from(sixteenBit)), true, "identical bytes are the same picture without decoding");
  assert.equal(samePixels(sixteenBit, encode(1, 2, 3, [[1, 2, 3]], [0])), false);
});

test("png: the same pixels in other bytes are the same picture; one channel of one pixel is not", () => {
  const a = encode(3, 2, 3, RGB, [0, 0, 0, 0, 0]);
  // Other filters, another compression level and a text chunk: every byte after IHDR differs.
  const b = encode(3, 2, 3, RGB, [4, 3, 2, 1, 0], [chunk("tEXt", Buffer.from("bh-card\0an old key", "latin1"))], 1);
  assert.ok(!a.equals(b), "the two encodings differ byte for byte");
  assert.equal(samePixels(a, b), true);
  const changed = RGB.map((row) => [...row]);
  changed[2]![4]! += 1;
  const c = encode(3, 2, 3, changed, [0, 0, 0, 0, 0]);
  assert.equal(samePixels(a, c), false);
  assert.deepEqual(pixelDiff(decodePng(a), decodePng(c)), { pixels: 1, maxDelta: 1 });
  assert.equal(pixelDiff(decodePng(a), decodePng(encode(1, 2, 3, [[1, 2, 3]], [0]))), null, "different sizes have no pixel difference");
});

test("png: a committed card decodes at 1200×630", () => {
  const dir = path.join(root, "docs/assets/og"), card = fs.readdirSync(dir).find((f) => f.endsWith(".png"));
  assert.ok(card, "there is a committed card");
  const img = decodePng(fs.readFileSync(path.join(dir, card)));
  assert.deepEqual([img.width, img.height, img.rgba.length], [1200, 630, 1200 * 630 * 4]);
});

// ---- social-cards.txt

const K = (ch: string) => ch.repeat(64);
const records = (entries: [string, CardRecord][]) => new Map(entries);

test("records: the canonical text is the header and one line per card in slug order, and parses back", () => {
  const text = renderCardRecords(records([["b-page", { key: K("1"), png: K("2") }], ["a-page", { key: "fallback", png: K("3") }]]));
  assert.equal(text, `${CARD_RECORDS_HEADER}\na-page fallback ${K("3")}\nb-page ${K("1")} ${K("2")}\n`);
  const back = parseCardRecords(text);
  assert.deepEqual(back.problems, []);
  assert.equal(renderCardRecords(back.records), text);
});

test("records: the committed file is in canonical form, outside the published directories", () => {
  const text = fs.readFileSync(path.join(root, CARD_RECORDS_FILE), "utf8");
  const parsed = parseCardRecords(text);
  assert.deepEqual(parsed.problems, []);
  assert.equal(renderCardRecords(parsed.records), text);
  // The deploy publishes what it copies into _site (index.html, docs/ and theme/): the records are in none of them.
  assert.equal(path.dirname(CARD_RECORDS_FILE), ".");
  const copies = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8").split("\n").filter((l) => /\bcp\b.*\b_site\//.test(l));
  assert.ok(copies.length >= 2, "the workflow assembles _site with cp");
  for (const l of copies) assert.doesNotMatch(l, /social-cards|\.txt\b|\s\.\s|\*/, `this copy could publish ${CARD_RECORDS_FILE}: ${l.trim()}`);
});

test("records: a conflict left in the file is reported line by line, and a slug on both sides is no record", () => {
  const ours = `a-page ${K("1")} ${K("2")}`, theirs = `a-page ${K("4")} ${K("2")}`;
  const text = `${CARD_RECORDS_HEADER}\n<<<<<<< HEAD\n${ours}\n=======\n${theirs}\n>>>>>>> 1234567 (Social cards: records)\nb-page ${K("5")} ${K("6")}\n`;
  const { records: got, problems } = parseCardRecords(text);
  assert.deepEqual([...got.keys()], ["b-page"]);
  const first = CARD_RECORDS_HEADER.split("\n").length + 1;
  assert.deepEqual(problems, [
    `line ${first} is not "<slug> <key> <png hash>": "<<<<<<< HEAD"`,
    `line ${first + 2} is not "<slug> <key> <png hash>": "======="`,
    `line ${first + 3} lists a-page again`,
    `line ${first + 4} is not "<slug> <key> <png hash>": ">>>>>>> 1234567 (Social cards: records)"`,
  ]);
});

test("records: a key or hash that is not 64 hex digits, or a fourth field, is not a record", () => {
  for (const line of [`a ${K("g")} ${K("1")}`, `a ${K("1")} fallback`, `a ${K("1")}`, `a ${K("1")} ${K("2")} extra`, `a ${K("A")} ${K("1")}`]) {
    const { records: got, problems } = parseCardRecords(line + "\n");
    assert.equal(got.size, 0, line);
    assert.equal(problems.length, 1, line);
  }
});
