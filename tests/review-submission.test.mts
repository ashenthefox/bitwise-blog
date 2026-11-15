// The route from a page's "Submit on GitHub" to a pull request into reviews/inbox/: the issue form,
// the workflow and scripts/review-submission.mts. The issue body is hostile input, so most of this
// is about what the workflow refuses and what it never does with it. No network: GitHub's API is a fake.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { schemaProblems, readSchema, SCHEMA_KEYWORDS, SCHEMA_ANNOTATIONS, reviewProblems, type Schema } from "../scripts/reviews.mts";
import {
  dispatchChecks, withdrawPullRequest, refreshSubmissions, pullRequestBody, main, extractReview, validateSubmission, prepareSubmission, applySubmission, reportBody, codeBlock, postReport, proposePullRequest,
  reviewPath, branchFor, GENERATED, MARKER, BOT_LOGIN, LABEL, FIELD_LABEL, MAX_REVIEW_BYTES, type Fetch, type SubmissionResult,
} from "../scripts/review-submission.mts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const document = "docs/edge-rate-limiting-design.html";
const comment = { id: "sub-root", created: "2026-11-01T09:00:00Z", kind: "question", body: "Why?", target: { anchor: "", anchorKind: "top", quote: null } };
const review = (extra: Record<string, unknown> = {}, comments: unknown[] = [comment]) => ({ format: "bh-review/1", document, build: { commit: null }, reviewer: "Reader", comments, ...extra });
/** An issue body as GitHub writes it from the form: the field's heading, then the json fence `render: json` adds. */
const formBody = (json: string, eol = "\n") => [`### ${FIELD_LABEL}`, "", "```json", json, "```"].join(eol);

/** A small site: one public page, one sealed page, the schema, and one review already merged. */
function miniSite(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-submission-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "docs"));
  fs.mkdirSync(path.join(dir, "reviews/inbox"), { recursive: true });
  fs.writeFileSync(path.join(dir, document), "<!doctype html><title>Public</title>");
  fs.writeFileSync(path.join(dir, "docs/secret.html"), '<!doctype html><meta name="bh:sealed" content="aes-256-gcm+gzip"><title>Private page</title>');
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  fs.copyFileSync(path.join(source, "reviews/schema.json"), path.join(dir, "reviews/schema.json"));
  fs.writeFileSync(path.join(dir, "reviews/inbox/merged.json"), JSON.stringify(review({}, [{ ...comment, id: "merged-1" }])));
  return dir;
}

/** A copy of the real site, for the steps that run `bh.mts`. */
function siteCopy(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-submission-site-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ["scripts", "theme", "docs", "templates", "index.html", "feed.xml", "sitemap.xml", "robots.txt", "404.html", "package.json", "README.md", "reviews/schema.json"]) {
    fs.cpSync(path.join(source, name), path.join(dir, name), { recursive: true });
  }
  return dir;
}

// ---- the schema validator -----------------------------------------------------------------

test("the validator enforces every keyword reviews/schema.json uses", () => {
  const unknown = new Set<string>();
  const walk = (s: Schema) => {
    for (const [k, v] of Object.entries(s)) {
      if (!SCHEMA_KEYWORDS.includes(k) && !SCHEMA_ANNOTATIONS.includes(k)) unknown.add(k);
      if (k === "properties") Object.values(v as Record<string, Schema>).forEach(walk);
      if (k === "items") walk(v as Schema);
      if (k === "anyOf") (v as Schema[]).forEach(walk);
    }
  };
  walk(readSchema(source));
  assert.deepEqual([...unknown], [], "schema keywords schemaProblems ignores");
});

test("schema messages name the path and never repeat the file's text", () => {
  const schema = readSchema(source);
  assert.deepEqual(schemaProblems(review(), schema), []);
  const cases: [unknown, RegExp][] = [
    [review({ format: "other" }), /^format must be "bh-review\/1"$/],
    [review({ document: 42 }), /^document must be a string$/],
    [review({ comments: "x" }), /^comments must be an array$/],
    [{ format: "bh-review/1", document, comments: [] }, /^the file needs "build"$/],
    [review({}, [{ ...comment, kind: "<b>shout</b>" }]), /^comments\[0\]\.kind must be one of "comment", "suggestion", "question", "blocker"$/],
    [review({}, [{ ...comment, body: "" }]), /^comments\[0\]\.body must not be empty$/],
    [review({}, [{ ...comment, created: "yesterday" }]), /^comments\[0\]\.created must be an ISO date-time/],
    [review({}, [{ ...comment, target: undefined }]), /^comments\[0\] needs "target" or "inReplyTo"$/],
    [review({}, [{ ...comment, target: { anchor: "", anchorKind: "top", quote: { exact: 1, prefix: "", suffix: "" } } }]), /^comments\[0\]\.target\.quote\.exact must be a string$/],
    [review({}, [{ ...comment, target: { ...comment.target, position: { start: 1.5, end: 2 } } }]), /^comments\[0\]\.target\.position\.start must be an integer$/],
  ];
  for (const [value, expected] of cases) {
    const problems = schemaProblems(JSON.parse(JSON.stringify(value)), schema);
    assert.equal(problems.length, 1, `${expected}: ${problems.join(" | ")}`);
    assert.match(problems[0], expected);
    assert.doesNotMatch(problems[0], /shout|yesterday/);
  }
});

