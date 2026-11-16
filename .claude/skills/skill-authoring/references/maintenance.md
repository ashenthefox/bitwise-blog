# Maintaining a skill

A shipped skill goes stale in four ways: the models change, the files it describes change,
a neighbouring skill changes, or it stops earning its context. Check each on a schedule
instead of waiting for someone to notice.

## Contents

- Re-run on every change
- The full run
- Read transcripts after real use
- Claude stops following a skill
- Context cost
- Portability
- Retire, merge or split
- Old patterns

## Re-run on every change

- Any edit to `SKILL.md`, a reference or a script: run the lint, the output evals and, if
  the description or a neighbour's description changed, the trigger evals.
- A new skill in the repo or in the user's configuration: re-run the trigger evals of the
  skills closest to it, since a new description can take their prompts.
- A new model: re-run both suites on it. A rule written for a weaker model may now be dead
  weight, and a case that scored `Δ ≈ 0` may now be one the skill no longer needs. The
  [full run](#the-full-run) is the way to check every skill after the model or Claude Code
  changed under skills that nobody edited. Start it yourself: nothing runs it for you.
- Record the date, models, command and scores in the PR or the commit. A score without those
  cannot be compared next time.
- To show that an edit helped, and not only that the skill helps, compare against the
  previous version of the skill, not just the no-skill baseline
  ([evals](evals.md#comparing-with-the-previous-version)).

## The full run

A model or Claude Code update can change how a skill triggers with no change in the repo, and
the evals above only run when someone edits a skill. `npm run skill-evals`
(`scripts/skill-evals.mts`) runs both kinds for every skill with evals and compares the pass
rates with the last full run. It calls `run-trigger-evals.mjs --json` and
`claude plugin eval --json` and reads what they write.

**It runs only when you start it.** It used to be a monthly workflow. It is not now, for two
reasons: a full run costs US$40 to $60, and the scores move between runs of an unchanged skill
by more than the tolerance (the four `pedagogical-diagrams` cases averaged 0.89, 0.75 and 0.66
on three days with no change; #237), so a schedule would pay that every month to fail on noise.
Run it after a model or Claude Code update, or when a skill seems to have stopped loading.

- **On your machine:** `npm run skill-evals -- --skills <name> --kind trigger --out <dir>
  --max-cost-usd 15`, on your own login. Leave out `--skills` for every skill, and add
  `--previous <record.json>` to compare with an earlier record.
- **On GitHub:** the Actions tab → Skill evals → Run workflow, or
  `gh workflow run skill-evals.yml -f skills=<name> -f kind=trigger -f max_cost_usd=15`. It
  needs the secret `ANTHROPIC_API_KEY` (the workflow's header lists the set-up) and finds the
  previous full run's record by itself. Only people with write access can start it.

- **What it records.** `record.json` (format `bh-skill-evals/1`) holds the date, commit, Claude
  Code version, agent and judge models, cost, and per skill the trigger pass counts and per-query
  status and each output case's score with and without the skill. `summary.md` tables the pass
  rates beside the previous run's and is also shown on the run's page. The workflow uploads
  `summary.md` and `baseline.json` as the artifact `skill-evals-record` (kept 90 days, the most a
  public repository allows). The raw results are not uploaded: they hold model output.
- **`baseline.json` is `record.json` of a run that can be compared with.** The script writes it only
  for a run of every skill and both kinds with no error. A run of one skill (a dispatch with
  `skills` set) or one that errored is a record but not a baseline: it would hide every other
  skill's drop until the next full run, or lower the bar.
- **What fails the run.** A skill whose trigger pass rate, or mean output score with the skill,
  fell by more than 0.10 against the baseline (exit 1); a run that measured nothing, such as a case
  that failed to load, a `scaffold failed` row, a partial result or a spent cost ceiling, or trigger
  queries that errored again after a retry (exit 2, which wins over a regression). The script runs
  the errored trigger queries once more before giving up on them; output evals are not retried, so
  re-run the workflow. Flipped queries, moved cases and changes of model or Claude Code version
  are listed in the summary and never fail the run.
- **A regression alerts once.** The run that regressed is complete, so it is the next baseline and
  the new level stops failing. Read the trend in the summaries, because a slow decline of less than
  0.10 a run never fails.
- **The artifact lasts 90 days.** A full run on GitHub more than 90 days after the last one finds no
  baseline and only records a new one. Keep `baseline.json` yourself if you run it less often.
- **Reading a drop.** The summary names both runs' versions and models. If only Claude Code changed,
  suspect its skill listing or system prompt; if only the model changed, run the trigger evals
  on the new model by hand with `--keep` and read the traces. The 0.10 tolerance is a starting
  value (`DEFAULT_TOLERANCE`), and #237 suggests it is too tight for the output cases.
- **Cost.** About US$0.27 per trigger query with Sonnet (about US$40 for the 147 queries in the
  five skills; `pedagogical-writing`'s 48 alone are about US$13) plus a few US dollars per output
  suite, so roughly US$40 to $60 for everything, stopped at a hard ceiling (default US$75). The
  trigger evals are most of that. A trigger suite on Haiku costs about a twentieth as much and
  answers a different question: whether the smallest model loads the skill. Always give a run of
  your own `--max-cost-usd`.

## Read transcripts after real use

Scores say whether; transcripts say why. After a skill has been used for real work, read
two or three runs for:

- steps skipped, or done in a different order from the skill's;
- references never opened (unneeded, or badly signposted), or the same one opened every run
  (move it into `SKILL.md`);
- a helper script written again and again (bundle it);
- the user's corrections, which name rules the skill lacks.

Turn each finding into an eval case first, then change the skill.

## Claude stops following a skill

Three different causes, three different fixes (from the Claude Code docs):

- **A rule that must hold every time was skipped.** Prose cannot guarantee it: move it to a
  hook or a repo check.
- **Guidance that needs judgment was skipped.** Word it so it covers the whole task ("run the
  tests after every edit", not "run the tests"). The skill's text is added to the
  conversation once, when it is invoked; it is not re-read on later turns.
- **After compaction.** Claude Code re-attaches the most recent invocation of each skill,
  keeping the first 5,000 tokens of each, within a shared 25,000-token budget filled from the
  most recently invoked skill. Older skills can be dropped. Put the rules that must survive at
  the top; invoke the skill again to restore it.

## Context cost

Every skill's name and description are always in context.

- The listing is capped by a budget of 1% of the context window; when it overflows, the
  descriptions of the least-used skills are dropped first, which removes the keywords that
  let them match. The budget is the `skillListingBudgetFraction` setting.
- `/context` shows the Skills row (the listing after the budget); `/doctor` estimates the
  listing's cost and biggest contributors; `/skill-doctor` reports each skill's cost, its
  recent use, and skills that have never been invoked. `/skill-doctor` is a usage report, not
  a linter. `claude plugin validate <path>` checks structure.
- Each entry's `description` + `when_to_use` is truncated at 1,536 characters in the listing
  (the cap is the `skillListingMaxDescChars` setting). Trim a description that is longer
  than the triggering needs, and put the key use case first.
- To keep a rarely used skill listed without paying for its description, set it to
  `"name-only"` in `skillOverrides` (settings); `"off"` hides it and `"user-invocable-only"`
  keeps it for `/skill-name` alone. This changes how the skill triggers, so re-run its trigger
  evals if it stays enabled for Claude.

## Portability

Check on each change, and when adopting a new host:

- the lint's cross-surface warnings;
- paths relative to the skill directory, not the repo root;
- the 1,024-character description limit, which pi enforces;
- the API: no network, no runtime package installs, `name` and `description` only;
- that evals do not depend on Claude Code: `evals/` is plain files, and pi ignores it. pi
  0.84.4's skill discovery was checked over RPC; a skill running in pi was not
  ([sources](sources.md)). To check discovery yourself: `printf '%s\n'
  '{"type":"get_commands"}' | pi --mode rpc --approve --no-session` from the repo root lists
  every skill pi loaded, with its path, before any model call.

## Retire, merge or split

- **Retire** a skill that `/skill-doctor` shows never invoked over a month, or whose cases
  all score `Δ ≈ 0` on the current model: Claude does it unaided.
- **Merge** two skills whose trigger evals keep stealing each other's prompts, or that are
  always loaded together.
- **Split** a skill whose body has two audiences: a reference file that only half of the
  tasks read is a separate skill waiting to happen. Do it when the trigger evals can tell
  the two halves apart.
- When retiring, say so in the commit and remove the skill's name from neighbours' "Not for"
  lists.

## Old patterns

Do not date guidance inline ("before August 2026, use X"). Keep the current method in the
main text and put the superseded one in a collapsed section so the history stays without
costing attention:

```markdown
## Old patterns

<details>
<summary>The v1 method (superseded 2026-10)</summary>
…
</details>
```
