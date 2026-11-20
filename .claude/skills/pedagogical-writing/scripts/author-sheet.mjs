#!/usr/bin/env node
// Usage: node author-sheet.mjs --write <dir> [name…]
//        node author-sheet.mjs --compare <dir>
//
// The calibration references were graded by a model (grading.md, "Calibration"), so agreement
// with them measures consistency, not human judgment (#371). This lets the author grade the same
// pages blind and then see where the references and the author differ.
//
// --write puts each reference's page text, as its reference graded it (its pinned commit and
// edits), at <dir>/docs/page-<n>.html under a neutral name, with <dir>/theme linked to the repo's
// current theme (so styling is today's, and links to other pages are dead), and a blank
// <dir>/page-<n>.grades.json with the target reader and one empty verdict per criterion. Which
// reference each page is lives in <dir>/.key.json: do not open it before grading. By default the
// deliberately broken copy (a reference with edits) is left out, since it would be graded knowing
// that faults were planted; name it to include it.
// --compare reads <dir>/.key.json and every page-<n>.grades.json, and prints, per page and in all,
// how often the author and the reference agree, agreement on the reference's not-met verdicts
// alone (the number to watch, since most references are met), each disagreement with both notes,
// and any verdict left blank or not understood.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCriteria } from "./grade.mjs";
import { materialize, readRefs } from "./calibrate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
export const VERDICTS = ["met", "not_met", "unknown"];

export function blankSheet(id, ref, criteria) {
  return {
    page: `docs/${id}.html`,
    reader: ref.reader,
    graded_by: "",
    how: "Read references/grading.md's criteria first. For each, set verdict to met, not_met or unknown, and note the quote or the gap. Do not open .key.json or evals/calibration/ until you are done.",
    grades: Object.fromEntries(criteria.map(c => [c.id, { statement: c.statement, verdict: "", note: "" }])),
  };
}

// "Not met", "not-met", "NOT_MET" all mean not_met; anything else outside VERDICTS is invalid.
export const normalise = v => String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

// Agreement between one filled sheet and its reference, over criteria the author judged.
export function compareSheet(sheet, ref) {
  const rows = [], blank = [], invalid = [];
  for (const [id, g] of Object.entries(sheet.grades)) {
    const want = ref.grades[id]?.verdict;
    if (!want) continue;
    const got = normalise(g.verdict);
    if (!got) { blank.push(id); continue; }
    if (!VERDICTS.includes(got)) { invalid.push(`${id} ("${g.verdict}")`); continue; }
    if (got === "unknown") continue;
    rows.push({ id, author: got, reference: want, agree: got === want, authorNote: g.note ?? "", referenceNote: ref.grades[id].note ?? "" });
  }
  const misses = rows.filter(r => r.reference === "not_met");
  return { judged: rows.length, agree: rows.filter(r => r.agree).length, misses: misses.length, missesAgree: misses.filter(r => r.agree).length, disagreements: rows.filter(r => !r.agree), blank, invalid };
}

const pct = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "0/0");

function linkTheme(dir) {
  const link = path.join(dir, "theme");
  let stat;
  try { stat = fs.lstatSync(link); } catch {}
  if (stat?.isSymbolicLink() && !fs.existsSync(link)) fs.unlinkSync(link); // a link to a deleted checkout
  else if (stat) return;
  fs.symlinkSync(path.join(REPO, "theme"), link);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [mode, dir, ...names] = process.argv.slice(2);
  if (!["--write", "--compare"].includes(mode) || !dir) {
    console.error("usage: node author-sheet.mjs --write <dir> [name…] | --compare <dir>");
    process.exit(2);
  }
  const refs = readRefs();
  const keyFile = path.join(dir, ".key.json");
  if (mode === "--write") {
    const criteria = readCriteria();
    const chosen = names.length ? refs.filter(r => names.includes(r.name)) : refs.filter(r => !(r.edits ?? []).length);
    if (names.length && chosen.length !== names.length) { console.error(`unknown reference: ${names.filter(n => !refs.some(r => r.name === n)).join(", ")}`); process.exit(2); }
    if (fs.existsSync(keyFile)) { console.error(`${dir} already has sheets; use a new directory`); process.exit(2); }
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    linkTheme(dir);
    // A shuffled order, so page numbers say nothing about which reference is which.
    const order = chosen.map(r => ({ r, k: Math.random() })).sort((a, b) => a.k - b.k).map(x => x.r);
    const key = {};
    order.forEach((ref, i) => {
      const id = `page-${i + 1}`;
      key[id] = ref.name;
      fs.writeFileSync(path.join(dir, "docs", `${id}.html`), materialize(ref, REPO));
      fs.writeFileSync(path.join(dir, `${id}.grades.json`), JSON.stringify(blankSheet(id, ref, criteria), null, 2) + "\n");
    });
    fs.writeFileSync(keyFile, JSON.stringify(key, null, 2) + "\n");
    console.log(`Wrote ${order.length} pages and sheets to ${dir}. Serve them: cd ${dir} && python3 -m http.server 8001,\nthen open http://localhost:8001/docs/page-1.html. Styling is today's theme; links to other pages are dead.`);
  } else {
    let key;
    try { key = JSON.parse(fs.readFileSync(keyFile, "utf8")); } catch (e) { console.error(`cannot read ${keyFile}: ${e.message}`); process.exit(2); }
    const all = { judged: 0, agree: 0, misses: 0, missesAgree: 0 };
    for (const [id, name] of Object.entries(key)) {
      const ref = refs.find(r => r.name === name);
      if (!ref) { console.error(`${id}: no reference named ${name}`); process.exitCode = 1; continue; }
      let sheet;
      try { sheet = JSON.parse(fs.readFileSync(path.join(dir, `${id}.grades.json`), "utf8")); }
      catch (e) { console.error(`${id}.grades.json: ${e.message}`); process.exitCode = 1; continue; }
      const c = compareSheet(sheet, ref);
      for (const k of Object.keys(all)) all[k] += c[k];
      console.log(`## ${id} (${name}): agree ${pct(c.agree, c.judged)}; on the reference's misses ${pct(c.missesAgree, c.misses)}`);
      if (c.blank.length) console.log(`  left blank: ${c.blank.join(", ")}`);
      if (c.invalid.length) console.log(`  not understood: ${c.invalid.join(", ")} (use met, not_met or unknown)`);
      for (const d of c.disagreements) console.log(`  ${d.id}: author ${d.author}, reference ${d.reference}\n    author: ${d.authorNote}\n    reference: ${d.referenceNote}`);
    }
    console.log(`\nIn all: agree ${pct(all.agree, all.judged)}; on the reference's misses ${pct(all.missesAgree, all.misses)}.`);
  }
}
