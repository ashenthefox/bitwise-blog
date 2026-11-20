# Announcing patchcov

Every pull request raises the same question, and most coverage tooling answers a different one.

The question is: **which lines did this change add that no test ran?**

The usual answer is a project-wide percentage. It moved from 81.4% to 81.2%, or it went up a tenth of a point, and a bot posts a badge about it. That number describes the whole repository. It says very little about the forty lines in front of you. A change can add a dozen untested lines and still raise total coverage, because it also deleted an untested file. A change can be fully tested and still lower total coverage, because a refactor moved some well-tested code into a module the report now counts differently. Reviewers learn to ignore the number, and once they ignore it the coverage step is just CI time spent for nothing.

patchcov answers the narrower question directly. It takes a git diff and a coverage report, intersects them, and tells you exactly which added or modified lines are executable and unexecuted. It runs as a command-line tool and as a GitHub Action. It can fail a build on a threshold. It does not upload anything anywhere: no account, no token, no third-party dashboard sitting between your CI and your answer.

## What patch coverage means here

"Patch coverage" gets used loosely, so here is the definition patchcov implements.

1. **Take the diff.** By default this is the diff between `HEAD` and the merge base with your target branch. That means the changes your branch introduced, not everything that has landed on `main` since you branched. You can pass an explicit base ref or a diff file instead.
2. **Keep the added and modified lines on the new side.** Deleted lines have nothing to cover. Context lines aren't part of the change.
3. **Intersect with the executable lines in the coverage report.** A line counts only if the coverage tool recorded it as instrumentable. Blank lines, comments, closing braces, type declarations, and anything else your coverage tool doesn't instrument are ignored, because there is nothing a test could do to them.
4. **Classify each remaining line** as covered (hit count > 0) or uncovered (hit count = 0). If the report carries branch data, partially covered branches on changed lines are reported separately.

Patch coverage is then `covered / (covered + uncovered)` over that set. The percentage is a summary. The line list is the actual result.

Two consequences of this definition matter in practice.

First, the denominator is honest. A change that adds 200 lines, 180 of them docs, tests, and config, might have 20 executable lines of production code. patchcov reports on those 20. A diff of mostly comments doesn't get diluted into looking well tested, and a small fix doesn't get punished for being small.

Second, a change can have **no** measurable lines: a README edit, a CI tweak, a change confined to files the coverage run doesn't instrument. patchcov reports that explicitly as "no executable changed lines" instead of inventing a 0% or a 100%. How that case gates is up to you; more on that below.

## The command

A local run looks like this:

```console
$ patchcov --coverage coverage/lcov.info --base origin/main

patchcov: 3 files, 47 executable changed lines, 41 covered, 6 uncovered (87.2%)

src/parser/escape.rs
  112        let code = u32::from_str_radix(&hex, 16)
  113            .map_err(|_| Error::BadEscape(span))?;
  140    }  else if c == '\u{2028}' {
  141        out.push_str("\\u2028");

src/config.rs
  58     if path.is_relative() && !opts.allow_relative {
  59         return Err(ConfigError::Relative(path.to_owned()));
```

That is the whole idea: the file, the line number, the source text, and nothing in between. You can read it in a terminal, paste it into a review, or jump straight to the line in an editor. Each uncovered line is a specific test you might want to write, or a specific line you might decide doesn't need one.

Contiguous uncovered lines are grouped so a missed `else` block reads as one item, not five. Covered lines are hidden by default; `--show-covered` prints them with context if you want to see the whole patch annotated.

For tooling, `--format json` emits a stable machine-readable structure. That includes per-file counts, every classified line, and the summary, so you can feed it into whatever review or reporting setup you already have. `--format markdown` produces a table suitable for a PR comment or a CI job summary.

### Inputs

patchcov reads the coverage formats that most toolchains already produce:

- **LCOV** (`lcov.info`): `cargo llvm-cov`, `c8`/`nyc`, `genhtml` pipelines, Go via converters, and many others.
- **Cobertura XML**: `coverage.py`, JaCoCo via converters, .NET tooling, and many others.

You can pass `--coverage` more than once. Reports are merged per line before the diff is applied, so a line counts as covered if any test suite hit it. This matters when unit tests and integration tests run as separate jobs.

Coverage reports are notoriously inconsistent about paths: absolute paths from the CI runner, paths relative to a sub-package, paths with a build directory prefix. patchcov normalizes report paths against the repository root. When a path doesn't resolve, it says so and doesn't silently drop the file. `--strip-prefix` and `--path-map` handle the cases normalization can't guess. A changed file that is executable source but absent from the report is flagged. Usually that means the file was never loaded by any test, and you would want to know that more than anything else.

## Precision is the feature

A coverage gate only works if people trust it. The fastest way to lose that trust is a report that blames the wrong lines. A lot of patchcov's code exists to get the line mapping right in the cases where naïve approaches don't.

**Merge base, not branch tip.** Diffing against the current tip of `main` attributes every commit that landed upstream after you branched to your PR. patchcov uses the merge base by default, which matches what a reviewer sees in the PR's "Files changed" tab.

**Renames and moves.** A file renamed with small edits should report only the edited lines, not the whole file as new. patchcov uses git's rename detection, so moving a module doesn't make every line in it part of your patch.

**Modified lines count, whitespace-only changes are configurable.** A reformatted line is technically a changed line. `--ignore-whitespace` drops lines whose only change is whitespace. That's useful when a formatter upgrade touches a file you otherwise barely changed.

