/* ==========================================================================
   Diff — what changed on this page since an earlier commit, shown on the page itself.

   The data is one file per (page, commit), theme/diffs/<slug>.<commit>.js, written by
   scripts/page-diff.mts: at deploy for the commits that merged review files name, and by
   `npm run serve` for any commit. It holds, for every block that differs, where the block
   is and a ready-made mark: a status ("Changed", "Added", "Removed", "Moved") and, in a
   <details>, an inert copy of what the old version said, with the words that differ in
   <ins>/<del> and a changed diagram as a before/after <bh-versions>.

   This module only places the marks: one before each live block that differs, and a change
   bar on the block. The page's own content is never rewritten, so comments stay anchored and
   components keep working. Loaded on first use: the Review panel ("Changes since"), a
   thread's "Changes since this comment", or ?diff=<commit>.

     bh.diff.show(commit, { section, quote, expand })  → Promise<{ base, total, here } | null>
     bh.diff.hide()
   ========================================================================== */
(function () {
  "use strict";
  const bh = window.bh;
  const { el } = bh;
  const doc = document;
  const article = doc.querySelector(".bh-article");
  const COMMIT = /^[0-9a-f]{7,40}$/;
  // Children of the article that the theme adds at runtime: not blocks of the document.
  const INJECTED = ".bh-diff-ui, .bh-review-ui, .bh-backlinks, .bh-superseded, .glossary-az, .bh-toc";
  // Text the theme adds inside a block.
  const NOISE = ".heading-anchor, .bh-link-btn, .sidenote-ref, .bh-review-add, .code-head, script, style";

  let shown = null; // { base, data, placed: [{ change, mark, block }], bar, at }

  const docPath = () => bh.sitePath() || bh.meta("bh:source") || "";
  const collapse = (s) => s.replace(/\s+/g, " ").trim();
  const instant = () => (bh.reducedMotion.matches ? "instant" : "smooth");
  const announce = (msg) => { if (bh.toast) bh.toast(msg); };

  function load(base) {
    const key = `${docPath()}@${base}`;
    const have = () => (window.BH_DIFFS || {})[key] || null;
    if (have() || !bh.siteRoot || !docPath()) return Promise.resolve(have());
    const slug = docPath().split("/").pop().replace(/\.html$/, "");
    return bh.loadScript(new URL(`theme/diffs/${slug}.${base}.js`, bh.siteRoot).href).then(have, () => null);
  }

  const blocks = () => [...article.children].filter((c) => !c.matches(INJECTED));

  function textOf(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll(NOISE).forEach((n) => n.remove());
    return collapse(copy.textContent);
  }

  /** The live block a change is about: by id, else by position, confirmed by its tag and the start of its text. */
  function find(change, list) {
    if (change.id) {
      const byId = doc.getElementById(change.id);
      if (byId && byId.parentElement === article) return byId;
    }
    // `includes`, not `startsWith`: a component puts its own controls ahead of its content.
    const fits = (b) => b && b.localName === change.tag && (!change.probe || textOf(b).includes(change.probe));
    if (fits(list[change.at])) return list[change.at];
    let best = null, distance = Infinity;
    list.forEach((b, i) => { if (Math.abs(i - change.at) < distance && fits(b)) { best = b; distance = Math.abs(i - change.at); } });
    return best;
  }

  /** The id of the heading a block (or a heading) with this id falls under, as the diff names sections. */
  function sectionOf(anchor) {
    let node = anchor && doc.getElementById(anchor);
    if (!node || !article.contains(node)) return anchor || "";
    while (node.parentElement !== article) node = node.parentElement;
    for (; node; node = node.previousElementSibling) if (/^h[2-4]$/.test(node.localName) && !node.matches(INJECTED)) return node.id;
    return "";
  }

  const statsLine = (s) => ["changed", "added", "removed", "moved"].filter((k) => s[k]).map((k) => `${s[k]} ${k}`).join(", ") || "no changes";

  function go(step) {
    if (!shown || !shown.placed.length) return;
    const n = shown.placed.length;
    shown.at = ((shown.at < 0 && step < 0 ? 0 : shown.at) + step + n) % n;
    reveal(shown.placed[shown.at]);
  }

  function reveal(p) {
    p.mark.scrollIntoView({ block: "center", behavior: instant() });
    if (p.mark.localName === "details") p.mark.open = true;
    const focus = p.mark.querySelector("summary") || p.mark;
    if (focus === p.mark) p.mark.tabIndex = -1;
    focus.focus({ preventScroll: true });
  }

  function expandAll(open) {
    if (!shown) return;
    for (const p of shown.placed) if (p.mark.localName === "details") p.mark.open = open;
    const btn = shown.bar.querySelector("[data-expand]");
    btn.setAttribute("aria-pressed", String(open));
    btn.textContent = open ? "Collapse all" : "Expand all";
  }

  function buildBar(base, data, placed) {
    const total = data.stats.changed + data.stats.added + data.stats.removed + data.stats.moved;
    const text = total ? `Changes since ${base.slice(0, 7)}: ${statsLine(data.stats)}` : `No changes to this page since ${base.slice(0, 7)}`;
    const hasDetails = placed.some((p) => p.mark.localName === "details");
    return el("div", { class: "bh-diff-bar bh-diff-ui", role: "region", "aria-label": "Changes" }, [
      el("span", { class: "bh-diff-bar-text", text }),
      placed.length ? el("button", { type: "button", class: "btn", text: "Previous", onclick: () => go(-1) }) : null,
      placed.length ? el("button", { type: "button", class: "btn", text: "Next", onclick: () => go(1) }) : null,
      hasDetails ? el("button", { type: "button", class: "btn", "data-expand": "", "aria-pressed": "false", text: "Expand all", onclick: (e) => expandAll(e.currentTarget.getAttribute("aria-pressed") !== "true") }) : null,
      el("button", { type: "button", class: "btn ghost", text: "Close", onclick: hide }),
    ]);
  }

  function hide() {
    if (!shown) return;
    for (const p of shown.placed) { p.mark.remove(); if (p.block) p.block.removeAttribute("data-diff"); }
    shown.bar.remove();
    shown = null;
    doc.dispatchEvent(new CustomEvent("bh-diff", { detail: { base: null } }));
  }

  /**
   * Show what changed since `base`. With `section` (a heading or block id, as a review comment's
   * anchor) or `quote` (the text a comment quoted), open and scroll to the changes there.
   * Resolves to { base, total, here } (`here`: how many changes that place has), or null when
   * there is no data for that commit.
   */
  function show(base, opts = {}) {
    hide();
    if (!article || typeof base !== "string" || !COMMIT.test(base)) return Promise.resolve(null);
    return load(base).then((data) => {
      if (!data) return null;
      hide(); // a second call may have landed while this one loaded
      const list = blocks();
      const footer = article.querySelector(":scope > .bh-footer");
      const placed = [];
      for (const change of data.changes) {
        const removed = change.status === "removed";
        const block = removed ? list[change.at] || footer : find(change, list);
        if (!removed && !block) continue; // the page is not the build this data was made for
        const holder = el("div", { html: change.html });
        const mark = holder.firstElementChild;
        if (!mark) continue;
        mark.classList.add("bh-diff-ui");
        if (block) block.before(mark); else article.append(mark);
        if (!removed) block.setAttribute("data-diff", change.status);
        placed.push({ change, mark, block: removed ? null : block });
      }
      // Inert copies of pictures are drawn by the same components as the page's own.
      if (article.querySelector(".bh-diff-ui svg")) bh.ensureMarkers();
      if (article.querySelector(".bh-diff-ui bh-versions")) bh.settle(bh.loadModule("versions.js"));
      if (article.querySelector(".bh-diff-ui bh-sequence")) bh.settle(bh.loadModule("sequence.js"));
      const bar = buildBar(base, data, placed);
      doc.body.append(bar);
      shown = { base, data, placed, bar, at: -1 };
      if (opts.expand) expandAll(true);

      let here = [];
      if (opts.quote) {
        const quote = collapse(opts.quote);
        here = placed.filter((p) => p.change.oldText && p.change.oldText.includes(quote));
      }
      if (!here.length && opts.section !== undefined) {
        const section = sectionOf(opts.section);
        here = placed.filter((p) => p.change.id === opts.section || p.change.section === section);
      }
      if (here.length) {
        for (const p of here) if (p.mark.localName === "details") p.mark.open = true;
        shown.at = placed.indexOf(here[0]);
        reveal(here[0]);
      }
      doc.dispatchEvent(new CustomEvent("bh-diff", { detail: { base } }));
      return { base, total: placed.length, here: here.length };
    });
  }

  bh.diff = { show, hide, get base() { return shown ? shown.base : null; }, get placed() { return shown ? shown.placed : []; }, announce };
  window.bhModules = Object.assign(window.bhModules || {}, { "diff.js": true });
})();
