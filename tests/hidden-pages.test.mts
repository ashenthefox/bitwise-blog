// The feed, `check` and `publish.mts` must agree about which pages are hidden. They share one
// classifier (scripts/hidden-pages.mts) and one policy table (HIDDEN_RULE); these tests run the real
// consumers on a site with one page of every kind and compare what each did with HIDDEN_RULE.
//
// Adding a kind: add it to HIDDEN_KINDS and HIDDEN_RULE (the type checker insists), add a probe page
// for it to PROBES below, and the three consumer tests then cover it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { HIDDEN_CONSUMERS, HIDDEN_KINDS, HIDDEN_RULE, classifyPage, hiddenHrefs, hiddenPages, type HiddenKind } from "../scripts/hidden-pages.mts";
import { preparePublishedSite } from "../scripts/publish.mts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).homepage;

/** One page of each kind, by the file it is written to and the message `check` gives for a link to it. */
const PROBES: Record<HiddenKind, { file: string; checkMessage: RegExp }> = {
  example: { file: "probe-example.html", checkMessage: /links to example page probe-example\.html/ },
  unlisted: { file: "probe-unlisted.html", checkMessage: /links to unlisted page probe-unlisted\.html/ },
  sealed: { file: "probe-sealed.html", checkMessage: /links to private page probe-sealed\.html/ },
  private: { file: "probe-private.private.html", checkMessage: /links to private page probe-private\.private\.html/ },
};
const LINKER = "docs/probe-linker.html";

/** A throwaway copy of the site holding a probe of each kind and a post that links to all of them. */
function site(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-hidden-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", "feed.xml", "sitemap.xml", "robots.txt", "404.html"]) {
    fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  }
  // `check` asks 1Password for a private page's key; make that fail at once instead.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
  const bh = (...args: string[]) => spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), ...args], { cwd: root, env, encoding: "utf8" });
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  const edit = (rel: string, from: string | RegExp, to: string) => {
    const text = read(rel), next = text.replace(from, to);
    assert.notEqual(next, text, `the injection into ${rel} changed nothing: ${String(from)}`);
    fs.writeFileSync(path.join(root, rel), next);
  };

  assert.equal(bh("new", "--example", "explainer", "probe-example", "Probe example").status, 0);
  assert.equal(bh("new", "--unlisted", "explainer", "probe-unlisted", "Probe unlisted").status, 0);
  assert.equal(bh("new", "--private", "explainer", "probe-private", "Probe private").status, 0);
  assert.equal(bh("new", "explainer", "probe-linker", "Probe linker").status, 0);
  // A sealed shell: borrow one of the site's own.
  const shell = fs.readdirSync(path.join(root, "docs")).find((n) => n.endsWith(".html") && /name="bh:sealed"/.test(read(`docs/${n}`)));
  assert.ok(shell, "the repo should have a sealed page to borrow");
  fs.copyFileSync(path.join(root, "docs", shell), path.join(root, "docs", PROBES.sealed.file));

  edit(LINKER, /name="bh:date" content="[^"]*"/, 'name="bh:date" content="2099-01-02"');
  edit(LINKER, '<meta name="bh:tags"', '<meta name="bh:feed" content="full">\n  <meta name="bh:tags"');
  const links = HIDDEN_KINDS.map((k) => `<a href="${PROBES[k].file}">the ${k} page</a>`).join(", ");
  // Prose only: a template's own placeholder components would be reported by `check` and cut from the feed.
  edit(LINKER, /(<article class="bh-article">)[\s\S]*(<\/article>)/, `$1
    <header class="bh-hero"><h1>Probe linker</h1></header>
    <p>Links to ${links} and <a href="glossary.html">the glossary</a>.</p>
  $2`);
  assert.equal(bh("index").status, 0, "index should accept the probe pages");
  return { root, bh, read };
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const linksTo = (html: string, file: string) => new RegExp(`<a\\b[^>]*href="[^"]*${file.replace(/\./g, "\\.")}[^"]*"`).test(html);

test("HIDDEN_RULE decides every kind for every consumer, and the glossary is not hidden", () => {
  assert.deepEqual(Object.keys(HIDDEN_RULE).sort(), [...HIDDEN_KINDS].sort());
  for (const kind of HIDDEN_KINDS) assert.deepEqual(Object.keys(HIDDEN_RULE[kind]).sort(), [...HIDDEN_CONSUMERS].sort(), kind);
  assert.deepEqual(Object.keys(PROBES).sort(), [...HIDDEN_KINDS].sort(), "every kind has a probe page");
  // The feed and `check` treat all four kinds as hidden; publish removes only what it does not ship.
  for (const kind of HIDDEN_KINDS) { assert.equal(HIDDEN_RULE[kind].feed, true, kind); assert.equal(HIDDEN_RULE[kind].check, true, kind); }
  assert.deepEqual(HIDDEN_KINDS.filter((k) => HIDDEN_RULE[k].publish), ["example"]);
});

