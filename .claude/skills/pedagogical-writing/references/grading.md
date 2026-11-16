# Grading a teaching page

Use this when asked to grade or score a page, to compare pages or versions ("is this better
than last month?", "which of these needs work first?"), or to check whether a revision helped.
To find out what to fix and in what order, review the page instead (review.md): a grade says
*how many* criteria a page meets, a review says *what* to change.

## Contents

- Grade or review
- Running the grader
- Without Bash: the rubric by hand
- The scorecard
- Script checks
- Criteria (eleven, one per audit)
- Calibration
- Why it is built this way

## Grade or review

A grade is a scorecard: eleven criteria, each **met**, **not met** or **unknown**, each with a
quote and the section `#id` it comes from, and for a miss the gap in one sentence. It reports
criteria met out of criteria judged. **It gives no 1–10 number**: a number on a scale made up on
the spot is not comparable across runs, and two pages with the same total can fail different
things. Compare scorecards criterion by criterion.

## Running the grader

```bash
node <skill-dir>/scripts/grade.mjs docs/<slug>.html
```

`<skill-dir>` is the directory holding SKILL.md. It runs `page-stats.mjs`, then starts one fresh,
non-interactive judge per criterion. Each judge sees only the target reader, its one criterion
(read from this file), the script checks, and a prose extract of the page; nothing from the
conversation. It has read-only tools and runs in a scratch directory that holds only a copy of
the page, so it cannot open the repo or the reference grades. Each verdict is checked: the section must exist, the quote
must be word for word in that section, and a miss needs a gap. A verdict that fails the check,
or a judge that fails or times out, counts as **unknown**, never as a grade.

Options:

- `--judge claude:<model>` (default `claude:claude-sonnet-5-5`), `--judge pi:<provider/model>`,
  or any command, which gets the prompt on stdin (and its path in `GRADE_PROMPT_FILE`). Repeat `--judge` to use several:
  where they disagree, the verdict is unknown. A judge from another model family is the main
  defence against a judge going easy on pages Claude drafted (see Why).
- `--reader "<who>"`: the target reader. Default: the reader the page assumes.
- `--runs 3`: run each judge three times; runs that disagree make that criterion unknown.
- `--only opening-need,one-idea`, `--json`, `--out <file>`, `--extract` (print what the judges
  see, and run nothing).

Cost: one model call per criterion per judge per run, measured at US$0.05–0.10 each with Sonnet
on pages of 2,000–7,000 words, so about $0.50–1.10 for one run of all eleven; the scorecard prints
the total. Grade when you need the comparison; to improve a page, review it.

In pi, run the same command with `--judge pi:<provider/model>`. pi has no subagents, so the
script is how it gets a fresh context per criterion.

## Without Bash: the rubric by hand

Where no shell is available, apply the criteria below yourself, one at a time, and use the same
scorecard. Read each criterion's text again before judging it, quote exactly, and mark unknown
rather than guess. Say in the first line that the page was graded by hand by the same model, not
by isolated judges: a model grading in its own context, on a page it may have drafted, is the
weakest form of this grade.

## The scorecard

```
Scorecard: docs/<slug>.html (target reader: …)
N of M criteria met (K unknown). Judges: …; runs: …; date.
Biggest leap: the earliest miss among opening-need, one-idea and need-before-name, with its gap.

Script checks
- tldr-bullets pass: 3 bullets (at most 3)
- …

Criteria
- `opening-need` met: #question "How do you make abracadabra abracadabra abracadabra smaller…"
- `need-before-name` not met: #canonical "Sending the tree would cost bits"
  Gap: count the tree's cost in bits in #huffman, and open #canonical with that number.
- …
```

M counts met and not met. Unknown is reported, never counted either way.

## Script checks

`page-stats.mjs --json` decides these, and the judges take them as facts:

| Check | Pass when | Fails |
| --- | --- | --- |
| `tldr-bullets` | the `.tldr` has at most 3 bullets | more than 3, or no `.tldr` |
| `predict-folds` | at least one `details.predict` | none |
| `promise-phrases` | (information) every promise phrase with its section | never: the `promises-paid` judge decides payment |
| `voice-iqr` | each voice rate is inside the 3Blue1Brown interquartile range | never: outside is a **warning**, because the rates are direction, not law |

They are listed beside the criteria and are not counted in met out of judged.

## Criteria

Each criterion is judged on its own. Met, not met and unknown each have a test; the example
quotes are from real pages in this repo (a slug with `@<commit>` is an earlier published
version, read with `git show <commit>:docs/<slug>.html`) unless marked illustrative. The ids are
permanent, so scorecards stay comparable. The script gives its judges each criterion without
its examples, so an example cannot hand a judge the answer for a page the calibration grades;
the examples are for grading by hand.

### `opening-need`: the opening creates a need

Keywords: concrete hook before the mechanism; puzzle, failure, number, goal, wrong answer.

- **Met:** before the first explanation of how the idea works, the hero, TL;DR or first section
  gives the reader something concrete to want resolved: a puzzle, a failure, a surprising
  number, a goal with numbers, or the popular wrong answer. The title and TL;DR may name the
  idea and state the result. Example: how-deflate-sends-its-code opens "A Huffman code fitted
  to the text saves bits only if the decoder can be told what it is, and telling it costs bits
  too."
- **Not met:** the first section starts on the mechanism or a definition, with nothing yet that
  makes the reader want it. Example: token-bucket-rate-limiting@974536b `#mental-model` opens
  "Picture a bucket under a dripping tap. Each drip is a token." with no problem before it.
- **Unknown:** the page is a reference or announcement whose opening is meant to orient, not to
  teach, and you cannot tell which the target reader needs.
- **Evidence:** the hook; for a miss, the first sentence of mechanism.

### `one-idea`: one idea per section

Keywords: one new idea per `h2`; reachable from the last; title without "and".

- **Met:** each narrative `h2` adds one new idea that the section before makes nearly guessable.
  Its heading could be a short title without "and". Reference sections (implementation, a
  comparison table, a list of edge cases or production pitfalls after the mechanism, terms,
  further reading) and sections the page labels as skippable are exempt. Example: voice-notes-on-trial goes `#a-first-try` (a jury), `#no-single-meaning`
  (why it fails), `#mindreading` (where the meanings go wrong), one step each.
- **Not met:** a narrative section introduces two or more mechanisms, or a new idea with nothing
  before it that leads there. Example: how-deflate-works@ca066f8 `#dynamic-header` brings in
  counts, run-length symbols and a third Huffman code in 216 words.
- **Unknown:** the page has fewer than three narrative sections.
- **Evidence:** for a miss, the sentence where the second idea starts.

### `need-before-name`: need and crack come before each term

Keywords: why before what; naive try and where it breaks; then the fix and its name.

- **Met:** before the page names or gives the idea it builds, and each fix along the way, it
  shows why the reader needs it: a naive attempt and where it breaks, or a stated problem with
  numbers. A handle the prose uses often may come early with its plain meaning. Example:
  voice-notes-on-trial `#the-fix`, "Let's call a sentence like that a culture statement", once
  the jury method has cracked.
- **Not met:** a fix, term or formula arrives with its reason only asserted or not given.
  Judge each fix on its own, not the page on average: go section by section, list every fix
  and new term, small ones included, and find each one's need. One fix whose need is only
  asserted ("would cost bits", "is too slow", with no number and no failure shown), or only
  posed as a question with no cost shown, fails the criterion.
  Example: how-deflate-works@ca066f8 `#canonical`, "Sending the tree would cost bits", is never
  counted, so canonical codes answer a cost the reader has not seen.
- **Unknown:** the page builds no new term or fix (pure reference).
- **Evidence:** for a miss, the sentence that gives the fix or name without its need.

### `promises-paid`: promises are flagged and paid off

Keywords: simplification flagged; deferral paid by name; the opening's uses come back.

- **Met:** every promise is paid: each simplification is flagged where it is made and corrected
  later; each deferral ("later", "for now", "remember this") is picked up by name; each use,
  system or question the hero, TL;DR or opening names comes back. Start from the
  `promise-phrases` list and add the opening's promises. A deferral the page says it will not
  pay ("a later series takes that on") is paid. Example: voice-notes-on-trial `#the-fix`, "is
  the question we come back to at the end", answered in `#limits`.
- **Not met:** a promise is never paid, or a simplification is never flagged. Illustrative: a
  hero that promises "the production details the textbook leaves out", on a page with no
  section about production.
- **Unknown:** you cannot tell whether a later passage is the payoff.
- **Evidence:** for a miss, the promise as made, and the gap names where to pay it.

### `examples-first`: examples come before abstractions

Keywords: concrete numbers first; one running example; formula names what was computed.

- **Met:** each rule, formula or general claim that carries the mechanism comes after a concrete
  instance with real numbers, and one running example threads through the page. Example:
  how-deflate-sends-its-code `#example-code` counts the 11 symbols of abracadabra before any
  rule is stated.
- **Not met:** the mechanism is given in symbols or general terms first, with numbers only
  later or in a fold. Example: token-bucket-rate-limiting@974536b `#how-it-works`, "Add (now −
  last) × r tokens and clamp to b", with no instance before it.
