// Review files (bh-review/1): reading them and deciding whether they are valid.
//
// `npm run check` (scripts/bh.mts) runs it on the files in reviews/.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import type { ReviewComment, ReviewFile, ReviewRecord } from "./types.mts";

export const PRIVATE_EXT = ".private.html";

/**
 * True when the page's HTML is a sealed (encrypted) private page: it carries the `bh:sealed` meta or the
 * encrypted payload script, outside comments (a page that quotes the markup in a comment is not one).
 * The one sealed test: `classifyPage` (scripts/hidden-pages.mts), the generators and `publish` all use it.
 */
export const isSealedShell = (html: string): boolean => {
  const live = html.replace(/<!--[\s\S]*?-->/g, "");
  return /<script\b[^>]*\bid="sealed-payload"/i.test(live) || /<meta\s+name="bh:sealed"/i.test(live);
};

/** True when the file is a sealed (encrypted) private page. */
export const isSealedFile = (file: string): boolean => isSealedShell(fs.readFileSync(file, "utf8"));

/** Every review file under `<root>/reviews` (plain or gzipped JSON; not the schema). */
export function reviewFiles(root: string, dir = path.join(root, "reviews")): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? reviewFiles(root, p) : /\.json(\.gz)?$/.test(e.name) && e.name !== "schema.json" ? [p] : [];
  });
}

/** Read a review file (plain or gzipped JSON). */
export function readReview(file: string): ReviewFile {
  const buf = fs.readFileSync(file);
  return JSON.parse((file.endsWith(".gz") ? zlib.gunzipSync(buf) : buf).toString("utf8"));
}

/** A review's `document` as a clean site-root path ("docs/x.html"), so "./docs/x.html" and "/docs/x.html" key the same thread list. */
export function canonicalDocument(document: string | undefined): string {
  return typeof document === "string" ? path.posix.normalize(document.replace(/\\/g, "/")).replace(/^\/+/, "") : document!; // untrusted JSON: not necessarily a string (only `undefined` is typed here)
}

/**
 * True when a review's `document` is a private page: its plaintext source
 * (docs/<slug>.private.html, whether or not it exists here) or the sealed shell
 * (docs/<slug>.html carrying bh:sealed). Both repo and Pages site are public, so
 * nothing about such a page, quotes and comment bodies included, may be published.
 */
export function isPrivateDocument(root: string, document: unknown): boolean {
  if (typeof document !== "string") return false;
  const rel = path.posix.normalize(document.replace(/\\/g, "/"));
  if (rel.toLowerCase().endsWith(PRIVATE_EXT)) return true;
  const docs = path.join(root, "docs"), file = path.join(root, rel);
  return file.startsWith(docs + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() && isSealedFile(file);
}

/** Export-time location status is not part of a message; attribution is. */
export function reviewRecord(cm: ReviewComment, review: ReviewFile): ReviewRecord {
  const { outdated, ...keep } = cm;
  void outdated;
  return { ...keep, author: cm.author || review.reviewer || null };
}

export function sameReviewMessage(a: { document: string; record: ReviewRecord }, b: { document: string; record: ReviewRecord }): boolean {
  return a.document === b.document && isDeepStrictEqual(a.record, b.record);
}

// ---- reviews/schema.json -----------------------------------------------------------------

/** The part of JSON Schema that reviews/schema.json uses. `SCHEMA_KEYWORDS` lists what `schemaProblems` enforces. */
export interface Schema {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  format?: string;
  minLength?: number;
  [annotation: string]: unknown;
}

/** Keywords `schemaProblems` enforces, and keywords that only describe. A test fails when the schema uses anything else. */
export const SCHEMA_KEYWORDS = ["type", "const", "enum", "required", "properties", "items", "anyOf", "format", "minLength"];
export const SCHEMA_ANNOTATIONS = ["$schema", "$id", "title", "description"];

export function readSchema(root: string): Schema {
  return JSON.parse(fs.readFileSync(path.join(root, "reviews", "schema.json"), "utf8")) as Schema;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return isObject(value);
    case "integer": return Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    default: return typeof value === type; // string, boolean
  }
}

