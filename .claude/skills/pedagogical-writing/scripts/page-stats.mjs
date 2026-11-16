#!/usr/bin/env node
// Usage: node page-stats.mjs [--json] <page.html | text.txt>
//
// Prints the numbers the review audits use: words per h2 section, voice rates
// compared with the 3Blue1Brown medians, predict folds, and every promise phrase
// ("for now", "later", "remember"…) with the section it is in, so each can be
// matched to its payoff. It also lists phrases for the claim and sentence
// audits: "obviously" and its kin, signposts that talk about the document
// instead of the subject, and empty verbs hiding an action ("performs a
// computation"). HTML is reduced to the prose of <article>; SVG, code, scripts
// and styles are dropped. No dependencies.
//
// --json prints the same numbers as one JSON object, plus `checks`: the pass/fail
// tests a script can decide for the grading scorecard (references/grading.md).
// grade.mjs imports this file, so the parsing lives in one place.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// 3Blue1Brown medians over 118 long-form explainers (per 1,000 words unless noted),
// and their interquartile ranges (references/review.md, Calibration numbers).
export const BASELINE = { words: 3143, sentLen: 24.7, you: 21.8, we: 11.5, i: 8.5, q: 2.2, name: 0.6 };
export const IQR = { sentLen: [23.0, 26.9], you: [17.9, 25.6], we: [8.4, 16.2], i: [6.2, 10.6], q: [1.3, 3.0], name: [0.1, 0.9] };

export const decode = s => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&[a-z]+;|&#\d+;/g, " ");

export const isHtml = src => /<html|<article/i.test(src);
export const articleHtml = src => (/<article[^>]*>([\s\S]*)<\/article>/i.exec(src) || [, src])[1];

// Split into sections: [{ id, title, text, predicts }]. Text before the first h2 is "(top)".
export function sections(src) {
  if (!isHtml(src)) return [{ id: "(all)", title: "", text: src, predicts: 0 }];
  let h = articleHtml(src);
  // Tables, term lists and code are reference material, not narrative: leave them out.
  h = h.replace(/<(script|style|svg|pre|code|template|table|dl)\b[\s\S]*?<\/\1>/gi, " ");
  const parts = h.split(/(?=<h2\b)/i);
  return parts.map((p, n) => {
    const m = /^<h2\b([^>]*)>([\s\S]*?)<\/h2>/i.exec(p);
    const id = m ? (/\bid="([^"]+)"/.exec(m[1]) || [, "(no id)"])[1] : n === 0 ? "(top)" : "(?)";
    const title = m ? decode(m[2].replace(/<[^>]+>/g, "")).trim() : "";
    const text = decode((m ? p.slice(m[0].length) : p).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return { id, title, text, predicts: (p.match(/<details\b[^>]*class="[^"]*\bpredict\b/gi) || []).length };
  });
}

const count = (t, re) => (t.match(re) || []).length;
const RE = {
  you: /\byou(r|rs|'re|'ll|'d|'ve)?\b/gi,
  we: /\b(we|we're|we'll|we've|let's|us|our)\b/gi,
  i: /\b(I|I'm|I'll|I'd|I've|me|my)\b/g,
  q: /\?/g,
  name: /\b(is called|are called|called the|known as|we call|people call|referred to as)\b/gi,
};
// Phrases that make a promise. Bare "later" is left out: "one byte later" is not a promise.
const PROMISE = new RegExp("\\b(" + [
  "for now", "for the moment", "until (we|the next|later)",
  "later (on|in|we|you|this|the page|the series|sections?)", "an? later (page|post|series|section|chapter)",
  "(see|shown|explain\\w*|cover\\w*|discuss\\w*|fix\\w*|return to|revisit\\w*|come back to) (it |this |that |them )?later",
  "further on", "comes? after (this|that)", "by the end of (this|the) (page|section|series)",
  "(we|you)'ll (come back|return|see|get to|meet)", "come back to", "return to",
  "remember (this|that)", "keep in mind", "tuck (this|that) away", "hold on to",
  "simplif\\w*", "not quite (right|true|correct)", "(a little|slightly) wrong",
  "ignore (this|that|for)", "take (it|this|them|that) for granted", "taking (it|this|them|that) for granted",
  "we skip", "skip(ped|ping)? (this|over)", "postpone\\w*", "in a moment",
].join("|") + ")\\b", "gi");
// Claims that something is obvious: each should be shown, or say where it stands (Halmos).
const OBVIOUS = /\b(obviously|clearly|trivially|of course|needless to say|it is (easy to see|clear that)|it's (easy to see|clear that))\b/gi;
// Signposts about the document rather than the subject (Pinker), and Wilf's
// "Consider the following", which usually marks a missing need.
const DOC_TALK = new RegExp("\\b(" + [
  "this (section|post|page|article|chapter) (explains|describes|discusses|covers|shows|presents|will)",
  "in (this|the following|the next) (section|post|page|article|chapter)",
  "the following (section|paragraph)", "consider the following",
  "as (mentioned|discussed|described|noted|stated) (above|below|earlier|previously)",
].join("|") + ")\\b", "gi");
// An empty verb plus an action noun: "performs a computation" for "computes" (Williams).
// Only -tion/-sion/-ment nouns: -ance/-ence caught "makes the distance 7" and "make a difference".
const EMPTY_VERB = /\b(perform(s|ed|ing)?|conduct(s|ed|ing)?|carr(y|ies|ied|ying) out|do(es)?|did|mak(e|es|ing)|made|giv(e|es|ing)|gave) (a|an|the) (\w+ )?\w+(tion|sion|ment)s?\b/gi;

// Every match of `re` with its section and some context.
function matches(secs, re) {
  const found = [];
  for (const s of secs) {
    for (const m of s.text.matchAll(re)) {
      const a = Math.max(0, m.index - 70), b = Math.min(s.text.length, m.index + m[0].length + 70);
      found.push({ section: s.id, phrase: m[0], context: s.text.slice(a, b) });
    }
  }
  return found;
}

// Bullets in the page's .tldr, or null when it has none.
function tldrBullets(src) {
  const m = /<div\b[^>]*class="[^"]*\btldr\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(src);
  return m ? (m[1].match(/<li\b/gi) || []).length : null;
}

