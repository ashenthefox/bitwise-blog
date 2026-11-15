// Direct unit tests for the link-target rule in scripts/check/link-targets.mts: which things need
// a stable id, and the shape of each component. tests/checker-rules.test.mts covers the rule end to
// end through `check` (one bad case, one clean control); these call it on a fragment, and assert
// the messages it returns, not text scraped from a CLI.
import assert from "node:assert/strict";
import { test } from "node:test";
import { linkTargetFindings, linkTargetProblems } from "../scripts/check/link-targets.mts";

/** The problems for `body` placed directly in the article, as a page has it. */
const problems = (body: string) => linkTargetProblems(`<main><article class="bh-article">${body}</article></main>`);

test("a clean page reports nothing", () => {
  assert.deepEqual(problems(`<h2 id="why">Why</h2><h3 id="why-not">Why not</h3><figure id="fig-1"><figcaption>Cap</figcaption></figure>`), []);
});

test("a page with no article is not checked", () => {
  assert.deepEqual(linkTargetProblems(`<h2>No id</h2>`), []);
});

test("findings carry the rule id and the same message as the problem", () => {
  const body = `<h2>Why not</h2>`;
  const html = `<article class="bh-article">${body}</article>`;
  assert.deepEqual(linkTargetFindings(html), [{
    rule: "links/link-target", level: "error",
    message: `<h2> "Why not" has no id, so it can't be linked to; add a stable kebab-case id`,
  }]);
  assert.deepEqual(linkTargetFindings(html).map((f) => f.message), linkTargetProblems(html));
});

test("headings: h2–h4 directly in the article need an id; h1 and nested headings do not", () => {
  assert.deepEqual(problems(`<h2>A</h2><h3>B</h3><h4>C</h4>`), [
    `<h2> "A" has no id, so it can't be linked to; add a stable kebab-case id`,
    `<h3> "B" has no id, so it can't be linked to; add a stable kebab-case id`,
    `<h4> "C" has no id, so it can't be linked to; add a stable kebab-case id`,
  ]);
  assert.deepEqual(problems(`<h1>Title</h1><div class="card"><h3>Inside a component</h3></div>`), []);
});

test("headings: the id must be kebab-case", () => {
  assert.deepEqual(problems(`<h3 id="Bad_Id">Title</h3>`), [`<h3> "Title" id="Bad_Id" must be kebab-case (a-z, 0-9, hyphens)`]);
  assert.deepEqual(problems(`<h3 id="ok-1">Title</h3>`), []);
  assert.deepEqual(problems(`<h3 id="-lead">Title</h3>`), [`<h3> "Title" id="-lead" must be kebab-case (a-z, 0-9, hyphens)`]);
});

test("headings: a long title is cut at 50 characters in the message", () => {
  const title = "x".repeat(60);
  assert.deepEqual(problems(`<h2>${title}</h2>`), [`<h2> "${"x".repeat(47)}…" has no id, so it can't be linked to; add a stable kebab-case id`]);
});

test("figures: need an id, and the message names the caption when there is one", () => {
  assert.deepEqual(problems(`<figure><figcaption>Cap</figcaption></figure>`), [`<figure> "Cap" has no id, so it can't be linked to; add a stable kebab-case id`]);
  assert.deepEqual(problems(`<figure></figure>`), [`<figure> has no id, so it can't be linked to; add a stable kebab-case id`]);
  assert.deepEqual(problems(`<figure id="Fig"></figure>`), [`<figure> id="Fig" must be kebab-case (a-z, 0-9, hyphens)`]);
});

test("glossary entries and [data-linkable] blocks need an id", () => {
  assert.deepEqual(problems(`<dl class="glossary"><dt>Term</dt><dd>d</dd></dl>`), [`glossary entry "Term" has no id, so it can't be linked to; add a stable kebab-case id`]);
  assert.deepEqual(problems(`<dl class="glossary"><dt id="term">Term</dt><dd>d</dd></dl>`), []);
  assert.deepEqual(problems(`<dl class="kv"><dt>Not a glossary</dt><dd>d</dd></dl>`), []);
  assert.deepEqual(problems(`<table data-linkable></table>`), [`<table data-linkable> has no id, so it can't be linked to; add a stable kebab-case id`]);
  assert.deepEqual(problems(`<table data-linkable id="sizes"></table>`), []);
});

