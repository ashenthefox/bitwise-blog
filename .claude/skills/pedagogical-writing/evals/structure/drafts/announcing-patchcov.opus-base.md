# Announcing patchcov

patchcov is a command and a GitHub Action that answers one question about a pull request: of the lines this change added or modified, which ones did the tests never run? It reads your git diff and the coverage report your test run already produces, prints the untested changed lines and a single percentage, and can fail the CI job when that percentage is below a threshold you choose. Everything runs on your CI machine, so no coverage service receives your report.

This post explains what patch coverage measures, works through how it is computed with real numbers, and then covers when it makes sense to block a pull request on it and when it does not.

## Why total coverage cannot answer this question

Total coverage tells you how much of the whole project the tests run, but it barely moves when a single pull request adds untested code. Because a pull request is usually small compared with the project, its effect on the total is diluted by every line that was already there.

Here is a project with numbers. Coverage tools only count lines that can actually run, such as statements and expressions. Blank lines, comments, and most declarations are skipped. A line the tool counts is called a coverable line, and a coverable line that ran at least once during the tests is a covered line. Total coverage is covered lines divided by coverable lines.

Suppose the project has 10,000 coverable lines and 8,000 of them are covered, so total coverage is 8,000 / 10,000 = 80.00%.

A pull request then adds 50 lines. Ten are blank lines or comments, so 40 of them are coverable. The tests in the pull request exercise only 10 of those 40.

After the merge, the project has 10,040 coverable lines and 8,010 covered lines. Total coverage is 8,010 / 10,040 = 79.78%.

The total fell by 0.22 percentage points. That is small enough to fall within the normal week-to-week movement of most projects, so a reviewer would not notice it, and a rule such as "total coverage must not drop by more than 1 point" would accept the change. Yet three quarters of the new code was never run by any test. Total coverage hid this because the 40 new coverable lines were averaged against 10,000 old ones.

## What patch coverage measures

Patch coverage is the share of the coverable lines a change added or modified that the tests ran. It answers the question directly because it ignores every line the change did not touch.

In the example above, the change has 40 coverable lines and 10 of them are covered, so patch coverage is 10 / 40 = 25%. The same pull request that moved total coverage by 0.22 points scores 25% on patch coverage, and patchcov also lists the 30 uncovered lines by file and line number so the author knows exactly which code to test.

A changed line, in this post, means a line that exists in the new version of a file and that the diff marks as added. Git represents a modified line as the old line removed and a new line added, so modified lines are included. Deleted lines are not included, because they do not exist in the new version and so no test could have run them.

## How patchcov computes it, step by step

patchcov makes three passes over its two inputs, and each step exists to keep the number precise.

1. It finds the merge base, which is the most recent commit shared by your branch and the base branch, and diffs your branch against that commit. It uses the merge base rather than the current tip of the base branch because the base branch may have moved on since you branched. Diffing against the tip would count other people's merged work as your change, and you would be blamed for their untested lines.
2. It collects the changed lines from that diff, file by file, using the line numbers of the new version. It uses new-version line numbers because the coverage report was produced by running the new version, so only those numbers line up with the report.
3. For each changed line, it looks the line up in the coverage report. If the report does not list the line, the tool did not consider it coverable, so patchcov leaves it out of both the numerator and the denominator. If the report lists the line with zero executions, it is an uncovered changed line. If the report lists it with one or more executions, it is a covered changed line.

Patch coverage is then the number of covered changed lines divided by the number of coverable changed lines.

Continuing the example: the diff has 50 changed lines. The coverage report lists 40 of them, so 10 are dropped as not coverable. Of the 40, the report shows 10 with at least one execution and 30 with none. The result is 10 / 40 = 25%, with 30 lines reported as uncovered.

## What the number does not tell you

Patch coverage is exact about the question it asks, but the question has limits, and each one is a case where the number can mislead you if you read more into it than it says.

A covered line is a line that ran, not a line that was checked. If a test calls a function and never asserts anything about its result, every line of the function counts as covered. Patch coverage therefore tells you which changed lines no test reached, which is certain, and says nothing about whether the tests that reached the other lines would catch a bug in them.

Patch coverage only sees lines the change touched, so it misses coverage the change removed elsewhere. Suppose a pull request deletes a test file and changes nothing else. The diff has no added lines, so there are no coverable changed lines, but the 200 lines that test used to exercise are now uncovered. Patch coverage cannot report this, because none of those 200 lines appears in the diff. The same happens when a change makes old code unreachable, for example by adding an early return above it. If losing coverage this way matters on your project, keep a separate check on total coverage alongside the patch coverage check.

When a change has no coverable changed lines at all, patch coverage is undefined, because the division is zero by zero. This happens for pull requests that only edit documentation, configuration, or comments. Treating that case as 0% would fail harmless pull requests, and treating it as 100% would claim something was measured when nothing was. patchcov reports that there were no coverable changed lines and does not fail the job.

