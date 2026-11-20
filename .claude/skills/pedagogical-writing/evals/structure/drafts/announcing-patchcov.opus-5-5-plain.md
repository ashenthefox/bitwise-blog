# Announcing patchcov

Every project with a coverage badge eventually has the same argument in code review. Someone opens a pull request, the coverage bot posts a comment saying total coverage went from 81.42% to 81.39%, and then nobody knows what to do with that number. Is a three-hundredths-of-a-percent drop bad? Did this change add untested code, or did it delete a well-tested file and shift the ratio? Does the reviewer block the merge or wave it through?

The number answers a question nobody asked. What reviewers want to know is narrower: **of the lines this change adds, which ones did the tests never execute?**

That's patch coverage, and today I'm releasing **patchcov**, a small tool that computes it. It runs as a command-line program and as a GitHub Action. It reads coverage reports your test suite already produces, compares them against a git diff, and tells you exactly which new lines went untested. It prints a percentage you can gate on and exits non-zero when the change falls below your threshold. It does this with no service in the loop: no upload, no account, no third-party dashboard, and no token with write access to your repository sitting in someone else's infrastructure.

## Why project coverage is the wrong gate

Total project coverage is a fine health metric to watch over months. It works badly as a per-change gate, for a few reasons.

**It's dominated by history.** In a codebase with 200,000 executable lines, a pull request that adds 40 completely untested lines moves total coverage by about 0.02%. Any threshold strict enough to catch that also catches noise.

**It punishes the wrong things.** Delete a dead module that happened to be fully tested and total coverage drops, even though the codebase got better. Add a large, well-tested feature next to an untested legacy area and coverage rises, even if the five lines of glue code connecting them were never run.

**It's not actionable.** "Coverage decreased by 0.03%" doesn't tell the author where to look. They have to open a dashboard, find the file, and compare line highlights against their diff by eye.

Patch coverage fixes all three. The denominator is the set of executable lines the change touches, so 40 untested lines in a 50-line change reads as 20%, which is the honest number. Deleting code never lowers it. And because it's computed per line, the output is the list of lines to go test.

Hosted coverage services already report patch coverage, and if you're happy with one, keep using it. patchcov is for people who want the same answer without the service: open-source projects that don't want to hand a third party repository access, companies whose code can't leave their CI runners, and anyone who wants the gate to be a deterministic program they can run on their laptop and get the same result CI got.

## What it looks like

Run your tests with coverage enabled the way you already do, then point patchcov at the report and a base ref:

```console
$ patchcov --base origin/main coverage.xml
patchcov: comparing HEAD against merge-base 3f9c2e1 (origin/main)

  src/billing/invoice.py      12/14   85.7%   missing: 88, 91
  src/billing/proration.py     9/9   100.0%
  src/billing/tax.py           3/7    42.9%   missing: 40-43

Patch coverage: 24/30 lines (80.0%)
Threshold: 90.0%  FAIL
```

That's the whole interface for the common case. Each file the change touches is listed with its covered and executable added lines, followed by line ranges that were never executed. The final line is the gate. The exit code is `0` on pass, `1` on fail, and `2` if patchcov couldn't produce a trustworthy answer (more on that below).

In the example, `tax.py` lines 40–43 are the obvious place to look. Nobody has to open a dashboard to find them.

## The GitHub Action

Most people will run patchcov in pull request CI. The Action wraps the command and adds two things the terminal can't: inline annotations on the diff and a job summary.

```yaml
name: tests
on: pull_request

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - run: pip install -e '.[test]'
      - run: pytest --cov=src --cov-report=xml

      - uses: patchcov/patchcov-action@v1
        with:
          reports: coverage.xml
          threshold: 90
```

When this runs on a pull request, every uncovered added line shows up as a warning annotation in the "Files changed" tab, right where the reviewer is already reading. The job summary gets a table like the terminal output above. If patch coverage is below the threshold, the step fails, and you can make it a required check with branch protection the same way you would any other job.

Look at the `permissions` block. The Action needs `contents: read` and nothing else. It doesn't post PR comments, so it doesn't need `pull-requests: write`, and it works on pull requests from forks without any `pull_request_target` workarounds. Annotations and job summaries are written through the runner's own workflow commands, so the results come straight from the job's logs. Nothing is sent anywhere.

`fetch-depth: 0` matters too. patchcov has to find the merge base between the PR head and the target branch, and the default shallow checkout doesn't contain it. If the history isn't there, patchcov fails with exit code `2` and a message saying so. It never guesses at a diff.

## How it decides what's "in the patch"

The details here determine whether the number is trustworthy, so here's exactly what patchcov does.

**The diff is against the merge base, not the tip of the base branch.** If `main` has moved on since the branch was cut, a plain `git diff origin/main` would include every change that landed on main in reverse, and you'd be blamed for lines you never touched. patchcov runs `git merge-base` and diffs from there, which matches what GitHub's "Files changed" view shows.

**Only added lines count.** In a unified diff, context lines and removed lines are excluded, and a modified line is an addition paired with a deletion, so it counts as added. Pure deletions contribute nothing to the denominator. A change that only removes code has no measurable patch and reports `no executable lines changed`, which passes.

**Only executable lines count.** A blank line, a comment, a closing brace, or a docstring that the coverage tool doesn't instrument isn't in the denominator. patchcov doesn't decide this itself. It defers to the coverage report: a line counts if the report lists it as executable, covered or not. That way patchcov agrees with your coverage tool about what code is, instead of shipping its own parsers for a dozen languages and getting them subtly wrong.

