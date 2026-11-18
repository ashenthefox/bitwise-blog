#!/usr/bin/env node
// The advisor tools: everything that reads a writer's corpus. See corpus/README.md.
//
//   npm run advisor -- link <path-to-data-clone>   point this checkout's corpus/private at a clone of the data repo
//   npm run advisor -- index [<writer>]            regenerate the INDEX.md catalogues
//   npm run advisor -- holdout <writer> [--check]  choose (or check) the eval holdout
//   npm run advisor -- leak-check [--history | --pushed <remote>]
//                                                  does a tracked file (or any blob in history, or in the commits a push adds) hold a run of words from the private text?
//   npm run advisor -- leak-check --hashed [--head <rev>] [--base <rev>]
//                                                  the same for the blobs head adds to base, against corpus/leak-hashes.txt (what CI runs)
//   npm run advisor -- leak-hashes                 regenerate corpus/leak-hashes.txt from the private data and the key
//   npm run advisor -- parity                      does the port still agree with the Python reference?
//
// Exit code: 0 on success, 1 if a check or a command failed, 2 on a usage error.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { CORPUS_DIR, atlasEligible, danglingLink, loadMeta, loadPosts, privateDir, validate, writeMeta } from "./advisor/corpus.mts";
import { describeSources, leakCheck, leakCheckHistory, leakCheckPushed, parsePushUpdates, LEAK_RUN_WORDS } from "./advisor/guards.mts";
import { LEAK_HASHES_FILE, LEAK_KEY_ENV, LEAK_STAMP_FILE, hashListStatus, leakCheckHashed, resolveLeakKey, writeLeakHashes } from "./advisor/leak-hashes.mts";
import { applyHoldout, computeHoldout, DEFAULT_FRACTION, DEFAULT_SEED } from "./advisor/holdout.mts";
import { buildIndexes, writers } from "./advisor/index.mts";
import { parity } from "./advisor/parity.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `usage: npm run advisor -- <command>
  link <path-to-data-clone> [--force]    point this checkout's corpus/private at a clone of the private data repo (run it in
                                         the checkout to link; each git worktree needs its own)
  index [<writer>]                       regenerate the INDEX.md catalogues
  holdout <writer> [--check] [--fraction F] [--seed N]
                                         choose the eval holdout, or check it is current
  leak-check [--history | --pushed <remote>]
                                         fail if a tracked file holds a run of words from the private posts, atlas, voice
                                         negatives or authored samples; --history checks every text blob in any ref instead;
                                         --pushed reads a pre-push hook's stdin and checks only the blobs that push adds
  leak-check --hashed [--head <rev>] [--base <rev>]
                                         CI's check: the blobs head (default HEAD) adds to base (default: none, so every blob
                                         reachable from head), against corpus/leak-hashes.txt under the key in $BH_LEAK_KEY
  leak-hashes                            regenerate corpus/leak-hashes.txt from the private data and the key ($BH_LEAK_KEY, or
                                         the 1Password item "beautiful-html leak-check key")
  parity                                 compare with the Python reference; skips without private data`;

/** The two output streams a command writes to (the console, or a test's sink). */
export interface Output { log: (...args: any[]) => void; error: (...args: any[]) => void }

export interface AdvisorContext {
  out?: Output;
  /** Where corpus/ lives (default: the repo's). */
  corpusRoot?: string;
  /** The git checkout `leak-check` reads (default: this repo). */
  repoRoot?: string;
  /** What `leak-check --pushed` reads, git's pre-push lines (default: standard input). */
  stdin?: () => string;
  /** The environment: the key for `--hashed`, and GITHUB_ACTIONS (default: process.env). */
  env?: NodeJS.ProcessEnv;
  /** How `leak-hashes` reads the key from 1Password (default: the `op` CLI). */
  readItem?: (title: string, vault: string) => string;
}

/** How the hints name the command: where to run it, and that its argument is the data clone, not a checkout to link (#323). */
const linkHint = (repoRoot: string) => `run \`npm run advisor -- link <path-to-data-clone>\` in ${repoRoot} (the checkout to link; the argument is your clone of the private data repo, not a checkout of this one)`;