// ---- reading the issue ----------------------------------------------------------------------

test("the review comes out of the form's fenced field, whatever the line endings or extra fences", () => {
  const json = JSON.stringify(review(), null, 2);
  for (const body of [formBody(json), formBody(json, "\r\n"), "﻿" + formBody(json), formBody("```json\n" + json + "\n```"), json, `### ${FIELD_LABEL}\n\n${json}\n\n### Other\n\nmore`]) {
    const got = extractReview(body);
    assert.ok("json" in got, JSON.stringify(got));
    assert.deepEqual(JSON.parse(got.json), review());
  }
  for (const body of [undefined, "", formBody("_No response_"), `### ${FIELD_LABEL}\n\n_No response_\n`]) assert.match((extractReview(body) as { problem: string }).problem, /empty/);
  assert.match((extractReview("x".repeat(70_000)) as { problem: string }).problem, /longer than GitHub allows/);
  const big = formBody(JSON.stringify(review({ title: "x".repeat(MAX_REVIEW_BYTES) })));
  assert.match((extractReview(big) as { problem: string }).problem, /reviews\/inbox\/ in a pull request/);
});

// ---- validation: the same rules as `check` ----------------------------------------------------------

test("a valid review passes and is checked as reviews/inbox/issue-<n>.json", (t) => {
  const root = miniSite(t);
  const got = validateSubmission(root, formBody(JSON.stringify(review())), 7);
  assert.deepEqual(got.problems, []);
  assert.equal(got.ok, true);
  assert.equal(got.comments, 1);
  assert.equal(reviewPath(7), "reviews/inbox/issue-7.json");
  assert.equal(branchFor(7), "review-submission/issue-7");
  assert.throws(() => validateSubmission(root, "", 0), /issue number/);
  assert.throws(() => validateSubmission(root, "", "7" as unknown as number), /issue number/);
});

test("reviews of private and sealed pages are refused, as `check` refuses them", (t) => {
  const root = miniSite(t);
  for (const doc of ["docs/secret.private.html", "docs/SECRET.PRIVATE.HTML", "docs/secret.html", "./docs/secret.html"]) {
    const got = validateSubmission(root, formBody(JSON.stringify(review({ document: doc }))), 7);
    assert.equal(got.ok, false, doc);
    assert.match(got.problems.join("\n"), /a private page/, doc);
    // `check` says the same about the same file.
    fs.writeFileSync(path.join(root, "reviews/inbox/check-me.json"), JSON.stringify(review({ document: doc })));
    assert.match(reviewProblems(root).join("\n"), /check-me\.json: reviews ".*", a private page/);
    fs.rmSync(path.join(root, "reviews/inbox/check-me.json"));
  }
});

