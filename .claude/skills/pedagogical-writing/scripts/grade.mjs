#!/usr/bin/env node
// Usage: node grade.mjs <page.html> [options]
//
// Grades a teaching page against the scorecard in ../references/grading.md: one fresh,
// non-interactive judge process per criterion, each seeing only the target reader, that
// one criterion, the script checks from page-stats.mjs and a prose extract of the page.
// Every verdict is checked (a real section id, a quote that is on the page, a gap for a
// miss); anything that fails the check, and any judge that fails, counts as unknown.
//
//   --judge <spec>     claude | claude:<model> | pi:<provider/model> | any command, which
//                      gets the prompt as its last argument. Repeat it for several judges;
//                      a disagreement between them is unknown. Default: claude:claude-sonnet-5-5
//   --reader <text>    the target reader (default: the reader the page assumes)
//   --runs <n>         run each judge n times; runs that disagree make the verdict unknown
//   --only <ids>       comma-separated criterion ids
//   --expect <file>    reference grades (evals/calibration/*.json): print agreement with them
//   --json             print the scorecard as JSON
//   --out <file>       also write the JSON scorecard to a file
//   --extract          print the prose extract the judges see, and exit (no judge runs)
//   -j <n>             judges run in parallel (default 4)
//   --timeout <s>      seconds per judge call (default 600)
//
// No dependencies beyond Node and the judge's own CLI.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { articleHtml, decode, pageStats, scriptChecks } from "./page-stats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUBRIC = path.join(HERE, "..", "references", "grading.md");
export const VERDICTS = ["met", "not_met", "unknown"];
export const DEFAULT_JUDGE = "claude:claude-sonnet-5-5";

// ---------------------------------------------------------------- the rubric

