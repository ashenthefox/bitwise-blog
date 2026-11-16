import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pageStats, scriptChecks } from "../.claude/skills/pedagogical-writing/scripts/page-stats.mjs";
import { blobId, buildPrompt, decodeOnce, extract, parseReply, quoteInSection, readCriteria, scorecardMarkdown, splitArgs, stable, validate, withoutExamples } from "../.claude/skills/pedagogical-writing/scripts/grade.mjs";
import { applyEdit, materialize, readRefs, score } from "../.claude/skills/pedagogical-writing/scripts/calibrate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, ".claude/skills/pedagogical-writing");
const GRADE = path.join(SKILL, "scripts/grade.mjs");
const STATS = path.join(SKILL, "scripts/page-stats.mjs");
const CALIBRATE = path.join(SKILL, "scripts/calibrate.mjs");
const IDS = ["opening-need", "one-idea", "need-before-name", "promises-paid", "examples-first", "figures-earn",
  "reader-checks", "sentences-carry", "companion-voice", "one-concept", "ending-payoff"];

// A small teaching page: a TL;DR of `bullets` bullets, two sections, a figure and `predicts` predict folds.
function page(bullets = 3, predicts = 1): string {
  const li = Array.from({ length: bullets }, (_, k) => `<li>Point ${k + 1}.</li>`).join("");
  const fold = `<details class="predict"><summary>How many? Decide before you open this.</summary><p>Twenty, because the window resets.</p></details>`;
  return `<!doctype html><html><head><title>t</title><script>var noise = 1;</script></head><body>
<article class="bh-article">
<header class="bh-hero"><h1>Counting requests</h1></header>
<div class="tldr"><ul>${li}</ul></div>
<h2 id="the-need">What a limiter must allow</h2>
<p>Suppose 200 clients share a backend that serves 2,000 requests per second. For now, ignore retries.</p>
${Array.from({ length: predicts }, () => fold).join("")}
<h2 id="the-fix">The fix: <em>save up</em> what you don't use</h2>
<p>A bucket holds tokens, and you spend one per request.</p>
<figure id="bucket"><svg role="img" aria-label="A bucket under a tap"><text>secret label</text></svg><figcaption>Notice the spill.</figcaption></figure>
<pre><code>let x = 1;</code></pre>
</article></body></html>`;
}

// Every scratch directory goes under one root, removed when the file's tests end.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "grade-page-"));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
function tmp(): string { return fs.mkdtempSync(path.join(TMP, "t-")); }

// A stand-in judge: reads the prompt on stdin, takes the criterion id from it, and answers from
// FAKE_PLAN[id] (or FAKE_PLAN["*"]): { reply } printed as is, { json } printed as JSON, or { exit }.
// It exits 7 unless it is running beside a copy of the page, away from the repo, with the same
// prompt in GRADE_PROMPT_FILE.
const FAKE_JUDGE = `
const fs = require("fs"), path = require("path");
const prompt = fs.readFileSync(0, "utf8");
const id = /## Criterion \`([a-z0-9-]+)\`/.exec(prompt)[1];
const page = /^Page: ([^.\\s]+\\.html)\\./m.exec(prompt)[1];
if (!fs.existsSync(page) || fs.existsSync("evals") || fs.existsSync(".claude") || fs.readFileSync(process.env.GRADE_PROMPT_FILE, "utf8") !== prompt) process.exit(7);
const plan = JSON.parse(process.env.FAKE_PLAN);
const p = plan[id] ?? plan["*"];
if (p.exit) { process.stderr.write("boom\\n"); process.exit(p.exit); }
const fill = s => s.replaceAll("$ID", id);
if (p.reply !== undefined) process.stdout.write(fill(p.reply));
else process.stdout.write(fill(JSON.stringify(p.json)));
`;

const MET = { criterion: "$ID", verdict: "met", evidence: [{ section: "the-need", quote: "Suppose 200 clients share a backend" }], reason: "ok" };

function grade(file: string, plan: Record<string, unknown>, ...extra: string[]): { card: any; out: string; status: number | null } {
  const dir = tmp();
  const judge = path.join(dir, "judge.cjs");
  fs.writeFileSync(judge, FAKE_JUDGE);
  const json = path.join(dir, "card.json");
  const judges = extra.includes("--judge") ? [] : ["--judge", `node ${judge}`];
  const args = [GRADE, file, ...judges, ...extra.map(a => a.replace("$JUDGE", judge)), "--out", json];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: ROOT, env: { ...process.env, FAKE_PLAN: JSON.stringify(plan) }, timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  return { card: JSON.parse(fs.readFileSync(json, "utf8")), out: r.stdout, status: r.status };
}

