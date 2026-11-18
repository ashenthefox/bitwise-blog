// <bh-sequence> keeps the data-change marks of its actors, messages and notes on what it draws, so the
// change-highlight switches reach them (#285). In a real Chrome, by computed style rather than by
// attribute: on an ordinary page (with <bh-versions> set up before or after the sequences draw), and
// on a diff page written by the real `bh diff` command, in plain copies and in shadow-tree copies.
// Skipped without Chrome (and without the global WebSocket, Node >= 22, that scripts/chrome.mts drives it with).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { findChrome, launchChrome, serveStatic, sleep, type ChromeHandle } from "../scripts/chrome.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;

// The issue's reproduction: a changed actor, a changed message, a removed reply and an added note.
const REPRO = `<figure class="diagram" id="sequence-change-repro">
      <bh-sequence aria-label="A client calls a changed service">
        <bh-actor data-id="client" class="c3">Client</bh-actor>
        <bh-actor data-id="service" class="c1" data-change="changed">Service</bh-actor>
        <bh-msg data-id="call" from="client" to="service" data-change="changed">Call</bh-msg>
        <bh-msg data-id="reply" from="service" to="client" reply data-change="removed">Old reply</bh-msg>
        <bh-note data-id="note" over="service" data-change="added">New note</bh-note>
      </bh-sequence>
      <figcaption>Synthetic sequence with changed, removed and added parts.</figcaption>
    </figure>`;

/** Two versions of one exchange: the old one asks a cache, the new one hands the work to a queue. */
const exchange = (version: "old" | "new", mark: boolean) => {
  const m = (kind: string) => (mark ? ` data-change="${kind}"` : "");
  return version === "old" ? `<bh-sequence aria-label="The service asks a cache">
        <bh-actor data-id="client" class="c3">Client</bh-actor>
        <bh-actor data-id="service" class="c1">Service</bh-actor>
        <bh-actor data-id="cache" class="c2"${m("removed")}>Cache</bh-actor>
        <bh-msg data-id="call" from="client" to="service">GET /a</bh-msg>
        <bh-msg data-id="lookup" from="service" to="cache"${m("removed")}>lookup</bh-msg>
        <bh-msg data-id="reply" from="service" to="client" reply>200 OK</bh-msg>
      </bh-sequence>` : `<bh-sequence aria-label="The service hands the work to a queue">
        <bh-actor data-id="client" class="c3">Client</bh-actor>
        <bh-actor data-id="service" class="c1">Service</bh-actor>
        <bh-actor data-id="queue" class="c2"${m("added")}>Queue</bh-actor>
        <bh-msg data-id="call" from="client" to="service"${m("changed")}>GET /b</bh-msg>
        <bh-msg data-id="enqueue" from="service" to="queue"${m("added")}>enqueue</bh-msg>
        <bh-note data-id="queued" over="queue"${m("added")}>queued</bh-note>
        <bh-msg data-id="reply" from="service" to="client" reply>200 OK</bh-msg>
      </bh-sequence>`;
};
const figure = (id: string, body: string, label = "") => `<figure class="diagram" id="${id}"${label ? ` data-label="${label}"` : ""}>
      ${body}
      <figcaption>The ${id} exchange.</figcaption>
    </figure>`;

// What each marked sequence draws marked, as id:part:kind. A sequence draws its lifelines, then its
// messages and notes in order, then its actor boxes; a message is a path and its label.
const REPRO_PARTS = ["service:lifeline:changed", "call:path:changed", "call:label:changed", "reply:path:removed", "reply:label:removed", "note:node:added", "service:node:changed"];
const OLD_PARTS = ["cache:lifeline:removed", "lookup:path:removed", "lookup:label:removed", "cache:node:removed"];
const NEW_PARTS = ["queue:lifeline:added", "call:path:changed", "call:label:changed", "enqueue:path:added", "enqueue:label:added", "queued:node:added", "queue:node:added"];
const lit = (list: string[]) => list.map((x) => x + ":lit"), plain = (list: string[]) => list.map((x) => x + ":plain");

