// The discussion report (scripts/discussions.mts). Every GitHub call goes to a stubbed `gh`, and the site is a
// throwaway directory: `npm test` never touches the network.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  mentions, matchThreads, findFindings, fetchDiscussions, formatConsole, formatMarkdown, readSitePages, discussionsUrl, main,
  type Gh, type Output, type Page, type Thread,
} from "../scripts/discussions.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://blog.example/";
const DISCUSSIONS = "https://github.com/acme/blog/discussions";

// ---- A throwaway site -----------------------------------------------------------------

interface PageSpec { slug: string; title: string; metas?: Record<string, string> }

function site(t: TestContext, pages: PageSpec[], pkg: Record<string, unknown> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-discussions-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ homepage: SITE, bh: { repoUrl: "https://github.com/acme/blog" }, ...pkg }));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>Home</title>");
  for (const p of pages) {
    const metas = Object.entries(p.metas ?? {}).map(([k, v]) => `<meta name="${k}" content="${v}">`).join("\n");
    fs.writeFileSync(path.join(root, "docs", `${p.slug}.html`), `<!doctype html><html><head><title>${p.title}</title>\n${metas}\n</head><body></body></html>`);
  }
  return root;
}

const url = (slug: string) => `${SITE}docs/${slug}.html`;
const thread = (number: number, title: string, body: string): Thread => ({ number, title, body, url: `${DISCUSSIONS}/${number}` });
const page = (slug: string, title: string, extra: Partial<Page> = {}): Page => ({ href: `docs/${slug}.html`, url: url(slug), title, pin: "", post: true, unlisted: false, ...extra });

/** A `gh` that answers GraphQL with these threads, `size` to a page. */
function ghWith(threads: Thread[], size = 100): { gh: Gh; calls: string[][] } {
  const calls: string[][] = [];
  const gh: Gh = (args) => {
    calls.push(args);
    const after = args.find((a) => a.startsWith("after="))?.slice(6);
    const start = after ? Number(after) : 0, end = start + size;
    return JSON.stringify({ data: { repository: { discussions: { pageInfo: { hasNextPage: end < threads.length, endCursor: String(end) }, nodes: threads.slice(start, end) } } } });
  };
  return { gh, calls };
}

function capture(): { out: Output; logs: string[]; errors: string[] } {
  const logs: string[] = [], errors: string[] = [];
  return { out: { log: (...a) => logs.push(a.join(" ")), error: (...a) => errors.push(a.join(" ")) }, logs, errors };
}

// ---- Matching -------------------------------------------------------------------------

test("mentions finds the whole URL, with a fragment or punctuation after it, and not a longer path", () => {
  const u = url("a");
  assert.ok(mentions(`About ${u}\r\n\r\n`, u));
  assert.ok(mentions(`see ${u}#section and ${u}.`, u));
  assert.ok(mentions(`(${u})`, u));
  assert.ok(!mentions(`${u}5`, u), "a.html5 is another page");
  assert.ok(!mentions(`${u}-old`, u));
  assert.ok(!mentions(`https://other.example/x/${u}`, u), "the tail of another URL");
  assert.ok(!mentions("nothing here", u));
  assert.ok(mentions(`About ${u.replace("blog.example", "Blog.Example")}`, u), "host case is no evidence");
  assert.ok(mentions(`see:${u}`, u));
});

test("a thread matches by URL; only a thread with no URL match falls back to its exact title", () => {
  const pages = [page("a", "Alpha"), page("b", "Beta")];
  const m = matchThreads(pages, [
    thread(1, "Whatever", `About ${url("a")}`),
    thread(2, "  beta ", "no link here"),
    thread(3, "Alpha", `About ${url("b")}`), // its URL wins over its title
    thread(4, "Beta, revisited", "no link"),
  ]);
  assert.deepEqual(m.get("docs/a.html")?.map((x) => [x.thread.number, x.weak]), [[1, false]]);
  assert.deepEqual(m.get("docs/b.html")?.map((x) => [x.thread.number, x.weak]), [[2, true], [3, false]]);
});

