# Social cards

Read this before touching the social meta block, `bh:image`, `npm run cards`, `scripts/cards.mts`, `social-cards.txt` or `docs/assets/og/`.

Every public page unfurls into a rich preview (Open Graph and Twitter `summary_large_image`)
when its link is pasted into Slack, Discord, iMessage, LinkedIn, X or Mastodon. Authors write
nothing for this; two generated things do the work.

- **The social meta block.** `npm run index` writes it into each page's `<head>`, between
  `<!-- bh:social:start … -->` and `<!-- bh:social:end -->`: `canonical`, `og:type`,
  `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image` (+ type, size, alt),
  `article:published_time`, `article:author`, `article:tag` and `twitter:card`. It is derived
  from the page's own `title`, `description` and `bh:*` metas, so fix a preview by fixing
  those. **Never write `og:`, `article:`, `twitter:` or `canonical` tags by hand**: `check`
  fails on them, and on a missing or stale block. Keep the marker pair in the `<head>`
  (the templates have it). Keep descriptions under about 200 characters, since previews cut
  them off (`check` warns).
- **Structured data.** The block also ends with one `<script type="application/ld+json">` line
  of schema.org data, for search engines: a `TechArticle` on each post (headline, description,
  `datePublished`, authors, keywords, url, card image, publisher) and a `WebSite` on the home
  page. Posts are the feed's: example, unlisted and `reference` pages get none, and sealed
  shells never have a block. The text is decoded from the page's HTML, and `</` and `<!--` are
  JSON-escaped so a title cannot end the script. **Never write JSON-LD by hand**: `check` fails
  on one outside the block, and the block's equality check catches a missing or stale one.
  `bundle` drops its `url` and `image` (the publisher's site link stays, like the footer's
  attribution link); `publish` refuses an unlisted page that carries one.
