import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.claude/skills/skill-authoring/scripts/rejudge.mjs");
/** One answer against one llm grader, as rejudge.mjs lists them. */
interface Pair { case: string; arm: string; run: number; grader: string; criteria: string; answer: string; recorded: boolean | null }
// The script is plain JavaScript with no declarations, so the import is untyped: the tests name the shapes they use.
const { parseVerdict, majority, trim, pairs: untypedPairs, summarise, rubricBody, judgePrompt, BASELINE_FORMAT } = await import(script);
const pairs = (baseline: unknown): Pair[] => untypedPairs(baseline);

/** A result as `claude plugin eval --json` writes it: one case, one arm, two runs, a regex and two llm graders. */
function result() {
  const run = (answer: string, a: boolean, b: boolean) => ({
    score: 0.5, costUsd: 0.07, tracePath: "/tmp/e-x/out/trace.jsonl", durationSeconds: 40,
    graders: [
      { name: "01-regex", passed: true, scored: true, explanation: "matched" },
      { name: "02-point", passed: a, scored: true, judgeVotes: [a, a, !a], evidence: answer },
      { name: "03-caption", passed: b, scored: true, judgeVotes: [b, b, b], evidence: answer },
      { name: "skill-fired", passed: true, scored: false },
    ],
  });
  return {
    schemaVersion: 1, claudeVersion: "2.1.318", startedAt: "2026-11-18T00:00:00.000Z", costUsd: 1,
    suite: { ablation: "none", modelOverride: "claude-sonnet-5-5", judgeModel: "claude-haiku-5-5" },
    cases: [{
      name: "design", dir: "/x/evals/design",
      graders: [
        { name: "01-regex", type: "regex", config: { pattern: "bh-stepper" } },
        { name: "02-point", type: "llm", config: { criteria: "PASS if it states the point." } },
        { name: "03-caption", type: "llm", config: { criteria: "PASS if it has a caption." } },
        { name: "skill-fired", type: "tool_used", config: { tool: "Skill" } },
      ],
      arms: { with: [run("answer one", true, false), run("answer two", false, false)] },
    }],
  };
}

test("parseVerdict reads the last verdict line, and nothing else as a verdict", () => {
  assert.equal(parseVerdict("It does.\n\nVERDICT: PASS"), true);
  assert.equal(parseVerdict("Reason.\nVERDICT: **FAIL**"), false);
  assert.equal(parseVerdict("At first VERDICT: PASS, but no.\nVERDICT: FAIL"), false);
  assert.equal(parseVerdict("PASS, I think"), null);
  assert.equal(parseVerdict(undefined), null);
});

test("majority counts only the votes that were cast, and a tie decides nothing", () => {
  assert.equal(majority([true, true, false]), true);
  assert.equal(majority([false, null, false]), false);
  assert.equal(majority([true, false, null]), null);
  assert.equal(majority([null, null, null]), null);
});

test("trim keeps the answer once per run with each verdict, and drops traces, costs and timings", () => {
  const b = trim(result(), { commit: "abc" });
  assert.equal(b.format, BASELINE_FORMAT);
  assert.deepEqual(b.models, { agent: "claude-sonnet-5-5", judge: "claude-haiku-5-5" });
  assert.equal(b.commit, "abc");
  assert.deepEqual(b.cases[0].graders[1], { name: "02-point", type: "llm", criteria: "PASS if it states the point." });
  const run = b.cases[0].arms.with[0];
  assert.equal(run.answer, "answer one");
  assert.deepEqual(run.graders[1], { name: "02-point", passed: true, scored: true, votes: [true, true, false] });
  assert.equal(run.graders[3].scored, false);
  const text = JSON.stringify(b);
  for (const gone of ["tracePath", "costUsd", "durationSeconds", "evidence"]) assert.ok(!text.includes(gone), gone);
  assert.equal(text.split("answer one").length - 1, 1);
  assert.deepEqual(trim(b), b, "a baseline is returned as it is");

  // Evidence on a grader that is not an llm grader (a matched excerpt, say) is not the answer.
  const r = result();
  Object.assign(r.cases[0].arms.with[0].graders[0], { evidence: "bh-stepper" });
  assert.equal(trim(r).cases[0].arms.with[0].answer, "answer one");
});

