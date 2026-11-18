#!/usr/bin/env node
// Usage: node rejudge.mjs <result.json>... --judge-model ID [--votes N] [-j N] [--rubrics <evals dir>] [--case GLOB] [--grader GLOB] [--out FILE]
//        node rejudge.mjs --trim <result.json> --out FILE [--commit SHA]
//
// Judges answers that `claude plugin eval --json` already saved, again, with a judge model of your
// choice. `claude plugin eval` has no such option (2.1.318), so two runs with two judges differ in
// their answers as well, and a falling score cannot be pinned on either. This holds the answers
// fixed: the same text goes to each judge, and only the judge (or, with --rubrics, the rubric) moves.
//
// The answers come from the `evidence` field that the result JSON keeps for every `llm` grader (the
// final message of the run). For each answer and each `llm` grader it asks the judge for N votes
// (default 3, majority wins, as `claude plugin eval` does) and prints, per grader, how many answers
// passed in the record and how many pass now, and how often the two agree answer by answer.
//
// --rubrics <dir>  take each rubric from <dir>/<case>/graders/<name>.md, not from the record, to try
//                  a rewritten rubric on the old answers before paying for new ones.
// --case, --grader  judge only the cases and graders whose names match (`*` and `?` are wildcards).
// --trim           write a baseline: the record without what cannot be compared later (traces,
//                  costs, timings), small enough to commit. A baseline is also a valid input.
//                  It is stamped with --commit, the commit the run was made on (default: HEAD now,
//                  which is wrong if the skill or its graders were committed since the run).
//
// THE JUDGE PROMPT HERE IS NOT THE ONE BUILT INTO `claude plugin eval`, which is not published. So
// first re-judge with the model the record was judged with: the agreement it prints says how far
// this script's judge stands in for the built-in one. Read a difference between two judge models
// against that figure, not against 100%.
//
// Each vote is one `claude -p` call with no tools, settings or skills, on your own login. A vote
// costs about US$0.001 with Haiku and US$0.01 with Sonnet. No dependencies.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BASELINE_FORMAT = "bh-eval-baseline/1";

const SYSTEM = "You grade one answer against one criterion. Judge only what the answer says, by the criterion as written. " +
  "Reply with one or two sentences of reasoning, then a last line that is exactly `VERDICT: PASS` or `VERDICT: FAIL`.";

/** The prompt one vote sees. */
export function judgePrompt(criteria, answer) {
  return `<criterion>\n${criteria.trim()}\n</criterion>\n\n<answer>\n${answer}\n</answer>\n\nDoes the answer meet the criterion?`;
}

/** true for PASS, false for FAIL, null when the reply has no verdict line. The last verdict wins. */
export function parseVerdict(text) {
  const all = [...String(text ?? "").matchAll(/VERDICT:\s*\**\s*(PASS|FAIL)\b/gi)];
  return all.length ? all[all.length - 1][1].toUpperCase() === "PASS" : null;
}

/** Majority of the votes that were cast. null when none were, or on a tie. */
export function majority(votes) {
  const cast = votes.filter(v => v !== null);
  const yes = cast.filter(Boolean).length;
  if (!cast.length || yes * 2 === cast.length) return null;
  return yes * 2 > cast.length;
}

/**
 * A result of `claude plugin eval --json`, or a baseline, as a baseline: per case its graders (name,
 * type, rubric) and per arm its runs (the answer once, and each grader's verdict and votes).
 */
export function trim(result, extra = {}) {
  if (result.format === BASELINE_FORMAT) return result;
  const cases = (result.cases ?? []).map(c => ({ c, llm: new Set((c.graders ?? []).filter(g => g.type === "llm").map(g => g.name)) })).map(({ c, llm }) => ({
    name: c.name ?? path.basename(c.dir ?? ""),
    graders: (c.graders ?? []).map(g => ({ name: g.name, type: g.type, ...(g.type === "llm" ? { criteria: g.config?.criteria ?? g.graderMarkdown ?? "" } : {}) })),
    arms: Object.fromEntries(Object.entries(c.arms ?? {}).map(([arm, runs]) => [arm, runs.map(r => ({
      score: r.score ?? null,
      ...(r.error ? { error: String(r.error) } : {}),
      // Only an llm grader's evidence is the answer: another type could record a matched excerpt there.
      answer: (r.graders ?? []).filter(g => llm.has(g.name)).map(g => g.evidence).find(e => typeof e === "string") ?? null,
      graders: (r.graders ?? []).map(g => ({
        name: g.name, passed: g.passed ?? null, scored: g.scored !== false,
        ...(Array.isArray(g.judgeVotes) ? { votes: g.judgeVotes } : {}),
      })),
    }))])),
  }));
  return {
    format: BASELINE_FORMAT,
    startedAt: result.startedAt ?? null,
    claudeVersion: result.claudeVersion ?? null,
    models: { agent: result.suite?.modelOverride ?? null, judge: result.suite?.judgeModel ?? null },
    ablation: result.suite?.ablation ?? null,
    ...extra,
    cases,
  };
}

