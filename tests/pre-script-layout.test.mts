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
// PRE_SCRIPT_TABLE=1 prints every measurement as a table row.
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const table = !!process.env.PRE_SCRIPT_TABLE;

/** Every page a plain request renders: not an unlisted page or a sealed one. */
const pages = readdirSync(join(root, "docs"))
  .filter((f) => f.endsWith(".html") && !f.endsWith(".private.html"))
  .filter((f) => !/<meta name="bh:(?:unlisted" content="true|sealed)"/.test(readFileSync(join(root, "docs", f), "utf8")));

const views = [
  { width: 1280, height: 900, mobile: false },
  { width: 390, height: 800, mobile: true },
];

interface Box { x: number; width: number }
interface Layout { article: Box; text: Box; toc: boolean; innerWidth: number }

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
  const text = article && (article.querySelector(":scope > p") || article.querySelector(":scope > :not(.bh-hero, .wide, .full, script, style)"));
  if (!article || !text) return null;
  return { article: box(article), text: box(text), toc: !!document.querySelector(".bh-toc"), innerWidth };
})()`;

test("the reading column is in place before bh.js runs, and without JavaScript", { skip, timeout: 170000 }, async (t) => {
  assert.ok(pages.length > 0, "found pages");
  const server = await serveStatic(root);
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
  const base = `http://127.0.0.1:${address.port}/docs/`;
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
  const row = (page: string, width: number, state: string, l: Layout) => {
    if (table) console.log(`| ${page} | ${width} | ${state} | ${l.article.x} | ${l.article.width} | ${l.text.x} | ${l.text.width} | ${l.toc ? "yes" : "no"} |`);
  };
  if (table) console.log("| page | window | state | article x | article width | paragraph x | paragraph width | TOC |\n|---|---|---|---|---|---|---|---|");

  // Pages with and without a table of contents must both be covered: bh.js builds none for a page with few headings.
  const seen = { toc: 0, none: 0 };
  for (const view of views) {
    for (const page of pages) {
      await t.test(`${page} at ${view.width}px`, async () => {
        await s("Emulation.setDeviceMetricsOverride", { width: view.width, height: view.height, deviceScaleFactor: 1, mobile: view.mobile });
        // Example pages show their content on a local host only with ?examples.
        const url = base + page + "?examples";

        hold = true; held = 0;
        await s("Emulation.setScriptExecutionDisabled", { value: false });
        await s("Page.navigate", { url });
        // The document is parsed and painted, and the deferred script has not arrived.
        await until(`document.readyState === "interactive" && performance.getEntriesByType("paint").length > 0`, "the page painted");
        assert.equal(held, 1, "bh.js was requested and is held");
        assert.equal(await evaluate("typeof window.bh"), "undefined", "bh.js has not run");
        const waiting = await layout("bh.js held");
        row(page, view.width, "bh.js held", waiting);
        release(); release = () => {}; hold = false;
        await until("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", "the page settled");
        const settled = await layout("settled");
        row(page, view.width, "settled", settled);
        if (view.width >= 1100) seen[settled.toc ? "toc" : "none"]++;

        await s("Emulation.setScriptExecutionDisabled", { value: true });
        await s("Page.navigate", { url });
        // The page's scripts are off; the protocol's own evaluation still runs.
        await until(`document.readyState === "complete" && !document.documentElement.classList.contains("js")`, "the page loaded without JavaScript");
        const off = await layout("no JavaScript");
        row(page, view.width, "no JavaScript", off);
        await s("Emulation.setScriptExecutionDisabled", { value: false });

        assert.equal(settled.innerWidth, view.width, "nothing widens the page");
        assert.ok(settled.text.width >= Math.min(320, view.width - 80), `the settled paragraph is a reading column (${settled.text.width}px)`);
        assert.deepEqual(waiting.text, settled.text, "the paragraph is in the same place while bh.js loads as after it runs");
        assert.deepEqual(waiting.article, settled.article, "the article is in the same place while bh.js loads as after it runs");
        assert.deepEqual(off.text, settled.text, "the paragraph is in the same place without JavaScript");
        assert.deepEqual(off.article, settled.article, "the article is in the same place without JavaScript");
      });
    }
  }
  assert.ok(seen.toc > 0, "a page with a table of contents was measured");
  assert.ok(seen.none > 0, "a page without a table of contents was measured");
});