// All the numbers, as data. `src` is the file's text.
export function pageStats(src) {
  const html = isHtml(src);
  const secs = sections(src);
  const all = secs.map(s => s.text).join(" ");
  const words = all.split(/\s+/).filter(Boolean).length;
  const sents = all.split(/(?<=[.?!])\s+/).filter(s => s.split(/\s+/).length > 2).length || 1;
  const per1k = re => (1000 * count(all, re) / Math.max(words, 1));
  const voice = { sentLen: words / sents, you: per1k(RE.you), we: per1k(RE.we), i: per1k(RE.i), q: per1k(RE.q), name: per1k(RE.name) };
  const predicts = secs.reduce((s, x) => s + x.predicts, 0);
  return {
    isHtml: html, words, voice, predicts, tldrBullets: html ? tldrBullets(src) : null,
    sections: secs.map(s => ({ id: s.id, title: s.title, words: s.text.split(/\s+/).filter(Boolean).length, predicts: s.predicts })),
    promises: matches(secs, PROMISE), obvious: matches(secs, OBVIOUS), docTalk: matches(secs, DOC_TALK), emptyVerbs: matches(secs, EMPTY_VERB),
  };
}

const VOICE_LABEL = { sentLen: "words per sentence", you: "'you' per 1,000", we: "'we / let's' per 1,000", i: "'I / me' per 1,000", q: "questions per 1,000", name: "'called / known as' per 1,000" };

// The checks a script can decide, for the scorecard. Judges see these and do not re-decide them.
// status: pass | fail | warn | info. The voice check only warns: the IQR is direction, not law.
export function scriptChecks(st) {
  const checks = [];
  if (st.isHtml) {
    checks.push(st.tldrBullets === null
      ? { id: "tldr-bullets", status: "fail", detail: "the page has no .tldr" }
      : { id: "tldr-bullets", status: st.tldrBullets <= 3 ? "pass" : "fail", detail: `${st.tldrBullets} bullets (at most 3)` });
    checks.push({ id: "predict-folds", status: st.predicts >= 1 ? "pass" : "fail", detail: `${st.predicts} details.predict (at least 1)` });
  }
  checks.push({ id: "promise-phrases", status: "info", detail: `${st.promises.length} promise phrases listed; the judge decides whether each is paid off`,
    items: st.promises.map(p => ({ section: p.section, phrase: p.phrase })) });
  // Naming fewer terms than 3Blue1Brown is not a fault, so "called / known as" warns only when high.
  const out = Object.entries(IQR).filter(([k, [lo, hi]]) => (k !== "name" && st.voice[k] < lo) || st.voice[k] > hi)
    .map(([k, [lo, hi]]) => `${VOICE_LABEL[k]} ${st.voice[k].toFixed(1)} (IQR ${lo}–${hi})`);
  checks.push({ id: "voice-iqr", status: out.length ? "warn" : "pass", detail: out.length ? `outside the 3Blue1Brown IQR: ${out.join("; ")}` : "every voice rate is inside the 3Blue1Brown IQR" });
  return checks;
}

function printText(file, st) {
  const row = (label, value, base, fmt = v => v.toFixed(1)) =>
    console.log(`${label.padEnd(30)}${fmt(value).padStart(8)}   3B1B median ${fmt(base)}`);
  console.log(`# ${file}\n`);
  row("words", st.words, BASELINE.words, v => String(Math.round(v)));
  row("words per sentence", st.voice.sentLen, BASELINE.sentLen);
  row("'you' per 1,000 words", st.voice.you, BASELINE.you);
  row("'we / let's' per 1,000 words", st.voice.we, BASELINE.we);
  row("'I / me' per 1,000 words", st.voice.i, BASELINE.i);
  row("questions per 1,000 words", st.voice.q, BASELINE.q);
  row("'called / known as' per 1,000", st.voice.name, BASELINE.name);
  if (st.isHtml) console.log(`${"details.predict folds".padEnd(30)}${String(st.predicts).padStart(8)}   house rule: 1-2 per page`);

  if (st.isHtml) {
    console.log("\n## Sections\n");
    for (const s of st.sections) console.log(`${String(s.words).padStart(6)} words  #${s.id}${s.title ? `  ${s.title}` : ""}`);
  }
  const list = (heading, found, none) => {
    console.log(`\n## ${heading}\n`);
    for (const f of found) console.log(`#${f.section}: …${f.context}…`);
    if (!found.length) console.log(none);
  };
  list("Promise phrases (match each to its payoff)", st.promises,
    "(none found: either the page makes no promises, or it makes them silently)");
  list("\"Obviously\" and kin (show it, or say where it stands)", st.obvious, "(none found)");
  list("Signposts about the document (ask about the subject instead)", st.docTalk, "(none found)");
  list("Empty verbs hiding an action (use the verb)", st.emptyVerbs, "(none found)");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const file = args.find(a => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node page-stats.mjs [--json] <page.html | text.txt>");
    process.exit(2);
  }
  const st = pageStats(fs.readFileSync(file, "utf8"));
  if (json) console.log(JSON.stringify({ file, ...st, checks: scriptChecks(st) }, null, 2));
  else printText(file, st);
}
