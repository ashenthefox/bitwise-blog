#!/usr/bin/env node
// Usage: node author-sheet.mjs --write <dir> [name…]
//        node author-sheet.mjs --compare <dir>
//
// The calibration references were graded by a model (grading.md, "Calibration"), so agreement
// with them measures consistency, not human judgment (#371). This lets the author grade the same
// pages blind and then see where the references and the author differ.
//
// --write puts each reference's page, as its reference graded it (its pinned commit and edits),
// at <dir>/docs/<name>.html with <dir>/theme linked to the repo's theme, so `python3 -m http.server`
// in <dir> serves it styled; and a blank <dir>/<name>.grades.json holding the target reader and one
// empty verdict per criterion. It never shows the reference verdicts.
// --compare reads every <name>.grades.json in <dir> and prints, per page and in all, how often the
// author and the reference agree, agreement on the reference's not-met verdicts alone (the number
// to watch, since most references are met), and each disagreement with both notes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCriteria } from "./grade.mjs";
import { materialize, readRefs } from "./calibrate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
export const VERDICTS = ["met", "not_met", "unknown"];

export function blankSheet(ref, criteria) {
  return {
    name: ref.name,
    page: `docs/${ref.name}.html`,
    reader: ref.reader,
    graded_by: "",
    how: "Read references/grading.md's criteria first. For each, set verdict to met, not_met or unknown, and note the quote or the gap. Do not open evals/calibration/ until you are done.",
    grades: Object.fromEntries(criteria.map(c => [c.id, { statement: c.statement, verdict: "", note: "" }])),
  };
}

// Agreement between one filled sheet and its reference, over criteria the author judged.
export function compareSheet(sheet, ref) {
  const rows = [];
  for (const [id, g] of Object.entries(sheet.grades)) {
    const want = ref.grades[id]?.verdict;
    if (!want || !VERDICTS.includes(g.verdict) || g.verdict === "unknown") continue;
    rows.push({ id, author: g.verdict, reference: want, agree: g.verdict === want, authorNote: g.note ?? "", referenceNote: ref.grades[id].note ?? "" });
  }
  const misses = rows.filter(r => r.reference === "not_met");
  return { name: sheet.name, judged: rows.length, agree: rows.filter(r => r.agree).length, misses: misses.length, missesAgree: misses.filter(r => r.agree).length, disagreements: rows.filter(r => !r.agree) };
}

const pct = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "0/0");

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [mode, dir, ...names] = process.argv.slice(2);
  if (!["--write", "--compare"].includes(mode) || !dir) {
    console.error("usage: node author-sheet.mjs --write <dir> [name…] | --compare <dir>");
    process.exit(2);
  }
  const refs = readRefs();
  if (mode === "--write") {
    const criteria = readCriteria();
    const chosen = names.length ? refs.filter(r => names.includes(r.name)) : refs;
    if (names.length && chosen.length !== names.length) { console.error(`unknown reference: ${names.filter(n => !refs.some(r => r.name === n)).join(", ")}`); process.exit(2); }
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    if (!fs.existsSync(path.join(dir, "theme"))) fs.symlinkSync(path.join(REPO, "theme"), path.join(dir, "theme"));
    for (const ref of chosen) {
      fs.writeFileSync(path.join(dir, "docs", `${ref.name}.html`), materialize(ref, REPO));
      const sheet = path.join(dir, `${ref.name}.grades.json`);
      if (fs.existsSync(sheet)) { console.log(`kept ${sheet} (already there)`); continue; }
      fs.writeFileSync(sheet, JSON.stringify(blankSheet(ref, criteria), null, 2) + "\n");
      console.log(`wrote docs/${ref.name}.html and ${ref.name}.grades.json`);
    }
    console.log(`\nServe it: cd ${dir} && python3 -m http.server 8001, then open http://localhost:8001/docs/<name>.html`);
  } else {
    const sheets = fs.readdirSync(dir).filter(f => f.endsWith(".grades.json")).sort();
    if (!sheets.length) { console.error(`no *.grades.json in ${dir}`); process.exit(2); }
    let all = { judged: 0, agree: 0, misses: 0, missesAgree: 0 };
    for (const f of sheets) {
      const sheet = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const ref = refs.find(r => r.name === sheet.name);
      if (!ref) { console.error(`${f}: no reference named ${sheet.name}`); process.exitCode = 1; continue; }
      const c = compareSheet(sheet, ref);
      for (const k of Object.keys(all)) all[k] += c[k];
      console.log(`## ${c.name}: agree ${pct(c.agree, c.judged)}; on the reference's misses ${pct(c.missesAgree, c.misses)}`);
      for (const d of c.disagreements) console.log(`  ${d.id}: author ${d.author}, reference ${d.reference}\n    author: ${d.authorNote}\n    reference: ${d.referenceNote}`);
    }
    console.log(`\nIn all: agree ${pct(all.agree, all.judged)}; on the reference's misses ${pct(all.missesAgree, all.misses)}.`);
  }
}
