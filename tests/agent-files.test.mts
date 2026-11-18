// The agent files in .claude/agents/, checked. `npm run lint-skills` and `claude plugin validate .claude/skills`
// look at skills only, so without this a renamed agent file, a broken frontmatter or a lost `tools` line is
// found when a consultation fails, or (for `tools`) never: an agent with no `tools` inherits every tool.
// It needs no private data, so it runs in CI. See contracts/skills.md.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { parseFrontmatter } from "../.claude/skills/skill-authoring/scripts/lint-skill.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS = path.join(".claude", "agents");
const SKILL = path.join(".claude", "skills", "advisors");

/** The agents are read-only: they read the private data and return text. */
const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep"]);

interface AgentCheck {
  /** One line per fault, starting with the file it is in. Empty when the files are sound. */
  errors: string[];
  /** The agent files found, as names (the file name without `.md`). */
  agents: string[];
  /** Every `subagent_type` the skill's Markdown names. */
  spawned: string[];
}

/** Paths of the Markdown files under `dir`. */
function markdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(full) : entry.name.endsWith(".md") ? [full] : [];
  });
}

/**
 * Checks every `*.md` in `agentsDir`, and that each `subagent_type` named in a Markdown file under `skillDir`
 * has an agent file. It reads the two directories it is given and nothing else, so a test can run it on a copy.
 *
 * "The frontmatter parses" means: the file starts with a `---` line, a later line is exactly `---`, and the
 * text between them is YAML that the `yaml` package reads without error as a mapping. That is stricter than the
 * lint's `parseFrontmatter`, which matches `key: value` lines and skips whatever it does not recognise, so it
 * returns a result for an unclosed list or a second `: ` in a value. A strict reader may reject a file the
 * host would still load; an agent file the host has to guess at is a fault here either way.
 */
