# Announcing patchcov

When you review a pull request, the coverage question you usually want answered is: of the lines this change added or modified, which ones did the tests never run? The overall coverage percentage of a project cannot answer that, because a change is small compared with the project it lands in. patchcov answers it directly. It is a command-line tool and a GitHub Action. It reads the coverage report your CI already produces and the git diff of your branch, and it reports which changed lines are untested. It can also fail the build when too few changed lines are tested. Everything runs inside your own CI job, so no external coverage service receives your code or your reports.

This post explains what patchcov measures, how it decides which lines count, and when it is reasonable to block a pull request on its result.

## Why the project total hides untested changes

The overall percentage barely moves when a pull request adds untested code, because the new lines are a small fraction of all lines. A worked example shows how small the movement is.

Suppose your project has 10,000 lines that the coverage tool tracks, and the test suite runs 8,000 of them. Overall coverage is 8,000 divided by 10,000, which is 80.00%. A pull request then adds 50 new tracked lines, and the tests run 20 of them.

1. The project now has 10,000 plus 50, which is 10,050 tracked lines. We add the 50 because every new tracked line joins the total, whether or not it is tested.
2. The tests now run 8,000 plus 20, which is 8,020 lines. We add only the 20 because only those new lines were run.
3. Overall coverage is now 8,020 divided by 10,050, which is about 79.80%. The total dropped by 0.20 percentage points.

A drop of 0.20 points is easy to dismiss in review, and it is smaller than the movement that ordinary unrelated changes often cause. But 30 of the 50 lines this pull request introduced were never run by any test. The change itself is 20 out of 50 tested, which is 40%.

That second number, 40%, is the patch coverage. Patch coverage is the share of the changed lines that the tests ran. It is computed only over lines that the change added or modified, and only over lines the coverage tool tracks. The overall total answers "how tested is the project?" Patch coverage answers "how tested is this change?" The second question is the one a reviewer can act on, because the author of the pull request can add tests for the 30 untested lines.

The effect gets stronger as the project grows. The same 50-line pull request in a project of 100,000 tracked lines at 80% would move the total from 80.00% to about 79.97%. Patch coverage would still be 40%, because it does not depend on the size of the rest of the project.

## Which lines count

patchcov counts a line only if two conditions both hold: the diff marks it as added or modified, and the coverage report tracks it. Each condition removes a different kind of line, so it is worth going through both.

The first condition comes from git. patchcov compares your branch with its base and takes every line that appears as added in that diff. In git's line-based diff, a modified line appears as one deleted line followed by one added line, so modified lines are included through their added version. Deleted lines are not counted, because a deleted line no longer exists and cannot be tested.

The second condition comes from the coverage report. Coverage tools record only executable lines, meaning lines that correspond to code that can run, such as statements and expressions. They skip blank lines, comments, and most declarations. If your change adds a 10-line docstring and a 3-line function body, only the 3 lines of the body can count, because the coverage report contains no entry for the docstring. A tracked line is covered if the report says the tests ran it at least once, and uncovered if the report records it with zero runs.

Here is the full calculation for a small change. A pull request edits one file. The diff shows 18 added lines: 6 are blank or comments, and 12 are code. The coverage report tracks 11 of those 12 code lines; the twelfth is a line holding only a closing bracket, which this particular coverage tool does not record. Of the 11 tracked lines, the tests ran 9.

1. Start with the 18 added lines, because those are the lines the change introduced.
2. Remove the 7 lines the coverage report does not track, which are the 6 blank or comment lines and the closing bracket, because there is no coverage data for them. That leaves 11.
3. Of those 11, 9 were run, so patch coverage is 9 divided by 11, which is about 81.8%.
4. The 2 lines that were not run are the result you act on. patchcov lists them by file and line number.

Which lines count as tracked depends on your coverage tool and your language, not on patchcov. Two tools measuring the same code can disagree by a few lines per file, for example on closing brackets or multi-line expressions. patchcov uses whatever your report says.

One case needs a decision. If a change touches no tracked lines at all, for example a change that only edits documentation or configuration files, patch coverage would be 0 divided by 0, which has no value. patchcov reports "no tracked lines changed" and passes in that case, because there is nothing a test could have covered. You can make it fail instead with `--on-empty fail`, but most projects should not, because they would then block every documentation-only pull request.

## Comparing against the right base

patchcov compares your branch against its merge base with the target branch, not against the current tip of the target branch. The merge base is the most recent commit that both your branch and the target branch contain; it is where your branch split off. The choice matters because of what each comparison would include.

Suppose you branch from `main`, and while your pull request is open, a colleague merges 200 lines into `main`. If patchcov diffed your branch against the current tip of `main`, those 200 lines would show up in the diff as differences, even though your branch did not write them, and their coverage would be blamed on your pull request. Diffing against the merge base shows only the lines your branch changed. This is the same comparison GitHub shows in the "Files changed" tab of a pull request.

Finding the merge base requires git history. Many CI setups, including the default checkout in GitHub Actions, fetch only the latest commit, and with only one commit git cannot find where your branch split off. You need to fetch enough history for that, and the setup below shows how.

There is one more condition: the coverage report must come from the same commit as the head of the diff. patchcov matches line numbers in the diff to line numbers in the report, so if the report was produced from an older commit, line 40 in the report may be a different line from line 40 in the diff. If you build coverage in the same job that runs patchcov, this condition holds automatically.

