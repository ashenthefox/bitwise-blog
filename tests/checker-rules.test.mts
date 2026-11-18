// `npm run check` is the repo's main guard, so its rules need tests of their own: a rule that
// silently stopped firing would let every page through. Each case here breaks (or, for a
// control, leaves alone) one thing in a throwaway copy of the site, runs the real `check`, and
// asserts the exact messages it prints for that page, no more and no fewer.
//
// A page case is a fragment in tests/fixtures/checker-rules/. Its leading comments say what
// `check` must report for the page the fragment is injected into, one per message:
//   <!-- expect error: <message> -->     <!-- expect warn: <message> -->     <!-- expect clean -->
// Rules about the theme (contrast, stylesheet imports) edit a theme file instead; see THEME_CASES.
// Rules about CLAUDE.md's contract pointers edit CLAUDE.md or contracts/ instead; see the contract cases.
// Rules about the social cards' records edit social-cards.txt or a card instead; see the card record cases.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import zlib from "node:zlib";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(source, "tests/fixtures/checker-rules");

// The host page: any public page whose first visual comes before the fragment, so injecting a
// figure at the end of the article cannot change which visual its social card shows.
const hostFile = fs.readdirSync(path.join(source, "docs")).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html")).find((f) => {
  const html = fs.readFileSync(path.join(source, "docs", f), "utf8");
  return f !== "glossary.html" && !html.includes('id="sealed-payload"') && html.includes("</article>") && /<figure\b[^>]*>(?:(?!<\/figure>)[\s\S])*?<svg\b/.test(html);
});
assert.ok(hostFile, "no public page has a figure with an svg to host the fixtures");
const HOST = "docs/" + hostFile;

/**
 * What `check` printed under one heading (a file path, or "theme"), as "error: …" and "warn: …".
 * An indented line that is not a message fails, so a wrapped message cannot hide.
 */
function messagesUnder(out: string, heading: string): string[] {
  const lines = out.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const start = lines.findIndex((l) => /^[✓✗!] /.test(l) && (l.slice(2) === heading || l.slice(2).startsWith(heading + " ")));
  assert.ok(start >= 0, `check printed no heading "${heading}":\n${out}`);
  const found: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^[✓✗!] /.test(l) || /^\d+ files/.test(l)) break;
    if (!l.trim()) continue;
    const m = l.match(/^ {2}(error|warn) +(.*)$/);
    assert.ok(m, `unrecognised line under "${heading}": ${JSON.stringify(l)}`);
    found.push(`${m[1]}: ${m[2]}`);
  }
  return found;
}

// One throwaway copy of the site serves every case; each case restores what it edited.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-rules-test-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "contracts", "CLAUDE.md", "package.json", "index.html", "feed.xml", "sitemap.xml", "robots.txt", "404.html", "social-cards.txt"]) {
  fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
}
// `check` asks 1Password for a private page's key; make that fail at once instead.
const bin = path.join(root, "bin");
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
// BH_SITE_URL, BH_REPO_URL and friends change the generated social and attribution blocks, so they are dropped.
const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
for (const key of Object.keys(env)) if (key.startsWith("BH_")) delete env[key];

const check = () => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "check"], { cwd: root, env, encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "");
};
/** Rewrite one file for the duration of `fn`; the edit must change something. */
const edited = <T,>(rel: string, edit: (text: string) => string, fn: () => T): T => {
  const file = path.join(root, rel), before = fs.readFileSync(file, "utf8"), after = edit(before);
  assert.notEqual(after, before, `the edit to ${rel} changed nothing`);
  fs.writeFileSync(file, after);
  try { return fn(); } finally { fs.writeFileSync(file, before); }
};
const inject = (fragment: string) => edited(HOST, (html) => html.replace("</article>", () => `${fragment}</article>`), check);

test("the host page is clean before anything is injected", () => {
  const out = check();
  assert.match(out, /\d+ files · 0 errors/, out);
  assert.deepEqual(messagesUnder(out, HOST), []);
});

