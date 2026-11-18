import assert from "node:assert/strict";
import type http from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome, launchChrome, serveStatic, sleep } from "../scripts/chrome.mts";

// bh.js is deferred, and it builds the table of contents. The reading column must not wait for it:
// while the script is still loading, and with JavaScript off, the article and its text sit where
// they sit once the script has run. Otherwise a slow connection shows one layout and then another,
// and a reader without JavaScript keeps the wrong one (the article was once laid out in the 14rem
// column meant for the table of contents).
//
// The script also builds the top bar (52px) and, below 1100px, the collapsed Contents block above the
// article: the article was pushed down 52px, and 112px on a phone, when it ran (#284). layout.css keeps
// room for both while scripts will run, so the article's top holds too; with JavaScript off there is
// no bar and no Contents, and no room is kept for them: no blank strip. The text's top is not held
// here: the hero's metadata list, which the script fills, still moves it (#298).
//
// PRE_SCRIPT_TABLE=1 prints every measurement as a table row.
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const table = !!process.env.PRE_SCRIPT_TABLE;

const DESKTOP = 1280, PHONE = 390;
/** The table of contents takes a column from 1100px: one view on each side of that. */
const BREAKPOINT = [1100, 1099];

interface Case {
  /** The path the server answers on. */
  path: string;
  widths: number[];
  /** For a fixture: whether bh.js builds a table of contents for it. */
  toc?: boolean;
  /** The browser's default font size in px, when not its own 16: the room kept is in rem, as the bar and the block are. */
  fontSize?: number;
}

/** Every page in docs/ but the sealed ones, whose content a plain request cannot render. Unlisted pages render like any other. */
const docs = readdirSync(join(root, "docs"))
  .filter((f) => f.endsWith(".html") && !f.endsWith(".private.html"))
  .filter((f) => !/<meta name="bh:sealed"/.test(readFileSync(join(root, "docs", f), "utf8")));
/** Pages measured on both sides of the breakpoint as well: with a table of contents, and without one. */
const AT_BREAKPOINT = ["token-bucket-rate-limiting.html", "edge-rate-limiting-design.html", "glossary.html"];
const templates = readdirSync(join(root, "templates")).filter((f) => f.endsWith(".html"));

/**
 * Pages made here, to pin the count that decides whether there is a table of contents: bh.js builds
 * one from three headings (h2 or h3, directly in the article, not .no-toc), and layout.css must
 * reach the same answer from the markup. No real page sits on the boundary. The last one holds components
 * whose markup the script rearranges, so the phone check does not rest on which pages use them today.
 */
const fixture = (body: string, { bodyAttrs = "", mainClass = "bh-page" } = {}) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fixture</title>
  <link rel="stylesheet" href="../theme/bh.css">
  <script src="../theme/bh.js" defer></script>
</head>
<body data-home="../index.html"${bodyAttrs}>
<main class="${mainClass}">
  <article class="bh-article">
    <header class="bh-hero"><h1>Fixture</h1></header>
    <p>A paragraph in the reading column, long enough to fill its line and wrap onto a second one at any width.</p>
${body}
  </article>
