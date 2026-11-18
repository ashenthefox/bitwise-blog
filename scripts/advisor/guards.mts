// The rule from corpus/README.md, as a check: nothing derived from a writer's text is committed.
//
// `tests/advisor-guards.test.mts` holds the guards that run everywhere (what git tracks under corpus/,
// what publishing copies). This file holds the one that needs the private data: whether a tracked
// file, or any blob in git history, contains a run of words from the text kept private (posts, atlas
// quotes and statements, voice negatives, authored samples). Its output is meant to be safe to paste:
// file names, line numbers and run lengths, never the matched words. The push and CI checks read the same blobs for
// a private page's key too, and the commits for its key and plaintext (`scanRevs`, scripts/private-leaks.mts),
// which needs no private data.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CORPUS_DIR, dataDir, markdownFiles } from "./corpus.mts";
import { writers } from "./index.mts";
import { LEAK_ALLOWED, type LeakAllowance } from "../leak-allowed.mts";
import { NO_PRIVATE_PAGE_LEAKS, commitLeaks, keyLines, type KeyHit, type PrivatePageLeaks } from "../private-leaks.mts";

export { LEAK_ALLOWED, type LeakAllowance };

/**
 * How long one git command a check runs may take. A scan of every blob in this repository's history takes about a
 * second, so this is only reached when git is stuck (a lock, a prompt, an unresponsive filesystem). Without it, a
 * stuck git would hang a push or a CI job with no message (contracts/tooling.md: nothing may hang).
 */
export const GIT_TIMEOUT_MS = 120_000;

/**
 * Run git in `repoRoot`, with a timeout. Throws when git runs past it or can't be started, so a check that did not
 * run never looks like one that passed. The exit status is the caller's to read: see `gitOut` for one that must succeed.
 */
export function runGit(repoRoot: string, args: string[], options: { input?: string; timeout?: number } = {}): SpawnSyncReturns<Buffer> {
  const timeout = options.timeout ?? GIT_TIMEOUT_MS;
  const r = spawnSync("git", ["-C", repoRoot, ...args], { input: options.input, maxBuffer: 1024 * 1024 * 1024, timeout });
  if (r.error) {
    const timedOut = (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    throw new Error(timedOut
      ? `\`git ${args[0]}\` in ${repoRoot} did not finish within ${timeout / 1000} s and was stopped, so the check did not run`
      : `\`git ${args[0]}\` in ${repoRoot} could not be run (${r.error.message}), so the check did not run`);
  }
  return r;
}

/** git's output for a command that must succeed; otherwise an error with git's own message. */
export function gitOut(repoRoot: string, args: string[], input?: string): Buffer {
  const r = runGit(repoRoot, args, { input });
  if (r.status !== 0) throw new Error(`\`git ${args[0]}\` in ${repoRoot} failed: ${r.stderr.toString("utf8").trim() || `exit status ${r.status ?? r.signal}`}`);
  return r.stdout;
}

/** A shared run this long is taken to be copied text. */
export const LEAK_RUN_WORDS = 8;

const WORD = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;
// A quote may elide with "...", "…" or "[...]"; the words either side of one are not a run.
const ELISION = /\.{3,}|…|\[[\s.…]*\]/;
const TAG = /<\/?[a-zA-Z][^<>]*>/g;
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "—", ndash: "–", hellip: "…",
};

const wordsOf = (text: string) => text.toLowerCase().replaceAll("’", "'").match(WORD) ?? [];

function codePoint(digits: string, radix: number, whole: string): string {
  const cp = parseInt(digits, radix);
  return cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
}

