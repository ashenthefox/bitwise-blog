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
import { spawnSync } from "node:child_process";
import { findChrome, launchChrome, serveStatic, sleep, type ChromeHandle } from "../scripts/chrome.mts";
import { diffPages, diffData, diffScript } from "../scripts/page-diff.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;

const BASE = "b".repeat(40), HEAD = "c".repeat(40), UNKNOWN = "1".repeat(40);
const PAGE = "docs/post.html";
// The same page with a diagram the author marked: it has change highlights of its own, so its top
// bar has the switch for them, and the switch is off when the page opens.
const MARKED = "docs/marked.html";

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

// A part the author marked, the same in both versions.
const OWN = `
    <figure class="diagram wide" id="own">
      <svg viewBox="-16 -16 162 112" role="img" aria-label="A cache was added">
        <g class="node c2" data-id="cache" data-change="added"><rect x="0" y="12" width="130" height="56" rx="10"/><text x="65" y="40">Cache</text></g>
      </svg>
      <figcaption>The cache is new.</figcaption>
    </figure>`;

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
    // Every value the page's change-highlight switch (data-changes on <html>) takes, in order.
    window.__switch = [];
    new MutationObserver(() => {
      const now = document.documentElement.getAttribute("data-changes");
      if (!window.__switch.length || window.__switch.at(-1) !== now) window.__switch.push(now);
    }).observe(document, { attributes: true, attributeFilter: ["data-changes"], subtree: true });
    // Rendering frames (a frame callback runs just before a paint) that had a marked part in the document, and how many of those lacked the off state.
    window.__marks = { frames: 0, lit: 0 };
    (function frame() {
      if (document.querySelector("[data-change]")) {
        window.__marks.frames++;
        if (document.documentElement.getAttribute("data-changes") !== "off") window.__marks.lit++;
      }
      requestAnimationFrame(frame);
    })();
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
  /** Start loading `url` and return at once: for a response the server holds back. */
  const start = async (url: string) => { await s("Page.navigate", { url }); };
  return { evaluate, goto, start, ready, close: () => chrome.send("Target.closeTarget", { targetId }).catch(() => {}) };
}

// What the page shows: each mark with its status and the block it sits before.
// (Two marks can sit before one block: a removed block's, and the change to the block after it.)
const BLOCK_AFTER = `const blockAfter = (m) => { let n = m.nextElementSibling; while (n && n.matches(".bh-diff-mark")) n = n.nextElementSibling; return n; };`;
const MARKS = `(() => { ${BLOCK_AFTER} return [...document.querySelectorAll(".bh-article > .bh-diff-mark")].map((m) => {
  const next = blockAfter(m);
  return [m.dataset.diff, next.localName + (next.id ? "#" + next.id : ""), next.getAttribute("data-diff") || ""];
}); })()`;

/**
 * Statements that switch every transition off, in the page and in each shadow-tree copy (`trees`). A
 * computed style read while a transition runs is on its way from the old value, and a transition only
 * advances when a frame is drawn, which a busy machine may not do within any wait. So none run.
 */
const STILL = `for (const r of [document.head, ...trees]) if (!r.querySelector("style[data-still]")) {
    const s = document.createElement("style");
    s.dataset.still = ""; s.textContent = "*, *::before, *::after { transition: none !important; }";
    r.append(s);
  }`;

/**
 * The change highlights as the reader sees them: the page's switch, and for each marked part whether
 * it is drawn highlighted. A part is "lit" when its computed style differs from the same part's with
 * its data-change attribute taken away for the reading, so the attribute alone proves nothing.
 * `own` is the page's own marked figure, `copies` the parts a diff marked in its shadow-tree copies.
 */
