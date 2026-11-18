// "Changes since a commit" on a live page (theme/modules/diff.js), in a real Chrome: a small page
// made from the explainer template, served with the diff data that scripts/page-diff.mts writes
// for it. Skipped without Chrome (and without the global WebSocket, Node >= 22, that
// scripts/chrome.mts drives it with).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { findChrome, launchChrome, serveStatic, sleep, type ChromeHandle } from "../scripts/chrome.mts";
import { diffPages, diffData, diffScript } from "../scripts/page-diff.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;

const BASE = "b".repeat(40), HEAD = "c".repeat(40), UNKNOWN = "1".repeat(40);
const PAGE = "docs/post.html";

const figure = (x: number, extra = "") => `<figure class="diagram wide" id="flow">
      <svg viewBox="-16 -16 432 112" role="img" aria-label="A client calls a service">
        <g class="node c3" data-id="client"><rect x="0" y="12" width="130" height="56" rx="10"/><text x="65" y="40">Client</text></g>
        <g class="node c1" data-id="service"><rect x="${x}" y="12" width="130" height="56" rx="10"/><text x="${x + 65}" y="40">Service</text></g>
        <path class="edge" data-id="call" d="M130 40 H${x - 11}"/>${extra}
      </svg>
      <figcaption>The client calls the service.</figcaption>
    </figure>`;
const stepper = (first: string) => `<bh-stepper for="flow">
      <bh-step highlight="client call"><p>${first}</p></bh-step>
      <bh-step highlight="service"><p>The service answers.</p></bh-step>
    </bh-stepper>`;

// The old version: what a reviewer saw at BASE.
const OLD = `
    <h2 id="alpha">Alpha</h2>
    <p>The limiter refills its bucket on a timer, so an idle client still costs a tick.</p>
    <p>This paragraph is going away, and it holds the quoted phrase about spare tokens.</p>
    ${figure(250)}
    ${stepper("First, the client sends one request.")}
    <h2 id="beta">Beta</h2>
    <p>A sentence that stays exactly as it was in both versions.</p>
    <p>A burst is allowed while the bucket still holds enough tokens for it.</p>`;
// The new version: a reworded paragraph (found by position), a removed one, a redrawn figure (found by
// id), a reworded step inside a component, and an added paragraph.
const NEW = `
    <h2 id="alpha">Alpha</h2>
    <p>The limiter refills its bucket lazily, so an idle client costs nothing.</p>
    ${figure(270)}
    ${stepper("First, the client sends a single request.")}
    <h2 id="beta">Beta</h2>
    <p>A sentence that stays exactly as it was in both versions.</p>
    <p>A burst is allowed while the bucket still holds enough tokens to cover it.</p>
    <p>A brand new closing paragraph.</p>`;

// Page CSS scoped by the figure's id, different in each version: a copy needs its own version's.
const CSS = (width: number) => `#flow .node.c1 rect { stroke-width: ${width}px; }`;

function pageOf(content: string, css: string): string {
  const template = fs.readFileSync(path.join(ROOT, "templates/explainer.html"), "utf8")
    .replaceAll("{{title}}", "A page under review").replaceAll("{{description}}", "A fixture for the diff module.")
    .replaceAll("{{date}}", "2026-11-18").replaceAll("{{author}}", "Tester");
  const hero = template.match(/<header class="bh-hero">[\s\S]*?<\/header>/)![0];
  return template.replace("</head>", `  <style>${css}</style>\n</head>`)
    .replace(/(<article class="bh-article">)[\s\S]*(<\/article>)/, (_m, open, close) => `${open}\n    ${hero}\n${content}\n  ${close}`);
}

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address !== "string", "the server is listening");
  return address.port;
}

