#!/usr/bin/env node
// Discussion report: which posts have a GitHub Discussions thread that `bh:discuss` does not point at.
//
//   npm run discussions                       list the findings, exit 1 if there is a problem
//   npm run discussions -- --markdown <file>  also write the report as Markdown
//
// Read-only: it never edits a page. It lists the repo's discussions with `gh api graphql`, matches each to
// posts by the post's canonical URL in the thread's body (the URL the "start it" link puts there), and
// reports a post with a thread but no pin, a post with several threads, and a pin whose thread does not
// mention the post. `.github/workflows/discussions.yml` runs it weekly. Zero dependencies. See
// contracts/discuss.md.
//
// The report can run in a public workflow, and a discussion can quote any URL, so an unlisted page is only
// ever called "an unlisted page" here, and private pages and sealed shells never enter the list.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPages, siteBase } from "./links.mts";
import type { Gh as LinksGh, Env as LinksEnv, Output as LinksOutput } from "./links.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PAGE_SIZE = 100;
const MAX_PAGES = 50; // 5,000 discussions: far past this blog, and a loop that cannot end is worse than a cut-off
const DISCUSSIONS_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(?<!\.git)\/discussions$/;

/** One discussion thread, as the report needs it. */
export interface Thread { number: number; title: string; body: string; url: string }

/** A page of the site and what the report needs to know about it. */
export interface Page {
  href: string;
  /** The canonical URL (`homepage` + href). */
  url: string;
  title: string;
  /** `bh:discuss`: "" when absent, "off", or the thread's URL. */
  pin: string;
  /** Gets a "Discuss this post" block, so a thread belongs on it. */
  post: boolean;
  unlisted: boolean;
}

export type FindingKind = "unpinned" | "duplicates" | "wrong-pin" | "unlisted-mention";
export interface Finding {
  kind: FindingKind;
  /** A problem fails the run; a note is information. */
  severity: "problem" | "note";
  /** The page's path, or "" for an unlisted page, which is never named. */
  page: string;
  threads: number[];
  /** Matched by the title alone, which is a weaker hint than the URL. */
  weak?: boolean;
  message: string;
}

export interface Report { findings: Finding[]; posts: number; threads: number; date: string }

export type Gh = (args: string[], input?: string) => string;
export type Env = LinksEnv;
export type Output = LinksOutput;

// ---- Pages -----------------------------------------------------------------------------

const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
const getMeta = (html: string, name: string): string =>
  (html.match(new RegExp(`<meta\\s+name="${name.replace(":", "\\:")}"\\s+content="([^"]*)"`, "i")) ?? [])[1]?.trim() ?? "";
const getTitle = (html: string): string => (html.match(/<title>([^<]*)<\/title>/i) ?? [])[1]?.trim() ?? "";
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()] ?? m;
  });

/**
 * The published pages that can have a thread, with the metas that decide it. A page is a post (gets a "Discuss this
 * post" block) unless it is unlisted, an example, a `reference` page or opted out with `bh:discuss` `off`, and the
 * home page is not a page here at all: `discussExclusion` in `bh.mts`, which a standalone script cannot import.
 */
export function readSitePages(root: string = ROOT, base: string = siteBase(root)): Page[] {
  return readPages(root).filter((p) => p.page.href !== "index.html").map(({ page, html }) => {
    const head = stripComments(html);
    const pin = getMeta(head, "bh:discuss");
    const kind = getMeta(head, "bh:kind") || "explainer";
    return {
      href: page.href,
      url: base + page.href,
      title: decodeEntities(getTitle(head)),
      pin,
      post: !page.unlisted && kind !== "reference" && pin !== "off",
      unlisted: page.unlisted,
    };
  });
}

// ---- Matching --------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `body` contains `url` as a whole URL: not as the tail of another URL, nor the head of a longer path (`a.html5`). */
export function mentions(body: string, url: string): boolean {
  return new RegExp(`(?<![\\w./-])${escapeRe(url)}(?![\\w%~-])`, "i").test(body.replace(/\r/g, "")); // slugs are lowercase: case is no evidence
}

