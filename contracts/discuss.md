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

## Finding threads that are not pinned

`npm run discussions` (`scripts/discussions.mts`) is the report that tells the author a post needs a pin. It
lists the repo's discussions with `gh api graphql` (so it needs `gh` logged in, or `GH_TOKEN`) and matches each
thread to the posts whose canonical URL its body quotes: the URL the "start it" link puts there. A thread that
quotes no post's URL but repeats a post's exact title is matched by title alone, which the report says. It only
reads: it edits no page and opens no issue. `.github/workflows/discussions.yml` runs it every Monday (and from the
Actions tab) with `discussions: read`, writes the report to the job summary, and fails the job while a problem
stands, so GitHub's failed-run email is the notice. Exit status: 0 nothing to fix, 1 a problem, 2 the report itself
failed (`gh`, an unreachable repo, a bad `bh.discussionsUrl`).

What to do with each finding:

- **Thread exists, post not pinned.** Add `<meta name="bh:discuss" content="…/discussions/<n>">` to the post and run
  `npm run index`, so the block links to the thread and drops "start it". If it was matched by title only, open the
  thread first: if it is about another post, retitle it.
- **More than one thread.** Merge them in GitHub (or close all but one), then pin the one that is left. Until then
  the post is not pinned to either. A thread that quotes several posts' URLs (a roundup) counts for each of them, so
  it can show up as a duplicate; remove the extra URLs from it, or turn the block off on the post with
  `bh:discuss` `off` if it should not have a thread of its own.
- **Pinned to a thread that does not mention the post.** The pin points at the wrong thread, or at a thread
  started by hand without the post's URL. Pin the thread the report names, or add the URL to the pinned thread's
  first post. A pinned thread that no longer exists is not reported here: `npm run links` reports it as broken.
- **A discussion quotes an unlisted page** (a note, which does not fail the run). Unlisted controls discoverability,
  and a public thread that quotes the page widens it; the only fix is to edit the thread, if that matters.

The report can run in a public workflow, so it names an unlisted page only as "an unlisted page" (never its path or
title), never matches an unlisted page by title, and never reads a private page or sealed shell. It prints thread
numbers, not their titles or text. See [External links](external-links.md) for the same rule in the link check.