- **The card image**, `docs/assets/og/<slug>.png`, 1200×630. `npm run cards` renders it in
  the local Chrome (Node ≥ 22; `CHROME_PATH` if it isn't found). It needs no network: the fonts
  are the theme's own (`theme/fonts/`). It frames a **visual taken from the page itself** with the logo, the title, the
  kind and the date, so a bare diagram still says something in a chat unfurl. The visual is
  the first match of:
  1. `<meta name="bh:image" content="#element-id">` (an element on the page) or
     `content="path/to/image.png"` (relative to the page): the author's override, for when
     the automatic pick is wrong;
  2. the first `<figure>` with an `<svg>`, `<img>`, `<bh-sequence>` or `<bh-chart>`;
  3. a standalone `<img>` in the article;
  4. the hero glyph (`bh-hero-mark`);
  5. the logo tile (`theme/logo/mark-tile.svg`).

  The element is screenshot from the real page in the light theme, so diagrams keep their
  theme colours. Because the choice is made from the source, put the diagram that best
  explains the page first, or set `bh:image`.
- **A card shows the change highlights.** A page opens with its `data-change` marks switched off
  (`data-changes="off"` on `<html>`) and a button in the top bar to ask for them. The rule for a
  place with no button is that the marks show: without JavaScript, in print and in the slides. A
  card has no button either, and it is the first thing a reader sees of a page whose subject is a
  change, so before the screenshot `scripts/cards.mts` lifts, as printing does, every
  `data-changes="off"` in the document: the page's switch on `<html>`, and a `<bh-versions>` switched
  off on its own. The page's button follows the attribute on `<html>`, so it says on as well and
  cannot switch the marks off again. The card therefore differs from the page as it opens:
  that is decided, not a bug. No `data-changes` attribute decides what a card shows, so none is
  part of the staleness hash below.
- **Staleness.** A card's *key* is a hash of the chosen visual's source and image files, the
  title, kind, date, site name, the page's `<style>`,
  `theme/{fonts,tokens,base,layout,components,diagrams}.css`, the font files, `theme/bh.js`, the logo and
  `scripts/cards.mts` (plus `theme/modules/*.js` when the visual is a `<bh-…>` component).
  So a theme change makes every card stale: re-run `npm run cards` along with
  `npm run visual`.
- **The records, `social-cards.txt`.** The key is not in the PNG. One generated text file at the
  root of the repository holds, for each card, one line in slug order:
  `<slug> <key> <sha-256 of the PNG>` (the key is `fallback` for a copy of the shared card). The
  PNG's hash binds the record to the exact file committed with it, so a PNG from one side of a
  merge and a record from the other cannot pass.
  - **`npm run cards`** draws every card whose record is missing, names another key or another
    PNG. When the new picture has exactly the pixels of the PNG already on disk, it leaves that
    file's bytes alone and only rewrites the record; otherwise it writes the new PNG. So a theme
    change that moves no pixel changes one text file and no binary, and two such pull requests
    no longer conflict on PNGs. It also deletes orphan cards and records, rewrites the file in its
    canonical form, and keeps going when one page can't be drawn (it then exits non-zero and names
    it, and that card keeps its old, stale record; a figure hidden in an inactive tab needs `bh:image`).
  - **"The same pixels" means exactly the same**: both PNGs are decoded (`scripts/png.mts`) and
    every channel of every pixel must match; the encoding, compression and any text chunk may
    differ. There is no tolerance because none is needed on one machine: on 2026-11-18, two forced
    renders of all 16 cards in Chrome 157 on macOS were byte-identical to each other and to the
    committed PNGs (0 differing pixels). Another machine's Chrome may draw a few pixels
    differently; such a card is then rewritten, which is the honest outcome, and no worse than
    before. A tolerance would hide a real small change, such as a token nudged by one step.
  - **`check`** needs no browser. It recomputes each key and fails when a card's record is
    missing, names another key (the card is stale) or another PNG, when a record or a PNG has no
    public page, when a line is not a record (a merge conflict left in), and when the file is not
    in its canonical form. So `check` still fails whenever a card's picture could differ from the
    one committed. Commit the PNGs and `social-cards.txt` together.
  - **After a rebase or merge** onto a main that changed the theme, run `npm run cards` and commit
    what it changes. **A conflict in `social-cards.txt` resolves the same way:** take either side
    (or leave the conflict markers in), run `npm run cards`, and commit. A line it cannot read, or a
    slug listed twice, counts as no record, so those cards are drawn again and compared with the
    PNG on disk. A conflict in a PNG itself (both sides changed its pixels): take either side and
    run `npm run cards`. Rendering needs Chrome, so the records cannot be soundly regenerated
    without it.
  - Cards drawn before the records existed still carry a `tEXt` chunk named `bh-card` with an old
    key. Nothing reads it, and it goes when that card's pixels next change.
- **No Chrome.** `npm run cards` then replaces each missing or stale card with a copy of the
  shared site card (`theme/logo/og.png`), recorded as `fallback`. `check` accepts that locally with
  a warning, so you are not blocked, but **fails under `CI`**: render the card where Chrome
  exists before the PR merges. Rendering needs Node ≥ 22.
- **Visibility.** `social-cards.txt` names the same slugs as the file names in `docs/assets/og/`
  (every public page, example and unlisted ones included; never a sealed or private one) and only
  hashes besides. It sits outside `docs/` and `theme/`, the directories the deploy copies, so it is
  never published, and it cannot reveal an example page's slug on the site, from which the deploy
  removes the example's card (see `docs/visibility-threat-model.html`).
- **The home page** uses the shared site card. **Bundles** (`npm run bundle`) keep
  `og:title`, `og:description` and `article:*` but drop `canonical`, `og:url`, `og:image*` and
  `twitter:*`, since a standalone file has no URL or card of its own.
- **Absolute URLs** come from one place: `homepage` in `package.json`
  (`https://bitwise.john-ky.io/`). A fork sets that, or `BH_SITE_URL`. The site
  name is `bh.siteName` in `package.json`. Changing either makes the block and every sealed
  shell stale: run `npm run index`, `npm run cards` and `npm run seal -- --reshell`.
- **Private pages** unfurl as one generic "Private page" card: see [Private pages](private-pages.md).
- Render the cards and look at them when you change `scripts/cards.mts`, the theme tokens or
  a diagram's colours. `docs/assets/og/` holds only cards, one per public page, and
  `social-cards.txt` one record per card.