// An ordinary page: the reproduction, an unmarked sequence, a marked pair and an unmarked pair.
const PAGE = "docs/sequences.html";
const ORDINARY = `
    <h2 id="marked">Marked</h2>
    <p>A sequence whose parts are marked.</p>
    ${REPRO}
    <h2 id="plain">Plain</h2>
    <p>A sequence with no marks.</p>
    ${figure("plain-seq", exchange("old", false))}
    <h2 id="pairs">Pairs</h2>
    <bh-versions class="wide" id="pair">
      ${figure("pair-before", exchange("old", true), "Before")}
      ${figure("pair-after", exchange("new", true), "After")}
    </bh-versions>
    <bh-versions class="wide" id="plain-pair">
      ${figure("plain-before", exchange("old", false), "Before")}
      ${figure("plain-after", exchange("new", false), "After")}
    </bh-versions>`;

// A page that changes between two versions, for `bh diff`: one sequence figure that its CSS styles by
// id (so the diff draws its copies in shadow trees) and one that it does not (plain copies).
const DIFFED = "docs/diffed.html";
const STYLE = "#seq-styled figcaption { font-style: italic; }";
const diffed = (version: "old" | "new") => `
    <h2 id="exchange">Exchange</h2>
    <p>The service answers the client.</p>
    ${figure("seq-plain", exchange(version, false))}
    ${figure("seq-styled", exchange(version, false))}`;

