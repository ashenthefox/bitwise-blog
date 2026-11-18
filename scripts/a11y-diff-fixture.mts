// Pages that show a page diff, for `npm run a11y` (scripts/a11y.mts) to scan.
//
// No public page carries the diff UI (the change bar, the marks, the inert copies, the list of changes), so
// without these axe has never run on it (#341). Both pages are made from one pair of old and new versions with
// the real machinery (`diffPages`, `renderDiffPage`, `diffData`, `diffScript` in scripts/page-diff.mts), so the
// markup is what `npm run diff` and the `?diff=` link produce, never written by hand. They are served from memory
// beside the real pages, on the real theme, so nothing is committed under `docs/` or `theme/diffs/`:
//
// - `DIFF_LIVE_PAGE` is the new version as a live page, opened with `?diff=<commit>`: the marks are closed
//   `<details>` and the change bar (Previous, Next, Expand all, Close) is on the page.
// - `DIFF_STANDALONE_PAGE` is the page `npm run diff` writes: the marks are open, the list of changes follows the
//   hero, and the word diff is `<ins>`/`<del>` in the page itself.
//
// The versions hold one changed, one added, one removed and one moved block, a changed figure (a before/after
// pair, one version styled by id so its copies are drawn in shadow trees) and a changed code block whose line is
// far wider than a phone, so the copies that scroll are scroll regions (tabindex and a name) at phone width.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffData, diffPages, diffScript, renderDiffPage } from "./page-diff.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The live page, a path from the site root (under docs/ so `../theme/` resolves). Opened with `DIFF_LIVE_QUERY`. */
export const DIFF_LIVE_PAGE = "docs/a11y-diff-live.html";
/** The page `npm run diff` writes for the same two versions, served in the same folder. */
export const DIFF_STANDALONE_PAGE = "docs/a11y-diff-page.html";
/** The commit the live page's `?diff=` names (the data is served for any, so this is only a name). */
const COMMIT = "d".repeat(40);
/** The query string that opens `DIFF_LIVE_PAGE` with its changes marked. */
export const DIFF_LIVE_QUERY = `diff=${COMMIT}`;

const figure = (x: number) => `<figure class="diagram wide" id="flow">
  <svg viewBox="-16 -16 432 112" role="img" aria-label="A client calls a service">
    <g class="node c3" data-id="client"><rect x="0" y="12" width="130" height="56" rx="10"/><text x="65" y="40">Client</text></g>
    <g class="node c1" data-id="service"><rect x="${x}" y="12" width="130" height="56" rx="10"/><text x="${x + 65}" y="40">Service</text></g>
    <path class="edge" data-id="call" d="M130 40 H${x - 11}"/>
  </svg>
  <figcaption>The client calls the service.</figcaption>
</figure>`;

/** One long line: wider than a phone (and than the reading column), so a copy of it scrolls. */
const config = (burst: number) => `const limiter = createLimiter({ capacity: 100, refillPerSecond: 10, burst: ${burst}, keyBy: (request) => request.headers["x-client-id"], onReject: (request) => respond(request, 429) });`;

/** An identifier set not to wrap, wider than a phone, so the copy around it (not only a code block in it) scrolls. */
const KEY = "limiter.refillPerSecond.perClient.perRoute.withBurstAllowance.andJitterFraction.andStartupGrace";

const body = (version: "old" | "new") => {
  const o = version === "old";
  return `
<h2 id="limits">Limits</h2>
${o ? '<p id="unit-note">A limit has a unit, and the unit decides what is counted.</p>\n' : ""}<p>${o ? "The limiter refills its bucket on a timer, so an idle client still costs a tick." : 'The limiter refills its bucket lazily, so an idle client costs nothing. See <a href="#burst">the burst rules</a>.<span class="sidenote">Lazily means on the next request.</span>'} The setting is <code style="white-space: nowrap">${KEY}</code>.</p>
${o ? `<p>This paragraph is going away, and it holds <code style="white-space: nowrap">${KEY}</code>, a phrase about spare tokens.</p>\n` : ""}${figure(o ? 250 : 270)}
<pre id="config"><code class="language-js">${config(o ? 20 : 40)}</code></pre>
<h2 id="burst">Burst</h2>
<p>A sentence that stays exactly as it was in both versions.</p>
${o ? "" : '<p id="unit-note">A limit has a unit, and the unit decides what is counted.</p>\n<p>A brand new closing paragraph.</p>\n'}`;
};

/** The page's own CSS, scoped by the figure's id, differing between the versions so each copy needs its own. */
const css = (width: number) => `#flow .node.c1 rect { stroke-width: ${width}px; }`;

function pageOf(version: "old" | "new"): string {
  const title = version === "old" ? "Rate limiter limits" : "Rate limiter limits, revised";
  const template = fs.readFileSync(path.join(ROOT, "templates/explainer.html"), "utf8")
    .replaceAll("{{title}}", title).replaceAll("{{description}}", "A fixture for the accessibility run.")
    .replaceAll("{{date}}", "2026-11-18").replaceAll("{{author}}", "Tester");
  const hero = template.match(/<header class="bh-hero">[\s\S]*?<\/header>/)![0];
  return template.replace("</head>", `  <style>${css(version === "old" ? 3 : 7)}</style>\n</head>`)
    .replace(/(<article class="bh-article">)[\s\S]*(<\/article>)/, (_m, open, close) => `${open}\n    ${hero}\n${body(version)}\n  ${close}`);
}

/** The two pages and the live page's data file, as routes for `serveStatic`. */
export function diffFixtureRoutes(): Map<string, { type: string; body: string }> {
  const oldHtml = pageOf("old"), newHtml = pageOf("new");
  const diff = diffPages(oldHtml, newHtml);
  if (!diff) throw new Error("the diff fixture's versions could not be compared");
  const { changed, added, removed, moved } = diff.stats;
  if (!changed || !added || !removed || !moved) throw new Error(`the diff fixture must hold a changed, an added, a removed and a moved block, not ${JSON.stringify(diff.stats)}`);
  const html = "text/html; charset=utf-8", js = "text/javascript";
  const slug = path.basename(DIFF_LIVE_PAGE, ".html");
  return new Map([
    [`/${DIFF_LIVE_PAGE}`, { type: html, body: newHtml }],
    [`/${DIFF_STANDALONE_PAGE}`, { type: html, body: renderDiffPage(diff, { base: COMMIT.slice(0, 7), head: "the working tree" }) }],
    [`/theme/diffs/${slug}.${COMMIT}.js`, { type: js, body: diffScript(DIFF_LIVE_PAGE, diffData(diff, COMMIT)) }],
  ]);
}
