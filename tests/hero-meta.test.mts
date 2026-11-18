// The hero's list of facts and the "Superseded" banner, written into the page (#298): the word count
// that gives the reading time, the markup, and what index, check, seal and diff do with them.
// The layout half (nothing moves when bh.js arrives, and the facts read without JavaScript) is in
// tests/pre-script-layout.test.mts.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { articleText, articleWords, readingTime, withoutHeroMeta, heroMetaList, supersededBanner, EMPTY_HERO_META } from "../scripts/hero-meta.mts";
import { diffPages } from "../scripts/page-diff.mts";
import { site as privateSite } from "./support/private-site.mts";

const page = (body: string) => `<!doctype html><html><head><title>T</title></head><body><main><article class="bh-article">${body}</article></main></body></html>`;

test("words are counted as the browser counts the article's textContent", () => {
  // A tag adds no space; white space and white-space entities split words; other entities are letters.
  assert.equal(articleWords(page("<p>one</p><p>two</p> three")), 2);
  assert.equal(articleWords(page("a&nbsp;b &amp; c&#160;d&#x20;e")), 6);
  // A script's and a style's text count as written; a comment and a template's content do not.
  assert.equal(articleWords(page("<script>let a = 1;</script><style>p { x: y }</style>")), 8);
  assert.equal(articleWords(page("<!-- two words --><template><p>not counted</p></template>kept")), 1);
  // An attribute value may hold ">"; it is still one tag.
  assert.equal(articleWords(page('<bh-playground data-expr="a > b">in</bh-playground> out')), 2);
  // Only the page's article: text before and after it is not counted, and a nested article is inside it.
  assert.equal(articleText(`<p>before</p><article class="note bh-article x"><article>in</article></article><p>after</p>`), "in");
  assert.equal(articleWords("<p>no article here</p>"), 0);
});

test("the generated list and banner are not words of the page", () => {
  const filled = page(`<header class="bh-hero"><h1>T</h1>
      <dl class="bh-meta" data-auto>
        <div><dt>Status</dt><dd>draft</dd></div>
      </dl>
    </header>
    <aside class="callout warn bh-superseded" role="note">
      <p class="callout-title">Superseded</p>
    </aside>
    <p>body</p>`);
  assert.equal(articleWords(filled), 2, "T and body");
  const bare = withoutHeroMeta(filled);
  assert.ok(bare.includes(EMPTY_HERO_META) && !bare.includes("bh-superseded"), "the list is emptied and the banner taken out");
  // A list that is the author's own (no data-auto) is a list of the page's.
  assert.equal(articleWords(page('<dl class="bh-meta"><div><dt>Owner</dt> <dd>me</dd></div></dl>')), 2);
});

test("the reading time is bh.js's: nothing up to 150 words, then words / 230 rounded, at least 1", () => {
  assert.equal(readingTime(150), "");
  assert.equal(readingTime(151), "1 min");
  assert.equal(readingTime(344), "1 min");
  assert.equal(readingTime(345), "2 min");
  assert.equal(readingTime(2355), "10 min");
});

test("the list and banner markup", () => {
  assert.equal(heroMetaList([], "  "), EMPTY_HERO_META, "no rows: the empty list, for bh.js to leave as it is");
  assert.equal(heroMetaList([{ term: "Status", html: '<span class="badge draft">draft</span>' }], "      "),
    '<dl class="bh-meta" data-auto>\n        <div><dt>Status</dt><dd><span class="badge draft">draft</span></dd></div>\n      </dl>');
  assert.match(supersededBanner('<a href="b.html">B</a>', true, "    "), /^\n    <aside class="callout warn bh-superseded" role="note">\n {6}<p class="callout-title">Superseded<\/p>\n {6}<p>This decision has been replaced by <a href="b\.html">B<\/a>\. It is kept as the record/);
  assert.match(supersededBanner("x", false, ""), /This page has been replaced by x\. It is kept as an archive, so links to it still work\./);
});

test("a page diff leaves the generated list and banner out of both versions", () => {
  const hero = (dl: string) => `<header class="bh-hero"><h1>Title</h1>\n      ${dl}\n    </header>`;
  const before = page(`${hero(EMPTY_HERO_META)}\n    <p>Body.</p>`);
  const after = page(`${hero('<dl class="bh-meta" data-auto>\n        <div><dt>Reading time</dt><dd>3 min</dd></div>\n      </dl>')}\n    <aside class="callout warn bh-superseded" role="note">\n      <p>Replaced.</p>\n    </aside>\n    <p>Body.</p>`);
  const diff = diffPages(before, after)!;
  assert.deepEqual(diff.stats, { changed: 0, added: 0, removed: 0, moved: 0 }, "a version from before they were generated is not a change");
  assert.equal(diff.blocks, 2, "the banner is not one of the blocks the live page is matched against (diff.js skips it too)");
});