const normTitle = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

interface Match { thread: Thread; weak: boolean }

/**
 * Each page's threads: those whose body mentions its canonical URL; only a thread that mentions no page's URL is
 * matched by title instead, when it repeats a post's title exactly (a weaker hint: the "start it" link prefills the
 * title, but anyone can retitle a thread) and the title is that post's alone. An unlisted page is matched by URL
 * alone, since a title match would need its title.
 */
export function matchThreads(pages: Page[], threads: Thread[]): Map<string, Match[]> {
  const byPage = new Map<string, Match[]>();
  const add = (href: string, m: Match) => byPage.set(href, [...(byPage.get(href) ?? []), m]);
  // Two posts with one title (a series) cannot be told apart by it.
  const titleCount = new Map<string, number>();
  for (const p of pages) if (p.post) titleCount.set(normTitle(p.title), (titleCount.get(normTitle(p.title)) ?? 0) + 1);
  for (const thread of threads) {
    const urlHits = pages.filter((p) => mentions(thread.body, p.url));
    if (urlHits.length) { for (const p of urlHits) add(p.href, { thread, weak: false }); continue; }
    const title = normTitle(thread.title);
    for (const p of pages) if (p.post && title && normTitle(p.title) === title && titleCount.get(title) === 1) add(p.href, { thread, weak: true });
  }
  return byPage;
}

const threadNumber = (pin: string, discussionsUrl: string): number | undefined => {
  const m = new RegExp(`^${escapeRe(discussionsUrl)}/(\\d+)$`).exec(pin);
  return m ? Number(m[1]) : undefined;
};

// ---- Findings --------------------------------------------------------------------------

const list = (ns: number[]) => ns.map((n) => `#${n}`).join(", ");

