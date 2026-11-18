# Unlisted pages

Read this before touching `bh:unlisted`, `#unlisted=true`, `theme/unlisted.js`, the unlisted data files, the page fragment
or the state the change highlights open in.

An unlisted page is published and opens from its direct link, but the site itself does not
surface it. **This is discoverability control, not access control.** The page's HTML, the repo,
its history, the deployed artifact and `theme/unlisted-pages.js` are all public. Use a private
(sealed) page when the content itself must stay secret, and never describe an unlisted page as
private.

| Mechanism             | Direct link works?           | Content hidden? | Listed on the site?        |
| --------------------- | ---------------------------- | --------------- | -------------------------- |
| normal page           | yes                          | no              | yes                        |
| example page          | no on the published site (404) | no            | local only                 |
| private (sealed) page | yes, but shows a notice      | yes (encrypted) | no                         |
| **unlisted page**     | **yes, readable**            | no              | **only with `#unlisted=true`** |

- **Mark one** with `<meta name="bh:unlisted" content="true">` in the `<head>`, or create it with
  `npm run new -- --unlisted <template> <slug> "<Title>"`. The marker is the only thing that
  counts. `check` fails on the `unlisted` tag (reserved), on a marker that is not `true`, and on
  a private source (a private page already stays off the site). A page may be both an example and
  unlisted: the stricter rule (removed from the published site) wins.
- **What stays.** The page is published at its normal address and is checked like any other. It
  keeps a social card, so a pasted link unfurls well. The build adds
  `<meta name="robots" content="noindex, nofollow">` to its generated social block; write nothing.
  `noindex` stops compliant crawlers, not anyone who has the URL. It keeps review as well, with the
  same instruction to submit in a public pull request: the pull request quotes the page and names its
  path, both public already (the path is in `theme/unlisted-slugs.js`), though easier to come across
  there. A private page, whose text is secret, has no review.
- **What is left out** unless the flag is on: the home page's cards (`cmdIndex` does not write them
  into `index.html`), header search (`theme/search-index.js`), backlinks and "Referenced by"
  (`theme/site.js`), review summaries, and `bundle --all` (naming a page still bundles it).
  Links to an unlisted page are inert text (no `href`, not focusable, `aria-disabled`).
- **The flag** is `#unlisted=true` (also `on`, `1`, `yes`) in the fragment of any page. It is kept
  for the tab session in `sessionStorage["bh-unlisted"]`, so following links keeps it; a new tab
  does not. `#unlisted=false` turns it off and `#unlisted=auto` forgets it. It is not secret, so it
  stays in the address bar; the "copy link" controls still copy only `#id`. **Default is off
  everywhere, local hosts included**, so an author sees what readers see; `npm run serve` prints
  the hint. Pasting a new `#unlisted=…` into an open tab reloads the page.
- **One script decides.** `theme/unlisted.js` is a synchronous script in every page's `<head>`,
  after `examples.js`. It sets `<html data-unlisted="on|off">` (and `data-unlisted-page` on an
  unlisted page) before first paint and owns the fragment parser. `check` fails if a page or
  template lacks it, or if the marker comes after it.
- **Two generated data files, never edited by hand.** `theme/unlisted-pages.js` (`BH_UNLISTED`:
  card data, search text and backlinks of every unlisted page) is fetched **only when the flag is
  on**, so with it off no unlisted title is in any file the page loads. `theme/unlisted-slugs.js`
  holds their paths alone, so `bh.js` can make links to them inert when the flag is off.
  `check` fails when either is stale. An unlisted page's published review threads are in neither
  `site.js` nor `theme/reviews.js` (which every listed page may load): they are in the generated
  `theme/unlisted-reviews.js`, which only the unlisted page itself loads.
- **Cards.** On the home page `theme/modules/unlisted-cards.js` adds one card per unlisted page
  (text only, never `innerHTML`), labelled "Unlisted · <Kind>" in words, before `<bh-filter>`
  re-reads the list (`BhFilter.refresh()`), so chips and the search box cover them.
  `data-bh-ready` waits for it. The card builder is `bh.cards.build`; keep its markup equal to
  `cardHtml` in `scripts/bh.mts` (`tests/unlisted.test.mts` compares them).
- **Links.** A listed page that links to an unlisted one gets a `check` warning: the link is inert
  by default. An unlisted page (and the glossary) may link to one freely; on an unlisted page
  links to other unlisted pages stay live, so a series can be shared as one. Without JavaScript
  every `href` still works: the neutralising is script-only. A decision chain
  (`bh:supersedes` / `bh:superseded-by`) must be all listed or all unlisted.
- **The published site.** `scripts/publish.mts` keeps unlisted pages and their cards, and applies
  the same rules when it rebuilds the index, search, backlinks and the two data files.