</main>
</body>
</html>
`;
const h = (tag: string, n: number, attrs = "") => `    <${tag} id="s${n}"${attrs}>Section ${n}</${tag}>\n    <p>Text.</p>`;
const three = [h("h2", 1), h("h3", 2), h("h2", 3)].join("\n");
const FIXTURES: { name: string; toc: boolean; body: string; bodyAttrs?: string; mainClass?: string }[] = [
  { name: "two-headings", toc: false, body: [h("h2", 1), h("h2", 2)].join("\n") },
  { name: "three-headings", toc: true, body: three },
  // The two ways a page turns down what bh.js would build: no room may be kept for either.
  { name: "three-headings-no-chrome", toc: true, body: three, bodyAttrs: ' data-chrome="none"' },
  { name: "three-headings-page-no-toc", toc: false, body: three, mainClass: "bh-page no-toc" },
  { name: "three-headings-one-no-toc", toc: false, body: [h("h2", 1), h("h2", 2, ' class="no-toc"'), h("h2", 3)].join("\n") },
  { name: "four-headings-one-no-toc", toc: true, body: [h("h2", 1), h("h2", 2, ' class="no-toc"'), h("h3", 3), h("h2", 4)].join("\n") },
  // An h4, and headings inside a component, are not sections.
  { name: "two-headings-and-others", toc: false, body: [h("h2", 1), h("h2", 2), h("h4", 3), '    <div class="card"><h3>In a card</h3><h3>And another</h3></div>'].join("\n") },
  // Only the page's own article counts, not a block inside it that borrows the class.
  { name: "two-headings-nested-article", toc: false, body: [h("h2", 1), h("h2", 2), '    <div class="bh-article"><h2>One</h2><h2>Two</h2><h2>Three</h2></div>'].join("\n") },
  // A chart and a matrix hold bare tables until their modules wrap them; tables far wider than a phone must not widen the page meanwhile.
  { name: "wide-chart-and-matrix", toc: false, body: [
    '    <figure id="wide-chart" class="frame wide"><bh-chart type="bar"><table>',
    `      <thead><tr><th>Quarter</th>${[1, 2, 3, 4, 5, 6].map((n) => `<th>Long series name ${n}</th>`).join("")}</tr></thead>`,
    `      <tbody>${["Q1", "Q2"].map((q, i) => `<tr><td>${q}</td>${[1, 2, 3, 4, 5, 6].map((n) => `<td>${n * 10 + i}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "    </table></bh-chart><figcaption>A chart.</figcaption></figure>",
    '    <bh-matrix id="wide-matrix" class="wide"><table><caption>A caption long enough to need a line of its own on any phone.</caption>',
    `      <thead><tr><th>Criterion</th><th>Weight</th>${["A long option", "Another long option", "A third long option", "A fourth long option"].map((o) => `<th>${o}</th>`).join("")}</tr></thead>`,
    `      <tbody>${["Cost", "Speed"].map((c) => `<tr><td>${c}</td><td>3</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>`).join("")}</tbody>`,
    "    </table></bh-matrix>",
  ].join("\n") },
];
const fixturePath = (name: string) => `/docs/pre-script-fixture-${name}.html`;

const cases: Case[] = [
  ...docs.map((f) => ({ path: `/docs/${f}`, widths: [DESKTOP, PHONE, ...(AT_BREAKPOINT.includes(f) ? BREAKPOINT : [])] })),
  { path: "/index.html", widths: [DESKTOP, PHONE] },
  { path: "/404.html", widths: [DESKTOP, PHONE] },
  ...templates.map((f) => ({ path: `/templates/${f}`, widths: [DESKTOP, PHONE] })),
  ...FIXTURES.map((f) => ({ path: fixturePath(f.name), widths: [DESKTOP, ...BREAKPOINT, PHONE], toc: f.toc })),
  // A reader whose default font size is 20px: the bar and the Contents block are larger, and so is the room kept for them.
  ...["three-headings", "two-headings"].map((name) => ({ path: fixturePath(name), widths: [DESKTOP, PHONE], toc: name === "three-headings", fontSize: 20 })),
  { path: "/docs/token-bucket-rate-limiting.html", widths: [PHONE], fontSize: 20 },
];

interface Box { x: number; width: number }
/**
 * `y` is the article's top in the document. `chrome` is the height of what bh.js put above it: the top bar,
 * and the Contents block with its margin when that sits above the article rather than in a column beside it.
 * `tocRight` is the right edge of the table of contents, or null when the page has none.
 */
interface Layout { article: Box & { y: number }; text: Box; chrome: number; toc: boolean; tocRight: number | null; innerWidth: number }

/**
 * Where the article and its first paragraph are (or, on a page with no paragraph of its own, its first
 * block in the reading column). The paragraph is in the reading column; the article spans the whole grid.
 * Read once the fonts are in: the column is 66ch wide, so it is wider while a fallback font is showing
 * (707px, not 673px, at 1280px).
 */
