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
- **Pictures are compared whole.** An inline `<svg>`, a `<bh-sequence>`, a Mermaid sketch, a `<canvas>`
  and any `<script>` are never word-diffed. When one changes, the old and new figures are shown as a
  `<bh-versions>` pair, and each part with a `data-id` is marked `data-change` (removed, added, changed)
  unless the author marked it already.
- **How the source is wrapped or indented is not a change.** Comments are ignored.
- Each difference says what differs: `text`, `figure` (a picture), or `markup` (attributes or structure only).

## Copies of the old version are inert

Two versions in one document would repeat ids and run the page's script twice. So wherever the old
version is shown beside the live page, it is a copy with: no ids (ids inside a picture are prefixed,
with their `url(#…)` and `href="#…"` references), links turned into plain spans, no scripts, no event
handlers, controls disabled, headings turned into styled paragraphs, and custom elements turned into
`<div data-was="…">` so their scripts never run on the copy (`<bh-sequence>` is kept: it only draws itself).

**A copy loses page CSS that is scoped by id.** A figure styled by `#my-figure …` in the page's
`<style>` renders unstyled as a copy. For those, open the old page itself (`git show <commit>:docs/<slug>.html`).

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
- The component gallery's "Diff marks" section is the visual regression sample.