## Using the command

You can run patchcov locally before you push, or in any CI system. Install it, produce a coverage report with your existing test command, then point patchcov at the report and the base branch:

```sh
pip install patchcov
pytest --cov --cov-report=lcov:coverage.lcov
patchcov --base origin/main --coverage coverage.lcov
```

patchcov reads LCOV, Cobertura XML, and JaCoCo XML reports. Most coverage tools can write at least one of these formats, so if yours produces something else, check its options for one of the three.

The output lists the patch coverage and every uncovered changed line:

```
Patch coverage: 20 of 50 tracked changed lines covered (40.0%)

src/billing/invoice.py
  41-47   uncovered
  63      uncovered
src/billing/refund.py
  12-33   uncovered
```

The line ranges are the useful part. A percentage tells you how much is untested; the ranges tell you where to write tests. In this example, lines 12 to 33 of `refund.py` are 22 of the 30 uncovered lines, so one missing test for the refund path would account for most of the gap.

To make the command fail when patch coverage is too low, add a threshold:

```sh
patchcov --base origin/main --coverage coverage.lcov --fail-under 80
```

With this option, patchcov exits with a non-zero status when patch coverage is below 80%, so any CI system that stops on failing commands will fail the build. A patch coverage of exactly 80% passes.

## Using the GitHub Action

The GitHub Action runs the same command inside your workflow and adds its results to the pull request page. Add a step after your tests:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: pytest --cov --cov-report=lcov:coverage.lcov
      - uses: patchcov/patchcov-action@v1
        with:
          coverage: coverage.lcov
          fail-under: 80
```

The `fetch-depth: 0` line fetches the full git history. It is needed because the default checkout fetches a single commit, and as explained above, patchcov cannot find the merge base from a single commit. If you leave the line out, the Action stops with an error that says the merge base could not be found, instead of reporting a wrong number. In a very large repository, fetching the full history can take noticeably longer, and you can fetch a fixed number of commits instead, but then a branch older than that number of commits will hit the same error.

The Action detects the base branch from the pull request, so you do not need to pass it. It writes the results to the job summary and adds an annotation on each uncovered changed line, which GitHub shows in the "Files changed" tab next to the code. Both use only the permissions a workflow has by default. Your coverage report and your code stay in the CI runner, because the Action reads local files and sends nothing to any outside server.

## When to gate a pull request on patch coverage

Gating on patch coverage means failing the build when patch coverage is below a threshold, so the pull request cannot be merged until it has more tests or someone overrides the check. It works well when two conditions hold: your team expects new code to come with tests, and your coverage run actually exercises the code those tests would cover. If either condition fails, the gate blocks pull requests that are fine.

Start with the threshold. A threshold of 100% sounds strict but fails on lines that are reasonable to leave untested, such as a defensive error branch that no test can easily trigger. Thresholds between 70% and 90% are common for that reason. Whatever number you choose, it applies to the share of changed lines, not to the project, so an 80% threshold on patch coverage is much stricter than an 80% target for the overall total. The project total can sit at 80% while individual pull requests range from 0% to 100%.

Small changes make the threshold coarse. A change with 4 tracked lines can only score 0%, 25%, 50%, 75%, or 100%. With an 80% threshold, that change fails if even 1 of its 4 lines is untested, because 3 out of 4 is 75%. The same single untested line in a 50-line change gives 98%, which passes. So a single untested line weighs far more in a small change. If this causes failures on trivial fixes, pass `--min-lines 10`. With that option, patchcov still reports patch coverage for changes with fewer than 10 tracked lines but does not fail them.

Some kinds of change make patch coverage misleading, so you should expect to override the gate for them:

- A change that moves code between files appears in the diff as deleted lines in one file and added lines in another. Every moved line counts as changed, so moving 200 lines of old, untested code produces low patch coverage even though the change added no new behavior.
- Code that only integration tests or manual tests exercise will show as uncovered if those tests do not run in the job that produces the coverage report.
- Code that runs only on another platform, for example a Windows-only branch measured on a Linux runner, will show as uncovered on that runner.
- Generated files, such as code produced from a schema, count as changed lines whenever they are regenerated. You can leave them out with `--exclude 'src/generated/**'`, which removes matching files before patchcov counts anything.

## What patch coverage does not tell you

Patch coverage measures whether the tests ran a line, not whether they checked its result. A test that calls a new function and makes no assertions brings every line it runs to covered, so a change can show 100% patch coverage and still have no meaningful test. The gate catches missing tests; it does not catch weak ones, and review still has to do that.

patchcov also measures lines, not branches. A line such as `return a if ok else b` counts as covered when the tests run it once, even if `ok` was always true and the `b` side never ran. If your coverage tool records branch coverage, the branch information is in your report, but patchcov's percentage does not use it.

Finally, patchcov looks only at lines the change touched. If a change removes the only test that ran some unchanged line elsewhere, that line becomes uncovered, but it is not in the diff, so patch coverage does not report it. The project total will show it as a small drop, which is one reason to keep watching the total alongside patch coverage.

patchcov is available now with `pip install patchcov`, and the Action is available as `patchcov/patchcov-action@v1`. If your coverage tool produces a report patchcov cannot read, or the line numbers do not match your diff, please open an issue with a small example, because those mismatches are the most likely source of wrong results.
