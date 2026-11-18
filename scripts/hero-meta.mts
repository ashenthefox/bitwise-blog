// The hero's list of facts and a superseded page's banner, as markup in the page itself (#298).
//
// `<dl class="bh-meta" data-auto>` holds the page's status, date, authors, reading time and tags, and its
// decision links; a page with bh:superseded-by also has a "Superseded" banner right after the hero.
// `npm run index` writes both from the page's bh:* metas (`npm run seal` into a private page, before it
// encrypts it), so they read without JavaScript and nothing below the hero moves when bh.js arrives.
// bh.js builds them only where the list is empty: a page diff (whose copies are compared without them),
// or a page written before they were generated.
//
// No side effects and no installed package: scripts/page-diff.mts (and through it publish.mts) imports it.

/** The generated list, empty or not. `data-auto` is the marker: a list without it is the author's. */
export const HERO_META_RE = /<dl class="bh-meta" data-auto>[\s\S]*?<\/dl>/;
export const EMPTY_HERO_META = '<dl class="bh-meta" data-auto></dl>';
/** The generated banner, with the line break and indent before it (it is written on its own lines after the hero). */
export const SUPERSEDED_RE = /\n[ \t]*<aside class="callout warn bh-superseded"[^>]*>[\s\S]*?<\/aside>/;
/** The hero, from its indent to its end tag. */
export const HERO_RE = /^([ \t]*)<header class="bh-hero"[^>]*>[\s\S]*?<\/header>/m;

const all = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");

/** `html` with the generated list emptied and the banner taken out: what bh.js saw before they were generated. */
export function withoutHeroMeta(html: string): string {
  return html.replace(all(HERO_META_RE), EMPTY_HERO_META).replace(all(SUPERSEDED_RE), "");
}

/** One row of the list: its term, and its description as HTML. */
export interface HeroMetaRow { term: string; html: string }

/** The list holding `rows`, its rows on lines of their own one step in from `indent` (the list's own). */
export function heroMetaList(rows: HeroMetaRow[], indent: string): string {
  if (!rows.length) return EMPTY_HERO_META;
  return [`<dl class="bh-meta" data-auto>`, ...rows.map((r) => `${indent}  <div><dt>${r.term}</dt><dd>${r.html}</dd></div>`), `${indent}</dl>`].join("\n");
}

/** The banner that says `link` (HTML) replaced the page, starting with a line break, at `indent` (the hero's). `decision`: bh:kind is "decision". */
export function supersededBanner(link: string, decision: boolean, indent: string): string {
  const text = decision
    ? `This decision has been replaced by ${link}. It is kept as the record of why things were once done this way.`
    : `This page has been replaced by ${link}. It is kept as an archive, so links to it still work.`;
  return [
    "",
    `${indent}<aside class="callout warn bh-superseded" role="note">`,
    `${indent}  <p class="callout-title">Superseded</p>`,
    `${indent}  <p>${text}</p>`,
    `${indent}</aside>`,
  ].join("\n");
}

/** "N min" as bh.js has always shown it, or "" for a page of 150 words or fewer. */
export const readingTime = (words: number): string => (words > 150 ? `${Math.max(1, Math.round(words / 230))} min` : "");

// ---- The article's words, counted as the browser counts `article.textContent` ------------------
//
// bh.js counted `textContent.trim().split(/\s+/)` of the first `.bh-article`, before it changed anything
// in it. textContent joins the text of every node in order: a tag adds no space ("<p>a</p><p>b</p>" is one
// word), a script's or a style's text counts as written, entities are decoded, and a comment and a
// template's content do not count. So the count here is those rules, on the page as it was before the
// list and the banner were generated.

/** Elements whose content is text, not markup: kept as written. (A page is read with scripting on, so <noscript> too.) */
const RAW_TEXT = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript"]);
/** Elements whose content is text with entities decoded. */
const RCDATA = new Set(["textarea", "title"]);
/** A comment, or a start or end tag (quoted attribute values may hold ">"). Text is what lies between. */
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
/** Named entities that decode to white space; every other one is a character of a word. */
const SPACES: Record<string, string> = { nbsp: " ", NonBreakingSpace: " ", ensp: " ", emsp: " ", emsp13: " ", emsp14: " ", numsp: " ", puncsp: " ", thinsp: " ", ThinSpace: " ", hairsp: " ", VeryThinSpace: " ", MediumSpace: " ", NewLine: "\n", Tab: "\t" };

const decodeText = (s: string) => s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g, (_m, dec: string, hex: string, name: string) => {
  if (name) return SPACES[name] ?? "x";
  const code = dec ? Number(dec) : parseInt(hex, 16);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
});

/** The text of the page's first `<article class="… bh-article …">`, as its textContent, without the generated list and banner. */
export function articleText(html: string): string {
  const src = withoutHeroMeta(html), lower = src.toLowerCase();
  const re = new RegExp(TOKEN.source, "g");
  let text = "", last = 0, depth = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(src)); ) {
    if (depth) text += decodeText(src.slice(last, m.index));
    last = re.lastIndex;
    const [, close, rawName, attrs] = m;
    if (!rawName) continue; // a comment
    const name = rawName.toLowerCase();
    if (!close && (RAW_TEXT.has(name) || RCDATA.has(name) || name === "template")) {
      // Its content runs to its end tag, whatever it looks like.
      const end = lower.indexOf(`</${name}`, re.lastIndex), stop = end < 0 ? src.length : end;
      const inner = src.slice(re.lastIndex, stop);
      if (depth && name !== "template") text += RCDATA.has(name) ? decodeText(inner) : inner;
      re.lastIndex = last = stop;
      continue;
    }
    if (name !== "article") continue;
    if (!depth) { if (!close && /\sclass\s*=\s*(?:"[^"]*\bbh-article\b[^"]*"|'[^']*\bbh-article\b[^']*'|bh-article(?=[\s>/]))/.test(attrs)) depth = 1; }
    else if ((depth += close ? -1 : 1) === 0) break;
  }
  return text;
}

/** How many words bh.js counted in the article. */
export const articleWords = (html: string): number => articleText(html).trim().split(/\s+/).filter(Boolean).length;