test("<bh-versions>: at least two figures, each with a data-label", () => {
  assert.deepEqual(problems(`<bh-versions><figure id="a" data-label="Current"></figure></bh-versions>`), ["<bh-versions> needs at least two <figure> versions"]);
  assert.deepEqual(problems(`<bh-versions><figure id="a" data-label="Current"></figure><figure id="b"></figure></bh-versions>`), [
    `<bh-versions> figure id="b" needs data-label (e.g. "Current", "Proposed")`,
  ]);
  assert.deepEqual(problems(`<bh-versions><figure id="a" data-label="Current"></figure><figure id="b" data-label="Proposed"></figure></bh-versions>`), []);
});

test("data-change: added, changed or removed", () => {
  assert.deepEqual(problems(`<p data-change="bogus">x</p>`), [`data-change="bogus" must be added, changed or removed`]);
  assert.deepEqual(problems(`<p data-change="added">x</p><p data-change="changed">y</p><p data-change="removed">z</p>`), []);
});

test("<bh-sequence>: actors, messages that refer to them, and a figure around it", () => {
  const seq = (inner: string) => `<figure class="diagram" id="seq"><bh-sequence>${inner}</bh-sequence></figure>`;
  assert.deepEqual(problems(seq(`<bh-actor data-id="a"></bh-actor><bh-actor data-id="b"></bh-actor><bh-msg from="a" to="b"></bh-msg><bh-note over="a, b"></bh-note>`)), []);
  assert.deepEqual(problems(seq(``)), ["<bh-sequence> has no <bh-actor data-id=…>"]);
  assert.deepEqual(problems(seq(`<bh-actor></bh-actor>`)), ["every <bh-actor> needs a data-id"]);
  assert.deepEqual(problems(seq(`<bh-actor data-id="a"></bh-actor><bh-msg from="a" to="z"></bh-msg><bh-note over="a q"></bh-note>`)), [
    `<bh-msg> refers to unknown actor "z"`,
    `<bh-note> refers to unknown actor "q"`,
  ]);
  assert.deepEqual(problems(`<bh-sequence><bh-actor data-id="a"></bh-actor></bh-sequence>`), [`<bh-sequence> must sit inside a <figure class="diagram" id=…> so it can be linked and captioned`]);
});

test("<bh-codewalk>: needs an id and a code block, and each step's lines must lie inside the code", () => {
  const walk = (steps: string, code = "<pre><code>one\ntwo\nthree</code></pre>") => `<bh-codewalk id="cw">${code}${steps}</bh-codewalk>`;
  assert.deepEqual(problems(walk(`<bh-cw-step lines="1-2, 3"></bh-cw-step>`)), []);
  assert.deepEqual(problems(`<bh-codewalk></bh-codewalk>`), [
    `<bh-codewalk> has no id, so it can't be linked to; add a stable kebab-case id`,
    "<bh-codewalk> needs a <pre><code> block",
  ]);
  assert.deepEqual(problems(walk(`<bh-cw-step lines="two"></bh-cw-step>`)), [`<bh-cw-step lines="two"> must look like "3-8, 12"`]);
  assert.deepEqual(problems(walk(`<bh-cw-step lines="2-9"></bh-cw-step><bh-cw-step lines="0"></bh-cw-step><bh-cw-step lines="3-2"></bh-cw-step>`)), [
    `<bh-cw-step lines="2-9"> is outside the code (1–3)`,
    `<bh-cw-step lines="0"> is outside the code (1–3)`,
    `<bh-cw-step lines="3-2"> is outside the code (1–3)`,
  ]);
  // Markup and entities in the code do not count as lines, and a trailing newline is not a line.
  assert.deepEqual(problems(walk(`<bh-cw-step lines="1-2"></bh-cw-step>`, `<pre><code><span>a</span> &amp;&amp; b\nc\n</code></pre>`)), []);
  assert.deepEqual(problems(walk(`<bh-cw-step lines="3"></bh-cw-step>`, `<pre><code>a\nb\n</code></pre>`)), [`<bh-cw-step lines="3"> is outside the code (1–2)`]);
});