/** RFC 3339 date-time, as `Date.prototype.toISOString` writes it (seconds required; any offset). */
export const isDateTime = (s: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(s) && !Number.isNaN(Date.parse(s));

const typeName = (t: string) => ({ array: "an array", object: "an object", integer: "an integer", null: "null" } as Record<string, string>)[t] || `a ${t}`;

/**
 * Where `value` breaks `schema`, as messages naming the path (`comments[2].kind`). Paths are built
 * from the schema's property names and array indices only, and the only values quoted are the
 * schema's own, so a message never repeats text from the file.
 */
export function schemaProblems(value: unknown, schema: Schema, at = ""): string[] {
  const name = at || "the file";
  if (schema.type !== undefined) {
    const types = [schema.type].flat();
    if (!types.some((t) => hasType(value, t))) return [`${name} must be ${types.map(typeName).join(" or ")}`];
  }
  if ("const" in schema && !isDeepStrictEqual(value, schema.const)) return [`${name} must be ${JSON.stringify(schema.const)}`];
  if (schema.enum && !schema.enum.some((e) => isDeepStrictEqual(e, value))) return [`${name} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`];
  const out: string[] = [];
  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) out.push(schema.minLength === 1 ? `${name} must not be empty` : `${name} must be at least ${schema.minLength} characters`);
    if (schema.format === "date-time" && !isDateTime(value)) out.push(`${name} must be an ISO date-time (e.g. 2026-10-11T09:00:00Z)`);
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) out.push(`${name} needs "${key}"`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) out.push(...schemaProblems(value[key], sub, at ? `${at}.${key}` : key));
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => out.push(...schemaProblems(v, schema.items!, `${at}[${i}]`)));
  if (schema.anyOf && !schema.anyOf.some((s) => schemaProblems(value, s, at).length === 0)) {
    const onlyRequired = schema.anyOf.every((s) => Object.keys(s).length === 1 && s.required?.length === 1);
    out.push(onlyRequired ? `${name} needs ${schema.anyOf.map((s) => `"${s.required![0]}"`).join(" or ")}` : `${name} matches none of the allowed forms`);
  }
  return out;
}

// ---- the rules `check` applies ----------------------------------------------------------------

/** Every problem with the review files under `<root>/reviews`. Each message starts with the file's repo-relative path. */
export function reviewProblems(root: string): string[] {
  const out: string[] = [];
  const entries = reviewFiles(root).sort().map((file) => ({ rel: path.relative(root, file).split(path.sep).join("/"), load: () => readReview(file) }));
  if (!entries.length) return out;
  let schema: Schema;
  try { schema = readSchema(root); } catch (e) { return [`reviews/schema.json: not readable (${(e as Error).message})`]; }
  const ids = new Map<string, { rel: string; document: string; record: ReviewRecord }>(), replies: [string, string, string][] = [];
  for (const { rel, load } of entries) {
    let data: unknown;
    try { data = load(); } catch (e) { out.push(`${rel}: not readable JSON (${(e as Error).message})`); continue; }
    if (!isObject(data)) { out.push(`${rel}: must be a JSON object`); continue; }
    const r = data as ReviewFile;
    if (r.format !== "bh-review/1") { out.push(`${rel}: format must be "bh-review/1"`); continue; }
    if (isPrivateDocument(root, r.document)) {
      out.push(`${rel}: reviews "${r.document}", a private page. The repo and the published site are public, so keep this review file out of the repo (send it to the author privately)`);
      continue;
    }
    out.push(...schemaProblems(data, schema).map((p) => `${rel}: ${p}`));
    if (typeof r.document === "string") {
      const doc = canonicalDocument(r.document);
      if (!/^docs\/[^/]+\.html$/.test(doc)) out.push(`${rel}: document "${r.document}" is not a page in docs/`);
      else if (!fs.existsSync(path.join(root, doc)) || !fs.statSync(path.join(root, doc)).isFile()) out.push(`${rel}: document "${r.document}" doesn't exist`);
      else if (doc !== r.document) out.push(`${rel}: document "${r.document}" should be written as "${doc}" (a path from the site root)`);
    }
    if (!Array.isArray(r.comments)) continue; // reported by the schema
    r.comments.forEach((cm, i) => {
      if (!isObject(cm)) return; // reported by the schema
      const where = `${rel}: comment ${i + 1}`;
      if (typeof cm.id === "string" && cm.id) {
        const message = { rel, document: canonicalDocument(r.document), record: reviewRecord(cm, r) };
        if (ids.has(cm.id)) {
          if (!sameReviewMessage(ids.get(cm.id)!, message)) out.push(`${where}: id "${cm.id}" is also used in ${ids.get(cm.id)!.rel} with different content or document`);
        } else ids.set(cm.id, message);
      }
      if (typeof cm.inReplyTo === "string") replies.push([where, cm.inReplyTo, canonicalDocument(r.document)]);
    });
  }
  for (const [where, parent, document] of replies) {
    if (!ids.has(parent)) out.push(`${where}: replies to "${parent}", which isn't in any review file`);
    else if (ids.get(parent)!.document !== document) out.push(`${where}: replies to "${parent}", which is a comment on ${ids.get(parent)!.document}, not ${document}`);
  }
  return out;
}
