// A private page's plaintext is never committed, and no `#k=` key is in a committed file or a commit message
// (scripts/private-leaks.mts, contracts/private-pages.md). The pushes themselves are in tests/githooks.test.mts.
//
// Every key here is made at run time and is not a real key: a literal one in this file would be refused by the very
// checks it tests, and a real one must never be written anywhere.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { main, type Output } from "../scripts/advisor.mts";
import { dataDir } from "../scripts/advisor/corpus.mts";
import { leakCheckPushed, type PushUpdate } from "../scripts/advisor/guards.mts";
import { leakCheckHashed } from "../scripts/advisor/leak-hashes.mts";
import { KEY_PATTERN, isPrivatePlaintext, keyLines, trackedPrivatePlaintext } from "../scripts/private-leaks.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** A made-up run of `n` base64url characters, the shape of a key's body (43 for a real one). */
const keyBody = (n = 43) => "Zq7-x_W2".repeat(8).slice(0, n);
/** `#k=` and a made-up key body. */
const fakeKey = (n = 43) => "#k" + "=" + keyBody(n);
const ZERO = "0".repeat(40);

const sink = () => {
  const lines: string[] = [], errors: string[] = [];
  const out: Output = { log: (...a) => lines.push(a.join(" ")), error: (...a) => errors.push(a.join(" ")) };
  return { out, lines, errors, all: () => [...lines, ...errors].join("\n") };
};

function tmp(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-private-leaks-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A git repo with no private corpus (the usual checkout), a clean first commit, and a way to add more. */
function repo(t: TestContext, { withData = false } = {}) {
  const repoRoot = tmp(t);
  const corpusRoot = path.join(repoRoot, "corpus");
  git(repoRoot, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.email", "test@example.com"], ["user.name", "Test"], ["commit.gpgsign", "false"], ["tag.gpgsign", "false"]]) git(repoRoot, "config", k, v);
  fs.copyFileSync(path.join(ROOT, ".gitignore"), path.join(repoRoot, ".gitignore"));
  fs.writeFileSync(path.join(repoRoot, "page.html"), "<p>A sealed page is opened from a link of the form docs/x.html#k=&lt;key&gt;.</p>\n");
  if (withData) {
    const dir = dataDir("someone", corpusRoot);
    fs.mkdirSync(path.join(dir, "posts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ATLAS.jsonl"), JSON.stringify({ id: "q0", statement: "s", quote: QUOTE }) + "\n");
  }
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-qm", "first");
  const head = () => git(repoRoot, "rev-parse", "HEAD");
  /** Write `files`, force-adding them (a plaintext is git-ignored), and commit with `message`. Returns the commit. */
  const commit = (files: Record<string, string>, message: string) => {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repoRoot, name)), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, name), text);
      git(repoRoot, "add", "-f", name);
    }
    git(repoRoot, "commit", "-q", "--allow-empty", "-m", message);
    assert.ok(git(repoRoot, "log", "-1", "--format=%B").includes(message.trim()), "the commit was made, with its whole message");
    return head();
  };
  const push = (localSha: string, remoteSha = ZERO): PushUpdate => ({ localRef: "refs/heads/x", localSha, remoteRef: "refs/heads/x", remoteSha });
  /** `leak-check --pushed origin` as the hook runs it, with `updates` on its stdin. */
  const cli = async (updates: PushUpdate[]) => {
    const s = sink();
    const stdin = updates.map((u) => `${u.localRef} ${u.localSha} ${u.remoteRef} ${u.remoteSha}\n`).join("");
    return { code: await main(["leak-check", "--pushed", "origin"], { repoRoot, corpusRoot, out: s.out, stdin: () => stdin, env: {} }), ...s };
  };
  return { repoRoot, corpusRoot, head, commit, push, cli };
}
const QUOTE = "a harbour pilot reads the water before the chart every single morning";

// ---- the pattern -----------------------------------------------------------------------------