interface Highlights { button: string | null; buttons: number; root: string | null; own: string[]; copies: string[]; trees: (string | null)[] }
const HIGHLIGHTS = `(() => {
  const trees = [...document.querySelectorAll(".bh-diff-shadow")].map((h) => h.shadowRoot).filter(Boolean);
  ${STILL}
  const looks = (n) => {
    const a = getComputedStyle(n.matches(".node") ? n.querySelector("rect") : n), b = getComputedStyle(n);
    return [a.stroke, a.strokeWidth, a.strokeDasharray, b.opacity, b.filter].join(" | ");
  };
  const part = (n) => {
    const kind = n.dataset.change, marked = looks(n);
    n.removeAttribute("data-change");
    const plain = looks(n);
    n.setAttribute("data-change", kind);
    return n.dataset.id + ":" + kind + ":" + (marked === plain ? "plain" : "lit");
  };
  const parts = (scope) => [...scope.querySelectorAll("[data-change]")].map(part);
  const buttons = document.querySelectorAll(".bh-topbar .bh-changes-btn");
  return {
    button: buttons.length ? buttons[0].getAttribute("aria-pressed") : null, buttons: buttons.length,
    root: document.documentElement.getAttribute("data-changes"),
    own: [...document.querySelectorAll("#own")].flatMap(parts),
    copies: trees.flatMap(parts),
    trees: trees.map((r) => r.querySelector(".bh-article").getAttribute("data-changes")),
  };
})()`;
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
  const oldMarked = pageOf(OLD + OWN, CSS(7)), newMarked = pageOf(NEW + OWN, CSS(3));
  fs.writeFileSync(path.join(root, MARKED), newMarked);
  const markedDiff = diffPages(oldMarked, newMarked);
  const diff = diffPages(oldHtml, newHtml);
  assert.ok(diff && markedDiff);
  const data = diffData(diff, BASE);
  assert.deepEqual(data.changes.map((c) => c.status), ["changed", "removed", "changed", "changed", "changed", "added"], "the fixture's differences");

  const js = (body: string) => ({ type: "text/javascript", body });
  const server = await serveStatic(root, new Map([
    ["/theme/build.js", js(`window.BH_BUILD = ${JSON.stringify({ repo: "example/blog", commit: HEAD, dirty: false, builtAt: "2026-11-18T00:00:00Z" })};`)],
    [`/theme/diffs/post.${BASE}.js`, js(diffScript(PAGE, data))],
    [`/theme/diffs/marked.${BASE}.js`, js(diffScript(MARKED, diffData(markedDiff, BASE)))],
  ]));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  // /slow/<file> is a slow connection: it sends <file> as far as the end of <main>, and the rest (in a
  // bundle, the scripts at the end of <body>) only when `release` is called.
  let release = () => {};
  t.after(() => release());
  const serve = server.listeners("request")[0] as (req: http.IncomingMessage, res: http.ServerResponse) => void;
  server.removeAllListeners("request");
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url || "";
    if (!url.startsWith("/slow/")) { serve(req, res); return; }
    const html = fs.readFileSync(path.join(root, url.slice("/slow/".length)), "utf8"), cut = html.indexOf("</main>");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.write(html.slice(0, cut));
    const before = release;
    release = () => { before(); res.end(html.slice(cut)); };
  });
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
    // No transition runs while these are read (STILL), so each read is the settled style: no wait is needed.
    await p.evaluate(`(() => { const trees = [...document.querySelectorAll(".bh-diff-shadow")].map((h) => h.shadowRoot).filter(Boolean); ${STILL} })()`);
    const mark = side(1, `[...root.querySelectorAll("[data-change]")].map((n) => { const s = getComputedStyle(n.matches(".node") ? n.querySelector("rect") : n); return s.stroke + " " + s.strokeDasharray; }).join(" | ")`);
    const lit = await p.evaluate(mark);
    assert.equal(await p.evaluate("document.querySelector('.bh-diff-ui bh-versions .bh-versions-changes').getAttribute('aria-pressed')"), "true", "the pair has its own button");
    await p.evaluate("document.querySelector('.bh-diff-ui bh-versions .bh-versions-changes').click()");
    const plain = await p.evaluate(mark);
    assert.notEqual(plain, lit, "the pair's button turns the marks off inside the shadow tree");
    await p.evaluate("document.querySelector('.bh-diff-ui bh-versions .bh-versions-changes').click()");
    assert.equal(await p.evaluate(mark), lit, "and on again");
    await p.evaluate("document.documentElement.setAttribute('data-changes', 'off')");
    assert.equal(await p.evaluate(mark), plain, "the page's switch reaches the tree too");
    await p.evaluate("document.documentElement.removeAttribute('data-changes')");
    assert.equal(await p.evaluate(mark), lit);
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

  const highlights = async (p: Awaited<ReturnType<typeof tab>>): Promise<Highlights> => await p.evaluate(HIGHLIGHTS);
  // What the fixture's redrawn figure marks in its "After" copy (the "Before" copy has no part that
  // is gone), and the page's own marked part.
  const COPIES = ["service:changed", "call:changed"];
  const lit = (list: string[]) => list.map((x) => x + ":lit"), plain = (list: string[]) => list.map((x) => x + ":plain");
  const OWN_PART = ["cache:added"];
  /** Wait until a page whose response is held back has painted its marked parts, on at least three frames. */
  const painted = async (p: Awaited<ReturnType<typeof tab>>) => {
    for (let i = 0; i < 150; i++) {
      if (await p.evaluate(`document.readyState === "loading" && performance.getEntriesByType("paint").length > 0 && window.__marks.frames >= 3`).catch(() => false)) return;
      await sleep(100);
    }
    assert.fail("the held page never painted its marked parts");
  };

  await t.test("?diff=<commit> on a page with marked parts of its own: the page's switch goes from off to on, and every mark is drawn", async () => {
    const p = await tab();
    // Without a diff the page opens with its switch off: the marked part is drawn like any other.
    await p.goto(base + MARKED);
    assert.deepEqual(await highlights(p), { button: "false", buttons: 1, root: "off", own: plain(OWN_PART), copies: [], trees: [] });
    assert.deepEqual(await p.evaluate("window.__switch"), ["off"]);
    // With one, the switch starts off like on any page, and placing the changed diagram turns it on.
    await p.goto(`${base}${MARKED}?diff=${BASE}`);
    assert.deepEqual(await p.evaluate("window.__switch"), ["off", null], "off when the page opened, then on");
    assert.deepEqual(await highlights(p), { button: "true", buttons: 1, root: null, own: lit(OWN_PART), copies: lit(COPIES), trees: [null, null] });
    // It is still the reader's switch: off again takes the marks away, in the copies too.
    await p.evaluate("document.querySelector('.bh-topbar .bh-changes-btn').click()");
    assert.deepEqual(await highlights(p), { button: "false", buttons: 1, root: "off", own: plain(OWN_PART), copies: plain(COPIES), trees: ["off", "off"] });
    await noErrors(p);
  });

  await t.test("a page with no marked part gets the page's switch, on, when a diff brings a marked diagram, and loses it with the diff", async () => {
    const p = await tab();
    await p.goto(base + PAGE);
    const none = { button: null, buttons: 0, root: null, own: [], copies: [], trees: [] };
    assert.deepEqual(await highlights(p), none, "no marks, so no switch");
    await p.evaluate(SHOW("{}"));
    assert.deepEqual(await highlights(p), { button: "true", buttons: 1, root: null, own: [], copies: lit(COPIES), trees: [null, null] });
    const actions = `[...document.querySelector(".bh-topbar-actions").children].map((b) => b.className.split(" ").find((c) => c.startsWith("bh-")) || "")`;
    assert.deepEqual((await p.evaluate(actions)).slice(0, 3), ["bh-search-btn", "bh-changes-btn", "bh-review-btn"], "where a page with marks of its own has it");
    // It is the page's switch like any other: it reaches the copies in their shadow trees.
    await p.evaluate("document.querySelector('.bh-topbar .bh-changes-btn').click()");
    assert.deepEqual(await highlights(p), { button: "false", buttons: 1, root: "off", own: [], copies: plain(COPIES), trees: ["off", "off"] });
    // With the diff gone nothing is marked, so the switch goes too. It goes while off and focused here:
    // the page is not left off with no control, and focus goes to the control beside it, not to <body>.
    await p.evaluate("document.querySelector('.bh-topbar .bh-changes-btn').focus(); bh.diff.hide()");
    assert.deepEqual(await highlights(p), none);
    assert.equal(await p.evaluate("document.activeElement.className"), await p.evaluate("document.querySelector('.bh-topbar .bh-review-btn').className"), "focus is on the next top-bar control");
    // Nothing brings the off state back: not leaving the slides, not printing, not a script. A part marked later is drawn marked.
    const later = await p.evaluate(`(async () => {
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const root = document.documentElement, seen = [];
      root.classList.add("bh-presenting"); await tick();
      root.classList.remove("bh-presenting"); await tick();
      seen.push(root.getAttribute("data-changes"));
      window.dispatchEvent(new Event("beforeprint")); window.dispatchEvent(new Event("afterprint")); await tick();
      seen.push(root.getAttribute("data-changes"));
      // Nor a script that writes the attribute: the button follows it only while it is in the page.
      root.setAttribute("data-changes", "off"); await tick(); await tick();
      seen.push(root.getAttribute("data-changes"));
      const node = document.querySelector('#flow [data-id="service"]'), rect = node.querySelector("rect");
      const before = getComputedStyle(rect).stroke;
      node.setAttribute("data-change", "added");
      seen.push(getComputedStyle(rect).stroke !== before);
      node.removeAttribute("data-change");
      return seen;
    })()`);
    assert.deepEqual(later, [null, null, null, true]);
    // The next diff brings the switch back, on.
    await p.evaluate(SHOW("{}"));
    assert.deepEqual(await highlights(p), { button: "true", buttons: 1, root: null, own: [], copies: lit(COPIES), trees: [null, null] });
    await p.evaluate(SHOW("{}"));
    assert.equal((await highlights(p)).buttons, 1, "showing a diff again does not add a second switch");
    await noErrors(p);
  });

  await t.test("a generated diff page (npm run diff) opens with the highlights on", async () => {
    // The real command, on a repository whose HEAD holds the old page and whose working tree holds the new one.
    for (const entry of ["scripts", "package.json"]) fs.cpSync(path.join(ROOT, entry), path.join(root, entry), { recursive: true });
    const git = (...args: string[]) => spawnSync("git", ["-C", root, "-c", "user.name=T", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", timeout: 30_000 });
    fs.writeFileSync(path.join(root, MARKED), oldMarked);
    fs.writeFileSync(path.join(root, PAGE), oldHtml);
    for (const args of [["init", "-q"], ["add", MARKED, PAGE], ["commit", "-q", "-m", "old"]]) {
      const r = git(...args);
      assert.equal(r.status, 0, `git ${args[0]}: ${r.stderr}`);
    }
    fs.writeFileSync(path.join(root, MARKED), newMarked);
    fs.writeFileSync(path.join(root, PAGE), newHtml);
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("BH_")) delete env[key];
    // With marks of its own, and with none: there the diff's marked diagram is all that gives the page its switch.
    for (const [page, own] of [[MARKED, OWN_PART], [PAGE, []]] as const) {
      const made = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "diff", page], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
      assert.equal(made.status, 0, made.stdout + made.stderr);
      const out = "dist/diff/" + path.basename(page);
      const html = fs.readFileSync(path.join(root, out), "utf8");
      assert.match(html, /<html\b[^>]*\sdata-bh-diff[\s>]/, "the page says it is a diff, where a script in <head> can read it");
      assert.match(html, /<bh-versions\b/, "the redrawn figure is a before/after pair");

      const p = await tab();
      await p.goto(base + out);
      assert.deepEqual(await p.evaluate("window.__switch"), [], `${page}: the switch was never off`);
      assert.deepEqual(await highlights(p), { button: "true", buttons: 1, root: null, own: lit([...own]), copies: lit(COPIES), trees: [null, null] }, page);
      // The switch still works there.
      await p.evaluate("document.querySelector('.bh-topbar .bh-changes-btn').click()");
      assert.deepEqual(await highlights(p), { button: "false", buttons: 1, root: "off", own: plain([...own]), copies: plain(COPIES), trees: ["off", "off"] }, page);
      await noErrors(p);

      // Arriving slowly, it paints before the scripts at the end of its body run, and is never off.
      const slow = await tab();
      await slow.start(base + "slow/" + out);
      await painted(slow);
      assert.deepEqual(await slow.evaluate(`[typeof window.bh, typeof window.bhChanges, window.bhChanges && window.bhChanges.startsOn(), document.documentElement.getAttribute("data-changes")]`), ["undefined", "object", true, null], `${page}: the head script has run, and left the highlights on`);
      if (own.length) assert.deepEqual((await highlights(slow)).own, lit([...own]), `${page}: its own marks show while it loads`);
      release();
      await slow.ready();
      assert.deepEqual(await slow.evaluate("window.__switch"), [], `${page}: arriving slowly, the switch was never off`);
      assert.deepEqual(await highlights(slow), { button: "true", buttons: 1, root: null, own: lit([...own]), copies: lit(COPIES), trees: [null, null] }, page);
      await noErrors(slow);
    }
  });

  await t.test("a bundle (npm run bundle) that arrives slowly never paints its highlights before the off state", async () => {
    // Made by the real command, in the repository the test above set up.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("BH_")) delete env[key];
    const made = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "bundle", MARKED], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
    assert.equal(made.status, 0, made.stdout + made.stderr);
    const out = "dist/" + path.basename(MARKED);
    const html = fs.readFileSync(path.join(root, out), "utf8"), head = html.slice(0, html.indexOf("</head>")), body = html.slice(html.indexOf("</main>"));
    assert.ok(html.slice(html.indexOf("</head>"), html.indexOf("</main>")).includes('data-change="added"'), "the marked part arrives before the held part");

    const slow = await tab();
    await slow.start(base + "slow/" + out);
    await painted(slow);
    assert.deepEqual(await slow.evaluate(`[document.readyState, typeof window.bh, document.documentElement.getAttribute("data-changes"), window.bhExamples.source, window.bhUnlisted.source]`), ["loading", "undefined", "off", "bundle", "bundle"], "the head scripts ran before the body arrived");
    assert.deepEqual((await highlights(slow)).own, plain(OWN_PART), "the marked part is drawn plain while the rest is on its way");
    assert.equal((await slow.evaluate("window.__marks")).lit, 0, "no frame so far had a marked part without the off state");
    release();
    await slow.ready();
    const frames = await slow.evaluate("window.__marks");
    assert.ok(frames.frames >= 3, "frames were counted");
    assert.equal(frames.lit, 0, "nor any frame since");
    assert.deepEqual(await slow.evaluate("[window.__switch, window.bhChanges.settled]"), [["off"], true]);
    assert.deepEqual(await highlights(slow), { button: "false", buttons: 1, root: "off", own: plain(OWN_PART), copies: [], trees: [] });
    await noErrors(slow);

    assert.doesNotMatch(html, /<script\b[^>]*\ssrc=/, "every script is inline");
    // The synchronous head scripts stay in <head>, in their order; bh.js, which the page defers, goes to the end of <body>.
    const marks = ["bh-theme", "g.bhExamples = api", "g.bhUnlisted = api", "g.bhChanges = api"].map((text) => head.indexOf(text));
    assert.ok(marks.every((at, i) => at > 0 && (i === 0 || at > marks[i - 1]!)), `the head scripts are in <head>, in order (${marks})`);
    assert.ok(!head.includes("window.bhModules") && body.includes("window.bhModules") && !body.includes("g.bhChanges = api"), "bh.js and its modules are at the end of <body>, and the head scripts are not there again");

    // Opened whole, as from disk: the same page, and its switch works.
    const p = await tab();
    await p.goto(base + out);
    assert.deepEqual(await p.evaluate("[window.__switch, window.__marks.lit, window.bhExamples.source, window.bhUnlisted.source]"), [["off"], 0, "bundle", "bundle"]);
    assert.deepEqual(await highlights(p), { button: "false", buttons: 1, root: "off", own: plain(OWN_PART), copies: [], trees: [] });
    await p.evaluate("document.querySelector('.bh-topbar .bh-changes-btn').click()");
    assert.deepEqual(await highlights(p), { button: "true", buttons: 1, root: null, own: lit(OWN_PART), copies: [], trees: [] });
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
    // This page marks nothing itself, so the top bar's switch was built when ?diff= placed the changed diagram.
    const button = await p.evaluate("(() => { const b = document.querySelector('.bh-topbar .bh-changes-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return [b.getAttribute('aria-pressed'), r.width > 0 && r.left >= 0 && r.right <= 390]; })()");
    assert.deepEqual(button, ["true", true], "the page's switch is there, on, and inside the screen");
    await noErrors(p);
  });
});
