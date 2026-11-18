import assert from "node:assert/strict";
import type http from "node:http";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome, launchChrome, serveStatic, sleep } from "../scripts/chrome.mts";
import { prepareVisual } from "../scripts/cards.mts";

// A page opens with its change highlights off, and a card is a screenshot of the page. A card has no
// button to ask for the marks, so `prepareVisual` (the script `npm run cards` runs in the page right
// before the screenshot) turns them on: contracts/social-cards.md.
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;
function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address !== "string", "the server is listening");
  return address.port;
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The design doc's card is its "Current" diagram, where the two limiters and their edges are marked removed.
const PAGE = "docs/edge-rate-limiting-design.html";
const FIGURE = '[id="arch-now"]';

interface Part { id: string; looks: string; plain: string }

/** Each marked part of the figure: how it looks now, and how it looks with its data-change attribute taken away. */
const probe = `(() => {
  const shape = (n) => n.matches(".node") ? n.querySelector("rect, circle, ellipse, polygon, path") : n;
  const looks = (n) => {
    const a = getComputedStyle(shape(n)), b = getComputedStyle(n);
    return [a.stroke, a.strokeWidth, a.strokeDasharray, b.opacity].join(" | ");
  };
  return [...document.querySelectorAll(${JSON.stringify(FIGURE + " [data-change]")})].map((n) => {
    const kind = n.dataset.change, marked = looks(n);
    n.removeAttribute("data-change");
    const plain = looks(n);
    n.setAttribute("data-change", kind);
    return { id: n.dataset.id || "", looks: marked, plain };
  });
})()`;

test("cards: the page is captured with its change highlights on", { skip, timeout: 60000 }, async (t) => {
  const server = await serveStatic(root);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const chrome = await launchChrome();
  t.after(() => chrome.close());
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  t.after(() => chrome.send("Target.closeTarget", { targetId }).catch(() => {}));
  const s = (method: string, params?: object) => chrome.send(method, params, sessionId);
  const evaluate = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await s("Page.enable");
  await s("Page.bringToFront");
  // The view `captureVisual` sets up.
  await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await s("Page.navigate", { url: `http://127.0.0.1:${portOf(server)}/${PAGE}?examples` });
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) {
    await sleep(100);
    ready = await evaluate("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')").catch(() => false);
  }
  assert.ok(ready, "the page settled within 15 seconds");

  // The control: as the page opens, a marked part looks like an unmarked one. Without this the
  // assertions below would pass on a page that never had its highlights off.
  assert.equal(await evaluate(`document.documentElement.getAttribute("data-changes")`), "off", "the page's switch starts off");
  const before: Part[] = await evaluate(probe);
  assert.ok(before.length >= 2, "the figure has marked parts");
  for (const p of before) assert.equal(p.looks, p.plain, `${p.id} is not highlighted as the page opens`);

  // The figure's own <bh-versions> is switched off as well: the page's switch does not reach that.
  const own = `document.querySelector(${JSON.stringify(FIGURE)}).closest("bh-versions")`;
  await evaluate(`${own}.setAttribute("data-changes", "off")`);
  const pressed = `document.querySelector(".bh-changes-btn").getAttribute("aria-pressed")`;
  assert.equal(await evaluate(pressed), "false", "the page's button starts unpressed");

  const box = await evaluate(prepareVisual({ tier: "figure", css: FIGURE, index: 0 }));
  assert.ok(!box.error && box.width >= 8 && box.height >= 8, "the figure's picture was found");

  assert.equal(await evaluate(`document.documentElement.getAttribute("data-changes")`), null, "the page's switch is on");
  // Only bh.showChanges() moves the button: with the attribute merely lifted, the button would still say off.
  assert.equal(await evaluate(pressed), "true", "the page's switch was turned on through its button");
  // Only the lift reaches the component's own switch.
  assert.equal(await evaluate(`${own}.getAttribute("data-changes")`), null, "the figure's own switch is on");
  const after: Part[] = await evaluate(probe);
  for (const p of after) assert.notEqual(p.looks, p.plain, `${p.id} is highlighted when the card is captured`);
  assert.ok(after.some((p) => p.looks.includes("5px, 4px")), "a removed part has its dashed outline");
});
