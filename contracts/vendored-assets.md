# Vendored assets

Read this before touching `theme/fonts/`, `theme/fonts.css`, `theme/vendor/`, `scripts/vendor.mts`,
`VENDOR` in `bh.js`, `scripts/remote-assets.mts`, or a page's `<script src>` or stylesheet `<link>`.

- **The theme loads nothing from another host.** The fonts are in `theme/fonts/` (declared in
  `theme/fonts.css`, OFL licences beside them) and Prism and Mermaid in `theme/vendor/<name>-<version>/`
  (MIT licences beside them), so no reader's IP address reaches a CDN and renders are the same offline.
  The one third-party request left is GoatCounter's `count.js`, added at deploy time only (see
  [Page-view counting](page-views.md)).
- **Upgrading.** `npm run vendor` (`scripts/vendor.mts`, needs the network) re-fetches them at the
  versions pinned there (for the fonts, Google's family versions, `FONT_VERSIONS`). To upgrade, change
  the version there and in `VENDOR` in `bh.js`, run it, then `visual` and `cards`.
- **What `check` enforces.** It fails on a remote `@import` or `url()` in `theme/*.css` or a page's
  `<style>`, on another host's URL in theme scripts, when `bh.js` and `scripts/vendor.mts` disagree,
  and on a page `<script src>` or stylesheet `<link>` on another host without an exact version and an
  `integrity` hash. It warns on a `language-x` code block that the vendored Prism can't highlight (add
  the language to `PRISM_LANGUAGES`).
- **Bundles.** `bundle` inlines the fonts as `data:` URIs and the vendored scripts a page uses.
