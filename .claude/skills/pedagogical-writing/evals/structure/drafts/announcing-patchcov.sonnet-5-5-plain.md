# Announcing patchcov

Your project has a coverage number. It's 87.3%, or 91%, or whatever it was the last time someone looked. It goes up and down by fractions of a percent, and nobody can say with confidence what moved it. When a pull request lands and the number shifts by 0.2 points, the shift tells you almost nothing about the pull request. The question you actually wanted answered was narrower and more useful: *of the lines this change added or modified, which ones did no test execute?*

That's patch coverage, and today I'm releasing **patchcov**, a small tool that computes it from a git diff and a coverage report, prints the answer, and exits nonzero if the answer isn't good enough. It runs as a command on your laptop and as a GitHub Action in CI. There is no service, no account, no upload, and no webhook. It reads two files and produces a verdict.

This post covers why I wrote it, how it works, how to gate on it, and where it deliberately stops.

## The problem with the project-wide number

Total coverage is a ratio over the entire codebase. That makes it a poor instrument for reviewing a change, for three reasons.

**It's diluted.** In a 200,000-line project, a 40-line change with zero tests moves the total by a rounding error. You can add an entire untested module and the badge barely twitches.

**It's noisy.** Total coverage also moves when someone deletes well-tested code, when a flaky test is skipped, or when a dependency bump changes which branches are reachable. A drop doesn't tell you the author was careless, and a rise doesn't tell you they were careful.

**It's not attributable.** Even when the number is wrong in an interesting way, it doesn't point at anything. You can't click on 87.1% and get a list of the lines to look at.

Patch coverage fixes all three by changing the denominator. Instead of "all executable lines," it's "executable lines this diff added or changed." A 40-line change with 12 uncovered lines is 70% patch-covered no matter how large the repository is, and the 12 lines are named.

Hosted coverage services have offered this for years, and it's a good feature. But it comes bundled with things you may not want: uploading reports to a third party, a token in your CI secrets, a comment bot, a status check whose logic you can't inspect, and a dependency on someone else's uptime. If your project is private, or your security team has opinions, or you just don't want a build to fail because an external API is slow, that bundle is a poor trade for what is, computationally, a join between two small data structures.

## What patchcov does

Conceptually, patchcov does one thing:

1. Parse a unified diff to get, for each file, the set of line numbers that exist on the *new* side and were added or modified.
2. Parse a coverage report to get, for each file, which lines are executable and which of those were hit.
3. Intersect them.

The result is a set of lines that are both *in the patch* and *executable*. Lines in the patch that aren't executable (comments, blank lines, imports in some languages, closing braces) are ignored, because they can't be covered or uncovered. Of the executable ones, patchcov reports how many were hit and lists the ones that weren't.

That's it. The interesting work is in getting the details right, which I'll get to below.

## Installing

patchcov is a single static binary. Grab it from the releases page, or install with your toolchain of choice:

```sh
cargo install patchcov
```

It has no runtime dependencies and doesn't need network access. It does need `git` on the path if you want it to generate the diff for you; if you'd rather pipe in a diff, it doesn't need that either.

## Using it as a command

The most common invocation compares your working branch to the branch you'll merge into:

```sh
patchcov --base origin/main --report coverage.lcov
```

Output looks like this:

```
patchcov: 34 of 41 changed executable lines covered (82.9%)

src/parser/tokens.rs
  covered   31 of 33
  missing   88, 89, 142

src/cache.rs
  covered    3 of 8
  missing   57-61

Threshold: none
```

Missing lines are collapsed into ranges so a block of uncovered code reads as one item. The file paths and line numbers are the ones you'd see in your editor, so you can jump straight to them.

### Choosing a diff

By default, `--base <rev>` runs the equivalent of `git diff <rev>...HEAD`, using the merge base, so you see only what your branch introduced and not what `main` has gained since you branched. That's almost always what you want. A few other ways to choose:

