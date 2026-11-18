import assert from "node:assert/strict";
import type http from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome, launchChrome, serveStatic, sleep, FONT_FILES } from "../scripts/chrome.mts";

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

  await t.test("the page's switch stays true to its button through printing, a page script and a wrapper's switch", async () => {
    // A phone's width, whatever view the loop above ended on: the icon's size below depends on it.
    await s("Emulation.setDeviceMetricsOverride", { width: 375, height: 800, deviceScaleFactor: 1, mobile: true });
    await sleep(200);
    const found = await evaluate(`(async () => {
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const html = document.documentElement;
      const page = document.querySelector(".bh-topbar .bh-changes-btn");
      const state = () => [page.getAttribute("aria-pressed"), html.getAttribute("data-changes")];
      const fire = async (name) => { window.dispatchEvent(new Event(name)); await tick(); }; // one task each, as a real print is
      // A figure's own switch: <html> is put back from the page's button when printing ends, so only
      // another element shows what the print handlers themselves remembered.
      const v = [...document.querySelectorAll("bh-versions.is-ready")].find((x) => x.querySelector("[data-change]"));
      const own = v.querySelector(".bh-versions-changes"), rect = v.querySelector(".node[data-change] rect");
      const figure = () => [own.getAttribute("aria-pressed"), v.getAttribute("data-changes")];
      const out = { icon: [innerWidth, page.querySelector("svg").getBoundingClientRect().width] };
      if (page.getAttribute("aria-pressed") === "true") { page.click(); await tick(); }
      out.start = state();
      await fire("beforeprint"); await fire("beforeprint");
      out.printing = state();
      await fire("afterprint");
      out.afterTwoBeforeprints = state();
      // A second beforeprint must not forget what the first one lifted. The page's switch is on and
      // the figure is switched off on its own; the second beforeprint finds nothing off any more.
      page.click(); await tick();
      own.click(); await tick();
      out.figureOff = [state(), figure()];
      await fire("beforeprint"); await fire("beforeprint");
      out.figureWhilePrinting = figure();
      await fire("afterprint");
      out.figureAfterTwoBeforeprints = [state(), figure()];
      page.click(); await tick(); // the page's switch off again; the figure keeps its own choice, off
      // An afterprint that never comes must not leave the switch lifted: the next press of the
      // button ends the printing state, and so does code that turns the switch on.
      await fire("beforeprint");
      page.click(); await tick();
      page.click(); await tick();
      out.pressedAfterLostAfterprint = state();
      // Read before any press of the button, whose own handler would end the printing state too.
      // Lifted or not, the page's switch reads the same once it is on: the figure's own off state
      // coming back, and a page script's off being followed again, are what show that printing ended.
      await fire("beforeprint");
      out.lostAfterprint = [state(), figure()];
      window.bh.showChanges(); await tick();
      out.shownAfterLostAfterprint = [state(), figure()];
      html.setAttribute("data-changes", "off"); await tick();
      out.scriptOffAfterShown = state();
      // The figure's own switch back on, and the page's switch off, as the steps below expect.
      page.click(); await tick();
      own.click(); await tick();
      page.click(); await tick();
      out.figureOnAgain = [state(), figure()];
      // While the page prints, nothing puts the switch back: not a class change on <html> ...
      await fire("beforeprint");
      html.classList.add("x-test"); await tick();
      out.classChangeWhilePrinting = state();
      html.classList.remove("x-test");
      // ... and code that turns the switch on meanwhile is not undone when printing ends.
      window.bh.showChanges(); await tick();
      await fire("afterprint");
      out.shownWhilePrinting = state();
      // A page script that sets the attribute on <html>: the button says what the attribute says.
      html.setAttribute("data-changes", "off"); await tick();
      out.scriptOff = state();
      page.click(); await tick();
      out.clickAfterScript = state();
      html.setAttribute("data-changes", "off"); await tick();
      html.removeAttribute("data-changes"); await tick();
      out.scriptOn = state();
      // A switch on a wrapper other than <html> acts like the page's for what is inside it.
      const lit = getComputedStyle(rect).stroke;
      const read = () => ({ ownButtonShown: getComputedStyle(own).display !== "none", legend: getComputedStyle(v.querySelector(".bh-versions-legend")).visibility, highlighted: getComputedStyle(rect).stroke === lit });
      const main = document.querySelector("main");
      main.setAttribute("data-changes", "off"); await tick();
      out.wrapperOff = read();
      main.removeAttribute("data-changes"); await tick();
      out.wrapperOn = read();
      return out;
    })()`);
    assert.deepEqual(found, {
      icon: [375, 18], // the bar has room for its five buttons on a phone: a flex row would shrink the icons otherwise
      start: ["false", "off"], printing: ["false", null], afterTwoBeforeprints: ["false", "off"],
      figureOff: [["true", null], ["false", "off"]], figureWhilePrinting: ["true", null],
      figureAfterTwoBeforeprints: [["true", null], ["false", "off"]],
      pressedAfterLostAfterprint: ["false", "off"],
      lostAfterprint: [["false", null], ["true", null]], shownAfterLostAfterprint: [["true", null], ["false", "off"]],
      scriptOffAfterShown: ["false", "off"], figureOnAgain: [["false", "off"], ["true", null]],
      classChangeWhilePrinting: ["false", null], shownWhilePrinting: ["true", null],
      scriptOff: ["false", "off"], clickAfterScript: ["true", null], scriptOn: ["true", null],
      wrapperOff: { ownButtonShown: false, legend: "hidden", highlighted: false },
      wrapperOn: { ownButtonShown: true, legend: "visible", highlighted: true },
    });
  });

  // The top bar's buttons and their icons never shrink (#273): a flex row with no room shrank them, to
  // 8px icons in 22px buttons at 320px. The title gives way first, then the brand's name (cut short
  // with an ellipsis), and below 375px the brand is its mark alone.
  await t.test("the top bar's buttons and icons keep their size from 320px to 390px, with a sixth button and without the theme's fonts", async () => {
    interface Bar {
      innerWidth: number; scrollWidth: number; barRight: number; fontsLoaded: boolean;
      brand: { tag: string; href: string | null; name: string; nameWidth: number; nameFull: number; nameInTree: boolean; width: number; height: number; left: number; right: number; markRight: number };
      buttons: { label: string; left: number; right: number; width: number; height: number; icon: number; drawn: number }[];
    }
    const bar = (): Promise<Bar> => evaluate(`(() => {
      const top = document.querySelector(".bh-topbar"), brand = top.querySelector(".bh-brand"), name = brand.querySelector(".bh-brand-name");
      const box = (n) => n.getBoundingClientRect();
      const b = box(brand), style = getComputedStyle(name);
      return {
        innerWidth, scrollWidth: document.documentElement.scrollWidth, barRight: box(top).right,
        fontsLoaded: document.fonts.check('600 16px "IBM Plex Sans"'),
        brand: {
          tag: brand.localName, href: brand.getAttribute("href"), name: brand.textContent.trim(),
          nameWidth: box(name).width, nameFull: name.scrollWidth,
          nameInTree: style.display !== "none" && style.visibility !== "hidden" && !name.closest("[aria-hidden='true'], [hidden]"),
          width: b.width, height: b.height, left: b.left, right: b.right, markRight: box(brand.querySelector(".bh-brand-mark")).right,
        },
        buttons: [...top.querySelectorAll(".bh-topbar-actions > button")].map((button) => {
          const r = box(button), svg = button.querySelector("svg");
          return { label: button.getAttribute("aria-label"), left: r.left, right: r.right, width: r.width, height: r.height, icon: box(svg).width, drawn: Number(svg.getAttribute("width")) };
        }),
      };
    })()`);
    /** The brand's name: all of it, cut short with an ellipsis, or out of sight. */
    type Name = "whole" | "cut short" | "out of sight";
    const holds = (found: Bar, width: number, count: number, name: Name, when: string, fits = true) => {
      assert.equal(found.innerWidth, width, `nothing widens the viewport ${when}`);
      assert.equal(found.scrollWidth, width, `nothing overflows the page ${when}`);
      assert.equal(found.buttons.length, count, `the bar has ${count} buttons ${when}`);
      assert.ok(found.brand.markRight <= found.buttons[0]!.left, `the brand's mark is clear of the first button ${when}`);
      let edge = found.brand.right;
      for (const b of found.buttons) {
        assert.equal(b.icon, b.drawn, `"${b.label}": the icon is the ${b.drawn}px it is drawn at ${when}`);
        assert.ok(b.width >= 30 && b.height >= 30, `"${b.label}": its full size ${when}, not ${b.width} by ${b.height}`);
        assert.ok(b.left >= edge, `"${b.label}": clear of what is before it ${when}`);
        edge = b.right;
      }
      assert.equal(found.barRight, width, `the bar is as wide as the viewport ${when}`);
      assert.equal(edge <= found.barRight, fits, `the last button is ${fits ? "inside" : "past the edge of"} the bar ${when}`);
      // What gave way is the brand's name: it is still a link home with its name.
      assert.equal(found.brand.tag, "a", "the brand is a link");
      assert.ok(found.brand.href, "the brand links home");
      assert.equal(found.brand.name, "Bitwise Engineering", `the brand keeps its name ${when}`);
      assert.ok(found.brand.nameInTree, `the brand's name is still read out ${when}`);
      assert.ok(found.brand.left >= 0, `the brand is inside the viewport ${when}`);
      const shown = found.brand.nameWidth > 1;
      const seen: Name = !shown ? "out of sight" : found.brand.nameWidth < found.brand.nameFull - 1 ? "cut short" : "whole";
      assert.equal(seen, name, `the brand's name is ${name} ${when} (${found.brand.nameWidth}px of ${found.brand.nameFull}px)`);
      if (name === "out of sight") assert.ok(found.brand.width >= 24 && found.brand.height >= 24, `the brand is a 24px target ${when}`);
    };
    const load = async () => {
      await s("Page.navigate", { url: base + "edge-rate-limiting-design.html?examples" });
      let ready = false;
      for (let i = 0; i < 150 && !ready; i++) {
        await sleep(100);
        ready = await evaluate("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')").catch(() => false);
      }
      assert.ok(ready, "the page settled within 15 seconds");
      // As above: a style read in the same task as a change is the old value while a transition runs.
      await evaluate(`document.head.append(Object.assign(document.createElement("style"), { textContent: "*, *::before, *::after { transition: none !important; }" }))`);
    };
    // Media queries follow a new width on the next frame, not when the override returns: wait for one
    // (or 250 ms, should the tab's frames be throttled), not for a fixed time.
    const size = async (width: number) => {
      await s("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: true });
      await evaluate(`new Promise((done) => { requestAnimationFrame(() => requestAnimationFrame(done)); setTimeout(done, 250); })`);
    };
    /** Add buttons to the bar, as a later feature might. */
    const add = (n: number) => evaluate(`(() => {
      const actions = document.querySelector(".bh-topbar-actions");
      for (let i = 0; i < ${n}; i++) {
        const more = actions.lastElementChild.cloneNode(true);
        more.setAttribute("aria-label", "One more button");
        more.dataset.test = "more";
        actions.append(more);
      }
    })()`);
    const removeAdded = () => evaluate(`document.querySelectorAll(".bh-topbar-actions [data-test=more]").forEach((b) => b.remove())`);
    const widths: [number, Name, Name][] = [[390, "whole", "cut short"], [375, "whole", "cut short"], [360, "out of sight", "out of sight"], [320, "out of sight", "out of sight"]];

    await size(375);
    await load();
    assert.deepEqual((await bar()).buttons.map((b) => b.drawn), [16, 18, 18, 18, 18], "the page has all five buttons: search, changes, review, present, theme");
    assert.ok((await bar()).fontsLoaded, "the theme's fonts are loaded");
    for (const scheme of ["light", "dark"]) {
      await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
      for (const [width, five, six] of widths) {
        await size(width);
        holds(await bar(), width, 5, five, `at ${width}px (${scheme})`);
        // A sixth button: the next feature that adds one must not bring the shrink back, at any of these widths.
        await add(1);
        holds(await bar(), width, 6, six, `at ${width}px with a sixth button (${scheme})`);
        await removeAdded();
      }
    }
    // More buttons than can fit: they keep their size and the bar clips the last, rather than widen the viewport.
    await add(3);
    holds(await bar(), 320, 8, "out of sight", "at 320px with eight buttons", false);
    await removeAdded();

    // A wider name than the web font's, as a fallback font is before the web font loads. At 375px the
    // five-button row has about 5px to spare, so a slightly wider face is cut short, and nothing shrinks.
    await size(375);
    await evaluate(`document.querySelector(".bh-brand-name").style.letterSpacing = "0.5px"`);
    holds(await bar(), 375, 5, "cut short", "at 375px with a wider name");
    await evaluate(`document.querySelector(".bh-brand-name").style.letterSpacing = ""`);

    // The real thing: the theme's font files blocked, so the system fonts draw the bar. How wide they
    // are depends on the machine, so the name may be whole or cut short; the buttons may not change.
    await s("Network.enable");
    await s("Network.setCacheDisabled", { cacheDisabled: true });
    await s("Network.setBlockedURLs", { urls: [FONT_FILES] });
    try {
      for (const width of [390, 375]) {
        await size(width);
        await load();
        const found = await bar();
        assert.equal(found.fontsLoaded, false, "the theme's fonts are blocked");
        holds(found, width, 5, found.brand.nameWidth < found.brand.nameFull - 1 ? "cut short" : "whole", `at ${width}px without the theme's fonts`);
        await add(1);
        holds(await bar(), width, 6, "cut short", `at ${width}px without the theme's fonts, with a sixth button`);
      }
    } finally {
      await s("Network.setBlockedURLs", { urls: [] });
      await s("Network.setCacheDisabled", { cacheDisabled: false });
    }
    await size(375);
    await load();
    assert.ok((await bar()).fontsLoaded, "the theme's fonts are back");
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
  /** Count, in window.__writes, every later write to data-changes on <html>, a rewrite of the same value included. */
  const countWrites = `window.__writes = 0; new MutationObserver((records) => { window.__writes += records.length; }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-changes"] }); 0`;
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
      await evaluate(countWrites);
      release(); release = () => {};
      await until("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", "the page settled");
      assert.equal(await rootAttr(), "off", "bh.js keeps the off state");
      assert.equal(await evaluate(`document.querySelector(".bh-topbar .bh-changes-btn").getAttribute("aria-pressed")`), "false");
      // The button agrees with what the head script set, so bh.js writes nothing: the attribute is not
      // rewritten, and the button (which follows the attribute) has no change to answer.
      assert.equal(await evaluate("window.__writes"), 0, "bh.js did not touch the attribute on <html>");
      const frames = await evaluate("window.__marks");
      assert.ok(frames.frames >= 3, "frames were counted");
      assert.equal(frames.lit, printed, "nor any frame since, but those while printing");
      // Once bh.js has settled the switch, printing is its own business: lifted once, restored once.
      assert.equal(await evaluate("window.bhChanges.settled"), true);
      await evaluate(`window.dispatchEvent(new Event("beforeprint"))`);
      assert.equal(await rootAttr(), null);
      await evaluate(`window.dispatchEvent(new Event("afterprint"))`);
      assert.equal(await rootAttr(), "off");
      assert.equal(await evaluate("window.__writes"), 2, "one write to lift and one to restore");
    });
  }

  await t.test("printing that starts before bh.js runs and ends after it leaves the switch off, and its button working", async () => {
    mode = "hold"; held = 0;
    await s("Page.navigate", { url: base + marked[0] + "?examples" });
    await until(`document.readyState === "interactive" && performance.getEntriesByType("paint").length > 0`, "the page painted");
    assert.equal(held, 1, "bh.js is held");
    await evaluate(`window.dispatchEvent(new Event("beforeprint"))`);
    assert.equal(await rootAttr(), null, "the head script lifted the off state");
    release(); release = () => {};
    await until("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", "the page settled");
    await evaluate(`window.dispatchEvent(new Event("afterprint"))`);
    const state = `[document.documentElement.getAttribute("data-changes"), document.querySelector(".bh-topbar .bh-changes-btn").getAttribute("aria-pressed")]`;
    assert.deepEqual(await evaluate(state), ["off", "false"], "neither afterprint handler leaves the attribute and the button apart");
    assert.deepEqual(await evaluate(`new Promise((r) => { document.querySelector(".bh-topbar .bh-changes-btn").click(); setTimeout(() => r(${state}), 0); })`), [null, "true"]);
  });

  await t.test("a page with no marked part: bh.js takes the off state away, and nothing puts it back", async () => {
    mode = "hold"; held = 0;
    await s("Page.navigate", { url: base + "glossary.html" });
    await until(`document.readyState === "interactive" && performance.getEntriesByType("paint").length > 0`, "the page painted");
    assert.equal(held, 1, "bh.js is held");
    assert.equal(await rootAttr(), "off", "the head script cannot know the page marks nothing");
    await evaluate(countWrites);
    release(); release = () => {};
    await until("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", "the page settled");
    assert.deepEqual(await evaluate(`[document.documentElement.getAttribute("data-changes"), !!document.querySelector(".bh-topbar"), !!document.querySelector(".bh-changes-btn"), window.bhChanges.settled, window.__writes]`), [null, true, false, true, 1], "removed once, and no button");
    // Neither pair of print handlers has anything to lift or restore.
    await evaluate(`new Promise((r) => { window.dispatchEvent(new Event("beforeprint")); setTimeout(() => { window.dispatchEvent(new Event("afterprint")); setTimeout(r, 0); }, 0); })`);
    assert.deepEqual(await evaluate(`[document.documentElement.getAttribute("data-changes"), window.__writes]`), [null, 1]);
  });

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
    // With no button, printing changes nothing: there is no off state left to lift or to put back.
    await evaluate(countWrites);
    await evaluate(`new Promise((r) => { window.dispatchEvent(new Event("beforeprint")); setTimeout(() => { window.dispatchEvent(new Event("afterprint")); setTimeout(r, 0); }, 0); })`);
    assert.deepEqual(await evaluate(`[document.documentElement.getAttribute("data-changes"), window.__writes]`), [null, 0]);
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
