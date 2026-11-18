// Diffing two versions of a page (scripts/page-diff.mts), and reading old versions from git
// (scripts/page-history.mts), tested on small pages and a throwaway repository.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import {
  tokenize, topLevel, splitPage, diffSeq, diffPages, statsLine, inlineDiff, changeMarks, renderMark, renderDiffPage,
  diffData, diffScript, summaryMarkdown, COMMIT_RE, type Entry, type PageDiff, type DiffData,
} from "../scripts/page-diff.mts";
import { pageAt, resolveCommit, changedPages, reviewCommits, reviewDiffScript, writeReviewDiffs, diffFile } from "../scripts/page-history.mts";

const page = (article: string, title = "T", description = "D") => `<!doctype html><html><head><title>${title}</title>
<meta name="description" content="${description}"><script>var head = "<p>not a block</p>";</script></head>
<body data-home="../index.html"><main class="bh-page"><article class="bh-article">
${article}
</article></main><script>document.title;</script></body></html>`;

const diff = (a: string, b: string): PageDiff => {
  const d = diffPages(page(a), page(b));
  assert.ok(d, "both pages have an article");
  return d;
};
const changes = (d: PageDiff): Entry[] => d.entries.filter((e) => e.status !== "same");
const blockToks = (html: string) => topLevel(tokenize(html))[0];
/** Every tag balanced, in order: what "well-formed" means for the markup these functions write. */
function assertBalanced(html: string): void {
  const stack: string[] = [];
  for (const t of tokenize(html)) {
    if (t.kind === "open") stack.push(t.name);
    else if (t.kind === "close") assert.equal(stack.pop(), t.name, `unbalanced </${t.name}> in:\n${html}`);
  }
  assert.deepEqual(stack, [], `unclosed tags in:\n${html}`);
}

test("a page is split into the direct children of its article; comments, the head and the page script are not blocks", () => {
  const split = splitPage(page(`<header class="bh-hero"><h1>Title</h1></header>
    <!-- a note to authors, with <p>markup</p> in it -->
    <h2 id="why">Why</h2>
    <p>One <em>two</em>.</p>
    <figure class="diagram" id="fig"><svg viewBox="0 0 1 1"><g class="node" data-id="a"><rect x="0" y="0"/><text>A</text></g></svg><figcaption>Notice.</figcaption></figure>
    <hr>
    <ul><li>a<li>b</ul>`));
  assert.ok(split);
  assert.deepEqual(split.blocks.map((b) => b.tag), ["header", "h2", "p", "figure", "hr", "ul"]);
  assert.deepEqual(split.blocks.map((b) => b.id), ["", "why", "", "fig", "", ""]);
  assert.equal(split.blocks[2].text, "One two.");
  assert.equal(split.blocks[3].text, "Notice.", "a picture's text is not prose");
  assert.match(split.before, /<article class="bh-article">$/);
  assert.match(split.after, /^<\/article>/);
  assert.equal(splitPage("<html><body><script id=\"sealed-payload\">x</script></body></html>"), null, "a page with no article has nothing to compare");
});

test("a paragraph left open ends where the next block starts", () => {
  const split = splitPage(page(`<p>First, never closed.
    <h2 id="next">Next</h2>
    <p>Second.`));
  assert.deepEqual(split!.blocks.map((b) => [b.tag, b.text]), [["p", "First, never closed."], ["h2", "Next"], ["p", "Second."]]);
});

test("diffSeq's script turns the first sequence into the second, and gives up cleanly past its limit", () => {
  const apply = (a: string[], b: string[], maxD?: number) => {
    const out: string[] = [];
    let ai = 0;
    for (const o of diffSeq(a, b, maxD)) {
      if (o.op === "eq") { assert.equal(a[o.a], b[o.b]); assert.equal(o.a, ai++); out.push(b[o.b]); }
      else if (o.op === "del") assert.equal(o.a, ai++);
      else out.push(b[o.b]);
    }
    assert.equal(ai, a.length, "every old item is kept or deleted exactly once");
    assert.deepEqual(out, b);
  };
  const w = (s: string) => s.split(" ").filter(Boolean);
  apply(w("a b c d e"), w("a x c e f"));
  apply([], w("a b"));
  apply(w("a b"), []);
  apply(w("the quick brown fox"), w("the quick brown fox"));
  apply(w("a b c d e f g h"), w("h g f e d c b a"));
  apply(w("k a b c d e f g z"), w("k h i j l m n o z"), 2); // past the limit: the middle is replaced whole
  assert.deepEqual(diffSeq(["a", "b", "c"], ["a", "x", "c"]).map((o) => o.op), ["eq", "del", "ins", "eq"]);
});