/** What `git rev-parse <flag>` prints for `dir`, or undefined when `dir` is in no git repository (or git can't say). */
function revParse(dir: string, flag: "--git-common-dir" | "--show-toplevel"): string | undefined {
  // Without git's own variables: GIT_DIR (set when a hook or an alias runs this) would answer for both directories alike.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_PREFIX"].includes(name)));
  const r = spawnSync("git", ["-C", dir, "rev-parse", flag], { encoding: "utf8", env, timeout: 30_000 });
  const printed = r.status === 0 ? r.stdout.replace(/\r?\n$/, "") : "";
  return printed || undefined;
}

/**
 * The real path of the git directory that every worktree of `dir`'s repository shares, or undefined when `dir`
 * is in no git repository (or git can't say). Two directories with the same one are checkouts of one repository.
 */
function gitCommonDir(dir: string): string | undefined {
  const printed = revParse(dir, "--git-common-dir");
  if (!printed) return undefined;
  // git prints it relative to `dir` in a main checkout (".git") and absolute in a linked worktree.
  const common = path.resolve(dir, printed);
  return fs.existsSync(common) ? fs.realpathSync(common) : undefined;
}

/**
 * A file every checkout of this repository has at its root and the private data never would: this command itself
 * (`scripts/advisor.mts`). It moves with the code, so a rename can't leave the check looking for a file that is gone.
 */
const OWN_FILE = path.relative(ROOT, fileURLToPath(import.meta.url));

/**
 * Whether `target` is in a checkout of this repository: another worktree (the same git common directory), or a
 * separate clone, fork or copy, which has a git directory of its own (or none) but this command at its root (#334).
 * The root looked at is the target's git top level, so a directory inside a clone counts, and the target itself.
 */
function isCheckoutOfThisRepo(target: string, repoRoot: string): boolean {
  const ours = gitCommonDir(repoRoot);
  if (ours !== undefined && gitCommonDir(target) === ours) return true;
  const top = revParse(target, "--show-toplevel");
  return [target, ...(top ? [top] : [])].some((root) => fs.statSync(path.join(root, OWN_FILE), { throwIfNoEntry: false })?.isFile() ?? false);
}

/**
 * Make corpus/private a symlink to the data repo. One per worktree, since worktrees don't share ignored files:
 * run in the checkout to link, with the data clone as the argument.
 */
function cmdLink(target: string, force: boolean, corpusRoot: string, repoRoot: string, out: Output): number {
  const resolved = path.resolve(target);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    out.error(`error: ${resolved} is not a directory`);
    return 1;
  }
  // Real paths, so a symlink can't hide that the target is inside. Only corpus/private is ignored, so
  // a directory anywhere else in the repository would be one `git add -A` away from being public.
  const relative = path.relative(fs.realpathSync(repoRoot), fs.realpathSync(resolved));
  if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    out.error(`error: ${resolved} is inside this repository; the private data must live outside it`);
    return 1;
  }
  // Another worktree, clone or copy of this repository is not the private data: linked, it would make this checkout
  // look linked while leak-check found no posts and checked nothing, and it would dangle once a worktree went (#323, #334).
  if (isCheckoutOfThisRepo(resolved, repoRoot)) {
    out.error(`error: ${resolved} is a checkout of this repository, not the private data. The argument is your clone of the private data repo; to link a worktree, run this command in that worktree with the data clone's path. Nothing was changed.`);
    return 1;
  }
  const link = privateDir(corpusRoot);
  const existing = fs.lstatSync(link, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) {
    if (path.resolve(path.dirname(link), fs.readlinkSync(link)) === resolved) {
      out.log(`corpus/private already points at ${resolved}`);
      return 0;
    }
    if (!force) {
      out.error(`error: corpus/private points at ${fs.readlinkSync(link)}; pass --force to repoint it`);
      return 1;
    }
    fs.unlinkSync(link);
  } else if (existing) {
    // A real directory may hold synced posts that exist nowhere else.
    if (!existing.isDirectory() || fs.readdirSync(link).length > 0) {
      out.error(`error: corpus/private exists and is not an empty directory; move its contents into ${resolved} first`);
      return 1;
    }
    fs.rmdirSync(link);
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(resolved, link, "dir");
  const found = writers(corpusRoot);
  out.log(`corpus/private -> ${resolved} (${found.length ? `writers: ${found.join(", ")}` : "no writers yet"})`);
  // Linked all the same: a new, empty clone is a fair target before the first `sync-posts`. But say what it means.
  if (!found.length) out.error(`warning: ${resolved} holds no writer (no <writer>/posts/ directory), so leak-check has nothing to compare with and will skip. If that is not your clone of the private data repo, repoint the link: \`npm run advisor -- link --force <path-to-data-clone>\`.`);
  return 0;
}