function checkAgentFiles(agentsDir: string, skillDir: string): AgentCheck {
  const errors: string[] = [];
  const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort().map((f) => f.slice(0, -3)) : [];

  for (const agent of agents) {
    const file = `${agent}.md`;
    const add = (msg: string) => errors.push(`${file}: ${msg}`);
    const block = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(fs.readFileSync(path.join(agentsDir, file), "utf8"));
    if (!block) {
      add("no frontmatter (the file must start with a --- line and close it with another)");
      continue;
    }
    let fields: Record<string, unknown>;
    try {
      const value: unknown = parse(block[1]);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        add("the frontmatter is not a YAML mapping of fields");
        continue;
      }
      fields = value as Record<string, unknown>;
    } catch (e) {
      add(`the frontmatter is not valid YAML: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
      continue;
    }

    if (fields.name !== agent) add(`name ${JSON.stringify(fields.name)} must equal the file name "${agent}"`);
    if (typeof fields.description !== "string" || !fields.description.trim()) add("description is missing or empty");

    // `tools: Read, Glob` and `tools: [Read, Glob]` are both accepted. No tools at all is a fault: with the
    // line missing or empty the agent inherits every tool, Write and Bash included.
    const tools = fields.tools;
    const list = tools === null ? []
      : typeof tools === "string" ? tools.split(",").map((s) => s.trim()).filter(Boolean)
      : Array.isArray(tools) && tools.every((x) => typeof x === "string") ? tools.map((s) => s.trim()).filter(Boolean)
      : null;
    if (!("tools" in fields)) add("no tools line, so the agent inherits every tool");
    else if (!list) add("tools must be a comma-separated string or a list of names");
    else if (!list.length) add("tools is empty, so the agent inherits every tool");
    else {
      const extra = list.filter((name) => !READ_ONLY_TOOLS.has(name));
      if (extra.length) add(`tools may hold only ${[...READ_ONLY_TOOLS].join(", ")}; found ${extra.join(", ")}`);
    }
  }

  const spawned = new Set<string>();
  for (const file of fs.existsSync(skillDir) ? markdownFiles(skillDir) : []) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/\bsubagent_type\b`?\s*[:=]\s*[`"']?([A-Za-z0-9][\w-]*)/g)) {
      spawned.add(m[1]);
      if (!agents.includes(m[1])) errors.push(`${path.relative(skillDir, file)}: subagent_type ${m[1]} has no agent file ${m[1]}.md`);
    }
  }
  return { errors: [...new Set(errors)], agents, spawned: [...spawned].sort() };
}

// ---- the real files -------------------------------------------------------------------

test("the agent files are sound, and the advisors skill spawns only agents that exist", () => {
  const result = checkAgentFiles(path.join(ROOT, AGENTS), path.join(ROOT, SKILL));
  // The check is looking in the right place: an empty directory or a pattern that matches nothing is also "no errors".
  assert.deepEqual(result.agents, ["advisor-duncan-sabien", "mediator"]);
  assert.deepEqual(result.spawned, ["advisor-duncan-sabien", "mediator"]);
  assert.deepEqual(result.errors, []);
});

// ---- injected faults, on a copy -------------------------------------------------------

/** A throwaway copy of the two directories, checked to be clean before any fault goes in. */
function copy(t: TestContext): { agents: string; skill: string; check: () => string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-agent-files-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const agents = path.join(dir, AGENTS), skill = path.join(dir, SKILL);
  fs.cpSync(path.join(ROOT, AGENTS), agents, { recursive: true });
  fs.cpSync(path.join(ROOT, SKILL), skill, { recursive: true });
  const check = () => checkAgentFiles(agents, skill).errors;
  assert.deepEqual(check(), [], "the copy is clean before the fault");
  return { agents, skill, check };
}

/** Replaces `from` with `to` in a file, and fails unless `from` was there once and the file changed on disk. */
function inject(file: string, from: string, to: string): void {
  const before = fs.readFileSync(file, "utf8");
  assert.equal(before.split(from).length - 1, 1, `${JSON.stringify(from)} occurs exactly once in ${path.basename(file)}`);
  fs.writeFileSync(file, before.replace(from, () => to));
  const after = fs.readFileSync(file, "utf8");
  assert.notEqual(after, before, "the injected fault changed the file");
  assert.equal(after, before.split(from).join(to), "the file holds the fault");
}

/** Renames a file, and fails unless it was there and has gone. */
function rename(from: string, to: string): void {
  assert.ok(fs.existsSync(from), `${path.basename(from)} exists before the rename`);
  assert.ok(!fs.existsSync(to), `${path.basename(to)} does not`);
  fs.renameSync(from, to);
  assert.ok(!fs.existsSync(from) && fs.existsSync(to), "the file was renamed");
}

const TOOLS_LINE = "tools: Read, Glob, Grep\n";

test("renaming an agent file is an error twice over: its name no longer matches, and the skill spawns a type with no file", (t) => {
  const { agents, check } = copy(t);
  rename(path.join(agents, "advisor-duncan-sabien.md"), path.join(agents, "advisor-duncan.md"));
  assert.deepEqual(check(), [
    'advisor-duncan.md: name "advisor-duncan-sabien" must equal the file name "advisor-duncan"',
    "SKILL.md: subagent_type advisor-duncan-sabien has no agent file advisor-duncan-sabien.md",
  ]);
});

test("renaming an agent file and its name together still fails, because the skill spawns the old name", (t) => {
  const { agents, check } = copy(t);
  rename(path.join(agents, "mediator.md"), path.join(agents, "reviewer.md"));
  inject(path.join(agents, "reviewer.md"), "name: mediator\n", "name: reviewer\n");
  assert.deepEqual(check(), ["SKILL.md: subagent_type mediator has no agent file mediator.md"]);
});

test("changing the name in the frontmatter alone is an error", (t) => {
  const { agents, check } = copy(t);
  inject(path.join(agents, "mediator.md"), "name: mediator\n", "name: reviewer\n");
  assert.deepEqual(check(), ['mediator.md: name "reviewer" must equal the file name "mediator"']);
});

test("a subagent_type the skill names with no agent file is an error", (t) => {
  const { skill, check } = copy(t);
  inject(path.join(skill, "SKILL.md"), "subagent_type: mediator\n", "subagent_type: referee\n");
  assert.deepEqual(check(), ["SKILL.md: subagent_type referee has no agent file referee.md"]);
});

test("broken frontmatter is an error: unclosed, missing, and not valid YAML", async (t) => {
  await t.test("the closing --- is gone", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), `${TOOLS_LINE}---\n`, TOOLS_LINE);
    assert.deepEqual(check(), ["mediator.md: no frontmatter (the file must start with a --- line and close it with another)"]);
  });
  await t.test("the opening --- is gone", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), "---\nname: mediator\n", "name: mediator\n");
    assert.deepEqual(check(), ["mediator.md: no frontmatter (the file must start with a --- line and close it with another)"]);
  });
  await t.test("an unclosed list", (t) => {
    const { agents, check } = copy(t);
    const file = path.join(agents, "mediator.md");
    inject(file, TOOLS_LINE, "tools: [Read, Glob, Grep\n");
    const errors = check();
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0], /^mediator\.md: the frontmatter is not valid YAML: /);
    // Why the check does not rest on the lint's reader: it takes this file as it is.
    const lint = parseFrontmatter(fs.readFileSync(file, "utf8"));
    assert.equal((lint?.fields as Record<string, string> | undefined)?.tools, "[Read, Glob, Grep");
  });
  await t.test("a second key on the description line", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), "description: Reviews a shoulder", "description: Reviews: a shoulder");
    const errors = check();
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0], /^mediator\.md: the frontmatter is not valid YAML: /);
  });
  await t.test("a line that is not a field", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "advisor-duncan-sabien.md"), TOOLS_LINE, `${TOOLS_LINE}read-only\n`);
    const errors = check();
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0], /^advisor-duncan-sabien\.md: the frontmatter is not valid YAML: /);
  });
});

test("a tool beyond Read, Glob and Grep is an error, as a string and as a list", async (t) => {
  await t.test("Write added to the line", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "advisor-duncan-sabien.md"), TOOLS_LINE, "tools: Read, Glob, Grep, Write\n");
    assert.deepEqual(check(), ["advisor-duncan-sabien.md: tools may hold only Read, Glob, Grep; found Write"]);
  });
  await t.test("Bash in a YAML list", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), TOOLS_LINE, "tools:\n  - Read\n  - Bash\n");
    assert.deepEqual(check(), ["mediator.md: tools may hold only Read, Glob, Grep; found Bash"]);
  });
  await t.test("a subset is fine", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), TOOLS_LINE, "tools: [Read, Grep]\n");
    assert.deepEqual(check(), []);
  });
});

test("a missing or empty tools line is an error, because the agent would inherit every tool", async (t) => {
  await t.test("the line removed", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), TOOLS_LINE, "");
    assert.deepEqual(check(), ["mediator.md: no tools line, so the agent inherits every tool"]);
  });
  await t.test("the line renamed", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), TOOLS_LINE, "allowed-tools: Read, Glob, Grep\n");
    assert.deepEqual(check(), ["mediator.md: no tools line, so the agent inherits every tool"]);
  });
  await t.test("the value removed", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), TOOLS_LINE, "tools:\n");
    assert.deepEqual(check(), ["mediator.md: tools is empty, so the agent inherits every tool"]);
  });
  await t.test("a value that is not a list of names", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), TOOLS_LINE, "tools: { Read: true }\n");
    assert.deepEqual(check(), ["mediator.md: tools must be a comma-separated string or a list of names"]);
  });
  await t.test("an empty string", (t) => {
    const { agents, check } = copy(t);
    inject(path.join(agents, "mediator.md"), TOOLS_LINE, 'tools: ""\n');
    assert.deepEqual(check(), ["mediator.md: tools is empty, so the agent inherits every tool"]);
  });
});

test("an empty description is an error", (t) => {
  const { agents, check } = copy(t);
  const file = path.join(agents, "mediator.md");
  const line = /^description: .*\n/m.exec(fs.readFileSync(file, "utf8"));
  assert.ok(line, "mediator.md has a description line");
  inject(file, line[0], "description:\n");
  assert.deepEqual(check(), ["mediator.md: description is missing or empty"]);
});
