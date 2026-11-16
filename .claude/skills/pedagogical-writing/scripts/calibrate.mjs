#!/usr/bin/env node
// Usage: node calibrate.mjs [--judge spec]… [--runs n] [--only name,…] [--json file] [-j n]
//        node calibrate.mjs --materialize <name> <dir>
//
// Grades every page in ../evals/calibration/*.json with grade.mjs and compares the verdicts with
// the reference grades there (references/grading.md, Calibration). A reference names a page, the
// commit it was graded at (`rev`, with `pageBlob`, the page's blob id there) and, for a broken
// copy, exact edits that break it on purpose (`edits`, each of which must match exactly once).
// The page is rebuilt from those into ../evals/results/calibration/, which is git-ignored, and its
// blob id is checked against the reference's `blob`.
//
// Prints, per page and in all: agreement with the reference per run, agreement on the reference's
// misses alone (a judge that always says "met" scores well on the first and zero on the second),
// whether a broken copy fails exactly the criteria its edits break, and run-to-run stability.
//
// --materialize writes one reference's page to <dir>/<file name of its page> and exits (eval fixtures use it).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { blobId, grade, localDate, stable, DEFAULT_JUDGE } from "./grade.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REFS = path.join(HERE, "..", "evals", "calibration");
const OUT = path.join(HERE, "..", "evals", "results", "calibration");

