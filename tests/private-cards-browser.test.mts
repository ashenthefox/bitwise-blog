import assert from "node:assert/strict";
import type http from "node:http";
import { test } from "node:test";
import { findChrome, launchChrome, serveStatic, sleep, type ChromeHandle } from "../scripts/chrome.mts";
import { site } from "./support/private-site.mts";

// The home page, with real sealed fixture pages, in a real Chrome. Keys are throwaway: the fake
// `op` in tests/support makes them, and nothing here touches a vault. Skipped without Chrome
// (and without the global WebSocket, Node >= 22, that scripts/chrome.mts drives it with).
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;

/** `init` is run in every new document before the page's own scripts. */
interface TabOptions { width?: number; height?: number; mobile?: boolean; noDecompression?: boolean; init?: string }

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address !== "string", "the server is listening");
  return address.port;
}

/** A tab: navigate, evaluate, and see what the page did. Every tab has its own sessionStorage. */
async function openTab(chrome: ChromeHandle, { width = 1100, height = 900, mobile = false, noDecompression = false, init = "" }: TabOptions = {}) {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method: string, params?: object) => chrome.send(method, params, sessionId);
  await s("Page.enable");
  await s("Page.bringToFront");
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__errors = [];
    addEventListener("error", (e) => window.__errors.push(String(e.message)));
    addEventListener("unhandledrejection", (e) => window.__errors.push(String(e.reason)));
    ${noDecompression ? "delete window.DecompressionStream;" : ""}
    ${init}` });
  const evaluate = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const ready = async () => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')").catch(() => false)) return;
      await sleep(100);
    }
    throw new Error("the page never became ready");
  };
  const goto = async (url: string) => { await s("Page.navigate", { url }); await sleep(150); await ready(); };
  return { evaluate, goto, ready, close: () => chrome.send("Target.closeTarget", { targetId }).catch(() => {}) };
}

const privateCards = "[...document.querySelectorAll('#doc-list [data-private-slug]')].map((li) => li.dataset.privateSlug)";
const titles = "[...document.querySelectorAll('#doc-list > li')].filter((li) => !li.hidden && getComputedStyle(li).display !== 'none').map((li) => li.querySelector('h3').textContent)";

test("the home page shows the private cards a key opens", { skip, timeout: 240000 }, async (t) => {
  const s = site(t);
  s.newPrivate("alpha-plan", "Alpha plan", "kin-circle");
  s.newPrivate("beta-plan", "Beta plan", "kin-circle");
  s.newPrivate("solo-note", "Solo note");
  s.setMeta("alpha-plan", "bh:date", "2026-10-12");
  s.setMeta("beta-plan", "bh:date", "2026-09-01");
  s.setMeta("solo-note", "bh:date", "2026-10-01");
  assert.equal(s.run(["seal"]).code, 0);
  assert.equal(s.run(["index"]).code, 0);
  const group = s.field("beautiful-html private group: kin-circle", "password")!;
  const solo = s.field("beautiful-html private page: solo-note", "password")!;
  const wrong = "A".repeat(43);

  const server = await serveStatic(s.root);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${portOf(server)}/`;
  const chrome = await launchChrome();
  t.after(() => chrome.close());
  const tab = async (opts?: TabOptions) => { const x = await openTab(chrome, opts); t.after(() => x.close()); return x; };

  await t.test("no fragment: the public home page, and no request for the cards", async () => {
    const p = await tab();
    await p.goto(base + "index.html");
    assert.deepEqual(await p.evaluate(privateCards), []);
    assert.equal(await p.evaluate("performance.getEntriesByType('resource').some((r) => /private-cards/.test(r.name))"), false);
    assert.equal(await p.evaluate("sessionStorage.getItem('bh-index-keys')"), null);
    assert.equal(await p.evaluate("!!document.querySelector('.card-private')"), false);
  });

  await t.test("a group key: the group's cards, in date order, filterable, key stripped, kept for the tab", async () => {
    const p = await tab();
    await p.goto(`${base}index.html#k=${group}`);
    assert.deepEqual(await p.evaluate(privateCards), ["alpha-plan", "beta-plan"]);
    assert.equal(await p.evaluate("location.hash"), "");
    assert.equal(await p.evaluate("document.documentElement.hasAttribute('data-bh-ready')"), true);
    const order = await p.evaluate("[...document.querySelectorAll('#doc-list > li:not([data-example])')].map((li) => li.querySelector('time')?.textContent || '')");
    assert.deepEqual(order, [...order].sort().reverse(), "cards are newest first");
    assert.equal(await p.evaluate("document.querySelector('[data-private-slug=alpha-plan] .card-private').textContent.trim()"), "Private");
    assert.equal(await p.evaluate("document.querySelector('[data-private-slug=alpha-plan] a').getAttribute('href')"), `docs/alpha-plan.html#k=${group}`);
    assert.equal(await p.evaluate("getComputedStyle(document.querySelector('.card-private')).display !== 'none'"), true);
    // The filter covers them: the search box, and the Type chips (an "Explainer" chip exists either way).
    await p.evaluate("(() => { const i = document.querySelector('.bh-filter input'); i.value = 'alpha plan'; i.dispatchEvent(new Event('input')); })()");
    assert.deepEqual(await p.evaluate(titles), ["Alpha plan"]);
    // The tab remembers the key: a reload still shows the cards.
    await p.goto(`${base}index.html`);
    assert.deepEqual(await p.evaluate(privateCards), ["alpha-plan", "beta-plan"]);
    assert.deepEqual(JSON.parse(await p.evaluate("sessionStorage.getItem('bh-index-keys')")), [group]);
    // A new tab does not have it.
    const other = await tab();
    await other.goto(`${base}index.html`);
    assert.deepEqual(await other.evaluate(privateCards), []);
    assert.deepEqual(await p.evaluate("window.__errors"), []);
  });

  await t.test("two keys show two groups, and a wrong key says so", async () => {
    const p = await tab();
    await p.goto(`${base}index.html#k=${group}&k=${solo}`);
    assert.deepEqual(await p.evaluate(privateCards), ["alpha-plan", "solo-note", "beta-plan"]);
    const q = await tab();
    await q.goto(`${base}index.html#k=${wrong}`);
    assert.deepEqual(await q.evaluate(privateCards), []);
    assert.equal(await q.evaluate("document.querySelector('.bh-toast')?.textContent"), "No private pages for that key");
    assert.equal(await q.evaluate("sessionStorage.getItem('bh-index-keys')"), "[]");
    // Another fragment part survives the key being removed.
    const r = await tab();
    await r.goto(`${base}index.html#k=${group}&posts`);
    assert.equal(await r.evaluate("location.hash"), "#posts");
  });

  await t.test("a key pasted into the open home page is picked up without a reload", async () => {
    const p = await tab();
    await p.goto(`${base}index.html`);
    assert.deepEqual(await p.evaluate(privateCards), []);
    await p.evaluate(`location.hash = "#k=${group}"`);
    for (let i = 0; i < 50 && !(await p.evaluate(privateCards)).length; i++) await sleep(100);
    assert.deepEqual(await p.evaluate(privateCards), ["alpha-plan", "beta-plan"]);
    assert.equal(await p.evaluate("location.hash"), "");
  });

  await t.test("a card opens its sealed page, and a page opened by its own link brings its card home", async () => {
    const p = await tab();
    await p.goto(`${base}index.html#k=${group}`);
    await p.goto(await p.evaluate("new URL(document.querySelector('[data-private-slug=alpha-plan] a').getAttribute('href'), location.href).href"));
    assert.equal(await p.evaluate("document.querySelector('h1')?.textContent"), "Alpha plan");

    const q = await tab();
    await q.goto(`${base}docs/solo-note.html#k=${solo}`);
    assert.equal(await q.evaluate("document.querySelector('h1')?.textContent"), "Solo note");
    await q.goto(`${base}index.html`);
    assert.deepEqual(await q.evaluate(privateCards), ["solo-note"]);
  });

  await t.test("without DecompressionStream the public list stays, with a toast and no exception", async () => {
    const p = await tab({ noDecompression: true });
    await p.goto(`${base}index.html#k=${group}`);
    assert.deepEqual(await p.evaluate(privateCards), []);
    assert.match(await p.evaluate("document.querySelector('.bh-toast')?.textContent"), /can't be shown/);
    assert.deepEqual(await p.evaluate("window.__errors"), []);
  });

  await t.test("a phone width: no horizontal scroll, and the lock label is readable", async () => {
    const p = await tab({ width: 375, height: 800, mobile: true });
    await p.goto(`${base}index.html#k=${group}&k=${solo}`);
    assert.equal(await p.evaluate("innerWidth"), 375);
    assert.equal(await p.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    const box = await p.evaluate("(() => { const r = document.querySelector('.card-private').getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right }; })()");
    assert.ok(box.w > 30 && box.h > 8 && box.right <= 375, JSON.stringify(box));
  });
});

