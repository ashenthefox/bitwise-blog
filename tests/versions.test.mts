import assert from "node:assert/strict";
import type http from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome, launchChrome, serveStatic, sleep } from "../scripts/chrome.mts";

// <bh-versions> highlights the parts marked data-change. "Show changes" turns the highlights and
// their legend off and on again: off, a marked part must look exactly like an unmarked one, and
// the choice must hold while the reader switches versions or compares.
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;
function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address !== "string", "the server is listening");
  return address.port;
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Pages with a <bh-versions> that has a marked part inside it, and that a plain request renders:
 * not an unlisted page or a sealed one.
 */
const pages = readdirSync(join(root, "docs"))
  .filter((f) => f.endsWith(".html") && !f.endsWith(".private.html"))
  .filter((f) => {
    const html = readFileSync(join(root, "docs", f), "utf8");
    if (/<meta name="bh:unlisted" content="true"/.test(html)) return false;
    return (html.match(/<bh-versions\b[\s\S]*?<\/bh-versions>/g) || []).some((v) => /\sdata-change="/.test(v));
  });

const views = [
  { name: "light, 1280px", scheme: "light", width: 1280, height: 900, mobile: false },
  { name: "dark, 1280px", scheme: "dark", width: 1280, height: 900, mobile: false },
  { name: "light, 375px", scheme: "light", width: 375, height: 800, mobile: true },
  { name: "dark, 375px", scheme: "dark", width: 375, height: 800, mobile: true },
];

interface Part { id: string; kind: string; looks: string; plain: string }
interface State {
  pressed: string | null;
  label: string;
  attr: string | null;
  legendVisibility: string;
  legendHeight: number;
  parts: Part[];
  index: number;
  comparing: boolean;
  innerWidth: number;
  buttonInView: boolean;
}

/**
 * The state of every enhanced <bh-versions> that has marked parts. A part's "looks" is the computed
 * style the marks change. "plain" is the same part's looks with its data-change attribute taken
 * away for the reading: what it would be had it never been marked.
 */
const probe = `(() => [...document.querySelectorAll("bh-versions.is-ready")].filter((v) => v.querySelector("[data-change]")).map((v) => {
  const shape = (n) => n.matches(".node") ? n.querySelector("rect, circle, ellipse, polygon, path") : n;
  const looks = (n) => {
    const a = getComputedStyle(shape(n)), b = getComputedStyle(n);
    return [a.stroke, a.strokeWidth, a.strokeDasharray, b.opacity, b.filter].join(" | ");
  };
  const btn = v.querySelector(".bh-versions-changes");
  const legend = v.querySelector(".bh-versions-legend");
  const r = btn ? btn.getBoundingClientRect() : null;
  return {
    pressed: btn && btn.getAttribute("aria-pressed"),
    label: btn ? btn.textContent.replace("✓", "").trim() : "",
    attr: v.getAttribute("data-changes"),
    legendVisibility: legend ? getComputedStyle(legend).visibility : "",
    legendHeight: legend ? legend.getBoundingClientRect().height : 0,
    parts: [...v.querySelectorAll("[data-change]")].map((n) => {
      const kind = n.dataset.change, marked = looks(n);
      n.removeAttribute("data-change");
      const plain = looks(n);
      n.setAttribute("data-change", kind);
      return { id: n.dataset.id || "", kind, looks: marked, plain };
    }),
    index: v.index,
    comparing: !!v.comparing,
    innerWidth,
    buttonInView: !!r && r.width > 0 && r.left >= 0 && r.right <= document.documentElement.clientWidth,
  };
}))()`;

test("<bh-versions>: \"Show changes\" turns the change highlights off and on", { skip, timeout: 150000 }, async (t) => {
  assert.ok(pages.length > 0, "found pages with a <bh-versions> that has marked parts");
  const server = await serveStatic(root);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${portOf(server)}/docs/`;
  const chrome = await launchChrome();
  t.after(() => chrome.close());

  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  t.after(() => chrome.send("Target.closeTarget", { targetId }).catch(() => {}));
  const s = (method: string, params?: object) => chrome.send(method, params, sessionId);
  await s("Page.enable");
  await s("Page.bringToFront");
  const evaluate = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const states = async (): Promise<State[]> => await evaluate(probe);
  /** Run `code` with `v` bound to each marked component. A real click, so the button's own handler is what is tested. */
  const each = (code: string) =>
    evaluate(`document.querySelectorAll("bh-versions.is-ready").forEach((v) => { if (v.querySelector("[data-change]")) { ${code} } })`);
  const click = () => each(`v.querySelector(".bh-versions-changes").click();`);

  for (const view of views) {
    for (const page of pages) {
      await t.test(`${page} (${view.name})`, async () => {
        await s("Emulation.setDeviceMetricsOverride", { width: view.width, height: view.height, deviceScaleFactor: 1, mobile: view.mobile });
        await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: view.scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
        // Example pages show their content on a local host only with ?examples.
        await s("Page.navigate", { url: base + page + "?examples" });
        let ready = false;
        for (let i = 0; i < 150 && !ready; i++) {
          await sleep(100);
          ready = await evaluate("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')").catch(() => false);
        }
        assert.ok(ready, "the page settled within 15 seconds");
        // A computed style read in the same task as a change is the old value while a transition runs
        // (under reduced motion the theme gives every transition a token duration, not none). So none run.
        await evaluate(`document.head.append(Object.assign(document.createElement("style"), { textContent: "*, *::before, *::after { transition: none !important; }" }))`);

        // The page's switch starts off: nothing is highlighted and no figure shows its own button.
        const first = await states();
        assert.ok(first.length > 0, "the page has an enhanced <bh-versions> with marked parts");
        assert.equal(await evaluate(`document.documentElement.getAttribute("data-changes")`), "off", "the page's switch starts off");
        for (const v of first) {
          assert.ok(!v.buttonInView, "a figure's own button is hidden while the page's switch is off");
          assert.equal(v.legendVisibility, "hidden");
          for (const p of v.parts) assert.equal(p.looks, p.plain, `${p.id} (${p.kind}) is not highlighted when the page opens`);
        }
        await evaluate(`document.querySelector(".bh-topbar .bh-changes-btn").click()`);

        const on = await states();
        for (const v of on) {
          assert.equal(v.label, "Show changes", "the button is labelled");
          assert.equal(v.pressed, "true", "the highlights start on");
          assert.equal(v.attr, null);
          assert.equal(v.legendVisibility, "visible");
          assert.ok(v.legendHeight > 0, "the legend is shown");
          assert.ok(v.parts.length > 0, "the component has marked parts");
          for (const p of v.parts) assert.notEqual(p.looks, p.plain, `${p.id} (${p.kind}) is highlighted`);
          assert.equal(v.innerWidth, view.width, "nothing widens the page");
          assert.ok(v.buttonInView, "the button is inside the viewport");
        }

        await click();
        const off = await states();
        const isOff = (list: State[], when: string) => {
          for (const [i, v] of list.entries()) {
            assert.equal(v.pressed, "false", `not pressed ${when}`);
            assert.equal(v.attr, "off", `data-changes="off" ${when}`);
            assert.equal(v.legendVisibility, "hidden", `the legend is hidden ${when}`);
            assert.equal(v.legendHeight, on[i]!.legendHeight, `the legend keeps its space ${when}`);
            for (const p of v.parts) assert.equal(p.looks, p.plain, `${p.id} (${p.kind}) looks like an unmarked part ${when}`);
          }
        };
        isOff(off, "after the click");

        // The choice holds across versions and Compare.
        await each(`v.show(1);`);
        const second = await states();
        assert.ok(second.every((v) => v.index === 1), "the second version is shown");
        isOff(second, "on the second version");
        await each(`if (v.compareBtn) v.compareBtn.click();`);
        const comparing = await states();
        assert.ok(comparing.some((v) => v.comparing), "a component is comparing");
        isOff(comparing, "while comparing");
        await each(`if (v.compareBtn) v.compareBtn.click(); v.show(0);`);
        isOff(await states(), "after leaving Compare");

        await click();
        const back = await states();
        for (const [i, v] of back.entries()) {
          assert.equal(v.pressed, "true", "pressed again");
          assert.equal(v.attr, null);
          assert.equal(v.legendVisibility, "visible");
          assert.deepEqual(v.parts, on[i]!.parts, "the highlights are back as they were");
        }
      });
    }
  }

  await t.test("the button follows the attribute, and printing lifts the off state", async () => {
    const found = await evaluate(`(() => {
      const v = [...document.querySelectorAll("bh-versions.is-ready")].find((x) => x.querySelector("[data-change]"));
      const pressed = () => v.querySelector(".bh-versions-changes").getAttribute("aria-pressed");
      const out = {};
      v.setAttribute("data-changes", "off");
      out.setFromOutside = pressed();
      window.dispatchEvent(new Event("beforeprint"));
      out.printing = [v.getAttribute("data-changes"), pressed()];
      window.dispatchEvent(new Event("afterprint"));
      out.afterPrint = [v.getAttribute("data-changes"), pressed()];
      v.removeAttribute("data-changes");
      out.removedFromOutside = pressed();
      window.dispatchEvent(new Event("beforeprint"));
      window.dispatchEvent(new Event("afterprint"));
      out.printWhileOn = [v.getAttribute("data-changes"), pressed()];
      return out;
    })()`);
    assert.deepEqual(found, {
      setFromOutside: "false", printing: [null, "true"], afterPrint: ["off", "false"], removedFromOutside: "true", printWhileOn: [null, "true"],
    });
  });

  await t.test("the top bar's button is the page's switch: off, nothing is highlighted and each figure's button is hidden", async () => {
    const found = await evaluate(`(async () => {
      const tick = () => new Promise((r) => setTimeout(r, 0)); // the button follows the attribute through a MutationObserver
      const page = document.querySelector(".bh-topbar .bh-changes-btn");
      const v = [...document.querySelectorAll("bh-versions.is-ready")].find((x) => x.querySelector("[data-change]"));
      const own = v.querySelector(".bh-versions-changes");
      // A marked diagram outside any <bh-versions> has no button but the page's.
      const lone = document.createElement("figure");
      lone.className = "diagram"; lone.id = "lone-marked";
      lone.innerHTML = '<svg viewBox="0 0 100 40" role="img" aria-label="one marked node"><g class="node c1" data-id="n" data-change="added"><rect x="2" y="2" width="96" height="36" rx="6"/><text x="50" y="20">n</text></g></svg>';
      document.querySelector(".bh-article").append(lone);
      const stroke = (n) => getComputedStyle(n).stroke;
      const inside = v.querySelector('.bh-version.is-current .node[data-change] rect, .node[data-change] rect');
      const marked = ["", ""];
      const shown = (n) => getComputedStyle(n).display !== "none";
      const read = () => ({
        page: page.getAttribute("aria-pressed"), root: document.documentElement.getAttribute("data-changes"),
        ownButtonShown: shown(own), own: own.getAttribute("aria-pressed"), compareShown: !v.compareBtn || shown(v.compareBtn),
        legend: getComputedStyle(v.querySelector(".bh-versions-legend")).visibility,
        loneHighlighted: stroke(lone.querySelector("rect")) === marked[0], insideHighlighted: stroke(inside) === marked[1],
        slash: shown(page.querySelector(".bh-changes-off")), buttonInView: page.getBoundingClientRect().right <= document.documentElement.clientWidth,
      });
      // Read what a highlighted part looks like with the page's switch on, then start over from off.
      // (The subtests before this one left the switch on.)
      if (page.getAttribute("aria-pressed") !== "true") { page.click(); await tick(); }
      marked[0] = stroke(lone.querySelector("rect")); marked[1] = stroke(inside);
      page.click(); await tick();
      const out = { label: page.getAttribute("aria-label"), start: read() };
      // The slides hide the top bar, so the marks show there whatever the switch says.
      document.documentElement.classList.add("bh-presenting"); await tick();
      out.presenting = [document.documentElement.getAttribute("data-changes"), stroke(lone.querySelector("rect")) === marked[0]];
      document.documentElement.classList.remove("bh-presenting"); await tick();
      out.afterPresenting = read();
      window.dispatchEvent(new Event("beforeprint")); await tick(); out.printing = read();
      window.dispatchEvent(new Event("afterprint")); await tick(); out.afterPrint = read();
      page.click(); await tick(); out.pageOn = read();
      // A figure's own choice is kept while the page's switch is off, and comes back with it.
      own.click(); await tick(); out.figureOff = read();
      page.click(); await tick(); out.pageOffAgain = read();
      page.click(); await tick(); out.figureStillOff = read();
      // Code that shows the reader a change they asked for (the diff view) turns the switch on.
      own.click(); await tick(); page.click(); await tick();
      const before = page.getAttribute("aria-pressed");
      window.bh.showChanges(); await tick();
      out.shownByCode = [before, page.getAttribute("aria-pressed"), document.documentElement.getAttribute("data-changes")];
      own.click(); await tick();
      own.click(); await tick();
      lone.remove();
      return out;
    })()`);
    const on = { page: "true", root: null, ownButtonShown: true, own: "true", compareShown: true, legend: "visible", loneHighlighted: true, insideHighlighted: true, slash: false, buttonInView: true };
    const off = { ...on, page: "false", root: "off", ownButtonShown: false, legend: "hidden", loneHighlighted: false, insideHighlighted: false, slash: true };
    const figureOff = { ...on, own: "false", legend: "hidden", insideHighlighted: false };
    assert.deepEqual(found, {
      label: "Show change highlights", start: off, presenting: [null, true], afterPresenting: off,
      // Printing lifts the switch on the page, though the button still says what the reader chose.
      printing: { ...on, page: "false", slash: true }, afterPrint: off,
      pageOn: on, figureOff, pageOffAgain: { ...off, own: "false" }, figureStillOff: figureOff,
      shownByCode: ["false", "true", null],
    });
  });

  await t.test("a component with no marked part gets no button", async () => {
    const found = await evaluate(`(async () => {
      const v = document.createElement("bh-versions");
      v.innerHTML = '<figure id="plain-a" data-label="A"><p>a</p></figure><figure id="plain-b" data-label="B"><p>b</p></figure>';
      document.querySelector(".bh-article").append(v);
      for (let i = 0; i < 50 && !v.classList.contains("is-ready"); i++) await new Promise((r) => setTimeout(r, 50));
      return { ready: v.classList.contains("is-ready"), compare: !!v.querySelector(".bh-versions-compare"), changes: !!v.querySelector(".bh-versions-changes") };
    })()`);
    assert.deepEqual(found, { ready: true, compare: true, changes: false });
  });
  await t.test("a page with no marked part gets no button in the top bar", async () => {
    await s("Page.navigate", { url: base + "glossary.html" });
    let ready = false;
    for (let i = 0; i < 150 && !ready; i++) {
      await sleep(100);
      ready = await evaluate("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')").catch(() => false);
    }
    assert.ok(ready, "the page settled within 15 seconds");
    assert.deepEqual(await evaluate(`[!!document.querySelector(".bh-topbar"), !!document.querySelector(".bh-changes-btn"), !!document.querySelector("[data-change]")]`), [true, false, false]);
    // theme/unlisted.js sets the off state on every page before first paint; bh.js takes it away where nothing is marked.
    assert.equal(await evaluate(`document.documentElement.getAttribute("data-changes")`), null);
  });
});

// bh.js is deferred, so a slow one runs after the page has painted. The off state must be there before
// that: theme/unlisted.js sets it in <head>. Without JavaScript nothing sets it, and the marks show.
const marked = pages.concat(readdirSync(join(root, "docs")).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html") && !pages.includes(f)).filter((f) => {
  const html = readFileSync(join(root, "docs", f), "utf8");
  // A real attribute of a tag after <main>, not the text of an example ("&lt;g data-change=…") or a script.
  const body = html.slice(html.search(/<main\b/)).replace(/<script\b[\s\S]*?<\/script>/g, "");
  return !/<meta name="bh:unlisted" content="true"/.test(html) && /<[a-z][^<>]*\sdata-change="(?:added|changed|removed)"[^<>]*>/.test(body);
}));

/**
 * Runs before the page's own scripts and counts rendering frames: how many had a marked part in the
 * document, and how many of those lacked the off state. A frame callback runs just before a paint.
 */
const frameCounter = `window.__marks = { frames: 0, lit: 0 };
(function frame() {
  if (document.querySelector("main [data-change]")) {
    window.__marks.frames++;
    if (document.documentElement.getAttribute("data-changes") !== "off") window.__marks.lit++;
  }
  requestAnimationFrame(frame);
})();`;

/** Every marked part in the page, as probe reads one: its looks, and its looks had it never been marked. */
const partsProbe = `(() => {
  const shape = (n) => n.matches(".node") ? n.querySelector("rect, circle, ellipse, polygon, path") : n;
  const looks = (n) => {
    const a = getComputedStyle(shape(n)), b = getComputedStyle(n);
    return [a.stroke, a.strokeWidth, a.strokeDasharray, b.opacity, b.filter].join(" | ");
  };
  return [...document.querySelectorAll("main [data-change]")].filter((n) => n.matches(".diagram .node, .diagram .edge")).map((n) => {
    const kind = n.dataset.change, marked = looks(n);
    n.removeAttribute("data-change");
    const plain = looks(n);
    n.setAttribute("data-change", kind);
    return { id: n.dataset.id || "", kind, looks: marked, plain };
  });
})()`;

test("change highlights: off before a slow bh.js runs, and on without JavaScript", { skip, timeout: 150000 }, async (t) => {
  assert.ok(marked.length > 0, "found pages with marked parts");
  const server = await serveStatic(root);
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  // What the server does with bh.js: serve it, hold the response until released, fail it, or send one
  // that throws after making window.bh and before it builds the top bar.
  let mode: "serve" | "hold" | "fail" | "broken" = "serve", held = 0, release = () => {};
  // The first marked page again, with no top bar.
  const chromeless = "/docs/no-chrome-test.html";
  const serve = server.listeners("request")[0] as (req: http.IncomingMessage, res: http.ServerResponse) => void;
  server.removeAllListeners("request");
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    if ((req.url || "").startsWith(chromeless)) {
      const html = readFileSync(join(root, "docs", marked[0]!), "utf8"), bare = html.replace(/<body\b/, '<body data-chrome="none"');
      assert.notEqual(bare, html, "the page was given data-chrome");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(bare);
    }
    else if (!/\/theme\/bh\.js(?:\?|$)/.test(req.url || "") || mode === "serve") serve(req, res);
    else if (mode === "broken") res.writeHead(200, { "content-type": "text/javascript" }).end('window.bh = {}; throw new Error("broken on purpose");');
    else if (mode === "fail") res.writeHead(404).end();
    else { held++; const before = release; release = () => { before(); serve(req, res); }; }
  });
  t.after(() => release());
  const base = `http://127.0.0.1:${portOf(server)}/docs/`;
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
  await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const evaluate = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expression: string, what: string) => {
    let ok = false;
    for (let i = 0; i < 150 && !ok; i++) { await sleep(100); ok = await evaluate(expression).catch(() => false); }
    assert.ok(ok, `${what} within 15 seconds`);
  };
  // No transitions, or a style read in the same task as a change is still the old value (see the test above).
  const parts = async (): Promise<Part[]> => {
    await evaluate(`document.head.append(Object.assign(document.createElement("style"), { textContent: "*, *::before, *::after { transition: none !important; }" }))`);
    return await evaluate(partsProbe);
  };
  const rootAttr = () => evaluate(`document.documentElement.getAttribute("data-changes")`);
  const { identifier } = await s("Page.addScriptToEvaluateOnNewDocument", { source: frameCounter });

  for (const page of marked) {
    await t.test(`${page}: nothing is highlighted while bh.js is still loading`, async () => {
      mode = "hold"; held = 0;
      await s("Page.navigate", { url: base + page + "?examples" });
      // The document is parsed and painted, and the deferred script has not arrived.
      await until(`document.readyState === "interactive" && performance.getEntriesByType("paint").length > 0 && window.__marks.frames >= 3`, "the page painted with its marked parts");
      assert.equal(held, 1, "bh.js was requested and is held");
      assert.equal(await evaluate("typeof window.bh"), "undefined", "bh.js has not run");
      assert.equal(await rootAttr(), "off", "the off state is set before bh.js runs");
      const waiting = await parts();
      assert.ok(waiting.length > 0, "the page has marked diagram parts");
      for (const p of waiting) assert.equal(p.looks, p.plain, `${p.id} (${p.kind}) is not highlighted while bh.js loads`);
      assert.equal((await evaluate("window.__marks")).lit, 0, "no frame so far had marked parts without the off state");
      // Paper has no button: printing now shows the marks, though bh.js's own handlers are not there yet.
      await evaluate(`window.dispatchEvent(new Event("beforeprint"))`);
      assert.equal(await rootAttr(), null, "printing lifts the off state before bh.js runs");
      for (const p of await parts()) assert.notEqual(p.looks, p.plain, `${p.id} (${p.kind}) is highlighted on paper`);
      await evaluate(`window.dispatchEvent(new Event("afterprint"))`);
      assert.equal(await rootAttr(), "off", "and it comes back after printing");
      await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const printed = (await evaluate("window.__marks")).lit;
      release(); release = () => {};
      await until("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", "the page settled");
      assert.equal(await rootAttr(), "off", "bh.js keeps the off state");
      assert.equal(await evaluate(`document.querySelector(".bh-topbar .bh-changes-btn").getAttribute("aria-pressed")`), "false");
      const frames = await evaluate("window.__marks");
      assert.ok(frames.frames >= 3, "frames were counted");
      assert.equal(frames.lit, printed, "nor any frame since, but those while printing");
      // Once bh.js has settled the switch, printing is its own business: lifted once, restored once.
      assert.equal(await evaluate("window.bhChanges.settled"), true);
      await evaluate(`window.dispatchEvent(new Event("beforeprint"))`);
      assert.equal(await rootAttr(), null);
      await evaluate(`window.dispatchEvent(new Event("afterprint"))`);
      assert.equal(await rootAttr(), "off");
    });
  }

  await t.test("a page whose bh.js throws before it builds the top bar shows its highlights", async () => {
    mode = "broken";
    await s("Page.navigate", { url: base + marked[0] + "?examples" });
    await until("document.readyState === 'complete'", "the page loaded");
    assert.deepEqual(await evaluate(`[typeof window.bh, window.bhChanges.settled, !!document.querySelector(".bh-topbar")]`), ["object", false, false], "bh.js ran and built nothing");
    assert.equal(await rootAttr(), null);
    for (const p of await parts()) assert.notEqual(p.looks, p.plain, `${p.id} (${p.kind}) is highlighted`);
  });

  await t.test('a page with no top bar (data-chrome="none") shows its highlights', async () => {
    mode = "serve";
    await s("Page.navigate", { url: `http://127.0.0.1:${portOf(server)}${chromeless}?examples` });
    await until("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", "the page settled");
    assert.deepEqual(await evaluate(`[!!document.querySelector(".bh-topbar"), window.bhChanges.settled]`), [false, true]);
    assert.equal(await rootAttr(), null);
    const shown = await parts();
    assert.ok(shown.length > 0, "the page has marked diagram parts");
    for (const p of shown) assert.notEqual(p.looks, p.plain, `${p.id} (${p.kind}) is highlighted`);
  });

  await t.test("a page whose bh.js never loads shows its highlights: it has no button to ask with", async () => {
    mode = "fail";
    await s("Page.navigate", { url: base + marked[0] + "?examples" });
    await until("document.readyState === 'complete'", "the page loaded");
    assert.equal(await evaluate("typeof window.bh"), "undefined", "bh.js did not run");
    assert.equal(await rootAttr(), null);
    for (const p of await parts()) assert.notEqual(p.looks, p.plain, `${p.id} (${p.kind}) is highlighted`);
  });

  await t.test("without JavaScript the highlights show", async () => {
    mode = "serve";
    await s("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    await s("Emulation.setScriptExecutionDisabled", { value: true });
    for (const page of marked) {
      await s("Page.navigate", { url: base + page + "?examples" });
      // The page's scripts are off; the protocol's own evaluation still runs.
      await until("document.readyState === 'complete'", `${page} loaded`);
      assert.equal(await evaluate("typeof window.bhChanges + typeof window.bh"), "undefinedundefined", "no page script ran");
      assert.equal(await rootAttr(), null);
      const shown = await parts();
      assert.ok(shown.length > 0, `${page} has marked diagram parts`);
      for (const p of shown) assert.notEqual(p.looks, p.plain, `${page}: ${p.id} (${p.kind}) is highlighted`);
    }
  });
});