/** Text as a reader would see it: HTML entities, and the string escapes of JSON and generated JS. Raw line breaks stay. */
function decoded(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex) => codePoint(hex, 16, whole))
    .replace(/\\[nrt]/g, " ")
    .replace(/\\(["'\/\\])/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => codePoint(hex, 16, whole))
    .replace(/&#([0-9]+);/g, (whole, dec) => codePoint(dec, 10, whole))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/** What a run came from, worded to follow "run from" in a message. Never the text itself. */
export type LeakSource = "an atlas quote" | "an atlas statement" | "a voice negative" | "an authored sample" | "post text";

/**
 * The runs to look for: with where each came from, or anything that can say whether it holds a run (a set of
 * runs, or the keyed hash list CI compares with, which can't say where a run came from).
 */
export type RunSet = ReadonlyMap<string, LeakSource> | { has(run: string): boolean };

/** The parsed lines of a .jsonl file, with their line numbers. An error names the line only: JSON.parse's own message would repeat the start of the text. */
function jsonlLines(name: string, text: string): [line: number, entry: unknown][] {
  const out: [number, unknown][] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try {
      out.push([index + 1, JSON.parse(line)]);
    } catch {
      throw new Error(`${name} line ${index + 1} is not valid JSON`);
    }
  });
  return out;
}

/** Every string anywhere in a parsed JSON value. */
function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
}

/** Add every run of `LEAK_RUN_WORDS` consecutive words in `text` to `into`; with `elide`, words either side of an elision aren't a run. */
function addRuns(into: Set<string>, text: string, elide: boolean): void {
  for (const segment of elide ? text.split(ELISION) : [text]) {
    const words = wordsOf(segment);
    for (let i = 0; i + LEAK_RUN_WORDS <= words.length; i++) into.add(words.slice(i, i + LEAK_RUN_WORDS).join(" "));
  }
}

/** Every run in one string field of each entry of an ATLAS.jsonl. */
function atlasFieldRuns(atlasText: string, field: "quote" | "statement"): Set<string> {
  const runs = new Set<string>();
  for (const [line, entry] of jsonlLines("ATLAS.jsonl", atlasText)) {
    const value = (entry as Record<string, unknown> | null)?.[field];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new Error(`ATLAS.jsonl line ${line}: ${field} is not a string`);
    addRuns(runs, value, true);
  }
  return runs;
}

/** Every run of `LEAK_RUN_WORDS` consecutive words in the quotes of an ATLAS.jsonl. */
export const quoteRuns = (atlasText: string): Set<string> => atlasFieldRuns(atlasText, "quote");

/** Every run in every string of every line of a .jsonl file. Short values such as ids can't make a run, so no field names are assumed. */
export function jsonlRuns(name: string, text: string): Set<string> {
  const runs = new Set<string>();
  for (const [, entry] of jsonlLines(name, text)) for (const value of stringValues(entry)) addRuns(runs, value, false);
  return runs;
}

/** Every run in a post file, read as the page side is (entities decoded). The target of a markdown link is not prose, so `[word](url)` reads as `[word]`. */
export function postRuns(postText: string): Set<string> {
  const runs = new Set<string>();
  addRuns(runs, decoded(postText).replace(/\]\([^()\s]*(?:\([^()\s]*\)[^()\s]*)*(?:\s+"[^"]*")?\)/g, "]"), false);
  return runs;
}

export interface LeakHit {
  file: string;
  line: number;
  /** Length of the shared run, in words. */
  words: number;
  /** Where the run came from, when known. */
  source?: LeakSource;
  /** In a history scan, the first 7 characters of the blob's id. */
  blob?: string;
}

interface Word { text: string; line: number }

/** The words of consecutive runs found in `words`, merged where they overlap. */
function scan(file: string, words: Word[], runs: RunSet): LeakHit[] {
  const hits: LeakHit[] = [];
  let current: LeakHit | null = null;
  let currentEnd = -1;
  for (let i = 0; i + LEAK_RUN_WORDS <= words.length; i++) {
    const run = words.slice(i, i + LEAK_RUN_WORDS).map((w) => w.text).join(" ");
    if (!runs.has(run)) continue;
    if (current && i <= currentEnd) current.words += i + LEAK_RUN_WORDS - currentEnd;
    else {
      const source = runs instanceof Map ? runs.get(run) : undefined;
      const hit: LeakHit = { file, line: words[i].line, words: LEAK_RUN_WORDS };
      if (source) hit.source = source;
      hits.push(hit);
      current = hit;
    }
    currentEnd = i + LEAK_RUN_WORDS;
  }
  return hits;
}

/**
 * The runs from `runs` that appear in `text`. Prose is read across tags, so `<em>a</em> b` is two
 * words in a row. Each tag is read on its own, so a quote in a `content=` or `alt=` attribute counts,
 * without attribute names breaking up the prose around the tag.
 */
export function findRuns(file: string, text: string, runs: RunSet): LeakHit[] {
  let line = 1;
  const wordsIn = (segment: string): Word[] => {
    const lower = decoded(segment).toLowerCase().replaceAll("’", "'");
    const words: Word[] = [];
    let at = 0;
    for (const m of lower.matchAll(WORD)) {
      for (; at < m.index; at++) if (lower[at] === "\n") line++;
      words.push({ text: m[0], line });
    }
    for (; at < lower.length; at++) if (lower[at] === "\n") line++;
    return words;
  };
  const prose: Word[] = [];
  const hits: LeakHit[] = [];
  let last = 0;
  for (const tag of text.matchAll(TAG)) {
    prose.push(...wordsIn(text.slice(last, tag.index)));
    hits.push(...scan(file, wordsIn(tag[0]), runs));
    last = tag.index + tag[0].length;
  }
  prose.push(...wordsIn(text.slice(last)));
  return [...hits, ...scan(file, prose, runs)].sort((a, b) => a.line - b.line);
}

interface Text { file: string; blob?: string; text: string }

/** The files git tracks in `repoRoot`, skipping binaries and symlinks. */
function* trackedTexts(repoRoot: string): Generator<Text> {
  const listed = gitOut(repoRoot, ["ls-files", "-z"]).toString("utf8");
  for (const rel of listed.split("\0")) {
    if (!rel) continue;
    const file = path.join(repoRoot, rel);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) continue;
    yield { file: rel, text: bytes.toString("utf8") };
  }
}

/** A blob bigger than this is a media file or a dump, not prose someone pasted. It is counted, not read. */
const HISTORY_MAX_BLOB_BYTES = 8 * 1024 * 1024;
/** Blobs are read from git in batches of about this many bytes, to bound memory. */
const HISTORY_BATCH_BYTES = 32 * 1024 * 1024;

/** What a history scan could not read. */
interface HistoryStats { tooLarge: number }

/**
 * Every path each blob reachable from `revs` has been committed at. A blob can be at several (a copy of a page),
 * and an allowance is per path, so a copy must not be judged by the path that happens to be listed first.
 * `rev-list --objects` names each object once, so the paths come from the diffs of every commit, and `rev-list`
 * fills in a blob that no commit's diff names (one only a tag or a tree points at). Only objects `rev-list`
 * reports for `revs` count, so for a range, a blob a merge's diff shows against an excluded parent is left out.
 */
function blobPaths(git: (args: string[], input?: string) => Buffer, revs: string[]): Map<string, Set<string>> {
  const listed = git(["rev-list", "--objects", ...revs]).toString("utf8").split("\n");
  const reachable = new Set(listed.map((line) => line.split(" ", 1)[0]).filter(Boolean));
  const paths = new Map<string, Set<string>>();
  const note = (sha: string, file: string) => {
    if (/^0+$/.test(sha) || !reachable.has(sha)) return;
    const known = paths.get(sha);
    if (known) known.add(file);
    else paths.set(sha, new Set([file]));
  };
  const tokens = git(["log", ...revs, "--root", "--no-renames", "-m", "--format=", "--raw", "--no-abbrev", "-z"]).toString("utf8").split("\0");
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (!tokens[i].startsWith(":")) continue;
    note(tokens[i].split(" ")[3], tokens[++i]);
  }
  for (const line of listed) {
    const space = line.indexOf(" ");
    if (space !== -1 && !paths.has(line.slice(0, space))) note(line.slice(0, space), line.slice(space + 1));
  }
  return paths;
}

