// The inline scripts of a built page, and whether each one parses. `bundle` (and so `diff`) injects
// scripts into a page it did not write; a script that lands inside another one's string, or is cut
// short, fails in the reader's browser with a SyntaxError and nothing else says so. Parsing every
// script of the result turns that into a build failure.

import vm from "node:vm";
import { spawnSync } from "node:child_process";

export interface InlineScript { text: string; module: boolean }

/** `type` values of a classic script: none, an empty one, or a JavaScript MIME type. */
const CLASSIC = /^(?:|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;

/** Every inline JavaScript script in `html`, in order, cut where the browser cuts it (at the first `</script`). Comments are stepped over; JSON, importmaps and other data blocks are not scripts. */
export function inlineScripts(html: string): InlineScript[] {
  const found: InlineScript[] = [];
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    if (m[1] === undefined || /\ssrc\s*=/i.test(m[1])) continue;
    const t = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i.exec(m[1]);
    const type = (t ? t[1] ?? t[2] ?? t[3] ?? "" : "").trim();
    if (/^module$/i.test(type)) found.push({ text: m[2]!, module: true });
    else if (CLASSIC.test(type)) found.push({ text: m[2]!, module: false });
  }
  return found;
}

/** The syntax error `script` has, or "" when it parses. It is compiled, never run: a module goes to `node --check`, which has the parser for one. */
function syntaxError(script: InlineScript): string {
  if (!script.module) {
    try { new vm.Script(script.text); return ""; } catch (e) { return (e as Error).message; }
  }
  const r = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: script.text, encoding: "utf8", timeout: 30_000 });
  if (r.status === 0) return "";
  return (r.stderr.split("\n").filter((l) => /Error/.test(l))[0] || r.stderr.trim() || `node --check exited ${r.status}`).trim();
}

/** One message per inline script that does not parse. */
export function inlineScriptProblems(html: string): string[] {
  const problems: string[] = [];
  inlineScripts(html).forEach((script, i) => {
    const error = syntaxError(script);
    if (error) problems.push(`inline ${script.module ? "module " : ""}script ${i + 1} (starts ${JSON.stringify(script.text.trim().slice(0, 40))}) does not parse: ${error}`);
  });
  return problems;
}