test("classifyPage reads the kind from the file name and the head, not from comments or the body", () => {
  const page = (metas: string, body = "") => `<!doctype html><html><head>${metas}</head><body>${body}</body></html>`;
  const example = '<meta name="bh:example" content="true">', unlisted = '<meta name="bh:unlisted" content="true">';
  assert.equal(classifyPage("docs/a.html", page(example)), "example");
  assert.equal(classifyPage("docs/a.html", page(unlisted)), "unlisted");
  assert.equal(classifyPage("docs/a.html", page('<meta name="bh:sealed" content="true">')), "sealed");
  assert.equal(classifyPage("docs/a.html", page("", '<script type="application/octet-stream" id="sealed-payload">x</script>')), "sealed");
  assert.equal(classifyPage("docs/a.private.html", page(example)), "private", "a private source is private whatever its head says");
  assert.equal(classifyPage("docs/a.html", page('<meta name="bh:example" content="false">')), null);
  assert.equal(classifyPage("docs/a.html", page(`<!-- ${example} -->`)), null, "a marker in a comment does not count");
  assert.equal(classifyPage("docs/a.html", page("", `<p>${example}</p>`)), null, "a marker outside the head does not count");
});

test("hiddenPages finds every kind, and a private source also hides its published address", (t) => {
  const f = site(t);
  const found = hiddenPages(f.root);
  for (const kind of HIDDEN_KINDS) assert.equal(found.get(`docs/${PROBES[kind].file}`), kind, kind);
  assert.equal(found.get("docs/probe-private.html"), "private", "the sealed copy's address is hidden before it exists");
  assert.equal(found.get(LINKER), undefined);
  assert.equal(found.get("docs/glossary.html"), undefined);
  for (const consumer of HIDDEN_CONSUMERS) {
    assert.deepEqual([...hiddenHrefs(f.root, consumer)].sort(), [...found].filter(([, k]) => HIDDEN_RULE[k][consumer]).map(([h]) => h).sort(), consumer);
  }
});

test("the feed leaves a link as text exactly where HIDDEN_RULE says", (t) => {
  const f = site(t);
  const entry = f.read("feed.xml").match(/<entry>\s*<id>[^<]*probe-linker\.html<\/id>[\s\S]*?<\/entry>/)?.[0] || "";
  const content = unescapeXml(entry.match(/<content type="html">([^<]*)<\/content>/)?.[1] || "");
  assert.ok(content, "the opted-in post carries its content");
  for (const kind of HIDDEN_KINDS) {
    assert.equal(linksTo(content, PROBES[kind].file), !HIDDEN_RULE[kind].feed, `${kind}: a link in the feed content`);
    assert.match(content, new RegExp(`the ${kind} page`), `${kind}: the words stay`);
  }
  assert.ok(linksTo(content, "glossary.html"), "an ordinary page stays a link");
  for (const kind of HIDDEN_KINDS) assert.ok(!f.read("feed.xml").includes(`<id>${SITE}docs/${PROBES[kind].file}</id>`), `${kind}: not an entry of its own`);
});

test("check reports a link exactly where HIDDEN_RULE says", (t) => {
  const f = site(t);
  const out = f.bh("check").stdout;
  const block = out.slice(out.indexOf(LINKER)).split(/\n(?=\S*(?:docs|templates)\/)/)[0]; // the lines under the linker page
  assert.ok(block.length > 0 && block.includes(LINKER), "check reached the linker page");
  for (const kind of HIDDEN_KINDS) assert.equal(PROBES[kind].checkMessage.test(block), HIDDEN_RULE[kind].check, `${kind}: reported by check`);
  assert.doesNotMatch(block, /links to (?:example|unlisted|private) page glossary/);
});

test("publish unwraps a link exactly where HIDDEN_RULE says, and stages no hidden page it removes", (t) => {
  const f = site(t);
  const stage = path.join(f.root, "stage");
  fs.mkdirSync(stage);
  for (const entry of ["index.html", "theme"]) fs.cpSync(path.join(f.root, entry), path.join(stage, entry), { recursive: true });
  // As in CI: the plaintext of a private page is not there, and an example's card is.
  fs.cpSync(path.join(f.root, "docs"), path.join(stage, "docs"), { recursive: true, filter: (p) => !p.endsWith(".private.html") });
  fs.copyFileSync(path.join(f.root, "docs/assets/og/edge-rate-limiting-design.png"), path.join(stage, "docs/assets/og/probe-example.png"));
  preparePublishedSite(stage, f.root);
  const page = fs.readFileSync(path.join(stage, LINKER), "utf8");
  for (const kind of HIDDEN_KINDS) {
    assert.equal(linksTo(page, PROBES[kind].file), !HIDDEN_RULE[kind].publish, `${kind}: a link in the published page`);
    assert.match(page, new RegExp(`the ${kind} page`), `${kind}: the words stay`);
  }
  for (const kind of HIDDEN_KINDS) {
    if (kind === "private") continue; // a private source is not in the stage to begin with
    assert.equal(fs.existsSync(path.join(stage, "docs", PROBES[kind].file)), !HIDDEN_RULE[kind].publish, `${kind}: the page is in the published site`);
  }
});
