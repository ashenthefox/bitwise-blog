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
     bh.diff.upgrade(scope, oldStyle)   draw the copies that need their own version's page CSS

   A copy has no ids, so page CSS scoped by id (`#my-figure .part`) cannot reach it. Where a
   version's CSS styles a block that way, the mark carries a second copy with its ids kept, in a
   <template> inside `.bh-diff-shadow`. `upgrade` moves that copy into a shadow tree with the theme
   and that version's page CSS: ids there collide with nothing, and the old CSS styles nothing else.
   The standalone diff page (`npm run diff`) loads this module only for that.
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

  /** The block as the page wrote it: bh.js wraps a code block, and the article's child is then the wrapper around the <pre>. */
  const written = (b) => (b.matches("div.code-block") && b.querySelector(":scope > pre")) || b;

  /** The live block a change is about: by id, else by position, confirmed by its tag and the start of its text. */
  function find(change, list) {
    if (change.id) {
      const byId = doc.getElementById(change.id);
      if (byId && byId.parentElement === article) return byId;
      const wrapper = byId && list.find((b) => written(b) === byId);
      if (wrapper) return wrapper;
    }
    // A component rewrites its own content (controls ahead of it, labels between its parts), so its
    // text is only a hint: at the expected position its tag is enough, and elsewhere a short start of
    // the text, found anywhere in it.
    const custom = change.tag.includes("-");
    const probe = custom ? change.probe.slice(0, 24) : change.probe;
    const fits = (b) => b && written(b).localName === change.tag && (!probe || textOf(b).includes(probe));
    const expected = list[change.at];
    if (expected && custom && expected.localName === change.tag) return expected;
    if (fits(expected)) return expected;
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

  // ---- Copies drawn with their own version's CSS ---------------------------------------------

  // What the theme's layout would do to a copy's wrapper, undone; and no "Figure N": a copy is not one
  // of the page's figures. It must not count either: a counter crosses into a shadow tree, so a copy
  // that counted would renumber every figure after it on the page.
  const SHADOW_CSS = ":host{display:block}.bh-article{display:block;min-height:0;margin:0;padding:0;background:none;counter-reset:none}"
    + ".bh-article figure{counter-increment:none}.bh-article figure>figcaption::before{content:none}.bh-article>figure{margin:0}";
  // The page hides an element marked data-unlisted or data-example unless <html> has that switch on
  // (components.css, set by unlisted.js and examples.js). A rule keyed on <html> matches nothing in a
  // shadow tree, so the rules are repeated for a tree, keyed on its content, which `mirrorSwitches`
  // writes the two switches onto. They hide unless the tree says "on", so a tree that was never written
  // to shows no such element. They are in a layer and important, in a <style> ahead of the version's
  // page CSS: an important rule in the first layer beats every later one, so that CSS cannot show one either.
  const HIDDEN_CSS = '@layer bh-diff-hidden{.bh-article:not([data-unlisted="on"]) [data-unlisted],.bh-article:not([data-examples="on"]) [data-example]{display:none!important}}';
  const SWITCHES = ["data-unlisted", "data-examples"];
  function mirrorSwitches() {
    for (const host of doc.querySelectorAll(".bh-diff-shadow")) {
      const body = host.shadowRoot && host.shadowRoot.querySelector(".bh-article");
      if (!body) continue;
      for (const name of SWITCHES) {
        if (doc.documentElement.getAttribute(name) === "on") body.setAttribute(name, "on");
        else body.removeAttribute(name);
      }
    }
  }
  // The two scripts set a switch once, before first paint, and reload the page to change it. Should one change
  // in place all the same, the copies follow, as the page's own rule does.
  if ("MutationObserver" in window) new MutationObserver(mirrorSwitches).observe(doc.documentElement, { attributes: true, attributeFilter: SWITCHES });
  const themeNodes = () => [...doc.querySelectorAll('link[rel="stylesheet"][href*="theme/bh.css"], style[data-bh-theme]')];
  /** This page's own CSS: every <style> in the head that is not the theme (a bundle inlines the theme as one). */
  const pageStyle = () => [...doc.head.querySelectorAll("style:not([data-bh-theme])")].map((s) => s.textContent).join("\n");

  /** A stylesheet's rules as text with its @imports written out, since a constructed sheet may not import. */
  function flatten(sheet) {
    let out = "";
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSImportRule) {
        const inner = rule.styleSheet ? flatten(rule.styleSheet) : "";
        out += rule.layerName == null ? inner : `@layer ${rule.layerName}{${inner}}`;
      } else if (!(rule instanceof CSSFontFaceRule)) out += rule.cssText; // fonts belong to the document
    }
    return out;
  }

  let themeSheet; // one CSSStyleSheet shared by every shadow tree; false when it cannot be built
  function adoptTheme(root) {
    if (themeSheet === undefined) {
      try {
        themeSheet = new CSSStyleSheet();
        themeSheet.replaceSync(themeNodes().map((n) => flatten(n.sheet)).join("\n"));
      } catch (_) { themeSheet = false; } // rules unreadable (a page opened from file://)
    }
    if (themeSheet) root.adoptedStyleSheets = [themeSheet];
    else for (const n of themeNodes()) root.append(n.cloneNode(true));
  }

  // A copy that scrolls (a wide table, code, and below 640px a diagram) must be reachable by keyboard, as on
  // the page. bh.js decides that for a tree as for the page, but it cannot see a tree being drawn, and a
  // copy in a closed mark has no size: so it is asked to measure when one is drawn and when its mark opens.
  const measure = () => { if (bh.scrollRegions) bh.scrollRegions(); };

  /** Move each `.bh-diff-shadow` copy in `scope` into a shadow tree styled by its version's page CSS. */
  function upgrade(scope, oldStyle) {
    const hosts = [...scope.querySelectorAll(".bh-diff-shadow")].filter((h) => !h.shadowRoot && h.querySelector(":scope > template"));
    if (!hosts.length) return;
    bh.ensureMarkers();
    const markers = doc.getElementById("bh-arrow") && doc.getElementById("bh-arrow").closest("svg");
    for (const host of hosts) {
      const root = host.attachShadow({ mode: "open" });
      root.append(el("style", { "data-hidden": "", text: HIDDEN_CSS })); // first, so its layer is the first
      adoptTheme(root);
      root.append(el("style", { text: (host.dataset.style === "old" ? oldStyle || "" : pageStyle()) + "\n" + SHADOW_CSS }));
      // url(#bh-arrow) in the theme resolves inside the tree it is used in.
      if (markers) root.append(markers.cloneNode(true));
      const body = el("div", { class: "bh-article" });
      body.append(host.querySelector(":scope > template").content.cloneNode(true));
      // Below 640px a diagram keeps its width and scrolls in its figure, which bh.js does not look at unless it is named.
      for (const fig of body.querySelectorAll("figure.diagram:not([data-scroll-region])")) fig.dataset.scrollRegion = "Diagram";
      root.append(body);
      const mark = host.closest("details.bh-diff-mark");
      if (mark) mark.addEventListener("toggle", measure); // the same listener however many copies the mark holds
    }
    measure();
    // A tree cannot see whether the change highlights are off around it, so bh.js writes it in.
    bh.mirrorChanges();
    // Nor whether unlisted or example elements are shown: until this runs, a tree hides them.
    mirrorSwitches();
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
      upgrade(article, data.oldStyle);
      if (article.querySelector(".bh-diff-ui svg")) bh.ensureMarkers();
      if (article.querySelector(".bh-diff-ui bh-versions")) bh.settle(bh.loadModule("versions.js"));
      // The reader asked for the changes, so a changed diagram shows its marks: the page's switch goes on.
      if (article.querySelector(".bh-diff-ui [data-change]")) bh.showChanges();
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

  bh.diff = { show, hide, upgrade, get base() { return shown ? shown.base : null; }, get placed() { return shown ? shown.placed : []; }, announce };
  window.bhModules = Object.assign(window.bhModules || {}, { "diff.js": true });
})();