/** What to tell the author, from the pages and the threads. */
export function findFindings(pages: Page[], threads: Thread[], discussionsUrl: string): Finding[] {
  const matches = matchThreads(pages, threads);
  const byNumber = new Map(threads.map((t) => [t.number, t]));
  const out: Finding[] = [];

  for (const page of pages) {
    // A title-only match is a guess, so it counts only when no thread quotes the URL: otherwise an unrelated thread
    // that shares the title would turn a correctly pinned post into "duplicates".
    const all = matches.get(page.href) ?? [];
    const found = (all.some((m) => !m.weak) ? all.filter((m) => !m.weak) : [...all]).sort((a, b) => a.thread.number - b.thread.number);
    const numbers = found.map((m) => m.thread.number);
    const weak = found.length > 0 && found.every((m) => m.weak);
    if (page.unlisted) {
      // Unlisted controls discoverability, and a public thread that quotes the page widens it. The author can only
      // edit the thread, so this is a note, and it never says which page.
      if (found.length) out.push({ kind: "unlisted-mention", severity: "note", page: "", threads: numbers, message: `${found.length === 1 ? "Discussion" : "Discussions"} ${list(numbers)} quote${found.length === 1 ? "s" : ""} the URL of an unlisted page. A discussion is public, so that page is no longer only for people who were given its link.` });
      continue;
    }
    if (!page.post) continue;

    const pinned = page.pin ? threadNumber(page.pin, discussionsUrl) : undefined;
    if (found.length >= 2) {
      out.push({ kind: "duplicates", severity: "problem", page: page.href, threads: numbers, weak,
        message: `${list(numbers)} look like threads for the same post${weak ? " (matched by title only)" : ""}. Merge or close all but one${pinned === undefined ? ", then pin the one that is left" : ""}.` });
    } else if (found.length === 1 && !page.pin) {
      const n = numbers[0]!;
      out.push({ kind: "unpinned", severity: "problem", page: page.href, threads: numbers, weak,
        message: `${weak ? `${list(numbers)} has this post's title but does not quote its URL. If it is the post's thread, pin it` : `${list(numbers)} is this post's thread. Pin it`}: \`<meta name="bh:discuss" content="${discussionsUrl}/${n}">\`` });
    }
    // A pin must point at a thread about this post. A thread that is not in the list (deleted, or in another repo)
    // is `npm run links`' to report, not this report's.
    const t = pinned === undefined ? undefined : byNumber.get(pinned);
    if (t && !mentions(t.body, page.url)) {
      const elsewhere = numbers.filter((n) => n !== pinned);
      out.push({ kind: "wrong-pin", severity: "problem", page: page.href, threads: [pinned!, ...elsewhere],
        message: `bh:discuss points at #${pinned}, which does not mention this post's URL (${page.url}). ${elsewhere.length ? `${list(elsewhere)} does: pin that one instead, or ` : "Pin the right thread, or "}add the URL to #${pinned} if it is the right one.` });
    }
  }
  return out;
}

// ---- Output ----------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TITLES: Record<FindingKind, string> = {
  unpinned: "Thread exists, post not pinned",
  duplicates: "More than one thread",
  "wrong-pin": "Pinned to a thread that does not mention the post",
  "unlisted-mention": "A discussion quotes an unlisted page",
};
const ORDER: FindingKind[] = ["unpinned", "duplicates", "wrong-pin", "unlisted-mention"];

const summary = (r: Report) => {
  const problems = r.findings.filter((f) => f.severity === "problem").length, notes = r.findings.length - problems;
  return `Checked ${plural(r.posts, "post")} against ${plural(r.threads, "discussion")}: ${plural(problems, "problem")}${notes ? `, ${plural(notes, "note")}` : ""}.`;
};

export function formatConsole(r: Report): string {
  const lines = [summary(r)];
  for (const kind of ORDER) {
    const rows = r.findings.filter((f) => f.kind === kind);
    if (!rows.length) continue;
    lines.push("", `${TITLES[kind]} (${rows.length})`);
    for (const f of rows) lines.push(`  ${f.page || "an unlisted page"}`, `    ${f.message}`);
  }
  return lines.join("\n");
}

export function formatMarkdown(r: Report): string {
  const lines = [`The discussion report (\`npm run discussions\`, run by \`.github/workflows/discussions.yml\`) ran on ${r.date}. ${summary(r)}`];
  for (const kind of ORDER) {
    const rows = r.findings.filter((f) => f.kind === kind);
    if (!rows.length) continue;
    lines.push("", `### ${TITLES[kind]}`, "");
    for (const f of rows) lines.push(`- ${f.page ? `\`${f.page}\`` : "An unlisted page"}: ${f.message}`);
  }
  lines.push("", "See `contracts/discuss.md` for what to do with each finding.");
  return lines.join("\n");
}

// ---- GitHub ----------------------------------------------------------------------------

const QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: ${PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { number title body url }
    }
  }
}`;

const runGh: Gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 60_000 });

interface Answer {
  data?: { repository?: { discussions?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: Array<Partial<Thread> | null> } | null } | null };
  errors?: Array<{ message?: string }>;
}

/** Every discussion of `owner/name`, newest first. Throws when `gh` fails or the answer is not what GraphQL documents. */
export function fetchDiscussions(owner: string, name: string, gh: Gh = runGh): Thread[] {
  const threads: Thread[] = [];
  let after = "";
  for (let i = 0; i < MAX_PAGES; i++) {
    const args = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, ...(after ? ["-f", `after=${after}`] : [])];
    const answer = JSON.parse(gh(args)) as Answer;
    if (answer.errors?.length) throw new Error(`GitHub answered with an error: ${answer.errors.map((e) => e.message).join("; ")}`);
    const d = answer.data?.repository?.discussions;
    if (!d || !Array.isArray(d.nodes)) throw new Error(`GitHub's answer has no discussions for ${owner}/${name}. Are Discussions switched on for the repository?`);
    for (const n of d.nodes) {
      if (n && typeof n.number === "number") threads.push({ number: n.number, title: n.title ?? "", body: n.body ?? "", url: n.url ?? "" });
    }
    if (!d.pageInfo?.hasNextPage) return threads;
    after = d.pageInfo.endCursor ?? "";
    if (!after) throw new Error("GitHub says there are more discussions but gave no cursor: stopped, because the list is incomplete");
  }
  throw new Error(`more than ${MAX_PAGES * PAGE_SIZE} discussions: stopped, because the list may be incomplete`);
}

