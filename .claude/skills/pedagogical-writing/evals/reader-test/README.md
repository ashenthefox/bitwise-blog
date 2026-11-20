# Reader test: does a higher-scoring page teach more?

Every gain this skill has measured is a model judging a model (#371). This is the protocol for checking one
claim against people: that the version of a page the skill produced teaches more than the version before
it. It is written for the author to run; nothing here has been run yet.

## The pair

`docs/token-bucket-rate-limiting.html`, about 1,900 words, so a reader finishes in 10 to 15 minutes.

| Version | How to get it | What it is |
| --- | --- | --- |
| A, before | `node <skill-dir>/scripts/calibrate.mjs --materialize token-bucket-rate-limiting@974536b <dir>` | Opens on the mental model, then mechanism, simulation, parameters, implementation, gotchas |
| B, after | the page on `main` (or `--materialize token-bucket-rate-limiting` for the graded copy) | Opens on the need (two clients), then a fixed-window try and its seam crack, a sliding log and its memory crack, then the bucket |

Grade both with `grade.mjs` (three runs) first and record the two scorecards beside the results, so the
reader scores can be set against the criteria that moved.

## Readers

- 6 to 10 people who build software but have never built a rate limiter: the page's target reader. Someone
  who has built one will answer from memory and measure nothing.
- Assign A or B at random (a coin, or alternate down a shuffled list), half each. Each reader sees one
  version only.
- Read once, at their own pace, then close the page. Answer the questions without it. Note how long the
  reading took.

## Questions

Four transfer questions the page does not answer word for word, then two retention questions. Ask them in
this order; do not show the scoring notes.

1. A bucket has b = 20 and r = 5 tokens a second and is full. A client sends 50 requests at once. How many
   are admitted, and how long until it can send 10 more at once?
   *Score: 2 for "20 admitted, about 2 seconds"; 1 for one of the two; 0 otherwise.*
2. A dashboard fires 25 calls in parallel every 30 seconds, and you must hold every client to 10 requests a
   second on average. What b and r would you choose, and why?
   *Score: 2 for b of at least 25 and r = 10, with the reason that b is the burst and r the average; 1 for
   the right numbers without the reason, or the reason with one number wrong; 0 otherwise.*
3. A client sends exactly 1 request a second, forever, to a bucket with b = 10 and r = 1. Is any request
   ever refused? What changes if it sends 2 a second?
   *Score: 2 for "none refused; at 2 a second the first 10 or so go through, then about half are refused";
   1 for the first half only; 0 otherwise.*
4. Two servers each keep their own bucket with r = 10 for the same client, behind a load balancer that
   alternates between them. What rate does the client actually get, and how would you fix it?
   *Score: 2 for "up to 20 a second; share one bucket, e.g. in a central store with an atomic update"; 1 for
   the rate or the fix; 0 otherwise. Both versions say the distributed version moves the arithmetic into
   Redis so the update is atomic; neither works this case.*
5. Why does a token bucket need no timer to refill it?
   *Score: 2 for "it works out the tokens owed from the time since the last request, capped at b"; 1 for
   "it computes them when a request arrives" without the cap; 0 otherwise.*
6. What goes wrong with counting requests in fixed one-second windows?
   *Score: 2 for "a burst at the end of one window and the start of the next gets twice the limit through";
   1 for "bursts get through at the boundary" without the size; 0 otherwise.*

Questions 1 to 4 test whether the reader can use the model; 5 and 6 whether they kept it. Version B teaches
6 as a crack in its main line; version A has it only as a table row ("Up to 2× at edges"), so read 6 as a
check of the build-up, not as a fair contest.
If you can, ask questions 1 to 4 again two days later: retention over days is where rereading and real
understanding part company (Roediger & Karpicke, 2006, in sources.md).

## Recording

Add a dated entry to `skill-authoring`'s `references/measurements.md`: the two scorecards, each reader's
version, reading time and score per question, and the totals for A and B. With 6 to 10 readers, a
difference of a point or two per reader is noise; report it as a direction. Where the readers and the
grader disagree (the grader prefers B but readers do no better), reword the criterion that moved, as
grading.md says: reword, never shift.

## The author's grades

Separately from readers, the calibration references need a human check (grading.md, "Calibration"):

```bash
node <skill-dir>/scripts/author-sheet.mjs --write <dir>        # pages and blank sheets, no verdicts shown
# grade each <dir>/<name>.grades.json from references/grading.md, without opening evals/calibration/
node <skill-dir>/scripts/author-sheet.mjs --compare <dir>      # agreement, and on the references' misses
```

For each disagreement, decide who is right. If the reference is wrong, change its verdict and mark it
`revised`; if the author's reading shows the criterion is ambiguous, reword the criterion. Then add
`"confirmed": "<date>, by the author"` to each reference checked, and record the agreement numbers in
measurements.md.