/** Every text blob reachable from `revs`, read once and yielded once per path it has been committed at. */
function* historyTexts(repoRoot: string, stats: HistoryStats, revs: string[]): Generator<Text> {
  const git = (args: string[], input?: string) => gitOut(repoRoot, args, input);
  const paths = blobPaths(git, revs);
  if (paths.size === 0) return;
  const sizes = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], [...paths.keys()].join("\n") + "\n").toString("utf8");
  const blobs: [sha: string, size: number][] = [];
  for (const line of sizes.split("\n")) {
    const [sha, type, size] = line.split(" ");
    if (type !== "blob") continue;
    if (Number(size) <= HISTORY_MAX_BLOB_BYTES) blobs.push([sha, Number(size)]);
    else stats.tooLarge++;
  }
  for (let from = 0; from < blobs.length;) {
    let to = from, bytes = 0;
    while (to < blobs.length && (to === from || bytes + blobs[to][1] <= HISTORY_BATCH_BYTES)) bytes += blobs[to++][1];
    const batch = git(["cat-file", "--batch"], blobs.slice(from, to).map(([sha]) => sha).join("\n") + "\n");
    for (let at = 0; at < batch.length;) {
      const headerEnd = batch.indexOf("\n", at);
      const [sha, , size] = batch.toString("utf8", at, headerEnd).split(" ");
      const body = batch.subarray(headerEnd + 1, headerEnd + 1 + Number(size));
      at = headerEnd + 1 + Number(size) + 1;
      if (body.includes(0)) continue;
      const text = body.toString("utf8");
      for (const file of [...paths.get(sha)!].sort()) yield { file, blob: sha.slice(0, 7), text };
    }
    from = to;
  }
}

