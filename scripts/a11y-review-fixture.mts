// A page that carries a published review thread, for `npm run a11y` (scripts/a11y.mts) to scan.
//
// No public page has a thread today, so without this the pins and the Review button's count badge, which only
// exist once a thread is published, are never in an axe run: the first review merged for a page would turn the
// Accessibility job red (#229). The page is served from memory beside the real pages, on the real theme, and its
// threads are inlined as `window.BH_REVIEWS` the way a bundle inlines them, so nothing is committed under
// `reviews/` or `docs/`. It is built to put pins where they are hardest to make a target of: stacked a line apart,
// beside a link button, with replies (a count on the pin) and one resolved (hidden, then shown by the panel's tick box).

/** Where the page is served, as a path from the site root (it must sit under docs/ so `../theme/` resolves). */
export const REVIEW_FIXTURE_PAGE = "docs/a11y-published-thread.html";

type Kind = "comment" | "suggestion" | "question" | "blocker";
interface Message { id: string; kind: Kind; body: string; anchor: string; anchorKind: "section" | "block"; quote: string | null; replies?: { id: string; body: string; resolves?: boolean }[] }

/** Tight rows: each is one line, so their pins fall about a line apart, closer than the 24px a pin needs. */
const ROWS = ["Burst", "Refill", "Per client", "Per key", "Per route"];

/** One thread per row, then one beside the figure's link button, then ones with replies, a resolved one and each kind. */
const THREADS: Message[] = [
  ...ROWS.map((row, i): Message => ({ id: `row-${i}`, kind: (["comment", "suggestion", "question", "blocker", "comment"] as Kind[])[i], body: `Why ${row.toLowerCase()}?`, anchor: "limits", anchorKind: "section", quote: row })),
  { id: "fig", kind: "question", body: "Is the gateway one process or many?", anchor: "gateway", anchorKind: "block", quote: null,
    replies: [{ id: "fig-r1", body: "Many, behind one address." }, { id: "fig-r2", body: "Then say so in the caption." }] },
  { id: "intro", kind: "blocker", body: "State the unit of the limit up front.", anchor: "limits", anchorKind: "section", quote: "A limit has a unit.", replies: [{ id: "intro-r1", body: "Added." }] },
  { id: "done", kind: "comment", body: "Fixed in the last revision.", anchor: "limits", anchorKind: "section", quote: "Nothing is shared.", replies: [{ id: "done-r1", body: "Done.", resolves: true }] },
];

const messages = (): unknown[] => THREADS.flatMap((t) => {
  const quote = t.quote === null ? null : { exact: t.quote, prefix: "", suffix: "" };
  const root = { id: t.id, created: "2026-11-01T09:00:00Z", kind: t.kind, body: t.body, author: "Reader", target: { anchor: t.anchor, anchorKind: t.anchorKind, quote } };
  const replies = (t.replies ?? []).map((r, i) => ({ id: r.id, created: `2026-11-01T09:0${i + 1}:00Z`, kind: "comment", body: r.body, author: "Author", inReplyTo: t.id, ...(r.resolves === undefined ? {} : { resolves: r.resolves }) }));
  return [root, ...replies];
});

const BODY = `<h2 id="limits">Limits</h2>
<p>A limit has a unit. Nothing is shared.</p>
<ul class="a11y-rows">${ROWS.map((r) => `<li>${r}</li>`).join("")}</ul>
<h2 id="gateway-section">The gateway</h2>
<figure class="diagram" id="gateway" data-label="Gateway">
  <svg viewBox="-16 -16 232 112" role="img" aria-label="A client calls a gateway"><g class="node c3" data-id="c"><rect x="0" y="16" width="70" height="48" rx="10"/><text x="35" y="40">Client</text></g><g class="node c1" data-id="g"><rect x="130" y="16" width="70" height="48" rx="10"/><text x="165" y="40">Gateway</text></g><path class="edge" data-id="e" d="M70 40 H119"/></svg>
  <figcaption>One client, one gateway.</figcaption>
</figure>
<p>Nothing else is here.</p>`;

/** The fixture page and the one route it needs, for `serveStatic`'s `routes`. */
export function reviewFixtureRoutes(): Map<string, { type: string; body: string }> {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Published thread fixture</title>
<link rel="stylesheet" href="../theme/bh.css"><style>.a11y-rows { margin: 0; padding: 0; list-style: none } .a11y-rows li { margin: 0 !important; line-height: 23px }</style>
<script>window.BH_REVIEWS = ${JSON.stringify({ [REVIEW_FIXTURE_PAGE]: messages() })};</script>
<script src="../theme/bh.js" defer></script></head>
<body><main class="bh-page"><article class="bh-article"><header class="bh-hero"><h1>Published thread fixture</h1></header>${BODY}</article></main></body></html>`;
  return new Map([[`/${REVIEW_FIXTURE_PAGE}`, { type: "text/html; charset=utf-8", body: html }]]);
}
