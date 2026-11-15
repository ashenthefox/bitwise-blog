// The review-file validator `check` runs on reviews/ (scripts/reviews.mts): the schema keywords it
// enforces, the messages it gives, and its refusal of reviews of private or sealed pages, which must
// never reach the public repo.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { schemaProblems, readSchema, SCHEMA_KEYWORDS, SCHEMA_ANNOTATIONS, reviewProblems, type Schema } from "../scripts/reviews.mts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const document = "docs/edge-rate-limiting-design.html";
const comment = { id: "rv-root", created: "2026-11-01T09:00:00Z", kind: "question", body: "Why?", target: { anchor: "", anchorKind: "top", quote: null } };
const review = (extra: Record<string, unknown> = {}, comments: unknown[] = [comment]) => ({ format: "bh-review/1", document, build: { commit: null }, reviewer: "Reader", comments, ...extra });

/** A small site: one public page, one sealed page, the schema, and one valid review. */
function miniSite(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-reviews-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "docs"));
  fs.mkdirSync(path.join(dir, "reviews/inbox"), { recursive: true });
  fs.writeFileSync(path.join(dir, document), "<!doctype html><title>Public</title>");
  fs.writeFileSync(path.join(dir, "docs/secret.html"), '<!doctype html><meta name="bh:sealed" content="aes-256-gcm+gzip"><title>Private page</title>');
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  fs.copyFileSync(path.join(source, "reviews/schema.json"), path.join(dir, "reviews/schema.json"));
  fs.writeFileSync(path.join(dir, "reviews/inbox/valid.json"), JSON.stringify(review()));
  return dir;
}

test("the validator enforces every keyword reviews/schema.json uses", () => {
  const unknown = new Set<string>();
  const walk = (s: Schema) => {
    for (const [k, v] of Object.entries(s)) {
      if (!SCHEMA_KEYWORDS.includes(k) && !SCHEMA_ANNOTATIONS.includes(k)) unknown.add(k);
      if (k === "properties") Object.values(v as Record<string, Schema>).forEach(walk);
      if (k === "items") walk(v as Schema);
      if (k === "anyOf") (v as Schema[]).forEach(walk);
    }
  };
  walk(readSchema(source));
  assert.deepEqual([...unknown], [], "schema keywords schemaProblems ignores");
});

test("schema messages name the path and never repeat the file's text", () => {
  const schema = readSchema(source);
  assert.deepEqual(schemaProblems(review(), schema), []);
  const cases: [unknown, RegExp][] = [
    [review({ format: "other" }), /^format must be "bh-review\/1"$/],
    [review({ document: 42 }), /^document must be a string$/],
    [review({ comments: "x" }), /^comments must be an array$/],
    [{ format: "bh-review/1", document, comments: [] }, /^the file needs "build"$/],
    [review({}, [{ ...comment, kind: "<b>shout</b>" }]), /^comments\[0\]\.kind must be one of "comment", "suggestion", "question", "blocker"$/],
    [review({}, [{ ...comment, body: "" }]), /^comments\[0\]\.body must not be empty$/],
    [review({}, [{ ...comment, created: "yesterday" }]), /^comments\[0\]\.created must be an ISO date-time/],
    [review({}, [{ ...comment, target: undefined }]), /^comments\[0\] needs "target" or "inReplyTo"$/],
    [review({}, [{ ...comment, target: { anchor: "", anchorKind: "top", quote: { exact: 1, prefix: "", suffix: "" } } }]), /^comments\[0\]\.target\.quote\.exact must be a string$/],
    [review({}, [{ ...comment, target: { ...comment.target, position: { start: 1.5, end: 2 } } }]), /^comments\[0\]\.target\.position\.start must be an integer$/],
  ];
  for (const [value, expected] of cases) {
    const problems = schemaProblems(JSON.parse(JSON.stringify(value)), schema);
    assert.equal(problems.length, 1, `${expected}: ${problems.join(" | ")}`);
    assert.match(problems[0], expected);
    assert.doesNotMatch(problems[0], /shout|yesterday/);
  }
});

test("a valid review file has no problems", (t) => {
  assert.deepEqual(reviewProblems(miniSite(t)), []);
});

test("reviews of private and sealed pages are refused, however the path is written", (t) => {
  const root = miniSite(t);
  for (const doc of ["docs/secret.private.html", "docs/SECRET.PRIVATE.HTML", "docs/secret.html", "./docs/secret.html"]) {
    fs.writeFileSync(path.join(root, "reviews/inbox/check-me.json"), JSON.stringify(review({ document: doc })));
    assert.match(reviewProblems(root).join("\n"), /^reviews\/inbox\/check-me\.json: reviews ".*", a private page/m, doc);
    fs.rmSync(path.join(root, "reviews/inbox/check-me.json"));
  }
});

test("without a readable schema every review file is reported", (t) => {
  const root = miniSite(t);
  fs.writeFileSync(path.join(root, "reviews/schema.json"), "{broken");
  assert.match(reviewProblems(root).join("\n"), /reviews\/schema\.json: not readable/);
});