function cmdHoldout(slug: string, options: { check: boolean; fraction: number; seed: number }, corpusRoot: string, out: Output): number {
  const meta = loadMeta(slug, corpusRoot);
  if (Object.keys(meta).length === 0) {
    out.error(`error: no corpus_meta.yaml for ${slug}`);
    return 1;
  }
  // A stale holdout may legitimately break the eval-versus-exclude rule; recomputing fixes it.
  const blocking = validate(slug, corpusRoot).filter((p) => !p.includes("eval holdout post is excluded"));
  if (blocking.length) {
    out.error(`error: corpus_meta.yaml is inconsistent:\n  ${blocking.join("\n  ")}`);
    return 1;
  }
  const posts = loadPosts(slug, corpusRoot);
  const chosen = computeHoldout(posts, options.fraction, options.seed);
  const updated = applyHoldout(meta, chosen);
  if (options.check) {
    if (!isDeepStrictEqual(updated, meta)) {
      out.error(`${slug}: holdout is stale; run \`npm run advisor -- holdout ${slug}\``);
      return 1;
    }
    out.log(`${slug}: holdout up to date (${chosen.size} eval posts)`);
    return 0;
  }
  writeMeta(slug, updated, corpusRoot);
  out.log(`${slug}: ${chosen.size} of ${posts.filter(atlasEligible).length} atlas-eligible posts held out for eval`);
  return 0;
}

/** Which blobs `leak-check` reads: the checked-out files, every blob in history, or the blobs a push adds (from this remote's point of view). */
type LeakScope = { kind: "tracked" } | { kind: "history" } | { kind: "pushed"; remote: string; stdin: () => string };

function cmdLeakCheck(repoRoot: string, corpusRoot: string, scope: LeakScope, out: Output): number {
  const name = scope.kind === "tracked" ? "leak-check" : `leak-check --${scope.kind}`;
  const blobs = scope.kind !== "tracked";
  const result =
    scope.kind === "history" ? leakCheckHistory(repoRoot, corpusRoot)
    : scope.kind === "pushed" ? leakCheckPushed(repoRoot, () => parsePushUpdates(scope.stdin()), scope.remote, corpusRoot)
    : leakCheck(repoRoot, corpusRoot);
  if (result.status === "skipped") {
    out.log(`${name} skipped: ${result.reason}. Nothing was checked. To point this checkout at the private data, ${linkHint(repoRoot)}.`);
    return 0;
  }
  // Only places and lengths, never the words: this output may end up somewhere public.
  const where = (item: { file: string; blob?: string }) => (item.blob ? `${item.file}@${item.blob}` : item.file);
  for (const hit of result.hits) out.error(`${where(hit)}:${hit.line}: ${hit.words}-word run from ${hit.source ?? "the private data"}`);
  if (result.hits.length) {
    out.error(`${name} FAILED: ${result.hits.length} run(s) of ${LEAK_RUN_WORDS}+ words in ${scope.kind === "history" ? "blobs in history" : scope.kind === "pushed" ? "blobs this push adds" : "tracked files"}`);
    return 1;
  }
  for (const item of result.allowed) out.log(`allowed: ${where(item)} (${item.words} words): ${item.reason}`);
  if (result.unread) out.log(`note: ${result.unread} blob(s) over 8 MiB were not read`);
  out.log(`${name} passed: ${describeSources(result.sources)}; ${result.files} ${blobs ? "blobs" : "tracked files"}`);
  // Whether CI's copy is current needs no key: the generator left a stamp in the private data. Not a failure, since
  // what is being pushed has just been checked in full; CI is the one that is behind.
  const listed = hashListStatus(result.digest, repoRoot, corpusRoot);
  if (listed === "stale") out.log(`note: corpus/${LEAK_HASHES_FILE} is stale (the private data or the list changed since it was generated), so CI's leak check misses the new text; regenerate it with \`npm run advisor -- leak-hashes\` and commit it`);
  if (listed === "uncommitted") out.log(`note: corpus/${LEAK_HASHES_FILE} on disk is not the one committed at HEAD, and CI uses the committed one; commit it`);
  if (listed === "unknown") out.log(`note: can't tell whether corpus/${LEAK_HASHES_FILE} is current: the private data has no ${LEAK_STAMP_FILE} (commit it in the private data repo where it was generated, so every clone has it)`);
  return 0;
}