test("blocks are classified: same, changed (by id or by likeness), added, removed", () => {
  const d = diff(
    `<h2 id="one">One</h2><p>The limiter refills its bucket lazily on every request.</p><p>This paragraph goes away entirely.</p><figure id="f"><img src="a.png" alt="A"></figure>`,
    `<h2 id="one">One, renamed</h2><p>The limiter refills its bucket lazily on each request.</p><figure id="f"><img src="a.png" alt="A"></figure><p>A brand new closing thought.</p>`);
  assert.deepEqual(changes(d).map((e) => [e.n, e.status, e.label.slice(0, 20)]), [
    [1, "changed", "One, renamed"],
    [2, "changed", "The limiter refills "],
    [3, "removed", "This paragraph goes "],
    [4, "added", "A brand new closing "],
  ]);
  assert.deepEqual(d.stats, { changed: 2, added: 1, removed: 1, moved: 0 });
  assert.equal(statsLine(d.stats), "2 changed, 1 added, 1 removed");
  assert.equal(statsLine({ changed: 0, added: 0, removed: 0, moved: 0 }), "no changes");
  assert.equal(d.entries.filter((e) => e.status === "same").length, 1);
  assert.deepEqual(changes(d).map((e) => e.section), ["one", "one", "one", "one"]);
  assert.equal(changes(d)[2].at, 2, "a removed block is placed before the new block it sat before");
});

test("a reflowed or re-indented source is not a change", () => {
  const d = diff(`<p>One two\n   three.</p>\n<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>`, `<p>One\n two three.</p><ul><li>a</li><li>b</li></ul>`);
  assert.deepEqual(changes(d), []);
});

test("a block that reappears elsewhere is a move: by id, by its whole text, or reworded", () => {
  const long = "This sentence is long enough to be recognised when it turns up somewhere else on the page.";
  const d = diff(
    `<h2 id="a">A</h2><figure id="fig"><img src="x.png" alt="X"><figcaption>Old caption.</figcaption></figure><p>${long}</p><p>Short.</p><h2 id="b">B</h2><p>Tail.</p>`,
    `<h2 id="a">A</h2><h2 id="b">B</h2><p>Tail.</p><p>${long.replace("somewhere else", "elsewhere")}</p><figure id="fig"><img src="x.png" alt="X"><figcaption>New caption.</figcaption></figure>`);
  const moved = changes(d).filter((e) => e.status === "moved");
  assert.deepEqual(moved.map((e) => [e.new!.tag, e.text, e.movedFrom, e.section]), [["p", true, "A", "b"], ["figure", true, "A", "b"]]);
  const from = changes(d).filter((e) => e.movedTo);
  assert.deepEqual(from.map((e) => e.movedTo).sort(), moved.map((e) => e.n).sort());
  assert.deepEqual(d.stats, { changed: 0, added: 0, removed: 1, moved: 2 }, "the old place of a moved block is not counted as a removal");
  assert.match(renderMark(from[0], { open: true, copy: true }), /data-moved.*see where it is now/);
});

test("what differs is named: the prose, a picture, or only the markup", () => {
  const svg = (w: number) => `<svg viewBox="0 0 10 10"><g class="node c1" data-id="a"><rect x="0" y="0" width="${w}" height="4"/><text>A</text></g></svg>`;
  const d = diff(
    `<p id="t">Old words.</p><figure id="v">${svg(4)}<figcaption>Same.</figcaption></figure><p id="m" class="lead">Same.</p>`,
    `<p id="t">New words.</p><figure id="v">${svg(6)}<figcaption>Same.</figcaption></figure><p id="m">Same.</p>`);
  assert.deepEqual(changes(d).map((e) => [e.new!.id, e.text, e.visual, e.markup]), [["t", true, false, false], ["v", false, true, false], ["m", false, false, true]]);
});