function writePage(src = page()): string {
  const f = path.join(tmp(), "page.html");
  fs.writeFileSync(f, src);
  return f;
}

test("page-stats --json decides the script checks", () => {
  const ok = scriptChecks(pageStats(page(3, 1)));
  const by = (cs: any[], id: string) => cs.find(c => c.id === id);
  assert.equal(by(ok, "tldr-bullets").status, "pass");
  assert.equal(by(ok, "predict-folds").status, "pass");
  assert.equal(by(ok, "voice-iqr").status, "warn", "a tiny page is outside the 3Blue1Brown ranges");
  assert.deepEqual(by(ok, "promise-phrases").items, [{ section: "the-need", phrase: "For now" }]);

  const bad = scriptChecks(pageStats(page(4, 0)));
  assert.equal(by(bad, "tldr-bullets").status, "fail");
  assert.equal(by(bad, "predict-folds").status, "fail");
  assert.equal(by(scriptChecks(pageStats(page().replace(/<div class="tldr">[\s\S]*?<\/div>/, ""))), "tldr-bullets").detail, "the page has no .tldr");

  const r = spawnSync(process.execPath, [STATS, "--json", writePage()], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.sections.map((s: any) => s.id), ["(top)", "the-need", "the-fix"]);
  assert.ok(j.checks.length >= 4);
  // The text report is unchanged in shape.
  const t = spawnSync(process.execPath, [STATS, writePage()], { encoding: "utf8" });
  assert.match(t.stdout, /^## Sections$/m);
  assert.match(t.stdout, /#the-need: …/);
});

test("the extract keeps prose, ids and accessible names, and drops scripts and SVG internals", () => {
  const ex = extract(page());
  assert.match(ex.text, /^## What a limiter must allow \{#the-need\}$/m);
  assert.match(ex.text, /The fix: save up what you don't use \{#the-fix\}/, "inline tags vanish without leaving gaps");
  assert.match(ex.text, /\[diagram: A bucket under a tap\]/);
  assert.match(ex.text, /\[predict fold\] How many\?/);
  assert.match(ex.text, /caption: Notice the spill\./);
  assert.doesNotMatch(ex.text, /secret label|var noise/);
  assert.deepEqual(ex.sections.map((s: any) => s.id), ["top", "the-need", "the-fix"]);
  assert.equal(ex.ids.get("bucket"), "the-fix", "a figure id maps to the h2 section it sits in");
  assert.ok(quoteInSection(ex, "the-need", "Suppose 200 clients … 2,000 requests per second"), "an ellipsis joins pieces in order");
  assert.ok(!quoteInSection(ex, "the-fix", "Suppose 200 clients"), "a quote must be in the section it names");
});

test("grading.md holds the eleven criteria, and judges get them without their examples", () => {
  const cs = readCriteria();
  assert.deepEqual(cs.map((c: any) => c.id), IDS);
  for (const c of cs) {
    assert.match(c.body, /\*\*Met:\*\*/, c.id);
    assert.match(c.body, /\*\*Not met:\*\*/, c.id);
    assert.match(c.body, /\*\*Unknown:\*\*/, c.id);
    assert.match(c.body, /\*\*Evidence:\*\*/, c.id);
    assert.match(c.body, /Example:|Illustrative:/, `${c.id} has an example`);
    const stripped = withoutExamples(c.body);
    assert.doesNotMatch(stripped, /Example:|Illustrative:/, c.id);
    assert.ok(stripped.length > 200, `${c.id} keeps its tests`);
  }
  const prompt = buildPrompt({ criterion: cs[0], reader: "a newcomer", page: "p.html", checks: [], ex: extract(page()) });
  assert.doesNotMatch(prompt, /Example:/);
  assert.match(prompt, /Target reader: a newcomer/);
  assert.match(prompt, /<<<PAGE EXTRACT[\s\S]*Suppose 200 clients[\s\S]*PAGE EXTRACT>>>/);
});

test("validate turns anything unchecked into unknown", () => {
  const ex = extract(page());
  const c = { id: "opening-need", statement: "", body: "" };
  const v = (reply: unknown) => validate(reply, c, ex);
  assert.equal(v({ verdict: "met", evidence: [{ section: "#the-need", quote: "Suppose 200 clients" }] }).verdict, "met", "a leading # is accepted");
  assert.match(v(null).reason, /no JSON verdict/);
  assert.match(v({ verdict: "great" }).reason, /is not met, not_met or unknown/);
  assert.match(v({ verdict: "met", evidence: [] }).reason, /without evidence/);
  assert.match(v({ verdict: "met", evidence: [{ section: "nowhere", quote: "Suppose" }] }).reason, /not on the page/);
  assert.match(v({ verdict: "met", evidence: [{ section: "the-need", quote: "words the page never says" }] }).reason, /quote not found/);
  assert.match(v({ verdict: "not_met", evidence: [{ section: "the-need", quote: "Suppose" }] }).reason, /without a gap/);
  assert.match(v({ criterion: "one-idea", verdict: "met", evidence: [{ section: "the-need", quote: "Suppose" }] }).reason, /not "opening-need"/);
  assert.equal(v({ verdict: "unknown", evidence: [] }).verdict, "unknown");
});

test("parseReply finds the verdict object in a chatty or fenced reply; splitArgs honours quotes", () => {
  assert.equal(parseReply('Sure.\n```json\n{"verdict": "met", "evidence": [{"section": "a", "quote": "{x}"}]}\n```\nDone.').verdict, "met");
  assert.equal(parseReply("no json here"), null);
  assert.deepEqual(splitArgs(`node "/a b/j.cjs" --x 'y z'`), ["node", "/a b/j.cjs", "--x", "y z"]);
});

test("grade.mjs: valid verdicts give a scorecard of met out of judged", () => {
  const { card, out } = grade(writePage(), { "*": { json: MET } });
  assert.equal(card.total, 11);
  assert.equal(card.met, 11);
  assert.equal(card.judged, 11);
  assert.match(out, /\*\*11 of 11 criteria met\*\* \(0 unknown\)/);
  assert.match(out, /`tldr-bullets` \*\*pass\*\*/);
  assert.doesNotMatch(out, /\b\d+\/10\b|out of 10/, "no 1–10 number");
});

test("grade.mjs: a bad quote, a non-JSON reply and a failed judge are unknown, and a miss carries its gap", () => {
  const plan = {
    "*": { json: MET },
    "one-idea": { json: { ...MET, evidence: [{ section: "the-need", quote: "a sentence nobody wrote" }] } },
    "promises-paid": { reply: "I think it is fine." },
    "examples-first": { exit: 1 },
    "ending-payoff": { json: { criterion: "$ID", verdict: "not_met", evidence: [{ section: "the-fix", quote: "A bucket holds tokens" }], gap: "Return to the 200 clients at the end." } },
  };
  const { card, out } = grade(writePage(), plan);
  const r = (id: string) => card.results.find((x: any) => x.id === id);
  assert.equal(r("one-idea").verdict, "unknown");
  assert.match(r("one-idea").reason, /quote not found/);
  assert.equal(r("promises-paid").verdict, "unknown");
  assert.match(r("promises-paid").reason, /no JSON verdict/);
  assert.equal(r("examples-first").verdict, "unknown");
  assert.match(r("examples-first").reason, /judge failed \(exit 1\): boom/);
  assert.equal(r("ending-payoff").verdict, "not_met");
  assert.equal(card.met, 7);
  assert.equal(card.judged, 8);
  assert.match(out, /Gap: Return to the 200 clients at the end\./);
});

test("grade.mjs: claude's JSON wrapper is unwrapped, its cost summed, and an error reply is unknown", () => {
  const wrap = (result: string, isError = false) => ({ reply: JSON.stringify({ result, is_error: isError, total_cost_usd: 0.25 }) });
  const { card } = grade(writePage(), {
    "*": wrap(JSON.stringify(MET)),
    "one-concept": wrap("API Error: 529 overloaded", true),
  });
  assert.equal(card.results.find((x: any) => x.id === "one-concept").verdict, "unknown");
  assert.match(card.results.find((x: any) => x.id === "one-concept").reason, /error reply.*529/);
  assert.equal(card.met, 10);
  assert.equal(card.costUsd, 2.75);
});

test("grade.mjs: two judges that disagree, or runs that disagree, give unknown", () => {
  const dir = tmp();
  const notMet = { criterion: "$ID", verdict: "not_met", evidence: [{ section: "the-need", quote: "Suppose" }], gap: "Fix it." };
  // Judge B is the same fake with a different plan, chosen by an env var set inline through `env`.
  const b = path.join(dir, "b.cjs");
  fs.writeFileSync(b, `process.env.FAKE_PLAN = ${JSON.stringify(JSON.stringify({ "*": { json: MET }, "one-idea": { json: notMet } }))};\n${FAKE_JUDGE}`);
  const { card } = grade(writePage(), { "*": { json: MET } }, "--judge", "node $JUDGE", "--judge", `node ${b}`, "--only", "one-idea,opening-need");
  assert.equal(card.total, 2);
  const oneIdea = card.results.find((x: any) => x.id === "one-idea");
  assert.equal(oneIdea.verdict, "unknown");
  assert.match(oneIdea.reason, /disagree \(1 met, 1 not_met\)/);
  assert.equal(card.results.find((x: any) => x.id === "opening-need").verdict, "met");

  const runs = grade(writePage(), { "*": { json: MET } }, "--runs", "3", "--only", "opening-need").card;
  assert.equal(runs.results[0].calls.length, 3);
  assert.equal(Object.values(runs.stability)[0], 1);
});

test("grade.mjs --extract runs no judge, and bad options exit 2", () => {
  const r = spawnSync(process.execPath, [GRADE, writePage(), "--extract", "--judge", "false"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\{#the-need\}/);
  const bad = spawnSync(process.execPath, [GRADE, writePage(), "--runs", "0"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  const only = spawnSync(process.execPath, [GRADE, writePage(), "--only", "no-such", "--judge", "false"], { encoding: "utf8" });
  assert.equal(only.status, 2);
  assert.match(only.stderr, /unknown criterion ids: no-such/);
});

test("calibration references are well formed, and edits must match exactly once", () => {
  const refs = readRefs();
  assert.ok(refs.length >= 4, "three to five pages plus a broken copy");
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, r.page)), r.name);
    assert.deepEqual(Object.keys(r.grades).sort(), [...IDS].sort(), `${r.name} grades every criterion`);
    for (const [id, g] of Object.entries(r.grades) as [string, any][]) assert.ok(["met", "not_met"].includes(g.verdict), `${r.name} ${id}`);
    assert.match(r.blob, /^[0-9a-f]{40}$/, r.name);
    assert.match(r.graded_by, /Claude Opus 5\.5/);
  }
  const broken = refs.find((r: any) => r.edits?.length);
  assert.ok(broken, "there is a broken copy");
  const broke = new Set(broken.edits.map((e: any) => e.breaks));
  for (const id of broke) assert.equal(broken.grades[id as string].verdict, "not_met", `${id} is graded as broken`);

  assert.equal(applyEdit("a b c", { find: "b", replace: "x" }), "a x c");
  assert.equal(applyEdit("a [cut] b", { from: "[", to: "b", replace: "" }), "a b");
  assert.throws(() => applyEdit("a b", { find: "z", replace: "x", breaks: "one-idea" }), /one-idea: find not found/);
  assert.throws(() => applyEdit("b b", { find: "b", replace: "x" }), /more than once/);

  // The broken copy rebuilds from the working tree, and its edits change the page.
  const out = tmp();
  const r = spawnSync(process.execPath, [CALIBRATE, "--materialize", broken.name, out], { encoding: "utf8", cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  const src = fs.readFileSync(path.join(out, path.basename(broken.page)), "utf8");
  assert.notEqual(src, fs.readFileSync(path.join(ROOT, broken.page), "utf8"));
});

test("score: per-run agreement, agreement on misses, and the broken-copy test", () => {
  const ref = { grades: { a: { verdict: "met" }, b: { verdict: "not_met" } }, edits: [{ breaks: "b" }] };
  const call = (verdict: string) => ({ verdict });
  const card = { runs: 2, judges: ["j"], results: [
    { id: "a", calls: [call("met"), call("not_met")] },
    { id: "b", calls: [call("not_met"), call("not_met")] },
  ] };
  const s = score(card, ref);
  assert.deepEqual(s.all, { agree: 3, of: 4 });
  assert.deepEqual(s.misses, { agree: 2, of: 2 });
  assert.deepEqual(s.exact, [true, false], "run 2 also failed a, so it did not fail exactly the broken criteria");
  assert.deepEqual(s.stable, { same: 1, of: 2 });

  // A miss the page had before the edits (c) counts neither way; a broken criterion that passes does.
  const ref2 = { grades: { a: { verdict: "met" }, b: { verdict: "not_met" }, c: { verdict: "not_met" } }, edits: [{ breaks: "b" }] };
  const card2 = { runs: 3, judges: ["j"], results: [
    { id: "a", calls: [call("met"), call("unknown"), call("met")] },
    { id: "b", calls: [call("not_met"), call("not_met"), call("met")] },
    { id: "c", calls: [call("met"), call("not_met"), call("not_met")] },
  ] };
  assert.deepEqual(score(card2, ref2).exact, [true, true, false]);
});

test("the extract survives escaped markup in code, and data-id is not a section", () => {
  const src = page().replace("<pre><code>let x = 1;</code></pre>",
    `<pre><code>if sym &lt; 256: emit(sym)</code></pre>\n<h2 id="after">After the code</h2>\n<p>This paragraph must survive.</p>\n<svg><g data-id="refill"></g></svg>`);
  const ex = extract(src);
  assert.match(ex.text, /if sym < 256: emit\(sym\)/, "the code keeps its text");
  assert.match(ex.text, /^## After the code \{#after\}$/m, "the heading after it is not swallowed");
  assert.match(ex.text, /This paragraph must survive\./);
  assert.deepEqual(ex.sections.map((s: any) => s.id), ["top", "the-need", "the-fix", "after"]);
  assert.equal(ex.ids.has("refill"), false, "an SVG data-id is not a section id");
  assert.equal(decodeOnce("&amp;lt; &#8212; &mdash; &rsquo;"), "&lt; — — ’", "entities decode once");
});

test("parseReply skips braces inside strings; validate takes (top) and records each quote's h2", () => {
  const reply = 'Here: {"verdict": "met", "evidence": [{"section": "the-fix", "quote": "if (tokens > 0) {"}], "reason": "a } and a {"}';
  assert.equal(parseReply(reply)?.evidence[0].quote, "if (tokens > 0) {");
  const ex = extract(page());
  const c = { id: "opening-need", statement: "", body: "" };
  assert.equal(validate({ verdict: "met", evidence: [{ section: "(top)", quote: "Point 1." }] }, c, ex).verdict, "met");
  const v = validate({ verdict: "not_met", evidence: [{ section: "bucket", quote: "Notice the spill." }], gap: "g" }, c, ex);
  assert.equal(v.verdict, "not_met");
  assert.equal(v.evidence[0].h2, "the-fix", "a figure id is placed in its h2");
});

test("the biggest leap is the earliest miss by h2, even when a figure is cited", () => {
  const card = { page: "p", judges: ["j"], runs: 1, date: "d", met: 9, judged: 11, total: 11, rubric: "0123456789ab", order: ["top", "the-need", "the-fix", "later"], checks: [],
    results: [
      { id: "one-idea", statement: "s", verdict: "not_met", evidence: [{ section: "later", h2: "later", quote: "q" }], gap: "late gap", reason: "", calls: [] },
      { id: "need-before-name", statement: "s", verdict: "not_met", evidence: [{ section: "bucket", h2: "the-need", quote: "q" }], gap: "early gap", reason: "", calls: [] },
    ] };
  assert.match(scorecardMarkdown(card), /Biggest leap.*`need-before-name` at #bucket: early gap/);
});

test("stability leaves out judges that never ran", () => {
  const ok = (verdict: string) => ({ verdict }), failed = { verdict: "unknown", failed: true };
  assert.deepEqual(stable([[failed, failed, failed], [failed, failed, failed]]), { same: 0, of: 0 }, "a judge that never ran is not stable");
  assert.deepEqual(stable([[ok("met"), ok("met"), failed], [ok("met"), ok("not_met"), ok("met")], [ok("met"), failed, failed]]), { same: 1, of: 2 });
});

test("a pinned reference falls back to the working tree only if the page is unchanged", () => {
  const live = fs.readFileSync(path.join(ROOT, "docs/token-bucket-rate-limiting.html"));
  const ref = { name: "x", page: "docs/token-bucket-rate-limiting.html", rev: "0000000000", pageBlob: blobId(live) };
  assert.equal(materialize(ref, ROOT), live.toString("utf8"), "no such commit, unchanged page: use it");
  assert.throws(() => materialize({ ...ref, pageBlob: "f".repeat(40) }, ROOT), /not in this clone.*has changed since/);
  for (const r of readRefs()) assert.match(r.rev, /^[0-9a-f]{7,40}$/, `${r.name} pins a commit`);
  const bad = spawnSync(process.execPath, [CALIBRATE, "-j", "0"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /positive whole numbers/);
});
