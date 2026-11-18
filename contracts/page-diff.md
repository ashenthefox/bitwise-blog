# Page diffs

Read this before touching `npm run diff`, `scripts/page-diff.mts`, `scripts/page-history.mts`,
`theme/diffs/`, `theme/modules/diff.js`, `theme/diff.css`, `?diff=`, or the Review panel's "changes since".

A page's history is in git. This feature shows what changed between two versions of a page as a
reader would see it, in three places that share one function, `diffPages` (`scripts/page-diff.mts`).

## How two versions are compared

- **Blocks first.** A block is a direct child of `<article class="bh-article">`. Blocks are matched by
  id, else by identical text; unmatched neighbours that share half their words are paired as
  *changed*; a block that turns up elsewhere (same id, same text, or 80% of the same words) is *moved*,
  not removed and added. So the page contract's rules (content as direct children, permanent ids) are
  what make a diff readable: renaming an id turns a change into a removal and an addition.
- **Then words.** Inside a changed block the prose is diffed word by word and written into the *new*
  version's markup as `<ins>`/`<del>`, only inside text that may hold them (never between table rows
  or list items), so the result always nests properly. An entity is one word.
- **Rows and items before words.** Inside a changed block, table rows and list items (`tr`, `li`, `dt`,
  `dd`) are aligned like blocks are, a row by its first cell. A row that stayed is compared only with
  itself, cell by cell when both versions have the same number of cells, and nested lists the same way
  in turn. A row that is gone is written back where it was as a row of its own, struck through and
  marked `data-diff="removed"`. A reordered row shows as gone in one place and added in another.
- **Pictures are compared whole.** An inline `<svg>`, a `<bh-sequence>`, a Mermaid sketch, a `<canvas>`
  and any `<script>` are never word-diffed. When one changes, the old and new figures are shown as a
  `<bh-versions>` pair, and each part with a `data-id` is marked `data-change` (removed, added, changed)
  unless the author marked it already. Those marks obey the page's change-highlight switch (the top
  bar's button, off when a page opens), so a diff turns it on: a diff page (`data-bh-diff`) starts with
  it on, and `diff.js` calls `bh.showChanges()` when it places a changed diagram. A copy drawn in a
  shadow tree cannot see the switch on its ancestors, so `bh.mirrorChanges()` writes `data-changes="off"`
  onto the tree's content whenever an ancestor has it; `upgrade` calls it for a new tree.
- **A page that marks nothing gets the switch while a diff's marks are on it.** The top bar has the
  button only when the page has a `data-change` part at load. So when `bh.showChanges()` finds none, it
  builds the button then, on, in its usual place, and a `bh-diff` listener takes it out again once
  nothing on the page is marked (the diff was closed) and puts it back for the next diff. Decided in
  #262: the pair's own "Show changes" button already covered that case, but a reader who knows the page's
  switch from other pages would find it missing only here, and building it late is a few lines in
  `showChanges`. The button never appears on a page with no marks and no diff. Taking the button out
  also turns the switch on, through the button's own state, so the page is never left with
  `data-changes="off"` and no control (a part marked later would be drawn plain, and leaving the slides
  would not switch it off again); and if the button had focus, focus moves to the control beside it.
- **How the source is wrapped or indented is not a change.** Comments are ignored.
- Each difference says what differs: `text`, `figure` (a picture), or `markup` (attributes or structure only).

## Copies of the old version are inert

Two versions in one document would repeat ids and run the page's script twice. So wherever the old
version is shown beside the live page, it is a copy with: no ids (ids inside a picture are prefixed,
with their `url(#…)` and `href="#…"` references), links turned into plain spans, no scripts, no event
handlers, controls disabled, headings turned into styled paragraphs, and custom elements turned into
`<div data-was="…">` so their scripts never run on the copy (`<bh-sequence>` is kept: it only draws itself).