/** How many of each kind of private text the comparison read. */
export type LeakSources = Record<"atlas entries" | "voice negatives" | "authored samples" | "posts", number>;

/** "12 atlas entries, 163 posts", leaving out what the private data doesn't have. */
export function describeSources(sources: LeakSources): string {
  return Object.entries(sources).filter(([, n]) => n > 0).map(([name, n]) => `${n} ${name}`).join(", ");
}

export interface LeakAllowed { file: string; blob?: string; words: number; reason: string }

export type LeakCheckResult =
  | { status: "skipped"; reason: string }
  | {
    status: "done"; sources: LeakSources; files: number; hits: LeakHit[]; allowed: LeakAllowed[];
    /** Blobs over the size limit, which a history scan counts but does not read. */
    unread: number;
    /** `runsDigest` of the private runs compared with, computed only if asked for (to tell whether CI's hash list is current). */
    digest: () => string;
  };

const readIfThere = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

/** Most specific first: a run in more than one place keeps the first label, and an atlas quote is also in its post. */
const LABEL_ORDER: LeakSource[] = ["an atlas quote", "an atlas statement", "an authored sample", "a voice negative", "post text"];

/**
 * The runs of every private text of every writer, each with where it came from. Null when there is
 * nothing to compare with. CI's keyed hash list is built from exactly these runs (scripts/advisor/leak-hashes.mts).
 */
export function privateRuns(corpusRoot: string): { runs: Map<string, LeakSource>; sources: LeakSources } | null {
  const sources: LeakSources = { "atlas entries": 0, "voice negatives": 0, "authored samples": 0, posts: 0 };
  const found: [LeakSource, Set<string>][] = [];
  const lines = (text: string) => text.split("\n").filter((l) => l.trim()).length;
  for (const writer of writers(corpusRoot)) {
    const dir = dataDir(writer, corpusRoot);
    const atlas = readIfThere(path.join(dir, "ATLAS.jsonl"));
    if (atlas !== null) {
      sources["atlas entries"] += lines(atlas);
      found.push(["an atlas quote", quoteRuns(atlas)], ["an atlas statement", atlasFieldRuns(atlas, "statement")]);
    }
    const authored = readIfThere(path.join(dir, "evals", "authored.jsonl"));
    if (authored !== null) {
      sources["authored samples"] += lines(authored);
      found.push(["an authored sample", jsonlRuns("authored.jsonl", authored)]);
    }
    const negatives = readIfThere(path.join(dir, "voice_negatives.jsonl"));
    if (negatives !== null) {
      sources["voice negatives"] += lines(negatives);
      found.push(["a voice negative", jsonlRuns("voice_negatives.jsonl", negatives)]);
    }
    for (const file of markdownFiles(path.join(dir, "posts"))) {
      sources.posts++;
      found.push(["post text", postRuns(fs.readFileSync(file, "utf8"))]);
    }
  }
  if (Object.values(sources).every((n) => n === 0)) return null;
  const runs = new Map<string, LeakSource>();
  for (const label of LABEL_ORDER) for (const [source, set] of found) if (source === label) for (const run of set) if (!runs.has(run)) runs.set(run, label);
  return { runs, sources };
}

/** A SHA-256 of distinct runs, the same whatever their order. It stays in the private data: never commit it. */
export function runsDigest(runs: Iterable<string>): string {
  const hash = createHash("sha256");
  for (const run of [...runs].sort()) hash.update(run).update("\n");
  return hash.digest("hex");
}

/** The digest of `found`'s runs, computed once and only when asked for. */
function lazyDigest(runs: ReadonlyMap<string, LeakSource>): () => string {
  let digest: string | undefined;
  return () => (digest ??= runsDigest(runs.keys()));
}