- **Unknown:** the page has no mechanism to exemplify.
- **Evidence:** the first concrete instance, or for a miss the abstract statement.

### `figures-earn`: figures and interactives earn their place

Keywords: caption says what to notice; interactive says what to do and look for; default state teaches.

- **Met:** each figure's caption says what to notice, not only what it shows; each interactive
  the reader sets (a slider, an input, a button that changes a model) is introduced by a
  sentence that says what to do and what to look for, and its default state already makes the
  point. A stepper or codewalk needs no such sentence: its test is that each step's text says
  what the step means, not only what moved. Example: announcing-patchcov `#patch-coverage`, "Click a line's mark
  to decide whether a test covers it, and watch both numbers."
- **Not met:** a caption only names the picture, a control the reader sets appears with no
  instruction, or a step's text only narrates motion. Illustrative: a caption that reads "The token bucket."
- **Unknown:** the page has no figures or interactives, or the extract does not show what an
  interactive does.
- **Evidence:** the caption or the instruction sentence.

### `reader-checks`: the page has checks for the reader

Keywords: commit to an answer; aimed at the key step; tells models apart; reveal gives reasons.

- **Met:** before the end, at least one question asks the reader to commit to a concrete answer
  about the key step (not a side detail), the nearest plausible wrong model would answer it
  differently, and the reveal gives the reasoning, not only the answer. The `predict-folds`
  check says whether any `details.predict` exists. Example: how-deflate-sends-its-code
  `#dynamic-header` asks "Will DEFLATE's final list of lengths beat the tree on the example, on
  the paragraph, on both or on neither?", and the reveal says why "both" is the natural guess.