// The criteria, read from grading.md so the rubric path and this script share one text.
// Each is a "### `id`: statement" heading under "## Criteria", with its body up to the next heading.
export function readCriteria(md = fs.readFileSync(RUBRIC, "utf8")) {
  const start = md.search(/^## Criteria\s*$/m);
  if (start < 0) throw new Error("grading.md has no '## Criteria' section");
  const rest = md.slice(start).split(/\n(?=## )/)[0];
  const out = [];
  for (const block of rest.split(/\n(?=### )/).slice(1)) {
    const m = /^### `([a-z0-9-]+)`: (.+)\n([\s\S]*)$/.exec(block);
    if (!m) throw new Error(`grading.md: malformed criterion heading: ${block.split("\n")[0]}`);
    out.push({ id: m[1], statement: m[2].trim(), body: m[3].trim() });
  }
  return out;
}

// ---------------------------------------------------------------- the page

// The page as the judges read it: headings with their ids, prose, captions, the accessible
// names of figures, the names of interactive components, and fold summaries and bodies.
// SVG internals, scripts and styles are dropped; long code and tables are cut short.
// Returns { text, sections: [{ id, start, end }], ids: Map(id -> h2 section id) }.
export function extract(src) {
  let h = articleHtml(src);
  h = h.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const plain = s => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  h = h.replace(/<svg\b([^>]*)>[\s\S]*?<\/svg>/gi, (_, a) => {
    const label = /aria-label="([^"]*)"/.exec(a);
    return label ? `\n[diagram: ${plain(label[1])}]\n` : " ";
  });
  h = h.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => {
    const lines = decode(body.replace(/<[^>]+>/g, "")).replace(/\n+$/, "").split("\n");
    const kept = lines.slice(0, 20).map(l => "    " + l).join("\n");
    return `\n[code]\n${kept}${lines.length > 20 ? `\n    … (${lines.length - 20} more lines)` : ""}\n[/code]\n`;
  });
  h = h.replace(/<table\b[\s\S]*?<\/table>/gi, t => {
    const rows = [...t.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(r => [...r[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => plain(c[1])).join(" | "));
    return `\n[table]\n${rows.slice(0, 12).join("\n")}${rows.length > 12 ? `\n… (${rows.length - 12} more rows)` : ""}\n[/table]\n`;
  });
  h = h.replace(/<(h[2-4])\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_, tag, a, body) => {
    const id = /\bid="([^"]+)"/.exec(a);
    return `\n${"#".repeat(Number(tag[1]))} ${plain(body)}${id ? ` {#${id[1]}}` : ""}\n`;
  });
  h = h.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, b) => `\n# ${plain(b)}\n`);
  h = h.replace(/<details\b([^>]*)>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, (_, a, s) => {
    const kind = /class="[^"]*\bpredict\b/.test(a) ? "predict" : /class="[^"]*\bdisclosure\b/.test(a) ? "disclosure" : "details";
    return `\n[${kind} fold] ${plain(s)}\n`;
  });
  h = h.replace(/<\/details>/gi, "\n[/fold]\n");
  h = h.replace(/<span\b[^>]*class="[^"]*\bsidenote\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, (_, b) => ` [sidenote: ${plain(b)}] `);
  h = h.replace(/<figure\b([^>]*)>/gi, (_, a) => { const id = /\bid="([^"]+)"/.exec(a); return `\n[figure${id ? ` {#${id[1]}}` : ""}]\n`; });
  h = h.replace(/<\/figure>/gi, "\n[/figure]\n");
  h = h.replace(/<figcaption\b[^>]*>/gi, "\ncaption: ");
  h = h.replace(/<(bh-[a-z-]+)\b([^>]*)>/gi, (_, tag, a) => { const id = /\bid="([^"]+)"/.exec(a); return `\n[${tag}${id ? ` {#${id[1]}}` : ""}]\n`; });
  h = h.replace(/<div\b[^>]*class="[^"]*\btldr\b[^"]*"[^>]*>/gi, "\n[tldr]\n");
  h = h.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<(p|dt|dd|blockquote|div|ol|ul|br)\b[^>]*>/gi, "\n");
  // Inline tags vanish (so "10 <em>per second</em>." keeps its full stop in place); others leave a space.
  const INLINE = /<\/?(a|abbr|b|cite|code|dfn|em|i|kbd|mark|q|s|small|span|strong|sub|sup|time|u|var|wbr)\b[^>]*>/gi;
  const text = decode(h.replace(INLINE, "").replace(/<[^>]+>/g, " "))
    .split("\n").map(l => (l.startsWith("    ") ? l.replace(/\s+$/, "") : l.replace(/[ \t]+/g, " ").trim())).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim() + "\n";

  // Section ranges by h2, and which h2 section each id in the article sits in.
  const sections = [];
  const re = /^## .*?(?: \{#([a-z0-9-]+)\})?$/gm;
  let m, prev = { id: "top", start: 0 };
  while ((m = re.exec(text))) { sections.push({ ...prev, end: m.index }); prev = { id: m[1] || "(no id)", start: m.index }; }
  sections.push({ ...prev, end: text.length });
  const ids = new Map([["top", "top"]]);
  const art = articleHtml(src);
  let cur = "top";
  for (const t of art.matchAll(/<(h2)\b[^>]*\bid="([^"]+)"|\bid="([^"]+)"/gi)) {
    if (t[1]) { cur = t[2]; ids.set(t[2], cur); } else if (!ids.has(t[3])) ids.set(t[3], cur);
  }
  return { text, sections, ids };
}