test("pairs lists each answer against each llm grader only, from a result or from its baseline", () => {
  const fromResult = pairs(trim(result()));
  assert.equal(fromResult.length, 4);
  assert.deepEqual(fromResult.map(p => `${p.run} ${p.grader} ${p.recorded}`), ["0 02-point true", "0 03-caption false", "1 02-point false", "1 03-caption false"]);
  assert.equal(fromResult[2].answer, "answer two");
  assert.equal(fromResult[0].criteria, "PASS if it states the point.");
  assert.deepEqual(pairs(trim(trim(result()))), fromResult);
});

test("summarise counts agreement answer by answer, not by totals", () => {
  const items = pairs(trim(result())).map((p, i) => ({ ...p, votes: i === 0 ? [false, false, true] : i === 2 ? [true, true, true] : [false, false, false], passed: i === 2 }));
  const [point, caption] = summarise(items);
  // 02-point: the record passed run 0 and failed run 1; the new judge does the opposite. Same total, no agreement.
  assert.deepEqual({ ...point }, { source: "", case: "design", arm: "with", grader: "02-point", n: 2, recorded: 1, now: 1, agree: 0, undecided: 0, split: 1 });
  assert.equal(caption.agree, 2);
});

test("rubricBody strips the frontmatter, and the prompt carries rubric and answer", () => {
  assert.equal(rubricBody("---\ntype: llm\n---\n\nPASS if x.\nFAIL if not.\n"), "PASS if x.\nFAIL if not.");
  const p = judgePrompt("PASS if x.", "the answer");
  assert.ok(p.includes("PASS if x.") && p.includes("the answer"));
});

/** A `claude` that votes PASS when the prompt on stdin contains FAKE_PASS_IF, and logs its arguments. */
function fakeClaude(dir: string) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), `#!/usr/bin/env node
const fs = require("fs");
const prompt = fs.readFileSync(0, "utf8");
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
const pass = prompt.includes(process.env.FAKE_PASS_IF);
console.log(JSON.stringify({ result: "Because.\\nVERDICT: " + (pass ? "PASS" : "FAIL"), total_cost_usd: 0.01 }));
`, { mode: 0o755 });
  return bin;
}