**The report must match the code.** Coverage is collected from a specific build of a specific commit. If the report was generated from different source than the diff's new side, line numbers silently drift. patchcov checks what it can (files that exist, line numbers within range) and warns loudly on mismatches. In CI the fix is almost always the same: generate coverage and run patchcov in the same job, on the same checkout.

**Exclusions are explicit.** `--exclude` takes glob patterns for paths that should never count toward patch coverage, such as generated code, vendored dependencies, or test helpers. Your coverage tool's own exclusion markers (e.g. `# pragma: no cover`, `// coverage:ignore`) take effect upstream, because excluded lines don't appear in the report as executable. patchcov doesn't add a second, competing exclusion syntax.

None of this is exotic. It is the difference between a report you act on and a report you argue with.

## Gating

The point of a precise answer is that you can put it in a CI gate without people routing around it.

```console
$ patchcov --coverage lcov.info --base origin/main --fail-under 80
```

Exit codes are fixed and documented:

| Exit code | Meaning |
|-----------|---------|
| `0` | Patch coverage meets the threshold (or no threshold set) |
| `1` | Patch coverage is below the threshold |
| `2` | Usage or input error: unreadable report, bad ref, unresolvable paths in strict mode |

Keeping "your change is under-tested" separate from "patchcov couldn't do its job" matters. A broken coverage step should never look like a passing one, and it should never look like a developer's fault either.

A few more gating options:

- `--fail-under-lines N` gates on an absolute count of uncovered lines rather than a percentage. Some teams prefer "no more than 5 new uncovered lines" because percentages are harsh on small changes. One untested line out of three is 67%.
- `--empty pass|fail|skip` decides what happens when a change has no executable lines. The default is `pass`. Documentation PRs shouldn't need a waiver.
- `--strict` turns path resolution warnings into errors, for repositories where you've already sorted out path mapping and want to keep it that way.

A useful pattern is to set the patch threshold much higher than your project-wide coverage. A legacy codebase at 55% total coverage can still require 90% on new code. That ratchets coverage upward one change at a time without anyone writing tests for code they didn't touch. Project-wide gates tend to do the opposite: they block unrelated work whenever total coverage dips, so people learn to resent them.

## The GitHub Action

The Action wraps the same binary and adds the things that only make sense inside GitHub:

```yaml
name: test
on: pull_request

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # patchcov needs history to find the merge base

      - name: Run tests with coverage
        run: cargo llvm-cov --lcov --output-path lcov.info

      - name: Patch coverage
        uses: patchcov/patchcov-action@v1
        with:
          coverage: lcov.info
          fail-under: 85
```

On a pull request, the Action:

- infers the base from the PR's target branch, so you don't have to wire refs by hand;
- writes a **job summary** with the per-file table and the uncovered line list;
- emits **annotations** on each uncovered range, so the gaps show up inline in the "Files changed" view, right next to the code a reviewer is already reading;
- sets the step outcome from the exit code, so branch protection can require it like any other check.

It needs only `contents: read`. It doesn't post comments by default, and it doesn't need a write token, an app installation, or a secret. That is deliberate. Annotations and job summaries are already shown on the PR, so the report reaches reviewers without the Action being able to change anything in the repository. If you do want a sticky PR comment, the Markdown output is there for you to post with whatever commenting step you already trust.

The `fetch-depth: 0` line is the one piece of setup people miss. A shallow clone has no merge base to compute, and patchcov exits with code `2` and an explanation rather than guessing.

## No service in the loop

Hosted coverage services solve real problems. They store history, draw trend graphs, and aggregate across repositories. But to answer "what did this PR leave untested," they put an external system on your critical path. You upload a report with a token. You wait for processing. You hope the service matched the upload to the right commit. Then a status check or a bot comment arrives a bit later, assuming the service is up and the upload wasn't rate-limited, and assuming the fork PR's missing token didn't quietly skip the upload altogether.

patchcov does the computation where the data already is: on the runner, with the checkout and the report on local disk. That has some practical consequences:

- **It's deterministic.** Same diff, same report, same result. You can reproduce a CI failure on your laptop with the same command.
- **It works on fork PRs.** There's no secret to withhold from untrusted forks, because there's no secret.
- **It works offline and off GitHub.** The CLI runs anywhere git runs: GitLab CI, Buildkite, a pre-push hook, your terminal.
- **Your source and coverage data stay where they are.** For a lot of private codebases, that alone settles it.
- **It's fast.** It parses a report and a diff, intersects them, and finishes in a fraction of a second, even on large reports.

What you give up is history. patchcov has no trend graph, because it has nowhere to store one. If you want trends, keep using whatever gives you trends. patchcov sits happily alongside a hosted service. It just doesn't depend on one to answer the question about the PR in front of you.

## What it isn't

A few clear non-goals, so expectations are set:

- **It doesn't run your tests or collect coverage.** Your existing coverage tool does that. patchcov reads what it produces.
- **It doesn't judge test quality.** A line executed by a test with no assertions counts as covered. Coverage is a floor, not a guarantee. patchcov just makes the floor visible where it matters.
- **It doesn't track project-wide coverage.** Your coverage tool already reports that, and the point here is to look at something else.

## Getting started

Install the CLI, then point it at a report and a base:

```console
$ patchcov --coverage path/to/lcov.info --base origin/main
```

Start without a threshold. Run it on a few recent PRs and look at what it flags. You'll quickly see whether your path mapping is right and whether the reported gaps match your intuition. Then add `--fail-under` at a level your team can actually hold, and move the check into CI with the Action.

The question a reviewer asks about coverage was always specific: these lines, this change, tested or not. patchcov answers that question on the runner where the report is generated, with no service in between, and with an exit code you can gate on.