- **Prefer a non-guessable slug** (for example a random suffix) for a page meant to be shared by
  link: it is the only protection against guessing.
- **Bundles** show their own content wherever they are opened (`<html data-bundled>`). `bundle`
  inlines this script, like every synchronous script in a page's `<head>`, where it stands, so it
  still runs before first paint; only the other scripts (`bh.js`, its modules, the page's own) go to
  the end of `<body>`.

## The page fragment

A fragment is a list of `&`-separated tokens, parsed in one place (`parseFragment` in
`theme/unlisted.js`, used through `bh.fragment()`). Reserved: `k=<43-char key>` (a private page's
key, repeatable) and `unlisted=<value>`. The first other token without `=` is a section id to
scroll to, so `#k=<key>&unlisted=true&my-section` works on a sealed page. **Write `k` first**:
the sealed-page shell (frozen, so as not to make every sealed page stale) reads
`#k=<key>[&rest]` and, after decrypting, keeps `rest` (`unlisted=true&my-section`) in the address
bar for `bh.js`; `#unlisted=true&k=<key>` does not open a sealed page.

## Change highlights before first paint

`theme/unlisted.js` is the last synchronous script in every page's `<head>`, so it also holds the one
other thing that has to be settled before first paint, although it has nothing to do with unlisted
pages. A new file would need a new tag in every page, template and sealed private source.

- Parts marked `data-change` are highlighted unless an ancestor has `data-changes="off"`
  (`theme/diagrams.css`). That is the state without JavaScript: the highlights show.
- With JavaScript a page opens with them off. `bh.js` is deferred and can run after the page has
  painted, so the last block of `theme/unlisted.js` sets `<html data-changes="off">` first, on every
  page: it cannot know whether marks follow. `bh.js` then settles it. On a page with marks,
  `changesButton()` keeps the state and adds the top bar's button. On a page with none it removes the
  attribute, so a mark that arrives later shows. On a page with no top bar (`data-chrome="none"`)
  `buildChrome()` removes the attribute itself and never calls `changesButton()`.
- **One rule for the starting state**: `window.bhChanges.startsOn()`, which both scripts call. It is
  true for a diff page (`<html data-bh-diff>`, written by `renderDiffPage`). The marker is on
  `<html>` because the rule is first asked in `<head>`, where there is no body yet. Nothing reads
  it from `<body>`: a diff page made before #274 has it there, and carries its own copy of the
  scripts that read it there.
- **Until `bh.js` has settled the switch, the block stands in for it.** `bh.js` sets
  `bhChanges.settled` once the top bar, with the button, is on the page (or it has found there is to be
  no top bar). Before that:
  - printing lifts the off state (`beforeprint`) and puts it back (`afterprint`), since paper has no
    button. After that the pair in `bh.js` does it and the block's handlers do nothing, so the state is
    never restored twice.
  - if the page finishes loading and the flag is still unset (`bh.js` failed to load, threw before it
    built the top bar, or is an older cached copy that does not know the flag), the off state is lifted
    for good. The flag is the test, not `window.bh`: a script that half ran has made no button. With an
    older cached `bh.js` on a page that has marks, the highlights then show while its button says off
    until the first click; a page with no marks ends as it should.
- **A bundle is covered too.** `bundleHtml` leaves a synchronous script that is in `<head>` in
  `<head>`, inlined in place and in order, so a bundle that arrives slowly has the off state before
  its body is painted (#274: with every script at the end of `<body>`, a held-back bundle painted
  its highlights on every frame until the rest arrived). A script added to a page's `<head>`
  gets the same treatment unless it has a `defer` or `async` attribute or a `type` of `module`
  (in double quotes, single quotes or none), so it must not need anything a bundle lacks (a file
  beside the page, the body). Two limits of the bundler itself: it inlines only a tag written
  `<script src="…" …></script>`, with a double-quoted `src` as its first attribute (any other
  external script is left as a tag, which a standalone file cannot load), and a module that it
  moves to the end of `<body>` becomes a classic script there. The text of a head script is put
  in last, at a placeholder, so nothing `bundleHtml` replaces elsewhere (`</head>`, `</body>`,
  links back into the site) can match inside it; `tests/unlisted.test.mts` bundles a page whose
  head script says all of those.
- Tests: `tests/unlisted.test.mts` (the rule) and `tests/versions.test.mts`, which holds `bh.js`
  back in Chrome and checks that no frame has marked parts without the off state, and that the
  highlights show with scripting off, when printing before `bh.js` runs, when `bh.js` fails or throws, and
  on a page with `data-chrome="none"`. `tests/page-diff-browser.test.mts` makes a bundle and a diff
  page with the real commands, holds back everything after `</main>`, and checks that the bundle has
  no frame with marked parts and no off state, and that the diff page is never off.