test("posts that share a title are not told apart by it", () => {
  const m = matchThreads([page("part-1", "Part 1"), page("part-1-again", "Part 1"), page("b", "Beta")], [thread(1, "Part 1", "no link"), thread(2, "Beta", "no link")]);
  assert.equal(m.get("docs/part-1.html"), undefined);
  assert.equal(m.get("docs/part-1-again.html"), undefined);
  assert.deepEqual(m.get("docs/b.html")?.map((x) => x.thread.number), [2]);
});

// ---- Findings -------------------------------------------------------------------------

test("a thread that nothing pins is reported with the pin to add", () => {
  const f = findFindings([page("a", "Alpha")], [thread(7, "Alpha", `About ${url("a")}`)], DISCUSSIONS);
  assert.equal(f.length, 1);
  assert.deepEqual([f[0]!.kind, f[0]!.severity, f[0]!.page, f[0]!.threads, f[0]!.weak], ["unpinned", "problem", "docs/a.html", [7], false]);
  assert.match(f[0]!.message, /bh:discuss" content="https:\/\/github\.com\/acme\/blog\/discussions\/7"/);
});

test("a thread found by title alone is reported as such", () => {
  const f = findFindings([page("a", "Alpha")], [thread(7, "Alpha", "no link")], DISCUSSIONS);
  assert.deepEqual([f[0]!.kind, f[0]!.weak], ["unpinned", true]);
  assert.match(f[0]!.message, /does not quote its URL/);
});

test("two threads for one post are possible duplicates, not two pins to add", () => {
  const f = findFindings([page("a", "Alpha")], [thread(7, "x", `About ${url("a")}`), thread(9, "y", `${url("a")} again`)], DISCUSSIONS);
  assert.deepEqual(f.map((x) => [x.kind, x.threads]), [["duplicates", [7, 9]]]);
  assert.match(f[0]!.message, /then pin the one that is left/);
});

test("duplicates are reported for a pinned post too, and then say nothing about pinning", () => {
  const pinned = page("a", "Alpha", { pin: `${DISCUSSIONS}/7` });
  const f = findFindings([pinned], [thread(7, "x", `About ${url("a")}`), thread(9, "y", url("a"))], DISCUSSIONS);
  assert.deepEqual(f.map((x) => x.kind), ["duplicates"]);
  assert.doesNotMatch(f[0]!.message, /pin the one/);
});

test("a thread that only shares the title does not make a correctly pinned post look duplicated", () => {
  const pinned = page("a", "Alpha", { pin: `${DISCUSSIONS}/7` });
  assert.deepEqual(findFindings([pinned], [thread(7, "x", `About ${url("a")}`), thread(12, "Alpha", "an unrelated Q&A")], DISCUSSIONS), []);
});

test("a pin to a title-only thread, with the URL in another, is one finding with one remedy", () => {
  const pinned = page("a", "Alpha", { pin: `${DISCUSSIONS}/5` });
  const f = findFindings([pinned], [thread(5, "Alpha", "no link"), thread(6, "x", `About ${url("a")}`)], DISCUSSIONS);
  assert.deepEqual(f.map((x) => [x.kind, x.threads]), [["wrong-pin", [5, 6]]]);
});

test("a pin to a thread that does not mention the post is reported, naming the thread that does", () => {
  const pinned = page("a", "Alpha", { pin: `${DISCUSSIONS}/5` });
  const f = findFindings([pinned, page("b", "Beta")], [thread(5, "About something else", `About ${url("b")}`), thread(6, "Alpha", `About ${url("a")}`)], DISCUSSIONS);
  const wrong = f.find((x) => x.kind === "wrong-pin" && x.page === "docs/a.html");
  assert.ok(wrong, "the wrong pin is found");
  assert.deepEqual(wrong.threads, [5, 6]);
  assert.match(wrong.message, /#5.*does not mention/);
  assert.match(wrong.message, /#6 does: pin that one/);
  // The thread #5 is the one thread for post b, and b has no pin: that is its own finding.
  assert.ok(f.some((x) => x.kind === "unpinned" && x.page === "docs/b.html"));
});

test("a pin whose thread is not in the list is not reported (npm run links reports a deleted thread)", () => {
  assert.deepEqual(findFindings([page("a", "Alpha", { pin: `${DISCUSSIONS}/99` })], [], DISCUSSIONS), []);
});

test("a correct pin, a post with no thread and a post that opted out are all clean", () => {
  const pages = [page("a", "Alpha", { pin: `${DISCUSSIONS}/1` }), page("b", "Beta"), page("c", "Gamma", { pin: "off", post: false })];
  assert.deepEqual(findFindings(pages, [thread(1, "Alpha", `About ${url("a")}`), thread(2, "Gamma", `About ${url("c")}`)], DISCUSSIONS), []);
});

test("a thread that quotes an unlisted page's URL is a note that never names the page", () => {
  const secret = page("quiet-launch", "The quiet launch plan", { post: false, unlisted: true });
  const threads = [thread(3, "The quiet launch plan", `About ${url("quiet-launch")}`)];
  const f = findFindings([secret, page("a", "Alpha")], threads, DISCUSSIONS);
  assert.equal(f.length, 1);
  assert.deepEqual([f[0]!.kind, f[0]!.severity, f[0]!.page, f[0]!.threads], ["unlisted-mention", "note", "", [3]]);
  const r = { findings: f, posts: 1, threads: 1, date: "2026-11-15" };
  for (const text of [JSON.stringify(f), formatConsole(r), formatMarkdown(r)]) {
    assert.doesNotMatch(text, /quiet-launch|quiet launch/i, "neither the slug nor the title");
    assert.match(text, /unlisted page/);
  }
});

test("an unlisted page is never matched by title, and a pin on it is not checked", () => {
  const secret = page("quiet-launch", "The quiet launch plan", { post: false, unlisted: true, pin: `${DISCUSSIONS}/3` });
  assert.deepEqual(findFindings([secret], [thread(3, "The quiet launch plan", "no link"), thread(4, "Quiet", "")], DISCUSSIONS), []);
});

// ---- Reading the site -----------------------------------------------------------------

test("readSitePages: which pages are posts", (t) => {
  const root = site(t, [
    { slug: "post", title: "A &amp; B post", metas: { "bh:kind": "explainer", "bh:discuss": `${DISCUSSIONS}/4` } },
    { slug: "ref", title: "Ref", metas: { "bh:kind": "reference" } },
    { slug: "hidden", title: "Hidden", metas: { "bh:unlisted": "true" } },
    { slug: "demo", title: "Demo", metas: { "bh:example": "true" } },
    { slug: "quiet", title: "Quiet", metas: { "bh:discuss": "off" } },
  ]);
  fs.writeFileSync(path.join(root, "docs", "secret.private.html"), "<title>Private</title>");
  fs.writeFileSync(path.join(root, "docs", "sealed.html"), '<title>Sealed</title><meta name="bh:sealed" content="true">');
  const pages = readSitePages(root, SITE);
  assert.deepEqual(pages.map((p) => [p.href, p.post, p.unlisted]), [
    ["docs/hidden.html", false, true], ["docs/post.html", true, false], ["docs/quiet.html", false, false], ["docs/ref.html", false, false],
  ], "examples, private sources and sealed shells are not read at all");
  const post = pages.find((p) => p.href === "docs/post.html")!;
  assert.deepEqual([post.title, post.pin, post.url], ["A & B post", `${DISCUSSIONS}/4`, `${SITE}docs/post.html`]);
});

test("discussionsUrl follows package.json and the environment as bh.mts does", (t) => {
  assert.equal(discussionsUrl(site(t, []), {}), DISCUSSIONS);
  assert.equal(discussionsUrl(site(t, [], { bh: { repoUrl: "https://github.com/acme/blog", discussionsUrl: "" } }), {}), "", "an empty setting switches it off");
  assert.equal(discussionsUrl(site(t, []), { BH_DISCUSSIONS_URL: "https://github.com/x/y/discussions/" }), "https://github.com/x/y/discussions");
  assert.equal(discussionsUrl(site(t, []), { BH_REPO_URL: "https://github.com/x/y" }), "https://github.com/x/y/discussions");
});

// ---- GitHub ---------------------------------------------------------------------------

test("fetchDiscussions pages through every discussion and sends the repo and cursor as variables", () => {
  const all = Array.from({ length: 5 }, (_, i) => thread(i + 1, `T${i}`, `b${i}`));
  const { gh, calls } = ghWith(all, 2);
  assert.deepEqual(fetchDiscussions("acme", "blog", gh).map((x) => x.number), [1, 2, 3, 4, 5]);
  assert.equal(calls.length, 3);
  assert.ok(calls[0]!.includes("owner=acme") && calls[0]!.includes("name=blog"));
  assert.ok(!calls[0]!.some((a) => a.startsWith("after=")));
  assert.ok(calls[1]!.includes("after=2") && calls[2]!.includes("after=4"));
});

test("fetchDiscussions throws on a GraphQL error, on an answer with no discussions, and when gh fails", () => {
  assert.throws(() => fetchDiscussions("a", "b", () => JSON.stringify({ errors: [{ message: "Resource not accessible" }] })), /Resource not accessible/);
  assert.throws(() => fetchDiscussions("a", "b", () => JSON.stringify({ data: { repository: { discussions: null } } })), /switched on/);
  assert.throws(() => fetchDiscussions("a", "b", () => { throw new Error("gh: not logged in"); }), /not logged in/);
  assert.throws(() => fetchDiscussions("a", "b", () => "not json"));
});

test("fetchDiscussions sends the repo and cursor as strings, so a numeric-looking name is not coerced", () => {
  const { gh, calls } = ghWith(Array.from({ length: 3 }, (_, i) => thread(i + 1, "t", "b")), 2);
  fetchDiscussions("2024", "null", gh);
  for (const call of calls) assert.ok(!call.includes("-F"), "gh -F coerces numbers, true, null and @file");
  assert.ok(calls[0]!.includes("owner=2024") && calls[0]!.includes("name=null"));
});

test("fetchDiscussions throws when GitHub promises another page and gives no cursor", () => {
  const broken: Gh = () => JSON.stringify({ data: { repository: { discussions: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [] } } } });
  assert.throws(() => fetchDiscussions("a", "b", broken), /no cursor/);
});

test("fetchDiscussions refuses a list it cannot finish rather than reporting on part of it", () => {
  const forever: Gh = () => JSON.stringify({ data: { repository: { discussions: { pageInfo: { hasNextPage: true, endCursor: "x" }, nodes: [] } } } });
  assert.throws(() => fetchDiscussions("a", "b", forever), /may be incomplete/);
});

// ---- main -----------------------------------------------------------------------------

const POSTS: PageSpec[] = [
  { slug: "alpha", title: "Alpha", metas: { "bh:discuss": `${DISCUSSIONS}/1` } },
  { slug: "beta", title: "Beta" },
  { slug: "gamma", title: "Gamma" },
  { slug: "hidden", title: "Hidden plan", metas: { "bh:unlisted": "true" } },
];

test("main: exit 0 when the pinned thread is right and the other posts have none", (t) => {
  const c = capture();
  const code = main([], {}, c.out, site(t, POSTS), { gh: ghWith([thread(1, "Alpha", `About ${url("alpha")}`)]).gh });
  assert.equal(code, 0);
  assert.match(c.logs.join("\n"), /Checked 3 posts against 1 discussion: 0 problems\./);
});

test("main: exit 1 with the findings, written to --markdown and the job summary", (t) => {
  const root = site(t, POSTS), c = capture();
  const md = path.join(root, "report.md"), summary = path.join(root, "summary.md");
  const threads = [thread(1, "Alpha", `About ${url("alpha")}`), thread(2, "x", `About ${url("beta")}`), thread(3, "Hidden plan", `About ${url("hidden")}`)];
  const code = main(["--markdown", md], { GITHUB_STEP_SUMMARY: summary }, c.out, root, { gh: ghWith(threads).gh, today: "2026-11-15" });
  assert.equal(code, 1);
  const text = c.logs.join("\n");
  assert.match(text, /1 problem, 1 note/);
  assert.match(text, /docs\/beta\.html/);
  assert.doesNotMatch(text, /hidden/i, "the unlisted page is not named");
  for (const file of [md, summary]) {
    const body = fs.readFileSync(file, "utf8");
    assert.match(body, /ran on 2026-11-15/);
    assert.match(body, /`docs\/beta\.html`/);
    assert.doesNotMatch(body, /hidden/i);
  }
});

test("main: a note alone does not fail the run", (t) => {
  const c = capture();
  const code = main([], {}, c.out, site(t, POSTS), { gh: ghWith([thread(1, "Alpha", `About ${url("alpha")}`), thread(3, "x", `About ${url("hidden")}`)]).gh });
  assert.equal(code, 0);
  assert.match(c.logs.join("\n"), /0 problems, 1 note/);
});

test("main: exit 0 and no request when discussions are switched off", (t) => {
  const c = capture();
  const root = site(t, POSTS, { bh: { repoUrl: "https://github.com/acme/blog", discussionsUrl: "" } });
  assert.equal(main([], {}, c.out, root, { gh: () => assert.fail("it must not call gh") }), 0);
  assert.match(c.logs.join("\n"), /switched off/);
});

test("main: exit 2 when the report itself fails, never 1", (t) => {
  const bad = (root: string, argv: string[] = [], env: Record<string, string> = {}, gh: Gh = ghWith([]).gh) => {
    const c = capture();
    return { code: main(argv, env, c.out, root, { gh }), errors: c.errors.join("\n") };
  };
  const root = site(t, POSTS);
  assert.equal(bad(root, [], {}, () => { throw new Error("gh: not logged in"); }).code, 2);
  assert.match(bad(root, [], {}, () => { throw new Error("gh: not logged in"); }).errors, /not logged in/);
  assert.equal(bad(root, ["--nope"]).code, 2);
  assert.equal(bad(root, ["--markdown"]).code, 2);
  assert.equal(bad(root, [], { BH_DISCUSSIONS_URL: "https://example.com/discussions" }).code, 2);
  assert.equal(bad(site(t, POSTS, { homepage: "" })).code, 2);
  assert.equal(bad(root, [], { GITHUB_STEP_SUMMARY: path.join(root, "no", "such", "dir", "s.md") }).code, 2);
});

test("main --help prints the usage", () => {
  const c = capture();
  assert.equal(main(["--help"], {}, c.out, ROOT), 0);
  assert.match(c.logs.join("\n"), /npm run discussions/);
});

test("every real page is a post here exactly when `npm run index` gives it a Discuss block", () => {
  // The post rule is written twice (discussExclusion in bh.mts, readSitePages here): this fails when they drift apart.
  const pages = readSitePages(ROOT);
  assert.ok(pages.length > 5, "the real site has pages");
  for (const p of pages) {
    const hasBlock = /\sdata-discuss(?=[\s>=])/.test(fs.readFileSync(path.join(ROOT, p.href), "utf8"));
    assert.equal(p.post, hasBlock, `${p.href}: report says post=${p.post}, the page ${hasBlock ? "has" : "has no"} Discuss block`);
  }
});

// ---- The workflow ---------------------------------------------------------------------

test("discussions.yml runs weekly and by hand, never on a PR, with read-only permissions and a timeout", () => {
  const wf = parse(fs.readFileSync(path.join(ROOT, ".github/workflows/discussions.yml"), "utf8")) as {
    on: Record<string, unknown>; permissions: Record<string, string>;
    jobs: Record<string, { permissions?: unknown; "timeout-minutes"?: number; steps: Array<{ run?: string }> }>;
  };
  assert.deepEqual(Object.keys(wf.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(wf.permissions, { contents: "read", discussions: "read" });
  for (const job of Object.values(wf.jobs)) assert.equal(job.permissions, undefined, "no job widens the permissions");
  assert.ok(Object.values(wf.jobs).some((j) => j.steps.some((s) => /node scripts\/discussions\.mts\b/.test(s.run ?? ""))), "it runs the report");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["discussions"], "node scripts/discussions.mts");
});