async function openTab(chrome: ChromeHandle, { width = 1100, height = 900, mobile = false } = {}) {
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
    addEventListener("unhandledrejection", (e) => window.__errors.push(String(e.reason)));` });
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
  return { evaluate, goto, close: () => chrome.send("Target.closeTarget", { targetId }).catch(() => {}) };
}

// What the page shows: each mark with its status and the block it sits before.
// (Two marks can sit before one block: a removed block's, and the change to the block after it.)
const BLOCK_AFTER = `const blockAfter = (m) => { let n = m.nextElementSibling; while (n && n.matches(".bh-diff-mark")) n = n.nextElementSibling; return n; };`;
const MARKS = `(() => { ${BLOCK_AFTER} return [...document.querySelectorAll(".bh-article > .bh-diff-mark")].map((m) => {
  const next = blockAfter(m);
  return [m.dataset.diff, next.localName + (next.id ? "#" + next.id : ""), next.getAttribute("data-diff") || ""];
}); })()`;
const SHOW = (opts: string) => `(async () => { await bh.loadModule("diff.js"); return await bh.diff.show("${BASE}", ${opts}); })()`;
const OPEN = `(() => { ${BLOCK_AFTER} return [...document.querySelectorAll("details.bh-diff-mark[open]")].map((m) => m.dataset.diff + ":" + blockAfter(m).localName); })()`;

test("the diff module marks a live page with what changed since a commit", { skip, timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-diff-browser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(ROOT, "theme"), path.join(root, "theme"), { recursive: true });
  fs.rmSync(path.join(root, "theme/build.js"), { force: true }); // a build stamp `serve` may have left; the route below is the one
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>Home</title>");
  const oldHtml = pageOf(OLD, CSS(7)), newHtml = pageOf(NEW, CSS(3));
  fs.writeFileSync(path.join(root, PAGE), newHtml);
  const diff = diffPages(oldHtml, newHtml);
  assert.ok(diff);
  const data = diffData(diff, BASE);
  assert.deepEqual(data.changes.map((c) => c.status), ["changed", "removed", "changed", "changed", "changed", "added"], "the fixture's differences");

  const js = (body: string) => ({ type: "text/javascript", body });
  const server = await serveStatic(root, new Map([
    ["/theme/build.js", js(`window.BH_BUILD = ${JSON.stringify({ repo: "example/blog", commit: HEAD, dirty: false, builtAt: "2026-11-18T00:00:00Z" })};`)],
    [`/theme/diffs/post.${BASE}.js`, js(diffScript(PAGE, data))],
  ]));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${portOf(server)}/`;
  const chrome = await launchChrome();
  t.after(() => chrome.close());
  const tab = async (opts?: { width?: number; height?: number; mobile?: boolean }) => { const x = await openTab(chrome, opts); t.after(() => x.close()); return x; };
  const noErrors = async (p: Awaited<ReturnType<typeof tab>>) => assert.deepEqual(await p.evaluate("window.__errors"), []);

  await t.test("without ?diff the page is untouched and asks for no diff data", async () => {
    const p = await tab();
    await p.goto(base + PAGE);
    assert.equal(await p.evaluate("document.querySelectorAll('.bh-diff-ui, [data-diff]').length"), 0);
    assert.equal(await p.evaluate("performance.getEntriesByType('resource').some((r) => /theme\\/(diffs|modules\\/diff)/.test(r.name))"), false);
    await noErrors(p);
  });

  await t.test("?diff=<commit>: a mark before every block that differs, found by id, by position, and inside a component", async () => {
    const p = await tab();
    await p.goto(`${base}${PAGE}?diff=${BASE}`);
    assert.deepEqual(await p.evaluate(MARKS), [
      ["changed", "p", "changed"],          // the reworded paragraph: no id, found by position and text
      ["removed", "figure#flow", "changed"], // the removed paragraph's mark sits where it used to be
      ["changed", "figure#flow", "changed"], // found by id
      ["changed", "bh-stepper", "changed"],  // its live text starts with its own controls
      ["changed", "p", "changed"],
      ["added", "p", "added"],
    ]);
    assert.equal(await p.evaluate("document.querySelector('.bh-article > p[data-diff=changed]').textContent"), "The limiter refills its bucket lazily, so an idle client costs nothing.", "the live text is not rewritten");
    assert.match(await p.evaluate("document.querySelector('details.bh-diff-mark[data-diff=changed] .bh-diff-copy').innerHTML"), /<del>on a timer<\/del><ins>lazily<\/ins>/);
    assert.match(await p.evaluate("document.querySelector('.bh-diff-bar').textContent"), /^Changes since bbbbbbb: 4 changed, 1 added, 1 removed/);
    assert.equal(await p.evaluate("document.querySelectorAll('details.bh-diff-mark[open]').length"), 0, "marks start collapsed");
    // The redrawn figure is a before/after pair, drawn by the same component as the page's own, with the moved part marked.
    assert.equal(await p.evaluate("document.querySelector('.bh-diff-ui bh-versions').classList.contains('is-ready')"), true);
    assert.deepEqual(await p.evaluate("[...document.querySelectorAll('.bh-diff-ui bh-versions [role=tab]')].map((b) => b.textContent)"), ["Before", "After"]);
    assert.deepEqual(await p.evaluate("[...document.querySelectorAll('.bh-diff-ui bh-versions .bh-diff-side')[1].querySelectorAll('[data-change]')].map((n) => n.dataset.id + ':' + n.dataset.change)"), ["service:changed", "call:changed"]);
    assert.equal(await p.evaluate("document.querySelectorAll('#flow').length"), 1, "a copy never repeats the live figure's id");
    // The figure is styled by id, so each side is drawn in a shadow tree with its own version's page CSS.
    const side = (n: number, what: string) => `(() => { const root = document.querySelectorAll(".bh-diff-ui bh-versions .bh-diff-side > .bh-diff-shadow")[${n}].shadowRoot; return ${what}; })()`;
    const stroke = `getComputedStyle(root.querySelector("#flow .node.c1 rect")).strokeWidth`;
    assert.deepEqual([await p.evaluate(side(0, stroke)), await p.evaluate(side(1, stroke)), await p.evaluate(`getComputedStyle(document.querySelector("#flow .node.c1 rect")).strokeWidth`)], ["7px", "3px", "3px"], "old CSS on the old copy, the page's on the new copy and on the page");
    assert.equal(await p.evaluate(side(0, `getComputedStyle(root.querySelector(".node.c3 rect")).fill !== "rgb(0, 0, 0)"`)), true, "the theme reaches the copy too");
    assert.equal(await p.evaluate(side(0, `!!root.querySelector("#bh-arrow") && getComputedStyle(root.querySelector(".edge")).markerEnd.includes("bh-arrow")`)), true, "arrowheads resolve inside the tree");
    assert.equal(await p.evaluate(side(0, `root.querySelector("figcaption").textContent`)), "The client calls the service.");
    assert.equal(await p.evaluate(`getComputedStyle(document.querySelector(".bh-diff-ui bh-versions .bh-versions-caption")).display`), "none", "the pair's shared caption would repeat it");
    // The copies obey the change-highlight switches, though a shadow tree cannot see its ancestors.
    const calm = (what: string) => `new Promise((r) => setTimeout(r, 400)).then(() => ${what})`; // let a stroke transition end
    const mark = side(1, `[...root.querySelectorAll("[data-change]")].map((n) => { const s = getComputedStyle(n.matches(".node") ? n.querySelector("rect") : n); return s.stroke + " " + s.strokeDasharray; }).join(" | ")`);
    const lit = await p.evaluate(calm(mark));
    assert.equal(await p.evaluate("document.querySelector('.bh-diff-ui bh-versions .bh-versions-changes').getAttribute('aria-pressed')"), "true", "the pair has its own button");
    await p.evaluate("document.querySelector('.bh-diff-ui bh-versions .bh-versions-changes').click()");
    const plain = await p.evaluate(calm(mark));
    assert.notEqual(plain, lit, "the pair's button turns the marks off inside the shadow tree");
    await p.evaluate("document.querySelector('.bh-diff-ui bh-versions .bh-versions-changes').click()");
    assert.equal(await p.evaluate(calm(mark)), lit, "and on again");
    await p.evaluate("document.documentElement.setAttribute('data-changes', 'off')");
    assert.equal(await p.evaluate(calm(mark)), plain, "the page's switch reaches the tree too");
    await p.evaluate("document.documentElement.removeAttribute('data-changes')");
    assert.equal(await p.evaluate(calm(mark)), lit);
    // Expand all, and step through the changes.
    await p.evaluate("document.querySelector('.bh-diff-bar [data-expand]').click()");
    assert.equal(await p.evaluate("document.querySelectorAll('details.bh-diff-mark:not([open])').length"), 0);
    await p.evaluate("[...document.querySelectorAll('.bh-diff-bar button')].find((b) => b.textContent === 'Next').click()");
    assert.equal(await p.evaluate("document.activeElement.closest('.bh-diff-mark') === document.querySelector('.bh-diff-mark')"), true, "Next goes to the first change and focuses it");
    // The page's own stepper still works: its content was never touched.
    assert.equal(await p.evaluate("document.querySelector('.bh-article > bh-stepper bh-step p').textContent"), "First, the client sends a single request.");
    await noErrors(p);
  });

  await t.test("a comment's quote opens the change that held it; a section opens the changes under that heading; hide undoes everything", async () => {
    const p = await tab();
    await p.goto(base + PAGE);
    // The outdated-thread case: the quoted text is gone from the page, and the removed block held it.
    assert.deepEqual(await p.evaluate(SHOW(`{ section: "alpha", quote: "the quoted phrase about spare tokens" }`)), { base: BASE, total: 6, here: 1 });
    assert.deepEqual(await p.evaluate(OPEN), ["removed:figure"]);
    assert.equal(await p.evaluate("document.activeElement === document.querySelector('details.bh-diff-mark[data-diff=removed] > summary')"), true);
    // A quote the page still has says nothing about where to look: the section does.
    assert.deepEqual(await p.evaluate(SHOW(`{ section: "beta", quote: "not anywhere in the old text" }`)), { base: BASE, total: 6, here: 2 });
    assert.deepEqual(await p.evaluate(OPEN), ["changed:p"], "the added paragraph's mark has nothing to open");
    // A block's id (a comment on the figure) finds that block's own change and its section's.
    assert.equal((await p.evaluate(SHOW(`{ section: "flow" }`))).here, 4);
    assert.equal((await p.evaluate(SHOW(`{}`))).here, 0);
    await p.evaluate("bh.diff.hide()");
    assert.equal(await p.evaluate("document.querySelectorAll('.bh-diff-ui, [data-diff], .bh-diff-bar').length"), 0);
    assert.equal(await p.evaluate("bh.diff.base"), null);
    await noErrors(p);
  });

  await t.test("an unknown commit, or a malformed one, says there is no record and changes nothing", async () => {
    const p = await tab();
    await p.goto(`${base}${PAGE}?diff=${UNKNOWN}`);
    assert.equal(await p.evaluate("document.querySelector('.bh-toast').textContent"), "No record of the changes since that version");
    assert.equal(await p.evaluate("document.querySelectorAll('.bh-diff-ui, [data-diff]').length"), 0);
    assert.equal(await p.evaluate(`(async () => { await bh.loadModule("diff.js"); return await bh.diff.show("HEAD~1"); })()`), null);
    assert.equal(await p.evaluate("performance.getEntriesByType('resource').some((r) => /HEAD/.test(r.name))"), false, "a malformed commit is never requested");
    await p.goto(`${base}${PAGE}?diff=HEAD`);
    assert.equal(await p.evaluate("performance.getEntriesByType('resource').some((r) => /modules\\/diff/.test(r.name))"), false, "?diff with a malformed commit does not even load the module");
    await noErrors(p);
  });

  await t.test("in review: a thread written on the old commit offers its changes, the panel follows, and comments stay anchored", async () => {
    const p = await tab({ width: 1400 });
    await p.goto(base + PAGE);
    const comment = (id: string, commit: string, exact: string) => ({ id, created: "2026-11-01T09:00:00Z", commit, dirty: false, author: "Rae", kind: "comment", body: `About ${id}`,
      target: { anchor: "alpha", anchorKind: "section", quote: { exact, prefix: "", suffix: "" }, position: null } });
    const drafts = { reviewer: "Rae", comments: [comment("c-gone", BASE, "the quoted phrase about spare tokens"), comment("c-here", BASE, "an idle client costs nothing"), comment("c-now", HEAD, "refills its bucket lazily")] };
    await p.evaluate(`localStorage.setItem("bh-review/v1/example/blog/${PAGE}", ${JSON.stringify(JSON.stringify(drafts))})`);
    await p.goto(`${base}${PAGE}?review`);
    const outdated = "bh.review.file().comments.map((c) => c.id + ':' + c.outdated)";
    assert.deepEqual(await p.evaluate(outdated), ["c-gone:true", "c-here:false", "c-now:false"]);
    assert.deepEqual(await p.evaluate("[...document.querySelectorAll('.bh-review-since-select option')].map((o) => o.value.slice(0, 7))"), ["", "bbbbbbb"], "one baseline: the commit that differs from this build");
    // The thread on the current commit has nothing to compare; the outdated one does.
    const openThread = (n: number) => `(async () => { document.querySelectorAll(".bh-review-item")[${n}].click(); await new Promise((r) => setTimeout(r, 500)); return !!document.querySelector(".bh-review-pop .bh-review-since"); })()`;
    assert.equal(await p.evaluate(openThread(2)), false);
    assert.equal(await p.evaluate(openThread(0)), true);
    await p.evaluate(`(async () => { document.querySelector(".bh-review-pop .bh-review-since").click(); for (let i = 0; i < 50 && !(window.bh.diff && bh.diff.base); i++) await new Promise((r) => setTimeout(r, 100)); })()`);
    assert.deepEqual(await p.evaluate(OPEN), ["removed:figure"], "it opens where the quoted text used to be");
    assert.equal(await p.evaluate("document.querySelector('.bh-toast').textContent"), "1 change here since this comment");
    assert.equal(await p.evaluate("document.querySelector('.bh-review-since-select').value"), BASE, "the panel shows what the page shows");
    // Marks are not document text: comments are found exactly where they were, with every copy expanded.
    await p.evaluate("document.querySelector('.bh-diff-bar [data-expand]').click(); bh.review.relocate()");
    assert.deepEqual(await p.evaluate(outdated), ["c-gone:true", "c-here:false", "c-now:false"], "a quote is never matched inside an old copy, and live text is still matched");
    await p.evaluate(`(() => { const s = document.querySelector(".bh-review-since-select"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
    assert.equal(await p.evaluate("document.querySelectorAll('.bh-diff-ui, [data-diff]').length"), 0, "Off removes the marks");
    await p.evaluate(`localStorage.clear()`);
    await noErrors(p);
  });

  await t.test("at phone width nothing overflows with every change expanded", async () => {
    const p = await tab({ width: 390, height: 844, mobile: true });
    await p.goto(`${base}${PAGE}?diff=${BASE}`);
    await p.evaluate("document.querySelector('.bh-diff-bar [data-expand]').click()");
    await sleep(300);
    assert.deepEqual(await p.evaluate("[innerWidth, document.documentElement.scrollWidth <= 390]"), [390, true], "a wider layout viewport means something overflowed");
    const bar = await p.evaluate("(() => { const r = document.querySelector('.bh-diff-bar').getBoundingClientRect(); return [r.left >= 0, r.right <= 390]; })()");
    assert.deepEqual(bar, [true, true], "the bar fits the screen");
    await noErrors(p);
  });
});