const cases = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".html")).sort();
test("there are page cases to run", () => assert.ok(cases.length > 0, "no fixtures found"));

for (const name of cases) {
  test(`page rule: ${name.replace(/\.html$/, "")}`, () => {
    const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
    const EXPECT = /^[ \t]*<!-- expect (error|warn): (.*?) -->[ \t]*\r?\n/gm;
    const expected = [...text.matchAll(EXPECT)].map((m) => `${m[1]}: ${m[2]}`);
    const clean = /^[ \t]*<!-- expect clean -->[ \t]*\r?\n/m.test(text);
    assert.ok(clean !== (expected.length > 0), `${name} must say either "expect clean" or at least one "expect error|warn"`);
    const fragment = text.replace(EXPECT, "").replace(/^[ \t]*<!-- expect clean -->[ \t]*\r?\n/m, "");
    assert.ok(!fragment.includes("<!-- expect"), `${name} has a malformed expect line`);
    assert.deepEqual(messagesUnder(inject(fragment), HOST), expected);
  });
}

// Theme rules: each case edits one theme file and checks the messages under the `theme` heading.
// Ratios print as R and repeats collapse, so a palette retune or a new stylesheet import does not
// break a case; `contains` must all be reported, and every message must match `only`
// (so a light-mode fault cannot also report dark mode).
interface ThemeCase { name: string; file: string; find: string; replace: string; contains: string[]; only: RegExp }
const THEME_CASES: ThemeCase[] = [
  {
    name: "light-mode text too faint",
    file: "theme/tokens.css", find: "--text:          light-dark(#15181e, #e7e9ee)", replace: "--text:          light-dark(#a9adb5, #e7e9ee)",
    contains: ["error: tokens.css: --text on --bg is R:1 in light mode (needs 4.5:1)", "error: tokens.css: --text on --surface is R:1 in light mode (needs 4.5:1)"],
    only: /^error: tokens\.css: --text on --[\w-]+ is R:1 in light mode \(needs 4\.5:1\)$/,
  },
  {
    name: "dark-mode failure is reported as dark",
    file: "theme/tokens.css", find: "--text:          light-dark(#15181e, #e7e9ee)", replace: "--text:          light-dark(#15181e, #1d2129)",
    contains: ["error: tokens.css: --text on --bg is R:1 in dark mode (needs 4.5:1)", "error: tokens.css: --text on --surface is R:1 in dark mode (needs 4.5:1)"],
    only: /^error: tokens\.css: --text on --[\w-]+ is R:1 in dark mode \(needs 4\.5:1\)$/,
  },
  {
    name: "an equally readable text colour passes",
    file: "theme/tokens.css", find: "--text:          light-dark(#15181e, #e7e9ee)", replace: "--text:          light-dark(#101318, #f0f2f6)",
    contains: [], only: /(?!)/, // nothing may be reported
  },
  {
    // #127a48 passes every token pair (on --ok-soft, --surface) but not as badge text on its own 10% tint.
    name: "badge text too faint on its own tint",
    file: "theme/tokens.css", find: "--ok:     light-dark(#117142,", replace: "--ok:     light-dark(#127a48,",
    contains: ["error: tokens.css: a .badge in --ok on --bg is R:1 in light mode (needs 4.5:1)", "error: tokens.css: a .badge in --ok on --surface-2 is R:1 in light mode (needs 4.5:1)"],
    only: /^error: tokens\.css: a \.badge in --ok on --[\w-]+ is R:1 in light mode \(needs 4\.5:1\)$/,
  },
  {
    name: "a slightly darker badge tone passes",
    file: "theme/tokens.css", find: "--ok:     light-dark(#117142,", replace: "--ok:     light-dark(#106f41,",
    contains: [], only: /(?!)/,
  },
  {
    // The search dialog's matches are --text on --warn-soft; a dark --warn-soft in light mode must fail that pair.
    name: "search-match highlight too dark for its text",
    file: "theme/tokens.css", find: "--warn-soft:   light-dark(#fdf1dc,", replace: "--warn-soft:   light-dark(#3a3a3a,",
    contains: ["error: tokens.css: --text on --warn-soft is R:1 in light mode (needs 4.5:1)"],
    only: /^error: tokens\.css: --[\w-]+ on --warn-soft is R:1 in light mode \(needs 4\.5:1\)$/,
  },
  {
    name: "a token that is no longer a light-dark() pair",
    file: "theme/tokens.css", find: "--c6: light-dark(#475569, #a0aec0);", replace: "--c6: #475569;",
    contains: ["error: tokens.css: --c6 or --surface is not a light-dark() hex pair"],
    only: /^error: tokens\.css: --c6 or --surface is not a light-dark\(\) hex pair$/,
  },
  {
    name: "@import after another rule",
    file: "theme/bh.css", find: '@import url("tokens.css") layer(tokens);', replace: 'body { margin: 0; }\n@import url("tokens.css") layer(tokens);',
    contains: ['error: theme/bh.css: @import after other rules is ignored by browsers: @import url("tokens.css") layer(tokens);'],
    only: /^error: theme\/bh\.css: @import after other rules is ignored by browsers: @import /,
  },
  {
    name: "@import of a stylesheet that does not exist",
    file: "theme/bh.css", find: '@import url("print.css")', replace: '@import url("nope.css")',
    contains: ["error: theme/bh.css: @import of missing file nope.css"],
    only: /^error: theme\/bh\.css: @import of missing file nope\.css$/,
  },
  {
    // The fonts are self-hosted; a Google Fonts @import would send every reader's IP address to Google again.
    name: "a stylesheet imported from another host",
    file: "theme/bh.css", find: '@import url("fonts.css");', replace: '@import url("https://fonts.googleapis.com/css2?family=Inter");\n@import url("fonts.css");',
    contains: ["error: theme/bh.css: loads https://fonts.googleapis.com/css2?family=Inter from another host: serve it from theme/ (fonts go in theme/fonts/, declared in theme/fonts.css)"],
    only: /^error: theme\/bh\.css: loads https:\/\/fonts\.googleapis\.com\//,
  },
  {
    // Theme code cannot carry an integrity hash, so it loads nothing from a CDN; it also stops naming the vendored file.
    name: "a theme script loaded from a CDN",
    file: "theme/bh.js", find: '"theme/vendor/mermaid-', replace: '"https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js#',
    contains: ["error: theme/bh.js: names https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js#11.17.2/mermaid.min.js on another host: vendor what it loads under theme/vendor/ (scripts/vendor.mts)"],
    only: /^error: theme\/bh\.js(?:: names https:\/\/cdn\.jsdelivr\.net\/| does not load theme\/vendor\/mermaid-)/,
  },
];