```sh
# Include uncommitted changes in the working tree
patchcov --base origin/main --worktree --report coverage.lcov

# Only the staged changes, handy in a pre-commit hook
patchcov --staged --report coverage.lcov

# Read a diff from stdin; patchcov doesn't care where it came from
git diff -U0 v1.4.0..v1.5.0 | patchcov --diff - --report coverage.lcov
```

The stdin form is useful for things that aren't a branch comparison: auditing a release, checking a single commit, or running against a patch file someone emailed you.

### Report formats

patchcov reads the formats most toolchains already emit:

- **LCOV** (`.info`), from `lcov`, `cargo llvm-cov`, `c8`/`nyc`, `gcov` wrappers, and many others
- **Cobertura XML**, from `coverage.py`, `gocover-cobertura`, JaCoCo converters, and so on
- **Go cover profiles**

The format is detected from the content, not the extension. You can pass `--report` more than once, and hits are merged by file and line, so a unit-test report and an integration-test report combine naturally. A line counts as covered if *any* report hit it.

## Using it as a GitHub Action

In CI, you usually already have a job that runs tests and produces a coverage file. Add one step after it:

```yaml
name: ci
on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # patchcov needs history to find the merge base

      - name: Run tests with coverage
        run: cargo llvm-cov --lcov --output-path coverage.lcov

      - name: Patch coverage
        uses: patchcov/patchcov-action@v1
        with:
          report: coverage.lcov
          threshold: 80
```

Two details worth noting. First, `fetch-depth: 0` matters: a shallow clone has no merge base, and patchcov will tell you so rather than guess. Second, the action's `base` input defaults to the pull request's base branch, so you don't have to wire that up.

On completion, the action writes a table to the job summary, with the per-file breakdown and the missing ranges. It also emits GitHub annotations for each uncovered range, so the lines show up inline in the "Files changed" view of the pull request. Annotations are just workflow commands written to stdout; no token or API call is involved, which is why this works identically on forks, where secrets aren't available.

If you'd rather not use the action, the binary does the same things in any CI system. `--format github` emits the annotations, `--format markdown` emits the summary table, and `--format json` gives you something to feed into your own tooling.

## Gating

A report you can ignore is a report people ignore. patchcov's exit code is the gate.

```sh
patchcov --base origin/main --report coverage.lcov --threshold 80
```

If patch coverage is below 80%, the exit code is 1. Otherwise it's 0. Exit code 2 means patchcov itself couldn't produce an answer (bad input, no merge base, unreadable report), and it's deliberately distinct so a tooling failure never masquerades as a coverage failure, or worse, as a pass.

A few options make the gate fit real projects.

**Absolute limits.** Percentages behave badly on tiny patches. A one-line change with that line uncovered is 0% covered, which feels like a harsher verdict than it deserves. Pair the threshold with a floor:

```sh
patchcov --threshold 80 --min-lines 10
```

With `--min-lines 10`, patches with fewer than ten executable changed lines are reported but not gated. Alternatively, `--max-missing 5` fails the build if more than five changed lines are uncovered, regardless of percentage. I tend to use the percentage for large patches and the absolute count as a backstop.

**Per-path rules.** Not all code deserves the same bar. A config file at the repo root lets you say so:

```toml
# patchcov.toml
threshold = 80

[[rule]]
paths = ["src/payments/**"]
threshold = 95

[[rule]]
paths = ["src/generated/**", "**/*_test.go"]
ignore = true
```

Payments code has to be nearly fully covered; generated code and test files themselves are excluded from the calculation. Each rule is evaluated independently, and the report tells you which rule failed.

**Ignore markers.** Sometimes a line really shouldn't be covered: an `unreachable!()`, a defensive branch for a condition the type system already rules out. You can mark those inline:

```rust
_ => unreachable!(), // patchcov: ignore
```

Ignored lines are removed from both numerator and denominator, and the summary reports how many were ignored in the patch, so the escape hatch stays visible in review rather than silently eroding the gate.

## The details that matter

The idea is simple enough that a script could do it in an afternoon, and I wrote that script first. It was wrong in several ways that only showed up on real repositories. Most of patchcov's code exists to handle these.