/** Every (answer, llm grader) pair of a baseline, with what the record said about it. */
export function pairs(baseline, source = "") {
  const out = [];
  for (const c of baseline.cases) {
    const rubric = new Map(c.graders.filter(g => g.type === "llm").map(g => [g.name, g.criteria]));
    for (const [arm, runs] of Object.entries(c.arms)) {
      runs.forEach((r, run) => {
        for (const g of r.graders) {
          if (!rubric.has(g.name) || typeof r.answer !== "string") continue;
          out.push({ source, case: c.name, arm, run, grader: g.name, criteria: rubric.get(g.name), answer: r.answer, recorded: g.passed });
        }
      });
    }
  }
  return out;
}

/** Per case and grader: answers that passed in the record, that pass now, and that got the same verdict both times. */
export function summarise(items) {
  const rows = new Map();
  for (const it of items) {
    const key = `${it.source}\t${it.case}\t${it.arm}\t${it.grader}`;
    const row = rows.get(key) ?? { source: it.source, case: it.case, arm: it.arm, grader: it.grader, n: 0, recorded: 0, now: 0, agree: 0, undecided: 0, split: 0 };
    row.n++;
    if (it.recorded === true) row.recorded++;
    if (it.passed === true) row.now++;
    if (it.passed === null) row.undecided++;
    else if (it.passed === it.recorded) row.agree++;
    if (new Set(it.votes.filter(v => v !== null)).size > 1) row.split++;
    rows.set(key, row);
  }
  return [...rows.values()];
}