// ---- main ------------------------------------------------------------------------------

const USAGE = `npm run discussions [-- --markdown <file>]

Lists the repository's GitHub Discussions and reports, per post: a thread that exists but is not pinned with
bh:discuss, two or more threads for one post, and a pin whose thread does not mention the post's URL.
  --markdown <file>  also write the report as Markdown
Exit status: 0 nothing to fix, 1 a problem was found, 2 the report itself failed. An unlisted page is only ever
called "an unlisted page". See contracts/discuss.md.`;

/** The repo's discussions URL from package.json and the environment, as `bh.mts` reads it; "" when switched off. */
export function discussionsUrl(root: string = ROOT, env: Env = process.env): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { bh?: { repoUrl?: string; discussionsUrl?: string } };
  const repo = String(env.BH_REPO_URL || pkg.bh?.repoUrl || "").replace(/\/*$/, "");
  return String(env.BH_DISCUSSIONS_URL || (pkg.bh?.discussionsUrl ?? (repo ? `${repo}/discussions` : ""))).replace(/\/*$/, "");
}

export interface MainDeps { gh?: Gh; today?: string }

export function main(argv: string[] = process.argv.slice(2), env: Env = process.env, out: Output = console, root: string = ROOT, deps: MainDeps = {}): number {
  try { return run(argv, env, out, root, deps); } catch (e) {
    // Exit 1 means "fix a post": a crash of the report itself must not read as that.
    out.error(`discussions: the report failed: ${(e as Error)?.message ?? e}`);
    return 2;
  }
}

function run(argv: string[], env: Env, out: Output, root: string, deps: MainDeps): number {
  let markdownFile = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { out.log(USAGE); return 0; }
    if (a === "--markdown") { markdownFile = argv[++i] ?? ""; if (!markdownFile) { out.error("--markdown needs a file"); return 2; } }
    else { out.error(`unknown argument "${a}"\n${USAGE}`); return 2; }
  }
  const url = discussionsUrl(root, env);
  if (!url) { out.log("Discussions are switched off in package.json (bh.discussionsUrl is empty): nothing to report."); return 0; }
  const repo = DISCUSSIONS_RE.exec(url);
  if (!repo) { out.error(`discussions: bh.discussionsUrl must be https://github.com/OWNER/REPO/discussions (got "${url}")`); return 2; }
  const base = siteBase(root, env);
  if (!base) { out.error('discussions: the site\'s address is unknown: set "homepage" in package.json (or BH_SITE_URL)'); return 2; }

  const pages = readSitePages(root, base);
  const threads = fetchDiscussions(repo[1]!, repo[2]!, deps.gh ?? runGh);
  const report: Report = {
    findings: findFindings(pages, threads, url),
    posts: pages.filter((p) => p.post).length,
    threads: threads.length,
    date: deps.today ?? new Date().toISOString().slice(0, 10),
  };
  out.log(formatConsole(report));
  const markdown = formatMarkdown(report);
  try {
    if (markdownFile) fs.writeFileSync(markdownFile, `${markdown}\n`);
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Discussions\n\n${markdown}\n`);
  } catch (e) { out.error(`discussions: ${(e as Error).message}`); return 2; }
  return report.findings.some((f) => f.severity === "problem") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
