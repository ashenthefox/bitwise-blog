import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome, launchChrome, serveStatic, sleep } from "../scripts/chrome.mts";

// Four theme bugs found authoring an interactive design page (#363):
// - `.diagram svg { width: 100% }` sized the link button's icon to the figure, and a page's `#fig svg` rule made it huge;
// - figure numbers came from a CSS counter, which skips the figures in hidden tab panels;
// - a disclosure's summary was a flex container, so inline code in it was a column of its own that could not wrap;
// - a lit two-way edge recoloured its end arrowhead but not its start one.
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const svg = (id: string) => `<svg viewBox="0 0 400 100" role="img" aria-label="Two boxes"><g class="node c1" data-id="a"><rect x="0" y="20" width="100" height="60"/><text x="50" y="55">A</text></g>`
  + `<g class="node c2" data-id="b"><rect x="300" y="20" width="100" height="60"/><text x="350" y="55">B</text></g>`
  + `<path class="edge both" data-id="${id}" d="M111 50 H289"/></svg>`;
const figure = (id: string, caption = "Notice the edge.") => `<figure class="diagram" id="${id}">${svg(`${id}-edge`)}<figcaption>${caption}</figcaption></figure>`;
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture</title>
<link rel="stylesheet" href="../theme/bh.css"><script src="../theme/bh.js" defer></script>
<style>#fig-wide svg { min-width: 960px; }</style></head>
<body><main class="bh-page"><article class="bh-article"><header class="bh-hero"><h1>Fixture</h1></header>
${figure("fig-first")}
<bh-tabs><section data-label="One">${figure("fig-tab-one")}</section><section data-label="Two">${figure("fig-tab-two")}${figure("fig-tab-two-b")}</section></bh-tabs>
${figure("fig-wide")}
<figure id="fig-bare">${svg("bare-edge")}</figure>
<details class="disclosure" id="code-summary"><summary>A sentence that names <code>a_long_identifier_with_no_spaces_in_it_anywhere_at_all</code> and then carries on for a while</summary><p>Body.</p></details>
</article></main></body></html>`;

/** Each captioned figure's number as the caption shows it, and as the copy-link toast would say it. */
const numbers = `(() => [...document.querySelectorAll(".bh-article figure")].filter((f) => f.querySelector(":scope > figcaption")).map((f) =>
  [f.id, getComputedStyle(f.querySelector(":scope > figcaption"), "::before").content, f.dataset.figN]))()`;

test("theme chrome in figures, figure numbers, summaries and two-way edges", { skip, timeout: 120000 }, async (t) => {
  const server = await serveStatic(root, new Map([["/docs/_figure-chrome-fixture.html", { type: "text/html", body: page }]]));
  const chrome = await launchChrome();
  t.after(async () => { await chrome.close(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/docs/_figure-chrome-fixture.html`;
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method: string, params?: object) => chrome.send(method, params, sessionId);
  await s("Page.enable");
  await s("Page.bringToFront");
  const evaluate = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const load = async () => {
    await s("Page.navigate", { url });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (await evaluate("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')").catch(() => false)) return;
    }
    assert.fail("the page never became ready");
  };

  await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await load();

  await t.test("the link button's icon keeps its 16px size in every figure", async () => {
    // A button in a hidden tab panel has no box to measure.
    const sizes = await evaluate(`[...document.querySelectorAll(".bh-link-btn svg")].filter((i) => i.getClientRects().length).map((i) => {
      const r = i.getBoundingClientRect(); return [i.closest("[id]").id, Math.round(r.width), Math.round(r.height)]; })`);
    assert.ok(sizes.length >= 4, `every visible figure has a link button (found ${sizes.length})`);
    assert.ok(sizes.some(([id]: [string]) => id === "fig-wide"), "the figure with the page's svg rule is among them");
    for (const [id, w, h] of sizes) assert.deepEqual([w, h], [16, 16], `${id}: the icon is 16×16`);
    // The content SVG still fills its figure, and the page's own rule still reaches it.
    assert.equal(await evaluate(`Math.round(document.querySelector("#fig-wide > svg").getBoundingClientRect().width)`), 960, "the page's #fig svg rule still sizes the diagram");
    assert.ok(await evaluate(`document.querySelector("#fig-first > svg").getBoundingClientRect().width > 300`), "a diagram still fills its figure");
  });

  await t.test("a figure keeps its number whichever tab is open", async () => {
    const expected = [["fig-first", 1], ["fig-tab-one", 2], ["fig-tab-two", 3], ["fig-tab-two-b", 4], ["fig-wide", 5]];
    const check = async (when: string) => {
      const got: [string, string, string][] = await evaluate(numbers);
      assert.deepEqual(got.map(([id, , n]) => [id, Number(n)]), expected, `${when}: each figure is numbered in order, hidden ones included`);
      for (const [id, content, n] of got) assert.equal(content, `"Figure ${n} — "`, `${id}: its caption shows the number`);
    };
    assert.ok(await evaluate(`document.getElementById("fig-tab-two").closest("section").hidden`), "the second tab starts hidden (the test needs it to be)");
    await check("first tab open");
    await evaluate(`document.querySelector(".bh-tablist [role=tab]:last-child").click()`);
    assert.ok(await evaluate(`document.getElementById("fig-tab-one").closest("section").hidden`), "the first tab is hidden after the switch");
    await check("second tab open");
  });

  await t.test("a lit two-way edge lights both arrowheads", async () => {
    const markers = await evaluate(`(() => { const e = document.querySelector('[data-id="fig-first-edge"]'); e.classList.add("is-lit");
      const cs = getComputedStyle(e); const m = [cs.markerStart, cs.markerEnd]; e.classList.remove("is-lit"); return [m, [getComputedStyle(e).markerStart]]; })()`);
    assert.match(markers[0][0], /bh-arrow-lit/, "the start marker is lit");
    assert.match(markers[0][1], /bh-arrow-lit/, "the end marker is lit");
    assert.match(markers[1][0], /bh-arrow-start/, "unlit, the start marker is the plain one");
  });

  await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await load();

  await t.test("inline code in a summary wraps with its sentence on a phone", async () => {
    const r = await evaluate(`(() => { const sum = document.querySelector("#code-summary > summary"), code = sum.querySelector("code");
      return { display: getComputedStyle(code).display, fits: sum.scrollWidth <= sum.clientWidth, lines: code.getClientRects().length }; })()`);
    assert.equal(r.display, "inline", "the code flows inline with the text, not as a flex item");
    assert.ok(r.fits, "the summary does not overflow");
    assert.ok(r.lines > 1, "the long identifier wraps");
    assert.equal(await evaluate("innerWidth"), 390, "nothing widened the phone layout");
  });
});