**Renames and moves.** If a file is renamed with small edits, the diff has to be read with rename detection, and the coverage report's path has to be matched to the *new* name. patchcov follows renames and only counts lines that actually changed, not every line in a moved file.

**Path normalization.** Coverage tools disagree about paths. Some emit absolute paths from the build machine (`/home/runner/work/app/app/src/lib.rs`), some emit paths relative to a subdirectory, and some emit paths with a module prefix. patchcov resolves them by matching on the longest common path suffix against files in the diff, and it errors loudly if a match is ambiguous instead of picking one. You can supply `--strip-prefix` when you know better.

**Line identity.** The diff uses line numbers on the new side of the change. The coverage report must have been produced from that same tree. If the report is from a different commit than the diff's head, line numbers will drift and the answer is garbage. patchcov checks what it can (a report that references lines beyond the end of a file is a strong signal), and the action runs against the checked-out merge result or head you tell it to. Generating coverage and measuring it on the same checkout is your responsibility, but patchcov will complain when it smells a mismatch.

**Multi-line statements.** A single statement may span five lines, and tools differ on which line they attribute hits to. If a diff touches only the third line of a multi-line expression and the report attributes the hit to the first, a naive intersection says "not executable." patchcov uses the report's own notion of executable lines but treats a changed line that falls inside a covered or uncovered span as belonging to that span when the format provides span information (Cobertura and Go profiles do; LCOV usually doesn't, so there the behavior is the plain intersection).

**Whitespace-only changes.** Reindenting a block touches every line in it. `--ignore-whitespace` passes the corresponding flag through to the diff so a formatting change doesn't present itself as forty newly untested lines.

**Deleted lines.** Deleted lines have no new-side line number and nothing to cover. They're ignored. A patch that only deletes code reports "no changed executable lines" and passes, which is correct.

## What patchcov doesn't do

I want to be plain about the boundaries.

It does not run your tests or produce coverage. It consumes a report you already have.

It does not tell you whether the tests are *good*. A line being executed is a weak claim: it means no test crashed on it, not that any test asserted anything about it. Patch coverage is a floor, and a useful one, but a patch at 100% can still be poorly tested. Treat the missing lines as a list of places to look first, not as a grade.

It does not track history or draw charts. There's no database. If you want a trend line, the JSON output is easy to append to whatever you already use for metrics.

It does not post pull request comments. The job summary and inline annotations cover the common need without requiring a write token. If you want comments, the Markdown output can be piped to the tool of your choice.

And it measures line coverage. Branch coverage is parsed from reports that include it and shown in the output, but the gate currently applies to lines only. Gating on branches is the most requested thing I expect to hear about, and I'd rather get it right than ship it half-sensible.

## Adopting it without annoying your team

If you add a hard gate to an existing project on day one, you'll get an immediate round of exceptions and resentment. A rollout that has worked well for me:

1. **Report only.** Run the action with no threshold for a couple of weeks. Everyone sees the numbers in the job summary, and you learn what your project's typical patch coverage actually is.
2. **Pick a threshold below the median.** If most patches land at 85%, start the gate at 70%. The goal is to catch the outliers, not to renegotiate everyone's habits.
3. **Add path rules where the risk is.** Tighten the screws on code where bugs are expensive, and exclude code where coverage is meaningless.
4. **Ratchet slowly.** Raise the threshold when the team is comfortably clearing it, not before.

Because the gate is local and deterministic, anyone can reproduce a failure on their own machine with the same command CI ran. No one has to wonder what a remote service computed or why it disagrees with their terminal.

## Try it

```sh
cargo install patchcov
cargo llvm-cov --lcov --output-path coverage.lcov   # or your tool of choice
patchcov --base origin/main --report coverage.lcov
```

That's a complete workflow: two commands, no signup. If the output surprises you, if there are lines on that list you assumed were tested, then the tool is already doing its job.

The source, issue tracker, and documentation are on the project's repository. Bug reports with a diff and a coverage file attached are the most useful kind, since nearly every bug in a tool like this is a disagreement between two formats about what a line is. I'd like to hear about the disagreements you find.