// What a page offers for review, and what the Review panel tells a reader to do with the file.
const reviewState = `(() => ({
  button: !!document.querySelector(".bh-review-btn"),
  topbarReview: [...document.querySelectorAll(".bh-topbar button, .bh-topbar a")].some((e) => /review/i.test((e.getAttribute("aria-label") || "") + " " + (e.title || "") + " " + e.textContent)),
  reviewing: document.documentElement.classList.contains("bh-reviewing"),
  ui: !!document.querySelector(".bh-review-ui"),
  inbox: /reviews\\/inbox/.test(document.body.innerText),
  module: !!(window.bhModules && window.bhModules["review.js"]),
  off: document.body.dataset.review === "off",
}))()`;
// Load the review module by hand and press its toggle, as a reader could from the console or a stray caller could.
const forceReview = `new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = new URL("theme/modules/review.js", bh.siteRoot).href;
  s.onload = resolve; s.onerror = reject;
  document.head.append(s);
}).then(() => bh.review.toggle()).then(() => new Promise((r) => setTimeout(r, 200)))`;
// A draft this browser holds for a page, which on a public page loads the module on every visit.
const storeDraft = (doc: string) => `localStorage.setItem("bh-review/v1/local/${doc}", JSON.stringify({ reviewer: "", comments: [{ id: "c-1", kind: "comment", created: "2026-11-18T00:00:00Z", body: "A draft", target: { anchor: null, anchorKind: "top", quote: { exact: "x", prefix: "", suffix: "" } } }] }))`;
// Fault injections: an older shell that never sets the flag, and a tab whose storage keeps no sealed key.
const noFlag = `Object.defineProperty(window, "bhSealed", { configurable: false, get: () => undefined, set: () => {} });`;
const noSealedKey = `{ const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).startsWith("bh-sealed-key:")) return; return set.call(this, k, v); }; }`;

