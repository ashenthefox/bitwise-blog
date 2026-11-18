// Two private-page rules (contracts/private-pages.md) as checks, since both are irreversible once pushed to this
// public repo: a private page's plaintext (`*.private.html`) is never committed, and no `#k=` key is ever in a
// committed file or a commit message.
//
// `check` fails on a tracked plaintext (`trackedPrivatePlaintext`). The pre-push hook and the Leak check workflow
// look at what a push or a change adds (`leak-check --pushed` and `--hashed` in scripts/advisor.mts): the blobs the
// corpus check reads already pass through `keyLines`, and `commitLeaks` reads the added commits' messages and the
// paths they add. None of this needs the private corpus, so it runs in a checkout without it, and in CI without a
// secret. As with the corpus check, the output names files, commits and lines, never the key.

import { spawnSync } from "node:child_process";

/**
 * A key: `#k=` (or `&k=`, a later key in a home-page link) and the 43 base64url characters that 32 random bytes
 * make (`storeKey` in scripts/bh.mts). A longer run still holds a whole key, so it counts; a shorter one doesn't.
 * Placeholders such as `#k=<key>`, `#k=…` or `#k=${key}` don't match.
 */
export const KEY_PATTERN = /[#&]k=[A-Za-z0-9_-]{43}/;

/** The 1-based numbers of the lines of `text` that hold a key. Never the key itself. */
export function keyLines(text: string): number[] {
  if (!KEY_PATTERN.test(text)) return [];
  const lines: number[] = [];
  text.split("\n").forEach((line, i) => { if (KEY_PATTERN.test(line)) lines.push(i + 1); });
  return lines;
}

/** A private page's plaintext. Only `docs/*.private.html` is a source, but the name is refused anywhere, in any case. */
export const isPrivatePlaintext = (file: string): boolean => /\.private\.html$/i.test(file);

/**
 * The `*.private.html` files git tracks in `repoRoot` (staged ones included, so a `git add -f` shows at once). Empty
 * when `repoRoot` is not in a git checkout, which then tracks nothing; the push checks below are the guard that
 * must not pass open.
 */
export function trackedPrivatePlaintext(repoRoot: string): string[] {
  const r = spawnSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 60_000 });
  if (r.status !== 0) return [];
  return r.stdout.split("\0").filter((file) => file && isPrivatePlaintext(file));
}

/** Where a key was found: a line of a blob at a path, or of a commit's (or an annotated tag's) message. */
export type KeyHit = { line: number } & ({ file: string; blob: string } | { commit: string } | { tag: string });

/** A pushed commit that adds or changes a `*.private.html` path. */
export interface PlaintextHit { file: string; commit: string }

/** What the private-page check found in a range, and how much it read. */
export interface PrivatePageLeaks { keys: KeyHit[]; plaintext: PlaintextHit[]; commits: number; blobs: number }

export const NO_PRIVATE_PAGE_LEAKS: PrivatePageLeaks = { keys: [], plaintext: [], commits: 0, blobs: 0 };

/** Runs git for a check and returns what it printed; it throws when git fails (`gitOut` in scripts/advisor/guards.mts). */
export type Git = (args: string[], input?: string) => Buffer;

/** The message of a raw commit or tag object: everything after the headers (a signature header has no blank line). */
function messageOf(object: string): string {
  const end = object.indexOf("\n\n");
  return end === -1 ? "" : object.slice(end + 2);
}

/** Each object `git cat-file --batch` printed for `ids`, with its type. */
function readObjects(git: Git, ids: string[]): { id: string; type: string; text: string }[] {
  if (ids.length === 0) return [];
  const out = git(["cat-file", "--batch"], ids.join("\n") + "\n");
  const objects: { id: string; type: string; text: string }[] = [];
  for (let at = 0; at < out.length;) {
    const headerEnd = out.indexOf("\n", at);
    const [id, type, size] = out.toString("utf8", at, headerEnd).split(" ");
    if (type === "missing" || size === undefined) { at = headerEnd + 1; continue; }
    objects.push({ id, type, text: out.toString("utf8", headerEnd + 1, headerEnd + 1 + Number(size)) });
    at = headerEnd + 1 + Number(size) + 1;
  }
  return objects;
}