test("the title and description are compared too", () => {
  const d = diffPages(page("<p>Same.</p>", "Old title", "Same"), page("<p>Same.</p>", "New title", "Same"));
  assert.deepEqual(d!.title, { old: "Old title", new: "New title" });
  assert.equal(d!.description, null);
});

test("the word diff is written into the new markup, and always nests properly", () => {
  const old = blockToks(`<p>The <strong>quick</strong> brown fox jumps over the lazy dog, as it <a href="x.html">always</a> has.</p>`);
  const now = blockToks(`<p>The <strong>quick</strong> red fox leaps over the lazy dog, as it <a href="x.html">usually</a> has, <em>every day</em>.</p>`);
  const { html, count } = inlineDiff(old, now);
  assertBalanced(html);
  assert.ok(count >= 3);
  assert.match(html, /<del>brown<\/del><ins>red<\/ins>/);
  assert.match(html, /<a href="x\.html"><del>always[^<]*<\/del><ins>usually<\/ins><\/a>/, "a change inside a link stays inside it");
  assert.match(html, /<em><ins>every day<\/ins><\/em>/);
  const strip = (s: string, drop: string) => s.replace(new RegExp(`<${drop}>[\\s\\S]*?</${drop}>`, "g"), "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  assert.equal(strip(html, "del"), "The quick red fox leaps over the lazy dog, as it usually has, every day.", "without the deletions it reads as the new text");
  assert.equal(strip(html, "ins"), "The quick brown fox jumps over the lazy dog, as it always has.", "without the insertions it reads as the old text");
});

test("a rewritten sentence becomes a few whole phrases, not a word-by-word alternation", () => {
  const old = blockToks(`<p>This page takes that description from 1,264 bits down to 159, and shows why a block sends nothing but code lengths.</p>`);
  const now = blockToks(`<p>This page tries a table, a tree and a list of code lengths, and shows why DEFLATE sends only the lengths.</p>`);
  const { html, count } = inlineDiff(old, now);
  assert.ok(count <= 6, `expected a few large marks, got ${count}:\n${html}`);
  assert.match(html, /^<p>This page <del>takes that description from 1,264 bits down to 159<\/del><ins>tries a table, a tree and a list of code lengths<\/ins>, and shows why /);
});

test("an entity is one word, so a mark never cuts it in half", () => {
  const { html } = inlineDiff(blockToks(`<p>a &lt; b &amp; c</p>`), blockToks(`<p>a &gt; b &amp; c</p>`));
  assert.match(html, /<del>&lt;<\/del><ins>&gt;<\/ins>/);
  assert.match(html, /&amp; c/);
});

test("lists and tables get their marks inside items and cells, never between them", () => {
  const { html } = inlineDiff(
    blockToks(`<table>\n<thead><tr><th>Step</th><th>Bits</th></tr></thead>\n<tbody>\n<tr><td>One</td><td>12</td></tr>\n<tr><td>Gone</td><td>99</td></tr>\n</tbody>\n</table>`),
    blockToks(`<table>\n<thead><tr><th>Step</th><th>Bits</th></tr></thead>\n<tbody>\n<tr><td>One</td><td>14</td></tr>\n<tr><td>New</td><td>7</td></tr>\n</tbody>\n</table>`));
  assertBalanced(html);
  for (const m of html.matchAll(/<(ins|del)>/g)) {
    const before = html.slice(0, m.index).match(/<(\/?)(\w+)[^>]*>(?=[^<]*$)/);
    assert.ok(before && before[1] === "" && /^(td|th|ins|del)$/.test(before[2]) || /<(td|th)>[^<]*(?:<(?:ins|del)>[^<]*<\/(?:ins|del)>[^<]*)*$/.test(html.slice(0, m.index)), `a mark outside a cell:\n${html}`);
  }
  assert.match(html, /<td><del>12 Gone 99<\/del><ins>14<\/ins><\/td>/, "words deleted from different cells are kept apart");
});

test("a block that lost all its prose still says what was deleted", () => {
  const { html } = inlineDiff(blockToks(`<figure><img src="a.png" alt="A"><figcaption>Caption that went away.</figcaption></figure>`), blockToks(`<figure><img src="a.png" alt="A"></figure>`));
  assert.match(html, /<\/figure>\n<p class="bh-diff-tail"><del>Caption that went away\.<\/del><\/p>$/);
});

test("in place, a changed code block loses its language class, so the highlighter cannot erase the marks", () => {
  const { html } = inlineDiff(blockToks(`<pre><code class="language-js copy">let a = 1;\nlet b = 2;</code></pre>`), blockToks(`<pre><code class="language-js copy">let a = 1;\nlet b = 3;</code></pre>`));
  assert.match(html, /<pre><code class="copy">let a = 1;\nlet b = <del>2<\/del><ins>3<\/ins>;<\/code><\/pre>/);
});

test("the parts of a picture are marked by data-id: removed, added, changed; an author's own mark is kept", () => {
  const old = blockToks(`<figure><svg viewBox="0 0 9 9"><g class="node" data-id="keep"><rect x="0"/></g><g class="node" data-id="gone"><rect x="1"/></g><g class="node" data-id="grew"><rect width="2"/></g><path class="edge" data-id="own" data-change="removed" d="M0 0"/></svg></figure>`);
  const now = blockToks(`<figure><svg viewBox="0 0 9 9"><g class="node" data-id="keep"><rect x="0"/></g><g class="node" data-id="grew"><rect width="5"/></g><g class="node" data-id="fresh"><rect x="3"/></g></svg></figure>`);
  const marks = changeMarks(old, now);
  const byId = (toks: typeof old) => Object.fromEntries(toks.filter((t) => marks.has(t)).map((t) => [t.attrs.match(/data-id="(\w+)"/)![1], marks.get(t)]));
  assert.deepEqual(byId(old), { gone: "removed" });
  assert.deepEqual(byId(now), { grew: "changed", fresh: "added" });
});

test("a copy of the old version is inert: no ids, links, scripts or live components, and a picture's own ids are prefixed", () => {
  const d = diff(
    `<h3 id="gone">A removed heading</h3>
     <figure class="diagram wide" id="fig" data-linkable><svg viewBox="0 0 9 9" role="img" aria-label="Old"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><g class="node c1" data-id="a"><rect x="0" fill="url(#g)"/><text>A</text></g><use href="#g"/></svg><figcaption>Old <a href="other.html" target="_blank">link</a>.</figcaption></figure>
     <bh-stepper for="fig" id="walk"><bh-step highlight="a"><p onclick="steal()">Step one, old.</p></bh-step></bh-stepper>
     <details class="predict" id="q"><summary>Old question?</summary><p>Answer <input type="range" name="x" data-bind="x"> <script>alert(1)</script></p></details>`,
    `<figure class="diagram wide" id="fig" data-linkable><svg viewBox="0 0 9 9" role="img" aria-label="New"><g class="node c1" data-id="a"><rect x="4"/><text>A</text></g></svg><figcaption>New.</figcaption></figure>
     <bh-stepper for="fig" id="walk"><bh-step highlight="a"><p>Step one, new.</p></bh-step></bh-stepper>
     <details class="predict" id="q"><summary>New question?</summary><p>Answer.</p></details>`);
  const marks = changes(d).map((e) => renderMark(e, { open: false, copy: true }));
  const all = marks.join("\n");
  for (const m of marks) assertBalanced(m);
  assert.deepEqual([...all.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((id) => !/^bh-change-\d+$/.test(id) && !/^bh-d\d+-[ab]-/.test(id)), [], "the only ids are the marks' own and prefixed ones inside pictures");
  assert.match(all, /<linearGradient id="bh-d2-a-g">/);
  assert.match(all, /fill="url\(#bh-d2-a-g\)"/);
  assert.match(all, /<use href="#bh-d2-a-g"\/>/);
  assert.doesNotMatch(all, /<a\b|href="other\.html"|target=/, "links become plain spans");
  assert.match(all, /<span class="bh-diff-link">link<\/span>/);
  assert.doesNotMatch(all, /<script|alert\(1\)|onclick|data-bind|data-linkable|\sfor=|\sname=/);
  assert.match(all, /<p class="bh-diff-h bh-diff-h3">A removed heading<\/p>/, "a heading in a copy is not a section");
  assert.match(all, /<div data-was="bh-stepper">\s*<div data-was="bh-step" highlight="a">/, "a custom element is a plain block, so its script never runs on the copy");
  assert.match(all, /<input type="range" disabled>/);
  assert.match(all, /<details class="predict" open>/);
  // The changed diagram is a before/after pair with the changed part marked on the new side.
  assert.match(all, /<bh-versions class="bh-diff-versions">\s*<figure class="diagram" data-label="Before">[\s\S]*<figure class="diagram" data-label="After">[\s\S]*data-id="a" data-change="changed"/);
  assert.match(marks[0], /^<details class="bh-diff-mark" data-diff="removed" id="bh-change-1">/);
  assert.doesNotMatch(marks[0], /\sopen>/, "data marks start collapsed");
});

test("a <bh-sequence> stays a live component in a copy, since it only draws itself", () => {
  const d = diff(
    `<figure class="diagram" id="s"><bh-sequence aria-label="x"><bh-actor data-id="a">A</bh-actor><bh-msg data-id="m" from="a" to="a">old</bh-msg></bh-sequence></figure>`,
    `<figure class="diagram" id="s"><bh-sequence aria-label="x"><bh-actor data-id="a">A</bh-actor><bh-msg data-id="m" from="a" to="a">new</bh-msg></bh-sequence></figure>`);
  const [e] = changes(d);
  assert.deepEqual([e.visual, e.text], [true, false]);
  const mark = renderMark(e, { open: true, copy: true });
  assert.match(mark, /<bh-versions[\s\S]*<bh-sequence aria-label="x"><bh-actor data-id="a">A<\/bh-actor><bh-msg data-id="m" from="a" to="a" data-change="changed">new<\/bh-msg>/);
});

test("the diff page is the new page with marks: prose changed in place, components left alone, every id still unique", () => {
  const d = diff(
    `<header class="bh-hero"><h1>Title</h1></header><h2 id="a">A</h2><p>Old prose here.</p><p>Removed paragraph with enough words.</p>
     <bh-chart type="bar" id="c"><table><tr><th>k</th><th>v</th></tr><tr><td>x</td><td>10</td></tr></table></bh-chart>`,
    `<header class="bh-hero"><h1>Title</h1></header><h2 id="a">A</h2><p>New prose here.</p>
     <bh-chart type="bar" id="c"><table><tr><th>k</th><th>v</th></tr><tr><td>x</td><td>12</td></tr></table></bh-chart><p>Added.</p>`);
  const html = renderDiffPage(d, { base: "abc1234", head: "the working tree" });
  assert.match(html, /<title>Diff: T<\/title>\n\s*<meta name="robots" content="noindex">/);
  assert.match(html, /<body data-home="\.\.\/index\.html" data-present="off" data-review="off" data-bh-diff>/);
  assert.match(html, /<\/header>\s*<aside class="bh-diff-summary" id="bh-changes"/, "the summary follows the hero");
  assert.match(html, /<strong>Changes<\/strong> from <code>abc1234<\/code> to <code>the working tree<\/code>: 2 changed, 1 added, 1 removed\./);
  assert.match(html, /<p data-diff="changed"><del>Old<\/del><ins>New<\/ins> prose here\.<\/p>/, "prose is rewritten where it stands");
  assert.match(html, /<bh-chart type="bar" id="c" data-diff="changed"><table><tr><th>k<\/th><th>v<\/th><\/tr><tr><td>x<\/td><td>12<\/td><\/tr><\/table><\/bh-chart>/, "a component's content is untouched: its script reads it");
  assert.match(html, /<div class="bh-diff-copy"><div data-was="bh-chart"[^>]*><table>[\s\S]*<del>10<\/del><ins>12<\/ins>/, "its word diff is an inert copy beside it");
  assert.match(html, /<p data-diff="added">Added\.<\/p>/);
  assert.match(html, /<details class="bh-diff-mark" data-diff="removed" id="bh-change-\d" open>/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  assert.equal((html.match(/<script>document\.title;<\/script>/g) ?? []).length, 1, "the page's own script is kept, once");
  assert.equal(renderDiffPage(diff("<p>Same.</p>", "<p>Same.</p>"), { base: "a", head: "b" }).match(/no changes\./)?.length, 1);
});

test("the data file says where each live block is, what the old text was, and carries the collapsed mark", () => {
  const d = diff(
    `<h2 id="s">S</h2><p>Kept.</p><p>An old paragraph that will be removed.</p><p>R&amp;D costs &mdash; then &rarr; now, a long enough tail to probe.</p>`,
    `<h2 id="s">S</h2><p>Kept.</p><p>R&amp;D costs &mdash; then &rarr; later, a long enough tail to probe.</p>`);
  const base = "0123456789abcdef0123456789abcdef01234567";
  const data = diffData(d, base);
  assert.deepEqual(data.changes.map((c) => [c.status, c.at, c.tag, c.section, c.probe]), [["removed", 2, "", "s", ""], ["changed", 2, "p", "s", "R&D costs"]]);
  assert.equal(data.changes[0].oldText, "An old paragraph that will be removed.");
  assert.equal(data.blocks, 3);
  const window: { BH_DIFFS?: Record<string, DiffData> } = {};
  vm.runInNewContext(diffScript("docs/x.html", data), { window });
  assert.deepEqual(Object.keys(window.BH_DIFFS!), [`docs/x.html@${base}`]);
  assert.equal(window.BH_DIFFS![`docs/x.html@${base}`].changes[1].html, data.changes[1].html);
});

test("the markdown summary lists each changed page's sections, and says so when nothing changed", () => {
  const d = diff(`<h2 id="a">Alpha | one</h2><p>The old wording of this sentence.</p><h2 id="b">Beta</h2><p>Stays.</p>`, `<p>Intro.</p><h2 id="a">Alpha | one</h2><p>The new wording of this sentence.</p><h2 id="b">Beta</h2><p>Stays.</p><p>More.</p>`);
  const md = summaryMarkdown([{ page: "docs/x.html", state: "changed", diff: d }, { page: "docs/new.html", state: "new", diff: null }, { page: "docs/same.html", state: "changed", diff: diff("<p>a</p>", "<p>a</p>") }], { base: "abc1234", head: "the working tree" });
  assert.match(md, /^## Page changes\n/);
  assert.match(md, /- `docs\/x\.html`: 1 changed, 2 added\n {2}- Top of the page: 1 added\n {2}- Alpha \\\| one: 1 changed\n {2}- Beta: 1 added\n/);
  assert.match(md, /- `docs\/new\.html`: new page/);
  assert.doesNotMatch(md, /same\.html/);
  assert.match(summaryMarkdown([], { base: "a", head: "b" }), /No page's article differs/);
});

// ---- Old versions from git ---------------------------------------------------------------------

const SEALED = `<!doctype html><html><head><meta name="bh:sealed" content="1"><title>Private page</title></head><body><script id="sealed-payload" type="application/json">{}</script></body></html>`;

/** A repository with one page committed twice, and review files naming those commits. */
function repo(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-diff-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=T", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).toString().trim();
  const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  git("init", "-q");
  write("docs/post.html", page(`<h2 id="a">A</h2><p>The first version of the text.</p>`));
  write("docs/secret.html", SEALED);
  git("add", "."); git("commit", "-q", "-m", "one");
  const first = git("rev-parse", "HEAD");
  write("docs/post.html", page(`<h2 id="a">A</h2><p>The second version of the text.</p>`));
  write("docs/later.html", page(`<p>Born later.</p>`));
  git("add", "."); git("commit", "-q", "-m", "two");
  const second = git("rev-parse", "HEAD");
  return { root, git, write, first, second };
}
const review = (document: string, commits: unknown[]) => JSON.stringify({ format: "bh-review/1", document, build: { commit: null }, comments: commits.map((commit, i) => ({ id: `c-${i}`, kind: "comment", created: "2026-01-01T00:00:00Z", body: "b", commit })) });

test("a commit id is hex only, and nothing else reaches git", (t) => {
  const { root, first } = repo(t);
  for (const bad of ["--help", "-p", "HEAD", "abc123", "0123456789abcdefg", "abcdef1 --all", "ABCDEF1234567"]) assert.ok(!COMMIT_RE.test(bad), bad);
  assert.ok(COMMIT_RE.test(first) && COMMIT_RE.test(first.slice(0, 7)));
  assert.match(pageAt(root, first, "docs/post.html")!, /first version/);
  assert.equal(pageAt(root, "--output=/tmp/x", "docs/post.html"), null);
  assert.equal(pageAt(root, first, "../etc/passwd"), null);
  assert.equal(pageAt(root, first, "docs/post.private.html"), null, "a private source is never a page");
  assert.equal(pageAt(root, first, "docs/later.html"), null, "the page did not exist yet");
  assert.equal(pageAt(root, "0000000000000000000000000000000000000000", "docs/post.html"), null);
  assert.equal(resolveCommit(root, "HEAD~1"), first);
  assert.equal(resolveCommit(root, "no-such-branch"), null);
  assert.equal(resolveCommit(root, "--all"), null);
});

test("changedPages names the pages that differ from a base, new and deleted ones too", (t) => {
  const { root, write, first } = repo(t);
  write("docs/untracked.html", page("<p>Not in git yet.</p>"));
  fs.rmSync(path.join(root, "docs/secret.html"));
  assert.deepEqual(changedPages(root, first), [{ page: "docs/later.html", state: "new" }, { page: "docs/post.html", state: "changed" }, { page: "docs/secret.html", state: "deleted" }]);
  assert.equal(changedPages(root, "--bad"), null);
});

test("review files name the commits to diff against; private pages and malformed commits are left out", (t) => {
  const { root, write, first, second } = repo(t);
  write("reviews/inbox/a.json", review("docs/post.html", [first, second, first, null, "--upload-pack=x", 42, "zzzzzzz"]));
  write("reviews/inbox/b.json", review("./docs/post.html", [first.slice(0, 7)]));
  write("reviews/inbox/c.json", review("docs/secret.html", [first]));
  write("reviews/inbox/d.json", review("docs/x.private.html", [first]));
  write("reviews/inbox/e.json", review("../outside.html", [first]));
  write("reviews/inbox/broken.json", "{not json");
  assert.deepEqual([...reviewCommits(root)].map(([p, set]) => [p, [...set].sort()]), [["docs/post.html", [first, first.slice(0, 7), second].sort()]]);
});

test("the published diff data: one file per reviewed page and commit, none for a sealed page, an unknown commit or a page the site does not carry", (t) => {
  const { root, write, first, second } = repo(t);
  const unknown = "1111111111111111111111111111111111111111";
  write("reviews/inbox/a.json", review("docs/post.html", [first, second, unknown]));
  write("reviews/inbox/b.json", review("docs/later.html", [first]));
  write("reviews/inbox/c.json", review("docs/unpublished.html", [first]));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bh-diff-stage-"));
  t.after(() => fs.rmSync(stage, { recursive: true, force: true }));
  fs.cpSync(path.join(root, "docs"), path.join(stage, "docs"), { recursive: true });
  // The site is ahead of the last commit: the diff is against what is published, not against HEAD.
  fs.writeFileSync(path.join(stage, "docs/post.html"), page(`<h2 id="a">A</h2><p>The third version of the text.</p>`));
  const done = writeReviewDiffs(root, stage);
  assert.deepEqual(done.written, [diffFile("docs/post.html", first), diffFile("docs/post.html", second)].sort(), "in commit-id order, which differs from run to run");
  assert.deepEqual(done.skipped, [{ page: "docs/later.html", commit: first }, { page: "docs/post.html", commit: unknown }]);
  assert.deepEqual(fs.readdirSync(path.join(stage, "theme/diffs")).sort(), [`post.${first}.js`, `post.${second}.js`].sort());
  const window: { BH_DIFFS?: Record<string, DiffData> } = {};
  vm.runInNewContext(fs.readFileSync(path.join(stage, diffFile("docs/post.html", first)), "utf8"), { window });
  const data = window.BH_DIFFS![`docs/post.html@${first}`];
  assert.deepEqual({ ...data.stats }, { changed: 1, added: 0, removed: 0, moved: 0 });
  assert.match(data.changes[0].html, /<del>first<\/del><ins>third<\/ins>/);
  // A page that is sealed now, or was sealed then, has nothing to show.
  assert.equal(reviewDiffScript(root, "docs/secret.html", first, SEALED), null);
  assert.equal(reviewDiffScript(root, "docs/secret.html", first, page("<p>Public now.</p>")), null);
  assert.equal(reviewDiffScript(root, "docs/post.html", "HEAD", page("<p>x</p>")), null, "only a commit id");
});
