# Measurements

Run on 2026-10-22 and 23 with Claude Code 2.1.300. Agent `claude-sonnet-5-5`, judge
`claude-haiku-5-5`, three runs per case per arm, `-j 4`. Each case is graded as the fraction of
its graders that passed, averaged over runs; `Δ` is with-skill minus without.

**These are small samples.** Three runs move a case in steps of a third, and re-running
`pedagogical-writing` after fixing two of its graders moved single cases by up to 0.4 (the
`revise-directory-paragraph` Δ went from +0.17 to −0.17, with no change to the skill). Read the
mean across cases, and the sign across cases, not any one number.

## Contents

- `skill-authoring` output evals, three agent models
- `pedagogical-writing` output evals
- Trigger evals
- Re-run on 2026-10-28, after the quoting and held-out edits
- 2026-10-29: the two always-failing graders, and what limits `review-deflate-page` needs
- 2026-10-29: `pedagogical-writing`'s ADR query relabelled and its neighbours named
- 2026-10-30: #25's misses read from traces, and the #17 errors
- 2026-10-30: `pedagogical-writing`'s must-hold sections moved ahead of the catalogue (#85)
- 2026-10-30: errored trigger-eval runs no longer score (#94)
- 2026-10-30: why Haiku got little from `skill-authoring`, and the description change (#86)
- 2026-10-30: `anatomy` gets a "Not for" clause and trigger evals (#92)
- 2026-10-30: the comparison snapshot holds the whole repo (#96)
- 2026-10-30: three `pedagogical-writing` graders that passed in few or unstable runs (#97)
- 2026-11-10: `pedagogical-diagrams` added, and the boundary with `pedagogical-writing` (#80)
- 2026-11-12: what the scheduled run costs, measured through `npm run skill-evals` (#122)
- 2026-11-13: `pedagogical-writing` gets guidance for drafting with GPT and Claude models (#150)
- 2026-11-13: the per-model cases on Haiku and Opus, and a prose base prompt (#152)
- 2026-11-14: `pedagogical-writing` gets two kinds of analogy, hook uses as promises, and ordered applications (#171)
- 2026-11-14: `pedagogical-writing` no longer claims to scope a video (#170)
- 2026-11-16: Haiku and a model's drafts: the description gets a sentence of its own for that case (#154)
- 2026-11-16: `pedagogical-diagrams` after its second source pass (#230)
- 2026-11-16: `advisors` added, a skill that fires only on request (#117)
- 2026-11-16: `pedagogical-writing` tells Haiku to load it before answering (#233)
- 2026-11-17: `pedagogical-writing` grades pages, and the grader's calibration (#242)
- 2026-11-18: why the `pedagogical-diagrams` output scores fell with no change, and the judge (#237)
- 2026-11-18: every output suite with the Sonnet judge, both arms, and what it costs (#248)
- 2026-11-18: `fix-confusing-figure` graded on what the skill adds, and the two dropped conditions (#249)
- 2026-11-19: teaching moves from Sam Rose's posts in `pedagogical-writing` and `pedagogical-diagrams` (#357)
- 2026-11-18: why `needs-a-script` scored lower with the skill on two graders (#300)
- 2026-11-18: `needs-a-script`'s graders named for what they check, and which are guards (#318)
- 2026-11-18: six `pedagogical-writing` graders that rejected correct answers or passed in no arm (#299)
- 2026-11-18: "or reading any file" in `skill-authoring`'s description does not make Sonnet load other skills (#306)
- 2026-11-18: the Haiku misses of `pedagogical-writing` labelled from traces, and seven queries reworded (#308)
- 2026-11-18: the two `pedagogical-diagrams` review cases graded on what the skill adds, and three unsteady graders (#301)
- 2026-11-18: `prompt-opus-explainers` graded on what the skill adds (#317)
- 2026-11-18: `pedagogical-writing`'s description names one part of a page and planning one (#319)
- 2026-11-18: `pedagogical-writing`'s effort line reworded: the padding claim had no source (#332)
- 2026-11-19: teaching moves from Sam Rose's posts in `pedagogical-writing` and `pedagogical-diagrams` (#357)
- 2026-11-20: a prediction must not be answered before it is asked (#368)

### `skill-authoring` output evals (5 cases, three agent models)

Judge `claude-haiku-5-5` throughout. The suite was revised after a self-review against its own
rules, which said a case that scores the same with and without the skill should be dropped:
`skill-or-claude-md` (Δ 0.00) and `design-user-only-skill` (Δ +0.06) were deleted, a
`portable-frontmatter` case added in the same revision was deleted after its first run (Δ −0.07:
Claude already knows which fields are Claude Code only), and `needs-a-script` and
`merge-overlapping-skills` were added. Two graders were changed after seeing 0 of 3 in both arms:
`runs-loop` (the skill no longer recommends `run_loop.py`) became `run-trigger-evals`, and
`reruns-output-evals` became an `llm` rubric. Section 1 of `SKILL.md` (a generic skill-versus-
`CLAUDE.md` table) was cut to the repo-specific parts for the same reason.

| Case | Sonnet with / without | Haiku with / without | Opus with / without |
| --- | --- | --- | --- |
| add-evals | 1.00 / 0.14 (+0.86) | 1.00 / 0.19 (+0.81) | 1.00 / 0.14 (+0.86) |
| merge-overlapping-skills | 1.00 / 0.40 (+0.60) | 0.73 / 0.07 (+0.67) | 1.00 / 0.20 (+0.80) |
| review-flawed-skill | 1.00 / 0.67 (+0.33) | 0.62 / 0.42 (+0.21) | 0.92 / 0.83 (+0.08) |
| needs-a-script | 1.00 / 0.73 (+0.27) | 0.80 / 0.73 (+0.07) | 0.93 / 0.80 (+0.13) |
| fix-not-firing | 1.00 / 0.80 (+0.20) | 1.00 / 0.73 (+0.27) | 1.00 / 0.73 (+0.27) |
| **Mean** | **1.00 / 0.55 (+0.45)** | **0.83 / 0.43 (+0.40)** | **0.97 / 0.54 (+0.43)** |
| Cost, time | $1.89, 3.0 min | $0.16, 2.9 min | $4.08, 4.1 min |

How to read it:

- **The cases are tuned to this skill.** Sonnet's 1.00 on every case is a ceiling reached after
  iterating on these cases and this text, so it shows the skill delivers what it teaches, not that
  it generalises. The honest comparison is Δ, and a Δ near zero on a case means Claude already does
  it: `fix-not-firing` (+0.07 to +0.27 across runs) and `needs-a-script` (+0.07 to +0.27) are the
  weakest.
- **Haiku gets less from the skill where the task is judgment.** The review case scores 0.62 with
  the skill (+0.21), and `needs-a-script` +0.07, against 1.00 for Sonnet. This is the gap the best-
  practices guide warns of: a skill that is clear enough for Sonnet is thinner for Haiku. The
  cause was not the body: Haiku did not load the skill on those cases (fixed on 2026-10-30, last
  section).
- **Opus loses most of the review gain** (+0.08): without the skill it already finds most of the
  flaws in the fixture. The unaided gaps are the description limit and missing `evals/`.
- Earlier runs of the previous five-case suite on Sonnet gave a mean Δ of +0.26 and +0.30, which
  is the size of the run-to-run movement to expect.

### `pedagogical-writing` output evals (6 cases, converted from `evals.json`)

| Case | With | Without | Δ |
| --- | --- | --- | --- |
| rewrite-token-bucket | 1.00 | 0.47 | +0.53 |
| design-rank-interactive | 0.81 | 0.38 | +0.43 |
| outline-bloom-filters | 0.58 | 0.33 | +0.25 |
| review-deflate-page | 0.94 | 0.83 | +0.11 |
| plan-rank-select-series | 0.62 | 0.52 | +0.10 |
| revise-directory-paragraph | 0.56 | 0.72 | −0.17 |
| **Mean** | **0.75** | **0.54** | **+0.21** |

Cost $4.34, 10.5 minutes. An earlier run of the same suite, before two grader fixes and a longer
timeout for the review case, gave a mean Δ of +0.25, with `review-deflate-page` at −0.28 because
one with-skill run hit the 300 s limit. Observations:

- The skill helps most where it supplies a method the prompt does not mention (the token-bucket
  rewrite, the interactive design) and least where the task is mechanical (the paragraph
  revision) or the output is long and judged strictly (series planning).
- Two graders failed in both arms in both runs: the "each page teaches one concept and the plan
  says what the reader can do" check of `plan-rank-select-series`, and the "each section introduces
  exactly one new idea" check of `outline-bloom-filters`. By the agentskills.io guidance such
  graders are broken or too strict, not evidence about the skill. They are kept as converted so the
  conversion is faithful, and are listed in the PR as follow-up work on that skill's evals.
  (Both were replaced on 2026-10-29; see the last section.)
  (A third, "each finding gives a location, the missing beat and a fix" in `review-deflate-page`,
  failed in the first run and passed in 2 of 3 with-skill and 1 of 3 baseline runs in the second.)
- `review-deflate-page` cannot run the skill's `page-stats.mjs` audit: running it needs `Bash`
  and the sandbox refuses `Bash` here (see above), and the skill names the script by a repo-root
  path that does not exist in the sandbox anyway (#77).
- A `not_contains` grader on "obviously" failed for both arms because the answers quote the word
  while explaining what changed; it was changed to an `llm` grader.

### Trigger evals (`scripts/run-trigger-evals.mjs`)

Every trigger result above the 2026-10-30 section on errored runs (#94) counted errored runs in
the score; they are not rescored.

| Skill | Description | Should fire | Should stay quiet | Cost |
| --- | --- | --- | --- | --- |
| `skill-authoring`, first draft | 842 characters | 7 of 12 | 10 of 10 | $4.80 |
| `skill-authoring`, after one edit | 986 characters | 11 of 12 (12 of 12 once one query was reworded, see below) | 10 of 10 | $7.54 |
| `skill-authoring`, 6 held-out queries | as above | 3 of 3 | 3 of 3 | (in the row above) |
| `pedagogical-writing` | 817 characters | 11 of 12 | 10 of 10 | $3.97 |
| `pedagogical-writing`, 6 held-out queries (added 2026-10-28, Claude Code 2.1.310) | as above | 2 of 3 | 3 of 3 | $0.88 |

The edit named what the five missed queries were about (frontmatter fields and limits, user-only
invocation, `claude plugin eval`, linting) in the description. Four of the five then fired in all
three runs. The fifth ("my pedagogical-writing skill didn't fire when I asked Claude to review the
deflate page") kept missing, because the prompt reads as a request about the page, which another
skill owns; it was reworded to "my pedagogical-writing skill never seems to load when I ask for a
page review. how do I find out why?", which fires 3 of 3. That is a change to the query after
seeing it fail, not to the description, and is recorded so it is not mistaken for a result. The
held-out queries were written before tuning and not looked at until the end, but the set is small:
this shows no over-fit, not that there is none. Nothing stole prompts: the should-quiet half stayed at 0
triggers in every run. The six `pedagogical-writing` held-out queries were written after its
description was final. One of them ("give me a better running example for the arithmetic
coding explainer, the numbers I picked don't come out clean") fired in 1 of 3 runs the first
time and 2 of 3 in the re-run below: one query moves by that much between runs, so a single
3-run result is not a miss or a pass. The description was not tuned against it. Its one miss on the
original 22 queries is "is this ADR's context section clear enough for someone joining the team next month", which `pedagogical-writing` does not claim.

### Re-run on 2026-10-28, after the quoting and held-out edits

Claude Code 2.1.310, the same models (agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`), three runs per
arm per case, `-j 4`. It follows the edit that quoted `skill-authoring`'s description and added six
held-out queries to `pedagogical-writing`.

| Suite | Result | Earlier | Cost |
| --- | --- | --- | --- |
| `skill-authoring` trigger evals (28 queries: 22 train, 6 held-out) | 28 of 28 (train 22 of 22, held-out 6 of 6) | 22 of 22 | $7.52 |
| `pedagogical-writing` trigger evals (28 queries: 22 train, 6 held-out) | 27 of 28 (train 21 of 22, held-out 6 of 6); the miss is the ADR-context query, 0 of 3 | 21 of 22 | $4.92 |
| `skill-authoring` output evals (5 cases) | mean Δ +0.48; with-skill 0.92 to 1.00 | +0.45 | $1.93 |
| `pedagogical-writing` output evals (6 cases, one since deleted) | mean Δ +0.21; `revise-directory-paragraph` Δ 0.00 | +0.21 | $4.95 |

Nothing regressed. Per case, `skill-authoring`: add-evals +0.90, merge-overlapping-skills +0.60,
fix-not-firing +0.33, review-flawed-skill +0.29, needs-a-script +0.27. `pedagogical-writing`:
plan-rank-select-series +0.48, outline-bloom-filters +0.21, rewrite-token-bucket +0.20,
design-rank-interactive +0.19, review-deflate-page +0.17, revise-directory-paragraph 0.00. The
graders that failed in both arms last time still do (`plan-rank-select-series` "each page teaches one
concept", `outline-bloom-filters` "exactly one new idea"), so they remained follow-up work on that
skill's evals (closed on 2026-10-29; see the last section). The `review-deflate-page` case cost $2.62 of the $4.95; it is the one that runs long.

`revise-directory-paragraph` was deleted after this run (Δ 0.00 here, −0.17 and +0.17 in earlier
runs, so the skill does not earn its context on a mechanical rewrite). The tables above keep it
because they record what was run. Over the remaining five cases the same run's mean Δ is +0.25.
The 2026-10-28 `review-deflate-page` case kept its 25 turns and 900 s limit: an earlier with-skill
run hit a shorter limit, so lowering them to save cost would need its own measurement.

### 2026-10-29: the two always-failing graders, and the `review-deflate-page` limits (#83)

Claude Code 2.1.310, the same models, three runs per arm unless stated. I read the final answer of
every run of the two cases first (`aggregate-result.json` keeps it in each grader's `evidence`; the
trace files are deleted after the run unless `--keep-temp` is passed).

**What was wrong with the graders.** Both bundled a claim a judge cannot decide with one it can.

- `plan-rank-select-series` "each page teaches one concept, and the plan says what the reader can
  do after each page". Page 1 of every plan holds rank, a naive scan, a stored-answer table, block
  counts, a popcount and the word "succinct": whether that is one concept is not decidable from a
  plan. The second half is decidable, and it split the arms for a reason unrelated to the skill: the
  only run of six that passed was a baseline plan with a `Goal: The reader can ...` line per page,
  while the with-skill plans describe each page by its need, naive attempt, crack, fix and teaser.
- `outline-bloom-filters` "each section introduces exactly one new idea that follows from the one
  before" failed 0 of 6. "Exactly one" is a count an outline does not support (a with-skill outline's
  section 3 names the filter, the bit array and the hash functions together). "Follows from the one
  before" is checkable, and is what the skill teaches ("a ladder, not a list").

**Replacements**, worded before they were run and not changed afterwards. Rule: keep one if the
with-skill arm passes at least two more of five runs than the baseline, otherwise delete it.

| Grader | With | Without | Result |
| --- | --- | --- | --- |
| plan 01: each page has a sentence saying what the reader will understand or be able to do | 2 of 5 | 0 of 5 | deleted in #97 (it was kept, at the threshold; no gap in the later suite run, below) |
| outline 04: for at least three steps the outline says why the next section follows | 5 of 5 | 0 of 5 | kept |

The "one concept per page" and "exactly one new idea" halves are dropped, not reworded: I did
not find a phrasing a judge could decide from a plan or an outline. The plan grader is the weak result. In the full-suite run that
followed (3 runs per arm) it passed 1 of 3 with the skill and 1 of 3 without, so over the eight runs
of each arm it is 3 against 1. Treat it as unproven. The outline grader passed 3 of 3 against 0 of 3 again.

**`review-deflate-page` limits.** Measured on the unchanged case (`max_turns: 25`,
`timeout_seconds: 900`), two sets of three runs per arm:

| Arm | Turns | Seconds | Cost per run |
| --- | --- | --- | --- |
| with-skill | 13, 9, 9 then 11, 13, 9 | 122, 191, 149 then 102, 124, 157 | $0.33 to $0.73 |
| baseline | 13, 7, 10 then 6, 12, 11 | 115, 88, 66 then 115, 84, 95 | $0.22 to $0.63 |

No run came within 12 turns or 700 seconds of its limit, and cost follows the turns taken, not the
limit, so lowering the limits would change none of these runs and only cap a tail that has not
appeared. The cost varies between runs by a factor of two or more at the same turn count. The likely
driver is the 260 KB fixture page re-read on every turn plus the skill's own reads (not measured). The
limits stay as they are; a smaller fixture would cut the cost but would change what the case tests.
Its with-skill score was 0.94 on 2026-10-28 and 0.78 in both sets today with nothing changed, which
is the size of the run-to-run movement for this case (its Δ was +0.17, +0.00 and +0.17).

**Full suite, 5 cases, $4.86, 9.0 minutes.** Mean Δ +0.28 (+0.25 over the same five cases on
2026-10-28). Per case: rewrite-token-bucket +0.40, design-rank-interactive +0.38,
plan-rank-select-series +0.24, outline-bloom-filters +0.21, review-deflate-page +0.17. Every case is
positive, but as the note at the top says, read the mean and the sign across cases, not one
number: review-deflate-page's +0.17 is within the run-to-run movement.

Not done here: two more graders now score 0 in both arms, and were neither read nor reworded.
`outline-bloom-filters` "the crack is located" (03) failed 0 of 6 in the first run today and 0 of 3
in both arms of the full-suite run. `plan-rank-select-series` "prerequisites are named by title"
(03) was 0 of 3 in both arms of the full-suite run. They are the next candidates for the same
treatment. (#97 read them: see the 2026-10-30 section on those graders.)

### 2026-10-29: `pedagogical-writing`'s ADR query relabelled and its neighbours named (#84)

Claude Code 2.1.310, agent `claude-sonnet-5-5`, three runs per query unless stated. These are the
first trigger runs with `anatomy` in `.claude/skills`: the 2026-10-28 runs were made on a tree that
held only `pedagogical-writing` and `skill-authoring`.

**What changed, in order.**

1. The ADR query ("is this ADR's context section clear enough for someone joining the team next
   month…", #9, train) is now should-stay-quiet. It missed in every run since it was written with
   the skill (2026-10-20), and no version of the description has claimed ADRs: the label was a hope,
   not a scope. Most of the skill (need, naive attempt, crack, fix; predictions; a companion voice)
   is wrong for a record whose Context section Nygard calls "value-neutral … simply describing
   facts", and the skill that would take the prompt in practice, `review-adr`, is user-level, so
   the sandbox cannot measure an overlap with it. It stays as a near miss. This is a change to a
   label after seeing it fail, so the 28-query score below rises because of the label, not the
   description.
2. "Not for" names the neighbours: `review-adr`, `dataviz`, `anatomy`, `skill-authoring` and
   `update-config`. `pedagogical-diagrams` (#80) is left to that skill's own change.
3. Two should-stay-quiet held-out queries, written before any run: an isometric figure (#29,
   `anatomy`) and a bar chart (#30, `dataviz`).
4. After run 1, one edit against the train failure #7: "rewriting" and "or a passage of one" in
   "Use when", the category #7 stands for (a passage-level rewrite), not its words. The description
   is 1,009 characters, so a further neighbour needs words taken out elsewhere.

| Run | Description | Result | Cost |
| --- | --- | --- | --- |
| 1 | steps 1 to 3 | 28 of 30 (train 21 of 22, held-out 7 of 8); misses #7 (1 of 3) and #25 (0 of 3) | $5.40 |
| 2 | step 4 added | 29 of 30 (train 22 of 22, held-out 7 of 8); miss #25 (0 of 3); #7 2 of 3 | $5.39 |
| 2, re-run | the five queries with errored runs (#17, #18, #28, #29, #30) | 5 of 5 quiet; #17 and #18 errored again (both clean at 0 of 3 in run 1) | $0.66 |

Every should-stay-quiet query stayed at 0 triggers in every run, the ADR query and both new near
misses included. Errors here are other than the turn cap (the runner does not count that one); a
run that errors cannot fire, so a quiet pass on errored runs counts only with a clean run behind it.

**Was the drop in #7 and #25 the new description?** No. Both queries re-run on their own:

| Query | Old description, with `anatomy` | Step 1 to 3 description, with `anatomy` | Same, without `anatomy` | 2026-10-28, old, without `anatomy` |
| --- | --- | --- | --- | --- |
| #7, rewrite the Elias-Fano intro (train) | 0 of 6 | 5 of 12 | 5 of 6 | passed |
| #25, a better running example (held-out) | 0 of 6 | 0 of 12 | 1 of 6 | 1 of 3, then 2 of 3 |

`anatomy`'s presence is what lowered #7 (5 of 6 without it, 5 of 12 with it); the new description
did no worse than the old with `anatomy` present. In the missed #7 runs Claude answered in one turn
with no tool call: it rewrote the sentence itself. #25 was borderline before and is now a miss; its
runs used four or five turns, one hitting the 3-turn cap, so Claude was most likely looking for the
explainer (absent from the empty sandbox) before choosing a skill. The traces were not kept, so
that is a reading of the turn counts, not of the transcripts. #25 is held-out and the description
was not tuned against it. It is the open miss, and the next thing to try is the harness (a larger
turn cap, or the page in a fixture), not the description. The traces, read on 2026-10-30 (below), rule
out the turn cap.

### 2026-10-30: #25's misses read from traces, and the #17 errors (#91)

Claude Code 2.1.310, agent `claude-sonnet-5-5`, the description and query file of 1132adc. The
runner now keeps each run's trace with `--keep` and prints the text of every error it counts.

| Run | Queries and runs | Result | Cost |
| --- | --- | --- | --- |
| 1 | #25, 6 runs | 0 of 6; every run ended on its own | $0.29 |
| 2 | #25, 6 runs, `--max-turns 10` | 0 of 6; every run ended on its own | $0.29 |
| 3 | #17 and #18, 3 runs | quiet, no errors | $0.21 |
| 4 | the five queries that errored on 2026-10-29 (#17, #18, #28, #29, #30) | quiet, no errors | $0.79 |
| 5 | all 30, 3 runs | 29 of 30 (train 22 of 22, held-out 7 of 8); miss #25 (0 of 3); no errors | $5.49 |
| 6 | #17 and #18, 10 runs | quiet, no errors | $0.71 |

**#25 misses because the sandbox is empty, not because of the turn cap.** Every trace has the same
start: Grep for "arithmetic coding" and Glob for `*arithmetic*` in the working directory, then a
wider Grep or Glob (in some runs one outside the working directory, which is denied, or a Bash
call, which the case does not grant). All come back empty. Claude then says so and writes an
example itself ("I couldn't find the explainer anywhere in the repo, so I don't know which numbers
you picked. Here is a replacement example that works out exactly…"), or asks for the path. No run
called a skill. At the 3-turn cap, 2 of 10 runs (rows 1 and 5 above, and one by hand) ended at the
cap and 8 ended on their own; at 10 turns, all 10 (six above, four by hand) ended on their own in 4
to 6 turns. So more turns would not help. Putting the explainer in a fixture needs a
`scaffold_script`, which `claude plugin eval` runs only with `--scaffold` (author bash, run as the
user), and a per-query fixture does not fit `trigger-evals.json`; it is not done. #25 stays
held-out and unchanged (rewording it now would make it a train query), and is a known miss of the
harness: the held-out bar for `pedagogical-writing` is 7 of 8 with #25 the miss, and the rule for
writing such queries is in `evals.md` ("The working directory is empty").

**The #17 errors did not come back.** None of 19 runs of #17, or of 19 of #18, errored, including
a full-suite run at the same concurrency (`-j 5`) as on 2026-10-29. #17 answers in one turn with no
tool call, in 9 to 13 seconds against a 300-second limit, so a timeout or the sandbox does not fit;
#18 takes 4 or 5 turns in 7 to 15 seconds. The 2026-10-29 error text cannot be recovered: the runner
did not print it, and the result files were in its deleted temporary directory. **So the cause is
not known.** A failure outside the query (the API, for example) fits what is left, but nothing
shows it. The runner now prints the text under the query, so the next one will name its source.

### 2026-10-30: `pedagogical-writing`'s must-hold sections moved ahead of the catalogue (#85)

Claude Code 2.1.310, agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`, three runs per case,
`--ablation none` (with-skill arm only), `-j 4`, comparing `WITH` scores as `evals.md` prescribes.
"Before" is a `git archive` snapshot of `f9d2835`; "after" is `fd68146`, whose skill files are the same as at the commit that records this (it
changes only this file). Both used
`--scaffold --trust-plugin`, with the snapshot given a copy of `docs/how-deflate-works.html`.

| Case | Before | After | Change |
| --- | --- | --- | --- |
| design-rank-interactive | 0.96 | 0.92 | −0.04 |
| outline-bloom-filters | 0.78 | 0.81 | +0.03 |
| plan-rank-select-series | 0.71 | 0.63 | −0.08 |
| review-deflate-page | 0.81 | 0.90 | +0.09 |
| rewrite-token-bucket | 0.89 | 0.94 | +0.05 |
| **Mean** | **0.83** | **0.84** | **+0.01** |

Every change is inside the 0.2 that counts as noise, the signs are mixed, and the skill fired in
all 15 after-runs and all 15 before-runs. Cost: before $1.42 (four cases) plus $1.77
(`review-deflate-page`, run again, see below), after $2.37.

- **The first before-run scored `review-deflate-page` 0.00 at $0.00.** The snapshot held only the
  skill, so the scaffold's `cp docs/how-deflate-works.html` failed. That is a setup error, not a
  score; the case was run again with the page in the snapshot, and only that re-run is in the table.
- **What this does and does not show.** The evals never compact the conversation, so they show that
  the new order does not cost an uncompacted run more than the noise (three runs, one arm, steps of
  a third per case, so a small loss would not show). They do not show that the move helps after a
  compaction, and no transcript has shown a skipped step from the cut (the issue says the same).
- **Where the cut falls.** By byte offset the sections that govern every use (the core loop,
  Promises, In this repo, Drafting workflow, Reviewing, Caveats) now end at 12,389 bytes; the
  20,000-byte mark falls in Misconceptions and surprise instead of Voice (Opening, Ordering and
  pacing, Examples and numbers, and Formulas, notation and names stay inside it). The 5,000-token limit and the
  4-bytes-per-token ratio are the issue's estimates, not measured here: no tokenizer was available.
- Three graders pass in few or unstable runs, before and after alike. Passes out of 3 (counted
  from the per-run output, not the summary line, as #97 did): `outline` 03 1 before and 1 after,
  `review` 03 1 before and 2 after, `plan` 01 0 before and 0 after. They were weak before this
  change and are not touched by it. (This bullet first said `outline` 03 and `review` 03 failed in
  all three runs both times and `plan` 01 in two of three before; that was read off the summary
  line and was wrong. The #85 runs were not kept, so the counts here are the ones #97 took from
  them.) The three are dealt with in the #97 section below.

### 2026-10-30: errored trigger-eval runs no longer score (#94)

From this change on, `run-trigger-evals.mjs` leaves out of the score every run that errored
(other than at the turn cap) before calling the skill: such a run is not in `fired x/n` and is
counted beside it. A run that called the skill and then errored is scored. A query whose left-out
runs could tip the at-least-half rule either way (always when fewer than half its runs are scored)
is `ERROR`, which counts as not passed and makes the run exit 1 (`evals.md` has the rule). Before,
an errored run counted as a pass for a should-stay-quiet query and as a miss for a should-fire one.

Results recorded above this section used the old rule and are not rescored. The known case it
changes: #17 of `pedagogical-writing` errored in 3 of 3 runs in run 2 and in its re-run on
2026-10-29, and passed both times. Under this rule it would have been `ERROR` both times, so it
was measured that day only by run 1 (clean, 0 of 3). #18 also errored in those two runs; how many
of its runs did was not recorded. Two checks after the change, before and after its review fixes
(Claude Code 2.1.310, `claude-sonnet-5-5`, #17 and #18, two runs each), passed both queries with
no errors, for $0.14 each. No real run has errored since, so the `ERROR` path is tested only
against the fake `claude` in `tests/trigger-evals.test.mjs`.

### 2026-10-30: why Haiku got little from `skill-authoring`, and the description change (#86)

Claude Code 2.1.310, judge `claude-haiku-5-5`, three runs per arm unless stated.

**The issue's hypothesis was wrong.** It guessed that Haiku skips the ranking and "lowest rung"
steps because the body states them as principles. The transcripts of the two weak cases show
Haiku never read the body: in 3 of 3 with-skill runs of each case it did not call `Skill`. The
`skill-fired` grader is `with-only, not scored`, so those runs scored as the baseline and the Δ was
just noise around zero. The review runs `Glob` and `Read` the fixture and answer from general
knowledge; the script runs answer in one turn with no tool call. The three cases where Haiku scored
well (add-evals, merge-overlapping-skills, fix-not-firing) loaded the skill in 9 of 9 runs.

| Haiku, 5 cases, before the change (re-run 2026-10-30) | review-flawed-skill | needs-a-script | mean Δ of 5 |
| --- | --- | --- | --- |
| with / without (Δ) | 0.54 / 0.58 (−0.04) | 0.80 / 0.80 (0.00) | +0.39 |
| runs that called `Skill` | 0 of 3 | 0 of 3 | |

The 2026-10-22 table above gave the same two cases 0.62 / +0.21 and 0.80 / +0.07; the re-run's
−0.04 and 0.00 are the same kind of number, with a load rate of 0 of 3 behind them (the 2026-10-22
traces were not kept, so that run's load rate is not known).

The trigger evals say the same. With Haiku as the agent (`--model claude-haiku-5-5`) the 28
original queries gave should-fire 5 of 15 (train 13 of 22, held-out 5 of 6) and should-stay-quiet
13 of 13; Sonnet scores 28 of 28 on the file. Six queries added before tuning (two worded like the
failing cases, with a held-out share and two near misses) gave Haiku 0 of 4 should-fire and Sonnet
3 of 4 (the miss, #33, "is a skill the right home for this checklist, or a script, or a hook",
passes 3 of 3 with the new description).

**What moved Haiku.** Candidate descriptions, each run on all 34 queries with Haiku (train 25,
held-out 9, so the held-out miss counts are of 9):

| Description | Should-fire | Train / held-out passed | Should-stay-quiet |
| --- | --- | --- | --- |
| Old (986 characters; topics first, "Use when creating, reviewing…") | 5 of 15 on the original 28 | 13 of 22 / 5 of 6 | 13 of 13 |
| v1: short "what", then "Use whenever the request is about a skill" and a long topic list | 2 of 19 | 13 of 25 / 4 of 9 | 15 of 15 |
| Probe, not a candidate: "You MUST invoke this skill FIRST, before answering…" | 16 of 19 | 22 of 25 / 9 of 9 | 15 of 15 |
| v2: v1's topics, shorter, plus "Load it before answering or reading any file" | 17 of 19 | 23 of 25 / 9 of 9 | 15 of 15 |
| v3: v2 with the machinery list put back | 13 of 19 | 21 of 25 / 7 of 9 | 15 of 15 |
| v2b: v2 reworded to "Use whenever…" for the lint (it still wanted a literal "use when") | 16 of 19 | 24 of 25 / 7 of 9 | 15 of 15 |
| **Final**: "Use when the request is about a skill: … Load it before answering or reading any file." (721 characters) | 17 of 19, then 15 of 19 | 24 of 25 / 8 of 9, then 23 of 25 / 7 of 9 | 15 of 15, both runs |

- A longer list of topics did not help (v1, v3). A plain instruction to load the skill before
  answering did (v2, final). The repo's own rule says capitals and MUST do nothing for triggering;
  the probe shows the instruction matters for Haiku, and v2 shows capitals are not needed. The
  probe was run to learn whether the description could move Haiku at all, and was reverted.
- Held-out: v2 scored 9 of 9 and the final description 8 of 9 and 7 of 9. That is a one or two
  query difference between runs of one description (the final one, run twice), so the choice of
  the final wording over v2 rests on the lint's "Use when" rule, not on a held-out gap. The queries
  that still miss on Haiku are #8 ("is it worth putting this in a forked subagent…", 0 of 3 in
  every run since v1) and, in some runs, #32, #25 and #6. #8 is a train query: the category it stands for
  (how much machinery a skill needs) went back in as v3 and made things worse, so it stays a known miss.
- **Errored runs.** The candidate runs above used the runner before #94's clean-run rule, and
  only their result lines were read, so an errored run in them counts as the old rule counted it
  (a pass for a quiet query). The final description was run again after rebasing onto that rule:
  31 of 34 (should-fire 16 of 19, train 23 of 25, held-out 8 of 9, should-stay-quiet 15 of 15),
  with no errored run and no `ERROR` result. The Sonnet logs, read in full, show no errors.
- **The held-out numbers are optimistic.** The six added queries were written after the failing
  shape had been seen in the output cases, three of them are held out, and the held-out score
  was read when choosing between candidates. They show that Haiku fires on prompts worded
  differently from the two cases, not a clean test of generalisation.
- **`skill-creator` is not measured.** The old description said it adds the repo's rules on top of
  `skill-creator`; the final one does not say it (the body still does), and the sandbox holds no
  `skill-creator`, so a prompt it would take instead cannot be tested here.
- Nothing was stolen: every should-stay-quiet query stayed at 0 triggers in every Haiku run
  and both Sonnet runs, and `pedagogical-writing`'s own trigger evals on Sonnet are unchanged
  (29 of 30: train 22 of 22, held-out 7 of 8, the miss still #25).

**Output evals with the final description.** All five cases, three runs per arm, `-j 4`, no
`--allow-tools` (see `evals.md`: a `Bash` grant makes every run error on this machine).

| Case | Haiku, pass 1 | Haiku, pass 2 | Sonnet | Opus |
| --- | --- | --- | --- | --- |
| add-evals | 1.00 / 0.19 (+0.81) | 1.00 / 0.19 (+0.81) | 1.00 / 0.14 (+0.86) | 1.00 / 0.14 (+0.86) |
| merge-overlapping-skills | 1.00 / 0.07 (+0.93) | 1.00 / 0.33 (+0.67) | 1.00 / 0.27 (+0.73) | 1.00 / 0.27 (+0.73) |
| review-flawed-skill | 0.92 / 0.42 (+0.50) | 0.96 / 0.46 (+0.50) | 0.83 / 0.63 (+0.21) | 0.92 / 0.75 (+0.17) |
| needs-a-script | 0.93 / 0.80 (+0.13) | 1.00 / 0.80 (+0.20) | 0.93 / 0.73 (+0.20) | 1.00 / 0.80 (+0.20) |
| fix-not-firing | 0.93 / 0.73 (+0.20) | 0.93 / 0.80 (+0.13) | 1.00 / 0.73 (+0.27) | 0.93 / 0.87 (+0.07) |
| **Mean Δ** | **+0.52** | **+0.46** | **+0.45** | **+0.40** |
| Cost | $0.20 | $0.21 | $1.96 | $4.35 |

- **Haiku**, over both passes (six runs per arm): review-flawed-skill with-skill 0.54 → 0.94
  (Δ −0.04 → +0.50), needs-a-script 0.80 → 0.97 (Δ 0.00 → +0.17). Haiku called `Skill` in all 15
  with-skill runs of pass 1. The review gain is well above the 0.2 noise. The script case's Δ
  is capped near 0.2 because its baseline is 0.73 to 0.80, so its with-skill rise (0.80 to 0.97)
  is the number to read, and its Δ stays inside the noise.
- **Why no step was added to the body.** With the skill loaded, the with-skill Haiku answers
  find the reserved name, the over-limit first-person description, the repo-root path, the nested
  reference and the missing evals, point at the existing `lint-skills`, say to run the script, and
  lead with what stops loading. The misses left are a judge voting FAIL three to none on a ranked
  answer and a regex ("repo-relative" is not in `finds-hardcoded-path`'s pattern): grader noise,
  not a skipped step.
- **Sonnet and Opus.** With-skill scores are within a notch of 2026-10-22 and 2026-10-28
  (in the table's case order, Sonnet 1.00 / 1.00 / 0.83 / 0.93 / 1.00 now against 1.00 on every case
  before; Opus 1.00 / 1.00 / 0.92 / 0.93 / 1.00 before and 1.00 / 1.00 / 0.92 / 1.00 / 0.93 now). Sonnet
  called `Skill` in all 15 runs, so a firing change is not what moved it. Sonnet's
  review (0.83) and script (0.93) cases are the two that fall below the earlier 1.00, so they were
  re-run with the old description (a `git archive` of the commit before this change) against the new,
  six with-skill runs each, `--ablation none`: review 0.96 old, 0.94 new; script 0.97 old, 0.92
  new. Differences of 0.02 and 0.05 are noise at this sample (the script case's `lowest-rung` judge
  fails 3 votes to 0 in both versions), and different graders miss in different runs. This shows no
  drop larger than the noise; it does not show none.
- **Cost.** About $31 in all: Haiku trigger runs about $7.50, Sonnet trigger runs $14.96
  (this skill, its six new queries before the change, and `pedagogical-writing`), output evals
  about $6.90 (Haiku $0.57 over the before run and both passes, Sonnet $1.96, Opus $4.35), and the
  head-to-head $1.96 (equal to Sonnet's pass by coincidence: $0.67 + $0.30 + $0.69 + $0.30).
  The description is 265 characters shorter (986 to 721), which also saves context in every session.

### 2026-10-30: `anatomy` gets a "Not for" clause and trigger evals (#92)

Claude Code 2.1.310, agent `claude-sonnet-5-5`, three runs per query unless stated, all three repo
skills present. `dataviz` and `review-adr` are user-level, so the sandbox holds neither: a chart
query shows that `anatomy` stays quiet, not that `dataviz` takes it.

**What changed.** `anatomy`'s description (1,018 of 1,024 characters) ends "Not for the teaching
prose around a figure, page structure or what a page should show (pedagogical-writing), or charts of
data (dataviz)", and `VENDORED.md` lists it with the words taken out to make room. The new
`anatomy/evals/trigger-evals.json` has 26 queries (11 should-fire, 15 should-stay-quiet; train 16,
held-out 10), split before the first run. Nine of the 15 should-stay-quiet queries are
`pedagogical-writing`'s own should-fire prompts (the Elias-Fano intro, the deflate review, the
playground, the predict question, the wavelet-tree plan, the select-section flow, the arithmetic-coding
example, the monad-transformer order) or a reworded one (the "easier to understand" page); the other
six are chart, dashboard, house-diagram and `check`-failure requests. Upstream's `evals/evals.json` was not vendored: its five
cases are figure-building prompts, not trigger queries.

| Run | Skill | Result | Cost |
| --- | --- | --- | --- |
| 1 | `anatomy` | 25 of 26 (train 15 of 16, held-out 10 of 10; should-fire 10 of 11, should-stay-quiet 15 of 15); miss #5 (1 of 3) | $6.37 |
| 1b | `anatomy`, #5 as first worded, again | 2 of 3 (3 of 6 across both runs) | $0.22 |
| 2 | `anatomy`, #5 reworded, 6 runs | 6 of 6 | $0.64 |
| 3 | `pedagogical-writing`, all 30 queries | 29 of 30 (train 22 of 22, held-out 7 of 8); miss #25 (0 of 3), as on 2026-10-29 | $5.28 |
| 4 | `pedagogical-writing` #7, 6 runs, new `anatomy` description | 6 of 6 | $0.44 |
| 5 | `pedagogical-writing` #7, 6 runs, **old** `anatomy` description | 6 of 6 | $0.44 |

- **Query #5 is a change to a query.** It named `figures/rank-select/gauge.html` and
  `docs/rank-select.html`, which the empty sandbox lacks; the two missed runs read `Read`, `Grep`,
  `Glob` errors and hit the turn cap, the shape described under "the working directory is empty" in
  `evals.md`. It was reworded after failing to a question that carries no file ("how do I get an
  isometric anatomy figure I built as its own HTML page into one of our blog pages…"). The measured
  score of the first file is 25 of 26 with the first wording. The reworded #5 scored 6 of 6 alone
  (run 2); the full file was not re-run with it, so no 26 of 26 was measured, and #5 is now a train
  query tuned after a failure.
- **Every should-stay-quiet query stayed at 0 triggers**, `pedagogical-writing`'s prompts and the
  chart requests included. `anatomy` also did not steal anything from `pedagogical-writing`: its
  29 of 30 matches 2026-10-29.
- **The "Not for" clause did not fix #7, because #7 was not broken today.** The issue's acceptance
  criterion (#7 in at least 3 of 6 with `anatomy` present) is met, 6 of 6, but 6 of 6 also holds with
  the old `anatomy` description (run 5, made by putting the previous `SKILL.md` back for the run).
  The 5 of 12 on 2026-10-29 did not reproduce with either version, so it was most likely run-to-run
  variance (or the load rate of the whole skill list) and not `anatomy` taking the prompt. Nothing
  here shows the clause helps or hurts #7. Whether `anatomy` ever loaded in those missed runs is
  still unknown: their traces were not kept (#91). The clause is justified by the boundary it
  draws and by the near-miss queries staying quiet, not by a measured gain on #7.
- **Limits.** The `anatomy` should-fire half is mostly phrased with "isometric", which is the
  skill's own word, so it shows the skill still fires, not that it fires on a vaguer request. The
  held-out part has 3 should-fire and 7 should-stay-quiet queries, so "10 of 10" says little about
  how the clause behaves on real anatomy requests. Three should-stay-quiet queries refer to material the
  sandbox lacks (#9 names `docs/how-deflate-works.html`; #13 and #14 mean the gpu-deflate study and
  the deflate page); a quiet result on one could come from Claude looking for the file, though #9's
  prompt fires `pedagogical-writing` 3 of 3 in that skill's own file. Three runs per query step in thirds.

### 2026-10-30: the comparison snapshot holds the whole repo (#96)

Claude Code 2.1.310. **The old recipe, reproduced.** A snapshot of `.claude/skills/pedagogical-writing`
alone, run with `--case review-deflate-page --scaffold`, printed `score 0.00  $0.00` with
`scaffold failed (exit 1): cp: …/docs/how-deflate-works.html: No such file or directory` only in
`NOTES` (and in `.cases[].arms.with[].error` in `aggregate-result.json`). It exited 1 at the default
`--threshold` and 0 at `--threshold 0`, so the exit code does not catch it. `--help` lists no option
to point a scaffold at another root.

**The new recipe** (the repo at `HEAD`, the skill's own files from `f9d2835`, `evals/` from `HEAD`)
scaffolded the same case, which scored 1.00 in one run (`claude-haiku-5-5`, $0.02).

**`skill-authoring`, before and after this change**, compared with that recipe: before is `d213e19`
(`origin/main`), after is `1aa3c1d`. The later commits of #96 change only this file and the wording
around the comparison recipe in `evals.md`, after review. Agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`, three runs,
`--ablation none --scaffold`, `-j 4`.

| Case | Before | After | Change |
| --- | --- | --- | --- |
| add-evals | 1.00 | 1.00 | 0.00 |
| fix-not-firing | 1.00 | 1.00 | 0.00 |
| merge-overlapping-skills | 1.00 | 1.00 | 0.00 |
| needs-a-script | 1.00 | 0.89, re-run 1.00 | −0.11, then 0.00 |
| review-flawed-skill | 1.00, re-run 0.93 | 0.93, re-run 0.93 | −0.07, then 0.00 |
| **Mean (first runs)** | **1.00** | **0.96** | **−0.04** |

The skill fired in every run, the 15 first runs of each version and the 9 re-runs, and no run
errored. The two dips are in graders the edit
does not touch (`lowest-rung` in `needs-a-script`; `finds-hardcoded-path`, `finds-reserved-name` and
`ranks-and-fixes` in `review-flawed-skill`). Which grader fails changes from run to run, and the
before snapshot failed two of the same graders (`finds-reserved-name`, `ranks-and-fixes`) when
re-run. They are noise on long answers, inside the 0.2 rule,
and not a result of the change. Cost: before $1.26 (133 s) plus $0.33, after $1.25 (101 s) plus $0.49.

### 2026-10-30: three `pedagogical-writing` graders that passed in few or unstable runs (#97)

Claude Code 2.1.310, agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`, **both arms**, five runs
per arm per case, `-j 4`, `--keep-temp`. I read the final answers behind the verdicts
(`aggregate-result.json` keeps them in each grader's `evidence`). `--case` takes one case per run,
so each case was a separate run. Passes out of 5, as with-skill / baseline:

| Grader | Wording before this change | Old wording, with / without | Reworded, with / without | Result |
| --- | --- | --- | --- | --- |
| `plan` 01 | for each of the three pages the plan gives a sentence saying what the reader will understand or be able to do, and not only a list of topics | 1 / 3 | 4 / 4 | deleted |
| `outline` 03 | the crack is located (which lookups go wrong and why), and the fix follows from it | 3 / 0 | 4 / 0 | reworded |
| `review` 03 | each finding gives a location, the missing beat (need, naive attempt, crack or fix), and a concrete fix | 1 / 1 | 3 / 3 | deleted |

The reworded text was written before the second run and not changed after it. The rule is #83's:
keep a replacement only if the with-skill arm passes at least two more of five than the baseline.

- **`plan` 01 measured a phrasing, not the skill.** Baseline plans carry a `Goal: the reader can …`
  line per page (3 of 5 passed). With-skill plans describe each page by need, naive attempt, crack,
  fix and teaser (the skill's own ladder) and state the outcome only through those, so the grader
  passed 1 of 5. The reworded version accepts a goal, an outcome or a question, and both arms pass
  it: it no longer penalises the skill, and it tells the arms apart no better. The skill does not ask
  for a reader-outcome line (`SKILL.md` has none), so there is nothing here to teach the grader to
  find. Deleted. This is the replacement that #83 had "kept, at the threshold".
- **`review` 03 failed on the word "each".** Every answer in both arms ranks its main findings with
  a location and a fix, then ends with a "smaller items" list or an unranked paragraph that has
  neither, and the judge's votes on the same kind of answer ran from `FAIL FAIL FAIL` to `PASS PASS
  PASS`. "At least three findings, closing minor list excluded" is decidable and was passed by 3 of
  5 in each arm: the baseline review also gives a section, a fix and what is missing. The skill's
  vocabulary (need, naive attempt, crack) does not change what a judge accepts. Deleted. The case's
  other five graders are unchanged.
- **`outline` 03 separated the arms before it was reworded** (3 of 5 against 0 of 5; it was 1 of 3
  in the #85 runs (PR #95) and 0 of 6 in #83's, so it moves a lot). Its with-skill failures were not missing
  cracks: two of the answers had a "Crack" line or section and named the property the fix needs,
  and the judge still voted `FAIL FAIL FAIL` on "which lookups go wrong", which asks for more than
  an outline gives. The baseline outlines describe the structure and never show a failure of a
  naive attempt, so they fail on any wording. The reworded text asks for a specific failure and
  what causes it, and what the fix must do about it; it passed 4 of 5 against 0 of 5.
  That is the same case and prompt the rewording was drawn from, five runs, and this grader has
  moved from 0 of 6 to 3 of 5 on one wording, so read the 4 as "still separates the arms", not as
  a measured rate.
- **`plan` 03 ("prerequisites by title") stays.** It is not one of the three. Old and new runs
  passed it 2 of 5 and 1 of 5 with the skill and 0 of 5 and 0 of 5 without, so 3 against 0 over ten
  runs.
- **Case scores** (with / without), old wording then new: `plan-rank-select-series` 0.60 / 0.51 then
  0.71 / 0.43; `outline-bloom-filters` 0.72 / 0.33 then 0.75 / 0.40; `review-deflate-page` 0.87 /
  0.77 then 0.77 / 0.83. The first two cases now separate the arms by about 0.3; the third has no
  gap, and its Δ is inside the run-to-run noise either way (+0.10, −0.06). Dropping the grader
  changes the case's score by construction (it has five graders now), so these are not a
  measure of the skill.
- **Not done here.** `review-deflate-page` has no reading-order or clarity grader that separates the
  arms now; its remaining graders pass in both. Whether the case should be kept (its Δ has ranged
  from −0.06 to +0.17 across runs, apart from one earlier run that read −0.28 because a with-skill
  run hit the timeout) is the #83 question and is left open.
- **Cost.** $6.64 for the old wording ($4.68 `review`, $1.10 `plan`, $0.86 `outline`), $6.29 for the
  reworded ($4.32, $1.06, $0.91): $12.93 in all.

## 2026-11-10: `pedagogical-diagrams` added, and the boundary with `pedagogical-writing` (#80)

Claude Code as in the runs above, agent `claude-sonnet-5-5`, three runs per query or per case per arm.

**Trigger evals** (`npm run trigger-evals`, every skill in the temporary plugin):

| Suite | Result | Cost |
| --- | --- | --- |
| `pedagogical-diagrams` (24 queries: 15 train, 9 held-out; 14 should-fire, 10 should-stay-quiet) | 24 of 24 both times (train 15 of 15, held-out 9 of 9) | $4.14, $4.15 |
| `pedagogical-writing`, with the new neighbour present (38 queries: 8 added for this boundary) | first run 36 of 38; after one description edit 37 of 38 | $6.93, $7.11 |

- **One boundary leak, fixed.** The new query "the step captions under my stepper just narrate motion"
  (should fire `pedagogical-writing`) loaded `pedagogical-diagrams` in 3 of 3 runs, because that
  description claimed "stepper steps". The edit removed "stepper steps" from the claims and added
  "the wording of step captions" to its "Not for"; the same query then passed 3 of 3. The query was not
  changed.
- **#25 ("a better running example for the arithmetic coding explainer") is not a regression.** It
  missed 0 of 3, then 1 of 3 with the new skill present. A snapshot of `origin/main` without it also
  scored 0 of 5. The traces show runs searching with Grep and Glob for the explainer file, which the
  empty sandbox lacks, until the turn cap: no skill was called, and none of them was
  `pedagogical-diagrams`. Earlier runs moved it between 1 of 3 and 2 of 3 (see the 2026-10-28 section).
- Both skills' near-miss queries on each side of the boundary are in their trigger-eval files. The
  `pedagogical-writing` head-room check: its description is 934 of 1,024 characters after the edit.

**Output evals**, four cases for `pedagogical-diagrams`. The first version of the cases scored a mean
Δ of −0.03 (Haiku judge) and +0.03 (Sonnet judge). Reading the answers showed why: on an explicit
"design this figure" prompt the baseline answer already chooses a form, names what it leaves out and
writes a caption, so a grader asking for those cannot separate the arms. Where the with-skill
answers differed was in what the skill adds: the repo's components and `data-ref`, naming the one
point before listing elements, saying what the figure simplifies, an explicit check for what a
newcomer would misread, and the cut-or-integrate condition for text that restates a figure. The
graders were rewritten to ask for those, which the baseline cannot meet by luck for two of them (the
regexes for `bh-stepper` and `data-ref`).

| Case | With | Without | Δ |
| --- | --- | --- | --- |
| `design-lz77-figure` | 0.94 | 0.11 | +0.83 |
| `fix-confusing-figure` | 0.78 | 0.50 | +0.28 |
| `review-deflate-figures` | 0.90 | 0.76 | +0.14 |
| `review-stepper-boundary` | 0.93 | 0.73 | +0.20 |

Mean Δ +0.36, Sonnet judge, $6.37. **Read this with two cautions.** The graders were written after the
with-skill answers had been read, so the gap is partly the skill's rules grading themselves; and
`design-lz77-figure` is the only case with a large gap, helped by the two regex graders. The `review-`
cases keep the small gaps the `pedagogical-writing` review case also has (+0.06 to +0.14). With the
Haiku judge the same answers scored lower and scattered widely (one answer of the boundary case got 0.2
for a response that addressed every point), which is why the Sonnet judge was used for the table.

## 2026-11-12: what the scheduled run costs, measured through `npm run skill-evals` (#122)

Claude Code 2.1.318, agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`, one run each, from `scripts/skill-evals.mts`.
These are the first records the script wrote, taken to size the monthly workflow's cost ceiling and to check that it reads
what the two eval tools write; they are not a comparison of any skill version.

| Run | Result | Cost |
| --- | --- | --- |
| `anatomy` trigger evals, 26 queries x 3 runs | 26 of 26 passed (11 of 11 should-fire, 15 of 15 should-stay-quiet; train 16/16, held-out 10/10) | $6.82 |
| `pedagogical-diagrams` output evals, 4 cases, both arms | 0.75 with the skill, Δ +0.24 | $3.69 |

- **A trigger query costs about $0.27**, so the 122 queries of the four skills are about $33 and the largest suite
  (`pedagogical-writing`, 38) about $10. An output suite is a few dollars. A full run is therefore roughly $40 to $60.
- **An earlier attempt with a $5 cap stopped at 21 of 26 queries** ($5.58, the ceiling is checked before each run
  starts so it can be passed by the runs in flight). The runner reported the other five as missing, which the script first
  called "failed to load". `--json` now records `partial`, so a run cut short by the ceiling says so.

## 2026-11-13: `pedagogical-writing` gets guidance for drafting with GPT and Claude models (#150)

Claude Code 2.1.317, agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`, three runs per arm. The change adds
`references/drafting-with-models.md`, a reading-list entry, a clause in the description ("or a prompt that makes GPT or
Claude write one"), four trigger queries (#39 to #42, two held-out) and the output case `prompt-sol-explainers`.

| Run | Result | Cost |
| --- | --- | --- |
| New trigger queries only (`--only 39,40,41,42`) | 4 of 4 (train 2/2, held-out 2/2) | $1.69 |
| `prompt-sol-explainers`, first version | with 0.80, without 0.87, Δ −0.07 | $0.46 |
| `prompt-sol-explainers`, after the fixes below | with 1.00, without 0.56, Δ +0.44 | $0.47 |
| Full trigger suite, 42 queries | 41 of 42 (train 29/29, held-out 12/13); the miss is #25, 0 of 3 | $8.83 |
| Full output suite, 6 cases | mean Δ +0.34 | $4.24 |

- **The first version of the case caught a defect in the reference.** Every with-skill run failed "drops the brevity
  rule": the base prompt said "Keep it short by choosing what to include" while the Sol lines said "Length is not a
  constraint". That is the conflicting pair the reference itself warns a literal model obeys both halves of. The base
  prompt now says what to leave out, not how long to be.
- **Two graders measured what Claude already does.** The baseline proposed a "confused reader" second pass in 2 of 3
  runs, so that grader was replaced by one for checking a rewrite for lost claims, conditions and exceptions, and a grader
  was added for removing leftover or conflicting rules elsewhere because the model follows instructions literally. No
  baseline run passed either. **Caution:** both were written after reading with-skill answers, so part of the +0.44 is
  the reference grading itself, as with `pedagogical-diagrams` above.
- **Per case** in the full suite: `design-rank-interactive` +0.48, `rewrite-token-bucket` +0.47, `outline-bloom-filters`
  +0.46, `prompt-sol-explainers` +0.44, `plan-rank-select-series` +0.33, `review-deflate-page` −0.13. The review case has
  moved between −0.28 and +0.17 across earlier runs with no change to the skill, and its with-skill score (0.80) is in its
  earlier range (0.81 to 0.87), so this is read as noise, not a regression from a reading-list line.
- **#25 missed in all three runs**, as it has before (1 of 3, then 2 of 3): it names an explainer the empty sandbox lacks.

**Cases for the other three models**, added the same day. Their graders were written before any answer to them had been
read, so unlike `prompt-sol-explainers` the gaps are not the reference grading answers it had already seen.

| Case | With | Without | Δ | Cost |
| --- | --- | --- | --- | --- |
| `prompt-sonnet-setup` | 0.93 | 0.47 | +0.47 | $1.82 |
| `prompt-opus-explainers` | 0.93 | 0.67 | +0.27 | $1.68 |
| `prompt-astra-tutorials` | 1.00 | 0.87 | +0.13 | $0.51 |

- **Sonnet:** the baseline knew that `between_tools` with no tools means no thinking (3 of 3), but never tied the missing
  steps to literal instruction following and never split drafting from a scoped revision. The with-skill miss is one run of
  the literal-following grader.
- **Opus:** the gap is mostly the effort setting (no baseline run raised effort) plus one run each of point-first and
  showing the consequence. One with-skill run failed "don't rely on its own revision" (votes PASS FAIL FAIL).
- **Astra measures little.** Its prompt gives away most answers: it quotes the nominalised sentence and points at the
  2,000-line style skill, and the baseline passed the skill-file audit in every run. Only "asks for depth" separates the
  arms. Δ +0.13 is under the 0.2 noise rule. It is kept as recorded; a rewrite with fewer hints would be a change to the
  case after seeing it score, and should be recorded as one.
- `--case` takes one glob: repeating the flag kept only the last, and a brace glob (`prompt-{opus,astra}-*`) or a bracket
  glob (`prompt-[oa]*`) matched nothing and printed nothing. Run such cases one `--case` at a time.

**`prompt-astra-unhinted` replaces `prompt-astra-tutorials`.** The new prompt names only the symptom (readers find the
tutorials hard to follow although the content is right), with no quoted sentence and no mention of a skill file. Its six
graders were written before the run.

| Case | With | Without | Δ | Cost |
| --- | --- | --- | --- | --- |
| `prompt-astra-unhinted` | 1.00 | 0.61 | +0.39 | $0.51 |

No baseline run gave a rule for abstract-noun sentences or a way to simplify without losing conditions and exceptions
(0 of 3 each), and one missed the other instruction files Codex reads. The hinted case was deleted, since it measured under
the noise rule and the new case covers the same ground; its result above stays as the record.

## 2026-11-13: the per-model cases on Haiku and Opus, and a prose base prompt (#152)

Claude Code 2.1.318, judge `claude-haiku-5-5`, three runs per arm, each case run on its own (`--case` takes one glob).
The two commits that added `prompt-opus-explainers`, `prompt-sonnet-setup` and `prompt-astra-unhinted` were pushed after
#151 merged, so they land here.

**The four cases with other agent models** (with / without the skill; "fired" is the with-skill runs that called `Skill`):

| Case | Haiku | Haiku fired | Opus | Opus fired |
| --- | --- | --- | --- | --- |
| `prompt-sol-explainers` | 0.94 / 0.39 | 3 of 3 | 0.89 / 0.28 | 3 of 3 |
| `prompt-astra-unhinted` | 0.94 / 0.33 | 3 of 3 | 1.00 / 0.50 | 3 of 3 |
| `prompt-opus-explainers` | 0.60 / 0.80 | **1 of 3** | 0.80 / 0.73 | 3 of 3 |
| `prompt-sonnet-setup` | 0.67 / 0.47 | 3 of 3 | 0.93 / 0.60 | 3 of 3 |

Haiku $0.33, Opus $8.10.

- **Haiku's −0.20 on `prompt-opus-explainers` is a loading failure, not a worse answer.** The skill fired in one run of
  three, and even an answer written with the skill in view said it "didn't open the skill's `drafting-with-models.md`
  reference" and answered from the core loop instead (need, naive attempt, crack, fix), which the point-first grader does
  not reward. The prompt reads as a question about an API model's system prompt. The same gap as #86: Haiku needs a more
  explicit pointer, or a trigger query that measures it (`--model claude-haiku-5-5`).
- **Opus without the skill already gets most of `prompt-opus-explainers`** (Δ +0.07, under the noise rule); no arm on any
  model raised effort, so that grader fails everywhere and may be asking for a fact the reference states too quietly.
- **Sol and Astra hold on both models** (Δ +0.50 to +0.61).

**Prose versus list base prompt** (Sonnet agent, `--ablation none`, with the skill only):

| Case | List | Prose |
| --- | --- | --- |
| `prompt-sol-explainers` | 0.95 | 1.00 |
| `prompt-astra-unhinted` | 0.95 | 1.00 |
| `prompt-opus-explainers` | 0.89 | 0.89 |
| `prompt-sonnet-setup` | 0.89 | 0.83 |
| Mean | 0.92 | 0.93 |

List $2.30, prose $2.41. Equal within noise, so the prose version was kept: no worse on Claude's advice, and in the
form Anthropic's guide recommends. **This does not test what the change is for.** Whether a prose prompt makes Astra write
fewer bullets needs Astra's own output; a direct API run was not made here.

## 2026-11-14: `pedagogical-writing` gets two kinds of analogy, hook uses as promises, and ordered applications (#171)

Claude Code 2.1.318, agent `claude-sonnet-5-5`, judge `claude-haiku-5-5` unless stated, three runs per arm. The gaps came
from reading a science explainer video against the skill. Three cases were written, graders included, before any
answer to them had been read: `outline-amortised-append` (does an analogy lead, return by name, state its limit),
`outline-consistent-hashing` (does the opening promise a use, are the applications ordered) and
`review-branch-prediction-passage` (does a review catch one label on two mechanisms, and a refuted belief that returns).
The examples in the new rules were chosen not to match the cases (no coins per append, no consistent hashing, no CPU).

**Before the change** (the skill as on `main`, both arms):

| Case | With | Without | Δ | Cost |
| --- | --- | --- | --- | --- |
| `outline-amortised-append` | 0.42 | 0.67 | −0.25 | $0.43 |
| `outline-consistent-hashing` | 0.22 | 0.33 | −0.11 | $0.43 |
| `review-branch-prediction-passage` | 0.67 | 0.50 | +0.17 | $0.41 |

- **The skill made the analogy worse.** "Give the analogy at the end as a summary" applied to every analogy; one
  with-skill outline put its analogy in section 4 "so it summarises rather than replaces" the argument. The baseline put
  it with the mechanism in 6 of 6 runs.
- **No arm promised a use in the opening or ordered the applications** (0 of 6 each): the with-skill outlines followed
  "save why this matters for the end" and listed the uses in one late section.
- **The baseline already catches one label on two mechanisms** (prefetching credited to the branch predictor, 6 of 6),
  so no rule was written for it.

**After the change.** Pass counts per grader over six with-skill runs (the both-arm run plus the `--ablation none` suite
run), against the old skill's six and the baseline's six:

| Grader | Old skill | New skill | No skill |
| --- | --- | --- | --- |
| analogy maps a quantity | 5 | 6 | 6 |
| analogy before the mechanism | 3 | 4 | 6 |
| analogy returns by name | 0 | 3 | 0 |
| analogy states its limit | 2 | 6 | 3 |
| opening promises a use | 0 | 3 | 0 |
| promised uses paid off | 5 | 6 | 6 |
| applications ordered by a principle | 0 | 6 | 0 |

Both-arm results after: `outline-amortised-append` with 0.92, without 0.58, Δ +0.33; `outline-consistent-hashing` with
0.78, without 0.33, Δ +0.44 ($0.90). On the final text (the refuted-belief check below removed), `--ablation none`:
`outline-amortised-append` 1.00 (every grader 3 of 3), `outline-consistent-hashing` 0.67 (ordering 3 of 3, opening 0 of 3)
($0.61). So "opening promises a use" passes in 3 of 9 new-skill runs: a weak effect. The rule permits a use in the
hook rather than requiring one, and the outlines opened instead on a concrete failure (a cache losing its hit rate when a
fifth server joins), which the skill also asks for.

**The rest of the suite** (`--ablation none`, the new skill against a `git archive` snapshot of `main`'s skill, the
same cases): mean over the nine earlier cases 0.93 new, 0.88 old. The largest moves are `plan-rank-select-series` 0.76
against 0.57 (+0.19) and `review-deflate-page` 1.00 against 0.89 (+0.11). Both are under the 0.2 noise rule, though
`review-deflate-page` is above its earlier with-skill range (0.80 to 0.90), and neither case exercises the changed rules,
so nothing is read from them beyond "no regression". $5.71 new, $5.18 old.

**The refuted-belief check measured nothing, and was removed.** A review-checklist line and a promise-ledger row asked
whether a belief the page refutes comes back true in another sense ("A modern CPU doesn't wait", then "waits about 15
cycles"). With the skill the grader passed 1 of 3 before, 0 of 3 after, and 0 of 3 again with `claude-sonnet-5-5` as the
judge, where the baseline passed 2 of 3. One with-skill answer did name the contradiction and was failed by the Haiku
judge, so the grader is also noisy. The check stays in `moves.md` as an unmeasured drafting move, and the case was
deleted under the rule that a case scoring the same in both arms measures nothing about the skill.

Total cost about $14.70.

**Follow-ups the same day.**

- **The opening rule made conditional.** "Concrete uses may lead" permitted a use in the hook; it now says "when the
  page covers where the idea is used, name one such use in the opening". `outline-consistent-hashing`, six runs,
  `--ablation none`: 0.88, opening 4 of 6 (from 3 of 9), ordering 6 of 6, uses paid off 5 of 6 ($0.61). The bar set
  before the run was two runs in three, so the rule stays. One passing outline restated the rule in its TL;DR plan ("Name
  one real use as a promise … for example a Dynamo-style store or a CDN") rather than choosing one, so part of the gain is
  the rule echoed, not applied.
- **"Analogy before the mechanism" was left alone.** It passed 4 of 6 with the new skill against 6 of 6 without. The
  failing outlines proved O(1) by summing the copies first and brought in the coin analogy a section later, describing it
  as "introduced with the mechanism, not after"; none echoed the old "goes last" wording, so rewording it would tune
  against a cause the transcripts do not show. The final text passed 3 of 3.
- **One real page.** A fresh agent with the new rules (no eval, no knowledge of the cases) reviewed
  `docs/token-bucket-rate-limiting.html`. It found the page already meets the analogy rule (the dripping tap arrives with
  the mechanism, returns in `#no-timer` and `#choosing-parameters`, and its limits are stated) and the promise rule (every
  number in `#the-need` is paid in `#mental-model` or `#choosing-parameters`), and said so rather than inventing problems.
  Its two fixes were checked against the page and hold: "leaky bucket" appears only as a table row and a reading-list link,
  never mapped, and the three gotchas are in dose order (one machine, ten with a bucket each, ten sharing one) under an
  intro that says only "go wrong in three ways".

**Review corrections, 2026-11-16.**

- **The "promised uses paid off" grader was deleted: it measured nothing.** Its rubric failed an outline whose
  opening named no use, yet it passed in the same runs where "opening promises a use" failed (old skill 5 of 6 against
  0 of 6; no skill 6 of 6 against 0 of 6). A rewrite that made the judge list the opening's uses first and fail an empty
  list still passed 3 of 3 baseline outlines whose openings name no system: the Haiku judge appears to count the running
  example's "cache cluster" as a use. "Opening promises a use" already asks for a use "the page will come back to", so
  nothing replaces it. Every `outline-consistent-hashing` score above includes that grader, which lifted both arms by
  about the same amount.
- **The case re-run on two graders** (both arms, three runs, $0.45, run with the rewritten grader still present and
  rescored without it): with the skill, opening 3 of 3 and ordering 3 of 3 (1.00); without, 0 of 3 and 0 of 3 (0.00);
  Δ +1.00. The opening rule is now 7 of 9 since it was made conditional.
- **The 0.88 in the first follow-up does not match its counts.** Opening 4, ordering 6 and uses paid off 5, each of 6,
  are 15 of 18, or 0.83. 0.88 is 21 of 24, which is what the three graders plus `skill-fired` (6 of 6) would give, while
  the 0.67 before it (6 of 9) leaves `skill-fired` out. The results directory was not kept, so which one the tool
  printed is not known; read the counts, not the 0.88.
- **The opening rule was tuned on its only case.** The rule's condition ("when the page covers where the idea is
  used") was written after the first wording failed 0 of 3 on `outline-consistent-hashing`, whose prompt says "where it
  gets used in practice". No prompt phrased another way has been run, so the 7 of 9 shows that the rule works on this
  prompt, not that it transfers.
- **"Analogy before the mechanism" is still below the baseline** (4 of 6 against 6 of 6 over the both-arm and suite
  runs, 3 of 3 on the final text): the gap from the old skill (3 of 6) is narrowed, not closed.

## 2026-11-14: `pedagogical-writing` no longer claims to scope a video (#170)

Claude Code 2.1.318, agent `claude-sonnet-5-5`, three runs per query. The description's "scoping a page, a series, or a
video" became "scoping a page or a series" (972 characters). Every concrete rule in the skill is for a web page (folds,
`details.predict`, sidenotes, `data-ref`), and none says how a script differs (no scroll-back, a spoken pause for a
prediction, no fold for an aside), so the claim was not served. 3Blue1Brown videos stay the skill's main source; only
the claim that it scopes a video goes.

| Run | Result | Cost |
| --- | --- | --- |
| Full trigger suite, 42 queries | 41 of 42 (train 29/29, held-out 12/13); the miss is #25, 0 of 3 | $8.50 |

The same result as the last full run (#150), with the same miss: #25 names an explainer the empty sandbox lacks. No
query mentions a video, so the suite shows only that the shorter description loses nothing.


## 2026-11-16: Haiku and a model's drafts: the description gets a sentence of its own for that case (#154)

Claude Code 2.1.318, three runs per query, judge `claude-haiku-5-5`. #154 asked why Haiku skipped `pedagogical-writing`
on `prompt-opus-explainers` (the 2026-11-13 entry): the description, or the reading list.

**It was the description.** Six trigger queries about a model that drafts teaching prose were added (#43 to #48, three
held out) before any edit. With Haiku as the agent, the old description fired on the queries that ask for a prompt and
missed the ones that describe bad drafts and ask what to change:

| Query (Haiku, old description) | Fired |
| --- | --- |
| #39 "write a system prompt for GPT-6.1 Sol so the tutorials it drafts…" | 3 of 3 |
| #47 held-out "which reasoning effort and which system prompt lines… draft a lesson" | 3 of 3 |
| #43 "I draft the explainers… with Claude Opus 5.5… every section takes forever to reach its point… what should I change?" | 1 of 3 |
| #44 "my tutorial drafts come from GPT-6 Astra… bullet fragments… what do I change in the system prompt?" | 1 of 3 |
| #46 held-out "Sonnet 5.5 writes the first drafts of my how-it-works posts… is that a prompt problem?" | 0 of 3 |

In the misses Haiku answered in one turn with a prompt block of its own and no `Skill` call. The old description named
the case as one item in a list ("…or a passage of one, or a prompt that makes GPT or Claude write one, or when asked
why…"). The change gives it a sentence: "Also use when GPT or Claude drafts one, for its prompt and to fix drafts that
are hard to follow." The description is now 1,022 of 1,024 characters, so the next addition has to remove something.

| Run | Before | After | Cost |
| --- | --- | --- | --- |
| Haiku, #43 and #44 (train) | 1 of 3 each | 3 of 3 each, in two runs | $0.38 for the two runs of #39 to #48 |
| Haiku, #46 (held-out) | 0 of 3 | 0 of 3, then 1 of 3 | |
| Haiku, the four quiet queries #40, #42, #45, #48 | 0 of 3 each | 0 of 3 each | |
| Haiku, `prompt-opus-explainers`: with-skill runs that loaded the skill | 4 of 9 (1 of 3 on 2026-11-13, 3 of 6 today) | 10 of 15 (1 of 3, 5 of 6, 4 of 6) | $0.44 |
| Haiku, `prompt-opus-explainers`: with / without | 0.60 / 0.80 (Δ −0.20) on 2026-11-13 | 0.80 / 0.73 (Δ +0.07, 3 runs); 0.90 / 0.70 (Δ +0.20, 6 runs) | |
| Sonnet, full trigger suite | 41 of 42 (#170) | 47 of 48 (train 32/32, held-out 15/16) | $12.76 |
| Haiku, full trigger suite | 28 of 42: should-fire 5/19, quiet 23/23 | 34 of 48: should-fire 9/23, quiet 25/25 | $0.90 |

- **The issue's bar is met on average, not in every sample.** It asked for the skill to load in at least 2 of 3 runs
  of `prompt-opus-explainers` on Haiku and for a Δ that is not negative. Loading went from 44% to 67% of runs and both
  Δ are positive, but one three-run sample still loaded it once. Every run that loaded the skill scored 0.80 or more,
  and the runs that scored 1.00 passed the effort grader, which only `drafting-with-models.md` can supply. So once the
  skill loads, Haiku does read the reference, and the reading-list line was left alone.
- **#46 did not move, and was not tuned against.** It is held-out, and it calls the pages "how-it-works posts", which
  the description's nouns (explainer, tutorial, lesson, technical blog page) do not cover. It fires 3 of 3 on Sonnet.
- **Sonnet does not regress.** The one miss is #25 again, 0 of 3, the query that names an explainer the empty sandbox
  lacks. All six new queries behave as labelled on Sonnet. The full Sonnet suite now costs about $13.
- **Haiku misses most of this skill's ordinary queries, and that is not new.** On the 42 queries both runs share,
  Haiku passes 28 with the old description and 29 with the new one, and fires on about a quarter of the should-fire
  queries either way (#4 to #7, #11 and #12 are 0 of 3 in both). This is the gap #86 found for `skill-authoring`, and
  it is far larger than the case #154 names. Nothing here addresses it: see #233.
- Not measured: Opus on the new queries.

## 2026-11-16: `pedagogical-diagrams` after its second source pass (#230)

Claude Code 2.1.318, agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`, three runs per arm and per query. The pass
read five texts the first one could not reach and narrowed rules 6, 9 and 10 to what they support (the detail is in
that skill's `references/sources.md`). The description did not change, so the trigger suite was run for a different
reason: #154 had just lengthened `pedagogical-writing`'s description, which could have taken diagram queries.

| Run | Result | Cost |
| --- | --- | --- |
| Trigger suite, 24 queries | 24 of 24 (train 15/15, held-out 9/9), as on 2026-11-10 | $4.37 |
| Output cases on `main`, the same day | mean 0.66 with the skill, 0.53 without (Δ +0.13) | $3.28 |
| Output cases, first commit of the pass | mean 0.74 with, 0.53 without (Δ +0.21) | $2.73 |
| Output cases, final text | mean 0.76 with, 0.53 without (Δ +0.22) | $3.22 |

| Case, with / without | `main` | First commit | Final text |
| --- | --- | --- | --- |
| `design-lz77-figure` | 0.61 / 0.11 | 0.72 / 0.22 | 0.61 / 0.28 |
| `fix-confusing-figure` | 0.56 / 0.67 | 0.61 / 0.56 | 0.67 / 0.61 |
| `review-deflate-figures` | 0.81 / 0.67 | 0.76 / 0.76 | 0.81 / 0.71 |
| `review-stepper-boundary` | 0.67 / 0.67 | 0.87 / 0.60 | 0.93 / 0.53 |

- **No regression, and no claim of a gain.** The changed skill scores at or above `main` on every case, but three
  runs move a case by a third, and the three with-skill means (0.66, 0.74, 0.76) are within that. No grader asks about
  the narrowed rules, so these cases could not show what the pass changed. They show it broke nothing.
- **Today's numbers are below the first measurement and equal to the scheduled one.** On 2026-11-10 the four cases
  averaged 0.89 with the skill; the scheduled run on 2026-11-12 gave 0.75, and `main` gives 0.66 today with no change
  to the skill in between. `design-lz77-figure` went from 0.94 to 0.61. That drift is not explained here, and no
  transcript was read for it. It is explained in the 2026-11-18 section (#237): the 0.89 was judged by Sonnet and
  the other two by Haiku.
- **The neighbour's longer description took nothing.** All ten should-stay-quiet queries stayed at 0 of 3 and all
  fourteen should-fire queries fired, including the boundary queries about step captions.

## 2026-11-16: `advisors` added, a skill that fires only on request (#117)

Claude Code 2.1.318, agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`, three runs per query and per arm. The skill
is a port of the consulting layer of the shoulder-advisors repo: it puts a question to a subagent that answers in one
writer's voice from his posts in the private data, and has a second subagent check the citations. Its description says
to use it only when the user asks for the advisor by name.

| Run | Result | Cost |
| --- | --- | --- |
| Trigger suite, 15 queries, first run | 14 of 15 (train 8/9, held-out 6/6): should-fire 6/7, should-stay-quiet 8/8 | $1.95 |
| Trigger suite after the queries changed (see below) | 15 of 15 (train 9/9, held-out 6/6) | $1.97 |
| `missing-data`, three graders, with / without the skill | 0.89 / 0.00, then 0.67 / 0.00 with a new prompt; fired 3 of 3 both times | $0.44 |

- **The queries changed twice; the description did not.** First, query #1 (next point). Second, a review found that
  the should-fire queries all asked about one kind of topic, which hinted at what the writer covers, and that the
  description quoted the opening of held-out query #10. Four should-fire queries got unrelated topics (a car, a
  promotion, a rent rise, moving home), #10 was reworded, and the `missing-data` prompt got the rent question. The
  trigger is the request by name, not the topic, and the second run agrees.

- **A typed slash command is not a trigger query.** Query #1 began with `/advisors` and scored 0 of 3. The trace shows
  why: the first tool call is the `Read` of the profile that the skill's step 1 asks for, with no `Skill` call before
  it. The harness had expanded the command into the skill's text, so the `tool_used: Skill` grader had nothing to see.
  The query was replaced by a plain request ("can I get the shoulder advisor's view on this?"), which is a change to the
  query, not a result for the description. The description was not edited after the first run.
- **The quiet queries are the point of this suite.** Three of them are the kind of prompt the Python original fired on
  ("how should I think about it?", "is it reasonable to be annoyed that …"), one of which repeats a should-fire
  query with the request for the advisor removed. All eight stayed quiet, 0 of 3 each, with `pedagogical-writing` loaded beside it.
- **`missing-data` measures a real gap.** With no private data in the sandbox, the baseline answered in the writer's
  voice from recall in 3 of 3 runs, which is what the skill exists to prevent. With the skill it stopped and named
  `npm run advisor -- link` in 6 of 6, and never gave his view. A third grader, "says the data is missing", failed
  1 of 3 runs and then 3 of 3. A transcript shows why: the sandbox denied the `Read` of the missing profile ("don't-ask
  mode"), so the answer blamed the permission and offered the `link` command as the other possibility. That grader
  measured the sandbox's permissions, so it was deleted; the case keeps the two that measure the skill.
- **A consultation cannot be an eval case.** A case that scaffolded the two agent files and the private data into the
  sandbox scored 0.00 in both arms: the sandbox loads no agent files from the project, so the advisor's agent type is
  not found (`Available agents: claude, Explore, general-purpose, Plan, statusline-setup`). The skill behaved
  correctly there (it said the agent was not registered and wrote nothing in his voice), but the case measured the
  sandbox, so it was deleted. The check was made by hand instead: one consultation in a fresh `claude -p` session in a
  linked checkout ($0.70). The advisor read the profile, the index and five posts; the response had the
  `Duncan says` / `Anchored in` / `Confidence` shape; all five cited titles and URLs are in the private index; the
  mediator flagged six moves. So the skill ships with one output case, not three, and the reason is recorded here.
- **Reading the posts against that consultation changed both agents.** The mediator's two main flags were right: the
  advisor had applied a rule written for the speaker to the listener, and had recommended a test that the cited post
  lists as a warning sign. Both were the advisor's own steps, stated in his voice. The mediator was wrong once, calling
  a move unsupported that an uncited passage of a cited post supports. So the advisor now checks who a passage is
  addressed to and what the post warns against, and marks extrapolation in the sentence where it happens; the mediator
  checks for a passage applied to the wrong party, and searches the cited posts before calling a move unsupported.
- **The same prompt after that change** ($0.62, one run, so an indication and not a rate). The reversed rule and the
  test were gone, the same rule was applied to both parties, and the advisor's own steps were marked in the text and
  listed under the anchors. The mediator found one new wrong-party slip with its new check and one figure glossed as
  sourced that was the advisor's guess; both were checked against the posts and are right. The advisor still errs, and
  the mediator still has to run.
- Not measured: the trigger suite on Haiku or Opus, and how often a consultation's citations support the claims they
  anchor. One prompt was read against the posts, twice.

## 2026-11-16: `pedagogical-writing` tells Haiku to load it before answering (#233)

Claude Code 2.1.318, three runs per query. #154's full Haiku run had shown the skill loading on 9 of its 23
should-fire queries. The change is the one #86 found for `skill-authoring`: an instruction in the description to load
the skill before answering. The description had 2 characters to spare, so the "Covers …" topic list went to make room
(the #86 record says a longer topic list did not help triggering). It is now 950 characters.

| Description | Haiku: passed | Haiku: should-fire | Haiku: quiet | Sonnet | Sonnet, `pedagogical-diagrams` suite |
| --- | --- | --- | --- | --- | --- |
| On `main` (after #154) | 34 of 48 | 9 of 23 | 25 of 25 | 47 of 48 | 24 of 24 |
| A: "…Load it before answering or reading any file. The rules are in the skill, so answering from memory misses them." | 44, then 42 | 19, then 17 | 25 of 25, both | 48 of 48 | **23 of 24** |
| **B (kept): "…Load it before answering. The rules are in the skill, so answering from memory misses them."** | 39, then 39 | 14, then 14 | 25 of 25, both | 47 of 48 | 24 of 24 |

Held-out on Haiku: 12 of 16 on `main`, 16 and 15 with A, 14 and 14 with B. Cost: about $3 for the Haiku runs and
$34 for the four Sonnet suites.

- **A is better for Haiku and was not kept, because it changed a neighbour.** With A, Sonnet loaded
  `pedagogical-diagrams` on that skill's own held-out quiet query #23 ("convert the mermaid flowchart in the rate
  limiting ADR into inline SVG…") in 5 of 6 runs; on `main` and with B it is 0 of 3. The trace shows Sonnet searching
  for the ADR, not finding it, and loading the diagram skill before searching again. Why an instruction in one
  skill's description makes Sonnet load a different skill was not established: it is one query, and the reading that
  "or reading any file" makes a file hunt the cue to load something is a guess. `skill-authoring`'s description
  carries the same phrase, and has since #86.
- **B meets #233's bar.** At least half of the should-fire queries pass on Haiku (14 of 23), every quiet query stays
  quiet, and Sonnet does not regress: its one miss is #25 again. A took Sonnet to 48 of 48, #25 included.
- **`prompt-opus-explainers` on Haiku now loads the skill every time**: 6 of 6 with A and 6 of 6 with B (10 of 15
  after #154), at 0.90 / 0.67 and 0.87 / 0.73 with and without the skill.
- **What still misses on Haiku with B**: #4, #6, #11, #12 and #35 at 0 of 3 in both runs, and #5, #10, #25 and #38 in
  one or both. In the kept traces of the A run, most misses are Haiku searching the empty sandbox for the page the
  query names until the turn cap, with no `Skill` call; #6 and #35 name no missing file and are answered in one turn.
  So part of what remains measures the sandbox.
- **The neighbours on Haiku did not move.** `pedagogical-diagrams` passes 17 of 24 on `main` and 18 with A;
  `skill-authoring` 28 of 34 on `main` and 25 with A, where the three extra misses passed 2 of 3 each on a re-run and
  made no `Skill` call when they missed; `advisors` 15 of 15 with A. These were run with A, not B.
- **`skill-authoring` on Haiku is below its #86 record with nothing changed**: 13 of 19 should-fire on `main` today
  against 15 to 17 then.

## 2026-11-17: `pedagogical-writing` grades pages, and the grader's calibration (#242)

Claude Code 2.1.318. The grader is `pedagogical-writing/scripts/grade.mjs`: one fresh `claude -p` judge per
criterion of `references/grading.md`, judge `claude-sonnet-5-5`, read-only tools, the page as a prose extract, each
verdict checked (a real section, a quote found word for word in it, a gap for a miss). The calibration is
`scripts/calibrate.mjs` over `evals/calibration/*.json`: five published versions of four pages (token bucket now
and at `974536b`, its first version; voice notes; how a DEFLATE block sends its code; how DEFLATE works at
`ca066f8`, its first version) and a broken copy of the token bucket page, 11 criteria each.

**The reference grades are not a person's.** Claude Opus 5.5 wrote them from the rubric before any judge ran. Three
were changed after a judge run, each recorded in its fixture's `revised` field: `one-idea` on voice notes and on the
DEFLATE page (both met → not met: one section teaches two mechanisms, and "Runs, and a code for the runs" fails the
skill's own title test), and `figures-earn` on the token bucket (met → not met: the coin machine is introduced by
its parts, with no one thing to do and see). Every change went the same way, towards the judge and away from a
lenient reading of a Claude-drafted page, which is what the self-preference result predicts of a Claude reference
grader. Agreement here measures consistency with a careful reading, not with human judgment, until the author
confirms or corrects the references.

| Run | Rubric and references | Agreement | On the references' misses | Same verdict, 3 runs | Broken copy fails exactly its criteria | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (1 run) | first draft | 60/66 (91%) | 9/11 | — | 0/1 | $6.81 |
| 2 | broken copy made crisper; `need-before-name` and `figures-earn` reworded; two references revised | 189/198 (95%) | 37/39 | 62/66 (94%) | 1/3 | $9.06 |
| 3 | `one-idea` exempts edge-case lists; `need-before-name` checks every fix; the third reference revised; the broken-copy test compares with the reference, so a miss the page already had counts neither way | 186/198 (94%) | 39/45 (87%) | 63/66 (95%) | 3/3 | $9.58 |
| 4 | the same rubric and references; the grader fixed after code review, chiefly so judges run in a scratch directory holding only the page | 180/198 (91%) | 34/45 (76%) | 62/66 (94%) | 3/3 | $5.80 |
| **5 (kept)** | the same rubric and references; after the post-merge review of #243, judges see every page as `page.html` | **188/198 (95%)** | **39/45 (87%)** | **61/66 (92%)** | **3/3** | $5.68 |

**Why run 4, not run 3, is the result.** Runs 1 to 3 started each judge in the repo with read and search tools, so
a judge could have opened `evals/calibration/`, which holds the reference verdicts. Nothing shows that one did
(the traces were not kept), but the numbers cannot rule it out. Run 4 runs each judge in a scratch directory with
only a copy of the page. It is also cheaper because the judges no longer load the repo's `CLAUDE.md`. Its misses
column fell from 87% to 76%: on how DEFLATE works at `ca066f8`, `companion-voice` went from 3/3 not met to 3/3 met,
and `one-idea` stayed at 0/3. Either the earlier judges were reading the references, or `CLAUDE.md`'s house style
made them stricter; these runs cannot tell the two apart. The extract fix in the same change altered one code line
on the token bucket pages and no prose on any calibration page.

**Why run 5 replaces run 4.** In runs 1 to 4 the calibration wrote each page under its reference's name, and the
prompt and the scratch copy carried that name, so judges were told they were reading
`token-bucket-rate-limiting-broken.html`, or a page at `@974536b` or `@ca066f8`. Run 5 names every copy
`page.html`. The broken copy still fails exactly its broken criteria on 3 of 3 runs, so that result did not rest on
the name. Two verdicts moved the way a name that primes a judge would predict: `figures-earn` on the broken copy
went from 2/3 not met to 3/3 met (the figure is the same as on the unbroken page, where it is 2/3 not met), and it is
now the only criterion the broken copy's judges and reference part on. Against that, `companion-voice` on how
DEFLATE works at `ca066f8` went back from 3/3 met to 2/3 not met, and the misses column as a whole rose from 76% to
87%, the opposite of what losing a hint should do. One run of each cannot separate the name from run-to-run noise
on borderline criteria: the same five criteria named below are the ones that moved. Read run 4's fall to 76% the
same way, as within that noise, not as evidence about `CLAUDE.md` or the references. The other fixes in that
change (reply decoding, timeouts, custom judge paths) do not alter what a judge sees.

Targets (#242): agreement ≥ 80%, same verdict on ≥ 90% of criteria over three runs, the broken copy fails exactly
the broken criteria. All three hold on run 5, the stability target narrowly (61/66; 59 would miss it). The split verdicts in run 5: `need-before-name` on the token bucket and on how a DEFLATE block sends its code
(each 2/3 not met against a reference of met), `figures-earn` on the token bucket (2/3 not met), and `one-idea`
and `companion-voice` on how DEFLATE works at `ca066f8` (each 2/3 not met). All three held on run 4 too.

Scored against the references as first written, run 4 agrees
on 177/198 (89%) and on 27/33 misses, and the broken copy fails exactly on 1/3 runs, the others on the coin
machine (below). A judge that always says met would agree on 51/66 (77%) of the final references and 55/66 (83%)
of the first ones, so the 80% target alone proves little here; the misses column is the one to read. It was 76% in run 4 and
87% in run 5 with nothing changed that should move it, so read it as "between three quarters and nine tenths",
not as either figure.

- **The broken copy works only once each edit breaks one thing.** In run 1, cutting the need from `#no-timer`
  also cut the page's one voiced objection ("But who turns the tap?"), so `companion-voice` failed too, rightly;
  and removing `#gotchas` left a promise the Redis tab could be said to pay. The kept copy keeps the question,
  cuts only the cost of a million timers, and adds a deferral to "a later section" that was removed.
- **Where judges and references still part, and why.** Token bucket `need-before-name`: 3/3 not met in run 3
  and 2/3 in run 4, because "list every fix, small ones included" (added after run 2 to catch lazy refill) also
  catches the one-line cost-weighting note in `#choosing-parameters`; how a DEFLATE block sends its code fails it
  3/3 in run 4 the same way. The DEFLATE page at `ca066f8`, `one-idea`: 2/3 not met in run 2, 0/3 in runs 3 and
  4, after the edge-case exemption. Token bucket `figures-earn` on the coin machine: 3/3 not met in run 2, 3/3 met
  in runs 3 and 4, and 3/3 then 2/3 not met on the broken copy, though the figure is the same.
  So "same verdict every run" (95%) measures repeat runs of one prompt; a small change to the rubric or to an
  unrelated part of the page can still flip a borderline criterion. These are the criteria to reword next,
  against references a person has checked.
- **Validation earns its place.** In run 2 one judge cited "Anything over the cap spills." under `#mental-model`;
  it is in `#how-it-works`, so the verdict was voided to unknown rather than counted.
- **Cost:** about $0.03 a judge call in run 4 ($5.80 for 198 calls), so about $0.30 per page for 11 criteria and
  one run; $0.05 a call in run 3 and $0.10 in run 1, when the judges also loaded the repo's context (Sonnet, prose
  extracts of 15–42 KB).

**Claude Code and pi on one page.** The Claude Code scorecard for `docs/token-bucket-rate-limiting.html` is run 4's
(`--runs 3`, reader "a backend engineer who has never built a rate limiter", rubric `b32d9785e9`, $0.85): 10 of 10
judged met, 1 unknown, which is `need-before-name`, where the runs split 1 met and 2 not met on the cost-weighting
note, as above. In pi 0.84.4 the same command with
`--judge pi:zai/glm-5.3` and with `--judge pi:anthropic/claude-sonnet-5` gave 0 of 0 judged: every criterion unknown,
"judge failed (exit 1): 429 … Insufficient balance" and "401 … invalid x-api-key". The grader handled it as
designed (no verdict from a failed judge), but no pi model could run on this machine that day. pi's discovery was
checked separately: it loads all five skills and no `evals/` directory ([sources](sources.md)).

**The pi scorecard, later the same day.** With a working provider (below),
`--judge pi:anthropic-ant/claude-sonnet-5-5 --runs 3` on the same page and reader gave 10 of 10 judged met, 1
unknown, US$0.33 for 33 calls: the same scorecard as Claude Code's. The unknown is again `need-before-name` (2 met,
1 not met); `figures-earn` was met on 3 of 3 runs against a reference of not met, so it agrees with the reference
on 9 of 11. A single run before it gave 11 of 11 met. The judge is still Sonnet, so this shows the pi path works end
to end; it is not the judge from another model family that the rubric asks for against self-preference.

- **Cost per call was about $0.01 in pi and $0.03 in `claude -p`**, for the same model and prompt. Not
  investigated; the system prompts and tool definitions each harness adds are the likely difference.
- **The grader now reads pi's cost.** It runs pi with `--mode json` and sums `usage.cost.total` over the
  assistant messages. Before this, a pi scorecard printed no cost at all. pi computes the figure from the prices in
  the model's entry, so a custom model without a `cost` reads as $0.
- **The provider.** pi's built-in `anthropic` provider could not be used here: its stored key was rejected (401),
  and an `auth.json` entry outranks the environment. The run used a custom provider in `~/.pi/agent/models.json`
  that sends the `ant` CLI's login as a bearer token, as `ant` itself does. Each model entry copies `name`,
  `cost`, `thinkingLevelMap` and `compat` from pi's own catalogue entry for the same id (in
  `~/.pi/agent/models-store.json`); without `forceAdaptiveThinking` the API refuses the request.

  ```json
  { "providers": { "anthropic-ant": {
      "baseUrl": "https://api.anthropic.com",
      "api": "anthropic-messages",
      "apiKey": "ant-login",
      "headers": {
        "Authorization": "!printf 'Bearer %s' \"$(ant auth print-credentials --access-token)\"",
        "anthropic-beta": "oauth-2025-04-20"
      },
      "models": [ { "id": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5", "reasoning": true,
        "cost": { "input": 2, "output": 10, "cacheRead": 0.1, "cacheWrite": 2.5 },
        "contextWindow": 1000000, "maxTokens": 128000, "compat": { "forceAdaptiveThinking": true } } ]
  } } }
  ```

  `apiKey` is a placeholder pi needs before it lists the models. Do not put the token there: pi takes a key
  beginning `sk-ant-oat` for a Claude subscription login and sends different headers, which this account answers
  with "credit balance is too low".
- **`pi -p` waits on an open stdin.** Called from a script with stdin left open, it hung until killed. The grader
  closes the judge's stdin, so it is not affected.

**Trigger evals** (Sonnet, three runs; the description gained "grading" and "grade or score this page"): 57 of 58
pass. The ten new queries all behave as labelled, 3/3 each: "grade … give me the scorecard", "score this explainer",
"which of these posts needs work first" and three more fire; "grade this ADR", "score this chart", "grade my PR's
test coverage" and an accessibility score stay quiet (4 of the 10 held out). The one miss is #25 again. The first
run stopped at its $10.81 cost ceiling after 46 queries; the last 12 were re-run with `--only` ($3.42).

**Output evals** (the rubric path, no `Bash`: agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`, three runs per arm,
$3.40):

| Case | With | Without | Δ |
| --- | --- | --- | --- |
| `grade-token-bucket-page` (the page as published) | 1.00 | 0.17 | +0.83 |
| `grade-broken-page` (the calibration's broken copy) | 1.00 | 0.33 | +0.67 |

Without the skill, Sonnet grades with criteria of its own, gives no count of criteria met, and cites little by
section. On the broken copy it finds the unpaid deferral in all three runs but never the lazy-refill step that lost
its need. With the skill, every run gives a per-criterion scorecard with quotes and `#id`s, says it was graded by
hand in one context and so is the weakest form of the grade, and fails both broken criteria with a gap. One
with-skill run of the broken copy reported 8 of 11 met: the two broken criteria and one more.

## 2026-11-18: why the `pedagogical-diagrams` output scores fell with no change, and the judge (#237)

Claude Code 2.1.318, agent `claude-sonnet-5-5`, three runs per case, with the skill only (`--ablation none`) unless a row
says both arms. Every score here leaves the `skill-fired` grader out, as a two-arm run does, so the figures compare
with the earlier sections. All of it cost about US$24: $16.50 of suite runs and $7.75 of re-judging.

**The cause.** The four cases averaged 0.89 on 2026-11-10, 0.75 on 2026-11-12 and 0.66 on 2026-11-16 with no change
to the skill. Two things made that look like a decline, and neither is the skill or its answers:

1. **The 0.89 was judged by Sonnet and the other two by Haiku.** The 2026-11-10 section says so of its own table;
   #237 and the 2026-11-16 section read all three as Haiku-judged. On the same answers Sonnet scores 0.03 to 0.07
   higher than Haiku (table below), and today's answers judged by Sonnet score 0.88, where 2026-11-10 had 0.89.
2. **The Haiku judge built into `claude plugin eval` gives different verdicts on equal answers.** Two runs it
   scored 0.77 and 0.89 were 0.90 and 0.92 when their answers were judged again by one judge. Seven Haiku-judged runs
   of the suite today ranged from 0.74 to 0.89; the 0.66 of 2026-11-16 was not reproduced, on the skill as it was
   then (0.81 and 0.74) or as it is now.

**The same answers, two judges.** `claude plugin eval` cannot judge old answers again, but `--json` keeps each
answer, so `scripts/rejudge.mjs` (new) sends them to a judge with a prompt of its own, three votes each. The first
two runs gave 24 answers and 132 answer and grader pairs, with the rubrics as they were on `main`:

| Judge of the same 24 answers | Pairs passed | Mean, run 1 | Mean, run 2 | Same verdict as the built-in Haiku judge |
| --- | --- | --- | --- | --- |
| Haiku, built into `claude plugin eval` | 105 of 132 | 0.82 | 0.81 | the reference |
| Haiku, through `rejudge.mjs` | 111 of 132 | 0.86 | 0.85 | 118 of 132 (89%) |
| Sonnet, through `rejudge.mjs` | 115 of 132 | 0.89 | 0.87 | 110 of 132 (83%) |

- **The script's judge is not the built-in one, and the control shows how far apart they are.** The same model
  with the script's prompt disagrees with the built-in judge on 11% of pairs. The two script judges agree with each
  other on 118 of 132. So the difference between Haiku and Sonnet (4 pairs, 0.03) is smaller than the difference
  between the two Haiku judges (6 pairs, 0.04): on these answers the model matters less than the built-in judge's
  own behaviour.
- **The built-in Haiku judge fails answers that plainly pass.** One `fix-confusing-figure` answer says to redraw
  the figure as "two frames in one fixed layout" and to "say what you left out in the caption". The built-in judge
  failed it three votes to none on grader 05 (hit and miss side by side) and on 06 (says what is no longer shown);
  both script judges passed both, three votes to none, quoting those lines. Its reasons cannot be read: the result
  records the votes and no text. It split its three votes on 20 of the 132 verdicts.
- **Three rubrics were read literally.** `design-lz77-figure` 03 asked for the point "as a single sentence":
  Haiku failed five of six answers that stated the point first, in two or three sentences, and said so. The same
  rubric ended "and everything it then includes serves that sentence", which failed answers for a closing note
  about `npm run check`. `review-deflate-figures` 05 ("each finding gives a concrete change") and
  `review-stepper-boundary` 02 (three conditions in one sentence) split the judges the same way.

**The second cause in #237 was not reproduced.** `design-lz77-figure` 05 (names a misreading and what prevents it)
passed 1 of 3 on 2026-11-16. Today it passed 14 of 15 with the built-in Haiku judge on the skill as it is, 6 of 6
with the Sonnet judge, and 4 of 6 on the skill as it was before #236. The checklist step proposed in the issue was
therefore not added: a rule for something the answers already do does not belong in the skill.

**What changed.**

- **Six graders rewritten as conditions a literal reader applies the way they were meant**:
  `design-lz77-figure` 03, `fix-confusing-figure` 04 and 06, `review-deflate-figures` 02 and 05,
  `review-stepper-boundary` 02. Each was tried on the 24 saved answers with `rejudge.mjs --rubrics` before any new
  run. With the new text the two script judges gave the same totals on five of them (6, 6, 5, 6 and 4 of 6) and
  differed by one answer on `review-deflate-figures` 05.
- **The repo's judge is now Sonnet** (`DEFAULT_JUDGE_MODEL` in `scripts/skill-evals.mts`, and the commands in
  `evals.md`). The rewritten rubrics alone did not steady the Haiku judge:

| Two runs of the unchanged suite, rewritten graders | Run 1 | Run 2 | Difference | Split votes | Judge cost per run |
| --- | --- | --- | --- | --- | --- |
| Haiku judge | 0.77 | 0.89 | 0.12 | 13 and 8 of 66 | $0.12 |
| The same two runs' answers, judged again by Haiku through `rejudge.mjs` | 0.90 | 0.92 | 0.02 | 4 of 132 | $0.34 for both |
| Sonnet judge | 0.94 | 0.91 | 0.03 | 4 and 4 of 66 | $1.75 |

  With the graders as they were, two Haiku-judged runs were 0.82 and 0.81, so the Haiku pair above is not worse
  because of the rewrite: the first run of that pair is the low draw this judge produces now and then, as on
  2026-11-16. Per case the Sonnet runs were 0.94 and 0.89, 0.94 and 0.94, 1.00 and 0.95, 0.87 and 0.87.
- **A baseline is kept**: `pedagogical-diagrams/evals/baselines/2026-11-18.json` is the first Sonnet-judged run
  (12 answers with their verdicts and votes, mean 0.94). The next unexplained move can be checked answer by answer
  with `rejudge.mjs`, which reads it.

**Both arms**, rewritten graders, Haiku judge (run before the judge was changed), $2.71:

| Case | With | Without | Δ |
| --- | --- | --- | --- |
| `design-lz77-figure` | 0.89 | 0.11 | +0.78 |
| `fix-confusing-figure` | 0.67 | 0.78 | −0.11 |
| `review-deflate-figures` | 0.95 | 0.76 | +0.19 |
| `review-stepper-boundary` | 0.93 | 0.73 | +0.20 |

Mean 0.86 with the skill, 0.60 without, Δ +0.26. The negative row is the judge again: Sonnet through `rejudge.mjs`
passed 18 of 18 with-skill verdicts of `fix-confusing-figure` where the built-in Haiku judge passed 12, and 16 of 18
without the skill where it passed 14, which is +0.11.

**What this does not show.**

- **No two-arm run with the Sonnet judge was made**, so the Δ under the judge now in use is not measured. The
  `fix-confusing-figure` gap is small under either judge (+0.11 by the re-judge): the no-skill answer already cuts
  boxes, separates the arrow meanings and drops the legend. That case needs harder graders or should go.
- **The rewritten graders were fitted to answers that had been read**, as the 2026-11-10 graders were. Three of
  them (`design-lz77-figure` 03, `fix-confusing-figure` 04, `review-deflate-figures` 02) now pass nearly every
  with-skill answer, and `fix-confusing-figure` 04 passes 2 of 3 without the skill, so it separates the arms less
  than its old text was meant to.
- **Two Sonnet-judged runs are one pair.** 0.03 apart meets #237's bar of under 0.1; it does not show how often a
  pair would. A mean over 66 verdicts has a standard error near 0.04 even with a perfect judge.
- **Only this suite was measured.** The other skills' output suites have Haiku-judged records. Their next run is
  judged by Sonnet and will read higher for that reason alone: it starts a new series.
- **The other output suites' cost with the Sonnet judge is an estimate.** `pedagogical-writing` (13 cases, 61 `llm`
  graders) should cost $17 to $18, so the step ceiling went from $15 to $30 and the run's from $75 to $100.
- **`review-stepper-boundary` 02 no longer asks that the markings stay the same on every frame**, and
  `design-lz77-figure` 03 no longer asks that everything in the figure serves the point. No grader took those
  conditions over: each would need its own grader and a measurement. The wording of the first was touched once more
  after the runs here (a sentence that wrongly said another grader covers it).
- **Why the built-in Haiku judge behaves as it does is unknown.** Its prompt is not published and it records no
  reasoning. A per-grader judge model is not available either: `model:` in a grader's frontmatter is rejected.
- **A day effect cannot be excluded for 2026-11-16.** Every run here was made within one hour.

## 2026-11-18: every output suite with the Sonnet judge, both arms, and what it costs (#248)

Claude Code 2.1.318, agent and judge `claude-sonnet-5-5`, three runs per case per arm, `-j 4`, through
`npm run skill-evals -- --kind output` on commit `01c596a`. No skill, case or grader changed: this is the first
record of the series judged by Sonnet, and the measurement of what that judge costs. No run errored, no result was
partial, and the skill loaded in every with-skill run (69 of 69 here, 12 of 12 in the second run below).

| Suite | Cases | `llm` graders | With | Without | Δ | Cost | Of which the judge | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `advisors` | 1 | 1 | 1.00 | 0.33 | +0.67 | $0.26 | $0.06 | 21 s |
| `pedagogical-diagrams` | 4 | 22 | 0.93 | 0.63 | +0.29 | $5.48 | $3.29 | 4 min 39 s |
| `pedagogical-writing` | 13 | 61 | 0.85 | 0.45 | +0.40 | $21.76 | $10.64 | 13 min 30 s |
| `skill-authoring` | 5 | 9 | 0.93 | 0.53 | +0.41 | $3.04 | $1.12 | 2 min 30 s |
| All four | 23 | 93 | | | | $30.54 | $15.11 | 21 min |

`anatomy` has no output cases. **None of these scores compares with an earlier section's**: those were judged by
Haiku, which scores the same answers 0.03 to 0.07 lower.

**Per case.**

| `pedagogical-writing` | With | Without | Δ |
| --- | --- | --- | --- |
| `design-rank-interactive` | 0.95 | 0.76 | +0.19 |
| `grade-broken-page` | 0.75 | 0.25 | +0.50 |
| `grade-token-bucket-page` | 1.00 | 0.33 | +0.67 |
| `outline-amortised-append` | 0.92 | 0.67 | +0.25 |
| `outline-bloom-filters` | 0.71 | 0.13 | +0.58 |
| `outline-consistent-hashing` | 0.50 | 0.00 | +0.50 |
| `plan-rank-select-series` | 0.44 | 0.11 | +0.33 |
| `prompt-astra-unhinted` | 0.94 | 0.33 | +0.61 |
| `prompt-opus-explainers` | 0.80 | 0.87 | −0.07 |
| `prompt-sol-explainers` | 1.00 | 0.50 | +0.50 |
| `prompt-sonnet-setup` | 1.00 | 0.47 | +0.53 |
| `review-deflate-page` | 1.00 | 0.87 | +0.13 |
| `rewrite-token-bucket` | 1.00 | 0.53 | +0.47 |

| `skill-authoring` | With | Without | Δ |
| --- | --- | --- | --- |
| `add-evals` | 1.00 | 0.14 | +0.86 |
| `fix-not-firing` | 0.93 | 0.73 | +0.20 |
| `merge-overlapping-skills` | 1.00 | 0.33 | +0.67 |
| `needs-a-script` | 0.73 | 0.80 | −0.07 |
| `review-flawed-skill` | 1.00 | 0.63 | +0.38 |

`advisors` has one case, `missing-data`: 1.00 with the skill, 0.33 without.

**`pedagogical-diagrams`, run twice.** The second run is the same command with `--skills pedagogical-diagrams`
(US$5.41, 4 min 26 s):

| Case | With, run 1 | With, run 2 | Without, run 1 | Without, run 2 | Δ, run 1 | Δ, run 2 |
| --- | --- | --- | --- | --- | --- | --- |
| `design-lz77-figure` | 0.89 | 0.94 | 0.11 | 0.17 | +0.78 | +0.78 |
| `fix-confusing-figure` | 0.89 | 0.89 | 0.83 | 0.78 | +0.06 | +0.11 |
| `review-deflate-figures` | 1.00 | 1.00 | 0.86 | 0.86 | +0.14 | +0.14 |
| `review-stepper-boundary` | 0.93 | 0.93 | 0.73 | 0.93 | +0.20 | 0.00 |
| Mean | 0.93 | 0.94 | 0.63 | 0.68 | +0.29 | +0.26 |

- **Four Sonnet-judged runs of this suite now have with-skill means of 0.94, 0.91, 0.93 and 0.94**: the two from
  #237 and these two. The largest difference between any two is 0.03, against a tolerance of 0.10, and between
  these two runs no case moved by more than 0.06 with the skill.
- **The no-skill arm moves more.** Its mean differed by 0.05 and one case by 0.20 (`review-stepper-boundary`, 0.73
  and 0.93), so that case's Δ went from +0.20 to 0.00 between two runs of the same thing. A run fails on the
  with-skill mean, not on Δ, so this does not fail a run; it does mean one case's Δ is not evidence by itself.
- **The Sonnet judge split its three votes on 0 and 1 of 66 with-skill verdicts**, and on 3 and 2 of 66 without the
  skill (4 and 4 of 66 in #237). Across the other suites it split on 5 of 183 and 6 of 183 (`pedagogical-writing`,
  with and without) and on 5 of 27 and 3 of 27 (`skill-authoring`).
- **Δ under the Sonnet judge is +0.29 and +0.26**, where the Haiku-judged two-arm run in #237 had +0.26 (0.86 and
  0.60). Both arms read higher, and the difference between them did not change.

**Cost.**

- **The four output suites cost US$30.54, and the second `pedagogical-diagrams` run $5.41: $35.95 for this section.**
  The estimate was $17 to $18 for `pedagogical-writing`, which cost $21.76, and about $6 for a four-case suite,
  which holds for `pedagogical-diagrams` ($5.48 and $5.41) and not for `skill-authoring` (five cases, $3.04).
- **The number of `llm` graders sets the cost, not the number of cases.** A judged verdict (three votes) cost
  $0.021 to $0.029 in the three larger suites, and the judge was 60% of the bill for `pedagogical-diagrams`, 49%
  for `pedagogical-writing` and 37% for `skill-authoring`, which has 9 `llm` graders among its 30 scored ones.
  `pedagogical-writing` has 61 of the 93.
- **The ceilings hold.** The output step's $30 leaves $8 above the largest suite, and the run's $100 leaves about
  $27 above a full run: the 157 trigger queries the five skills have now cost about $42 at the $0.27 a query
  measured on 2026-11-12 (not measured again here), so a full run is about US$73. Neither ceiling was changed.
- **`--max-cost-usd 40` was enough for the output suites alone**, with $9.46 unspent. A step gets the lesser of its
  cap and what is left of the run's ceiling, so the last suite, `skill-authoring`, ran under $12.50, four times what
  it cost. The order of the suites does not matter at $40: the other three cost $8.78 together, so
  `pedagogical-writing` would have had its full $30 in any position.

**Baselines kept**, each trimmed from the run above with `rejudge.mjs --trim --commit 01c596a`:
`advisors/evals/baselines/2026-11-18.json` (6 answers), `pedagogical-writing/evals/baselines/2026-11-18.json` (78),
`skill-authoring/evals/baselines/2026-11-18.json` (30) and
`pedagogical-diagrams/evals/baselines/2026-11-18-two-arm.json` (24, run 1; the `2026-11-18.json` beside it is #237's
with-skill run). Every case's fixture is public: pages in `docs/`, the calibration references, a flawed skill the
fixture generates, and no fixture at all for `advisors`. `--trim` failed on a skill with no `evals/baselines/`
directory; it now creates it.

**What the per-case rows say**, read from the grader counts. The only answers read for this section are the six of
`prompt-opus-explainers`:

- **Two cases score higher without the skill, each through graders the no-skill answer passes more often.**
  `needs-a-script`: `lowest-rung` and `run-not-read` passed 1 of 3 with the skill and 3 of 3 without, while
  `reuses-existing-lint` passed 3 of 3 and 0 of 3. `prompt-opus-explainers`: four graders pass 3 of 3 in both arms
  and `05-effort` passes 0 of 3 with the skill, 1 of 3 without. Each is −0.07, inside the noise of one case.
- **`prompt-opus-explainers` loses on the grader, not on the answers.** `05-effort` is a regex that wants `effort`
  and `high`, `xhigh` or `max` within 60 characters with no full stop between them. All three with-skill answers
  say to raise the effort to `high` or above, each with a full stop in between ("Raise effort. The default is
  `medium`. Reviewers saw less padding at `high` or above."), so all three fail. The one no-skill answer that
  passes says "try `high`" in the same sentence as `effort`; the other two do not tell the reader to raise it (one
  says to try `high` only if the reasoning is thin, not for padding). Counted by what the answers say, the case is
  1.00 with the skill and 0.87 without. The grader was not changed here.
- **Two cases are low in both arms.** `plan-rank-select-series` (0.44 and 0.11): graders 03 (prerequisites named)
  and 07 (optional material marked) passed 0 of 6 across the arms. `outline-consistent-hashing` (0.50 and 0.00):
  grader 03 (applications ordered by a principle) passed 1 of 3 with the skill. `outline-bloom-filters` 05 and 06
  passed 0 of 6. By the rule in `evals.md`, a grader no arm passes is broken or names something the skill does
  not teach.
- **`fix-confusing-figure` separates the arms by +0.06 and +0.11**, as #237 predicted from a re-judging.

**What this does not show.**

- **One run per suite is not a spread.** Only `pedagogical-diagrams` has been run more than once with this judge.
  The other three suites have one record each, so nothing here says how far their means move between runs.
  `skill-authoring` has only 27 judged verdicts an arm and the judge split on 5 of them, so its mean may move
  more than the others'.
- **Both `pedagogical-diagrams` runs here, and both in #237, were made on one day.** A day effect is not excluded.
- **The trigger evals were not run**, so the full run's cost is this section's output cost plus an earlier
  measurement of the trigger cost, at today's query counts.
- **The low rows and `needs-a-script` were not investigated.** Whether each is the grader, the case or the skill
  needs the answers read, and the baselines hold them.
- **`advisors` is one case and six judged verdicts.** Its 1.00 is three answers.

## 2026-11-18: `fix-confusing-figure` graded on what the skill adds, and the two dropped conditions (#249)

Claude Code 2.1.318, agent and judge `claude-sonnet-5-5`, three runs per case per arm, `-j 4`. No change to the
skill: one prompt and eight grader files changed. US$9.25 in all: $3.39 for a first run of the three changed cases
(`claude plugin eval --case`, twice) and $5.86 for the whole suite through
`npm run skill-evals -- --skills pedagogical-diagrams --kind output` on commit `33d60a3`. No run errored, and the
skill loaded in every with-skill run (21 of 21).

**What the answers showed.** The six `fix-confusing-figure` answers of #248's first two-arm run were read, three
from each arm. Every no-skill answer already named the point, collapsed the replicas, dropped the queue and the
logger, gave each arrow style one meaning, deleted the legend and drew hit and miss in one layout. So graders 01,
02, 03 and 05 passed 6 of 6, 5 of 6, 6 of 6 and 6 of 6 across the arms and measured nothing. Three things
were in the with-skill answers and not in the others:

- **What the prose should carry.** All three with-skill answers gave the paragraph to what the picture cannot
  show (why a hit can skip the services, what decides a hit, how much it saves). All three no-skill answers
  replaced the paragraph with two or three sentences that walk through the hit path and the miss path, which the
  redrawn figure already shows. The old grader 04 passed that, because "which words move into the figure as
  labels" was one of its ways to pass.
- **A caption that says what to notice.** Three with-skill answers, one no-skill answer.
- **The repo's component by name** (`<bh-versions>` or `<bh-stepper>`). Three with-skill answers, none without.

**What changed.**

- **`fix-confusing-figure`.** Graders 02 (one meaning per arrow style) and 03 (labels in the figure, no legend)
  are deleted: the no-skill arm passed each 3 of 3. Grader 04 now asks one thing, what the prose should carry
  that the figure cannot show, and fails a replacement that only walks through the two paths. Grader 07 (the
  caption tells the reader what to notice) and grader 08 (a regex for `bh-versions` or `bh-stepper`) are new. The
  prompt now says the page is in the blog's repo and names its components, as `design-lz77-figure` does, so that
  08 is a fair question in both arms. 01 and 05 stay as the check that the answer still does the main job.
- **`design-lz77-figure` 07, new: the figure holds one idea.** This is "everything in the figure serves the
  point", the condition #247 dropped from grader 03, written as something a judge can apply: no second token or
  warm-up copy, no naive version, no toggle between variants. The skill teaches it (rule 2 lists "a second idea"
  among the usual cuts, and rule 9 asks that a second picture have a stated job), and the two no-skill answers
  read both added a shorter non-overlapping copy as a second version behind a toggle.
- **`review-stepper-boundary` 06, new: each pointer's marking stays the same wherever the pointer appears** (every
  step, other figures, the step text). This is the condition #247 dropped from grader 02. The three with-skill
  answers read all said it ("use them everywhere", "kept the same across every frame"); none of the no-skill
  answers did. Grader 02 now names 06 where it said no grader asks this.

**Result**, the suite run, with #248's two runs of the suite before the change beside it:

| Case | With | Without | Δ | Δ before, run 1 | Δ before, run 2 |
| --- | --- | --- | --- | --- | --- |
| `design-lz77-figure` | 0.86 | 0.14 | +0.71 | +0.78 | +0.78 |
| `fix-confusing-figure` | 0.89 | 0.28 | +0.61 | +0.06 | +0.11 |
| `review-deflate-figures` | 0.95 | 0.57 | +0.38 | +0.14 | +0.14 |
| `review-stepper-boundary` | 0.94 | 0.67 | +0.28 | +0.20 | 0.00 |
| Mean | 0.91 | 0.42 | +0.50 | +0.29 | +0.26 |

`fix-confusing-figure` scored 0.89 and 0.89 with the skill and 0.83 and 0.78 without before the change. In the
first run of the three changed cases it was 1.00 and 0.39 (+0.61), `design-lz77-figure` 0.76 and 0.19 (+0.57) and
`review-stepper-boundary` 0.83 and 0.61 (+0.22).

Passes of each changed or new grader, with the skill and without, in the first run and then the suite run:

| Grader | With, first run | Without, first run | With, suite run | Without, suite run |
| --- | --- | --- | --- | --- |
| `fix-confusing-figure` 01, names the point and cuts | 3 of 3 | 3 of 3 | 3 of 3 | 3 of 3 |
| `fix-confusing-figure` 04, what the prose carries | 3 of 3 | 1 of 3 | 3 of 3 | 0 of 3 |
| `fix-confusing-figure` 05, hit and miss in one layout | 3 of 3 | 3 of 3 | 3 of 3 | 2 of 3 |
| `fix-confusing-figure` 06, says what is left out | 3 of 3 | 0 of 3 | 1 of 3 | 0 of 3 |
| `fix-confusing-figure` 07, caption says what to notice | 3 of 3 | 0 of 3 | 3 of 3 | 0 of 3 |
| `fix-confusing-figure` 08, names the component | 3 of 3 | 0 of 3 | 3 of 3 | 0 of 3 |
| `design-lz77-figure` 07, one idea | 3 of 3 | 0 of 3 | 3 of 3 | 0 of 3 |
| `review-stepper-boundary` 06, markings stay the same | 3 of 3 | 1 of 3 | 3 of 3 | 1 of 3 |

- **Every new or rewritten grader fails more often without the skill than with it, in both runs.** The Sonnet
  judge split its votes on none of the 48 verdicts of 04, 07, `design-lz77-figure` 07 and `review-stepper-boundary`
  06. Over the suite run it split on 2 of 69 with-skill verdicts and 7 of 69 without.
- **Every case has a Δ of +0.2 or more in the suite run**, which is what #249 asks. Read the next list before
  relying on that for the two cases that did not change.
- **The with-skill mean is 0.91**, where four earlier Sonnet-judged runs had 0.94, 0.91, 0.93 and 0.94. The suite
  has 23 `llm` graders now, not 22, and the run cost $5.86 ($3.47 of it the judge) against $5.48 and $5.41.
- **A baseline is kept**: `pedagogical-diagrams/evals/baselines/2026-11-18-two-arm-249.json`, the suite run (24
  answers, both arms), trimmed with `rejudge.mjs --trim --commit 33d60a3`. The earlier baselines were graded with
  the old grader files, so their per-case scores do not compare with this one's.

**What this does not show.**

- **`review-deflate-figures` did not change and its Δ went from +0.14 twice to +0.38.** Its no-skill arm scored
  0.86 and 0.86 before and 0.57 here: graders 05 and 07 passed 0 of 3 and 1 of 3 without the skill, where they had
  passed 2 of 3 and 3 of 3 in #248's first run. That is the no-skill arm moving, as `review-stepper-boundary`'s did in #248 (0.73 and
  0.93). One run above the bar is not evidence that the case separates the arms.
- **`review-stepper-boundary` is +0.22 and +0.28 only because of grader 06.** Without it the case would be
  +0.13 and +0.20 on these answers, and it was 0.00 in one earlier run. Graders 02, 03 and 04 pass about as often
  without the skill as with it: over these two runs and #248's first, 6 of 9 with and 7 of 9 without, 8 and 7, and
  9 and 9. The rule that removed 02 and 03 from `fix-confusing-figure` applies to them too. They were left alone:
  #249 is about the other case.
- **The new graders were fitted to answers that had been read**, as the 2026-11-10 and #237 graders were. The two
  runs here are fresh answers, which is the check `evals.md` asks for, and they are two runs on one day.
- **Two of the six `fix-confusing-figure` graders ask about this repo and its house style** (07 is the caption
  rule in the skill's "In this repo" table, 08 a component name). A reader who wants the case to measure only
  design judgment should read 04 and 06: 6 of 6 and 4 of 6 with the skill, 1 of 6 and 0 of 6 without.
- **`fix-confusing-figure` 06 moved from 3 of 3 to 1 of 3 with the skill**, and two of its six verdicts in the
  suite run were split (both failed, one vote to two). The two failing answers were not read: this is the
  unsteady grader of the case.
- **`design-lz77-figure` 06 (cover the prose) passed 0 of 3 and then 2 of 3 with the skill**, and 05 passed 2 of
  3 and 1 of 3 in each arm. Neither grader changed. 05 no longer separates the arms on these two runs.
- **`design-lz77-figure` 07 fails a design that opens with a shorter, non-overlapping copy.** That can be defended
  as teaching the plain case first. The grader takes the skill's side (one figure, one point; a second picture
  needs a stated job), and a future change to the skill there should change the grader with it.
- **`--case` takes `*` and `?` only.** `{a,b}` and `[ey]` match nothing, at no cost, so two cases that share no
  pattern need two runs.

## 2026-11-18: why `needs-a-script` scored lower with the skill on two graders (#300)

Claude Code 2.1.318, agent and judge `claude-sonnet-5-5`, three runs per arm, `-j 4`. No change to the skill or
to the prompt: two grader files changed. US$1.48 in all: $0.94 for two judgings of the saved answers with
`rejudge.mjs` and $0.54 for one fresh run of the case in both arms (`claude plugin eval --case needs-a-script`,
35 s, $0.32 of it the judge) on commit `9f88d01`. No run errored, and the skill loaded in 3 of 3 with-skill runs.

**What the answers said.** The six `needs-a-script` answers of #248's run were read, three from each arm. The
prompt asks to turn a by-hand check (every skill directory has a `SKILL.md`, and its `name` matches the directory)
into a skill, and asks what goes in the skill and where the check lives.

- **All three no-skill answers build a new skill**: a `validate-skills` directory with a short `SKILL.md` and a
  new script of its own ("Put the check in a script, and have the skill call it"). None knows the repo has a
  lint.
- **All three with-skill answers say not to build one.** "Don't make this a skill. Make it a script, wired into
  the repo's check", "Don't make it a skill", "The check belongs in a script, not in a skill". Each gives the
  skill's reason (section 1: a rule that must hold every time goes in a repo check or hook), names
  `npm run lint-skills` and `scripts/lint-skill.mjs`, says to see whether the lint already covers the two checks
  and to add what is missing there, and adds `claude plugin validate`. Two offer a skill as an option, a few
  lines that say to run the lint, and say it may not be needed.
- **All six answers mention a hook, a pre-commit step or CI**, each with the same reason: so the check runs
  without anyone remembering to start it.

The with-skill answers are the better ones for this repo: the lint already makes both checks, and a second
script in a new skill would be a second copy.

**Why the two graders failed them.**

- **`run-not-read` asked for a distinction that the better answer has no reason to draw.** Its rubric was "the
  check should be a script that Claude runs (only its output enters context) rather than instructions that Claude
  re-implements or reads each time", and it failed an answer that "never distinguishes running a script from
  reading it". That describes a script bundled in a skill. An answer that puts the check in the repo's lint, run
  by `npm` or a hook, says nothing about what Claude reads, because Claude is not what runs it. The votes that
  failed with-skill answers when the old rubric was judged again say so: "It never says that Claude runs the
  script so that only its output enters context, and it never contrasts running a script with reading or
  re-implementing it." The no-skill answers
  pass with one sentence ("not in prose instructions Claude re-interprets each time"). The rubric was read to
  the letter and the answer had moved to a place the letter did not cover.
- **`lowest-rung` asked two things, and one of them is a judgment the judge does not hold steady.** It wanted
  "a SKILL.md plus one script" and no hooks "without a reason". The record does not keep the built-in judge's
  reasoning, so why it failed two with-skill answers (one vote to two, both times) cannot be read. What can be
  shown: all six answers propose a hook with the same reason, and the same judge model, asked again through
  `rejudge.mjs` with the same rubric, passed all three with-skill answers and failed a no-skill one three votes
  to none ("the only reason given is skipping manual invocation"). 3 of the 6 verdicts changed between two
  judgings of the same text. Whether "so you do not have to remember" is a reason from the use case is the
  whole verdict, and the skill itself says a must-hold rule goes in a check or hook. This grader was already
  noted as noise twice on 2026-10-30 (#86 and #96).
- **Neither is the skill's fault and neither is the prompt's.** The skill steers the answer away from "a
  `SKILL.md` plus one script", which is what both rubrics took as the right answer, towards no new skill. The
  graders were written before the skill said that.

**What changed.**

- **`lowest-rung` now asks one thing: does the answer say the check needs no new skill?** It passes an answer
  that puts the check in something the repo runs and calls a skill unnecessary, or at most an optional thin
  wrapper that may not be needed. It fails an answer whose recommendation is a new skill, however short, that
  never says the check can do without one. A hook, a pre-commit step or CI neither passes nor fails. The old
  condition about an MCP server, forked context or packaging is gone: none of the twelve answers read here
  proposes any of them.
- **`run-not-read` now asks one thing: is the check itself code that is run?** It passes a script, a lint or a
  repo check, new or existing, and fails an answer that has Claude make the check by following written steps.
  It says not to fail an answer for using an existing repo script, for recommending no skill, or for not
  mentioning context.

**Result.** Passes of each grader, with the skill and without. "Old rubric, judged again" and "new rubric" are
the saved answers through `rejudge.mjs`; the fresh run is new answers through the built-in judge.

| Grader | #248's record | Old rubric, judged again | New rubric, saved answers | New rubric, fresh run |
| --- | --- | --- | --- | --- |
| `lowest-rung` | 1 of 3, 3 of 3 | 3 of 3, 2 of 3 | 3 of 3, 0 of 3 | 3 of 3, 0 of 3 |
| `run-not-read` | 1 of 3, 3 of 3 | 1 of 3, 3 of 3 | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 |
| `reuses-existing-lint` (regex, unchanged) | 3 of 3, 0 of 3 | | 3 of 3, 0 of 3 | 3 of 3, 0 of 3 |
| `bundles-a-script` (regex, unchanged) | 3 of 3, 3 of 3 | | 3 of 3, 3 of 3 | 3 of 3, 1 of 3 |
| `no-repo-root-path` (unchanged) | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 |

| `needs-a-script` | With | Without | Δ |
| --- | --- | --- | --- |
| #248's record | 0.73 | 0.80 | −0.07 |
| Saved answers, new rubrics | 1.00 | 0.60 | +0.40 |
| Fresh run | 1.00 | 0.47 | +0.53 |

- **Neither grader now passes more often without the skill than with it**, on the saved answers or on the fresh
  run, which is what #300 asks.
- **The judge split its votes on none of the 12 saved verdicts of the two new rubrics**, and on 1 of the 12
  fresh ones (`run-not-read`, a with-skill answer, passed two votes to one). With the old rubrics it split on 2
  of 12 when judged again and on 3 of 12 in the record.
- **The fresh answers repeat the saved ones.** Three with-skill answers open "This probably shouldn't be a
  skill", "the check shouldn't be a skill" and "Don't make this a skill", and all name the lint. Three no-skill
  answers build a `validate-skills` or `check-skills` skill with its own script.
- **A baseline is kept**: `evals/baselines/2026-11-18-needs-a-script-300.json`, the fresh run (6 answers, both
  arms), trimmed with `rejudge.mjs --trim --commit 9f88d01`. The case has no fixture.

**What this does not show.**

- **`run-not-read` passes 6 of 6 in both sets of answers, so it measures nothing about the skill.** It is kept
  as the check that the answer still does the main job, as `fix-confusing-figure` 01 and 05 were in #249: it
  would fail a skill change that led the answer to prose steps. By the rule in `evals.md` it could as well be
  deleted. `no-repo-root-path` also passes 12 of 12.
- **The case's Δ now comes from two graders that both ask about the same move.** `lowest-rung` (no new skill)
  and `reuses-existing-lint` (names the lint) pass together in all twelve answers. That is one thing the skill
  teaches, counted twice among five scored graders.
- **`lowest-rung` takes the skill's side.** A short skill that runs a bundled script is a fair answer to "I want
  to turn that into a skill", and the grader fails it. It follows section 1 of `SKILL.md`; a change there should
  change the grader with it. It can be passed without the repo: an answer need only say the check belongs in CI
  or a pre-commit step and needs no skill. Two no-skill answers come near ("That's where the check really
  lives, and the skill is just a convenient way to run it on demand") and still build the skill.
- **`reuses-existing-lint` cannot pass without the skill.** The sandbox is empty and the prompt does not name
  the lint, so only the skill's text can supply it. It shows the skill was read, not that the answer is better.
- **`bundles-a-script` fell to 1 of 3 without the skill in the fresh run for a reason of its own.** It is a
  regex for `scripts/`, and two no-skill answers put `check.sh` beside `SKILL.md`. It passes the with-skill
  answers only because they name `scripts/lint-skill.mjs`, and none of them bundles a script. Its name no
  longer says what it checks. It was not changed: #300 is about the other two.
- **The new rubrics were fitted to six answers that had been read**, and confirmed on one fresh run of three
  answers an arm, made the same day. One run is not a spread.
- **The 3 of 6 changed verdicts for the old `lowest-rung` compare two judge prompts**, the built-in one and the
  script's, which are not the same. That agreement was not measured for this suite before; for
  `pedagogical-diagrams` with Haiku it was 84% to 89%.
- **Only Sonnet was run.** Haiku and Opus scored this case +0.07 and +0.13 with the old graders in October, and
  their answers have not been read.

## 2026-11-18: `needs-a-script`'s graders named for what they check, and which are guards (#318)

Judge `claude-sonnet-5-5` through `rejudge.mjs`, three votes. No change to the skill, to the prompt or to the
text of any rubric: one grader file renamed and two deleted. US$0.71, all of it one judging of saved answers
(36 verdicts). **No `claude plugin eval` run was made, and none was needed**: the three graders that remain have
the text they had in #300's fresh run, and the two that went were regexes, which can be run on saved answers by
hand.

The answers are the twelve of #300: three from each arm of its fresh run
(`evals/baselines/2026-11-18-needs-a-script-300.json`) and three from each arm of #248's run (`2026-11-18.json`).

**What each grader checked, and the decision.**

- **`bundles-a-script`: deleted.** It was a regex for `scripts/`. No with-skill answer bundles a script in a
  skill: all six say the check needs no new skill. They passed because each names the repo's lint,
  `scripts/lint-skill.mjs`, and in four of the six that is the only `scripts/` in the answer. So with the skill
  it checked what `reuses-existing-lint` checked. Without the skill it checked where a new skill keeps its
  script: four answers that keep it under `scripts/` pass and two with `check.sh` beside `SKILL.md` fail, and
  all six bundle a script. No name fits both arms. Making it check what its name says was not an option
  either: the skill teaches the opposite answer here (section 1), so a grader for "bundles a script" would fail
  the answers the skill is right to give.
- **`lowest-rung`: renamed `no-new-skill`.** Since #300 its rubric asks one thing, whether the answer says the
  check needs no new skill. The old name was from the ladder (a lone `SKILL.md` plus a script), which is what the
  no-skill answers build and the rubric fails. The text is unchanged.
- **`reuses-existing-lint`: deleted, which merges it into `no-new-skill`.** It was a regex for `lint-skills` or
  `lint-skill.mjs`. The two passed and failed together in all twelve answers, so the Δ counted one move twice.
  Of the two, `no-new-skill` is the one both arms can pass: an answer needs only say the check belongs in CI or
  a pre-commit step and not in a skill. The regex cannot pass without the skill, because the sandbox is empty
  and the prompt does not name the lint (#300 said so). A grader that one arm cannot pass shows that the skill
  was read, which `skill-fired` already shows without being scored.
- **`run-not-read`: kept, as a guard.** Its name says what it asks (the check is code that is run, not steps
  Claude reads and follows). It passes every answer in both arms and adds nothing to Δ. It would fail a skill
  change that led the answer to do the check by written steps.
- **`no-repo-root-path`: kept, as a guard.** It also passes every answer in both arms. It would fail a
  with-skill answer that names a bundled file by a `.claude/skills/<name>/…` path (rule 4 of `SKILL.md`).

**The graders of the case now.**

| Grader | Type | Role | What it checks |
| --- | --- | --- | --- |
| `no-new-skill` | `llm` | scored, separates the arms | The answer says the check needs no new skill |
| `run-not-read` | `llm` | scored, guard | The check itself is code that is run |
| `no-repo-root-path` | `llm` | scored, guard | No bundled file is named by a repo-root path |
| `skill-fired` | `tool_used` | not scored | The skill loaded (with-skill arm only) |

A guard here is a grader that passes in both arms on purpose: it holds the answer to the main job and is not
expected to add to Δ.

**On the saved answers.** Passes with the skill and without. The `llm` rows are `rejudge.mjs --rubrics` with
the files as they are now (`no-new-skill` under its recorded name, from a scratch directory, as in #301); the
regex rows are the two deleted patterns, from the record.

| Grader | #300's fresh answers | #248's answers |
| --- | --- | --- |
| `no-new-skill` | 3 of 3, 0 of 3 | 3 of 3, 0 of 3 |
| `run-not-read` (guard) | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 |
| `no-repo-root-path` (guard) | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 |
| `reuses-existing-lint` (deleted) | 3 of 3, 0 of 3 | 3 of 3, 0 of 3 |
| `bundles-a-script` (deleted) | 3 of 3, 1 of 3 | 3 of 3, 3 of 3 |

| `needs-a-script` | With | Without | Δ |
| --- | --- | --- | --- |
| #300's fresh run, five graders, as recorded | 1.00 | 0.47 | +0.53 |
| The same answers, three graders | 1.00 | 0.67 | +0.33 |
| #248's answers, three graders | 1.00 | 0.67 | +0.33 |

- **Each scored grader's name now says what it checks**, and two of the three are guards, which is what #318
  asks.
- **The judge split its votes on none of the 36 verdicts.** On the 18 of #300's fresh run, whose record was
  made with these rubrics, it gave the built-in judge's verdict every time. #248's record was made with the old
  rubrics of two of the three, so its 7 differences from that record are #300's change, not this one.
- **The Δ falls from +0.53 to +0.33 by construction.** The answers and the verdicts are the same; two graders
  that failed the no-skill arm are gone, one of them a second count of `no-new-skill` and the other a check of
  where a script is kept.

**What this does not show.**

- **The Δ now comes from one grader.** With three scored graders the case moves in steps of 0.11 and cannot
  exceed +0.33. If `no-new-skill` passes one no-skill answer in three, the case is at +0.22.
- **Nothing scored now asks whether the answer names the repo's lint.** All six with-skill answers do, and it is
  the better answer for this repo (#300). A change to section 1 of `SKILL.md` that dropped `npm run lint-skills`
  would leave the score where it is. A grader marked for the with-skill arm only would keep the check out of
  the score, as `skill-fired` is; whether a regex grader can be marked that way was not tried, because trying it
  needs a run.
- **`no-new-skill` takes the skill's side**, as #300 said of it under its old name.
- **No baseline has the new names.** `2026-11-18-needs-a-script-300.json` records `lowest-rung`,
  `reuses-existing-lint` and `bundles-a-script`, and was not rewritten. To judge it again with today's files,
  copy `no-new-skill.md` to a scratch directory as `lowest-rung.md`. The next run of the suite will be the first
  record with the new names, and its `needs-a-script` score will not compare with #300's.
- **Nothing new was measured.** These are the twelve answers of #300, from one model on one day.

## 2026-11-18: six `pedagogical-writing` graders that rejected correct answers or passed in no arm (#299)

Claude Code 2.1.318, agent and judge `claude-sonnet-5-5`, three runs per case per arm, `-j 4`. No change to the
skill: four grader files changed and two were deleted, so the suite has 59 `llm` graders, not 61. US$9.31 in all:
$2.17 for judging saved answers again with `rejudge.mjs` and $7.14 for a fresh run of five cases, both arms
(`claude plugin eval --case`, three times, on commit `c707b27`). No run errored, and the skill loaded in every
with-skill run (15 of 15).

The answers read are those of #248's run, kept in `pedagogical-writing/evals/baselines/2026-11-18.json`: all
three with-skill answers of each of the four cases, and the no-skill answers of the same cases, read or searched
for the thing each grader asks. The run does not record why the built-in judge voted as it did. `rejudge.mjs --out`
gives a Sonnet judge's reasoning on the same answers, but its prompt is not the built-in one, and here it
disagreed with the record often (below), so the diagnoses rest on the answers.

**What the answers showed, and the decision, per grader.**

- **`prompt-opus-explainers` `05-effort`: loosened.** #248 found the fault: the regex wanted `effort` and `high`
  in one sentence, and the three with-skill answers put a full stop between them ("Raise effort. The default is
  `medium`. Reviewers saw less padding at `high` or above."). Widening the window alone is wrong in two ways.
  Every answer quotes the user's "high-level summary" line, so `high` is always near something. And one no-skill
  answer says "Try `high` only if the reasoning in the drafts is thin, not to fix padding", which is not advice to
  raise it. The pattern now has five alternatives: the old same-sentence one in both orders; a verb of raising
  (`raise`, `increase`, `bump`, `turn up`, `higher`) before `effort`, then the level within 200 characters across
  sentences; `effort`, then "`high` or above" within 200 characters, the skill's own wording ("draft at `high` or
  above"); and `effort`, then "try" or "test" and the level, unless "only" follows. `high-level` no longer counts
  as `high`. The last alternative was added after the fresh run, whose no-skill answers said "Try `high` on a few
  drafts and compare" in a sentence after the one with `effort`.
- **`plan-rank-select-series` 03 (prerequisites named by title or slug, not by page number): reworded.** The skill
  teaches it ("Link prerequisites by title, never by number", `long-pages-and-series.md`), and all three
  with-skill plans say it: "Pages are linked by title or slug, never by number", "Pages link to each other by
  slug, not by number", "link to page 1 by title". All three also call their pages "Page 1", "Page 2" and "p1"
  in their own headings and ledgers, as any plan does, and the old rubric ("named by title or slug, not by page
  number") reads as a claim about the plan's own text. No no-skill plan says how pages name each other: they
  have "links to page 1", previous and next links and a "Part N of 3" banner. The rubric now asks whether the
  plan says the pages link or refer to one another by title or slug, says that the plan's own "page 1" labels
  must not fail it, and fails a plan that only has links back or a banner.
- **`plan-rank-select-series` 07 (optional or formal material is skippable, with what a skipper keeps): reworded
  to its first half.** Two conditions in one rubric. All three with-skill plans set formal material apart: "a
  `details.disclosure` titled 'What this skips' holds the o(n) space proof", "Put the proof in a fold", "a fold
  for rigour". Only one comes near the second half (an "essence checkpoint" after which a step "changes speed,
  not what it returns"). The skill does teach "Say what the skipper keeps", but as a sentence in the page's main
  text before a fold, which a three-page plan does not reach. No no-skill plan sets anything apart: "proofs
  sketched and pointers to papers", "If you want full proofs ... the series would become four pages". The rubric
  now asks only that some formal or optional material is moved to a place a reader can skip on at least one
  page, says the plan need not say what a skipper keeps, and fails "proofs are sketched", "the papers are
  linked" and "full proofs could be a further page". The second half is dropped, as #83 dropped the halves a
  judge could not decide from a plan.
- **`outline-bloom-filters` 05 (one running example throughout, small numbers that come out clean): deleted.** The
  prompt asks for "the running example", and every answer in both arms gives one of the same kind: a username
  check on a 12, 16 or 20-bit array with three names (`ada`, `grace`, `alan` with the skill; `alice`, `bob`,
  `carol` without). Every answer also leaves it at some point (a sizing section at 1 million or 1 billion keys,
  a playground task at `m=64, n=8`, a "10 bits per item" table), so "throughout" and "come out clean" fail all
  six on a strict reading and pass all six on a loose one: the `rejudge.mjs` judge passed 3 of 3 in each arm
  where the record has 0 of 3. Neither reading tells the arms apart.
- **`outline-bloom-filters` 06 ("false positive" or the formula only after the reader has seen a collision):
  deleted.** The with-skill outlines fail it in the TL;DR: "more hash functions always means fewer false
  positives" (the common-mistake bullet), "false positives yes, false negatives never" (the result). The skill
  asks for exactly that, a TL;DR that states the result and holds back the mechanism, and grader 08 checks it.
  In the body all three show a collision first (`linus` lands on a bit `grace` set) and bring the formula two or
  three sections later. So do the no-skill outlines: a shared bit in section 3, the false positive in section 4
  or 5, the formula in section 5 or 6. A rubric limited to the body would pass both arms. What the skill adds to
  this part of an outline is the named failure of the naive attempt, which 03 already asks.
- **`outline-consistent-hashing` 03 (applications ordered by a stated principle): reworded.** The three with-skill
  outlines say nearly the same thing: "applications ordered by one stated principle. Each is the same ring under
  a bigger or harder setting, and each adds one new thing", "Principle, stated up front: each step raises the
  cost of moving a key", "the same ring under bigger or harder conditions, each adding one new thing". The
  record passed the first, three votes to none, and failed the other two, none to three. The old rubric lists
  "virtual nodes, replication, bounded loads, named systems" as the things to be ordered, and in all three
  outlines virtual nodes and the implementation have sections of their own before the list of uses, so a judge
  that takes the list literally can fail any of them. It also asks three things: an order, a principle of a
  given kind, and that the principle is said. The rubric now asks one thing of the list of uses only (what
  orders it), gives two phrasings that count, and says that earlier sections on virtual nodes or replication and
  a closing "where not to use it" must not fail it. No no-skill outline states an order: each has "Where it's
  used in practice" as a list by kind of system.

**Counts on the saved answers** (#248's baseline), passes with the skill and without. The `rejudge.mjs` columns
are a Sonnet judge with that script's prompt, three votes; it split its votes on 5 of the 30 verdicts under the
old rubrics and on none of the 18 under the new.

| Grader | Record, old wording | `rejudge.mjs`, old wording | New wording |
| --- | --- | --- | --- |
| `prompt-opus-explainers` `05-effort` (regex) | 0 of 3, 1 of 3 | | 3 of 3, 1 of 3 |
| `plan-rank-select-series` 03 | 0 of 3, 0 of 3 | 2 of 3, 0 of 3 | 3 of 3, 0 of 3 |
| `plan-rank-select-series` 07 | 0 of 3, 0 of 3 | 1 of 3, 0 of 3 | 3 of 3, 0 of 3 |
| `outline-bloom-filters` 05 | 0 of 3, 0 of 3 | 3 of 3, 3 of 3 | deleted |
| `outline-bloom-filters` 06 | 0 of 3, 0 of 3 | 1 of 3, 2 of 3 | deleted |
| `outline-consistent-hashing` 03 | 1 of 3, 0 of 3 | 3 of 3, 0 of 3 | 3 of 3, 0 of 3 |

- **The `rejudge.mjs` judge gave the recorded verdict on 16 of 30 answers under the old wording.** `evals.md`
  says to run it first with the judge the record used, and that this agreement is the ceiling. Here the ceiling
  is low: on `outline-bloom-filters` 05 it reversed all six. So the "new wording" column for the three `llm`
  graders says the rewording did not break them, and no more. The fresh run is the evidence.
- **`05-effort` was also run on four answers written for it** that do not say to raise the effort: one that
  never mentions effort (and says "Keep max_tokens high enough"), one that says the default is `medium` and to
  leave it, one that says to lower it to `low`, and the saved no-skill answer quoted above. It fails all four.
  The one saved no-skill answer it passes says "Set `output_config.effort` explicitly and try `high` on the
  drafts".

**The fresh run**, three commands (`--case 'outline-*'`, `plan-rank-select-series`, `prompt-opus-explainers`), with
#248's scores beside it:

| Case | With | Without | Δ | With, #248 | Without, #248 | Δ, #248 |
| --- | --- | --- | --- | --- | --- | --- |
| `outline-amortised-append` | 0.83 | 0.67 | +0.17 | 0.92 | 0.67 | +0.25 |
| `outline-bloom-filters` | 0.94 | 0.11 | +0.83 | 0.71 | 0.13 | +0.58 |
| `outline-consistent-hashing` | 1.00 | 0.00 | +1.00 | 0.50 | 0.00 | +0.50 |
| `plan-rank-select-series` | 0.72 | 0.17 | +0.56 | 0.44 | 0.11 | +0.33 |
| `prompt-opus-explainers` | 1.00 | 0.93 | +0.07 | 0.80 | 0.87 | −0.07 |

`outline-amortised-append` did not change; it ran because `--case 'outline-*'` matches it. `outline-bloom-filters`
has six scored graders now, not eight, so its score moves by construction.

| Grader | With, fresh run | Without, fresh run |
| --- | --- | --- |
| `prompt-opus-explainers` `05-effort`, as run | 3 of 3 | 2 of 3 |
| `prompt-opus-explainers` `05-effort`, final pattern on the same answers | 3 of 3 | 3 of 3 |
| `plan-rank-select-series` 03 | 2 of 3 | 0 of 3 |
| `plan-rank-select-series` 07 | 3 of 3 | 0 of 3 |
| `outline-consistent-hashing` 03 | 3 of 3 | 0 of 3 |

- **The three reworded rubrics pass 8 of 9 with the skill and 0 of 9 without, on answers they were not fitted
  to.** The judge split its votes on none of those 18 verdicts. Over the whole fresh run it split on 2 of 66
  with-skill verdicts and 1 of 66 without.
- **No grader in the five cases passed 0 answers in both arms.** The lowest with-skill counts are 1 of 3:
  `outline-amortised-append` 02 (3 of 3 without) and `plan-rank-select-series` 04 and 06 (0 of 3 without). For
  the eight cases not run again, #248's baseline has no grader at 0 in both arms: the four above were the only
  ones.
- **`05-effort` no longer tells the arms apart, and the case scores 1.00 in both arms with the final pattern.**
  All three fresh with-skill answers used the skill's sentence ("Draft at `high` or above, where reviewers saw
  less padding"). All three fresh no-skill answers also say to try `high`: "so test `high`", "Try `high` on a few
  drafts and compare", "Try `high` for drafting and compare". The pattern as run passed two of them and failed
  the middle one only because `effort` was in the sentence before, which is the fault this section set out to
  remove, so the pattern got the "try" alternative and the six fresh answers were scored again by running it.
  In #248's baseline one of three no-skill answers said it.
- **Cost.** $3.70 (`outline-*`, 174 s), $1.89 (plan, 95 s) and $1.55 (prompt, 62 s): $7.14, of which the judge
  was $4.38. Judging again cost $1.42 for the five `llm` graders as recorded (90 votes) and $0.75 for the three
  reworded ones (54 votes): about $0.015 a vote, where `evals.md` says about $0.01.
- **Baselines kept**, trimmed with `rejudge.mjs --trim --commit c707b27`: `2026-11-18-299-outline.json` (18
  answers), `2026-11-18-299-plan.json` (6) and `2026-11-18-299-opus.json` (6), beside `2026-11-18.json` in
  `pedagogical-writing/evals/baselines/`. None of the five cases has a fixture. The `05-effort` verdicts in the
  last file are from the pattern as run, one alternative short of the committed one.

**What this does not show.**

- **`prompt-opus-explainers` measures almost nothing about the skill.** Its other four graders passed 3 of 3 in
  both arms in #248 and again here, and `05-effort` now passes most no-skill answers too. By the rule in
  `evals.md` the case should be made harder or deleted. That was not done: #299 is about the graders.
- **The reworded `plan` 03 passes a plan for saying the rule.** It does not check that the plan's own
  cross-references use titles, which no plan's did. The one fresh with-skill answer that failed it has no sentence about titles, slugs or numbers (searched, not read through).
- **`plan` 07 no longer asks what a skipper keeps**, so nothing in the suite asks whether an answer applies that
  rule of the skill. A case that drafts or reviews a page with a fold could.
- **One fresh run, on the day the rubrics were written, by the person who read the answers.** `plan` 03 passed
  2 of 5 and 1 of 5 with the skill in #97 under its old wording and 0 of 3 in #248, so it moves; 2 of 3 here is
  not a rate.
- **Why the built-in judge failed the old wordings is inferred, not read.** The record keeps votes, not reasons,
  and the judge whose reasons were read disagrees with it on 14 of 30 of these verdicts.
- **The eight other cases were not run.** "No grader passes 0 in both arms" is fresh for five cases and taken
  from #248's baseline for eight. That baseline also shows graders that pass 3 of 3 in both arms (four of
  `review-deflate-page`'s, three of `design-rank-interactive`'s among them), which measure nothing either and
  were not in scope.
- **`05-effort` is a regex about advice.** An answer that says "do not raise the effort to `high`" in one sentence
  passes it, as it did before. No saved or fresh answer says that.

## 2026-11-18: "or reading any file" in `skill-authoring`'s description does not make Sonnet load other skills (#306)

Claude Code 2.1.318, agent `claude-sonnet-5-5`, three runs per query, `--max-turns 3`, `--keep`. No change to any
skill. US$31.96 in all, $15.97 and $15.99 for the two arms.

**The question.** In #233, "Load it before answering or reading any file." in `pedagogical-writing`'s description made
Sonnet load `pedagogical-diagrams` on that skill's quiet query #23 in 5 of 6 runs. `skill-authoring`'s description
has carried the same phrase since #86. Does it cause loads of other skills today?

**Design.** Two arms that differ in one sentence of `skill-authoring`'s description: A is the description on `main`
("Load it before answering or reading any file."), B has "Load it before answering." Each arm is a copy of
`.claude/skills` in its own scratch git repository, and `run-trigger-evals.mjs` was run from inside it, so the
temporary plugin held all five skills with that arm's description. The two arms of a suite ran at the same time.
The queries are the `should_trigger: false` ones of all five suites, chosen with `--only`. There are 77. Five were
left out because another suite asks the same thing in the same or nearly the same words (`anatomy` #11 and #13,
`pedagogical-writing` #14, #29 and #30), which leaves 72. The script's PASS says only whether the suite's own skill
loaded, so every `Skill` call in every kept trace was counted by skill name.

**Result.** Runs that loaded each skill, of the runs made. No run loaded two skills.

| Suite (quiet queries run) | Arm | Runs | `pedagogical-writing` | `pedagogical-diagrams` | `anatomy` | `dataviz` | `claude-api` | `update-config` | `skill-authoring` | `advisors` | No skill |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `advisors` (8) | A | 24 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 18 |
| | B | 24 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 18 |
| `anatomy` (13) | A | 39 | 21 | 3 | 0 | 9 | 0 | 0 | 0 | 0 | 6 |
| | B | 39 | 21 | 2 | 0 | 9 | 0 | 0 | 0 | 0 | 7 |
| `pedagogical-diagrams` (10) | A | 30 | 6 | 0 | 3 | 9 | 0 | 0 | 0 | 0 | 12 |
| | B | 30 | 6 | 0 | 3 | 9 | 0 | 0 | 0 | 0 | 12 |
| `pedagogical-writing` (26) | A | 78 | 0 | 15 | 0 | 3 | 10 | 0 | 0 | 0 | 50 |
| | B | 78 | 0 | 15 | 0 | 3 | 10 | 0 | 0 | 0 | 50 |
| `skill-authoring` (15) | A | 44 | 9 | 0 | 0 | 3 | 3 | 6 | 0 | 0 | 23 |
| | B | 42 | 9 | 0 | 0 | 3 | 3 | 6 | 0 | 0 | 21 |
| All (72) | A | 215 | 42 | 18 | 3 | 24 | 13 | 6 | 0 | 0 | 109 |
| | B | 213 | 42 | 17 | 3 | 24 | 13 | 6 | 0 | 0 | 108 |

- **The phrase causes no cross-skill load that these runs can see.** 68 of the 71 queries run three times in both arms
  gave the same loads in both: the same skill in 3 of 3 runs, or none in 3 of 3. The other three moved by one run
  each, and not in one direction: `anatomy` #15 (the TLS sequence diagram) loaded `pedagogical-diagrams` 3 of 3 with
  A and 2 of 3 with B; `pedagogical-writing` #42 loaded `claude-api` 3 of 3 with A and 2 of 3 with B; and
  `pedagogical-writing` #40 loaded it 1 of 3 with A and 2 of 3 with B. One run in three is the step #233 and the
  note at the top of this file call noise, and none of the three was run again.
- **The query of #233's observation stayed quiet in both arms.** `pedagogical-diagrams` #23 ("convert the mermaid
  flowchart in the rate limiting ADR into inline SVG…") made no `Skill` call in 3 of 3 runs with A and 3 of 3 with
  B. Each run searched four or five times with `Grep` and `Glob`, found nothing and said so.
- **Every suite's own skill stayed quiet**: 72 of 72 queries passed with A and 71 of 71 with B. `skill-authoring`
  and `advisors` loaded in no run of either arm.
- **Every load was of the skill the query belongs to**: `pedagogical-writing` on prose and page-clarity queries,
  `pedagogical-diagrams` on figure-design queries, `anatomy` on the isometric figure, `dataviz` on charts,
  `claude-api` on API and model queries, `update-config` on `settings.json` queries. So a quiet query that loads a
  neighbour is the neighbour firing as its own suite asks, and about half the runs do (106 of 215 with A).
- **The description stays as it is.** Shortening it would give up the wording #86 measured on Haiku for no measured
  gain on Sonnet. `skill-authoring`'s Haiku suite was not run again, because nothing changed.

**What this does not show.**

- **It is not a repeat of #233's observation.** There the phrase was in `pedagogical-writing`'s description, a skill
  whose territory (pages, explainers) is close to the query that moved. Here it is in `skill-authoring`'s, whose
  territory is far from every quiet query but its own. So the result is that this sentence in this description is
  harmless today, not that the phrase is safe in any description. Why it moved a neighbour in #233 is still not
  known.
- **Three runs a query, one day, one model and one Claude Code version.** An effect the size of #233's (5 of 6
  against 0 of 3) on any one of the 71 queries would have shown. An effect of one run in three on a few queries
  would not.
- **`skill-authoring` #34 was not compared.** Both arms of that suite stopped at the `--max-cost 5` ceiling ($5.19
  and $5.24): A ran #34 twice, with no `Skill` call, and B not at all. That suite cost about $0.35 a query, twice
  the $0.17 of `pedagogical-diagrams`, which the estimate was taken from. That is also why the whole measurement cost
  $31.96 against a $30 budget, and why no query was run a second time.
- **The should-fire queries were not run.** A phrase that made Sonnet load the wrong skill on a query that should
  load another one would not show here unless that query is also some suite's quiet query.
- **The sandbox is empty and the cap is three turns.** A run that hunts for a file finds nothing. In a real repo the
  hunt succeeds, and what Sonnet does after reading a file was not measured. User-level skills are not loaded
  either.

## 2026-11-18: the Haiku misses of `pedagogical-writing` labelled from traces, and seven queries reworded (#308)

Claude Code 2.1.318, agent `claude-haiku-5-5` unless a row says Sonnet, three runs per query, `--keep` on every
run. The description did not change. Seven queries changed. US$3.57 in all: $1.71 for six Haiku runs and $1.86
for one Sonnet run of the seven changed queries.

**Baseline**, the description on `main` and the queries as they were: 49 of 58, should-fire 20 of 29, quiet 29 of
29, held-out 17 of 20, $0.68. Nine should-fire queries missed. In seven of them every missing run searched the
empty working directory and never called `Skill`; two were answered in one turn.

| Query, old wording | Fired | Runs that missed: tool calls in order, and the end | Label from this trace |
| --- | --- | --- | --- |
| #5 "make the token bucket page easier to understand…" | 1 of 3 | `Grep, Glob, Bash (error), Grep, Glob`; `Grep, Glob, Grep (error), Glob (error), Read (error)`; both at the turn cap | sandbox |
| #6 "…a tutorial on monad transformers… what order?" | 0 of 3 | no tool calls, three times; answered in one turn | description |
| #11 "the paragraphs in the select section are hard to read…" | 0 of 3 | `Grep, Glob, Bash (error)`; `Grep, Glob, Glob`; `Grep, Glob, Grep (error)`; all at the turn cap | sandbox |
| #12 "write a predict-before-reveal question for the huffman page…" | 0 of 3 | `Grep, Grep, Glob, Grep, Grep (error)` and two like it; all at the turn cap | sandbox |
| #25 held-out "…a better running example for the arithmetic coding explainer…" | 0 of 3 | `Grep, Grep (error), Glob, Glob` and two like it; all at the turn cap | sandbox |
| #34 "the step captions under my stepper just narrate motion…" | 1 of 3 | `Grep, Grep, Glob, Bash (error), Grep, Glob`; `Grep, Bash (error), Glob`; both at the turn cap | sandbox |
| #35 "is the token bucket playground worth building at all…" | 0 of 3 | no tool calls, three times; answered in one turn | description |
| #38 held-out "after the stepper on the rank page, what question…" | 1 of 3 | `Grep, Glob, Glob, Grep`; `Grep, Glob, Glob, Grep (error)`; both then said the page was not found and ended on their own | sandbox |
| #53 held-out "give the huffman tutorial a pass/fail mark…" | 0 of 3 | `Grep, Glob, Grep (error), Glob`, twice at the turn cap and once ending with "I couldn't find the Huffman tutorial" | sandbox |

The `(error)` calls are a search outside the working directory, which the sandbox denies, or `Bash`, which the
case does not grant. #233 named #4 and #10 as misses too. Here they passed 2 of 3, as #1, #51 and #52 did, and
the one missing run of each was the same file hunt.

**Raising `--max-turns` does not help.** The seven sandbox queries were run again at `--max-turns 10` ($0.09).
All 21 runs ended on their own, in 4 to 18 turns, and 16 of them never called `Skill`: 0 of 3 on #11, #12 and #25,
1 of 3 on #5, #38 and #53, 2 of 3 on #34. A run that does not find the page says so ("I couldn't find the file, so I
haven't changed anything yet") and asks for the path, or answers from memory. It does not load the skill after the
search fails. This is what #91 found for #25 on Sonnet.

**The seven queries were reworded once, with the material in the prompt**, and were not reworded again after they
were scored. This is a change to the queries, not a result. Each keeps its intent, its `should_trigger` and its
held-out mark.

| Query | What the new wording adds |
| --- | --- |
| #5 | "make this opening of my token bucket page easier…", then the opening quoted (five sentences on b tokens, r per second, 429) |
| #11 | the same request, then the first paragraph of the select section quoted (eight short sentences) |
| #12 | "my huffman page", then the paragraph before the question quoted (bit 0 first, the code A=0, B=10, C=11, the byte 0x0D) |
| #25 held-out | "my arithmetic coding explainer", then the example it uses now: 'ABAC', P(A)=0.6, P(B)=0.3, P(C)=0.1, the interval [0.4572, 0.468) |
| #34 | what the stepper shows (rank(11), 8-bit blocks) and its four captions, numbered |
| #38 held-out | "my rank page", then what the stepper walks through: rank(11) on 10110100 11010010, 4 plus 2 is 6 |
| #53 held-out | "my huffman tutorial… it is short, here is all of it", then a nine-sentence tutorial quoted |

**What the reworded queries score.** Two Haiku runs of the seven ($0.08 each), one Sonnet run ($1.86), then the
whole suite on Haiku ($0.70), then one more Haiku run of the queries that had flipped ($0.08).

| Query | Haiku, old wording | Haiku, new wording, each run | A missing run with the new wording | Sonnet, new wording | Label |
| --- | --- | --- | --- | --- | --- |
| #5 | 1 of 3 | 3, 3, 3 of 3 | none | 3 of 3 | sandbox miss, fixed |
| #53 held-out | 0 of 3 | 3, 3, 3 of 3 | none | 3 of 3 | sandbox miss, fixed |
| #12 | 0 of 3 | 0, 0, 0 of 3 | no tool calls; a question written in one turn | 3 of 3 | description miss |
| #25 held-out | 0 of 3 | 0, 0, 0 of 3 | no tool calls, or one `Grep` for "0.4572"; then a new example in the same answer | 0 of 3, no tool calls | description miss, on Sonnet too |
| #38 held-out | 1 of 3 | 0, 0, 0 of 3 | no tool calls; a question written in one turn | 3 of 3 | description miss |
| #11 | 0 of 3 | 1, 1, 0, 0 of 3 | `Grep, Grep (error), Glob`; turn cap. The first `Grep` is for a quoted sentence ("Every 512th 1 bit") | 3 of 3 | sandbox miss, not fixed |
| #34 | 1 of 3 | 0, 1, 2, 2 of 3 | `Grep, Grep, Glob, Bash (error)`; turn cap. The first `Grep` is for the quoted captions | 3 of 3 | sandbox miss, not fixed; passes or fails by the run |

- **Three of the seven were description misses that the sandbox hid.** With the paragraph, the numbers or the
  stepper's steps in the prompt, Haiku stops searching on #12, #25 and #38 and answers at once without the skill,
  0 of 9 each. Their old traces looked the same as #5's and #53's. A file hunt in a trace says the run never
  reached the question; it does not say the skill would have loaded if it had.
- **Quoting the passage does not always stop the hunt.** #11 and #34 ask for an edit ("fix the flow", "rewrite
  them"), and Haiku searches for the file that holds the quoted text before it does anything else. Their wording
  stays as it is now: one rewrite was the rule.
- **#25 is a description miss on Sonnet too.** With the numbers in the prompt Sonnet makes no tool call and writes
  a new example in one turn, three times. #91 read its old misses as the sandbox's. Asking for a better running
  example does not read to either model as a request the skill covers. #25 has been Sonnet's one miss in every
  full run since.
- **Sonnet passes the other six**, 3 of 3 each. The full Sonnet suite was not run.

**The suite's Haiku should-fire rate**, the full run with the new wording: 50 of 58, should-fire 21 of 29, quiet
29 of 29, train 33 of 38, held-out 17 of 20.

| Should-fire rate on Haiku | Baseline, old wording | Final run, new wording |
| --- | --- | --- |
| All 29 queries | 20 of 29 | 21 of 29 |
| Sandbox misses set aside | 20 of 22 (seven set aside by their traces) | 21 of 26 (#4, #11 and #51 set aside) |
| Description misses | 2 (#6, #35) | 5 (#6, #12, #25, #35, #38) |

The eight misses of the final run, each labelled from its trace:

| Query | Fired | Trace | Label |
| --- | --- | --- | --- |
| #4 "the section on code-length codes in the deflate page…" (unchanged) | 1 of 3 | `Grep, Glob, Grep (error), Glob, Glob (error), Glob`; turn cap | sandbox, set aside |
| #6 | 0 of 3 | no tool calls; answered in one turn | description |
| #11 | 0 of 3 | `Grep, Grep (error), Glob`; turn cap | sandbox, set aside |
| #12 | 0 of 3 | no tool calls; answered in one turn | description |
| #25 held-out | 0 of 3 | one `Grep`, then the answer | description |
| #35 | 0 of 3 | no tool calls twice, one `Grep` then the answer once | description |
| #38 held-out | 0 of 3 | no tool calls; answered in one turn | description |
| #51 held-out "which of these posts needs work first: the three deflate pages or the token bucket one?" (unchanged) | 1 of 3 | `Glob, Grep, Grep (error), Glob, Glob (error)`; turn cap | sandbox, set aside |

So with the sandbox set aside, Haiku loads the skill on 21 of the 26 should-fire queries it can be judged on.
The 20 of 22 that the baseline's traces gave was too high: three of the seven queries it set aside were
description misses.

**What this does not show.**

- **Which unchanged queries miss is partly chance.** #4 fired 2, 1 and 0 of 3 in three runs and #51 fired 2, 1 and
  2 of 3; #1, #10 and #52 fired 2 of 3 once and 3 of 3 after. Each names a page the sandbox lacks, and every
  missing run is the file hunt. The set of sandbox misses changes from run to run, so "21 of 26" is one run's
  count. #4 and #51 passed at the baseline and were not reworded.
- **The three held-out queries that changed were reworded after their traces had been read.** The description was
  not tuned against them, and none was reworded after it was scored, but they are no longer queries nobody
  looked at. The held-out score of 17 of 20 is the same before and after, with different queries missing: #25, #38
  and #53 before, #25, #38 and #51 after.
- **The reworded queries were written by the person who read the traces**, one wording each. Another wording of
  #11 or #34 that reads less like an edit to a file might stop the hunt; that was not tried.
- **Nothing here says how to fix the five description misses.** They are planning or judgement questions (what
  order, is it worth building, which question to ask, a better example) answered from memory. The description's
  verbs are drafting, outlining, restructuring, rewriting, reviewing and grading.
- **Not run**: the full Sonnet suite with the new wording, Opus, and the old wording of the seven on Sonnet today
  (the last full Sonnet run, #242, had #25 as its one miss).

## 2026-11-18: the two `pedagogical-diagrams` review cases graded on what the skill adds, and three unsteady graders (#301)

Claude Code 2.1.318, agent and judge `claude-sonnet-5-5`, three runs per case per arm, `-j 4`. No change to the
skill or to any prompt: four grader files deleted, five rewritten (two of them renamed), one added. US$19.36 in
all: $10.96 for two runs of the whole suite on commit `1011231` (`claude plugin eval`, $5.30 and $5.67), $1.01 for
one more run of `fix-confusing-figure` on `7692c0b`, and $7.39 of re-judging saved answers with `rejudge.mjs`. No
run errored, and the skill loaded in every with-skill run (27 of 27).

**What the answers showed.** For each review case 15 saved answers were read: three with the skill from each of
the three baselines, and three without from each of the two-arm ones (#248 and #249).

- **`review-deflate-figures`.** Every answer in both arms opens with one named figure, says what a reader would
  miss, and lists the figures that work. So graders 01, 02 and 06 passed 6, 5 and 6 of 6 in each arm. The arms do
  not agree on the figure to lead with: the nine with-skill answers lead with `window` six times (the overlapping
  copy is said in the caption and not drawn), the six no-skill answers with `send-steps` five times (the densest
  figure). Four things were in the with-skill answers and mostly not in the others:
  - **Calibration.** All nine with-skill answers call their findings hypotheses about the reader or give a
    confidence. None of the six no-skill answers does: they say what they did not read or render, which is a
    statement about the method. This is the Calibration section of the skill's `review.md`.
  - **A change with each finding.** The with-skill answers end each finding with a change. The no-skill answers
    give one fix for the lead figure and a table of verdicts for the rest. Grader 05 already asks this (6 of 6
    and 2 of 6).
  - **Alignment and scale.** The with-skill answers say that the token row does not line up with the byte row,
    that two bars of unequal amounts have one width, or that the window zone covers cells not yet read. The old
    grader 04 also passed "it is 1168 units wide, so it will be small on a phone", which is how the no-skill arm
    passed it 4 of 6.
  - **The picture against its caption** (grader 03): 6 of 6 and 3 of 6.
- **`review-stepper-boundary`.** Every answer in both arms fixes the layout, gives the pointers two colours and
  a label each, and highlights what changed. Two things separate the arms:
  - **What the step text is for.** Seven of nine with-skill answers give the text the reason ("the tail stays,
    because nothing was read") and leave the move to the figure, or cut text that restates the figure (rule 7).
    All six no-skill answers rewrite the text as the operation plus the state (`enqueue(D)`: "tail 3 → 4, count
    3 → 4") and add a readout of `head`, `tail` and `count`. The old grader 03 passed both.
  - **Drawing the move.** Eight of nine with-skill answers draw an arrow from the pointer's old position to its
    new one (rule 6: draw the motion). One of six no-skill answers does; the others highlight the changed slot,
    and two add a ghost with no arrow, one of them as an option. The old grader 04 passed any mark on what
    changed.

**What changed.**

- **`review-deflate-figures`.** Graders 01, 02 and 06 are deleted. Grader 04 now asks for marks that correspond
  and are not aligned or joined, or a size or position that misleads; a remark about width on a phone, and praise
  for a figure drawn to scale, no longer pass. Grader 08 is new: the review calls its findings hypotheses, or
  says how confident it is, and saying what was not read or rendered does not pass. 03, 05 and 07 stay.
- **`review-stepper-boundary`.** Grader 02 (distinct markings and a label) is deleted. Grader 03 now asks that
  the step text give the reason and leave the move to the figure, and fails a rewrite that records the state.
  Grader 04 now asks for an arrow from the old position to the new one, and fails a highlight, a ghost with no
  arrow, and an arrow offered as optional. Both files are renamed after what they ask. 01, 05 and 06 stay.
- **`fix-confusing-figure` 06** says where the note must be (the caption, or a note on or next to the figure)
  and lists what does not pass: a "×3" on a box, a mention in the body text or "if they matter", a note offered
  as optional, a caption that says only what a greyed box means.
- **`design-lz77-figure` 05** passes either a named misreading with what prevents it, or a caption that tells
  the reader what not to read into the drawing, and lists what does not pass (a caption that only says what is
  left out, a wrong idea about the algorithm, a note on colour, the choice of example bytes).
- **`design-lz77-figure` 06** is unchanged: see below.

A new grader's name is not in a baseline, and `rejudge.mjs --rubrics` judges only the names it finds there. So
each new rubric was tried under the recorded name of a grader it replaces, from a scratch directory given to
`--rubrics`. On the saved answers, with and without the skill: `review-deflate-figures` 04 passed 9 of 9 and 1
of 6, and 08 passed 9 of 9 and 0 of 6; `review-stepper-boundary` 03 passed 7 of 9 and 0 of 6, and 04 passed 8 of
9 and 1 of 6. One of the 60 verdicts had a split vote.

**Result.** Two runs of the suite on `1011231`, made after the rubrics were fixed. Nothing was tuned to them
except one clause of `fix-confusing-figure` 06, which is said below.

| Case | With, run 1 | With, run 2 | Without, run 1 | Without, run 2 | Δ, run 1 | Δ, run 2 | Δ in #249 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `design-lz77-figure` | 1.00 | 0.95 | 0.19 | 0.19 | +0.81 | +0.76 | +0.71 |
| `fix-confusing-figure` | 0.78 | 0.89 | 0.44 | 0.28 | +0.33 | +0.61 | +0.61 |
| `review-deflate-figures` | 0.93 | 0.93 | 0.47 | 0.40 | +0.47 | +0.53 | +0.38 |
| `review-stepper-boundary` | 0.87 | 0.93 | 0.40 | 0.33 | +0.47 | +0.60 | +0.28 |
| Mean | 0.89 | 0.93 | 0.38 | 0.30 | +0.52 | +0.63 | +0.50 |

Passes of each grader of the two review cases, with the skill and without:

| Grader | With, run 1 | Without, run 1 | With, run 2 | Without, run 2 |
| --- | --- | --- | --- | --- |
| `review-deflate-figures` 03, the picture against its caption | 3 of 3 | 2 of 3 | 3 of 3 | 3 of 3 |
| `review-deflate-figures` 04, alignment and scale (rewritten) | 3 of 3 | 2 of 3 | 3 of 3 | 0 of 3 |
| `review-deflate-figures` 05, a change with each finding | 3 of 3 | 0 of 3 | 2 of 3 | 0 of 3 |
| `review-deflate-figures` 07, no claim to have seen it rendered | 3 of 3 | 3 of 3 | 3 of 3 | 3 of 3 |
| `review-deflate-figures` 08, hypotheses or a confidence (new) | 2 of 3 | 0 of 3 | 3 of 3 | 0 of 3 |
| `review-stepper-boundary` 01, the layout change comes first | 3 of 3 | 2 of 3 | 3 of 3 | 1 of 3 |
| `review-stepper-boundary` 03, the text gives the reason (rewritten) | 2 of 3 | 0 of 3 | 2 of 3 | 0 of 3 |
| `review-stepper-boundary` 04, the move drawn as an arrow (rewritten) | 2 of 3 | 0 of 3 | 3 of 3 | 0 of 3 |
| `review-stepper-boundary` 05, ranks the problems | 3 of 3 | 1 of 3 | 3 of 3 | 2 of 3 |
| `review-stepper-boundary` 06, markings stay the same | 3 of 3 | 3 of 3 | 3 of 3 | 2 of 3 |

- **Both review cases are above +0.2 in both runs, and neither needs any one grader for that.** With each grader
  left out in turn, `review-deflate-figures` is at least +0.33 in run 1 (without 05) and +0.42 in run 2 (without
  04 or 08), and `review-stepper-boundary` at least +0.42 and +0.50.
- **The four rewritten or new graders passed 20 of 24 with the skill and 2 of 24 without.** The judge split its
  votes on 2 of those 48 verdicts, and on 6 of 120 and 7 of 120 over the two runs.
- **The with-skill mean is 0.89 and 0.93**, where five earlier Sonnet-judged runs had 0.94, 0.91, 0.93, 0.94 and
  0.91. The no-skill mean is 0.38 and 0.30, where #249 had 0.42. The suite has 20 `llm` graders now, not 23, and
  the judge was $3.06 and $3.30 of the two runs.
- **A baseline is kept**: `pedagogical-diagrams/evals/baselines/2026-11-18-two-arm-301.json`, run 2 (24 answers,
  both arms), trimmed with `rejudge.mjs --trim --commit 1011231`. Its `fix-confusing-figure` 06 rubric is the
  text of that commit, one clause short of the present one.

**The three unsteady graders.** Each was judged again on saved answers: the built-in judge's verdict is in the
record, and `rejudge.mjs` gave a second and a third. Where the judgings agree and the count still moves between
runs, the answers moved.

| Grader | Old text: same verdict from the record and from `rejudge.mjs`, and split votes | New text: the same, on the two new runs | With, run 1 and 2 | Without, run 1 and 2 |
| --- | --- | --- | --- | --- |
| `fix-confusing-figure` 06 | 11 of 12, 1 split (a second pass: 11 of 12, none) | 11 of 12, none | 2 of 3, 1 of 3 | 0 of 3, 0 of 3 |
| `design-lz77-figure` 05 | 8 of 12, 3 split (a second pass: 7 of 12, 4 split) | 11 of 12, 1 split | 3 of 3, 2 of 3 | 1 of 3, 2 of 3 |
| `design-lz77-figure` 06, unchanged | 12 of 12, none | not judged again | 3 of 3, 3 of 3 | 0 of 3, 0 of 3 |

- **`fix-confusing-figure` 06 is steady as a judge and the answers are not.** With the old text the judges
  disagreed on one kind of answer: the simplification is told in the paragraph under the figure, or only as a
  "×3" on a box. One such answer got a failing 1 to 2 in the record, then 2 to 1 and 3 to 0 from `rejudge.mjs`.
  The new text names those cases. Run 2 found one more: "You can mention it in the caption" failed 1 to 2 in the
  record and passed 3 to 0 with `rejudge.mjs`. A clause for a note offered as optional was added after the two
  runs (`7692c0b`); with it the 18 answers of the two runs and of #249's baseline got no split vote, and one more
  run of the case had none either (3 of 3 with the skill, 0 of 3 without). What is left is the answers: over six
  sets of three with-skill answers the grader passed 3, 2, 1, 2, 1 and 3. The skill says "say in the caption what
  was simplified" (rule 2), and about two answers in three do it. A grader cannot steady that. No no-skill
  answer of the last four sets passed.
- **`design-lz77-figure` 05 is steadier as a judge and separates the arms weakly.** The old text did not say
  whether a caption line such as "the wrapping is only for drawing" names a misreading, and the judges split on
  it. With the new text two judgings of the 15 saved answers gave the same 15 verdicts, with one split vote in
  30. "The example bytes" was then cut from its first line, before any run, which failed one no-skill answer
  whose only note was that the letters stand for any bytes. On the two new runs the record and `rejudge.mjs`
  differ on one answer, whose caption says why the strip wraps ("so that back 12 is straight up") and not what
  the wrap must not be taken for. A clause that failed such a caption was tried on the answers of the two runs
  and dropped: it also failed an answer that every earlier judging had passed, and split the votes on another.
  The counts move because the answers do, in both arms: most designs wrap the strip at 12, and a no-skill answer
  that wraps it also tends to say how to read the rows. Over all saved answers and the two runs the new text
  passes 13 of 15 with the skill and 6 of 12 without. It is the weakest grader of its case and it is kept: the
  case is +0.83 and +0.89 without it.
- **`design-lz77-figure` 06 needed no rewording.** The record and `rejudge.mjs` gave the same verdict on all 12
  saved answers, with no split vote, and both new runs are 3 of 3 with the skill and 0 of 3 without. The 0 of 3
  and 2 of 3 of #249 were the answers: the cover-the-prose check is step 9 of the skill's checklist, and a design
  answer mentions it when it ends with what to do before shipping. Thirteen of the 15 saved or new with-skill
  answers do (the three of #249's first run were not kept). No no-skill answer does.

**What this does not show.**

- **The new rubrics were fitted to answers that had been read**, as in #249. The two suite runs are fresh
  answers, which is the check `evals.md` asks for, and they were made five minutes apart on one day.
- **The last clause of `fix-confusing-figure` 06 was written after the two runs**, for one answer of run 2. One
  run of one case stands behind it, not two.
- **`review-deflate-figures` 07 passed every answer in both arms in both runs**, and 4 of 6 without the skill
  before. It adds nothing to Δ. It is kept as a guard: the skill's procedure says to look at each figure in a
  browser, which a run in the sandbox cannot do, and the grader fails an answer that says it did. Without it the
  case is +0.58 and +0.67.
- **`review-deflate-figures` 03 passed 2 of 3 and 3 of 3 without the skill**, and
  **`review-stepper-boundary` 06 passed 3 of 3 and 2 of 3**, where 06 had passed 1 of 3 twice in #249 and carried
  the case. Neither changed here. In these runs the Δ of both cases comes from the other graders.
- **Two of the six with-skill answers failed the rewritten `review-stepper-boundary` 03, and one of them 04 as
  well.** That one marks the old position with "a faint ghost or a short trail" and no arrow. Both rewrite the
  step text as what happened ("tail advances to slot 3, count is now 3") with no reason. All three verdicts were
  3 votes to 0. The case's with-skill score is 0.87 and 0.93 for that reason, where it was 0.94.
- **Other graders moved and were not looked at.** `fix-confusing-figure` 05 passed 1 of 3 with the skill in run
  1, two of the three verdicts split, then 3 of 3 twice. `fix-confusing-figure` 04 passed 3 of 3 without the
  skill in run 1, where it passed 1, 0, 1 and 1 of 3 in the other four runs. `design-lz77-figure` 07 passed 2 of 3
  without the skill in run 1 and 0 of 3 in the three other runs.
- **`rejudge.mjs` is not the built-in judge.** On the 24 verdicts of the two reworded graders in the new runs
  the two agreed on 22. A verdict the built-in judge splits on can still go either way in a run.
- **A grader that asks for calibration, and one that asks for an arrow, take the skill's side.** A review with
  no hedge, or a stepper that marks a move with a ghost alone, can be defended. A change to the skill there
  should change the grader with it.
- **The first two baselines were graded with files that no longer exist** (`review-deflate-figures` 01, 02 and
  06, `review-stepper-boundary` 02, and the old 03 and 04 under their old names), so per-case scores before and
  after this section do not compare.

## 2026-11-18: `prompt-opus-explainers` graded on what the skill adds (#317)

Claude Code 2.1.318, agent and judge `claude-sonnet-5-5`, three runs per arm, `-j 4`. No change to the skill or
to the prompt: one grader file deleted, one rewritten and renamed, two added, so `pedagogical-writing` has 61
`llm` graders again. US$3.29 in all: $1.21 for judging saved answers with `rejudge.mjs` (48 verdicts) and $2.08
for one fresh run of the case in both arms (`claude plugin eval --case prompt-opus-explainers`, 78 s, $0.74 of it
the judge) on commit `a4a5f19`. No run errored, and the skill loaded in 3 of 3 with-skill runs.

**What the answers showed.** Twelve saved answers of the case were read, three from each arm of #299's baseline
(`2026-11-18-299-opus.json`) and three from each arm of #248's (`2026-11-18.json`). Every answer in both arms
does the four things the prompt hands it: the point goes first, a consequence replaces "This matters.", the
self-critique loop is replaced, the quoted line goes. So the four `llm` graders passed 6 of 6 in each arm, and
since #299 the regex `05-effort` passes the no-skill answers too. Three things are in the with-skill answers and
mostly not in the others, and the skill teaches each (`drafting-with-models.md`):

- **A check that the rewrite kept the content** (step 5 of the workflow, and the last paragraph of the base
  prompt). All six with-skill answers have it, as a check ("List the claims, conditions, exceptions and reasons in
  the draft before the rewrite. Then confirm the rewrite keeps all four"), as a line for the prompt ("Simplify the
  wording and the order of ideas, never the claim. Keep every number, condition and exception"), or both. No
  no-skill answer raises it: the words "condition", "exception" and "qualifier" are in none of the six.
- **The other brevity rules in the prompt** (step 1). All six with-skill answers say to search the prompt for
  "concise", "brief" and "short" and to edit in place ("Edit the conflicting rule where it sits. Don't append a
  new paragraph that contradicts it"). Five of the six no-skill answers deal with the quoted line only: delete
  it, replace it, or "scope your system prompt so the conciseness rule applies only to chat-style tasks". One
  goes further ("The rest of that conciseness block is also tuned for chat, so I'd drop it from this pipeline").
- **Listing and rewriting as two requests** (the Opus 5.5 section: "have it list the problems, then rewrite in a
  second request with the list in hand"). All six with-skill answers have a first call that returns the list
  ("Ask for the list only", "Don't rewrite") and a second that gets the draft and the list. The no-skill answers
  all move the critique to a fresh context, which the old grader 03 passed as "or similar". Three of them still
  find and rewrite in one request ("Flag each section where the point isn't in the first two sentences ...
  Rewrite those"), which is the loop the skill says fails; three separate the two ("Then pass the resulting list
  of specific problems to the revision call").

**What changed.**

- **`07-keeps-precision`, new.** It passes an instruction to keep every claim, number, condition, exception or
  qualifier while simplifying, or a check after the rewrite that they are still there. A general "be accurate",
  a request for mechanisms or numbers, and a before-and-after test of how the drafts read do not pass.
- **`06-other-brevity-rules`, new.** It passes an answer that looks beyond the quoted line for other brevity
  rules in the prompt, and says that dropping the rest of the conciseness block counts. It fails an answer that
  deals with the quoted line only, or only adds a length instruction.
- **`03-list-then-rewrite`, rewritten from `03-no-self-revision` and renamed.** It asks one thing: one request
  returns the list of problems and a later request, a person or another model rewrites with the list in hand. A
  single new request that finds and rewrites fails, fresh context or not.
- **`05-effort` is deleted.** It is a regex that passes any advice to try `high`, and how many no-skill answers
  give that advice moves from run to run: 1 of 3 in #248's answers and 3 of 3 in #299's. What differs between the
  arms every time is the reason, and that was not made a grader: see below.
- **`01-point-first`, `02-show-consequence` and `04-drops-summary-line` are unchanged and are guards.** They
  passed 12 of 12 saved answers in each arm and add nothing to Δ. They stay as the check that the answer still
  does what the prompt asks, as `fix-confusing-figure` 01 and 05 do (#249).

A new grader's name is not in a baseline, so, as in #301, each new rubric was tried under the recorded name of
another grader, from a scratch directory given to `rejudge.mjs --rubrics`. The rubrics were written before that
judging and were not changed after it, or after the fresh run.

**Result.** Passes with the skill and without. The saved answers went through `rejudge.mjs`; the fresh run is
new answers through the built-in judge.

| Grader | #299's answers | #248's answers | Fresh run |
| --- | --- | --- | --- |
| `01-point-first` (guard, unchanged) | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 |
| `02-show-consequence` (guard, unchanged) | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 |
| `03-list-then-rewrite` (rewritten) | 3 of 3, 2 of 3 | 3 of 3, 1 of 3 | 3 of 3, 0 of 3 |
| `04-drops-summary-line` (guard, unchanged) | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 | 3 of 3, 3 of 3 |
| `06-other-brevity-rules` (new) | 3 of 3, 1 of 3 | 3 of 3, 0 of 3 | 3 of 3, 2 of 3 |
| `07-keeps-precision` (new) | 3 of 3, 0 of 3 | 3 of 3, 0 of 3 | 3 of 3, 0 of 3 |

The rows for 01 and 02 on the saved answers are the record's verdicts; 04 was judged again with its own text and
got the recorded verdict on all 12.

| `prompt-opus-explainers` | With | Without | Δ |
| --- | --- | --- | --- |
| #299's record, old graders | 1.00 | 0.93 | +0.07 |
| #299's answers, new graders | 1.00 | 0.67 | +0.33 |
| #248's answers, new graders | 1.00 | 0.56 | +0.44 |
| Fresh run | 1.00 | 0.61 | +0.39 |

- **The case has a Δ of +0.39 on a fresh run**, which is what #317 asks (+0.2 or more).
- **No vote was split**: none of the 48 saved verdicts and none of the 36 fresh ones.
- **The fresh Δ does not hang on one grader.** With 03, 06 or 07 left out in turn it is +0.27, +0.40 and +0.27.
  With both 03 and 07 left out it is +0.08.
- **`07-keeps-precision` is the steady one**: 9 of 9 with the skill and 0 of 9 without over the three sets.
- **`06-other-brevity-rules` passed 2 of 3 fresh no-skill answers**, which name the block the line came from:
  "Drop the chat-tuned conciseness block for this route", "Remove the 'high-level summary' sentence and the
  generic 'keep responses brief' lines". Those answers do what the rubric asks, so the grader is right to pass
  them. Over the three sets it is 9 of 9 and 3 of 9.
- **`03-list-then-rewrite` failed all three fresh no-skill answers**, each of which gives one fresh call the
  list and the rewrite ("List every sentence that claims importance without a consequence ... Rewrite only
  those"). Over the three sets it is 9 of 9 and 3 of 9.
- **The deleted `05-effort` would have passed 3 of 3 and 1 of 3 on the fresh answers** (its pattern, run on
  them by hand). Two no-skill answers say "set it explicitly (`medium` or `high`), but don't expect it to fix
  this" and "Higher effort may help with structure", which the pattern does not match. With it the fresh Δ
  would be +0.43. It was deleted before the run and stays deleted: over three sets it passed 1, 3 and 1 of 3
  without the skill, on the wording of advice that both arms give.
- **A baseline is kept**: `pedagogical-writing/evals/baselines/2026-11-18-317-opus.json`, the fresh run (6
  answers, both arms), trimmed with `rejudge.mjs --trim --commit a4a5f19`. The case has no fixture.

**What this does not show.**

- **Three answers an arm is a small sample.** The three differences were found in 12 answers, 6 an arm, and
  confirmed on 3 more an arm, all from one model on one day. A case moves in steps of 0.06 here (6 graders, 3
  runs), and 06 went from 0 or 1 of 3 to 2 of 3 without the skill between sets. One run is not a spread.
- **The rubrics were fitted to answers that had been read.** The fresh run is the check `evals.md` asks for,
  and nothing was changed after it.
- **Half of the score is guards.** 01, 02 and 04 pass in both arms by design, so the Δ can be at most +0.50
  and the with-skill score says little: an answer that failed all three new graders would still score 0.50.
- **Why the arms differ on effort was not made a grader.** Every with-skill answer gives the skill's reason
  ("reviewers saw less padding at `high` or above"). Eight of the nine no-skill answers say the opposite and
  name Anthropic's guide for it ("Per the guide, effort doesn't reliably change visible length, so treat it as a
  quality test, not a fix for the padding"). A grader for the reason would pass the skill's claim because the
  skill makes it. Which claim is right is a question about the skill's Settings line and its sources, not
  about this case, and it was not checked here.
- **Two more differences were seen and left out.** All six saved with-skill answers give the prompt a goal
  ("after one read, the reader can ..."), and no no-skill answer does; it is the skill's base prompt, but not
  an answer to what this user asked. All six also explain the failed loop as a diagnosis that is not applied,
  where the no-skill answers say the model shares the draft's blind spots; 03 grades the step that follows from
  it, not the explanation.
- **`07-keeps-precision` and `03-list-then-rewrite` take the skill's side.** A good answer to this prompt can
  leave out the precision check, and a single fresh editing call can be defended. A change to the workflow in
  `drafting-with-models.md` should change the graders with it.
- **`rejudge.mjs` is not the built-in judge.** On this case the two agreed on the 12 verdicts of the one
  unchanged rubric that was judged again, and the fresh run went as the saved answers did for 03 and 07.
- **Only Sonnet was run**, and only this case. The other cases with graders that pass in both arms in #248's
  baseline (`review-deflate-page`, `design-rank-interactive`, the other prompt cases) were not touched.

## 2026-11-18: `pedagogical-writing`'s description names one part of a page and planning one (#319)

Claude Code 2.1.318, three runs per query unless a row says six, `--keep` on every run. #308 left five should-fire
queries that Haiku answers in one turn without the skill: #6, #12, #35, and the held-out #25 and #38. The
description changed once and was not revised. US$10.89 in all: $2.54 for five Haiku runs and $8.34 for five
Sonnet runs.

**The change.** The description's verbs were about a page or a passage of one. It now also names one part of a
page and planning one. Only #6, #12 and #35 guided the words, and none of their phrasing is copied.

| | Before (987 characters) | After (1,019 characters) |
| --- | --- | --- |
| Added | "…or technical blog page, or a passage of one, or when asked…" | "…or technical blog page, or one part of it (a passage, a prediction question, an exercise, a playground), when planning one (the order to teach in, whether an interactive is needed), or when asked…" |
| Cut to make room | "explanations whose purpose is teaching"; "Triggers on requests like"; the quoted triggers "write an explainer", "teach", "tutorial" and "review this page for clarity" | "explanations that teach"; "Triggers on"; four quoted triggers remain |

The four quoted triggers that went repeat words the "Use when" sentence already has (drafting an explainer,
tutorial, reviewing). The cuts and the addition were measured together, not one by one.

**`pedagogical-writing` on Haiku**, the whole suite, `npm run trigger-evals -- pedagogical-writing --model
claude-haiku-5-5 --keep`:

| Description | Passed | Should-fire | Quiet | Train | Held-out | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Before, #308's final run | 50 of 58 | 21 of 29 | 29 of 29 | 33 of 38 | 17 of 20 | $0.70 |
| Before, run again for this section | 52 of 58 | 23 of 29 | 29 of 29 | 34 of 38 | 18 of 20 | $0.70 |
| **After, first run** | 54 of 58 | 25 of 29 | 29 of 29 | 36 of 38 | 18 of 20 | $0.71 |
| **After, second run** | 55 of 58 | 26 of 29 | 29 of 29 | 36 of 38 | 19 of 20 | $0.70 |

No quiet query fired in any run of any of the three new Haiku runs (0 of 87 runs each). The two "before" rows
differ in the sandbox misses alone: #11 and #51 passed in the second and missed in #308's.

| Query | Before, #308's runs | Before, today | After, first run | After, second run | A missing run after the change |
| --- | --- | --- | --- | --- | --- |
| #6 (what order to introduce things in) | 0 of 3 | 0 of 3 | 3 of 3 | 3 of 3 | none |
| #12 (a question for the reader to predict) | 0, 0, 0 of 3 | 0 of 3 | 2 of 3 | 2 of 3 | no tool calls; the question written in one turn |
| #35 (whether to build a playground) | 0 of 3 | 0 of 3 | 0 of 3 | 0 of 3 | no tool calls, or one `Grep`; "Build it, but keep it small" in one turn |
| #25 held-out | 0, 0, 0 of 3 | 0 of 3 | 0 of 3 | 1 of 3 | no tool calls, or one `Grep`, then the answer |
| #38 held-out | 0, 0, 0 of 3 | 0 of 3 | 0 of 3 | 2 of 3 | no tool calls; answered in one turn |
| #4 (sandbox) | 1 of 3 | 1 of 3 | 2 of 3 | 3 of 3 | the file hunt |
| #11 (sandbox) | 0 of 3 | 2 of 3 | 1 of 3 | 1 of 3 | the file hunt, to the turn cap |

- **Two of the three train queries now pass in both runs**: #6 at 3 of 3 and #12 at 2 of 3, each 0 of 3 in every
  run before. That is the rise from 23 to 25. The 26th in the second run is the held-out #38.
- **#35 did not move**: 0 of 6. "Whether an interactive is needed" does not make Haiku load the skill for a
  question of whether to build one. It answers the question from memory. It stays a description miss on Haiku.
- **The held-out pair moved in one run of two.** #38 fired 0 and then 2 of 3, #25 0 and then 1 of 3, against 0 of
  3 in every run before. One 3-run result is not a pass or a miss, so this shows the change does not over-fit the
  three train queries, not that the held-out pair is fixed.
- **The only other miss is #11**, the file hunt #308 labelled as the sandbox's.

**`pedagogical-writing` on Sonnet**, the 29 quiet queries and the five description misses (`--only` with those 34
positions, $6.73). The should-fire queries Sonnet already passed were not run again.

| Queries | Before | After |
| --- | --- | --- |
| Quiet, 29 | 29 of 29 in every full run on record (#242 the last) | 29 of 29 |
| #6, #12, #35 | 3 of 3 each (#12 in #308, the others in #242's full run) | 3 of 3 each |
| #38 held-out | 3 of 3 (#308) | 3 of 3 |
| #25 held-out | 0 of 3 (#308) | 0 of 3, no tool calls |

- **One quiet run in 87 loaded the skill.** On #32 ("…should I use an animation, a stepper or one static
  figure?") one run of three called `pedagogical-diagrams` and then `pedagogical-writing`. The query passes, since
  two runs stayed quiet. #32 was then run six times with each description ($0.29 and $0.31): 0 of 6 before and 0 of
  6 after. So it is 1 run of 9 after against 0 of 6 before, and the diagram skill loaded first in that one run.
  "Whether an interactive is needed" is the likely cue; one run does not establish it.
- **#25 is still Sonnet's one miss**, as in every run since #91.

**The neighbours.** `pedagogical-diagrams` on Haiku, the whole suite with each description (a clone of the
commit before the change gave the "before" run):

| Description | Passed | Should-fire | Quiet | Cost |
| --- | --- | --- | --- | --- |
| Before | 18 of 24 | 8 of 14 | 10 of 10 | $0.21 |
| After | 19 of 24 | 9 of 14 | 10 of 10 | $0.23 |

#4 and #12 passed after and missed before; #10 (held-out) passed before and missed after, and its three missing
runs are the file hunt to the turn cap with no `Skill` call, so nothing took it. On Sonnet with the new
description, the two diagram queries nearest the new words (#4, how many frames a stepper has, and #9, animation,
stepper or static figure) loaded `pedagogical-diagrams` 3 of 3 each ($0.39), and the two `anatomy` queries that
say "interactive" (#1 and the held-out #21) loaded `anatomy` 3 of 3 each ($0.62).

**What this does not show.**

- **The full Sonnet suites were not run** ($16 for this skill's 58 queries, $6.50 for `pedagogical-diagrams`).
  Sonnet's should-fire queries other than the five were not measured with the new description, nor were the
  quiet queries of `pedagogical-diagrams`, `anatomy`, `skill-authoring` or `advisors` on Sonnet. #233 found a
  neighbour's quiet query changed by a description edit only in a full Sonnet run.
- **Which part of the edit did the work.** The addition and the cuts went in together.
- **Whether the held-out queries are still unseen.** #308 quoted #25 and #38 in this file, so the author of the
  change had read them. The words came from the three train queries and the skill's own sections; "example" was
  left out of the list of parts for that reason, since only #25 asks for one.
- **#11 and #34** still hunt for the quoted text and pass or fail by the run, as #308 left them.
- **Output evals were not run**: the body did not change.

## 2026-11-18: `pedagogical-writing`'s effort line reworded: the padding claim had no source (#332)

#317 found that every with-skill answer of `prompt-opus-explainers` repeats the Settings line of
`drafting-with-models.md` ("draft at `high` or above, where reviewers saw less padding"), and that eight of nine
no-skill answers say the opposite and cite Anthropic's guide. The line was checked against its sources on
2026-11-18. **It was reworded, not kept or removed.**

**What the sources say.**

- **Every's Vibe Check on Opus 5.5**, the review the line came from (#150), was read for its writing section. It
  says "use Opus 5.5 to draft at high effort or above, and give it your own examples", in the paragraph that
  reports 37 to 39 sentences against the reviewer's 21. It does not say at what effort those drafts were made,
  and it compares no padding across effort levels. Its one comparison of levels is about 3D scenes ("extra-high
  adds detail ... without the excess of Opus 5"). So the advice to draft at `high` has a source; "where reviewers
  saw less padding" does not.
- **Anthropic's [Effort](https://platform.claude.com/docs/en/build-with-claude/effort) page**: on Opus 5,
  "Effort controls thinking volume, not visible response length ... changing effort does not reliably shorten
  responses, so prompt for length instead"; on Fable 5.2, "Effort barely changes how long the model's replies
  are, so use your prompt to change reply length and tone". Its Opus 5.5 entry says nothing about length. The
  same page also says effort "affects all tokens in the response", text included, so it is not a claim that
  effort has no effect on the reply.
- **[Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)**:
  its "Calibrate effort" section is about thinking, latency and cost, and says nothing about reply length.
  [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
  has the Opus 5 exception ("raising or lowering effort does not reliably change visible response length").
- **What the no-skill answers cite.** Their wording ("Per the guide, effort doesn't reliably change visible
  length") matches the Opus 5 lines above. None of the nine names the model the guide says it for, and the guide
  does not say it for Opus 5.5.

**What changed.** The Settings line now says the default and that thinking cannot be turned off, that Every's
reviewers advise `high` or above without comparing padding across levels, that Anthropic says effort barely
changes visible length for Opus 5 and Fable 5.2 but not for Opus 5.5, and so to cut padding with the prompt and
treat `high` as a quality setting to test. The sources table gains the Effort page, and Every's row names the
passage that was read.

**One run of the case, with the skill only.** Claude Code 2.1.318, agent and judge `claude-sonnet-5-5`, three
runs, `--ablation none`, `--case prompt-opus-explainers`, US$0.97 in all. No run errored, and the skill loaded in
3 of 3. All three answers give the new reason: "Don't expect it to fix padding, because Anthropic says effort
barely changes visible reply length. That statement covers other models, and nothing is documented for Opus
5.5." None repeats "reviewers saw less padding". The graders went as in #317's fresh run except
`07-keeps-precision`, which failed one answer of three (all three votes): that answer has no check that the
rewrite kept the claims. The Settings line has nothing to do with that check, so it is run-to-run variation, which
#317's 9 of 9 did not show.

**What this does not show.**

- **Whether `high` drafts less padding on Opus 5.5.** No source measured it, and neither did this change. The
  line now says so instead of claiming it.
- **The no-skill arm was not run.** It was not changed, and nine saved answers of it were read in #317.
- **No grader checks the reason**, for the reason #317 gave: it would pass the skill's own wording. The case's
  score did not depend on the line before or after.

## 2026-11-19: teaching moves from Sam Rose's posts in `pedagogical-writing` and `pedagogical-diagrams` (#357)

Nine of Sam Rose's posts were read for moves the two skills lacked; three were also driven in a headless
browser, because a text extract hides the reader character (Haskie) entirely. Claude Code 2.1.318, agent and
judge `claude-sonnet-5-5`, three runs per arm.

**Measured before writing.** Two new cases, written from the gaps and run against `origin/main`'s skills, both
arms: `draft-bloom-interactive-section` (with 0.25, without 0.33) and `design-bloom-bit-array` (0.33 and 0.33).
Per grader, with the skill: the reader's voice twice 0/3, a confusing demo state named 2/3, a goal with an end
state 1/3, retrieval or a real-system check 0/3; the figure's marks in the prose 0/3, the figure's artefacts named
3/3, good and bad shown before judging 0/3.

- **One grader was wrong, not the skill.** `01-prose-uses-figure-marks` said hover links do not count, but this
  repo's `data-ref` draws the part's colour swatch inline before the phrase, permanently. The with-skill answers
  used it. Re-judged with the corrected rubric (`rejudge.mjs --rubrics`, US$0.42): with 3/3, without 0/3. So no
  rule was added for inline marks; the case keeps the grader as a guard.
- **The figure's artefacts were already named** (3/3 with the skill), so no diagrams rule was added for them.

**After the edits, with the skill only.**

| Case | Before | After |
| --- | --- | --- |
| `draft-bloom-interactive-section` | 0.25 | 1.00 (4 of 4 graders, 3 of 3 runs) |
| `design-bloom-bit-array` | 0.33 | 0.75 (main's skill on the same day: 0.58) |

- **The reader's voice took two rounds.** With the rule in SKILL.md and moves.md alone, answers voiced Ducky once.
  A drafting-checklist step (a stall list, each item a Ducky line) raised that to 2 or 3 per answer, but the judge
  still failed them: the demo's odd states were explained in the author's voice, not asked by Ducky (the reasons,
  from `rejudge.mjs --out`, say so in all three). One sentence tying "what is not a bug" to Ducky made it 3/3.
- **`good-and-bad-first` passed 1 of 3** with rule 11; the other two answers show only a healthy state before the
  reader judges.

**The other cases.** Both full suites, with the skill only, US$12.75 and US$3.38. `pedagogical-writing`'s old
cases scored at or above the 2026-11-18 baseline except `design-rank-interactive` (0.95 to 0.92) and
`review-deflate-page` (1.00 to 0.94); that baseline predates #299's grader fixes, so the gains are not this change's.
`pedagogical-diagrams` was compared on the same day with `origin/main`'s skill in a snapshot: `design-lz77-figure`
+0.04, `fix-confusing-figure` 0.00, `review-deflate-figures` −0.06, `review-stepper-boundary` −0.11, mixed signs
and each under the 0.2 noise rule, at equal cost.

**Grader calibration** after rewording `reader-checks` and `companion-voice`: 186 of 198 verdicts agree (94%),
42 of 45 on the reference's misses (93%), the same verdict every run on 62 of 66 (94%), and every broken copy fails
exactly its broken criteria. US$5.45. The new `reader-voice` script check warns on all four teaching pages it was
tried on (0 or 1 places voice the reader), which is the gap the rule names; it is a warning, not counted.

**What this does not show.**

- **The without arm after the edits** was run only for the two new cases, at the first round of edits (writing
  0.33, as before; diagrams 0.22 with the corrected grader), so the suites' Δ was not re-measured.
- **The full writing suite was not re-run after the last one-sentence edit**; only the new case was.
- **Readers.** These are drafts judged by a model, not pages read by people. Whether Ducky's questions help a
  reader is what the deep-question research suggests (sources.md), not what was measured here.

## 2026-11-20: a prediction must not be answered before it is asked (#368)

The gap was found in published pages, not in an eval. Of the 16 `details.predict` questions on listed public
pages, 5 were answered above the question, 4 of them by the TL;DR's common-mistake bullet: the bullet and the
prediction are both built around the page's main misconception, so they say the same thing. The reworded
`reader-checks` judge later found 2 more that this audit had missed or rated as only partly answered:
`how-deflate-sends-its-code` (`#canonical` had already answered it) and token-bucket's timeline in view just below
the closed fold. Claude Code 2.1.318, agent and judge `claude-sonnet-5-5`, three runs per arm.

**The new case, `review-spoiled-prediction`:** a review of token-bucket with its TL;DR bullet put back as it was at
`b813972` (the first four rows); after review the fixture pins the page at its calibration reference's `14c6d15`
with `calibrate.mjs --materialize`, as `grade-token-bucket-page` does (the last two rows). Grader 01 asks whether the review says the TL;DR answers the fixed-window prediction.

| Skill | Grader 01 | Case score (indicator excluded) | Cost |
| --- | --- | --- | --- |
| none | 0/3 | 0.50 | $0.49 |
| `origin/main` (snapshot) | 2/3 | 0.83 | $1.37 |
| this change, first wording | 3/3 | 1.00 | $1.02 |
| this change, final wording | 3/3 | 1.00 | $0.95 |
| this change, after review; page pinned at `14c6d15` | 3/3 | 1.00 | $1.81 both arms |
| none, same pinned page | 1/3 | 0.67 | (in the row above) |

- **In review, the old skill mostly caught it already.** 0.83 against 1.00 on one case is under the 0.2 noise rule.
  The run without the skill calls the fixed-window question "This one works". The old skill's failing run praised it
  too. The runs with the new rule lead with the spoiler, quote the bullet, and propose the fix this branch made.
- **The gap is in drafting.** Pages written with the skill shipped with these spoilers, and no drafting case
  measures it. The rule went in anyway, because 5 of 16 published predictions is the measurement.

**The grader against the edited pages.** `grade.mjs --only reader-checks --runs 3` on each page after its first fix:
token-bucket and pedagogical-writing met; announcing-patchcov and visibility-threat-model not met 3/3. Their reasons
were right. Asking "how far" did not help, because the TL;DR's "barely move the total" is the answer. The threat model's TL;DR
states both facts on purpose. After the second fix, all five edited pages are met 3/3 (about $0.09 per page). The
rule now says that a size counts as left out only if the TL;DR gives no hint of it, and that a reference page's
stated fact is prose, not a prediction.

**Calibration**, the full run with the criterion's final text (it ran after the below-the-fold clause was added): 185 of 198 verdicts agree (93%; #357 had 186), 42 of 45 on
the reference's misses, the same verdict every run on 62 of 66, and the broken copy failed exactly its broken criteria
on 3 of 3 runs. US$6.03. Then `reader-checks` alone on the five reference pages: four met, as referenced, and
`how-deflate-sends-its-code` not met 3/3. Its reference moves from met to not met, marked `revised`, because the judge
was right (see above). With that revision the criterion agrees on all five. The second round of fixes changed
SKILL.md, moves.md and `grading.md`'s worked example, which judges are not shown, but not the criterion text, so the
full calibration was not re-run.

**What this does not show.**

- **Drafting.** No case asks the skill to draft a TL;DR and a prediction together, which is where the spoilers came
  from. A drafting case is the next measurement.
- **Readers.** As with every number here, these are model judges, not people (#371).