test("a key is #k= or &k= and 43 base64url characters; a longer run holds one, a shorter one and the placeholders don't", () => {
  assert.equal(fakeKey().length, 46, "the fixture has the shape of a real link's key");
  assert.equal(Buffer.from(keyBody(), "base64url").length, 32, "43 base64url characters are 32 bytes, as seal makes");
  const cases: [string, boolean][] = [
    [`docs/x.html${fakeKey()}`, true],
    [`docs/x.html${fakeKey()}&my-section`, true],
    [`index.html#k=${keyBody()}&k=${keyBody()}`, true],
    [`index.html?x=1&k=${keyBody()}`, true],
    [`${fakeKey(44)}`, true],
    [`${fakeKey(60)}`, true],
    [`${fakeKey(42)}`, false],
    [`${fakeKey(42)}&rest`, false],
    [`#k${keyBody()}`, false],
    [`k=${keyBody()}`, false],
    [`#K=${keyBody()}`, false],
    ["docs/<slug>.html#k=<key>", false],
    ["docs/x.html#k=…", false],
    ["#k=${key}", false],
    ["`#k=` link", false],
    ["location.hash.match(/^#k=([A-Za-z0-9_-]{43})(?:&(.*))?$/)", false],
  ];
  for (const [text, expected] of cases) assert.equal(KEY_PATTERN.test(text), expected, text);
});

test("keyLines gives the line numbers only", () => {
  const text = `one\ntwo ${fakeKey()}\nthree\n${fakeKey()} and ${fakeKey()}\n`;
  assert.deepEqual(keyLines(text), [2, 4]);
  assert.deepEqual(keyLines("nothing here\n"), []);
});

test("a private page's plaintext is any *.private.html, in any case", () => {
  for (const yes of ["docs/x.private.html", "x.private.html", "deep/dir/x.PRIVATE.HTML"]) assert.equal(isPrivatePlaintext(yes), true, yes);
  for (const no of ["docs/x.html", "docs/private.html", "docs/x.private.html.bak", "docs/x.private.htm"]) assert.equal(isPrivatePlaintext(no), false, no);
});

// ---- what git tracks ------------------------------------------------------------------------

test("git ignores docs/<slug>.private.html, and a public page beside it is not ignored", (t) => {
  // This repo's own .gitignore, as is; no file needs to exist.
  assert.equal(git(ROOT, "check-ignore", "--no-index", "docs/x.private.html"), "docs/x.private.html");
  const { repoRoot } = repo(t);
  fs.mkdirSync(path.join(repoRoot, "docs"));
  fs.writeFileSync(path.join(repoRoot, "docs", "x.private.html"), "<p>plaintext</p>\n");
  fs.writeFileSync(path.join(repoRoot, "docs", "x.html"), "<p>sealed shell</p>\n");
  git(repoRoot, "add", "-A");
  const staged = git(repoRoot, "diff", "--cached", "--name-only").split("\n");
  assert.ok(staged.includes("docs/x.html"), "the public copy is staged");
  assert.equal(staged.includes("docs/x.private.html"), false, "`git add -A` leaves the plaintext out");
});

test("git tracks no *.private.html in this repository", () => {
  const tracked = git(ROOT, "ls-files").split("\n");
  assert.ok(tracked.includes("scripts/bh.mts"), "the check is looking in the right place");
  assert.deepEqual(tracked.filter(isPrivatePlaintext), []);
  assert.deepEqual(trackedPrivatePlaintext(ROOT), []);
});