// Normalise for quote matching: case, quotes, dashes, spacing and the extract's markers.
const norm = s => s.toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
  .replace(/\{#[a-z0-9-]+\}/g, " ").replace(/\s+/g, " ").trim();

// Does `quote` occur, in order, within the text of h2 section `sec`? "…" or "..." may join pieces.
export function quoteInSection(ex, sec, quote) {
  const s = ex.sections.find(x => x.id === sec);
  if (!s) return false;
  const hay = norm(ex.text.slice(s.start, s.end));
  let at = 0;
  for (const piece of quote.split(/…|\.\.\./).map(norm).filter(Boolean)) {
    const k = hay.indexOf(piece, at);
    if (k < 0) return false;
    at = k + piece.length;
  }
  return at > 0;
}

// ---------------------------------------------------------------- judges

export function judgeCommand(spec) {
  if (spec === "claude" || spec.startsWith("claude:")) {
    const model = spec.slice("claude:".length) || DEFAULT_JUDGE.slice("claude:".length);
    return ["claude", "-p", "--model", model, "--tools", "Read,Grep,Glob", "--disable-slash-commands",
      "--no-session-persistence", "--strict-mcp-config", "--output-format", "json"];
  }
  if (spec.startsWith("pi:")) {
    // --no-approve ignores project-local files, so a judge never waits on pi's trust prompt.
    return ["pi", "-p", "--no-approve", "--no-session", "--no-skills", "--no-extensions", "--no-context-files", "--no-prompt-templates",
      "--tools", "read,grep,find,ls", "--model", spec.slice(3)];
  }
  return splitArgs(spec);
}

// A command line split into words, honouring '…' and "…" quotes (no other shell syntax).
export function splitArgs(s) {
  const out = [];
  for (const m of s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// A criterion's text without its examples: they quote pages the calibration grades, so a judge
// that saw them could copy the answer. Each "Example:" or "Illustrative:" runs to the end of its bullet.
export const withoutExamples = body => body.split(/\n(?=- )/)
  .map(b => b.replace(/\s+(?:Example|Illustrative):[\s\S]*$/, "")).join("\n");

export function buildPrompt({ criterion, reader, page, checks, ex }) {
  const facts = checks.map(c => `- ${c.id}: ${c.status}, ${c.detail}${c.items?.length ? "\n" + c.items.map(i => `  - #${i.section}: "${i.phrase}"`).join("\n") : ""}`).join("\n");
  return `You grade one criterion of a teaching page. Other judges grade the other criteria, so judge only this one.

Target reader: ${reader}
Page: ${page}. Below is its prose extract (markup removed, headings carry their section id as {#id}, figures and interactive components are marked in brackets). Open the page file only if you need a figure's markup.

## Criterion \`${criterion.id}\`: ${criterion.statement}

${withoutExamples(criterion.body)}

## Facts a script already decided (use them; do not re-decide them)

${facts}

## How to answer

- verdict: "met", "not_met" or "unknown". Use "unknown" when the page does not give you enough to decide; do not guess.
- evidence: one to three items. Each is {"section": the id of the h2 section the quote is in (the {#id} on the "## " heading above it, or "top" before the first one), "quote": words copied exactly from the extract, at most 25}. A quote that is not word for word in that section voids your verdict.
- gap: for not_met only, one sentence: what to change, and where.
- Reply with only this JSON object, no other text:
{"criterion": "${criterion.id}", "verdict": "…", "evidence": [{"section": "…", "quote": "…"}], "gap": "…", "reason": "one sentence"}

<<<PAGE EXTRACT
${ex.text}PAGE EXTRACT>>>
`;
}

// The last JSON object in the reply that has a "verdict" field, or null.
export function parseReply(out) {
  const s = out.replace(/```(?:json)?/g, " ");
  for (let end = s.lastIndexOf("}"); end >= 0; end = s.lastIndexOf("}", end - 1)) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (s[i] === "}") depth++;
      else if (s[i] === "{" && --depth === 0) {
        try { const v = JSON.parse(s.slice(i, end + 1)); if (v && typeof v === "object" && "verdict" in v) return v; } catch {}
        break;
      }
    }
  }
  return null;
}

// Checks one reply against the schema and the page. Returns the verdict to count.
export function validate(reply, criterion, ex) {
  const bad = why => ({ verdict: "unknown", evidence: [], gap: "", reason: why, invalid: true });
  if (!reply) return bad("no JSON verdict in the judge's reply");
  if (!VERDICTS.includes(reply.verdict)) return bad(`verdict "${reply.verdict}" is not met, not_met or unknown`);
  if (reply.criterion && reply.criterion !== criterion.id) return bad(`reply is for "${reply.criterion}", not "${criterion.id}"`);
  const evidence = Array.isArray(reply.evidence) ? reply.evidence : [];
  const clean = { verdict: reply.verdict, evidence, gap: String(reply.gap ?? "").trim(), reason: String(reply.reason ?? "").trim() };
  if (reply.verdict === "unknown") return clean;
  if (!evidence.length) return bad(`a ${reply.verdict} verdict without evidence`);
  for (const e of evidence) {
    const sec = String(e?.section ?? "").replace(/^#/, "");
    const quote = String(e?.quote ?? "");
    const h2 = ex.ids.get(sec);
    if (!h2) return bad(`section "#${sec}" is not on the page`);
    if (!quote.trim()) return bad(`empty quote for #${sec}`);
    if (!quoteInSection(ex, h2, quote)) return bad(`quote not found in #${sec}: "${quote.slice(0, 80)}"`);
    e.section = sec;
  }
  if (reply.verdict === "not_met" && !clean.gap) return bad("a not_met verdict without a gap");
  return clean;
}

export function runJudge(argv, prompt, timeoutS) {
  return new Promise(resolve => {
    let out = "", err = "", done = false;
    const child = spawn(argv[0], [...argv.slice(1), prompt], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { if (!done) { child.kill("SIGTERM"); finish(null, `timed out after ${timeoutS} s`); } }, timeoutS * 1000);
    const finish = (code, why) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err, why }); };
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("error", e => finish(null, `could not start ${argv[0]}: ${e.message}`));
    child.on("close", code => finish(code, code === 0 ? "" : `exit ${code}`));
  });
}

// `claude -p --output-format json` wraps the reply as { result, total_cost_usd, is_error }; other
// judges print the reply itself. Returns { text, cost, error }.
export function unwrap(out) {
  try {
    const j = JSON.parse(out);
    if (j && typeof j === "object" && typeof j.result === "string") return { text: j.result, cost: Number(j.total_cost_usd) || 0, error: j.is_error ? j.result : "" };
  } catch {}
  return { text: out, cost: 0, error: "" };
}

// One judge call, validated. Never throws: a failure is an unknown verdict with its reason.
export async function judgeOnce(spec, prompt, criterion, ex, timeoutS) {
  const r = await runJudge(judgeCommand(spec), prompt, timeoutS);
  const { text, cost, error } = unwrap(r.out);
  const last = t => t.trim().split("\n").slice(-1)[0]?.slice(0, 160) ?? "";
  if (r.why || error) {
    const tail = error ? last(error) : last(r.err || r.out);
    return { verdict: "unknown", evidence: [], gap: "", reason: `judge failed (${r.why || "error reply"})${tail ? `: ${tail}` : ""}`, invalid: true, cost };
  }
  const reply = parseReply(text);
  const v = validate(reply, criterion, ex);
  if (v.invalid && !reply) v.reason += `: ${last(text)}`;
  return { ...v, cost };
}

// Combine every call for one criterion: agreement gives that verdict, any split gives unknown.
export function combine(calls) {
  const verdicts = new Set(calls.map(c => c.verdict));
  if (verdicts.size === 1) {
    const v = calls[0].verdict;
    const pick = calls.find(c => !c.invalid) ?? calls[0];
    return { ...pick, verdict: v, agreed: true };
  }
  const tally = VERDICTS.map(v => `${calls.filter(c => c.verdict === v).length} ${v}`).filter(t => !t.startsWith("0 ")).join(", ");
  const firstMiss = calls.find(c => c.verdict === "not_met");
  return { verdict: "unknown", evidence: firstMiss?.evidence ?? [], gap: firstMiss?.gap ?? "", reason: `judges or runs disagree (${tally})`, agreed: false };
}

async function pool(n, jobs) {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const k = next++; results[k] = await jobs[k](); }
  }));
  return results;
}

