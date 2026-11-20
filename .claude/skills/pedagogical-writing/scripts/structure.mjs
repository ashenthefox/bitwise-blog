#!/usr/bin/env node
// Usage: node structure.mjs <page.html | draft.md>… [--judge spec] [--runs n] [--json file]
//
// Scores a page or draft on the core structural features that SlopShape (arXiv 2609.15369)
// found tell model-written blog posts from human ones in all five models it tested: the
// "tidy, self-announcing" shape. The features are this script's paraphrase of the paper's
// Table 6, not its released instrument (which has no stated licence). One judge call per run
// answers all nine judged features; length is counted. A feature that runs disagree on is
// "split". The AI-shape count is how many of the ten values lean the way model posts did.
// It measures resemblance to that shape, not quality: an explainer is expected to explain a
// mechanism, and a summary can be right for a reader.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract, judgeCommand, runJudge, unwrap, DEFAULT_JUDGE } from "./grade.mjs";
import { isHtml, pageStats } from "./page-stats.mjs";

// id, question, options, and the value model posts leaned towards (paper, Table 6).
export const FEATURES = [
  { id: "conclusion", q: "How does the piece end?", options: { restates: "it restates or reframes its thesis, or summarises what it said", other: "anything else: a next step, an open question, a new case, a number, a hand-off, or it just stops" }, ai: "restates" },
  { id: "summary-stage", q: "Does the piece have a summary or synthesis stage, a passage whose job is to sum up what came before?", options: { yes: "yes", no: "no" }, ai: "yes" },
  { id: "mechanism-stage", q: "Does the piece have a stage that explains how something works (a mechanism)?", options: { yes: "yes", no: "no" }, ai: "yes" },
  { id: "participation", q: "Does the piece give the reader a way to take part beyond reading (comment, discuss, contribute, contact, run or try something and report back)?", options: { present: "present", absent: "absent" }, ai: "absent" },
  { id: "freshness", q: "Does the piece frame its subject as modern, new or next-generation?", options: { yes: "yes", no: "no" }, ai: "yes" },
  { id: "credibility", q: "What mainly makes the piece credible?", options: { institutional: "confident explanation in an authoritative voice, without showing its working", demonstration: "worked examples, numbers or runs the reader can check", sources: "cited sources or data", experience: "the author's own experience or story", other: "something else" }, ai: "institutional" },
  { id: "legacy-contrast", q: "Does the piece set its subject against a legacy or old way of doing things, as a foil?", options: { yes: "yes", no: "no" }, ai: "yes" },
  { id: "thesis-first", q: "Does the piece state its main claim or answer before its first main section?", options: { yes: "yes", no: "no" }, ai: "yes" },
  { id: "historical-dates", q: "Does the piece refer to specific historical dates or periods (a year, a decade, a dated event)?", options: { yes: "yes", no: "no" }, ai: "no" },
];
export const SHORT_WORDS = 800; // the paper's "short" class, which leaned human

const words = text => text.split(/\s+/).filter(Boolean).length;

export const pageText = src => (isHtml(src) ? extract(src).text : src);
export const pageWords = src => (isHtml(src) ? pageStats(src).words : words(src));

export function buildPrompt(text) {
  const lines = FEATURES.map(f => `- "${f.id}": ${f.q} One of: ${Object.entries(f.options).map(([k, v]) => `"${k}" (${v})`).join("; ")}.`);
  return `You are classifying the structure of one piece of writing. Judge only what the text does, not whether it is good.

Answer every feature below with exactly one of its option keys, and give a short quote (under 15 words) from the text as evidence, or "" when the answer is an absence.

${lines.join("\n")}

Reply with only this JSON object, no prose:
{"features": {"<id>": "<option key>", ...}, "evidence": {"<id>": "<quote>", ...}}

The text:
<<<
${text}
>>>`;
}

export function parse(textOut) {
  const m = /\{[\s\S]*\}/.exec(textOut);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const out = {};
    for (const f of FEATURES) {
      const v = j?.features?.[f.id];
      out[f.id] = typeof v === "string" && v in f.options ? v : null;
    }
    return { features: out, evidence: j.evidence ?? {} };
  } catch { return null; }
}

// Majority over runs: a value two thirds of the answered runs agree on, else "split".
export function majority(values) {
  const got = values.filter(v => v !== null);
  if (!got.length) return "unknown";
  const counts = new Map();
  for (const v of got) counts.set(v, (counts.get(v) || 0) + 1);
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return n * 3 >= got.length * 2 ? best : "split";
}

export function aiShape(result) {
  let n = 0, of = 0;
  for (const f of FEATURES) {
    const v = result.features[f.id];
    if (v === "split" || v === "unknown") continue;
    of++;
    if (v === f.ai) n++;
  }
  of++;
  if (result.words >= SHORT_WORDS) n++;
  return { n, of };
}

export async function score(file, { judge = DEFAULT_JUDGE, runs = 3 } = {}) {
  const src = fs.readFileSync(file, "utf8");
  const text = pageText(src);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-"));
  const promptFile = path.join(dir, "prompt.md");
  fs.writeFileSync(promptFile, buildPrompt(text));
  let cost = 0;
  const calls = await Promise.all(Array.from({ length: runs }, async () => {
    const r = await runJudge(judgeCommand(judge), promptFile, 300, dir);
    const u = unwrap(r.out);
    cost += u.cost;
    return r.why || u.error ? null : parse(u.text);
  }));
  fs.rmSync(dir, { recursive: true, force: true });
  const features = {};
  for (const f of FEATURES) features[f.id] = majority(calls.map(c => c?.features[f.id] ?? null));
  const evidence = calls.find(Boolean)?.evidence ?? {};
  const result = { file, words: pageWords(src), features, evidence, runs, answered: calls.filter(Boolean).length, cost };
  result.aiShape = aiShape(result);
  return result;
}

export function table(results) {
  const head = ["page", "words", ...FEATURES.map(f => f.id), "AI-shape"];
  const rows = results.map(r => [path.basename(r.file), String(r.words), ...FEATURES.map(f => {
    const v = r.features[f.id];
    return v === f.ai ? `**${v}**` : v;
  }), `${r.aiShape.n}/${r.aiShape.of}`]);
  return [head, head.map(() => "---"), ...rows].map(r => `| ${r.join(" | ")} |`).join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2), files = [];
  let judge = DEFAULT_JUDGE, runs = 3, json = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--judge") judge = args[++i];
    else if (args[i] === "--runs") runs = Number(args[++i]);
    else if (args[i] === "--json") json = args[++i];
    else files.push(args[i]);
  }
  if (!files.length) { console.error("usage: node structure.mjs <page.html | draft.md>… [--judge spec] [--runs n] [--json file]"); process.exit(2); }
  const results = await Promise.all(files.map(f => score(f, { judge, runs })));
  console.log(table(results));
  console.log(`\nBold: the value model posts leaned towards (SlopShape, Table 6). Judge ${judge}, ${runs} runs; cost US$${results.reduce((a, r) => a + r.cost, 0).toFixed(2)}.`);
  if (json) fs.writeFileSync(json, JSON.stringify(results, null, 2));
}