/** CI's check. Under GitHub Actions, a skip is a notice or warning on the run and each hit an error annotation. */
function cmdLeakCheckHashed(repoRoot: string, corpusRoot: string, head: string, base: string | undefined, env: NodeJS.ProcessEnv, out: Output): number {
  const name = "leak-check --hashed";
  const actions = env["GITHUB_ACTIONS"] === "true";
  // Workflow commands carry their message on one line; % and line breaks are escaped as GitHub documents.
  const escapeData = (text: string) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const escapeProperty = (text: string) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const annotate = (level: "notice" | "error", message: string, where = "") => `::${level}${where}::${escapeData(message)}`;
  const result = leakCheckHashed(repoRoot, head, base, env[LEAK_KEY_ENV], corpusRoot);
  if (result.status === "skipped") {
    const message = `${name} skipped: ${result.reason}.`;
    out.log(actions ? annotate(result.level, message) : message);
    return 0;
  }
  if (result.baseUnknown) out.log(`note: the base is not a commit in this clone, so every blob reachable from the head was read`);
  const where = (item: { file: string; blob?: string }) => (item.blob ? `${item.file}@${item.blob}` : item.file);
  for (const hit of result.hits) {
    // The hash list can't say where a run came from, and never holds the words.
    const message = `${where(hit)}:${hit.line}: ${hit.words}-word run from the private data`;
    out.error(actions ? annotate("error", message, ` file=${escapeProperty(hit.file)},line=${hit.line}`) : message);
  }
  if (result.hits.length) {
    out.error(`${name} FAILED: ${result.hits.length} run(s) of ${LEAK_RUN_WORDS}+ words in the blobs these commits add. Remove the text (it is still in the branch's history: drop or rewrite the commit), or add a reviewed entry to LEAK_ALLOWED in scripts/advisor/guards.mts.`);
    return 1;
  }
  for (const item of result.allowed) out.log(`allowed: ${where(item)} (${item.words} words): ${item.reason}`);
  if (result.unread) out.log(`note: ${result.unread} blob(s) over 8 MiB were not read`);
  out.log(`${name} passed: ${result.files} blobs, against corpus/${LEAK_HASHES_FILE}`);
  return 0;
}

function cmdLeakHashes(corpusRoot: string, env: NodeJS.ProcessEnv, readItem: AdvisorContext["readItem"], out: Output): number {
  const resolved = resolveLeakKey({ env, ...(readItem && { readItem }) });
  if (resolved.error !== undefined) {
    out.error(`error: ${resolved.error}`);
    return 1;
  }
  const entries = writeLeakHashes(resolved.key, corpusRoot);
  out.log(`corpus/${LEAK_HASHES_FILE}: ${entries} entries (runs padded to a power of two); stamp in corpus/private/${LEAK_STAMP_FILE}. Commit corpus/${LEAK_HASHES_FILE}.`);
  return 0;
}

function cmdParity(repoRoot: string, corpusRoot: string, out: Output): number {
  const result = parity(repoRoot, corpusRoot);
  if (result.status === "skipped") {
    out.log(`parity skipped: ${result.reason}`);
    return 0;
  }
  for (const [writer, row] of result.rows) out.log(`${row.status.toUpperCase().padEnd(7)} ${writer.padEnd(16)} ${row.check.padEnd(32)} ${row.detail}`);
  return result.rows.some(([, row]) => row.status === "fail") ? 1 : 0;
}