for (const c of THEME_CASES) {
  test(`theme rule: ${c.name}`, () => {
    const edit = (text: string) => (assert.ok(text.includes(c.find), `"${c.find}" is not in ${c.file}`), text.replace(c.find, () => c.replace));
    const got = [...new Set(messagesUnder(edited(c.file, edit, check), "theme").map((m) => m.replace(/\d+\.\d\d:1/, "R:1")))];
    for (const m of c.contains) assert.ok(got.includes(m), `missing: ${m}\ngot:\n${got.join("\n")}`);
    for (const m of got) assert.match(m, c.only);
  });
}

// Contract rules: every contracts/<name>.md that CLAUDE.md names must exist, and every contract must
// have a pointer line inside CLAUDE.md's <!-- bh:contracts --> fence.
const FENCE = "<!-- bh:contracts -->\n";
const CONTRACT_HEADING = "CLAUDE.md";
/** Move a file away for the duration of `fn`; it must exist first. */
const removed = <T,>(rel: string, fn: () => T): T => {
  const file = path.join(root, rel), aside = path.join(root, "removed-" + path.basename(rel)); // outside its directory
  assert.ok(fs.existsSync(file), `${rel} does not exist, so removing it tests nothing`);
  fs.renameSync(file, aside);
  try { return fn(); } finally { fs.renameSync(aside, file); }
};
/** Add a file for the duration of `fn`; it must not exist first. */
const added = <T,>(rel: string, text: string, fn: () => T): T => {
  const file = path.join(root, rel);
  assert.ok(!fs.existsSync(file), `${rel} already exists`);
  fs.writeFileSync(file, text);
  try { return fn(); } finally { fs.rmSync(file); }
};
const contractCheck = (fn: () => string) => messagesUnder(fn(), CONTRACT_HEADING);
const CONTRACTS = fs.readdirSync(path.join(source, "contracts")).filter((f) => f.endsWith(".md")).sort();
const firstContract = CONTRACTS[0]!;
/** The pointer line for `name` in the fence, which the cases below remove or keep. */
const pointerLine = (text: string, name: string) => {
  const fence = text.slice(text.indexOf(FENCE), text.indexOf("<!-- /bh:contracts -->"));
  const line = fence.split("\n").find((l) => l.includes(`contracts/${name}`));
  assert.ok(line, `no pointer line for contracts/${name} in the fence`);
  return line + "\n";
};

