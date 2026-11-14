# Discuss this post

Read this before touching the "Discuss this post" block, `bh:discuss`, `bh.discussionsUrl` or
`bh.discussionCategory`.

Every post ends with a "Discuss this post" callout that links to the post's conversation on GitHub
Discussions, and separately to the Review panel for a comment on one passage. It is generated:

- **The markup** is `<aside class="callout no-glossary" id="discuss" data-linkable data-discuss>`, a
  direct child of the article just before `<footer class="bh-footer">`. `npm run index` writes it,
  repairs a stale, duplicated or misplaced one, and removes it from a page that should not have one.
  It is static, so it works without JavaScript. `check` fails on a missing, hand-edited, duplicated or
  misplaced block, and on one where it does not belong. Don't write or edit it by hand.
- **One thread per page, keyed by the canonical URL.** The first link searches the repo's discussions
  for that URL (`github.com/search?type=discussions&q=repo:OWNER/REPO "<url>"`); the second ("start
  it") opens `…/discussions/new` with the category, the page title and a body carrying the URL, so the
  first thread started from the page is the one the search finds. Once a post has a thread, pin it
  with `<meta name="bh:discuss" content="https://github.com/OWNER/REPO/discussions/<n>">` and the block
  links straight to it. The search is best effort: two readers can still start two threads at once.
- **Which pages:** public, listed posts only, the [feed](feed.md)'s rule without the date: not
  unlisted, not examples, not `reference` pages (glossary, component gallery, format reference),
  never the home page, templates, private sources or sealed shells. Bundles strip it. **To turn it
  off for one page**, add `<meta name="bh:discuss" content="off">` and run `npm run index`. A private
  page that carries one fails `check` with "delete it": `index` never edits a private source.
- **Where it points** comes from `package.json`: `bh.discussionsUrl` (default `<bh.repoUrl>/discussions`,
  or `BH_DISCUSSIONS_URL`; it must be `https://github.com/OWNER/REPO/discussions`) and
  `bh.discussionCategory` (the category's slug, default `general`). A fork that sets `bh.repoUrl` gets
  its own threads. `"discussionsUrl": ""` switches the block off on every page.
- **The repo must have Discussions switched on**, with that category, or both links lead to a 404.
- The block is not search text (in slide mode it closes the last slide), and the Review link is left out on a page with `<body data-review="off">`.
