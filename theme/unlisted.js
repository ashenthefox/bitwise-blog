/* ==========================================================================
   Unlisted pages — whether they are shown, and the page fragment.

   A page marked <meta name="bh:unlisted" content="true"> is published and opens from its direct
   link, but the site does not surface it: it stays off the home page, search, backlinks and
   in-site links unless the page you are on was opened with #unlisted=true. This is discoverability
   control, not access control: the page, its address and the generated data are all public.

   Load it synchronously in <head>, right after theme/examples.js, so the decision is made before
   first paint. It sets
     <html data-unlisted="on|off">   whether unlisted pages are surfaced
     <html data-unlisted-page>       this page is unlisted
   and exposes window.bhUnlisted for bh.js and the modules.

   The flag lives in the fragment, remembered for the tab session so it survives following links:
     #unlisted=true  (or on / 1 / yes)   surface them
     #unlisted=false (or off / 0 / no)   hide them again
     #unlisted=auto                      forget the choice
   Unlike a private page's key it is not secret, so it stays in the address bar.
   Default is off everywhere, including local hosts, so an author sees what readers see.
   A bundled single file (<html data-bundled>) always shows its own content.

   The fragment is a list of &-separated tokens. Reserved: k=<43-char key> (repeatable, read by the
   sealed-page shell) and unlisted=<value>. The first other token without "=" is a section id.
   parseFragment is the one parser; bh.js uses it through bh.fragment().

   This file is the last synchronous script in every page's <head>, so it also holds the one other
   thing that must be settled before first paint: the change highlights' starting state (at the end).
   ========================================================================== */
(function (g) {
  "use strict";

  var STORE_KEY = "bh-unlisted";
  var KEY_RE = /^k=[A-Za-z0-9_-]{43}$/;

  /** "on", "off", "auto" or null for the value of an unlisted= token. */
  function parseValue(value) {
    value = String(value).toLowerCase();
    if (value === "true" || value === "on" || value === "1" || value === "yes") return "on";
    if (value === "false" || value === "off" || value === "0" || value === "no") return "off";
    return value === "auto" ? "auto" : null;
  }

  /** { id, unlisted, keys } for a location.hash: the section to scroll to ("" if none), the last
      unlisted= choice (null if none) and the k= tokens. A token that is neither reserved nor an
      id (it has "=") is ignored. */
  function parseFragment(hash) {
    var out = { id: "", unlisted: null, keys: [] };
    var tokens = String(hash || "").replace(/^#/, "").split("&");
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (!token) continue;
      if (KEY_RE.test(token)) { out.keys.push(token.slice(2)); continue; }
      var eq = token.indexOf("=");
      if (eq < 0) {
        if (!out.id) {
          try { out.id = decodeURIComponent(token); } catch (e) { out.id = token; }
        }
        continue;
      }
      if (token.slice(0, eq) === "unlisted") {
        var value = parseValue(token.slice(eq + 1));
        if (value) out.unlisted = value;
      }
    }
    return out;
  }

  /** { visible, source } for an environment: { hash, bundled, storage }. */
  function resolve(env) {
    if (env.bundled) return { visible: true, source: "bundle" };
    var storage = env.storage, asked = parseFragment(env.hash).unlisted;
    function store(fn) { try { return fn(); } catch (e) { return null; } }
    if (asked === "on" || asked === "off") {
      store(function () { storage.setItem(STORE_KEY, asked); });
      return { visible: asked === "on", source: "fragment" };
    }
    if (asked === "auto") store(function () { storage.removeItem(STORE_KEY); });
    else {
      var kept = store(function () { return storage.getItem(STORE_KEY); });
      if (kept === "on" || kept === "off") return { visible: kept === "on", source: "session" };
    }
    return { visible: false, source: "default" };
  }

  var api = { parseFragment: parseFragment, resolve: resolve, visible: false, source: "default", page: false };

  var doc = g.document;
  if (doc && g.location) {
    var storage = null;
    try { storage = g.sessionStorage; } catch (e) { /* blocked: the choice just isn't remembered */ }
    var root = doc.documentElement;
    var found = resolve({ hash: g.location.hash, bundled: root.hasAttribute("data-bundled"), storage: storage });
    api.visible = found.visible; api.source = found.source;
    // The marker is earlier in <head> than this script, so it has been parsed.
    api.page = !!doc.querySelector('meta[name="bh:unlisted"]');
    root.setAttribute("data-unlisted", api.visible ? "on" : "off");
    if (api.page) root.setAttribute("data-unlisted-page", "");
    // A new #unlisted=… in an open tab changes what the page should show: start over with it.
    if (g.addEventListener && !root.hasAttribute("data-bundled")) {
      g.addEventListener("hashchange", function () {
        // Only an explicit unlisted= in the new fragment changes the choice: a section link must not
        // reload the page (and, with sessionStorage blocked, lose the flag).
        if (!parseFragment(g.location.hash).unlisted) return;
        var next = resolve({ hash: g.location.hash, bundled: false, storage: storage });
        if (next.visible !== api.visible && g.location.reload) g.location.reload();
      });
    }
  }
  g.bhUnlisted = api;
})(typeof window !== "undefined" ? window : globalThis);

