# Announcing patchcov

Your CI says coverage is 87.3%. Yesterday it was 87.4%. A pull request that touched 140 lines in your payment code merged in between. How many of those 140 lines does a test execute?

The headline number can't say. It averages the whole repository, so a large, well-tested codebase absorbs a small untested change without moving. What you want to know is narrower: **of the lines this change added or modified, which ones did the tests never run?**

That figure is *patch coverage*. **patchcov** computes it from a git diff and a coverage report, and it works as a command line tool and as a GitHub Action. It gives a precise answer, lets you gate a build on it, and needs no external service.

## The problem with project-wide coverage

Project-level coverage is a fine trend line, but it's a poor review tool, for three reasons.

**It's diluted.** In a 50,000-line project, a 100-line untested change moves the total by about 0.2 percentage points. Rounding, flaky tests and unrelated refactors all produce movement of that size, so a threshold on the total either never fires or fires on noise.

**It's blamed on the wrong thing.** If the total drops, you don't know whether this change caused it. The cause could be a deleted test, a newly instrumented module, or a changed build flag. The reviewer has to work out which.

**It's not actionable.** "Coverage decreased by 0.3%" doesn't tell the author where to add a test. "Lines 88–94 of `src/refund.rs` were added and never executed" does.

Patch coverage fixes all three by restricting the question to the lines the change actually touched. It's a small set, the author owns it, and each uncovered line can be named.

## Why not just use a service?

Hosted coverage services do compute patch coverage, and many teams use them happily. But there are real costs, and some of them showed up often enough to motivate this tool:

- **A service in the gating path.** If your merge gate depends on a third-party API, then its outages, rate limits and upload delays become your CI flakes. A required check that is "pending" because an upload hasn't been processed is a particular kind of annoyance.
- **Tokens and permissions.** Uploading coverage means distributing a secret, and fork pull requests usually can't see secrets, so the one place you most want a check is where it's hardest to run.
- **Your source and coverage data leave the building.** For private or regulated code, that can be a non-starter.
- **Opaque calculation.** When the service's number disagrees with your local run, you can't easily find out why. Different tools disagree about base commits, whitespace and how to treat unreachable lines.

patchcov takes the opposite approach. It's a single binary that reads two local inputs, a diff and a coverage report, and prints a result. Nothing is uploaded. It has no account and no token, and the run gives the same answer on your laptop as in CI because the inputs are the same.

## How it works

The idea is simple, and the details are where the care goes.

1. **Parse the diff.** patchcov runs (or reads) a unified diff between a base and a head and extracts, for each file, the set of *added or modified lines in the new version of the file*. Deleted lines don't exist in the new tree, so they can't be covered or uncovered, and they are ignored.
2. **Parse the coverage report.** It reads a coverage report in a standard format (LCOV is the common denominator, since most toolchains can emit it) and builds, per file, a map of line number to hit count.
3. **Intersect.** For each changed line, there are three cases:
   - the report says it's *executable and hit* (covered),
   - the report says it's *executable and never hit* (uncovered),
   - the report has *no entry* for it (not executable: a comment, a blank line, a closing brace, a type declaration).
4. **Report.** Patch coverage is `covered / (covered + uncovered)`. Lines in the third case are excluded from both numerator and denominator.

That last point is the one many quick scripts get wrong. If you count every changed line as a candidate, then a pull request that adds a long doc comment will show poor coverage because comments can't be executed. Only lines the coverage tool considers instrumentable count. That's the same judgment your coverage tool already makes for the project-wide number, so the two figures stay consistent.

## Using the command

Generate coverage as you normally would, then ask what the change left untested:

```sh
# 1. Run your tests with coverage and emit LCOV (use your toolchain's way)
#    e.g. cargo llvm-cov --lcov --output-path lcov.info
#         pytest --cov --cov-report=lcov:lcov.info
#         go test -coverprofile=... then convert to lcov

# 2. Compare against the merge base with main
patchcov --lcov lcov.info --base origin/main
```

The output is meant to be read by a person first:

```text
patchcov: 140 changed lines, 112 executable, 97 covered (86.6%)

src/refund.rs
  88-94   not covered   (7 lines)
  131     not covered

src/ledger/mod.rs
  all 41 executable changed lines covered

2 files with uncovered changes
```

Each uncovered range is reported by file and line number, so you can jump straight to it. Files with no uncovered changes collapse to one line, which keeps the output short enough to read on a large pull request.

Because it's a command, it fits wherever you can run a command. It works in a pre-push hook, in a Makefile target, and in the terminal while you're still deciding whether the branch is ready for review. Running it before you open the pull request is the cheapest use: you find the gap before anyone else does.

### Choosing the base

The base matters more than it looks. patchcov defaults to the **merge base** of your base ref and `HEAD`, the equivalent of `git diff origin/main...HEAD`, not a plain two-dot diff against the tip of `main`. The difference is real. If `main` has moved on since you branched, a two-dot diff includes *other people's* changes in reverse, and you'd be held accountable for lines you never touched. The merge-base comparison asks only about what your branch introduced.

If you'd rather pipe your own diff, for instance to check a single commit or a range you've constructed, patchcov can read one from a file or standard input instead of computing it.

## Gating a build

A report is useful, and a gate is better, because it turns "we should add tests" into something CI enforces. patchcov exits non-zero when patch coverage falls below a threshold you set:

```sh
patchcov --lcov lcov.info --base origin/main --fail-under 80
```