test("a decrypted private page offers no review, by any route, and a public page still does", { skip, timeout: 240000 }, async (t) => {
  const s = site(t);
  s.newPrivate("solo-note", "Solo note");
  assert.equal(s.run(["new", "explainer", "open-note", "Open note", "About Open note"]).code, 0);
  assert.equal(s.run(["seal"]).code, 0);
  assert.equal(s.run(["index"]).code, 0);
  assert.match(s.read("docs/solo-note.html"), /window\.bhSealed = true;\s*document\.open\(\);/, "the shell sets the flag just before it writes the page in");
  const key = s.field("beautiful-html private page: solo-note", "password")!;

  const server = await serveStatic(s.root);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${portOf(server)}/`;
  const chrome = await launchChrome();
  t.after(() => chrome.close());
  const tab = async (opts?: TabOptions) => { const x = await openTab(chrome, opts); t.after(() => x.close()); return x; };
  const sealed = (search = "") => `${base}docs/solo-note.html${search}#k=${key}`;
  const opened = async (p: Awaited<ReturnType<typeof tab>>) => assert.equal(await p.evaluate("document.querySelector('h1')?.textContent"), "Solo note", "the page decrypted");
  const none = { button: false, topbarReview: false, reviewing: false, ui: false, inbox: false, module: false, off: true };

  await t.test("the control: a public page has the button, ?review, stored drafts and the panel's instruction", async () => {
    const p = await tab();
    await p.goto(`${base}docs/open-note.html`);
    assert.deepEqual(await p.evaluate(reviewState), { button: true, topbarReview: true, reviewing: false, ui: false, inbox: false, module: false, off: false });
    const q = await tab();
    await q.goto(`${base}docs/open-note.html?review`);
    const on = await q.evaluate(reviewState);
    assert.equal(on.reviewing, true);
    assert.equal(on.inbox, true, "the panel says to add the file to reviews/inbox/");
    const r = await tab();
    await r.goto(`${base}docs/open-note.html`);
    await r.evaluate(storeDraft("docs/open-note.html"));
    await r.goto(`${base}docs/open-note.html`);
    assert.equal((await r.evaluate(reviewState)).module, true, "a stored draft loads the module");
  });

  await t.test("opened by its link: no button, and the module is never loaded", async () => {
    const p = await tab();
    await p.goto(sealed());
    await opened(p);
    assert.equal(await p.evaluate("window.bhSealed"), true);
    assert.deepEqual(await p.evaluate(reviewState), none);
    assert.deepEqual(await p.evaluate("window.__errors"), []);
  });

  await t.test("?review, a stored draft and the module's own toggle do not open review mode", async () => {
    const p = await tab();
    await p.goto(sealed("?review"));
    await opened(p);
    assert.equal(await p.evaluate("location.search"), "?review", "the shell kept ?review");
    assert.deepEqual(await p.evaluate(reviewState), none);
    const q = await tab();
    await q.goto(sealed());
    await q.evaluate(storeDraft("docs/solo-note.html"));
    await q.goto(sealed());
    await opened(q);
    assert.deepEqual(await q.evaluate(reviewState), none);
    await q.evaluate(forceReview);
    assert.deepEqual(await q.evaluate(reviewState), { ...none, module: true }, "toggle() builds no panel");
    assert.deepEqual(await q.evaluate("window.__errors"), []);
  });

  await t.test("the local plaintext has no review either", async () => {
    const p = await tab();
    await p.goto(`${base}docs/solo-note.private.html?review`);
    assert.equal(await p.evaluate("document.querySelector('h1')?.textContent"), "Solo note");
    assert.deepEqual(await p.evaluate(reviewState), none);
  });

  await t.test("either signal alone turns review off, and with neither the button is back", async () => {
    // An older shell (no flag): the key it keeps for this path in the tab still tells.
    const p = await tab({ init: noFlag });
    await p.goto(sealed("?review"));
    await opened(p);
    assert.equal(await p.evaluate("window.bhSealed"), undefined, "the flag was suppressed");
    assert.notEqual(await p.evaluate("sessionStorage.getItem('bh-sealed-key:/docs/solo-note.html')"), null);
    assert.deepEqual(await p.evaluate(reviewState), none);
    // Storage that keeps nothing: the flag alone.
    const q = await tab({ init: noSealedKey });
    await q.goto(sealed("?review"));
    await opened(q);
    assert.equal(await q.evaluate("sessionStorage.getItem('bh-sealed-key:/docs/solo-note.html')"), null, "the key was not stored");
    assert.equal(await q.evaluate("window.bhSealed"), true);
    assert.deepEqual(await q.evaluate(reviewState), none);
    // Both suppressed: the decrypted page looks public to the theme, and review comes back. So the checks above test the signals.
    const r = await tab({ init: noFlag + noSealedKey });
    await r.goto(sealed("?review"));
    await opened(r);
    const back = await r.evaluate(reviewState);
    assert.equal(back.button, true);
    assert.equal(back.reviewing, true);
    assert.equal(back.inbox, true);
  });
});