function compare(texts: Iterable<Text>, runs: RunSet, allowances: Record<string, LeakAllowance>): Pick<Extract<LeakCheckResult, { status: "done" }>, "files" | "hits" | "allowed"> {
  const hits: LeakHit[] = [];
  const allowed: LeakAllowed[] = [];
  const seen = new Set<string>();
  for (const { file, blob, text } of texts) {
    seen.add(blob ?? file);
    const found = findRuns(file, text, runs).map((hit) => (blob ? { ...hit, blob } : hit));
    if (found.length === 0) continue;
    const words = found.reduce((n, hit) => n + hit.words, 0);
    const allowance = Object.hasOwn(allowances, file) ? allowances[file] : undefined;
    if (allowance && words <= allowance.maxWords) allowed.push({ file, ...(blob && { blob }), words, reason: allowance.reason });
    else hits.push(...found);
  }
  return { files: seen.size, hits, allowed };
}

const SKIPPED = "no posts, atlas, voice negatives or authored samples in the private data";

/** Check every tracked file of `repoRoot` against the private text of every writer: posts, atlas quotes and statements, voice negatives and authored samples. */
export function leakCheck(repoRoot: string, corpusRoot: string = CORPUS_DIR, allowances: Record<string, LeakAllowance> = LEAK_ALLOWED): LeakCheckResult {
  const found = privateRuns(corpusRoot);
  if (!found) return { status: "skipped", reason: SKIPPED };
  return { status: "done", sources: found.sources, unread: 0, digest: lazyDigest(found.runs), ...compare(trackedTexts(repoRoot), found.runs, allowances) };
}

/**
 * The same comparison for every text blob reachable from any ref, not only the files checked out. A
 * blob is judged by each path it was committed at, against that path's allowance, so an old version of an allowed
 * page is held to the same cap and a copy of it at another path is not excused.
 * This reports; it does not rewrite history.
 */
export function leakCheckHistory(repoRoot: string, corpusRoot: string = CORPUS_DIR, allowances: Record<string, LeakAllowance> = LEAK_ALLOWED): LeakCheckResult {
  const found = privateRuns(corpusRoot);
  if (!found) return { status: "skipped", reason: SKIPPED };
  return { status: "done", sources: found.sources, digest: lazyDigest(found.runs), ...compareRevs(repoRoot, ["--all"], found.runs, allowances) };
}

/** One line git gives a pre-push hook: what is being pushed to which ref, and what the remote has there. */
export interface PushUpdate { localRef: string; localSha: string; remoteRef: string; remoteSha: string }

const ZERO_SHA = /^0+$/;

/** The lines of a pre-push hook's stdin: `<local ref> <local sha> <remote ref> <remote sha>`. */
export function parsePushUpdates(stdin: string): PushUpdate[] {
  const updates: PushUpdate[] = [];
  for (const line of stdin.split("\n")) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    // A ref name may not hold whitespace, so anything but four fields is not what git sends.
    if (fields.length !== 4 || !/^[0-9a-f]{40,64}$/.test(fields[1]) || !/^[0-9a-f]{40,64}$/.test(fields[3])) throw new Error("unexpected pre-push input: expected `<local ref> <local sha> <remote ref> <remote sha>` lines");
    updates.push({ localRef: fields[0], localSha: fields[1], remoteRef: fields[2], remoteSha: fields[3] });
  }
  return updates;
}

/** What `leak-check --pushed` found: the corpus comparison (skipped without private data), and the private-page check, which needs none. */
export type PushedCheckResult = LeakCheckResult & { privatePages: PrivatePageLeaks };

/**
 * The `git rev-list` arguments for what a push adds: the pushed commits, not what `remote` already has (its
 * remote-tracking refs, and each ref's current value when this repo knows that commit). Null when the push adds no
 * commit (only deletes).
 */
function pushedRevs(repoRoot: string, updates: PushUpdate[], remote: string): string[] | null {
  const pushed = [...new Set(updates.filter((u) => !ZERO_SHA.test(u.localSha)).map((u) => u.localSha))];
  if (pushed.length === 0) return null;
  // The remote's current value for each ref, where this clone has that commit (one call, whatever the number of refs).
  const remoteShas = [...new Set(updates.map((u) => u.remoteSha).filter((sha) => !ZERO_SHA.test(sha)))];
  const onRemote = remoteShas.length === 0 ? [] : gitOut(repoRoot, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], remoteShas.map((sha) => `${sha}^{commit}`).join("\n") + "\n").toString("utf8")
    .split("\n").filter((line) => line.endsWith(" commit")).map((line) => line.split(" ")[0]);
  // `--remotes=<pattern>` is a glob, so only a plain remote name is passed; a URL has no tracking refs anyway.
  return [...pushed, "--not", ...(/^[\w.-]+$/.test(remote) ? [`--remotes=${remote}`] : []), ...onRemote];
}