function pageOf(content: string, css = ""): string {
  const template = fs.readFileSync(path.join(ROOT, "templates/explainer.html"), "utf8")
    .replaceAll("{{title}}", "Sequences with change marks").replaceAll("{{description}}", "A fixture for sequence change marks.")
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

async function openTab(chrome: ChromeHandle, scheme: "light" | "dark") {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method: string, params?: object) => chrome.send(method, params, sessionId);
  await s("Page.enable");
  await s("Page.bringToFront");
  await s("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await s("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__errors = [];
    addEventListener("error", (e) => window.__errors.push(String(e.message)));
    addEventListener("unhandledrejection", (e) => window.__errors.push(String(e.reason)));
    // The order the two components are defined in, which is the order they are set up in.
    window.__defined = [];
    const define = customElements.define.bind(customElements);
    customElements.define = (name, ...rest) => { if (name === "bh-versions" || name === "bh-sequence") window.__defined.push(name); return define(name, ...rest); };` });
  const evaluate = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const goto = async (url: string) => {
    await s("Page.navigate", { url });
    await sleep(150);
    for (let i = 0; i < 200; i++) {
      if (await evaluate("document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')").catch(() => false)) return;
      await sleep(100);
    }
    throw new Error("the page never became ready");
  };
  return { evaluate, goto, close: () => chrome.send("Target.closeTarget", { targetId }).catch(() => {}) };
}
type Tab = Awaited<ReturnType<typeof openTab>>;

/**
 * In-page helpers. `parts(scope)` lists the marked parts drawn in `scope` (an element or a shadow root)
 * as id:part:kind:state. The state is "lit" when the part's computed style differs from the same
 * part's with its data-change taken away for the reading, and its colour is the mark's (the legend's
 * swatch: --ok, --warn, --danger); "plain" when they are the same; anything else says what is wrong.
 * An actor or note box, and a message label, must also differ by more than colour.
 * No transition runs while these are read, in the page or in any shadow tree, so each read is settled.
 */
const HELPERS = `(() => {
  const trees = () => [...document.querySelectorAll(".bh-diff-shadow")].map((h) => h.shadowRoot).filter(Boolean);
  for (const r of [document.head, ...trees()]) if (!r.querySelector("style[data-still]")) {
    const s = document.createElement("style");
    s.dataset.still = ""; s.textContent = "*, *::before, *::after { transition: none !important; }";
    r.append(s);
  }
  const TONE = { added: "--ok", changed: "--warn", removed: "--danger" };
  const tone = (n, kind) => {
    const probe = document.createElement("span");
    probe.style.color = "var(" + TONE[kind] + ")";
    n.closest("bh-sequence").append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  };
  const type = (n) => n.matches(".node") ? "node" : n.matches(".seq-lifeline") ? "lifeline" : n.localName === "text" ? "label" : "path";
  const looks = (n) => {
    const a = getComputedStyle(n.matches(".node") ? n.querySelector("rect") : n), b = getComputedStyle(n);
    return { colour: n.localName === "text" ? a.fill : a.stroke, other: [a.strokeWidth, a.strokeDasharray, b.opacity, b.filter, b.fontWeight, b.textDecorationLine].join(" | ") };
  };
  const part = (n) => {
    const kind = n.dataset.change, marked = looks(n);
    n.removeAttribute("data-change");
    const unmarked = looks(n);
    n.setAttribute("data-change", kind);
    const t = type(n);
    let state = "plain";
    if (marked.colour !== unmarked.colour || marked.other !== unmarked.other) {
      state = marked.colour !== tone(n, kind) ? "wrong-colour"
        : (t === "node" || t === "label") && marked.other === unmarked.other ? "colour-only" : "lit";
    }
    return n.dataset.id + ":" + t + ":" + kind + ":" + state;
  };
  const parts = (scope) => [...scope.querySelectorAll("bh-sequence svg [data-change]")].filter((n) => !n.closest(".bh-diff-shadow")).map(part);
  /** Each side of a pair: the shadow tree its copy is drawn in, or the side itself. */
  const sides = (v) => [...v.querySelectorAll(".bh-version > figure")].map((f) => { const host = f.querySelector(":scope > .bh-diff-shadow"); return host ? host.shadowRoot : f; });
  const pair = (v) => {
    const btn = v.querySelector(".bh-versions-changes"), legend = v.querySelector(".bh-versions-legend");
    return {
      button: btn ? btn.getAttribute("aria-pressed") : null,
      legend: legend ? [...legend.querySelectorAll("li")].map((li) => li.textContent) : null,
      sides: sides(v).map(parts),
    };
  };
  const unready = () => [document, ...trees()].reduce((n, r) => n + r.querySelectorAll("bh-sequence:not(.is-ready)").length, 0);
  window.__seq = { trees, parts, pair, unready };
})()`;

/** The page's switch and every sequence as the reader sees it. */
interface OrdinaryState { root: string | null; button: string | null; unready: number; repro: string[]; plain: number; pair: Pair; plainPair: Pair }
interface Pair { button: string | null; legend: string[] | null; sides: string[][] }
const ORDINARY_STATE = `(() => { ${HELPERS}; const q = (s) => document.querySelector(s); const btn = q(".bh-topbar .bh-changes-btn"); return {
  root: document.documentElement.getAttribute("data-changes"), button: btn && btn.getAttribute("aria-pressed"), unready: __seq.unready(),
  repro: __seq.parts(q("#sequence-change-repro")), plain: q("#plain-seq").querySelectorAll("[data-change]").length,
  pair: __seq.pair(q("#pair")), plainPair: __seq.pair(q("#plain-pair")),
}; })()`;

/** What an unmarked sequence draws, whatever the switches say: its markup and every part's computed style. */
const PLAIN_LOOK = `(() => { const svg = document.querySelector("#plain-seq svg"); return svg.outerHTML + [...svg.querySelectorAll("*")].map((n) => {
  const s = getComputedStyle(n); return [s.stroke, s.strokeWidth, s.strokeDasharray, s.fill, s.opacity, s.filter, s.fontWeight, s.textDecorationLine].join(" ");
}).join("|"); })()`;

test("<bh-sequence> draws its change marks, and the change-highlight switches turn them off and on", { skip, timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-sequence-changes-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(ROOT, "theme"), path.join(root, "theme"), { recursive: true });
  fs.rmSync(path.join(root, "theme/build.js"), { force: true });
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>Home</title>");
  fs.writeFileSync(path.join(root, PAGE), pageOf(ORDINARY));

  const server = await serveStatic(root);
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  // `hold` names a module whose response waits, so the other one is set up first.
  let hold = "";
  const serve = server.listeners("request")[0] as (req: http.IncomingMessage, res: http.ServerResponse) => void;
  server.removeAllListeners("request");
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (hold && (req.url || "").split("?")[0]!.endsWith("/theme/modules/" + hold)) setTimeout(() => serve(req, res), 800);
    else serve(req, res);
  });
  const base = `http://127.0.0.1:${portOf(server)}/`;
  const chrome = await launchChrome();
  t.after(() => chrome.close());
  const tab = async (scheme: "light" | "dark" = "light") => { const x = await openTab(chrome, scheme); t.after(() => x.close()); return x; };
  const noErrors = async (p: Tab) => assert.deepEqual(await p.evaluate("window.__errors"), []);
  const state = async (p: Tab): Promise<OrdinaryState> => await p.evaluate(ORDINARY_STATE);
  const LEGEND = ["Added", "Changed", "Removed"];
  const noControls = { button: null, legend: null, sides: [[], []] };

  for (const [first, held] of [["bh-versions", "sequence.js"], ["bh-sequence", "versions.js"]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await t.test(`an ordinary page, ${first} set up first (${scheme})`, async () => {
        hold = held;
        const p = await tab(scheme);
        await p.goto(base + PAGE);
        hold = "";
        assert.deepEqual(await p.evaluate("window.__defined"), first === "bh-versions" ? ["bh-versions", "bh-sequence"] : ["bh-sequence", "bh-versions"], "the components were set up in the order this case is about");
        const plainLook = await p.evaluate(PLAIN_LOOK);

        // The page's switch starts off: every mark is drawn plain, and the pair's own button is hidden with it.
        const off = { root: "off", button: "false", unready: 0, repro: plain(REPRO_PARTS), plain: 0,
          pair: { button: "true", legend: LEGEND, sides: [plain(OLD_PARTS), plain(NEW_PARTS)] }, plainPair: noControls };
        assert.deepEqual(await state(p), off);
        assert.equal(await p.evaluate(`getComputedStyle(document.querySelector("#pair .bh-versions-changes")).display`), "none");

        // On: every mark is drawn, in its legend's colour and not by colour alone.
        await p.evaluate(`document.querySelector(".bh-topbar .bh-changes-btn").click()`);
        const on = { ...off, root: null, button: "true", repro: lit(REPRO_PARTS), pair: { ...off.pair, sides: [lit(OLD_PARTS), lit(NEW_PARTS)] } };
        assert.deepEqual(await state(p), on);

        // The pair's own switch: its marks go, the rest stay; and back, on either version and comparing.
        await p.evaluate(`document.querySelector("#pair .bh-versions-changes").click()`);
        assert.deepEqual(await state(p), { ...on, pair: { button: "false", legend: LEGEND, sides: [plain(OLD_PARTS), plain(NEW_PARTS)] } });
        await p.evaluate(`(() => { const v = document.querySelector("#pair"); v.show(1); v.compareBtn.click(); v.querySelector(".bh-versions-changes").click(); })()`);
        assert.deepEqual(await state(p), on);
        await p.evaluate(`(() => { const v = document.querySelector("#pair"); v.compareBtn.click(); v.show(0); })()`);

        // Off again from the top bar.
        await p.evaluate(`document.querySelector(".bh-topbar .bh-changes-btn").click()`);
        assert.deepEqual(await state(p), off);
        assert.equal(await p.evaluate(PLAIN_LOOK), plainLook, "an unmarked sequence looks the same whatever the switches say");
        await noErrors(p);
      });
    }
  }

  await t.test("an unmarked sequence draws no mark and no class it did not have", async () => {
    const p = await tab();
    await p.goto(base + PAGE);
    const found = await p.evaluate(`(() => { const svg = document.querySelector("#plain-seq svg"); return {
      marked: svg.querySelectorAll("[data-change]").length,
      classes: [...new Set([...svg.querySelectorAll("[class]")].map((n) => n.getAttribute("class")))].sort(),
    }; })()`);
    assert.deepEqual(found, { marked: 0, classes: ["edge", "edge dashed", "label seq-label", "node c1", "node c2", "node c3", "seq-lifeline"] });
    await noErrors(p);
  });

  await t.test("a diff page (npm run diff): sequence copies are drawn marked, in plain copies and in shadow trees", async () => {
    for (const entry of ["scripts", "package.json"]) fs.cpSync(path.join(ROOT, entry), path.join(root, entry), { recursive: true });
    const git = (...args: string[]) => spawnSync("git", ["-C", root, "-c", "user.name=T", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", timeout: 30_000 });
    fs.writeFileSync(path.join(root, DIFFED), pageOf(diffed("old"), STYLE));
    for (const args of [["init", "-q"], ["add", DIFFED], ["commit", "-q", "-m", "old"]]) {
      const r = git(...args);
      assert.equal(r.status, 0, `git ${args[0]}: ${r.stderr}`);
    }
    fs.writeFileSync(path.join(root, DIFFED), pageOf(diffed("new"), STYLE));
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("BH_")) delete env[key];
    const made = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "diff", DIFFED], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
    assert.equal(made.status, 0, made.stdout + made.stderr);
    const out = "dist/diff/" + path.basename(DIFFED);
    const html = fs.readFileSync(path.join(root, out), "utf8");
    assert.match(html, /<bh-actor\b[^>]*\sdata-id="queue"[^>]*\sdata-change="added"/, "the diff marks the sequence's source");

    for (const scheme of ["light", "dark"] as const) {
      const p = await tab(scheme);
      await p.goto(base + out);
      const read = async () => await p.evaluate(`(() => { ${HELPERS}; return {
        root: document.documentElement.getAttribute("data-changes"), unready: __seq.unready(),
        pairs: [...document.querySelectorAll(".bh-diff-mark bh-versions")].map((v) => ({ shadow: !!v.querySelector(".bh-diff-shadow"), ...__seq.pair(v) })),
        trees: __seq.trees().map((r) => r.querySelector(".bh-article").getAttribute("data-changes")),
        live: document.querySelectorAll(".bh-article > figure [data-change]").length,
      }; })()`);
      const pairOf = (shadow: boolean, button: string, sides: string[][]) => ({ shadow, button, legend: LEGEND, sides });
      // A diff page opens with the highlights on.
      assert.deepEqual(await read(), {
        root: null, unready: 0, live: 0, trees: [null, null],
        pairs: [pairOf(false, "true", [lit(OLD_PARTS), lit(NEW_PARTS)]), pairOf(true, "true", [lit(OLD_PARTS), lit(NEW_PARTS)])],
      }, scheme);
      // Each pair's own switch reaches its copies, in a shadow tree too (both trees are the styled pair's).
      await p.evaluate(`document.querySelectorAll(".bh-diff-mark bh-versions .bh-versions-changes").forEach((b) => b.click())`);
      assert.deepEqual(await read(), {
        root: null, unready: 0, live: 0, trees: ["off", "off"],
        pairs: [pairOf(false, "false", [plain(OLD_PARTS), plain(NEW_PARTS)]), pairOf(true, "false", [plain(OLD_PARTS), plain(NEW_PARTS)])],
      }, scheme);
      await p.evaluate(`document.querySelectorAll(".bh-diff-mark bh-versions .bh-versions-changes").forEach((b) => b.click())`);
      // And so does the page's.
      await p.evaluate(`document.querySelector(".bh-topbar .bh-changes-btn").click()`);
      assert.deepEqual(await read(), {
        root: "off", unready: 0, live: 0, trees: ["off", "off"],
        pairs: [pairOf(false, "true", [plain(OLD_PARTS), plain(NEW_PARTS)]), pairOf(true, "true", [plain(OLD_PARTS), plain(NEW_PARTS)])],
      }, scheme);
      await p.evaluate(`document.querySelector(".bh-topbar .bh-changes-btn").click()`);
      assert.deepEqual((await read()).pairs.map((x: Pair) => x.sides), [[lit(OLD_PARTS), lit(NEW_PARTS)], [lit(OLD_PARTS), lit(NEW_PARTS)]], `${scheme}: on again`);
      await noErrors(p);
    }
  });
});