function glob(pattern) {
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

/** The body of a grader file: what follows its frontmatter. */
export function rubricBody(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

/** A vote that has not come back in this long is abandoned (and retried once), so one stalled call cannot hang a paid run. */
const VOTE_TIMEOUT_MS = 180_000;

function vote(model, prompt) {
  return new Promise(resolve => {
    const child = spawn("claude", ["-p", "--model", model, "--system-prompt", SYSTEM, "--tools", "", "--disable-slash-commands",
      "--no-session-persistence", "--setting-sources", "", "--output-format", "json"], { stdio: ["pipe", "pipe", "pipe"], timeout: VOTE_TIMEOUT_MS });
    let out = "", err = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    child.on("error", e => resolve({ verdict: null, reason: `could not run claude: ${e.message}`, cost: 0 }));
    child.on("close", () => {
      try {
        const j = JSON.parse(out);
        resolve({ verdict: j.is_error ? null : parseVerdict(j.result), reason: String(j.result ?? "").trim(), cost: j.total_cost_usd ?? 0 });
      } catch {
        resolve({ verdict: null, reason: `unreadable reply: ${(err || out).trim().slice(0, 200)}`, cost: 0 });
      }
    });
    child.stdin.on("error", () => { /* claude exited before reading: `close` reports the vote as undecided */ });
    child.stdin.end(prompt);
  });
}

async function pool(tasks, width) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); }
  }));
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const usage = "usage: node rejudge.mjs <result.json>... --judge-model ID [--votes N] [-j N] [--rubrics <evals dir>] [--case GLOB] [--grader GLOB] [--out FILE]\n" +
    "       node rejudge.mjs --trim <result.json> --out FILE [--commit SHA]";
  const valued = ["--judge-model", "--votes", "-j", "--rubrics", "--case", "--grader", "--out", "--commit"];
  const opt = {}, files = [];
  for (let i = 0; i < argv.length; i++) {
    if (valued.includes(argv[i])) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) { console.error(`${argv[i]} takes a value\n${usage}`); process.exit(2); }
      opt[argv[i]] = argv[++i];
    } else if (argv[i] === "--trim") opt.trim = true;
    else if (argv[i].startsWith("-")) { console.error(`unknown option ${argv[i]}\n${usage}`); process.exit(2); }
    else files.push(argv[i]);
  }
  if (!files.length) { console.error(usage); process.exit(2); }
  const read = f => JSON.parse(fs.readFileSync(f, "utf8"));

  if (opt.trim) {
    if (files.length !== 1 || !opt["--out"]) { console.error(`--trim takes one result and --out\n${usage}`); process.exit(2); }
    let commit = opt["--commit"] ?? null;
    if (!commit) try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not in a repo */ }
    const baseline = trim(read(files[0]), { commit });
    // A skill's first baseline has no evals/baselines/ yet.
    fs.mkdirSync(path.dirname(path.resolve(opt["--out"])), { recursive: true });
    fs.writeFileSync(opt["--out"], JSON.stringify(baseline, null, 1) + "\n");
    const runs = baseline.cases.flatMap(c => Object.values(c.arms).flat());
    console.log(`wrote ${opt["--out"]}: ${baseline.cases.length} cases, ${runs.length} runs, ${runs.filter(r => r.answer === null).length} without a saved answer`);
    return;
  }

  const model = opt["--judge-model"];
  const votes = Number(opt["--votes"] ?? 3), width = Number(opt["-j"] ?? 6);
  if (!model) { console.error(`--judge-model is required\n${usage}`); process.exit(2); }
  if (!Number.isInteger(votes) || votes < 1 || !Number.isInteger(width) || width < 1) { console.error("--votes and -j take whole numbers, 1 or more"); process.exit(2); }

  const only = opt["--case"] ? glob(opt["--case"]) : null, onlyGrader = opt["--grader"] ? glob(opt["--grader"]) : null;
  let items = files.flatMap(f => pairs(trim(read(f)), f)).filter(it => (!only || only.test(it.case)) && (!onlyGrader || onlyGrader.test(it.grader)));
  if (opt["--rubrics"]) {
    for (const it of items) {
      const file = path.join(opt["--rubrics"], it.case, "graders", `${it.grader}.md`);
      if (!fs.existsSync(file)) { console.error(`no rubric ${file}`); process.exit(2); }
      it.criteria = rubricBody(fs.readFileSync(file, "utf8"));
    }
  }
  // What the totals below leave out is said, so a smaller n is not read as the whole run.
  for (const f of files) {
    const b = trim(read(f));
    const lost = b.cases.filter(c => !only || only.test(c.name)).flatMap(c => Object.values(c.arms).flat()).filter(r => typeof r.answer !== "string").length;
    if (lost) console.error(`note: ${f}: ${lost} run(s) have no saved answer (errored, or no llm grader) and are left out; their graders failed in the record`);
    if (opt["--rubrics"]) for (const c of b.cases.filter(c => !only || only.test(c.name))) {
      const dir = path.join(opt["--rubrics"], c.name, "graders");
      const known = new Set(c.graders.map(g => g.name));
      const added = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith(".md")).map(n => n.slice(0, -3)).filter(n => !known.has(n)) : [];
      if (added.length) console.error(`note: ${c.name}: not in the record, so not judged: ${added.join(", ")} (a new or renamed grader needs a new run)`);
    }
  }
  if (!items.length) { console.error("no answer with an llm grader in the input: was it written with --json?"); process.exit(2); }

  let cost = 0;
  const cast = await pool(items.flatMap((it, i) => Array.from({ length: votes }, () => async () => {
    let v = await vote(model, judgePrompt(it.criteria, it.answer));
    if (v.verdict === null) { cost += v.cost; v = await vote(model, judgePrompt(it.criteria, it.answer)); }  // one retry
    cost += v.cost;
    return { i, ...v };
  })), width);
  items = items.map((it, i) => {
    const mine = cast.filter(v => v.i === i);
    return { ...it, votes: mine.map(v => v.verdict), passed: majority(mine.map(v => v.verdict)), reasons: mine.map(v => v.reason) };
  });

  const rows = summarise(items);
  const label = r => `${files.length > 1 ? `${r.source} ` : ""}${r.case} ${r.grader}`;
  const w = Math.max(...rows.map(r => label(r).length));
  console.log(`judge ${model}, ${votes} votes each${opt["--rubrics"] ? `, rubrics from ${opt["--rubrics"]}` : ", rubrics as recorded"}\n`);
  console.log(`${"case and grader".padEnd(w)}  arm      recorded  now    same verdict  split votes`);
  for (const r of rows) {
    console.log(`${label(r).padEnd(w)}  ${r.arm.padEnd(7)}  ${`${r.recorded}/${r.n}`.padEnd(8)}  ${`${r.now}/${r.n}`.padEnd(5)}  ${`${r.agree}/${r.n}`.padEnd(12)}  ${r.split}/${r.n}${r.undecided ? `  (${r.undecided} undecided)` : ""}`);
  }
  const sum = (k, from = rows) => from.reduce((a, r) => a + r[k], 0);
  if (files.length > 1) console.log("");
  if (files.length > 1) for (const f of files) {
    const mine = rows.filter(r => r.source === f);
    console.log(`${f}: ${sum("recorded", mine)}/${sum("n", mine)} passed in the record, ${sum("now", mine)}/${sum("n", mine)} pass now`);
  }
  console.log(`\n${sum("n")} answer and grader pairs: ${sum("recorded")} passed in the record, ${sum("now")} pass now, ` +
    `${sum("agree")} got the same verdict (${(100 * sum("agree") / sum("n")).toFixed(0)}%), ${sum("split")} had split votes` +
    `${sum("undecided") ? `, ${sum("undecided")} undecided` : ""}. Cost US$${cost.toFixed(2)}.`);

  if (opt["--out"]) {
    fs.writeFileSync(opt["--out"], JSON.stringify({ format: "bh-rejudge/1", judgeModel: model, votes, rubrics: opt["--rubrics"] ?? "recorded", costUsd: cost,
      items: items.map(({ criteria, answer, ...rest }) => rest) }, null, 1) + "\n");
  }
  if (sum("undecided")) process.exit(1);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
