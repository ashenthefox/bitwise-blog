#!/usr/bin/env node
// Usage: node generate.mjs --model <claude-model-id> --arm plain|base [slug…]
//
// Writes drafts/<slug>.<model-short>-<arm>.md from briefs.json, for structure.mjs to score (#369,
// #370). "plain" sends the brief alone. "base" puts the skill's base prompt from
// references/drafting-with-models.md before the brief, with the reader and a goal filled in, and,
// for an Opus model, Opus's per-model lines from the same file. Each draft is one `claude -p` call
// with no tools, from an empty directory, so no project file reaches the model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUIDE = path.join(HERE, "..", "..", "references", "drafting-with-models.md");

// The first ```text block after a heading, so the prompt stays the one the reference documents.
export function textBlockAfter(md, heading) {
  const at = md.indexOf(heading);
  if (at < 0) throw new Error(`no "${heading}" in drafting-with-models.md`);
  const m = /```text\n([\s\S]*?)```/.exec(md.slice(at));
  if (!m) throw new Error(`no text block after "${heading}"`);
  return m[1].trim();
}

export function promptFor(brief, arm, model, md = fs.readFileSync(GUIDE, "utf8")) {
  if (arm === "plain") return brief.prompt;
  const base = textBlockAfter(md, "## The base prompt")
    .replace(/^Reader: .*$/m, `Reader: ${brief.reader}.`)
    .replace(/^Goal: .*$/m, `Goal: after one read, the reader can explain ${brief.goal} and apply it without help.`);
  const extra = /opus/.test(model) ? `\n\n${textBlockAfter(md, "### Claude Opus 5.5")}` : "";
  return `${base}${extra}\n\n${brief.prompt}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const model = opt("--model"), arm = opt("--arm");
  if (!model || !["plain", "base"].includes(arm ?? "")) {
    console.error("usage: node generate.mjs --model <claude-model-id> --arm plain|base [slug…]");
    process.exit(2);
  }
  const briefs = JSON.parse(fs.readFileSync(path.join(HERE, "briefs.json"), "utf8"));
  const slugs = args.length ? args : Object.keys(briefs);
  const short = model.replace(/^claude-/, "").replace(/-\d.*$/, "");
  for (const slug of slugs) {
    const brief = briefs[slug];
    if (!brief) { console.error(`no brief for ${slug}`); process.exit(2); }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-"));
    const r = spawnSync("claude", ["-p", "--model", model, "--tools", "", "--disable-slash-commands", "--no-session-persistence",
      "--strict-mcp-config", "--output-format", "json"], { cwd: dir, input: promptFor(brief, arm, model), encoding: "utf8", maxBuffer: 64 << 20, timeout: 1_800_000 });
    fs.rmSync(dir, { recursive: true, force: true });
    let j;
    try { j = JSON.parse(r.stdout); } catch { console.error(`${slug}: no JSON reply (${r.status}) ${r.stderr.slice(-200)}`); process.exitCode = 1; continue; }
    if (j.is_error) { console.error(`${slug}: ${j.result}`); process.exitCode = 1; continue; }
    const out = path.join(HERE, "drafts", `${slug}.${short}-${arm}.md`);
    fs.writeFileSync(out, j.result.trim() + "\n");
    console.log(`${path.basename(out)}: ${j.result.split(/\s+/).filter(Boolean).length} words, US$${Number(j.total_cost_usd).toFixed(2)}`);
  }
}
