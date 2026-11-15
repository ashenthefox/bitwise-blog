// Which pages are hidden, and from which consumer: the one definition the feed, `check` and
// `publish.mts` share (see docs/visibility-threat-model.html). Node built-ins only and no side
// effects, so a script that does not import bh.mts (publish, the link checker) can use it.
//
// A page is hidden in one of four ways, and each consumer treats them differently on purpose:
//
//   example   hidden by default; deleted from the published site.
//   unlisted  published, but off the listings; a link to it is inert in the browser.
//   sealed    the encrypted shell of a private page; published, but a link to it reveals the page.
//   private   the plaintext source (`*.private.html`); never leaves the author's machine.
//
// HIDDEN_RULE is that policy as a table. It is a total Record, so a new kind cannot be added without
// deciding what each consumer does with it, and tests/hidden-pages.test.mts runs every consumer
// against it.

import fs from "node:fs";
import path from "node:path";
import { PRIVATE_EXT } from "./reviews.mts";

export const HIDDEN_KINDS = ["example", "unlisted", "sealed", "private"] as const;
export type HiddenKind = (typeof HIDDEN_KINDS)[number];

/**
 * What each consumer does about a link to (or the presence of) a page of each kind:
 *  - feed:    a link in a feed entry's `<content>` is left as text (scripts/feed-content.mts).
 *  - check:   `npm run check` reports a link to it, as a warning or an error depending on the kind.
 *  - publish: the page is removed from the published artifact, so a link to it is unwrapped to text.
 *             Unlisted and sealed pages are published (a link to them still resolves), and a private
 *             source is never staged at all (publish refuses one), so only examples are removed.
 */
export const HIDDEN_CONSUMERS = ["feed", "check", "publish"] as const;
export type HiddenConsumer = (typeof HIDDEN_CONSUMERS)[number];

export const HIDDEN_RULE: Record<HiddenKind, Record<HiddenConsumer, boolean>> = {
  example: { feed: true, check: true, publish: true },
  unlisted: { feed: true, check: true, publish: false },
  sealed: { feed: true, check: true, publish: false },
  private: { feed: true, check: true, publish: false },
};

/** A sealed shell holds the encrypted payload and the sealed meta; either one marks it. */
export const isSealedShell = (html: string) => /<script\b[^>]*\bid="sealed-payload"/i.test(html) || /<meta\s+name="bh:sealed"/i.test(html);

const uncomment = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
const head = (html: string) => uncomment(html).match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
const metaTrue = (headHtml: string, name: string) => new RegExp(`<meta\\s+name="${name}"\\s+content="true"`, "i").test(headHtml);

/**
 * The kind of hidden page a file is, or null for an ordinary one. `file` is a name or path (a private
 * source is known by its `.private.html` name); `html` is the page's text. An example marker in a
 * comment does not count, and a sealed shell is judged before its head (it has no readable meta).
 */
export function classifyPage(file: string, html: string): HiddenKind | null {
  if (file.endsWith(PRIVATE_EXT)) return "private";
  if (isSealedShell(html)) return "sealed";
  const h = head(html);
  if (metaTrue(h, "bh:example")) return "example";
  if (metaTrue(h, "bh:unlisted")) return "unlisted";
  return null;
}

/**
 * Every hidden page under `<root>/docs`, keyed by root-relative path ("docs/x.html"). A private source
 * also hides its published twin (`docs/x.html`), which is the sealed shell once it exists and the
 * address it will have before then.
 */
export function hiddenPages(root: string): Map<string, HiddenKind> {
  const dir = path.join(root, "docs"), out = new Map<string, HiddenKind>();
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".html")).sort() : [];
  for (const name of names) {
    const kind = classifyPage(name, fs.readFileSync(path.join(dir, name), "utf8"));
    if (kind) out.set(`docs/${name}`, kind);
  }
  for (const name of names.filter((n) => n.endsWith(PRIVATE_EXT))) {
    const twin = `docs/${name.slice(0, -PRIVATE_EXT.length)}.html`;
    if (!out.has(twin)) out.set(twin, "private");
  }
  return out;
}

/** The root-relative paths of the pages `consumer` must treat as hidden. */
export function hiddenHrefs(root: string, consumer: HiddenConsumer): Set<string> {
  return new Set([...hiddenPages(root)].filter(([, kind]) => HIDDEN_RULE[kind][consumer]).map(([href]) => href));
}