// Today as YYYY-MM-DD in local time (toISOString is UTC, a day off for half the world).
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export async function grade({ page, judges = [DEFAULT_JUDGE], reader, runs = 1, only, jobs = 4, timeout = 600 }) {
  const src = fs.readFileSync(page, "utf8");
  const ex = extract(src);
  const checks = scriptChecks(pageStats(src));
  let criteria = readCriteria();
  if (only?.length) {
    const unknownIds = only.filter(id => !criteria.some(c => c.id === id));
    if (unknownIds.length) throw new Error(`unknown criterion ids: ${unknownIds.join(", ")}`);
    criteria = criteria.filter(c => only.includes(c.id));
  }
  const who = reader || "the reader the page itself assumes (decide who that is from the page before judging)";
  // One job per (criterion, judge, run), in shuffled order so no criterion always goes first.
  const tasks = shuffle(criteria.flatMap(c => judges.flatMap(j => Array.from({ length: runs }, (_, r) => ({ c, j, r })))));
  const prompts = new Map(criteria.map(c => [c.id, buildPrompt({ criterion: c, reader: who, page, checks, ex })]));
  const done = await pool(jobs, tasks.map(t => async () => ({ ...t, v: await judgeOnce(t.j, prompts.get(t.c.id), t.c, ex, timeout) })));
  const results = criteria.map(c => {
    const calls = done.filter(d => d.c.id === c.id).sort((a, b) => a.j.localeCompare(b.j) || a.r - b.r);
    return { id: c.id, statement: c.statement, ...combine(calls.map(d => d.v)), calls: calls.map(d => ({ judge: d.j, run: d.r + 1, verdict: d.v.verdict, reason: d.v.reason, cost: d.v.cost ?? 0 })) };
  });
  const met = results.filter(r => r.verdict === "met").length;
  const judged = results.filter(r => r.verdict !== "unknown").length;
  // Run-to-run stability: the share of criteria on which every run of a judge gave one verdict.
  const stability = runs > 1 ? Object.fromEntries(judges.map(j => [j,
    results.filter(r => new Set(r.calls.filter(c => c.judge === j).map(c => c.verdict)).size === 1).length / results.length])) : null;
  const order = ex.sections.map(s => s.id);
  const costUsd = Math.round(100 * done.reduce((a, d) => a + (d.v.cost ?? 0), 0)) / 100;
  // The rubric's blob id: compare two scorecards only when it matches.
  return { page, blob: blobId(fs.readFileSync(page)), rubric: blobId(fs.readFileSync(RUBRIC)), order, reader: reader || null, judges, runs, date: localDate(), met, judged, total: results.length, costUsd, checks, results, stability };
}

