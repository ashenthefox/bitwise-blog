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

/** Pages whose source has a <bh-versions> and a marked part. */
const pages = readdirSync(join(root, "docs"))
  .filter((f) => f.endsWith(".html"))
  .filter((f) => {
    const html = readFileSync(join(root, "docs", f), "utf8");
    return html.includes("<bh-versions") && html.includes("data-change=");
  });

const views = [
  { name: "light, 1280px", scheme: "light", width: 1280, height: 900, mobile: false },
  { name: "dark, 1280px", scheme: "dark", width: 1280, height: 900, mobile: false },
  { name: "light, 375px", scheme: "light", width: 375, height: 800, mobile: true },
  { name: "dark, 375px", scheme: "dark", width: 375, height: 800, mobile: true },
];

interface Part { id: string; kind: string; looks: string; plain: string | null }
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
 * style the marks change. "plain" is the same for an unmarked part of the same kind and colour in
 * the same component (null when there is none to compare with).
 */
const probe = `(() => [...document.querySelectorAll("bh-versions.is-ready")].filter((v) => v.querySelector("[data-change]")).map((v) => {
  const shape = (n) => n.matches(".node") ? n.querySelector("rect, circle, ellipse, polygon, path") : n;
  const looks = (n) => {
    const a = getComputedStyle(shape(n)), b = getComputedStyle(n);
    return [a.stroke, a.strokeWidth, a.strokeDasharray, b.opacity, b.filter].join(" | ");
  };
  const key = (n) => [...n.classList].filter((c) => /^(node|edge|c[1-6])$/.test(c)).sort().join(".");
  const unmarked = [...v.querySelectorAll(".node:not([data-change]), .edge:not([data-change])")];
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
      const twin = unmarked.find((u) => key(u) === key(n));
      return { id: n.dataset.id || "", kind: n.dataset.change, looks: looks(n), plain: twin ? looks(twin) : null };
    }),
    index: v.index,
    comparing: !!v.comparing,
    innerWidth,
    buttonInView: !!r && r.left >= 0 && r.right <= document.documentElement.clientWidth,
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
  // Under reduced motion the theme gives every transition a token duration, so a computed style read
  // in the same task as the change is still the old one. Wait a moment before reading.
  const states = async (): Promise<State[]> => { await sleep(60); return await evaluate(probe); };
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
        for (let i = 0; i < 100; i++) {
          await sleep(100);
          if (await evaluate("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')").catch(() => false)) break;
        }

        const on = await states();
        assert.ok(on.length > 0, "the page has an enhanced <bh-versions> with marked parts");
        for (const v of on) {
          assert.equal(v.label, "Show changes", "the button is labelled");
          assert.equal(v.pressed, "true", "the highlights start on");
          assert.equal(v.attr, null);
          assert.equal(v.legendVisibility, "visible");
          assert.ok(v.legendHeight > 0, "the legend is shown");
          const compared = v.parts.filter((p) => p.plain !== null);
          assert.ok(compared.length > 0, "at least one marked part has an unmarked part to compare with");
          for (const p of compared) assert.notEqual(p.looks, p.plain, `${p.id} (${p.kind}) is highlighted`);
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
            for (const p of v.parts) if (p.plain !== null) assert.equal(p.looks, p.plain, `${p.id} (${p.kind}) looks like an unmarked part ${when}`);
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
});