test("contract rule: every contract CLAUDE.md names exists, and each has a pointer (control)", () => {
  assert.ok(CONTRACTS.length > 0, "contracts/ holds no contract file");
  assert.deepEqual(contractCheck(check), []);
});

test("contract rule: a pointer to a contract that does not exist", () => {
  const edit = (text: string) => (assert.ok(text.includes(FENCE), "CLAUDE.md has no contracts fence"), text.replace(FENCE, () => `${FENCE}- Anything new? Read [\`contracts/no-such-feature.md\`](contracts/no-such-feature.md).\n`));
  assert.deepEqual(contractCheck(() => edited("CLAUDE.md", edit, check)), ["error: CLAUDE.md names contracts/no-such-feature.md, which does not exist"]);
});

test("contract rule: a named contract file that was deleted", () => {
  // The throwaway site has no README.md, so only CLAUDE.md's pointer is reported.
  assert.deepEqual(contractCheck(() => removed(`contracts/${firstContract}`, check)), [`error: CLAUDE.md names contracts/${firstContract}, which does not exist`]);
});

test("contract rule: a contract file with no pointer line", () => {
  assert.deepEqual(contractCheck(() => added("contracts/stray-notes.md", "# Stray\n", check)),
    ["error: contracts/stray-notes.md has no pointer line in CLAUDE.md's <!-- bh:contracts --> list: add one, or delete the file"]);
});

test("contract rule: a pointer removed from the fence still counts as missing when the contract is named elsewhere", () => {
  // contracts/a11y.md is also named in the Accessibility section, outside the fence.
  const edit = (text: string) => text.replace(pointerLine(text, "a11y.md"), "");
  assert.deepEqual(contractCheck(() => edited("CLAUDE.md", edit, check)),
    ["error: contracts/a11y.md has no pointer line in CLAUDE.md's <!-- bh:contracts --> list: add one, or delete the file"]);
});

test("contract rule: a file in contracts/ whose name is not a kebab-case .md", () => {
  assert.deepEqual(contractCheck(() => added("contracts/Notes.md", "# Notes\n", check)),
    ["error: contracts/Notes.md: a contract's file name is kebab-case (a-z, 0-9, -) and ends in .md"]);
});