**Renames are followed.** A file moved from `lib/util.go` to `internal/util/util.go` with no content changes contributes zero added lines. patchcov uses git's rename detection, so a large refactor that moves files around doesn't suddenly demand 100% coverage of code that's merely been relocated.

**Files absent from the coverage report are reported, not silently skipped.** This is the most common way patch coverage tools lie. If you add `src/billing/refunds.py` and the test run never imports it, many coverage tools omit it from the report entirely, and a naive tool treats it as "no executable lines." patchcov lists added source files that don't appear in any report and fails by default. You can tell it which files legitimately aren't measured (generated code, migrations, configuration) with an exclude pattern.

## Coverage formats and path mapping

patchcov reads the formats most toolchains already emit:

- **LCOV** (`lcov.info`), from Istanbul/nyc, c8, `cargo llvm-cov`, gcov via lcov, and others
- **Cobertura XML**, from coverage.py, many JVM and .NET tools, and `gocover-cobertura`
- **coverage.py JSON**
- **Go coverprofiles** (`go test -coverprofile`)
- **JaCoCo XML**

You can pass more than one report, and patchcov merges them: a line counts as covered if any report covered it. That's how a monorepo with a Go backend and a TypeScript frontend gets a single patch coverage number, and how sharded or matrix test jobs can combine their results. Upload each job's report as an artifact, download them all in a final job, and run patchcov once.

The fiddliest part of any coverage tooling is paths. Coverage reports record file paths as the test runner saw them, which might be absolute paths inside a container (`/app/src/billing/tax.py`), paths relative to a package root, or Go import paths (`github.com/example/svc/internal/billing/tax.go`). Git reports paths relative to the repository root. patchcov tries the obvious normalizations automatically: it strips the repository root, resolves relative paths, and maps Go module paths using `go.mod`. When those aren't enough, you can give it explicit rewrites:

```toml
# patchcov.toml
[paths]
"/app/" = ""
"packages/web/" = "web/"
```

If a report path can't be matched to any file in the repository, patchcov warns, and if no report paths match at all it exits with `2`. A zero-match run almost always means misconfiguration, not a perfectly untested change, and it should look broken.

## Configuration and gating policy

Every option can be passed as a flag or set in a `patchcov.toml` at the repository root. A typical configuration looks like this:

```toml
threshold = 90.0
base = "origin/main"

reports = ["coverage.xml", "web/coverage/lcov.info"]

exclude = [
  "**/migrations/**",
  "**/*_pb2.py",
  "**/generated/**",
]

# Fail if an added source file is missing from every report.
require-reported = true

# Don't fail changes with fewer than this many executable lines.
min-lines = 5
```

`min-lines` exists because percentages misbehave at small sizes. A two-line change with one uncovered line is at 50%, and failing a typo fix on that basis trains people to ignore the check. With `min-lines = 5`, changes below the floor still get annotated, but they always pass the gate. Set it to `0` if you want strictness anyway.

To exclude individual lines, use your coverage tool's existing pragmas (`# pragma: no cover`, `/* istanbul ignore next */`, and so on). Those lines drop out of the coverage report's executable set, so patchcov respects them automatically. There's deliberately no patchcov-specific ignore syntax. One way to say "don't measure this" is enough.

## Output formats

The default output is the human-readable table shown above. There are three others:

- `--format json` emits a stable, versioned schema with per-file and per-line results, for anyone who wants to build their own reporting.
- `--format markdown` produces the same table the Action writes to the job summary, so you can paste it or post it from your own bot if you do want PR comments.
- `--format github` emits workflow annotation commands directly, which is what the Action uses internally. It's useful if you'd rather call the binary yourself than use the Action wrapper.

## What patchcov doesn't do

Being clear about scope is part of being trustworthy, so here's what's out of scope.

**It doesn't run your tests.** It reads reports you've already produced. Your test command, coverage tool, and configuration stay exactly as they are.

**It doesn't measure branch coverage yet.** The first release works at the line level. Several formats carry branch data, and partial-branch reporting on added lines is the most requested feature on the roadmap, but I want the line-level semantics settled first.

**It doesn't track history or draw graphs.** There's no database. Every run is a pure function of a diff and some reports. If you want trend lines for total coverage, keep whatever you use for that. patchcov fits next to it.

**It doesn't tell you whether your tests are good.** A line being executed isn't the same as a line being checked. Patch coverage is a floor, not a proof. Its job is to catch the cheap, common failure, a new code path no test ever reached, and point at it precisely so a human can make the judgment call.

## Installing

patchcov is a single static binary with no runtime dependencies. Prebuilt releases are available for Linux, macOS, and Windows on x86-64 and ARM64, or you can build from source:

```console
$ go install github.com/patchcov/patchcov/cmd/patchcov@latest
```

It's also on Homebrew (`brew install patchcov`), and there's a container image if your CI prefers that. The Action pins to the matching binary release and verifies its checksum before running.

The fastest way to try it is locally, on a branch you already have:

```console
$ git switch my-feature-branch
$ pytest --cov=src --cov-report=xml   # or your equivalent
$ patchcov --base main coverage.xml
```

If the output surprises you, either because it flags lines you thought were tested or because it misses lines you know aren't, please open an issue with the diff and report. That kind of feedback matters most right now, because the hard part of this tool is matching what a person would agree "the change" and "tested" mean.

## Wrapping up

The question code review needs answered is "what did this change leave untested?" Total coverage can't answer it, and outsourcing the answer to a service means trusting a network round-trip and a third-party integration with something that should be a plain computation. patchcov does that computation locally, from your diff and your reports, and gives you a number you can gate on and a list of lines you can act on.

It's MIT-licensed and ready to use today. Add it to one repository, set the threshold a little below where you'd like to be, and see what it finds.