/** A throwaway copy of the site (tests/support/private-site.mts), its commands' output without colours. */
function site(t: Parameters<typeof privateSite>[0]) {
  const s = privateSite(t);
  const run = (args: string[]) => { const r = s.run(args); return { ...r, out: r.out.replace(/\x1b\[[0-9;]*m/g, "") }; };
  return { ...s, run };
}

test("index writes the list from the page's metas, again only when they change, and check fails while it is stale", { timeout: 170000 }, (t) => {
  const s = site(t);
  const rel = "docs/token-bucket-rate-limiting.html";
  // The committed pages are current: index changes none of them.
  const first = s.run(["index"]);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /Hero facts written for \d+ pages \(0 updated\)/);
  // A changed meta: check names the list, and index rewrites it, once.
  const html = s.read(rel), edited = html.replace(/(<meta name="bh:status" content=")[^"]*"/, '$1draft &amp; open"');
  assert.notEqual(edited, html, "the status was changed");
  s.write(rel, edited);
  const stale = s.run(["check", "--skip-keys"]);
  assert.match(stale.out, /error +the hero's <dl class="bh-meta" data-auto> list is stale or edited by hand: run `npm run index`/);
  assert.match(s.run(["index"]).out, /\(1 updated\)/);
  assert.match(s.read(rel), /<div><dt>Status<\/dt><dd><span class="badge draft &amp; open">draft &amp; open<\/span><\/dd><\/div>/, "the value is decoded, as the browser reads it, then escaped");
  assert.match(s.run(["index"]).out, /\(0 updated\)/, "a second run changes nothing");
  // A page that becomes superseded gets the banner after its hero, and loses it again.
  const old = "docs/how-deflate-works.html";
  const banner = /<\/header>\n {4}<aside class="callout warn bh-superseded" role="note">\n {6}<p class="callout-title">Superseded<\/p>\n {6}<p>This page has been replaced by <a href="how-deflate-compresses\.html">How DEFLATE compresses<\/a>\. It is kept as an archive, so links to it still work\.<\/p>\n {4}<\/aside>\n/;
  assert.match(s.read(old), banner);
  s.write(old, s.read(old).replace(banner, "</header>\n"));
  assert.match(s.run(["check", "--skip-keys"]).out, /error +the "Superseded" banner after the hero is stale, misplaced or edited by hand: run `npm run index`/);
  s.run(["index"]);
  assert.match(s.read(old), banner, "index puts it back");
  // The search text and backlinks do not take the list or the banner for the page's words or links.
  assert.ok(!/Reading time|Superseded by/.test(s.read("theme/search-index.js")), "no generated text in the search index");
  // Templates keep the empty list: `new` copies it, and the index that `new` runs fills it.
  for (const f of fs.readdirSync(path.join(s.root, "templates"))) assert.ok(s.read(`templates/${f}`).includes(EMPTY_HERO_META), `templates/${f} keeps the empty list`);
  const made = s.run(["new", "explainer", "hero-probe", "Hero probe", "A page to see its list filled."]);
  assert.equal(made.code, 0, made.out);
  assert.match(s.read("docs/hero-probe.html"), /<dl class="bh-meta" data-auto>\n {8}<div><dt>Status<\/dt>/);
});

test("a decision link names a page that every reader of this one may see; an unlisted or example page is named by its path", (t) => {
  const s = site(t);
  // A listed post superseded by an example: the published site has no examples, so the post must not carry its title.
  const post = "docs/how-deflate-works.html", next = "docs/how-deflate-compresses.html";
  s.write(next, s.read(next).replace(/(<meta name="bh:tags"[^>]*>)/, '$1\n  <meta name="bh:example" content="true">'));
  assert.equal(s.run(["index"]).code, 0);
  assert.match(s.read(post), /<dt>Superseded by<\/dt><dd><a href="how-deflate-compresses\.html" data-untitled>how-deflate-compresses\.html<\/a><\/dd>/);
  assert.match(s.read(post), /This page has been replaced by <a href="how-deflate-compresses\.html" data-untitled>how-deflate-compresses\.html<\/a>\./, "nor in its banner");
  // An unlisted chain: neither page carries the other's title, which is only in theme/unlisted-pages.js.
  const unlisted = (rel: string) => s.write(rel, s.read(rel).replace(/\s*<meta name="bh:example" content="true">/, "").replace(/(<meta name="bh:tags"[^>]*>)/, '$1\n  <meta name="bh:unlisted" content="true">'));
  unlisted(post); unlisted(next);
  assert.equal(s.run(["index"]).code, 0);
  assert.match(s.read(post), /<dt>Superseded by<\/dt><dd><a href="how-deflate-compresses\.html" data-untitled>how-deflate-compresses\.html<\/a><\/dd>/);
  assert.match(s.read(next), /<dt>Supersedes<\/dt><dd><a href="how-deflate-works\.html" data-untitled>how-deflate-works\.html<\/a><\/dd>/);
  // Between two examples (the ADRs) the title is shown, as it is to anyone who can see either.
  assert.match(s.read("docs/adr-001-rate-limit-in-each-service.html"), /<dt>Superseded by<\/dt><dd><a href="adr-002-rate-limit-at-the-edge\.html">ADR-002: Rate limit at the edge gateway<\/a><\/dd>/);
});

test("seal writes the list into a private page before it encrypts it, and check asks for seal when it is stale", { timeout: 120000 }, (t) => {
  const s = site(t);
  s.newPrivate("hero-plan", "Hero plan");
  const rel = "docs/hero-plan.private.html";
  assert.ok(s.read(rel).includes(EMPTY_HERO_META), "index leaves a private source alone");
  const sealed = s.run(["seal"]);
  assert.equal(sealed.code, 0, sealed.out);
  assert.match(sealed.out, /Wrote the hero's facts into docs\/hero-plan\.private\.html/);
  assert.match(s.read(rel), /<dl class="bh-meta" data-auto>\n {8}<div><dt>Status<\/dt>/);
  // The sealed copy is what is on disk now: unsealing gives it back, and sealing again changes nothing.
  const plain = s.read(rel);
  assert.match(s.run(["seal"]).out, /docs\/hero-plan\.html is up to date/);
  assert.equal(s.read(rel), plain);
  assert.match(s.run(["check"]).out, /✓ docs\/hero-plan\.private\.html/);
  s.setMeta("hero-plan", "bh:status", "accepted");
  assert.match(s.run(["check"]).out, /error +the hero's <dl class="bh-meta" data-auto> list is stale or edited by hand: run `npm run seal`, which writes them into the private page before it encrypts it/);
});