test("<bh-matrix>: header, one score per option, and whole numbers 0–5", () => {
  const matrix = (head: string, rows: string) => `<bh-matrix id="m"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></bh-matrix>`;
  const head = `<th>Criterion</th><th>Weight</th><th>A</th><th>B</th>`;
  assert.deepEqual(problems(matrix(head, `<tr><td>Speed</td><td>3</td><td>4</td><td>5</td></tr>`)), []);
  assert.deepEqual(problems(matrix(`<th>Criterion</th><th>Weight</th><th>A</th>`, ``)), ["<bh-matrix> header needs: Criterion, Weight, then at least two options"]);
  assert.deepEqual(problems(matrix(head, `<tr><td>Speed</td><td>3</td><td>4</td></tr>`)), [`<bh-matrix> row "Speed" has 1 scores for 2 options`]);
  assert.deepEqual(problems(matrix(head, `<tr><td>Cost</td><td>9</td><td>4</td><td>x</td></tr>`)), [
    `<bh-matrix> row "Cost": weight "9" must be a whole number 0–5`,
    `<bh-matrix> row "Cost": score "x" must be a whole number 0–5`,
  ]);
  assert.deepEqual(problems(`<bh-matrix><table></table></bh-matrix>`), [
    `<bh-matrix> has no id, so it can't be linked to; add a stable kebab-case id`,
    "<bh-matrix> header needs: Criterion, Weight, then at least two options",
  ]);
});

test("<bh-chart>: a figure around it, a known type, at most six series, numeric rows", () => {
  const chart = (attrs: string, head: string, rows: string) =>
    `<figure id="c"><bh-chart${attrs}><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></bh-chart></figure>`;
  const head = `<th>x</th><th>A</th><th>B</th>`;
  assert.deepEqual(problems(chart(` type="bar" emphasis="B"`, head, `<tr><td>1</td><td>2</td><td>-3.5</td></tr><tr><td>2</td><td>1,200</td><td></td></tr>`)), []);
  assert.deepEqual(problems(chart(` type="pie"`, head, ``)), [`<bh-chart type="pie"> must be line or bar`]);
  assert.deepEqual(problems(chart(` emphasis="Z"`, head, ``)), [`<bh-chart emphasis="Z"> is not a series name`]);
  assert.deepEqual(problems(chart(``, `<th>x</th>`, ``)), ["<bh-chart> table needs a header row: x label, then one column per series"]);
  const seven = "<th>x</th>" + "ABCDEFG".split("").map((s) => `<th>${s}</th>`).join("");
  assert.deepEqual(problems(chart(``, seven, ``)), [`<bh-chart> has 7 series; past 6, fold the tail into "Other" or use small multiples`]);
  assert.deepEqual(problems(chart(``, head, `<tr><td>1</td><td>2</td></tr><tr><td>2</td><td>oops</td><td>3</td></tr>`)), [
    `<bh-chart> row "1" has 1 values for 2 series`,
    `<bh-chart> row "2": "oops" is not a number`,
  ]);
  assert.deepEqual(problems(`<bh-chart><table><thead><tr><th>x</th><th>A</th></tr></thead></table></bh-chart>`), ["<bh-chart> must sit inside a <figure id=…> so it can be linked and captioned"]);
});

test("<bh-stepper>: needs for= or an id so its steps can be linked", () => {
  const message = `<bh-stepper> needs for="figure-id" (or an id) so its steps can be linked to`;
  assert.deepEqual(problems(`<bh-stepper><bh-step>One</bh-step></bh-stepper>`), [message]);
  assert.deepEqual(problems(`<bh-stepper for="fig"><bh-step>One</bh-step></bh-stepper>`), []);
  assert.deepEqual(problems(`<bh-stepper id="steps"><bh-step>One</bh-step></bh-stepper>`), []);
});

test("problems come out in document order, so `check` prints them in a stable order", () => {
  assert.deepEqual(problems(`<h2>A</h2><figure></figure><bh-stepper></bh-stepper><h3>B</h3>`), [
    `<h2> "A" has no id, so it can't be linked to; add a stable kebab-case id`,
    `<h3> "B" has no id, so it can't be linked to; add a stable kebab-case id`,
    `<figure> has no id, so it can't be linked to; add a stable kebab-case id`,
    `<bh-stepper> needs for="figure-id" (or an id) so its steps can be linked to`,
  ]);
});