const probe = `(async () => {
  // A font is requested by the first layout that needs it, so lay out first and then wait.
  do { document.body.getBoundingClientRect(); await document.fonts.ready; } while (document.fonts.status !== "loaded");
  const box = (n) => { const r = n.getBoundingClientRect(); return { x: Math.round(r.x * 100) / 100, width: Math.round(r.width * 100) / 100 }; };
  const article = document.querySelector(".bh-article");
  // The first one that is shown: the home page starts with a paragraph that is hidden until a filter finds nothing.
  const shown = (sel) => article && [...article.querySelectorAll(sel)].find((n) => n.getBoundingClientRect().width > 0);
  const text = shown(":scope > p") || shown(":scope > :not(.bh-hero, .wide, .full, script, style)");
  if (!article || !text) return null;
  const round = (n) => Math.round(n * 100) / 100;
  const toc = document.querySelector(".bh-toc"), bar = document.querySelector(".bh-topbar");
  const top = article.getBoundingClientRect().top;
  const stacked = toc && toc.getBoundingClientRect().bottom <= top + 0.5;
  const chrome = (bar ? bar.getBoundingClientRect().height : 0) + (stacked ? top - toc.getBoundingClientRect().top + parseFloat(getComputedStyle(toc).marginTop) : 0);
  return { article: { ...box(article), y: round(top + scrollY) }, text: box(text), chrome: round(chrome), toc: !!toc, tocRight: toc ? round(toc.getBoundingClientRect().right) : null, innerWidth };
})()`;

