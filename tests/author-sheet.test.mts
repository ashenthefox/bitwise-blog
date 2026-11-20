// author-sheet.mjs lets the author grade the calibration pages blind and compare (#371).
// These tests pin the blank sheet (no reference verdicts in it) and the comparison counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankSheet, compareSheet } from "../.claude/skills/pedagogical-writing/scripts/author-sheet.mjs";

const criteria = [{ id: "a", statement: "A holds" }, { id: "b", statement: "B holds" }, { id: "c", statement: "C holds" }];
const ref = { name: "page", reader: "someone", grades: { a: { verdict: "met", note: "ra" }, b: { verdict: "not_met", note: "rb" }, c: { verdict: "met", note: "rc" } } };

test("blankSheet: one empty verdict per criterion, the reader, and nothing from the reference", () => {
  const s = blankSheet(ref, criteria);
  assert.deepEqual(Object.keys(s.grades), ["a", "b", "c"]);
  assert.equal(s.reader, "someone");
  assert.ok(Object.values(s.grades).every(g => g.verdict === "" && g.note === ""));
  assert.doesNotMatch(JSON.stringify(s.grades), /not_met|"ra"|"rb"/, "no reference verdict or note leaks into the grades");
});

test("compareSheet: counts agreement over judged criteria, and on the reference's misses alone", () => {
  const sheet = { name: "page", grades: { a: { verdict: "met", note: "" }, b: { verdict: "met", note: "looked fine" }, c: { verdict: "unknown", note: "" } } };
  const c = compareSheet(sheet, ref);
  assert.equal(c.judged, 2, "unknown and blank verdicts are not judged");
  assert.equal(c.agree, 1);
  assert.equal(c.misses, 1);
  assert.equal(c.missesAgree, 0);
  assert.deepEqual(c.disagreements.map(d => [d.id, d.author, d.reference, d.authorNote, d.referenceNote]), [["b", "met", "not_met", "looked fine", "rb"]]);
});