**A copy styled by id gets a shadow tree.** Page CSS is scoped by id (`#my-figure .part`), and a copy
without ids would lose it. So where a version's page CSS names an id inside a block (`styledById`), the
mark carries a second copy with its ids kept, in a `<template>` inside `.bh-diff-shadow`, and
`bh.diff.upgrade` (`theme/modules/diff.js`) moves it into a shadow tree holding the theme, that version's
page CSS (the old version's travels in the data file as `oldStyle`, and on the diff page as a JSON script)
and the arrow markers. Ids in a shadow tree collide with nothing, and the old CSS styles nothing else. The
plain copy stays as the fallback until then, and without script. Two limits:

- A figure that the page's *script* draws (a canvas, SVG built at load) is still not drawn in a copy:
  nothing runs there.
- The theme reaches a shadow tree through one shared constructed stylesheet. Where its rules cannot be read
  (a page opened from `file://`), each tree gets its own copy of the theme's `<link>` or `<style>` instead.
  `bundle` marks the inlined theme `<style data-bh-theme>` so the page's own CSS can be told from it.

The word diff replaces a block *in place* only on the standalone diff page, and only when no custom
element is inside it: a component's script reads its content (a chart's table, a code walk's lines), and
an `<ins>` there would change what it computes. Such a block is left alone and its word diff is an inert
copy beside it. A changed code block loses its `language-*` class in place, because the highlighter would
erase the marks.

## The three places

1. **`npm run diff -- docs/<slug>.html [base] [head]`** writes `dist/diff/<slug>.html`: the new version,
   bundled into one file, with a mark before each block that differs and a list of the changes after the
   hero. `base` defaults to `HEAD`, `head` to the working tree. `dist/` is git-ignored.
   `npm run diff -- --changed <base> [--out <dir>] [--summary <file.md>]` does it for every page that
   differs from `<base>`.
2. **CI** (`render` job, pull requests only) runs the `--changed` form against the base commit: the diff
   pages go into the `renders` artifact under `diff/`, and the changed sections of each page into the job
   summary. It only reports. Both the `render` and `deploy` jobs check out the full history (`fetch-depth: 0`).
3. **The Review panel.** A thread whose first message was written on another commit has a "Changes since
   this comment" button, the panel has "Show changes since", and `?diff=<commit>` does the same from a
   link. `theme/modules/diff.js` loads `theme/diffs/<slug>.<commit>.js` and puts one mark before each live
   block that differs (a `<details>` holding the inert copy) and a change bar on the block. The page's own
   content is never rewritten, so comments stay anchored. For an outdated thread it opens the change whose
   old text holds the quote.

## Where the data comes from

`theme/diffs/` is **generated, never committed**, and nothing lists its files:

- `npm run serve` computes `theme/diffs/<slug>.<commit>.js` on request, for any commit, against the
  working tree.
- The deploy (`preparePublishedSite` → `writeReviewDiffs`) writes one file per page and commit that a
  merged review file names, against the staged page. A commit the clone lacks, or a page that did not
  exist then, is skipped with a warning.
- A bundle has none: "changes since" says there is no record.

So on the published site only versions that a review thread refers to can be compared. To compare
anything else, use `npm run diff`.

## Rules that guard what is published

- **A commit id from a review file or a URL is untrusted.** It reaches git only if it matches
  `COMMIT_RE` (7 to 40 hex digits), and a page path only if it matches `PAGE_RE`. Git is run without a shell.
- **No diff of a sealed page**, now or at the old commit, and none for a review whose `document` is
  private (`reviewDiffScript`, `reviewCommits`). A private page's plaintext has no git history anyway.
- **No diff of a page the site does not publish**: the deploy reads the staged pages, after example pages
  are removed.
- **An unlisted page's diff data** is named by its slug and requested only by that page. Do not add a
  manifest or index of `theme/diffs/`: it would list unlisted slugs with their history.
- **Published diff data re-publishes text that was since deleted.** It is in the public history either
  way; `docs/visibility-threat-model.html` records it. Rewriting history to remove text does not remove
  it from an already-deployed site until the next deploy.

## Changing it

- The core is pure and imports no installed package: `publish.mts` uses it, and the deploy job installs nothing.
- Status tags reuse the theme's badge tones, and `<ins>`/`<del>` sit on `--ok-soft`/`--danger-soft`; both
  are in `CONTRAST_PAIRS`. Colour is never alone: a mark carries a word, insertions are underlined,
  deletions struck through.
- `theme/modules/review.js` leaves `.bh-diff-ui` out of the text it anchors comments to. Anything the diff
  module adds to the page must carry that class.
- Tests: `tests/page-diff.test.mts` (alignment, the word diff's nesting, inert copies, the data file, the
  git helpers and the published file set on a throwaway repository).
  `tests/page-diff-browser.test.mts` runs `theme/modules/diff.js` in Chrome on a small page: where each
  mark lands, the outdated-thread jump, the Review panel, and phone width. It also covers the
  change-highlight switch, by the computed style of each marked part rather than its attribute: off to on
  for `?diff=` on a page with marks of its own, the late-built button on a page with none, and a diff page
  written by the real `bh diff` command, which opens with the highlights on. It is skipped without Chrome.
- The component gallery's "Diff marks" section is the visual regression sample.