Granularity is per line. If a line contains a condition such as `if a && b`, the line counts as covered as soon as it runs once, even if the tests never made `b` false. Branch coverage would catch that; line-based patch coverage does not. The number is therefore an upper bound on how thoroughly the changed code was exercised, and on code with dense conditions it can be well above what branch coverage of the same lines would show.

## When to block a pull request on patch coverage

Gating a pull request means making a required CI check fail, so the pull request cannot merge until the check passes. Patch coverage is a good gate when the coverage report is complete and repeatable, and a bad gate when either of those is false. The reason is that a gate that fails for reasons unrelated to the author's change teaches people to override it.

The coverage report must include every test that runs on the change. If your unit tests run in one job and your integration tests in another, and patchcov only sees the report from the unit test job, lines exercised only by integration tests will be reported as uncovered. A pull request whose new code is tested thoroughly by integration tests would then fail. Merge the reports from all test jobs into one before running patchcov, or do not gate.

The coverage report must be the same on every run of the same code. If some tests are skipped depending on timing, the environment, or randomness, a line can be covered on one run and uncovered on the next. A gate on that line would pass and fail without any change to the code.

The changed code must be the kind your tests are expected to reach. Generated code, platform-specific code that CI does not run, and debugging helpers will often show as uncovered for good reasons. Exclude those files from the coverage report, or from the check, before gating. Otherwise every pull request that regenerates a file fails.

If all three conditions hold, gate. If you are unsure about any of them, run patchcov without a threshold for a few weeks first. It will still print the uncovered changed lines in every pull request, and you will see from real pull requests whether the failures a gate would have caused were fair.

## Choosing a threshold

The threshold is the minimum patch coverage a pull request needs to pass, and the right value depends on how many coverable lines your typical pull request changes. That dependence exists because each uncovered line costs 100 divided by the number of coverable changed lines in percentage points.

Take a threshold of 80%. On a pull request with 40 coverable changed lines, each uncovered line costs 2.5 points, so the author can leave up to 8 lines untested and still pass. On a pull request with 3 coverable changed lines, each uncovered line costs 33.3 points, so a single untested line drops patch coverage to 66.7% and fails the check. The same threshold is lenient on large pull requests and strict on small ones.

That behavior is often what you want. A small pull request with an untested line is usually a fix whose fix was never exercised, and asking for one test there is cheap. But if your project has many small pull requests that touch hard-to-test code, such as error handling for rare system failures, a high threshold will fail them often. In that case, lower the threshold, or exclude those lines from coverage with your coverage tool's exclusion markers so that the exclusion is visible in the code and reviewed with it.

As a starting point, 80% is a common choice because it forces most changed code to be tested while leaving room for a few lines that are not worth a test. Setting 100% is reasonable only on a project where every line is already expected to be tested and exclusion markers are used for the exceptions; anywhere else it will block correct pull requests over a single defensive line.

## No service in the loop

patchcov needs only two things that already exist on your CI machine: the git history and the coverage report. Because both are local, it computes the result in the same job that ran the tests, and the job's exit status is the gate.

This differs from the usual setup in three concrete ways. Your coverage report, which lists your file paths and line numbers, is never uploaded anywhere. There is no token to store as a secret and no external outage that can block merges. And the result is ready when the job finishes, rather than when a service has processed the upload and posted a status, so a failed check always corresponds to the commit that was tested.

## Running it

As a command, point patchcov at the base branch and the coverage report, and give it a threshold if you want it to fail:

```sh
patchcov --base origin/main --coverage coverage/lcov.info --fail-under 80
```

It prints each uncovered changed line by file and line number, then the covered and coverable counts and the percentage, and exits with a non-zero status if patch coverage is below the threshold. Without `--fail-under`, it reports and always exits successfully, which is the mode to use while you decide whether to gate. The README lists the supported coverage report formats and every option.

As a GitHub Action, add a step after your tests:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0

- name: Run tests with coverage
  run: make coverage   # produces coverage/lcov.info

- name: Patch coverage
  uses: patchcov/patchcov@v1
  with:
    coverage: coverage/lcov.info
    fail-under: 80
```

The `fetch-depth: 0` line matters. By default, `actions/checkout` fetches only the latest commit, so the merge base with the base branch is not in the local history, and patchcov cannot compute the diff from the correct starting point. Fetching the full history fixes this.

To make the check a gate, mark the job as a required status check in your branch protection settings. Until you do, a failure is visible on the pull request but does not prevent merging, which is a reasonable way to run it during the trial period described above.

## Summary

Patch coverage is the share of a change's coverable added and modified lines that the tests ran. It is computed against the merge base, so other people's work is not counted, and it ignores lines the coverage tool does not consider coverable. It tells you exactly which changed lines no test reached, but not whether the tests that reached the other lines checked anything, and it cannot see coverage lost outside the diff.

Gate on it when your coverage report includes every test job, gives the same result on every run, and excludes code your tests are not meant to reach. Choose the threshold knowing that each uncovered line costs 100 divided by the number of coverable changed lines in percentage points. When those conditions hold, patchcov gives every pull request a precise list of what it left untested, from inside your own CI job.