test("bad input is refused with a reason, and the file name never comes from the input", (t) => {
  const root = miniSite(t);
  const refuse = (body: string, expected: RegExp) => {
    const got = validateSubmission(root, body, 12);
    assert.equal(got.ok, false, body.slice(0, 80));
    assert.match(got.problems.join("\n"), expected);
    for (const p of got.problems) assert.ok(!p.startsWith("reviews/") || p.startsWith("reviews/inbox/issue-12.json:"), p);
  };
  refuse(formBody("{not json"), /not valid JSON/);
  refuse(formBody("[1, 2]"), /must be a JSON object/);
  refuse(formBody(JSON.stringify(review({ document: "../../etc/passwd" }))), /is not a page in docs\//);
  refuse(formBody(JSON.stringify(review({ document: "package.json" }))), /is not a page in docs\//);
  refuse(formBody(JSON.stringify(review({ document: "docs/missing.html" }))), /doesn't exist/);
  refuse(formBody(JSON.stringify(review({}, [{ ...comment, id: "merged-1", body: "Changed" }]))), /id "merged-1" is also used in reviews\/inbox\/merged\.json/);
  refuse(formBody(JSON.stringify(review({}, [{ ...comment, id: "r", inReplyTo: "nowhere", target: undefined }]))), /replies to "nowhere"/);
  refuse(formBody(JSON.stringify(review({}, []))), /has no comments/);
  // An unchanged copy of a merged message is not a conflict: re-submitting is safe.
  assert.equal(validateSubmission(root, formBody(JSON.stringify(review({}, [{ ...comment, id: "merged-1" }, comment]))), 12).ok, true);
});

test("validate stages the review and its regenerated data, and `check` passes on the result", (t) => {
  const root = siteCopy(t), out = path.join(root, "..", path.basename(root) + "-out");
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const result = prepareSubmission(root, formBody(JSON.stringify(review())), 31, out);
  assert.equal(result.ok, true, result.problems.join("\n"));
  const staged = fs.readdirSync(path.join(out, "files"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(path.join(out, "files"), path.join(e.parentPath, e.name))).sort();
  assert.deepEqual(staged, ["reviews/inbox/issue-31.json", ...GENERATED].sort());
  const context: Record<string, any> = {};
  vm.runInNewContext(fs.readFileSync(path.join(out, "files/theme/reviews.js"), "utf8"), { window: context });
  assert.equal(context.BH_REVIEWS[document][0].id, comment.id);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, "result.json"), "utf8")), { ok: true, number: 31, problems: [], document, comments: 1 });
  const check = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "check"], { cwd: root, encoding: "utf8", timeout: 170_000 });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /reviews \(1 file\)/);
});