// ---------------------------------------------------------------- calibration

// Git's blob id for a file's bytes, so a reference grade can say which version of the page it graded.
export const blobId = buf => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

// Agreement between a scorecard and reference grades ({ grades: { id: { verdict } } }).
// A criterion agrees when the scorecard's verdict equals the reference verdict.
export function compare(card, ref) {
  const rows = card.results.filter(r => ref.grades[r.id]).map(r => ({ id: r.id, got: r.verdict, want: ref.grades[r.id].verdict, ok: r.verdict === ref.grades[r.id].verdict }));
  return { agree: rows.filter(r => r.ok).length, of: rows.length, rows };
}

// ---------------------------------------------------------------- output

export function scorecardMarkdown(card) {
  const L = [];
  L.push(`# Scorecard: ${card.page}`, "");
  L.push(`**${card.met} of ${card.judged} criteria met** (${card.total - card.judged} unknown). Judges: ${card.judges.join(", ")}; ${card.runs} run${card.runs > 1 ? "s" : ""} each; ${card.date}${card.costUsd ? `; US$${card.costUsd.toFixed(2)}` : ""}; rubric ${card.rubric.slice(0, 10)}.`);
  if (card.reader) L.push(`Target reader: ${card.reader}.`);
  if (card.stability) L.push(`Same verdict on every run: ${Object.entries(card.stability).map(([j, s]) => `${j} ${Math.round(100 * s)}%`).join(", ")}.`);
  const leap = card.results.filter(r => r.verdict === "not_met" && ["opening-need", "one-idea", "need-before-name"].includes(r.id));
  if (leap.length) {
    const first = leap.map(r => ({ r, pos: Math.min(Infinity, ...r.evidence.map(e => card.order.indexOf(e.section)).filter(k => k >= 0)) })).sort((a, b) => a.pos - b.pos)[0].r;
    L.push("", `**Biggest leap** (earliest miss on the need and step criteria): \`${first.id}\` at #${first.evidence[0]?.section ?? "?"}: ${first.gap}`);
  }
  L.push("", "## Script checks", "");
  for (const c of card.checks) L.push(`- \`${c.id}\` **${c.status}**: ${c.detail}`);
  L.push("", "## Criteria", "");
  for (const r of card.results) {
    L.push(`### \`${r.id}\` **${r.verdict.replace("_", " ")}**: ${r.statement}`, "");
    for (const e of r.evidence) L.push(`- #${e.section}: "${e.quote}"`);
    if (r.verdict === "not_met" && r.gap) L.push(`- Gap: ${r.gap}`);
    if (r.reason) L.push(`- ${r.verdict === "unknown" ? "Why unknown" : "Reason"}: ${r.reason}`);
    if (r.calls.length > 1) L.push(`- Calls: ${r.calls.map(c => `${c.judge}#${c.run} ${c.verdict}`).join(", ")}`);
    L.push("");
  }
  return L.join("\n");
}

function parseArgs(argv) {
  const o = { judges: [], runs: 1, jobs: 4, timeout: 600 };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k], v = () => { const x = argv[++k]; if (x === undefined) throw new Error(`${a} needs a value`); return x; };
    if (a === "--judge") o.judges.push(v());
    else if (a === "--reader") o.reader = v();
    else if (a === "--runs") o.runs = Number(v());
    else if (a === "--only") o.only = v().split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--expect") o.expect = v();
    else if (a === "--out") o.out = v();
    else if (a === "-j") o.jobs = Number(v());
    else if (a === "--timeout") o.timeout = Number(v());
    else if (a === "--json") o.json = true;
    else if (a === "--extract") o.extractOnly = true;
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else o.page = a;
  }
  if (!o.page) throw new Error("usage: node grade.mjs <page.html> [--judge spec]… [--reader text] [--runs n] [--only ids] [--expect file] [--json] [--out file] [--extract]");
  if (!(o.runs >= 1) || !(o.jobs >= 1) || !(o.timeout > 0)) throw new Error("--runs, -j and --timeout must be positive numbers");
  if (!o.judges.length) o.judges.push(DEFAULT_JUDGE);
  return o;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (o.extractOnly) { process.stdout.write(extract(fs.readFileSync(o.page, "utf8")).text); process.exit(0); }
  let card;
  try { card = await grade(o); } catch (e) { console.error(e.message); process.exit(2); }
  if (o.out) fs.writeFileSync(o.out, JSON.stringify(card, null, 2) + "\n");
  console.log(o.json ? JSON.stringify(card, null, 2) : scorecardMarkdown(card));
  if (o.expect) {
    const ref = JSON.parse(fs.readFileSync(o.expect, "utf8"));
    const cmp = compare(card, ref);
    console.log(`\n## Agreement with ${o.expect}\n`);
    if (ref.blob && ref.blob !== card.blob) console.log(`The page has changed since it was graded (blob ${card.blob.slice(0, 10)}, reference ${ref.blob.slice(0, 10)}): re-grade it by hand before trusting this.\n`);
    for (const r of cmp.rows) console.log(`- ${r.ok ? "agree   " : "DISAGREE"} \`${r.id}\`: got ${r.got}, reference ${r.want}`);
    console.log(`\n${cmp.agree} of ${cmp.of} criteria agree (${Math.round(100 * cmp.agree / Math.max(cmp.of, 1))}%).`);
  }
}
