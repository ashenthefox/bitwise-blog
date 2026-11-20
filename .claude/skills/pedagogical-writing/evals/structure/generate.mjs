#!/usr/bin/env node
// Usage: node generate.mjs --model <claude-model-id> --arm plain|base [--force] [slug…]
//
// Writes drafts/<slug>.<model>-<arm>.md (e.g. token-bucket-rate-limiting.opus-5-5-base.md) from
// briefs.json, for structure.mjs to score (#370). "plain" sends the brief alone. "base" puts the
// skill's base prompt from references/drafting-with-models.md before the brief, with the reader and
// goal filled in, and, for claude-opus-5-5, Opus 5.5's per-model lines from the same file. Each draft
// is one `claude -p` call with a one-line system prompt in place of Claude Code's, no setting sources
// (so no CLAUDE.md, settings or hooks), no tools and no MCP, from an empty directory; only the
// working directory and the date still reach the model, the same in every arm. An existing
// draft is kept unless --force, so a run never overwrites a measured text.
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

// Replace the one line that starts with `label`, or throw: a reworded template must not go out unfilled.
const fill = (text, label, line) => {
  const re = new RegExp(`^${label}: .*$`, "m");
  if (!re.test(text)) throw new Error(`the base prompt has no "${label}:" line`);
  return text.replace(re, () => line);
};

export const SYSTEM_PROMPT = "You are a helpful assistant.";

export function promptFor(brief, arm, model, md = fs.readFileSync(GUIDE, "utf8")) {
  if (arm === "plain") return brief.prompt;
  let base = textBlockAfter(md, "## The base prompt");
  base = fill(base, "Reader", `Reader: ${brief.reader}.`);
  base = fill(base, "Goal", `Goal: after one read, the reader can explain ${brief.goal}.`);
  const extra = model === "claude-opus-5-5" ? `\n\n${textBlockAfter(md, "### Claude Opus 5.5")}` : "";
  return `${base}${extra}\n\n${brief.prompt}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const force = args.includes("--force");
  if (force) args.splice(args.indexOf("--force"), 1);
  const model = opt("--model"), arm = opt("--arm");
  if (!model || !["plain", "base"].includes(arm ?? "")) {
    console.error("usage: node generate.mjs --model <claude-model-id> --arm plain|base [--force] [slug…]");
    process.exit(2);
  }
  const briefs = JSON.parse(fs.readFileSync(path.join(HERE, "briefs.json"), "utf8"));
  const slugs = args.length ? args : Object.keys(briefs);
  const short = model.replace(/^claude-/, "");
  for (const slug of slugs) {
    const brief = briefs[slug];
    if (!brief) { console.error(`no brief for ${slug}`); process.exit(2); }
    const out = path.join(HERE, "drafts", `${slug}.${short}-${arm}.md`);
    if (fs.existsSync(out) && !force) { console.log(`${path.basename(out)}: kept (exists; --force to redraft)`); continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-"));
    const r = spawnSync("claude", ["-p", "--model", model, "--system-prompt", SYSTEM_PROMPT, "--exclude-dynamic-system-prompt-sections",
      "--setting-sources", "", "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config",
      "--output-format", "json"], { cwd: dir, input: promptFor(brief, arm, model), encoding: "utf8", maxBuffer: 64 << 20, timeout: 1_800_000 });
    fs.rmSync(dir, { recursive: true, force: true });
    if (r.error || !r.stdout) { console.error(`${slug}: claude did not run (${r.error?.message ?? `exit ${r.status}`}) ${(r.stderr ?? "").slice(-200)}`); process.exitCode = 1; continue; }
    let j;
    try { j = JSON.parse(r.stdout); } catch { console.error(`${slug}: no JSON reply (exit ${r.status}) ${(r.stderr ?? "").slice(-200)}`); process.exitCode = 1; continue; }
    if (j?.is_error || typeof j?.result !== "string") { console.error(`${slug}: ${j?.result ?? "no result in the reply"}`); process.exitCode = 1; continue; }
    fs.writeFileSync(out, j.result.trim() + "\n");
    console.log(`${path.basename(out)}: ${j.result.split(/\s+/).filter(Boolean).length} words, US$${Number(j.total_cost_usd).toFixed(2)}`);
  }
}