/**
 * The commit side of the check for `revs` (arguments to `git rev-list`, such as `[head, "--not", base]`): a key in
 * the message of any commit they add, or of an annotated tag among the positive revs (what a tag push sends), and
 * any `*.private.html` path a commit adds or changes. Paths come from each commit's diff against each parent (`-m`),
 * so a merge that brings one in is refused, and so is a commit that adds one whose blob the remote already has.
 * A deletion is the fix, so it is not refused.
 */
export function commitLeaks(git: Git, revs: string[]): Omit<PrivatePageLeaks, "blobs"> {
  const keys: KeyHit[] = [];
  const commits = git(["rev-list", ...revs]).toString("utf8").split("\n").filter(Boolean);
  for (const { id, text } of readObjects(git, commits)) for (const line of keyLines(messageOf(text))) keys.push({ commit: id.slice(0, 7), line });

  const positive = revs.slice(0, revs.includes("--not") ? revs.indexOf("--not") : revs.length).filter((rev) => /^[0-9a-f]{40,64}$/.test(rev));
  for (const { id, type, text } of readObjects(git, positive)) {
    if (type === "tag") for (const line of keyLines(messageOf(text))) keys.push({ tag: id.slice(0, 7), line });
  }

  const plaintext: PlaintextHit[] = [];
  const seen = new Set<string>();
  let commit = "";
  const tokens = git(["log", ...revs, "--root", "--no-renames", "-m", "--raw", "--no-abbrev", "-z", "--format=commit:%H"]).toString("utf8").split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].replace(/^\n+/, "");
    if (token.startsWith("commit:")) commit = token.slice("commit:".length, "commit:".length + 7);
    else if (token.startsWith(":") && i + 1 < tokens.length) {
      const file = tokens[++i];
      const added = token.split(" ")[3];
      if (added && !/^0+$/.test(added) && isPrivatePlaintext(file) && !seen.has(`${commit} ${file}`)) {
        seen.add(`${commit} ${file}`);
        plaintext.push({ file, commit });
      }
    }
  }
  return { keys, plaintext, commits: commits.length };
}

/** Whether the check found anything. */
export const hasPrivatePageLeaks = (found: PrivatePageLeaks): boolean => found.keys.length + found.plaintext.length > 0;

/** One line per finding, without the key: `file@blob:line`, `commit abc1234: message line 3`, `file in commit abc1234`. */
export function describeKeyHit(hit: KeyHit): string {
  if ("file" in hit) return `${hit.file}@${hit.blob}:${hit.line}: a private page's #k= key`;
  if ("commit" in hit) return `commit ${hit.commit}: line ${hit.line} of its message holds a private page's #k= key`;
  return `tag ${hit.tag}: line ${hit.line} of its message holds a private page's #k= key`;
}
export const describePlaintextHit = (hit: PlaintextHit): string => `${hit.file} in commit ${hit.commit}: a private page's plaintext (*.private.html), which must never be committed`;

/** The summary for a check that found something: what to do, which is to rewrite the commits before anything is pushed. */
export function privatePageFailure(name: string, found: PrivatePageLeaks): string {
  const parts = [
    ...(found.keys.length ? [`${found.keys.length} #k= key(s)`] : []),
    ...(found.plaintext.length ? [`${found.plaintext.length} private page plaintext file(s)`] : []),
  ];
  return `${name} FAILED: ${parts.join(" and ")} in what this adds. Rewrite the commits that hold them (amend, or rebase and reword or drop): a later commit that removes one leaves it in the history. Unstage a plaintext with \`git rm --cached <file>\`; \`npm run seal\` makes the copy to commit. A key that was ever pushed or posted anywhere public is leaked for good (contracts/private-pages.md).`;
}

/** The line for a check that found nothing. */
export const privatePagePassed = (name: string, found: PrivatePageLeaks): string =>
  `${name}: no private page key or plaintext in ${found.commits} commit(s) and ${found.blobs} blob(s)`;