test("the validate command reads the issue from the event file and stages nothing for an invalid review", (t) => {
  const root = siteCopy(t), out = path.join(root, "out"), eventFile = path.join(root, "event.json"), outputFile = path.join(root, "output.txt");
  fs.writeFileSync(eventFile, JSON.stringify({ issue: { number: 5, body: formBody(JSON.stringify(review({ document: "docs/x.private.html" }))) } }));
  const run = spawnSync(process.execPath, [path.join(root, "scripts/review-submission.mts"), "validate", "--out", out], {
    cwd: root, encoding: "utf8", timeout: 60_000, env: { ...process.env, GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: outputFile },
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(fs.readFileSync(outputFile, "utf8"), "ok=false\n", run.stdout + run.stderr);
  assert.equal(fs.existsSync(path.join(out, "files")), false);
  assert.equal(fs.existsSync(path.join(root, "reviews/inbox/issue-5.json")), false);
  assert.match(JSON.parse(fs.readFileSync(path.join(out, "result.json"), "utf8")).problems[0], /a private page/);
});

test("apply copies only the fixed paths, and refuses a link in their place", (t) => {
  const from = fs.mkdtempSync(path.join(os.tmpdir(), "bh-staged-")), root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-apply-"));
  t.after(() => { fs.rmSync(from, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  for (const p of [reviewPath(9), ...GENERATED, ".github/workflows/evil.yml", "reviews/inbox/other.json"]) {
    fs.mkdirSync(path.dirname(path.join(from, "files", p)), { recursive: true });
    fs.writeFileSync(path.join(from, "files", p), "{}");
  }
  assert.deepEqual(applySubmission(root, from, 9), [reviewPath(9), ...GENERATED]);
  assert.equal(fs.existsSync(path.join(root, ".github")), false);
  assert.equal(fs.existsSync(path.join(root, "reviews/inbox/other.json")), false);
  fs.rmSync(path.join(from, "files/theme/site.js"));
  fs.symlinkSync("/etc/hosts", path.join(from, "files/theme/site.js"));
  assert.throws(() => applySubmission(root, from, 9), /theme\/site\.js is not a file/);
});

// ---- the reply on the issue ------------------------------------------------------------------------

test("problems are shown as plain text: no markup, links or mentions from the input can render", () => {
  const hostile = ["docs/x.html\" doesn't exist ```` <img src=x onerror=alert(1)> @someone #1 [link](https://evil.example)", "‮reversed\u0007 bell", "x".repeat(1000)];
  const body = reportBody({ result: { ok: false, number: 3, problems: hostile }, validate: "success" });
  assert.ok(body.startsWith(MARKER + "\n"));
  const block = body.match(/^(`{5,})text\n([\s\S]*?)\n\1$/m);
  assert.ok(block, "the problems sit in a fence longer than any backtick run inside");
  const outside = body.replace(block[0], "");
  for (const s of ["<img", "@someone", "evil.example", "onerror"]) assert.ok(!outside.includes(s), s);
  assert.ok(!block[2].includes("‮") && !block[2].includes("\u0007"));
  assert.ok(block[2].split("\n").every((l) => [...l].length <= 300));
  assert.match(codeBlock(Array.from({ length: 40 }, (_, i) => `p${i}`)), /… and 10 more\n```$/);
});

test("the reply links the pull request, or the compare page while Actions may not open one", () => {
  const ok: SubmissionResult = { ok: true, number: 4, problems: [], document, comments: 2 };
  assert.match(reportBody({ result: ok, validate: "success", prUrl: "https://github.com/o/r/pull/12" }), /2 comments on `docs\/edge-rate-limiting-design\.html`\) passed the checks, and https:\/\/github\.com\/o\/r\/pull\/12 proposes/);
  assert.match(reportBody({ result: ok, validate: "success", compareUrl: "https://github.com/o/r/compare/main...review-submission/issue-4?expand=1" }), /a maintainer will \[open the pull request\]\(https:\/\/github\.com\/o\/r\/compare\/main\.\.\.review-submission\/issue-4\?expand=1\)/);
  assert.match(reportBody({ result: ok, validate: "success", prUrl: "javascript:alert(1)" }), /proposing it as a pull request failed/);
  assert.match(reportBody({ result: { ...ok, document: "docs/`x`.html" }, validate: "success", prUrl: "https://github.com/o/r/pull/1" }), /\(2 comments\) passed/);
  assert.match(reportBody({ result: null, validate: "failure", runUrl: "https://github.com/o/r/actions/runs/9" }), /could not run \(\[workflow run\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/9\)\)/);
});

/** A fake GitHub API: answers by method and path, and records every call. */
function fakeApi(routes: Record<string, (body: any) => [number, unknown]>) {
  const calls: { method: string; url: string; body: any }[] = [];
  const fetch: Fetch = async (url, init = {}) => {
    const method = init.method ?? "GET", body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const route = Object.keys(routes).find((r) => `${method} ${url}`.startsWith(r));
    const [status, data] = route ? routes[route](body) : [404, { message: "Not Found" }];
    return { ok: status < 300, status, json: async () => data };
  };
  return { fetch, calls };
}
const API = "https://api.github.com/repos/o/r";

test("a re-run edits the workflow's own reply instead of adding another", async () => {
  const theirs = { id: 1, body: MARKER + "\nfake", user: { login: "someone" } }, mine = { id: 2, body: MARKER + "\nold", user: { login: BOT_LOGIN } };
  let api = fakeApi({ [`GET ${API}/issues/4/comments`]: () => [200, [theirs, mine]], [`PATCH ${API}/issues/comments/2`]: () => [200, { html_url: "u" }] });
  await postReport({ repo: "o/r", token: "t", fetch: api.fetch }, 4, "new");
  assert.deepEqual(api.calls.map((c) => c.method), ["GET", "PATCH"]);
  api = fakeApi({ [`GET ${API}/issues/4/comments`]: () => [200, [theirs]], [`POST ${API}/issues/4/comments`]: () => [201, { html_url: "u" }] });
  await postReport({ repo: "o/r", token: "t", fetch: api.fetch }, 4, "new");
  assert.deepEqual(api.calls.map((c) => c.method), ["GET", "POST"]);
  assert.equal(api.calls[1].body.body, "new");
});

test("the pull request is opened, reused, or replaced by a compare link when GitHub refuses", async () => {
  const result: SubmissionResult = { ok: true, number: 8, problems: [], document, comments: 1 };
  const refused = fakeApi({ [`GET ${API}/pulls`]: () => [200, []], [`POST ${API}/pulls`]: () => [403, { message: "GitHub Actions is not permitted to create or approve pull requests." }] });
  const got = await proposePullRequest({ repo: "o/r", token: "t", fetch: refused.fetch }, result, "main");
  assert.equal(got.compareUrl, "https://github.com/o/r/compare/main...review-submission/issue-8?expand=1");
  assert.match(got.reason!, /403: GitHub Actions is not permitted/);
  const post = refused.calls[1].body;
  assert.equal(post.head, "review-submission/issue-8");
  assert.equal(post.base, "main");
  assert.match(post.body, /Closes #8/);
  assert.match(post.body, /started CI on this branch/);
  const made = fakeApi({ [`GET ${API}/pulls`]: () => [200, []], [`POST ${API}/pulls`]: () => [201, { html_url: "https://github.com/o/r/pull/77" }] });
  assert.deepEqual(await proposePullRequest({ repo: "o/r", token: "t", fetch: made.fetch }, result, "main"), { prUrl: "https://github.com/o/r/pull/77" });
  const open = fakeApi({ [`GET ${API}/pulls`]: () => [200, [{ html_url: "https://github.com/o/r/pull/5" }]] });
  assert.deepEqual(await proposePullRequest({ repo: "o/r", token: "t", fetch: open.fetch }, result, "main"), { prUrl: "https://github.com/o/r/pull/5" });
  assert.equal(open.calls.length, 1);
  assert.match(open.calls[0].url, /head=o%3Areview-submission%2Fissue-8/);
});

// ---- the workflow, the form and the page agree, and the workflow stays narrow ---------------------------------

interface Step { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> }
interface Job { if?: string; needs?: string | string[]; permissions?: Record<string, string>; "timeout-minutes"?: number; steps: Step[] }
const workflow = parse(fs.readFileSync(path.join(source, ".github/workflows/review-submission.yml"), "utf8")) as { on: Record<string, { types: string[] }>; permissions: unknown; jobs: Record<string, Job> };

test("no untrusted issue text reaches a script, and each job has only the permissions it needs", () => {
  assert.deepEqual(workflow.on, { issues: { types: ["opened", "edited", "reopened", "closed"] } });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.fromEntries(Object.entries(workflow.jobs).map(([name, job]) => [name, job.permissions])), {
    validate: { contents: "read" },
    propose: { contents: "write", "pull-requests": "write", actions: "write" },
    withdraw: { contents: "write", "pull-requests": "write" },
    cleanup: { contents: "write", "pull-requests": "write" },
    report: { contents: "read", issues: "write" },
  });
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.ok(job["timeout-minutes"] && job["timeout-minutes"] <= 10, `${name} has a short timeout`);
    for (const step of job.steps) {
      assert.doesNotMatch(step.run ?? "", /\$\{\{/, `${name}: no expression inside a script`);
      for (const value of Object.values(step.env ?? {})) assert.doesNotMatch(String(value), /github\.event/, `${name}: no event text in an env var`);
    }
  }
  assert.match(workflow.jobs.validate.if!, new RegExp(`contains\\(github\\.event\\.issue\\.labels\\.\\*\\.name, '${LABEL}'\\)`));
  assert.equal(workflow.jobs.propose.if, "needs.validate.outputs.ok == 'true'");
  assert.equal(workflow.jobs.withdraw.if, "needs.validate.outputs.ok == 'false'");
  // A closed issue runs only `cleanup`: the others would parse or reply on an issue nobody is reading.
  assert.match(workflow.jobs.validate.if!, /github\.event\.issue\.state == 'open'/);
  assert.match(workflow.jobs.report.if!, /needs\.validate\.result != 'skipped'/);
  assert.equal(workflow.jobs.cleanup.if, `github.event.action == 'closed' && contains(github.event.issue.labels.*.name, '${LABEL}')`);
  assert.equal(workflow.jobs.cleanup.needs, undefined);
  assert.deepEqual(workflow.jobs.cleanup.steps.filter((s) => s.run).map((s) => s.run), ["node scripts/review-submission.mts cleanup"]);
  assert.equal(workflow.jobs.cleanup.steps.find((s) => s.uses?.startsWith("actions/checkout"))?.with?.["persist-credentials"], false);
  // The jobs that can write never run code on the issue's text: they only copy validate's fixed list of files.
  for (const name of ["propose", "withdraw", "cleanup"]) assert.ok(!workflow.jobs[name].steps.some((s) => /\bvalidate\b/.test(s.run ?? "")), name);
  // Only the read-only job runs code on the issue's text; it keeps no token in the checkout.
  assert.equal(workflow.jobs.validate.steps.find((s) => s.uses?.startsWith("actions/checkout"))?.with?.["persist-credentials"], false);
});

test("the issue form, the script and the page's Submit button agree on the label and the field", () => {
  const form = parse(fs.readFileSync(path.join(source, ".github/ISSUE_TEMPLATE/review-submission.yml"), "utf8")) as { labels: string[]; body: { type: string; id?: string; attributes: { label?: string; render?: string } }[] };
  assert.deepEqual(form.labels, [LABEL]);
  const field = form.body.find((b) => b.type === "textarea")!;
  assert.equal(field.attributes.label, FIELD_LABEL);
  assert.equal(field.attributes.render, "json");
  const page = fs.readFileSync(path.join(source, "theme/modules/review.js"), "utf8");
  assert.match(page, new RegExp(`ISSUE_FORM = "review-submission\\.yml", ISSUE_FIELD = "${field.id}"`));
  assert.match(page, new RegExp(`MAX_ISSUE_REVIEW = ${MAX_REVIEW_BYTES}\\b`));
});

// ---- edits, re-submissions and a broken checkout -----------------------------------------------------

test("an edit replaces the issue's own earlier file instead of colliding with it", (t) => {
  const root = miniSite(t);
  fs.writeFileSync(path.join(root, reviewPath(12)), JSON.stringify(review({}, [{ ...comment, id: "mine" }])));
  assert.equal(validateSubmission(root, formBody(JSON.stringify(review({}, [{ ...comment, id: "mine", body: "Edited" }]))), 12).ok, true);
  assert.equal(validateSubmission(root, formBody(JSON.stringify(review({}, [{ ...comment, id: "mine", body: "Edited" }]))), 13).ok, false);
});

test("without a readable schema nothing is accepted", (t) => {
  const root = miniSite(t);
  fs.writeFileSync(path.join(root, "reviews/schema.json"), "{broken");
  assert.throws(() => validateSubmission(root, formBody(JSON.stringify(review())), 7), /reviews\/schema\.json: not readable/);
});

test("a review already merged, or one withdrawn by an edit, says so in the reply", () => {
  const ok: SubmissionResult = { ok: true, number: 4, problems: [], document, comments: 1 };
  assert.match(reportBody({ result: ok, validate: "success", unchanged: true }), /already holds exactly this review/);
  assert.match(reportBody({ result: { ok: false, number: 4, problems: ["x"] }, validate: "success", withdrawn: true }), /earlier version of this issue was closed/);
  assert.doesNotMatch(reportBody({ result: { ok: false, number: 4, problems: ["x"] }, validate: "success" }), /was closed/);
});

test("withdrawing closes the branch's open pull request and deletes the branch; CI is started by dispatch", async () => {
  const api = fakeApi({
    [`GET ${API}/pulls`]: () => [200, [{ number: 31 }]],
    [`PATCH ${API}/pulls/31`]: (b) => { assert.deepEqual(b, { state: "closed" }); return [200, {}]; },
    [`DELETE ${API}/git/refs/heads/review-submission/issue-6`]: () => [204, null],
    [`POST ${API}/actions/workflows/ci.yml/dispatches`]: (b) => { assert.deepEqual(b, { ref: "review-submission/issue-6" }); return [204, null]; },
  });
  assert.deepEqual(await withdrawPullRequest({ repo: "o/r", token: "t", fetch: api.fetch }, 6), { closed: 1, deleted: true });
  assert.deepEqual(api.calls.map((c) => c.method), ["GET", "PATCH", "DELETE"]);
  assert.equal(await dispatchChecks({ repo: "o/r", token: "t", fetch: api.fetch }, branchFor(6)), true);
  const none = fakeApi({ [`GET ${API}/pulls`]: () => [200, []], [`DELETE ${API}/git/refs`]: () => [422, { message: "Reference does not exist" }] });
  assert.deepEqual(await withdrawPullRequest({ repo: "o/r", token: "t", fetch: none.fetch }, 6), { closed: 0, deleted: false });
});

test("closing the issue unmerged removes its pull request and branch; a merge leaves nothing to do and does not error", async () => {
  const run = async (api: ReturnType<typeof fakeApi>, number: number) => {
    const saved = { fetch: globalThis.fetch, event: process.env.GITHUB_EVENT_PATH, repo: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-cleanup-event-"));
    const file = path.join(dir, "event.json");
    fs.writeFileSync(file, JSON.stringify({ action: "closed", issue: { number, body: "not read" } }));
    Object.assign(process.env, { GITHUB_EVENT_PATH: file, GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "t" });
    globalThis.fetch = api.fetch as unknown as typeof fetch;
    const log = console.log;
    console.log = () => {};
    try { return await main(["cleanup"]); }
    finally {
      console.log = log;
      globalThis.fetch = saved.fetch;
      for (const [k, v] of [["GITHUB_EVENT_PATH", saved.event], ["GITHUB_REPOSITORY", saved.repo], ["GITHUB_TOKEN", saved.token]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const unmerged = fakeApi({
    [`GET ${API}/pulls`]: () => [200, [{ number: 41 }]],
    [`PATCH ${API}/pulls/41`]: (b) => { assert.deepEqual(b, { state: "closed" }); return [200, {}]; },
    [`DELETE ${API}/git/refs/heads/review-submission/issue-9`]: () => [204, null],
  });
  assert.equal(await run(unmerged, 9), 0);
  assert.deepEqual(unmerged.calls.map((c) => c.method), ["GET", "PATCH", "DELETE"]);
  // Merged: no open pull request, and the repository already deleted the head branch.
  const merged = fakeApi({ [`GET ${API}/pulls`]: () => [200, []], [`DELETE ${API}/git/refs/heads/review-submission/issue-9`]: () => [422, { message: "Reference does not exist" }] });
  assert.equal(await run(merged, 9), 0);
  assert.deepEqual(merged.calls.map((c) => c.method), ["GET", "DELETE"]);
});

// ---- keeping open submission branches current (issue #189) ----------------------------------------------------

const GIT_IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always"];
function g(root: string, ...args: string[]) {
  const run = spawnSync("git", [...GIT_IDENTITY, ...args], { cwd: root, encoding: "utf8", timeout: 60_000 });
  return { status: run.status, out: (run.stdout + run.stderr).trim() };
}
const gOk = (root: string, ...args: string[]) => { const r = g(root, ...args); assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.out}`); return r.out; };

test("open submission branches are rebuilt from main when it moves, so two can be merged without `npm run index`", { timeout: 175_000 }, (t) => {
  const work = siteCopy(t), origin = fs.mkdtempSync(path.join(os.tmpdir(), "bh-origin-")), out = fs.mkdtempSync(path.join(os.tmpdir(), "bh-out-"));
  t.after(() => { fs.rmSync(origin, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); });
  gOk(work, "init", "-q", "-b", "main");
  gOk(work, "add", "-A");
  gOk(work, "commit", "-q", "-m", "site");
  gOk(origin, "init", "-q", "--bare", "-b", "main");
  gOk(work, "remote", "add", "origin", origin);
  gOk(work, "push", "-q", "origin", "main");

  // What `propose` pushes: the review plus the regenerated data, one commit on main.
  const propose = (n: number, id: string, body = "Why?") => {
    gOk(work, "checkout", "-q", "-b", branchFor(n), "main");
    const result = prepareSubmission(work, formBody(JSON.stringify(review({}, [{ ...comment, id, body }]))), n, out);
    assert.equal(result.ok, true, result.problems.join("\n"));
    gOk(work, "add", "--", reviewPath(n), ...GENERATED);
    gOk(work, "commit", "-q", "-m", `Add the review submitted in #${n}`);
    gOk(work, "push", "-q", "origin", `HEAD:refs/heads/${branchFor(n)}`);
    gOk(work, "checkout", "-q", "main");
    gOk(work, "reset", "-q", "--hard", "main");
  };
  propose(1, "sub-1");
  propose(2, "sub-2");

  // Merge #1. Without the refresh, #2 now conflicts in the generated review data.
  gOk(work, "merge", "-q", "--no-ff", "-m", "Merge #1", branchFor(1));
  gOk(work, "push", "-q", "origin", "main");
  const stale = g(work, "merge", "--no-commit", "--no-ff", `origin/${branchFor(2)}`);
  assert.notEqual(stale.status, 0, "the second submission conflicts before the refresh");
  assert.match(stale.out, /CONFLICT.*theme\/(reviews|site)\.js/);
  g(work, "merge", "--abort");

  const before = gOk(work, "rev-parse", `origin/${branchFor(2)}`);
  const first = refreshSubmissions(work);
  assert.deepEqual(first.map((o) => [o.number, o.state]), [[1, "merged"], [2, "updated"]]);
  const after = gOk(work, "rev-parse", `origin/${branchFor(2)}`);
  assert.notEqual(after, before);
  assert.equal(gOk(work, "rev-list", "--count", `main..origin/${branchFor(2)}`), "1", "one commit on top of main");

  // Now it merges cleanly, holds both reviews, and `check` passes without an `index`.
  gOk(work, "checkout", "-q", "main");
  gOk(work, "merge", "-q", "--no-ff", "-m", "Merge #2", `origin/${branchFor(2)}`);
  const ids = Object.values(JSON.parse(fs.readFileSync(path.join(work, "theme/reviews.js"), "utf8").replace(/^[^]*?window\.BH_REVIEWS = /, "").replace(/;\s*$/, "")) as Record<string, { id: string }[]>).flat().map((m) => m.id);
  assert.ok(ids.includes("sub-1") && ids.includes("sub-2"), ids.join());
  const check = spawnSync(process.execPath, [path.join(work, "scripts/bh.mts"), "check"], { cwd: work, encoding: "utf8", timeout: 170_000 });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  gOk(work, "reset", "-q", "--hard", "origin/main");

  // Nothing moved: the branch is already what a rebuild produces, and is not pushed again.
  const second = refreshSubmissions(work);
  assert.deepEqual(second.map((o) => [o.number, o.state]), [[1, "merged"], [2, "current"]]);
  assert.equal(gOk(work, "rev-parse", `origin/${branchFor(2)}`), after, "not pushed again");
});

test("refresh leaves a review that no longer passes, and ignores branches `propose` would not have made", { timeout: 175_000 }, (t) => {
  const work = siteCopy(t), origin = fs.mkdtempSync(path.join(os.tmpdir(), "bh-origin-"));
  t.after(() => fs.rmSync(origin, { recursive: true, force: true }));
  gOk(work, "init", "-q", "-b", "main");
  gOk(work, "add", "-A");
  gOk(work, "commit", "-q", "-m", "site");
  gOk(origin, "init", "-q", "--bare", "-b", "main");
  gOk(work, "remote", "add", "origin", origin);
  gOk(work, "push", "-q", "origin", "main");
  // A review already on main, and a submission that reuses its id for different text.
  fs.mkdirSync(path.join(work, "reviews/inbox"), { recursive: true });
  fs.writeFileSync(path.join(work, "reviews/inbox/merged.json"), JSON.stringify(review({}, [{ ...comment, id: "taken" }])));
  gOk(work, "add", "-A");
  gOk(work, "commit", "-q", "-m", "a merged review");
  gOk(work, "push", "-q", "origin", "main");
  const onBranch = (name: string, file: string, text: string) => {
    gOk(work, "checkout", "-q", "-b", name, "main");
    fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    fs.writeFileSync(path.join(work, file), text);
    gOk(work, "add", "-A");
    gOk(work, "commit", "-q", "-m", name);
    gOk(work, "push", "-q", "origin", `HEAD:refs/heads/${name}`);
    gOk(work, "checkout", "-q", "main");
  };
  onBranch(branchFor(3), reviewPath(3), JSON.stringify(review({}, [{ ...comment, id: "taken", body: "Different" }])));
  onBranch(branchFor(4), reviewPath(4), "{not json");
  onBranch("review-submission/issue-x", reviewPath(5), JSON.stringify(review()));
  onBranch("review-submission/issue-07", reviewPath(7), JSON.stringify(review()));
  onBranch("review-submission/issue-9", "notes.txt", "no review here");
  const heads = Object.fromEntries(["issue-3", "issue-4", "issue-9"].map((n) => [n, gOk(work, "rev-parse", `origin/review-submission/${n}`)]));
  const got = refreshSubmissions(work);
  assert.deepEqual(got.map((o) => [o.number, o.state]), [[3, "invalid"], [4, "invalid"], [9, "invalid"]]);
  assert.match(got[0].problems!.join("\n"), /taken/);
  assert.match(got[1].problems!.join("\n"), /not valid JSON/);
  assert.match(got[2].problems!.join("\n"), /is not on/);
  for (const [n, sha] of Object.entries(heads)) assert.equal(gOk(work, "rev-parse", `origin/review-submission/${n}`), sha, `${n} is untouched`);
});

const refreshWorkflow = parse(fs.readFileSync(path.join(source, ".github/workflows/review-submission-refresh.yml"), "utf8")) as { on: unknown; permissions: unknown; concurrency: { "cancel-in-progress": boolean }; jobs: Record<string, Job> };

test("the refresh runs on pushes to main only, with write access to branches and nothing on issues or pull requests", () => {
  assert.deepEqual(refreshWorkflow.on, { push: { branches: ["main"] } });
  assert.deepEqual(refreshWorkflow.permissions, {});
  assert.equal(refreshWorkflow.concurrency["cancel-in-progress"], false, "a push that is half done must finish");
  assert.deepEqual(Object.keys(refreshWorkflow.jobs), ["refresh"]);
  const job = refreshWorkflow.jobs.refresh;
  assert.deepEqual(job.permissions, { contents: "write", actions: "write" });
  assert.ok(job["timeout-minutes"] && job["timeout-minutes"] <= 10);
  assert.equal(job.steps.find((s) => s.uses?.startsWith("actions/checkout"))?.with?.["fetch-depth"], 0);
  for (const step of job.steps) {
    assert.doesNotMatch(step.run ?? "", /\$\{\{/, "no expression inside a script");
    for (const value of Object.values(step.env ?? {})) assert.doesNotMatch(String(value), /github\.event/);
  }
  assert.ok(job.steps.some((s) => /review-submission\.mts refresh/.test(s.run ?? "")));
});

test("the pull request says the branch is kept current, not that the owner must update it", () => {
  const body = pullRequestBody({ ok: true, number: 8, problems: [], document, comments: 1 });
  assert.match(body, /rebuilds this branch/);
  assert.doesNotMatch(body, /update the branch, run `npm run index`/);
});
