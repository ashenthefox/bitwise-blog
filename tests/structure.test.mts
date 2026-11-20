// structure.mjs scores a page on SlopShape's core structural features (#369). These tests pin the
// parts that decide every reported number: parsing a judge's reply, the majority over runs, the
// AI-shape count, what is stripped before judging, and the CLI's refusal of bad arguments.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FEATURES, SHORT_WORDS, aiShape, isPage, majority, parse, pool, withoutTemplate } from "../.claude/skills/pedagogical-writing/scripts/structure.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, ".claude/skills/pedagogical-writing/scripts/structure.mjs");

test("majority: two of three agree, a three-way split is split, none answered is unknown", () => {
  assert.equal(majority(["yes", "yes", "no"]), "yes");
  assert.equal(majority(["yes", "no", null]), "split");
  assert.equal(majority(["a", "b", "c"]), "split");
  assert.equal(majority(["yes", null, null]), "yes");
  assert.equal(majority([null, null, null]), "unknown");
});

test("parse: keeps valid option keys, nulls an unknown key or a missing feature, tolerates prose around the JSON", () => {
  const reply = `Here you go:\n{"features": {"conclusion": "restates", "freshness": "maybe"}, "evidence": {"conclusion": "In short"}}\nDone.`;
  const p = parse(reply);
  assert.ok(p);
  const got = p.features as Record<string, string | null>;
  assert.equal(got.conclusion, "restates");
  assert.equal(got.freshness, null, "an answer outside the option set is not kept");
  assert.equal(got["thesis-first"], null, "a missing feature is null");
  assert.equal(parse("no json here"), null);
});

test("aiShape: counts model-leaning values, skips split and unknown, and always counts length", () => {
  const features = Object.fromEntries(FEATURES.map(f => [f.id, f.ai]));
  assert.deepEqual(aiShape({ features, words: SHORT_WORDS }), { n: 10, of: 10 });
  assert.deepEqual(aiShape({ features, words: SHORT_WORDS - 1 }), { n: 9, of: 10 }, "a short text leans human");
  const mixed = { ...features, conclusion: "split", freshness: "unknown", "historical-dates": "yes" };
  assert.deepEqual(aiShape({ features: mixed, words: 100 }), { n: 6, of: 8 });
});

test("withoutTemplate: drops the Discuss callout and the footer, keeps the article's own text", () => {
  const src = `<article><p>The point.</p><aside class="callout no-glossary" id="discuss" data-linkable data-discuss><p>Discuss this post</p></aside><footer class="bh-footer"><span>All documents</span></footer></article>`;
  const out = withoutTemplate(src);
  assert.match(out, /The point\./);
  assert.doesNotMatch(out, /Discuss this post/);
  assert.doesNotMatch(out, /All documents/);
});

test("isPage: decided by extension, so a Markdown draft that quotes <article> stays text", () => {
  assert.equal(isPage("docs/a.html"), true);
  assert.equal(isPage("drafts/a.md"), false);
});

test("pool: runs at most `jobs` at once and keeps input order", async () => {
  let live = 0, peak = 0;
  const out = await pool([30, 10, 20, 5], 2, async (ms: number) => {
    live++; peak = Math.max(peak, live);
    await new Promise(r => setTimeout(r, ms));
    live--;
    return ms;
  });
  assert.deepEqual(out, [30, 10, 20, 5]);
  assert.equal(peak, 2);
});

test("the CLI exits 2 on a missing --runs value or a missing file, before starting any judge", () => {
  for (const args of [["docs/token-bucket-rate-limiting.html", "--runs"], ["docs/token-bucket-rate-limiting.html", "--runs", "0"], ["no-such-file.html"]]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
  }
});