test("the command re-judges saved answers with the named model, and --rubrics swaps the rubric", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rejudge-test-"));
  try {
    const bin = fakeClaude(dir), input = path.join(dir, "run.json"), out = path.join(dir, "out.json"), log = path.join(dir, "log");
    fs.writeFileSync(input, JSON.stringify(result()));
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_LOG: log, FAKE_PASS_IF: "answer one" };
    const res = spawnSync("node", [script, input, "--judge-model", "claude-sonnet-5-5", "--out", out], { env, encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map(l => JSON.parse(l));
    assert.equal(calls.length, 12, "2 answers x 2 llm graders x 3 votes");
    assert.ok(calls.every(a => a[a.indexOf("--model") + 1] === "claude-sonnet-5-5"));
    const written = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.deepEqual(written.items.map((i: { passed: boolean }) => i.passed), [true, true, false, false]);
    assert.ok(!("answer" in written.items[0]));
    assert.match(res.stdout, /design 02-point\s+with\s+1\/2\s+1\/2\s+2\/2/);
    assert.match(res.stdout, /design 03-caption\s+with\s+0\/2\s+1\/2\s+1\/2/);

    // A rubric file that carries the trigger text makes every vote PASS.
    const graders = path.join(dir, "evals", "design", "graders");
    fs.mkdirSync(graders, { recursive: true });
    for (const g of ["02-point", "03-caption"]) fs.writeFileSync(path.join(graders, `${g}.md`), "---\ntype: llm\n---\n\nPASS if NEW-RUBRIC holds.\n");
    const swapped = spawnSync("node", [script, input, "--judge-model", "m", "--rubrics", path.join(dir, "evals")], { env: { ...env, FAKE_PASS_IF: "NEW-RUBRIC" }, encoding: "utf8" });
    assert.equal(swapped.status, 0, swapped.stderr);
    assert.match(swapped.stdout, /4 pass now/);

    // --case and --grader narrow what is judged.
    fs.rmSync(log);
    const narrowed = spawnSync("node", [script, input, "--judge-model", "m", "--case", "des*", "--grader", "02*"], { env, encoding: "utf8" });
    assert.equal(narrowed.status, 0, narrowed.stderr);
    assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 6, "2 answers x 1 grader x 3 votes");
    assert.equal(spawnSync("node", [script, input, "--judge-model", "m", "--case", "other"], { env, encoding: "utf8" }).status, 2, "nothing matched");

    // A grader file the record does not have is named, not silently skipped; a run with no answer is counted.
    fs.writeFileSync(path.join(graders, "09-new.md"), "---\ntype: llm\n---\n\nPASS if NEW-RUBRIC.\n");
    const lossy = result();
    for (const g of lossy.cases[0].arms.with[1].graders) delete (g as { evidence?: string }).evidence;
    fs.writeFileSync(input, JSON.stringify(lossy));
    const noted = spawnSync("node", [script, input, "--judge-model", "m", "--rubrics", path.join(dir, "evals")], { env: { ...env, FAKE_PASS_IF: "NEW-RUBRIC" }, encoding: "utf8" });
    assert.equal(noted.status, 0, noted.stderr);
    assert.match(noted.stderr, /1 run\(s\) have no saved answer/);
    assert.match(noted.stderr, /not in the record, so not judged: 09-new/);
    assert.match(noted.stdout, /2 answer and grader pairs/);

    const missing = spawnSync("node", [script, input, "--judge-model", "m", "--rubrics", path.join(dir, "nowhere")], { env, encoding: "utf8" });
    assert.equal(missing.status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("--trim writes a baseline that the command accepts as input", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rejudge-test-"));
  try {
    const bin = fakeClaude(dir), input = path.join(dir, "run.json"), base = path.join(dir, "baseline.json");
    fs.writeFileSync(input, JSON.stringify(result()));
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_LOG: path.join(dir, "log"), FAKE_PASS_IF: "answer" };
    assert.equal(spawnSync("node", [script, "--trim", input, "--out", base], { env, encoding: "utf8" }).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(base, "utf8")).format, BASELINE_FORMAT);
    const res = spawnSync("node", [script, base, "--judge-model", "m"], { env, encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /4 answer and grader pairs: 1 passed in the record, 4 pass now/);

    // Two inputs are reported apart, so a judge that moved one run and not the other shows.
    const two = spawnSync("node", [script, input, base, "--judge-model", "m"], { env, encoding: "utf8" });
    assert.equal(two.status, 0, two.stderr);
    assert.match(two.stdout, new RegExp(`${base.replace(/[.\\/]/g, "\\$&")}: 1/4 passed in the record, 4/4 pass now`));
    assert.match(two.stdout, /8 answer and grader pairs/);

    // --commit stamps the baseline with the commit the run was made on.
    assert.equal(spawnSync("node", [script, "--trim", input, "--out", base, "--commit", "abc123"], { env, encoding: "utf8" }).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(base, "utf8")).commit, "abc123");
    assert.equal(spawnSync("node", [script, base], { env, encoding: "utf8" }).status, 2, "no judge model");

    // A skill's first baseline goes in a directory that does not exist yet.
    const fresh = path.join(dir, "evals", "baselines", "first.json");
    const made = spawnSync("node", [script, "--trim", input, "--out", fresh], { env, encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    assert.equal(JSON.parse(fs.readFileSync(fresh, "utf8")).format, BASELINE_FORMAT);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