export async function main(argv: string[] = process.argv.slice(2), context: AdvisorContext = {}): Promise<number> {
  const { out = console, corpusRoot = CORPUS_DIR, repoRoot = ROOT, stdin = () => fs.readFileSync(0, "utf8"), env = process.env, readItem } = context;
  const usageError = (message?: string) => {
    out.error(message ? `${message}\n${USAGE}` : USAGE);
    return 2;
  };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        check: { type: "boolean" }, force: { type: "boolean" }, history: { type: "boolean" }, pushed: { type: "string" }, hashed: { type: "boolean" },
        head: { type: "string" }, base: { type: "string" }, fraction: { type: "string" }, seed: { type: "string" },
      },
    });
  } catch (e) {
    return usageError((e as Error).message);
  }
  const { values } = parsed;
  const [command, ...args] = parsed.positionals;
  if ((values.history || values.pushed !== undefined || values.hashed) && command !== "leak-check") return usageError(`--${values.history ? "history" : values.hashed ? "hashed" : "pushed"} only applies to leak-check`);
  if ([values.history, values.pushed !== undefined, values.hashed].filter(Boolean).length > 1) return usageError("--history, --pushed and --hashed cannot be combined");
  if ((values.head !== undefined || values.base !== undefined) && !values.hashed) return usageError("--head and --base only apply to leak-check --hashed");
  // Without this, leak-check would report "skipped" and exit 0 having checked nothing.
  if (command !== "link" && danglingLink(corpusRoot)) {
    out.error(`error: corpus/private points at ${fs.readlinkSync(privateDir(corpusRoot))}, which doesn't exist; ${linkHint(repoRoot)}`);
    return 1;
  }
  try {
    return dispatch(command, args, values, { out, corpusRoot, repoRoot, stdin, env, readItem, usageError });
  } catch (e) {
    // The message only, with no stack, and no command prints text from the corpus in one.
    out.error(`error: ${(e as Error).message}`);
    return 1;
  }
}

interface Dispatch { out: Output; corpusRoot: string; repoRoot: string; stdin: () => string; env: NodeJS.ProcessEnv; readItem: AdvisorContext["readItem"]; usageError: (message?: string) => number }
interface Flags { check?: boolean; force?: boolean; history?: boolean; pushed?: string; hashed?: boolean; head?: string; base?: string; fraction?: string; seed?: string }

function dispatch(command: string | undefined, args: string[], values: Flags, { out, corpusRoot, repoRoot, stdin, env, readItem, usageError }: Dispatch): number {
  switch (command) {
    case "link":
      if (args.length !== 1) return usageError();
      return cmdLink(args[0], values.force ?? false, corpusRoot, repoRoot, out);
    case "index": {
      if (args.length > 1) return usageError();
      const report = buildIndexes(args[0], corpusRoot);
      if (report.length === 0) {
        out.error(args[0] ? `error: no posts for ${args[0]}` : "error: nothing to index; is corpus/private linked?");
        return 1;
      }
      for (const line of report) out.log(line);
      return 0;
    }
    case "holdout": {
      if (args.length !== 1) return usageError();
      const fraction = values.fraction === undefined ? DEFAULT_FRACTION : Number(values.fraction);
      if (!(fraction > 0 && fraction < 1)) return usageError("--fraction must be between 0 and 1 (exclusive)");
      const seed = values.seed === undefined ? DEFAULT_SEED : Number(values.seed);
      if (!Number.isInteger(seed)) return usageError("--seed must be an integer");
      return cmdHoldout(args[0], { check: values.check ?? false, fraction, seed }, corpusRoot, out);
    }
    case "leak-check":
      if (args.length) return usageError();
      if (values.hashed) return cmdLeakCheckHashed(repoRoot, corpusRoot, values.head ?? "HEAD", values.base, env, out);
      return cmdLeakCheck(repoRoot, corpusRoot, values.pushed !== undefined ? { kind: "pushed", remote: values.pushed, stdin } : values.history ? { kind: "history" } : { kind: "tracked" }, out);
    case "leak-hashes":
      if (args.length) return usageError();
      return cmdLeakHashes(corpusRoot, env, readItem, out);
    case "parity":
      if (args.length) return usageError();
      return cmdParity(repoRoot, corpusRoot, out);
    default:
      return usageError(command ? `unknown command: ${command}` : undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