/* ==========================================================================
   Change highlights — the state a page opens in.

   Parts marked data-change are highlighted unless an ancestor has data-changes="off" (diagrams.css),
   so without JavaScript they show. With it, a page opens with them off and the top bar's button
   turns them on (changesButton in bh.js). bh.js is deferred, so the off state is set here, before
   first paint: set there, the marks could paint first and then vanish.

   It sets <html data-changes="off"> unless the page starts with them on, and exposes
   window.bhChanges.startsOn(), the one rule for that, which bh.js reads too. This script cannot
   know whether the page marks anything; bh.js takes the attribute away again on a page that has no
   mark, and so no button.

   A diff page (<html data-bh-diff>, npm run diff) starts on. The marker is on <html> because this
   runs in <head>, in a bundle too (bundle keeps the synchronous head scripts where they are), and
   there is no body yet.

   The marks must show wherever there is no button to ask with, so until bh.js has settled the
   switch (it sets bhChanges.settled, once the top bar is built) this block stands in for it:
     - on paper: beforeprint lifts the off state and afterprint puts it back. Once bh.js has
       settled the switch its own pair of handlers does this, and these two do nothing.
     - if bh.js never settles it (it failed to load, or threw first), the off state is lifted once
       the page has loaded, for good. The flag is the test, not window.bh: a script that half ran
       has made no button.
   ========================================================================== */
(function (g) {
  "use strict";

  /** True when the page opens with its change highlights on: a page that is itself a diff. */
  function startsOn(doc) {
    return !!(doc && doc.documentElement && doc.documentElement.hasAttribute("data-bh-diff"));
  }

  /** `settled` is set by bh.js once it has made the page's switch agree with the page (buildChrome). */
  var api = { startsOn: function () { return startsOn(g.document); }, settled: false };

  var doc = g.document;
  var root = doc && doc.documentElement;
  if (root && !startsOn(doc)) {
    root.setAttribute("data-changes", "off");
    if (g.addEventListener) {
      // Until bh.js settles the switch, the off state is this block's to lift and put back.
      var waiting = true, lifted = false;
      // bh.js is deferred, so it has run by now if it is going to.
      g.addEventListener("load", function () {
        waiting = false;
        if (!api.settled) root.removeAttribute("data-changes");
      });
      g.addEventListener("beforeprint", function () {
        lifted = !api.settled && root.getAttribute("data-changes") === "off";
        if (lifted) root.removeAttribute("data-changes");
      });
      g.addEventListener("afterprint", function () {
        // Not after the page loaded without bh.js settling: the off state was lifted for good then.
        if (lifted && waiting && !api.settled) root.setAttribute("data-changes", "off");
        lifted = false;
      });
    }
  }
  g.bhChanges = api;
})(typeof window !== "undefined" ? window : globalThis);
