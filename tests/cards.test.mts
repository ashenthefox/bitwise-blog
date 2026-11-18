import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome, launchChrome, serveStatic, sleep } from "../scripts/chrome.mts";
import { prepareVisual } from "../scripts/cards.mts";
import { CARD_RECORDS_FILE } from "../scripts/card-records.mts";

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
  // The button follows the attribute on <html>, so it agrees with the lift and cannot undo it:
  // a later class change on <html> (which re-applies the button's state) leaves the switch on.
  assert.equal(await evaluate(pressed), "true", "the page's button says on, as the attribute does");
  await evaluate(`new Promise((r) => { document.documentElement.classList.add("x-test"); setTimeout(r, 0); })`);
  assert.equal(await evaluate(`document.documentElement.getAttribute("data-changes")`), null, "the button's state does not switch the marks off again");
  // The same lift reaches the component's own switch, which the page's does not.
  assert.equal(await evaluate(`${own}.getAttribute("data-changes")`), null, "the figure's own switch is on");
  const after: Part[] = await evaluate(probe);
  for (const p of after) assert.notEqual(p.looks, p.plain, `${p.id} is highlighted when the card is captured`);
  assert.ok(after.some((p) => p.looks.includes("5px, 4px")), "a removed part has its dashed outline");
});

// A card's key lives in social-cards.txt, not in the PNG, so drawing a card again leaves the PNG's bytes
// alone when its pixels are the same, and git sees only the text change (contracts/social-cards.md).
test("cards: the same pixels keep the PNG's bytes and update only its record; new pixels rewrite it; a conflict is repaired", { skip, timeout: 240000 }, (t) => {
  const site = fs.mkdtempSync(join(os.tmpdir(), "bh-cards-test-"));
  t.after(() => fs.rmSync(site, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "package.json", CARD_RECORDS_FILE]) fs.cpSync(join(root, entry), join(site, entry), { recursive: true });
  const cards = () => {
    const r = spawnSync(process.execPath, [join(site, "scripts/bh.mts"), "cards"], { cwd: site, encoding: "utf8", timeout: 200000 });
    const out = ((r.stdout || "") + (r.stderr || "")).replace(/\x1b\[[0-9;]*m/g, "");
    assert.equal(r.status, 0, out);
    return out;
  };
  const og = join(site, "docs/assets/og"), recordsFile = join(site, CARD_RECORDS_FILE);
  const pngs = () => new Map(fs.readdirSync(og).sort().map((f) => [f, fs.readFileSync(join(og, f))]));
  const records = () => fs.readFileSync(recordsFile, "utf8");
  const line = (text: string, slug: string) => text.split("\n").find((l) => l.startsWith(slug + " "))!.split(" ");
  const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
  /** Which PNGs differ, byte for byte, between two snapshots. */
  const changed = (a: Map<string, Buffer>, b: Map<string, Buffer>) => [...a].filter(([f, bytes]) => !b.get(f)?.equals(bytes)).map(([f]) => f);
  /** Which record lines differ between two texts. */
  const changedLines = (a: string, b: string) => a.split("\n").filter((l) => !b.split("\n").includes(l));
  const SLUG = "glossary", PAGE = join(site, `docs/${SLUG}.html`), CARD = `${SLUG}.png`;
  const edit = (from: string, to: string) => {
    const html = fs.readFileSync(PAGE, "utf8");
    assert.ok(html.includes(from), `${from} is not in the page`);
    fs.writeFileSync(PAGE, html.replace(from, () => to));
  };

  // PNGs differ slightly from machine to machine, so first draw the page's card on this one: with its
  // record gone, it is drawn again (and rewritten only if this Chrome draws other pixels).
  const committed = records();
  fs.writeFileSync(recordsFile, committed.replace(line(committed, SLUG).join(" ") + "\n", ""));
  assert.notEqual(records(), committed, "the record was removed");
  assert.match(cards(), /Rendered (?:0 cards, 1 drawn again with the same pixels \(PNG kept\)|1 card), \d+ already up to date/);
  assert.equal(records(), committed.replace(line(committed, SLUG).join(" "), () => line(records(), SLUG).join(" ")), "only that record was written back");

  // The control: every card is current, so nothing is drawn and nothing is written.
  const start = pngs(), startRecords = records();
  assert.match(cards(), /All \d+ cards are up to date/);
  assert.deepEqual(changed(start, pngs()), []);
  assert.equal(records(), startRecords);

  // An input that changes no pixel: the card is drawn again, its PNG is kept, and only its record's key changes.
  edit("</head>", "<style>/* changes no pixel */</style>\n</head>");
  assert.match(cards(), /Rendered 0 cards, 1 drawn again with the same pixels \(PNG kept\)/);
  assert.deepEqual(changed(start, pngs()), [], "no PNG changed, byte for byte");
  const same = records();
  assert.deepEqual(changedLines(same, startRecords).map((l) => l.split(" ")[0]), [SLUG], "only the edited page's record changed");
  assert.notEqual(line(same, SLUG)[1], line(startRecords, SLUG)[1], "its key changed");
  assert.equal(line(same, SLUG)[2], line(startRecords, SLUG)[2], "it names the same PNG");

  // An input that changes the picture: that PNG alone is rewritten, and its record names the new file.
  edit("<title>Glossary</title>", "<title>Glossary of every term</title>");
  assert.match(cards(), /Rendered 1 card, \d+ already up to date/);
  const drawn = pngs(), redrawn = records();
  assert.deepEqual(changed(start, drawn), [CARD]);
  assert.deepEqual(changedLines(redrawn, same).map((l) => l.split(" ")[0]), [SLUG]);
  assert.equal(line(redrawn, SLUG)[2], sha(drawn.get(CARD)!));

  // A merge conflict left in the file, the two sides naming different keys: `npm run cards` draws that
  // card again, finds the same pixels, keeps the PNG and writes the record as it was.
  const ours = line(redrawn, SLUG).join(" "), theirs = line(startRecords, SLUG).join(" ");
  fs.writeFileSync(recordsFile, redrawn.replace(ours, () => `<<<<<<< HEAD\n${ours}\n=======\n${theirs}\n>>>>>>> theirs`));
  assert.notEqual(records(), redrawn, "the conflict was written");
  assert.match(cards(), /1 drawn again with the same pixels/);
  assert.deepEqual(changed(drawn, pngs()), []);
  assert.equal(records(), redrawn);
});