A few notes on using thresholds well:

- **Set it on the patch, not the project.** Because the denominator is only the lines in the change, a threshold of 80% means what it says. A five-line fix with one untested line is 80%, a five-hundred-line feature with one hundred untested lines is 80%, and neither can hide behind the rest of the repository.
- **Small patches are noisy.** A one-line change with one uncovered line is 0%, which is accurate and also unhelpful if the line is a log statement. Decide how you want to treat tiny changes, and consider a minimum-size floor below which the gate just reports rather than fails.
- **Ratchet gradually.** If your project's current coverage is low, start with a modest threshold on new code and raise it over time. Patch coverage lets you stop the decline immediately without demanding a backfill of the whole history first.
- **Keep an escape hatch.** Some code is legitimately hard to test: platform-specific branches, defensive panics, generated code. Use your coverage tool's own exclusion markers for these, so the exclusion is visible in the source and applies equally to project and patch figures.

## The GitHub Action

For GitHub-hosted projects, the Action wraps the same engine so the common case takes a few lines of workflow:

```yaml
name: coverage
on: pull_request

jobs:
  patch-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # patchcov needs history to find the merge base

      # ... build and run your tests, producing lcov.info ...

      - uses: patchcov/patchcov-action@v1
        with:
          lcov: lcov.info
          fail-under: 80
```

The `fetch-depth: 0` line is the most common stumbling block. A shallow clone has no merge base to find, so the diff can't be computed correctly. If you'd rather not fetch full history, fetching just enough of the base branch also works, as long as the merge base is reachable.

The Action reports in the places reviewers already look:

- **Job summary.** The same table you'd see locally, rendered on the run page.
- **Annotations.** Uncovered changed lines are marked inline in the "Files changed" view, so the feedback appears next to the code rather than in a separate dashboard.
- **Exit status.** The step fails when the threshold isn't met, which means you can make it a required check with ordinary branch protection.

The Action runs entirely inside your workflow. It doesn't call out to a coverage backend, and it needs no secret. Because it doesn't need one, it works on pull requests from forks, where secret-dependent checks are skipped.

## Edge cases we tried to get right

Diffs are messier than they look, and patch coverage is only trustworthy if the mapping from diff to coverage is exact.

**Renames.** A file moved without changes shouldn't count as entirely new code. patchcov follows renames, so only the lines that actually changed are in scope.

**Whitespace-only changes.** A reformat touches many lines without changing behavior. You can ask patchcov to ignore whitespace in the diff so a formatter run doesn't turn a clean pull request into a wall of "changed" lines.

**Paths that don't line up.** Coverage reports often contain absolute paths from the machine that produced them, such as `/home/runner/work/app/app/src/lib.rs`, while a diff uses repository-relative paths. patchcov normalizes these by matching on path suffix against the repository root, and it tells you when a file in the diff has no match in the report instead of silently treating it as covered.

**Files absent from the report.** This is the case that quietly breaks coverage gates. If a new source file isn't in the report at all, because the test run never loaded it, the lines are neither covered nor uncovered by the intersection rule. patchcov surfaces these as "changed files with no coverage data" and lets you choose whether that fails the check. For most projects it should, since a new file nobody exercised is the clearest case of untested code.

**Non-code files.** Changed Markdown, YAML and lockfiles have no coverage data and no business affecting the figure. You can restrict the check to source globs so they stay out of the denominator.

## What patchcov isn't

It's worth being clear about the limits, so you don't over-trust the number.

- **Line coverage is a weak claim.** A covered line was *executed*, not *verified*. A test that calls a function and asserts nothing covers every line in it. Patch coverage tells you what's definitely untested, and it can't tell you what's well tested. Treat 100% as "no obviously untested changes", not "correct".
- **It doesn't generate coverage.** patchcov reads a report. Your existing toolchain still instruments and runs the tests, which keeps it language-agnostic and keeps its scope small.
- **It's not a history store.** There are no trend graphs, no dashboards and no comment bot with a memory. If you want a long-term chart, keep using whatever produces one, and use patchcov for the question it answers best: *this change, right now*.

Those are deliberate omissions. The tool is small because the question is small.

## Why a precise answer matters

When a gate is vague, people learn to route around it. A threshold on a diluted number gets lowered or ignored the first time it blocks something that obviously shouldn't be blocked. A gate that points at specific lines and is almost always right earns trust, and trusted checks are the ones teams keep required.

There's a social side too. "Please add tests" is a review comment nobody enjoys giving or receiving. "These seven lines in `refund.rs` never ran" is a fact from a tool, with nothing for the author to take personally. It moves the discussion to the useful part: is this branch worth testing, or should it be removed?

## Getting started

Try it locally first, since that takes a minute and needs no setup beyond a coverage report you probably already produce:

1. Generate an LCOV report from your test run.
2. Run `patchcov --lcov lcov.info --base origin/main` on a branch with some changes.
3. Look at the uncovered ranges and see whether they match your intuition about what you left untested.

If that's useful, add the Action to a workflow and start with a threshold slightly *below* what your recent pull requests achieve, so it catches regressions without blocking day-to-day work. Raise it as the habit settles.

patchcov is open source, and issues and pull requests are welcome. Reports from unusual coverage formats, odd monorepo layouts and path-mapping edge cases are especially valuable, since those are where a tool like this is hardest to get right. If your project's coverage number has stopped telling you anything about individual changes, give it a try and see what your last few pull requests actually left untested.