test("the reading column is in place before bh.js runs, and without JavaScript", { skip, timeout: 170000 }, async (t) => {
  assert.ok(docs.length > 0 && templates.length > 0, "found pages and templates");
  for (const f of AT_BREAKPOINT) assert.ok(docs.includes(f), `${f} is a page`);
  const routes = new Map(FIXTURES.map((f) => [fixturePath(f.name), { type: "text/html; charset=utf-8", body: fixture(f.body, f) }]));
  const server = await serveStatic(root, routes);
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  // The server holds the response for bh.js until released.
  let hold = false, held = 0, release = () => {};
  const serve = server.listeners("request")[0] as (req: http.IncomingMessage, res: http.ServerResponse) => void;
  server.removeAllListeners("request");
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!hold || !/\/theme\/bh\.js(?:\?|$)/.test(req.url || "")) serve(req, res);
    else { held++; const before = release; release = () => { before(); serve(req, res); }; }
  });
  t.after(() => release());
  const address = server.address();
  assert.ok(address && typeof address !== "string", "the server is listening");
  const base = `http://127.0.0.1:${address.port}`;
  const chrome = await launchChrome();
  t.after(() => chrome.close());

  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  t.after(() => chrome.send("Target.closeTarget", { targetId }).catch(() => {}));
  const s = (method: string, params?: object) => chrome.send(method, params, sessionId);
  await s("Page.enable");
  await s("Page.bringToFront");
  await s("Network.enable");
  await s("Network.setCacheDisabled", { cacheDisabled: true });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const evaluate = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expression: string, what: string) => {
    let ok = false;
    for (let i = 0; i < 150 && !ok; i++) { await sleep(50); ok = await evaluate(expression).catch(() => false); }
    assert.ok(ok, `${what} within 7.5 seconds`);
  };
  const layout = async (what: string): Promise<Layout> => {
    // Two readings 50 ms apart that agree: a font that arrives just after the first one moves the column.
    let l: Layout | null = await evaluate(probe);
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      const again: Layout | null = await evaluate(probe);
      const same = JSON.stringify(again) === JSON.stringify(l);
      l = again;
      if (same) break;
    }
    assert.ok(l, `${what}: the page has an article with a block in the reading column`);
    return l;
  };
  const row = (path: string, width: number, state: string, l: Layout) => {
    if (table) console.log(`| ${path} | ${width} | ${state} | ${l.article.x} | ${l.article.y} | ${l.article.width} | ${l.chrome} | ${l.text.x} | ${l.text.width} | ${l.innerWidth} | ${l.toc ? "yes" : "no"} |`);
  };
  if (table) console.log("| page | window | state | article x | article y | article width | above it | paragraph x | paragraph width | innerWidth | TOC |\n|---|---|---|---|---|---|---|---|---|---|---|");

  // Pages with and without a table of contents must both be covered: bh.js builds none for a page with few headings.
  // And a phone page with the Contents block above its article, the room the bar alone does not cover.
  const seen = { toc: 0, none: 0, stacked: 0 };
  for (const width of [...new Set(cases.flatMap((c) => c.widths))]) {
    const phone = width < 640;
    for (const page of cases.filter((c) => c.widths.includes(width))) {
      await t.test(`${page.path} at ${width}px${page.fontSize ? `, ${page.fontSize}px default font` : ""}`, async () => {
        await s("Emulation.setDeviceMetricsOverride", { width, height: phone ? 800 : 900, deviceScaleFactor: 1, mobile: phone });
        await s("Page.setFontSizes", { fontSizes: { standard: page.fontSize || 16 } });
        // Example pages show their content on a local host only with ?examples.
        const url = base + page.path + "?examples";

        hold = true; held = 0;
        await s("Emulation.setScriptExecutionDisabled", { value: false });
        await s("Page.navigate", { url });
        // The document is parsed and painted, and the deferred script has not arrived.
        await until(`document.readyState === "interactive" && performance.getEntriesByType("paint").length > 0`, "the page painted");
        assert.equal(held, 1, "bh.js was requested and is held");
        assert.equal(await evaluate("typeof window.bh"), "undefined", "bh.js has not run");
        const waiting = await layout("bh.js held");
        row(page.path, width, "bh.js held", waiting);
        release(); release = () => {}; hold = false;
        await until("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", "the page settled");
        const settled = await layout("settled");
        row(page.path, width, "settled", settled);
        if (width >= 1100) seen[settled.toc ? "toc" : "none"]++;
        if (settled.toc && settled.chrome > (await evaluate(`document.querySelector(".bh-topbar")?.getBoundingClientRect().height || 0`))) seen.stacked++;
        if (page.fontSize) assert.equal(await evaluate("getComputedStyle(document.documentElement).fontSize"), `${page.fontSize}px`, "the default font size is the one asked for");

        await s("Emulation.setScriptExecutionDisabled", { value: true });
        await s("Page.navigate", { url });
        // The page's scripts are off; the protocol's own evaluation still runs.
        await until(`document.readyState === "complete" && !document.documentElement.classList.contains("js")`, "the page loaded without JavaScript");
        const off = await layout("no JavaScript");
        row(page.path, width, "no JavaScript", off);
        await s("Emulation.setScriptExecutionDisabled", { value: false });

        if (page.toc !== undefined) assert.equal(settled.toc, page.toc, "bh.js builds a table of contents from three headings");
        // Equal positions are not enough: were CSS to count the headings as too few where the script builds a
        // table of contents, the page would stay one column, the table of contents stacked above an article that never moved.
        if (width >= 1100 && settled.tocRight !== null) assert.ok(settled.article.x >= settled.tocRight, `the table of contents has its own column, left of the article (${settled.tocRight} <= ${settled.article.x})`);
        // A phone widens its viewport to fit anything wider than the screen, and zooms the whole page out.
        // A table, a code block or a diagram scrolls inside its own box, in CSS, before bh.js has run as after.
        assert.equal(settled.innerWidth, width, "nothing widens the settled page");
        assert.equal(waiting.innerWidth, width, "nothing widens the page while bh.js loads");
        assert.equal(off.innerWidth, width, "nothing widens the page without JavaScript");
        assert.ok(settled.text.width >= Math.min(320, width - 80), `the settled paragraph is a reading column (${settled.text.width}px)`);
        assert.deepEqual(waiting.text, settled.text, "the paragraph is in the same place while bh.js loads as after it runs");
        // Its top as well: room was kept for the top bar and, below 1100px, for the Contents block.
        assert.deepEqual(waiting.article, settled.article, "the article is in the same place while bh.js loads as after it runs");
        assert.deepEqual(off.text, settled.text, "the paragraph is in the same place without JavaScript");
        const { y: offY, ...offAcross } = off.article, { y: settledY, ...settledAcross } = settled.article;
        assert.deepEqual(offAcross, settledAcross, "the article is in the same place across the page without JavaScript");
        // Without JavaScript there is no bar and no Contents block, and no room is kept for them: no blank strip.
        assert.ok(Math.abs(offY - (settledY - settled.chrome)) < 0.02, `without JavaScript the article is not pushed down by room for a bar or a Contents block that never comes (${offY}px, not ${settledY} - ${settled.chrome}px)`);
      });
    }
  }
  assert.ok(seen.toc > 0, "a page with a table of contents was measured");
  assert.ok(seen.none > 0, "a page without a table of contents was measured");
  assert.ok(seen.stacked > 0, "a page with the Contents block above its article was measured");
});