export function readRefs(dir = REFS) {
  return fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()
    .map(f => ({ name: f.replace(/\.json$/, ""), ...JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
}

// The page's text as the reference graded it: the file at `rev`, then the edits. Every reference
// pins `rev`, so later edits to the live page cannot break the edits' anchors or move the grade.
// Without the history (a shallow clone), the working-tree file stands in only if its blob id is
// still `pageBlob`, the page as it was at `rev`.
export function materialize(ref, repo = process.cwd()) {
  let src;
  try {
    src = execFileSync("git", ["-C", repo, "show", `${ref.rev}:${ref.page}`], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    const live = fs.readFileSync(path.join(repo, ref.page));
    if (!ref.pageBlob || blobId(live) !== ref.pageBlob)
      throw new Error(`${ref.name ?? ref.page}: commit ${ref.rev} is not in this clone (fetch the full history), and ${ref.page} has changed since`);
    src = live.toString("utf8");
  }
  for (const e of ref.edits ?? []) src = applyEdit(src, e);
  return src;
}

// An edit is { find, replace } or { from, to, replace } (cut from `from` up to, not including, `to`).
// Either anchor must occur exactly once, so an edit that silently matches nothing cannot pass.
export function applyEdit(src, e) {
  const once = (needle, what) => {
    const k = src.indexOf(needle);
    if (k < 0) throw new Error(`edit for ${e.breaks ?? "?"}: ${what} not found: ${needle.slice(0, 60)}`);
    if (src.indexOf(needle, k + 1) >= 0) throw new Error(`edit for ${e.breaks ?? "?"}: ${what} occurs more than once: ${needle.slice(0, 60)}`);
    return k;
  };
  if (e.find !== undefined) { const k = once(e.find, "find"); return src.slice(0, k) + e.replace + src.slice(k + e.find.length); }
  const a = once(e.from, "from"), b = src.indexOf(e.to, a);
  if (b < 0) throw new Error(`edit for ${e.breaks ?? "?"}: "to" not found after "from": ${e.to.slice(0, 60)}`);
  return src.slice(0, a) + (e.replace ?? "") + src.slice(b);
}

// Compare one scorecard with its reference. Per-run agreement uses each run's own verdict.
export function score(card, ref) {
  const ids = Object.keys(ref.grades).filter(id => card.results.some(r => r.id === id));
  const runs = card.runs * card.judges.length;
  const per = (filter) => {
    const sel = ids.filter(filter);
    if (!sel.length) return null;
    let ok = 0;
    for (const id of sel) {
      const r = card.results.find(x => x.id === id);
      ok += r.calls.filter(c => c.verdict === ref.grades[id].verdict).length;
    }
    return { agree: ok, of: sel.length * runs };
  };
  const all = per(() => true), misses = per(id => ref.grades[id].verdict === "not_met");
  const broken = (ref.edits ?? []).map(e => e.breaks).filter(Boolean);
  let exact = null;
  if (broken.length) {
    // The edits break exactly their criteria: on a run, every broken criterion fails and no
    // criterion the reference passes fails. A miss the page had before the edits (the reference
    // marks it not_met and no edit names it) counts neither way.
    exact = Array.from({ length: runs }, (_, k) => {
      const v = id => card.results.find(r => r.id === id)?.calls[k]?.verdict;
      return broken.every(id => v(id) === "not_met") &&
        ids.filter(id => ref.grades[id].verdict === "met").every(id => v(id) !== "not_met");
    });
  }
  const rows = ids.map(id => {
    const r = card.results.find(x => x.id === id);
    return { id, want: ref.grades[id].verdict, got: r.calls.map(c => c.verdict), reason: r.reason };
  });
  return { all, misses, exact, stable: stable(card.results.map(r => r.calls)), rows };
}

const pct = x => (x ? `${x.agree}/${x.of} (${Math.round(100 * x.agree / x.of)}%)` : "n/a");

function parseArgs(argv) {
  const o = { judges: [], runs: 1, jobs: 4 };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k], v = () => { const x = argv[++k]; if (x === undefined) throw new Error(`${a} needs a value`); return x; };
    if (a === "--judge") o.judges.push(v());
    else if (a === "--runs") o.runs = Number(v());
    else if (a === "--only") o.only = v().split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--json") o.json = v();
    else if (a === "-j") o.jobs = Number(v());
    else if (a === "--materialize") { o.materialize = v(); o.dir = v(); }
    else throw new Error(`unknown option ${a}`);
  }
  if (!(Number.isInteger(o.runs) && o.runs >= 1) || !(Number.isInteger(o.jobs) && o.jobs >= 1)) throw new Error("--runs and -j must be positive whole numbers");
  if (!o.judges.length) o.judges.push(DEFAULT_JUDGE);
  return o;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const repo = path.resolve(HERE, "..", "..", "..", "..");
  const refs = readRefs().filter(r => !o.only || o.only.includes(r.name));
  if (o.materialize) {
    const ref = refs.find(r => r.name === o.materialize);
    if (!ref) { console.error(`no reference named ${o.materialize}`); process.exit(2); }
    fs.mkdirSync(o.dir, { recursive: true });
    fs.writeFileSync(path.join(o.dir, path.basename(ref.page)), materialize(ref, repo));
    process.exit(0);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const summary = [];
  for (const ref of refs) {
    const src = materialize(ref, repo);
    const file = path.join(OUT, `${ref.name}.html`);
    fs.writeFileSync(file, src);
    const blob = blobId(Buffer.from(src));
    const card = await grade({ page: file, judges: o.judges, reader: ref.reader, runs: o.runs, jobs: o.jobs });
    fs.writeFileSync(path.join(OUT, `${ref.name}.scorecard.json`), JSON.stringify(card, null, 2) + "\n");
    const s = score(card, ref);
    summary.push({ name: ref.name, blobMatches: !ref.blob || ref.blob === blob, costUsd: card.costUsd, ...s });
    console.log(`\n## ${ref.name}${ref.blob && ref.blob !== blob ? `  (PAGE CHANGED since graded: blob ${blob.slice(0, 10)}, reference ${ref.blob.slice(0, 10)})` : ""}\n`);
    for (const r of s.rows) console.log(`${r.got.every(g => g === r.want) ? "  " : "✗ "}${r.id.padEnd(18)} reference ${r.want.padEnd(8)} got ${r.got.join(", ")}${r.got.some(g => g !== r.want) && r.reason ? `   (${r.reason.slice(0, 140)})` : ""}`);
    console.log(`agreement ${pct(s.all)}, on the reference's misses ${pct(s.misses)}, same verdict every run ${s.stable.same}/${s.stable.of}${s.exact ? `, fails exactly the broken criteria on ${s.exact.filter(Boolean).length}/${s.exact.length} runs` : ""}`);
  }
  const sum = (key) => summary.reduce((acc, x) => (x[key] ? { agree: acc.agree + x[key].agree, of: acc.of + x[key].of } : acc), { agree: 0, of: 0 });
  const stable = summary.reduce((a, x) => ({ same: a.same + x.stable.same, of: a.of + x.stable.of }), { same: 0, of: 0 });
  const exact = summary.flatMap(x => x.exact ?? []);
  console.log(`\n## In all (judges ${o.judges.join(", ")}, ${o.runs} run${o.runs > 1 ? "s" : ""})\n`);
  console.log(`agreement ${pct(sum("all"))} (target 80%); cost US$${summary.reduce((a, x) => a + (x.costUsd || 0), 0).toFixed(2)}`);
  console.log(`agreement on the reference's misses ${pct(sum("misses"))}`);
  if (o.runs > 1) console.log(`same verdict on every run: ${stable.same}/${stable.of} (${Math.round(100 * stable.same / stable.of)}%, target 90%)`);
  if (exact.length) console.log(`broken copies fail exactly the broken criteria on ${exact.filter(Boolean).length}/${exact.length} runs (target: all)`);
  if (o.json) fs.writeFileSync(o.json, JSON.stringify({ judges: o.judges, runs: o.runs, date: localDate(), summary }, null, 2) + "\n");
}