- **Not met:** no such question, or every question is about a side detail or reveals only the
  answer. Example: edge-rate-limiting-design has no question at all (right for a design doc, a
  miss for a lesson).
- **Unknown:** the only check is in an interactive whose behaviour the extract does not show.
- **Evidence:** the question.

### `sentences-carry`: the sentences carry the reader

Keywords: known before new; one name per thing; point stated; actor as subject, action as verb.

- **Met:** in the sections that carry the mechanism, sentences start from what the reader
  already has and end on the new point, one thing keeps one name, each paragraph states its
  point, and actions are verbs ("computes", not "performs a computation"). A few slips do not
  fail it. Example: how-deflate-sends-its-code `#canonical`, "Sending the tree is cheaper,
  because the codes are implied by its shape and need not be written out."
- **Not met:** a mechanism section repeatedly breaks these, enough to stall the target reader:
  a thing renamed mid-argument, paragraphs with no point, new information piled before the
  subject. Illustrative: "block", "chunk" and "superblock" used for one structure.
- **Unknown:** the page is too short to judge.
- **Evidence:** a representative sentence; for a miss, the worst one, and the gap gives its rewrite.

### `companion-voice`: the voice is a companion's

Keywords: you / we / let's at need, key step and payoff; voices the reader's objection.

- **Met:** both hold: the page speaks to the reader directly (you, we, let's) in at least two of
  the opening, the key step and the ending; and the main text, not only a fold, voices at least
  one objection or question the reader would have before answering it. Low pronoun rates alone
  do not fail it: `voice-iqr` is a warning. Example: how-deflate-sends-its-code `#canonical`,
  "You might object that we have swapped 11 symbol names for something worse".
- **Not met:** the page addresses the reader in at most one of those places, or never voices
  the reader's objection; or it talks about the document ("this section explains") or calls
  unshown steps obvious. Example: how-deflate-works@ca066f8 speaks to the reader only in its
  opening question and voices no objection in the main text.
- **Unknown:** the page is not written to teach a reader (a reference or a log).
- **Evidence:** the objection, or for a miss the most impersonal passage at the key step.

### `one-concept`: the page is one concept

Keywords: one question; under ~9,400 words; no second topic; headline is the takeaway.

- **Met:** the page answers one question, its later sections apply or detail that one idea, it
  is under about three times the 3,143-word median (the script's word count), and the title or
  TL;DR's first bullet states the transferable takeaway. Part of a series is fine. Example:
  how-deflate-sends-its-code, 6,619 words on one question, with its decoding and block-type
  sections labelled as skippable.
- **Not met:** a second topic starts ("and then there's also…") that the opening's question
  does not need, or the page is far past the length bound. Illustrative: a rate-limiting page
  that, after the token bucket, teaches circuit breakers.
- **Unknown:** you cannot tell what question the page answers.
- **Evidence:** the question or takeaway; for a miss, where the second topic starts.

### `ending-payoff`: the ending pays off the opening

Keywords: back to the opening's question by name; answer it; teach the trigger.

- **Met:** the last narrative section (before reference material, terms and further reading)
  returns to the opening's question or example by name and answers it, and says when to reach
  for the idea. Example: how-deflate-sends-its-code `#what-it-costs`, "Back to the paragraph
  from the start.", then the pattern to reuse wherever a format ships a model with its data.
- **Not met:** the page stops after its last mechanism or its reference material, or ends on an
  answer to a different question. Example: token-bucket-rate-limiting@974536b ends on
  `#gotchas` and further reading, never returning to the clients the hero describes.
- **Unknown:** the opening asks nothing for the ending to answer.
- **Evidence:** the ending's return, or for a miss the last narrative sentence.

## Calibration

The grader is trusted on a model only once it agrees with reference grades. The references are
in `evals/calibration/*.json` (each names the page, the commit or edits it was graded at, and a
verdict per criterion), and one command re-runs them all:

```bash
node <skill-dir>/scripts/calibrate.mjs [--judge spec] [--runs 3]
```

Targets: at least 80% of criteria agree with the reference; the broken copy fails exactly the
criteria that were broken; three runs give the same verdict on at least 90% of criteria. Most
reference verdicts are *met*, so a judge that always says met already agrees often: the script
also prints agreement on the reference's misses alone, and that number is the one to watch.

When the grader is consistently harsher or softer than the reference on one criterion, reword
that criterion here and re-run. Never shift its scores to compensate. Re-run the calibration
when the default judge model changes, and record each run in `skill-authoring`'s
`references/measurements.md`. The current reference grades were written by Claude Opus 5.5 from
this rubric, not by a person; until the author confirms them, agreement measures consistency
with a careful reading, not with human judgment. Three were changed after a judge run, each
marked `revised` with its reason, and all three moved from met to not met: a Claude reference
grader also goes easy on Claude-drafted pages. A borderline criterion can still flip when the
rubric or an unrelated part of the page changes, so compare scorecards made with the same
rubric: each scorecard prints this file's blob id as `rubric`.

## Why it is built this way

- **One isolated judge per criterion, with an Unknown option, calibrated against human
  grades:** Anthropic's guide to agent evals ("vague rubrics produce inconsistent judgments").
- **A judge from another family:** judges were up to 50% more likely to pass a failed
  criterion on their own output, and ensembling reduced but did not remove it (arXiv
  2604.06996).
- **Short keyword statements, and correcting by measurement:** for per-trait scoring, concise
  prompts beat long rubric prose, and score offsets can be measured on a small human-graded set
  (arXiv 2604.00259). Here the fix is to reword, not to shift.
- **Shuffled criterion order:** criterion order shifts rubric scores, and simple randomisation
  works about as well as balancing (arXiv 2602.02219). Each judge sees one criterion, so the
  order only matters across a run, and it is shuffled.
- **Pass/fail checklist items with a gap:** LangChain's `RubricMiddleware` and skillgrade grade
  this way. Sources and what was read are in sources.md.