// Card record rules: social-cards.txt records, for each card, the key it was rendered for and the hash
// of its PNG (contracts/social-cards.md). Each case edits that file, the host page's card or a theme
// file, and checks the messages under the host page and under the `theme` heading.
const SLUG = path.basename(HOST, ".html"), CARD = `docs/assets/og/${SLUG}.png`, RECORDS = "social-cards.txt";
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const recordOf = (text: string) => {
  const line = text.split("\n").find((l) => l.startsWith(SLUG + " "));
  assert.ok(line, `${RECORDS} has no line for ${SLUG}`);
  return line;
};
/** Replace several files (as bytes) for the duration of `fn`; each replacement must change its file. */
const replaced = <T,>(edits: Record<string, (b: Buffer) => Buffer>, fn: () => T): T => {
  const saved = new Map<string, Buffer>();
  try {
    for (const [rel, edit] of Object.entries(edits)) {
      const file = path.join(root, rel), before = fs.readFileSync(file), after = edit(before);
      saved.set(file, before);
      assert.ok(!after.equals(before), `the edit to ${rel} changed nothing`);
      fs.writeFileSync(file, after);
    }
    return fn();
  } finally { for (const [file, before] of saved) fs.writeFileSync(file, before); }
};
const text = (edit: (t: string) => string) => (b: Buffer) => Buffer.from(edit(b.toString("utf8")));
/** The same picture in other bytes: a tEXt chunk added after IHDR. */
const reencoded = (png: Buffer) => {
  const body = Buffer.from("tEXtComment\0same pixels, other bytes", "latin1"), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(body.length - 4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([png.subarray(0, 33), len, body, crc, png.subarray(33)]);
};
const cardMessages = (fn: () => string) => { const out = fn(); return { host: messagesUnder(out, HOST), theme: messagesUnder(out, "theme") }; };
const STALE = `error: social card ${CARD} is stale: run \`npm run cards\``;
const NOT_RECORDED_PNG = `error: social card ${CARD} is not the PNG that ${RECORDS} records for it: run \`npm run cards\``;

test("card record rule: a theme edit that changes no pixel still makes the card stale", () => {
  assert.deepEqual(cardMessages(() => edited("theme/bh.js", (t) => t + "\n// changes no pixel\n", check)), { host: [STALE], theme: [] });
});

test("card record rule: a record whose key is not the card's inputs", () => {
  const edit = (t: string) => t.replace(recordOf(t), (l) => l.replace(/ [0-9a-f]{64} /, ` ${"0".repeat(64)} `));
  assert.deepEqual(cardMessages(() => replaced({ [RECORDS]: text(edit) }, check)), { host: [STALE], theme: [] });
});

test("card record rule: a card with no record", () => {
  assert.deepEqual(cardMessages(() => replaced({ [RECORDS]: text((t) => t.replace(recordOf(t) + "\n", "")) }, check)),
    { host: [`error: social card ${CARD} has no record in ${RECORDS}: run \`npm run cards\``], theme: [] });
});

test("card record rule: a record of no public page", () => {
  assert.deepEqual(cardMessages(() => replaced({ [RECORDS]: text((t) => t + `zz-no-such-page ${"a".repeat(64)} ${"b".repeat(64)}\n`) }, check)),
    { host: [], theme: [`error: ${RECORDS} records zz-no-such-page, which is no public page: run \`npm run cards\` to remove it`] });
});

test("card record rule: records out of slug order", () => {
  const edit = (t: string) => {
    const lines = t.split("\n"), first = lines.findIndex((l) => l && !l.startsWith("#"));
    [lines[first], lines[first + 1]] = [lines[first + 1]!, lines[first]!];
    return lines.join("\n");
  };
  assert.deepEqual(cardMessages(() => replaced({ [RECORDS]: text(edit) }, check)),
    { host: [], theme: [`error: ${RECORDS} is not in its canonical form (the header, then one card per line in slug order): run \`npm run cards\``] });
});

test("card record rule: a merge conflict left in the file", () => {
  const n = fs.readFileSync(path.join(root, RECORDS), "utf8").split("\n").indexOf(recordOf(fs.readFileSync(path.join(root, RECORDS), "utf8"))) + 1;
  const edit = (t: string) => t.replace(recordOf(t), (l) => `<<<<<<< HEAD\n${l}\n=======\n${l.replace(/ [0-9a-f]{64} /, ` ${"1".repeat(64)} `)}\n>>>>>>> theirs`);
  const bad = (line: number, s: string) => `error: ${RECORDS}: line ${line} is not "<slug> <key> <png hash>": ${JSON.stringify(s)}: run \`npm run cards\``;
  assert.deepEqual(cardMessages(() => replaced({ [RECORDS]: text(edit) }, check)), {
    // A slug listed twice is no record at all: which side is right is for `npm run cards` to find out.
    host: [`error: social card ${CARD} has no record in ${RECORDS}: run \`npm run cards\``],
    theme: [bad(n, "<<<<<<< HEAD"), bad(n + 2, "======="), `error: ${RECORDS}: line ${n + 3} lists ${SLUG} again: run \`npm run cards\``, bad(n + 4, ">>>>>>> theirs")],
  });
});

test("card record rule: a PNG that is not the one recorded (the other side of a merge)", () => {
  assert.deepEqual(cardMessages(() => replaced({ [CARD]: reencoded }, check)), { host: [NOT_RECORDED_PNG], theme: [] });
  const edit = (t: string) => t.replace(recordOf(t), (l) => l.replace(/[0-9a-f]{64}$/, "2".repeat(64)));
  assert.deepEqual(cardMessages(() => replaced({ [RECORDS]: text(edit) }, check)), { host: [NOT_RECORDED_PNG], theme: [] });
});

test("card record rule: the same picture in other bytes passes once its record names them (control)", () => {
  const png = reencoded(fs.readFileSync(path.join(root, CARD)));
  const edit = (t: string) => t.replace(recordOf(t), (l) => l.replace(/[0-9a-f]{64}$/, sha(png)));
  assert.deepEqual(cardMessages(() => replaced({ [CARD]: () => png, [RECORDS]: text(edit) }, check)), { host: [], theme: [] });
});

test("card record rule: the shared site card recorded as a fallback warns outside CI", () => {
  const shared = fs.readFileSync(path.join(root, "theme/logo/og.png"));
  const edit = (t: string) => t.replace(recordOf(t), `${SLUG} fallback ${sha(shared)}`);
  assert.deepEqual(cardMessages(() => replaced({ [CARD]: () => shared, [RECORDS]: text(edit) }, check)),
    { host: ["warn: social card is the shared site card (rendered without Chrome): run `npm run cards` where Chrome is installed"], theme: [] });
});

test("card record rule: the records file is missing", () => {
  assert.deepEqual(cardMessages(() => removed(RECORDS, check)), { host: [], theme: [`error: ${RECORDS} is missing: run \`npm run cards\``] });
});

// Private page rule: a plaintext git tracks. Only .gitignore keeps `docs/*.private.html` out, and `git add -f` goes
// past it (scripts/private-leaks.mts; the push checks are in tests/private-leaks.test.mts). The throwaway site is no
// git checkout, so this case makes it one for its duration.
test("private page rule: a force-added docs/*.private.html fails check; the same file ignored does not (control)", () => {
  const rel = "docs/stray-plaintext.private.html";
  const tracked = `error: ${rel} is tracked by git, but a private page's plaintext must never be committed: \`git rm --cached ${rel}\` (and rewrite any commit that has it); \`npm run seal\` makes the copy to commit`;
  const gitIn = (...args: string[]) => {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  assert.equal(fs.existsSync(path.join(root, ".git")), false, "the throwaway site starts as no checkout");
  try {
    gitIn("init", "-q");
    fs.copyFileSync(path.join(source, ".gitignore"), path.join(root, ".gitignore"));
    added(rel, "<!doctype html>\n<title>Stray</title>\n", () => {
      assert.equal(gitIn("status", "--porcelain", "--", rel), "", "the ignore rule hides it");
      assert.equal(messagesUnder(check(), "private pages").includes(tracked), false, "an ignored plaintext is the normal case");
      gitIn("add", "-f", rel);
      assert.equal(gitIn("ls-files", "--", rel).trim(), rel, "the fault was injected");
      assert.ok(messagesUnder(check(), "private pages").includes(tracked), "a tracked plaintext fails check");
    });
  } finally {
    fs.rmSync(path.join(root, ".git"), { recursive: true, force: true });
    fs.rmSync(path.join(root, ".gitignore"), { force: true });
  }
});