test("trackedPrivatePlaintext sees a force-added plaintext as soon as it is staged, and nothing outside a checkout", (t) => {
  const { repoRoot } = repo(t);
  assert.deepEqual(trackedPrivatePlaintext(repoRoot), []);
  fs.mkdirSync(path.join(repoRoot, "docs"));
  fs.writeFileSync(path.join(repoRoot, "docs", "x.private.html"), "<p>plaintext</p>\n");
  assert.deepEqual(trackedPrivatePlaintext(repoRoot), [], "an ignored file on disk is not tracked");
  git(repoRoot, "add", "-f", "docs/x.private.html");
  assert.deepEqual(trackedPrivatePlaintext(repoRoot), ["docs/x.private.html"]);
  assert.deepEqual(trackedPrivatePlaintext(tmp(t)), [], "a directory outside any checkout tracks nothing");
});

// ---- what a push adds -----------------------------------------------------------------------

test("leak-check --pushed refuses a key in a file, in a commit message and a plaintext, with no private data, and never prints the key", async (t) => {
  const { commit, push, cli } = repo(t);
  const base = commit({ "clean.md": "nothing\n" }, "clean");
  const clean = await cli([push(base)]);
  assert.equal(clean.code, 0, clean.all());
  assert.match(clean.lines[0]!, /^leak-check --pushed: no private page key or plaintext in 2 commit\(s\) and 3 blob\(s\)$/);
  assert.match(clean.lines[1]!, /^leak-check --pushed skipped the corpus: /, "there is no private data, and that part says so");

  const inFile = commit({ "notes.md": `intro\nopen it at docs/x.html${fakeKey()}\n` }, "a key in a file");
  const file = await cli([push(inFile, base)]);
  assert.equal(file.code, 1, file.all());
  assert.match(file.errors[0]!, /^notes\.md@[0-9a-f]{7}:2: a private page's #k= key$/);
  assert.match(file.errors.at(-1)!, /^leak-check --pushed FAILED: 1 #k= key\(s\) in what this adds\. Rewrite the commits/);

  const inMessage = commit({}, `share it\n\nThe link is docs/x.html${fakeKey()}&intro\n`);
  const message = await cli([push(inMessage, inFile)]);
  assert.equal(message.code, 1, message.all());
  assert.deepEqual(message.errors.slice(0, -1), [`commit ${inMessage.slice(0, 7)}: line 3 of its message holds a private page's #k= key`]);

  const plaintext = commit({ "docs/x.private.html": "<p>plaintext</p>\n" }, "the plaintext, force-added");
  const plain = await cli([push(plaintext, inMessage)]);
  assert.equal(plain.code, 1, plain.all());
  assert.deepEqual(plain.errors.slice(0, -1), [`docs/x.private.html in commit ${plaintext.slice(0, 7)}: a private page's plaintext (*.private.html), which must never be committed`]);
  assert.match(plain.errors.at(-1)!, /FAILED: 1 private page plaintext file\(s\) in what this adds.*`git rm --cached <file>`/);

  // Everything at once, as a new branch: each finding once, in one report.
  const all = await cli([push(plaintext)]);
  assert.equal(all.code, 1);
  assert.equal(all.errors.length, 4, all.all());
  assert.match(all.errors.at(-1)!, /FAILED: 2 #k= key\(s\) and 1 private page plaintext file\(s\)/);
  for (const r of [file, message, plain, all]) assert.equal(r.all().includes(keyBody()), false, "the key is never printed");
});

test("leak-check --pushed: only what the push adds; a delete, a removal and the remote's own commits are not refused", async (t) => {
  const { repoRoot, commit, push, cli } = repo(t);
  const leaky = commit({ "notes.md": `docs/x.html${fakeKey()}\n` }, `and in the message ${fakeKey()}`);
  const plaintext = commit({ "docs/x.private.html": "<p>plaintext</p>\n" }, "plaintext");
  const later = commit({ "other.md": "clean\n" }, "clean follow-up");
  assert.equal((await cli([push(later, plaintext)])).code, 0, "the remote already has the key and the plaintext");
  assert.equal((await cli([push(ZERO, later)])).code, 0, "a delete adds nothing");
  assert.equal((await cli([])).code, 0);
  git(repoRoot, "update-ref", "refs/remotes/origin/main", plaintext);
  assert.equal((await cli([push(later)])).code, 0, "a new branch is judged against the remote's tracking refs");
  git(repoRoot, "update-ref", "-d", "refs/remotes/origin/main");
  // Removing the plaintext is the fix, so a commit that deletes it is not refused; the one that added it still is.
  git(repoRoot, "rm", "-q", "--cached", "docs/x.private.html");
  const removed = commit({}, "remove the plaintext");
  assert.equal((await cli([push(removed, later)])).code, 0, "a deletion is not refused");
  const stillThere = await cli([push(removed, leaky)]);
  assert.equal(stillThere.code, 1, "a later commit that removes it leaves it in the pushed history");
  assert.match(stillThere.errors[0]!, /^docs\/x\.private\.html in commit [0-9a-f]{7}:/);
});

test("leak-check --pushed: a merge that brings in a plaintext, a merge's own message, and an annotated tag are read", async (t) => {
  const { repoRoot, head, commit, push, cli } = repo(t);
  const base = head();
  git(repoRoot, "switch", "-q", "-c", "side");
  const side = commit({ "docs/x.private.html": "<p>plaintext</p>\n" }, "plaintext on a side branch");
  git(repoRoot, "switch", "-q", "main");
  const mainTip = commit({ "a.md": "clean\n" }, "main moves on");
  git(repoRoot, "merge", "-q", "--no-ff", "-m", `merge side\n\n${fakeKey()}`, "side");
  const merge = head();
  assert.ok(git(repoRoot, "log", "-1", "--format=%B").includes(fakeKey()), "the key is in the merge's message");
  // The remote has both parents (the side branch went up with --no-verify), and is shown only the merge.
  const r = await cli([push(merge, mainTip), { localRef: "refs/heads/side", localSha: side, remoteRef: "refs/heads/side", remoteSha: side }]);
  assert.equal(r.code, 1, r.all());
  assert.deepEqual(r.errors.slice(0, -1).sort(), [
    `commit ${merge.slice(0, 7)}: line 3 of its message holds a private page's #k= key`,
    `docs/x.private.html in commit ${merge.slice(0, 7)}: a private page's plaintext (*.private.html), which must never be committed`,
  ]);

  // Not at the start of a line: `git tag -m` strips lines that start with "#" as comments.
  git(repoRoot, "tag", "-a", "v1", "-m", `release\nlink: docs/x.html${fakeKey()}`, base);
  const tag = git(repoRoot, "rev-parse", "v1");
  assert.ok(git(repoRoot, "cat-file", "tag", tag).includes(fakeKey()), "the key is in the tag object");
  const tagged = await cli([{ localRef: "refs/tags/v1", localSha: tag, remoteRef: "refs/tags/v1", remoteSha: ZERO }]);
  assert.equal(tagged.code, 1, tagged.all());
  assert.deepEqual(tagged.errors.slice(0, -1), [`tag ${tag.slice(0, 7)}: line 2 of its message holds a private page's #k= key`]);
  assert.equal([r, tagged].some((x) => x.all().includes(keyBody())), false, "the key is never printed");
});

test("leak-check --pushed: a 44-character run is refused and a 42-character one is not, in a file and in a message", async (t) => {
  const { commit, push, cli } = repo(t);
  const base = commit({}, "base");
  const long = commit({ "long.md": `${fakeKey(44)}\n` }, `long ${fakeKey(44)}`);
  assert.equal((await cli([push(long, base)])).errors.length, 3);
  const short = commit({ "short.md": `${fakeKey(42)}\n` }, `short ${fakeKey(42)}`);
  const r = await cli([push(short, long)]);
  assert.equal(r.code, 0, r.all());
});

test("leak-check --pushed with private data: one read reports corpus runs and keys together", async (t) => {
  const { repoRoot, corpusRoot, commit, push, cli } = repo(t, { withData: true });
  const base = commit({}, "base");
  const both = commit({ "leak.html": `<p>${QUOTE}</p>\n<p>docs/x.html${fakeKey()}</p>\n` }, "both");
  const r = await cli([push(both, base)]);
  assert.equal(r.code, 1, r.all());
  assert.match(r.errors[0]!, /^leak\.html@[0-9a-f]{7}:2: a private page's #k= key$/);
  assert.match(r.errors.find((l) => l.includes("word run"))!, /^leak\.html@[0-9a-f]{7}:1: 12-word run from an atlas quote$/);
  assert.match(r.errors.at(-1)!, /^leak-check --pushed FAILED: 1 run\(s\) of 8\+ words/, "the corpus summary is still last");
  for (const word of ["harbour", "pilot", keyBody()]) assert.equal(r.all().includes(word), false, `printed "${word}"`);
  const direct = leakCheckPushed(repoRoot, [push(both, base)], "origin", corpusRoot);
  assert.equal(direct.status, "done");
  assert.equal(direct.status === "done" && direct.hits.length, 1, "the corpus side read the same blob");
  assert.deepEqual(direct.privatePages.keys.map((k) => "file" in k && [k.file, k.line]), [["leak.html", 2]]);
  assert.equal(direct.privatePages.blobs, 1);
});

// ---- CI -------------------------------------------------------------------------------------

test("CI's check refuses a key or a plaintext in the range without the secret, as annotations, and reads the base's commits no more", async (t) => {
  const { repoRoot, corpusRoot, commit } = repo(t);
  const base = commit({}, `old ${fakeKey()}`);
  const head = commit({ "docs/x.private.html": "<p>plaintext</p>\n", "notes.md": `x\n${fakeKey()}\n` }, `new\n\n${fakeKey()}`);
  const run = async (args: string[], env: NodeJS.ProcessEnv) => {
    const s = sink();
    return { code: await main(["leak-check", "--hashed", ...args], { repoRoot, corpusRoot, env, out: s.out }), ...s };
  };
  const fork = await run(["--head", head, "--base", base], { GITHUB_ACTIONS: "true" });
  assert.equal(fork.code, 1, "no secret is needed to refuse a key: " + fork.all());
  assert.deepEqual(fork.errors.slice(0, -1), [
    `::error file=docs/x.private.html::docs/x.private.html in commit ${head.slice(0, 7)}: a private page's plaintext (*.private.html), which must never be committed`,
    `::error file=notes.md,line=2::notes.md@${git(repoRoot, "rev-parse", "--short=7", `${head}:notes.md`)}:2: a private page's #k= key`,
    `::error::commit ${head.slice(0, 7)}: line 3 of its message holds a private page's #k= key`,
  ], "the base's own message is not read again");
  assert.match(fork.errors.at(-1)!, /^leak-check --hashed FAILED: 2 #k= key\(s\) and 1 private page plaintext file\(s\)/);
  assert.match(fork.lines.at(-1)!, /^::notice::leak-check --hashed skipped: no BH_LEAK_KEY secret/, "the corpus side still says it compared nothing");
  assert.equal(fork.all().includes(keyBody()), false, "the key is never printed");

  const everything = leakCheckHashed(repoRoot, head, undefined, undefined, corpusRoot);
  assert.equal(everything.privatePages.keys.length, 3, "no base: every commit's message is read");
  assert.equal(leakCheckHashed(repoRoot, base, undefined, "", corpusRoot).privatePages.keys.length, 1);
  const unknown = leakCheckHashed(repoRoot, head, "c".repeat(40), undefined, corpusRoot);
  assert.equal(unknown.baseUnknown, true);
  assert.equal(unknown.privatePages.keys.length, 3, "a base this clone doesn't have reads everything");
  const clean = await run(["--head", base, "--base", base], {});
  assert.equal(clean.code, 0, clean.all());
  assert.match(clean.lines[0]!, /^leak-check --hashed: no private page key or plaintext in 0 commit\(s\) and 0 blob\(s\)$/);
});