/**
 * The same comparison for the blobs a push would add: those reachable from the pushed commits but not from what
 * `remote` already has (its remote-tracking refs, and each ref's current value when this repo knows that commit).
 * A new branch has no remote value, so its base is the tracking refs; a delete adds nothing. A `remote` that is a
 * URL has no tracking refs, so everything reachable from the pushed refs is read: more than needed, never less.
 * A blob is judged by each path it was committed at, as in `leakCheckHistory`, so text already in older history
 * (and the allowances that cover it) does not block a push that doesn't add it. Remote-tracking refs are whatever this
 * clone last fetched, so a stale one counts as what the remote has.
 * The same read also runs the private-page check (scripts/private-leaks.mts) on those blobs and on the commits the
 * push adds. That needs no private data, so it runs, and `updates` is read, even when the corpus comparison skips.
 */
export function leakCheckPushed(repoRoot: string, updates: PushUpdate[] | (() => PushUpdate[]), remote: string, corpusRoot: string = CORPUS_DIR, allowances: Record<string, LeakAllowance> = LEAK_ALLOWED): PushedCheckResult {
  const found = privateRuns(corpusRoot);
  const revs = pushedRevs(repoRoot, typeof updates === "function" ? updates() : updates, remote);
  const { corpus, privatePages } = revs ? scanRevs(repoRoot, revs, found?.runs ?? null, allowances) : { corpus: NOTHING_COMPARED, privatePages: NO_PRIVATE_PAGE_LEAKS };
  if (!found) return { status: "skipped", reason: SKIPPED, privatePages };
  return { status: "done", sources: found.sources, digest: lazyDigest(found.runs), ...corpus, privatePages };
}

/** What a comparison of blobs found, without the private sources it compared with. */
export type BlobComparison = Pick<Extract<LeakCheckResult, { status: "done" }>, "files" | "hits" | "allowed" | "unread">;

/**
 * Every text blob reachable from `revs` (arguments to `git rev-list`, such as `[head, "--not", base]`) compared
 * with `runs`, each blob judged by each path it was committed at against that path's allowance. The local checks
 * and CI's hashed check (scripts/advisor/leak-hashes.mts) all come through here, so they read text the same way.
 */
export function compareRevs(repoRoot: string, revs: string[], runs: RunSet, allowances: Record<string, LeakAllowance> = LEAK_ALLOWED): BlobComparison {
  const stats: HistoryStats = { tooLarge: 0 };
  const compared = compare(historyTexts(repoRoot, stats, revs), runs, allowances);
  return { ...compared, unread: stats.tooLarge };
}

const NOTHING_COMPARED: BlobComparison = { files: 0, hits: [], allowed: [], unread: 0 };

/**
 * What `revs` add, with the blobs read once: the private-page check (a `#k=` key in a blob or a commit message, a
 * `*.private.html` path) always, and with `runs`, the corpus comparison of `compareRevs` on the same blobs. Without
 * `runs` (no private data, or no CI secret) the corpus side compares nothing and says how many blobs it read.
 */
export function scanRevs(repoRoot: string, revs: string[], runs: RunSet | null, allowances: Record<string, LeakAllowance> = LEAK_ALLOWED): { corpus: BlobComparison; privatePages: PrivatePageLeaks } {
  const stats: HistoryStats = { tooLarge: 0 };
  const keys: KeyHit[] = [];
  const blobs = new Map<string, number[]>();
  function* checked(): Generator<Text> {
    for (const text of historyTexts(repoRoot, stats, revs)) {
      const blob = text.blob!;
      let lines = blobs.get(blob);
      if (!lines) blobs.set(blob, (lines = keyLines(text.text)));
      for (const line of lines) keys.push({ file: text.file, blob, line });
      yield text;
    }
  }
  let corpus: BlobComparison;
  if (runs) corpus = { ...compare(checked(), runs, allowances), unread: stats.tooLarge };
  else {
    for (const _ of checked());
    corpus = { ...NOTHING_COMPARED, files: blobs.size, unread: stats.tooLarge };
  }
  const commits = commitLeaks((args, input) => gitOut(repoRoot, args, input), revs);
  return { corpus, privatePages: { keys: [...keys, ...commits.keys], plaintext: commits.plaintext, commits: commits.commits, blobs: blobs.size } };
}
