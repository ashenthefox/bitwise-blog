// The `check` rule for link targets and the structure of components: stable ids, and the shape
// of <bh-versions>, <bh-sequence>, <bh-codewalk>, <bh-matrix>, <bh-chart> and <bh-stepper>.
// It takes the page's HTML, not a path, so tests can call it on a fragment. No side effects.

import type { Finding, TreeNode } from "../types.mts";
import { parseTree, nodeAttr, hasClass, walkTree, findNode, nodeText, decodeEntities } from "../html-tree.mts";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Every link target must carry an explicit, stable, kebab-case id: section headings
 * (h2–h4 directly in the article), every figure, every glossary entry, and any
 * [data-linkable] block. Auto-generated ids would change whenever the text changes.
 */
export function linkTargetProblems(html: string): string[] {
  const { root, src } = parseTree(html);
  const article = findNode(root, (n) => hasClass(n, "bh-article"));
  if (!article) return [];
  const out: string[] = [];
  const require = (n: TreeNode, what: string) => {
    const id = nodeAttr(n, "id");
    if (!id) out.push(`${what} has no id, so it can't be linked to; add a stable kebab-case id`);
    else if (!KEBAB.test(id)) out.push(`${what} id="${id}" must be kebab-case (a-z, 0-9, hyphens)`);
  };
  const short = (t: string) => (t.length > 50 ? t.slice(0, 47) + "…" : t);
  for (const c of article.children) {
    if (/^h[2-4]$/.test(c.tag)) require(c, `<${c.tag}> "${short(nodeText(src, c))}"`);
  }
  walkTree(article, (n) => {
    if (n.tag === "figure") {
      const cap = findNode(n, (x) => x.tag === "figcaption");
      require(n, `<figure>${cap ? ` "${short(nodeText(src, cap))}"` : ""}`);
    }
    if (n.tag === "dt" && n.parent!.tag === "dl" && hasClass(n.parent!, "glossary")) require(n, `glossary entry "${short(nodeText(src, n))}"`);
    if (/\sdata-linkable\b/.test(n.attrs)) require(n, `<${n.tag} data-linkable>`);
    if (n.tag === "bh-versions") {
      const figs = n.children.filter((c) => c.tag === "figure");
      if (figs.length < 2) out.push("<bh-versions> needs at least two <figure> versions");
      for (const f of figs) if (!nodeAttr(f, "data-label")) out.push(`<bh-versions> figure id="${nodeAttr(f, "id") || "?"}" needs data-label (e.g. "Current", "Proposed")`);
    }
    {
      const change = nodeAttr(n, "data-change");
      if (change !== undefined && !["added", "changed", "removed"].includes(change)) out.push(`data-change="${change}" must be added, changed or removed`);
    }
    if (n.tag === "bh-sequence") {
      const actors = new Set(n.children.filter((c) => c.tag === "bh-actor").map((c) => nodeAttr(c, "data-id")));
      if (!actors.size) out.push("<bh-sequence> has no <bh-actor data-id=…>");
      if (actors.has(undefined)) out.push("every <bh-actor> needs a data-id");
      if (n.parent!.tag !== "figure") out.push("<bh-sequence> must sit inside a <figure class=\"diagram\" id=…> so it can be linked and captioned");
      for (const c of n.children) {
        const refs = c.tag === "bh-msg" ? [nodeAttr(c, "from"), nodeAttr(c, "to")] : c.tag === "bh-note" ? (nodeAttr(c, "over") || "").split(/[\s,]+/) : [];
        for (const a of refs) if (!actors.has(a)) out.push(`<${c.tag}> refers to unknown actor "${a}"`);
      }
    }
    if (n.tag === "bh-codewalk") {
      require(n, "<bh-codewalk>");
      const code = src.slice(n.start, n.end).match(/<code\b[^>]*>([\s\S]*?)<\/code>/);
      const lines = code ? decodeEntities(code[1].replace(/<[^>]+>/g, "")).replace(/\n$/, "").split("\n").length : 0;
      if (!code) out.push("<bh-codewalk> needs a <pre><code> block");
      for (const st of n.children.filter((c) => c.tag === "bh-cw-step")) {
        const spec = nodeAttr(st, "lines") || "";
        if (!/^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(spec)) { out.push(`<bh-cw-step lines="${spec}"> must look like "3-8, 12"`); continue; }
        for (const part of spec.split(",")) {
          const [a, b = a] = part.split("-").map((x) => +x.trim());
          if (a < 1 || b < a || b > lines) out.push(`<bh-cw-step lines="${spec}"> is outside the code (1–${lines})`);
        }
      }
    }
    if (n.tag === "bh-matrix") {
      require(n, "<bh-matrix>");
      const table = findNode(n, (x) => x.tag === "table");
      const headRow = table && findNode(table, (x) => x.tag === "thead");
      const heads = headRow ? findNode(headRow, (x) => x.tag === "tr")!.children.filter((c) => c.tag === "th" || c.tag === "td") : [];
      const options = heads.length - 2;
      if (options < 2) out.push("<bh-matrix> header needs: Criterion, Weight, then at least two options");
      const body = table && findNode(table, (x) => x.tag === "tbody");
      for (const tr of body ? body.children.filter((c) => c.tag === "tr") : []) {
        const cells = tr.children.filter((c) => c.tag === "th" || c.tag === "td");
        const name = nodeText(src, cells[0] || tr);
        if (cells.length !== options + 2) { out.push(`<bh-matrix> row "${name}" has ${cells.length - 2} scores for ${options} options`); continue; }
        cells.slice(1).forEach((c, k) => {
          const v = nodeText(src, c);
          if (!/^[0-5]$/.test(v)) out.push(`<bh-matrix> row "${name}": ${k === 0 ? "weight" : "score"} "${v}" must be a whole number 0–5`);
        });
      }
    }
    if (n.tag === "bh-chart") {
      const type = nodeAttr(n, "type") || "line";
      if (!["line", "bar"].includes(type)) out.push(`<bh-chart type="${type}"> must be line or bar`);
      if (n.parent!.tag !== "figure") out.push("<bh-chart> must sit inside a <figure id=…> so it can be linked and captioned");
      const table = findNode(n, (x) => x.tag === "table");
      const thead = table && findNode(table, (x) => x.tag === "thead");
      const heads = thead ? findNode(thead, (x) => x.tag === "tr")!.children.filter((c) => c.tag === "th" || c.tag === "td").map((c) => nodeText(src, c)) : [];
      const seriesCount = heads.length - 1;
      if (seriesCount < 1) out.push("<bh-chart> table needs a header row: x label, then one column per series");
      if (seriesCount > 6) out.push(`<bh-chart> has ${seriesCount} series; past 6, fold the tail into "Other" or use small multiples`);
      const emph = nodeAttr(n, "emphasis");
      if (emph && !heads.slice(1).includes(emph)) out.push(`<bh-chart emphasis="${emph}"> is not a series name`);
      const tbody = table && findNode(table, (x) => x.tag === "tbody");
      for (const tr of tbody ? tbody.children.filter((c) => c.tag === "tr") : []) {
        const cells = tr.children.filter((c) => c.tag === "th" || c.tag === "td").map((c) => nodeText(src, c));
        if (cells.length !== heads.length) { out.push(`<bh-chart> row "${cells[0]}" has ${cells.length - 1} values for ${seriesCount} series`); continue; }
        for (const v of cells.slice(1)) if (v !== "" && !/^-?[\d,]*\.?\d+$/.test(v)) out.push(`<bh-chart> row "${cells[0]}": "${v}" is not a number`);
      }
    }
    if (n.tag === "bh-stepper" && !nodeAttr(n, "id") && !nodeAttr(n, "for")) {
      out.push("<bh-stepper> needs for=\"figure-id\" (or an id) so its steps can be linked to");
    }
  });
  return out;
}

/** The same problems as findings: every one is an error, and `check` prints `message` as it always has. */
export function linkTargetFindings(html: string): Finding[] {
  return linkTargetProblems(html).map((message) => ({ rule: "links/link-target", level: "error", message }));
}
