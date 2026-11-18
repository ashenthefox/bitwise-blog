// `bundle` (and `diff`, which builds its pages with the same function) puts the page's scripts at the end of
// the body and a `bh:source` meta at the end of the head. A page can say `</head>` or `</body>` inside its own
// script, as a string that builds another document, as docs/token-bucket-rate-limiting.html does, or in a
// comment. The injections must land at the real ends, and every inline script of the result must parse.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { inlineScripts, inlineScriptProblems } from "../scripts/inline-scripts.mts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = "docs/adr-001-rate-limit-in-each-service.html";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-bundle-placement-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html"]) fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  const edit = (rel: string, from: string | RegExp, to: string) => {
    const text = read(rel), next = text.replace(from, () => to);
    assert.notEqual(next, text, `the injection into ${rel} changed nothing: ${String(from)}`);
    fs.writeFileSync(path.join(root, rel), next);
  };
  const bundle = (rel: string = PAGE) => spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "bundle", rel], { cwd: root, encoding: "utf8", timeout: 60_000 });
  return { read, edit, bundle };
}

// Each of these says both tags, the way a page that builds another document does.
const HEAD_SCRIPT = `<script>const shell = "<html><head></head><body></body></html>";</script>`;
const BODY_SCRIPT = "<script>const page = `<!doctype html><head></head><body>${1 + 1}</body></html>`;</script>";
const MODULE_SCRIPT = '<script type="module">export const shell = `<head></head><body></body>`;</script>';

/** `html` with every inline script cut out: what is left is the document around them. */
const withoutScripts = (html: string) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "<script></script>");

test("a page that says </head> and </body> in its scripts and comments is bundled at the real ends", (t) => {
  const f = fixture(t);
  f.edit(PAGE, "</head>", `<!-- not the end: </head> -->\n  ${HEAD_SCRIPT}\n</head>`);
  f.edit(PAGE, /<\/body>\s*<\/html>\s*$/, `<!-- not the end: </body> -->\n${BODY_SCRIPT}\n${MODULE_SCRIPT}\n</body>\n</html>\n`);
  const own = f.read(PAGE);
  assert.ok(own.includes(HEAD_SCRIPT) && own.includes(BODY_SCRIPT) && own.includes(MODULE_SCRIPT), "the page holds the three scripts");
  assert.equal(own.match(/<\/head>/g)!.length, 5, "five </head> in the source: a comment, three strings and the real one");
  assert.equal(own.match(/<\/body>/g)!.length, 5, "five </body>: a comment, three strings and the real one");

  const r = f.bundle();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const html = f.read("dist/adr-001-rate-limit-in-each-service.html");
  assert.deepEqual(inlineScriptProblems(html), [], "every inline script parses");
  // The page's own scripts arrive whole, and the theme's scripts are added after them.
  const texts = inlineScripts(html).map((s) => s.text);
  for (const own of ["const shell = ", "const page = ", "export const shell = "]) assert.ok(texts.some((x) => x.startsWith(own)), `${own} is a script of its own`);
  assert.ok(texts.some((x) => x.includes("window.bh") || x.includes("customElements")), "the theme's script is in");

  // The document around the scripts: the meta ends the head, the theme's scripts end the body.
  const shell = withoutScripts(html);
  assert.ok(shell.includes('<script></script>\n  <meta name="bh:source" content="docs/adr-001-rate-limit-in-each-service.html">\n</head>'), "the meta is last in the head, after the page's own head script");
  assert.equal(shell.match(/<meta name="bh:source"/g)!.length, 1);
  assert.ok(/<\/main>\n<!-- not the end: <\/body> -->\n(?:<script><\/script>\n?)+<\/body>\n<\/html>\n?$/.test(shell.slice(shell.indexOf("</main>"))), "every script put in is at the end of the body, after the page's own");
  const afterBodyScript = html.slice(html.indexOf("export const shell = "));
  assert.ok(afterBodyScript.indexOf("window.bh") > 0, "the theme's scripts come after the page's own");
});

test("a bundle whose script cannot run fails, and names the script", (t) => {
  const f = fixture(t);
  f.edit(PAGE, "</head>", "<script>const broken = ;</script>\n</head>");
  const r = f.bundle();
  assert.notEqual(r.status, 0, "bundling fails");
  assert.match(r.stderr, /cannot run/);
  assert.match(r.stderr, /const broken/);
  assert.match(r.stderr, /does not parse/);
});

test("inlineScriptProblems checks classic and module scripts, and skips data blocks and external ones", () => {
  const ok = '<script>var a = 1;</script><script type="module">import "x"; export const b = await 2;</script><script type="application/ld+json">{ not js }</script><script src="a.js"></script><!-- <script>var = ;</script> -->';
  assert.deepEqual(inlineScriptProblems(ok), []);
  assert.equal(inlineScripts(ok).length, 2, "two scripts to parse");
  assert.equal(inlineScriptProblems("<script>var a = `x</script>").length, 1, "a script cut short");
  assert.equal(inlineScriptProblems('<script type="module">const = 1;</script>').length, 1, "a module that is wrong");
  assert.equal(inlineScriptProblems("<script>await 1;</script>").length, 1, "await at the top level is for modules only");
});
