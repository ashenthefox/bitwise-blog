# Announcing patchcov

Today we are releasing patchcov, a tool that answers one question about a pull request: of the lines this change added or modified, how many did your tests actually run? It is a command you can run on your laptop and a GitHub Action you can add to a workflow. It reads two things your CI run already has, a coverage report and a git diff. It prints a percentage and the exact lines that were left untested, and it can fail the build when the percentage is too low. It uploads nothing and needs no account, no token and no hosted service.

The rest of this post explains what the number means, works through one example with real figures, says where the number can mislead you, and then says when it is worth making a required check.

## The problem: the project total hides the change

Suppose your project reports 85 percent coverage and a pull request arrives. Did the author test their own code? The project total cannot tell you, because it is dominated by the thousands of lines the pull request never touched.

Two terms first. An executable line is a line that the coverage tool recorded as something that can run, which usually excludes blank lines and comments. Line coverage is the share of executable lines that ran at least once during the test run. Patch coverage applies the same idea to a smaller set: the patch, meaning the lines a pull request adds or modifies. Patch coverage is the share of executable lines in the patch that the tests ran.

## A worked example

Take a project with 10,000 executable lines, of which the tests run 8,500. Its line coverage is 8,500 divided by 10,000, which is 85.00 percent.

A pull request changes one file, `src/discount.py`, adding or modifying 52 lines. Here is how patchcov arrives at its number:

1. **Take the diff between the pull request and its merge base.** The merge base is the commit where the branch left the main branch. We use it because it limits the patch to what the author changed. Comparing against the current tip of main would also count commits that landed on main after the branch started, and the author did not write those.
2. **Keep only the executable lines.** Of the 52 changed lines, 12 are comments, blank lines or a docstring. The coverage report has no entry for them, so they can be neither covered nor uncovered. Counting them would dilute the result for no reason. That leaves 40 executable lines.
3. **Look up each of those 40 lines in the coverage report.** The report says the tests ran 30 of them. The other 10, lines 61 through 70, are an error-handling branch that no test reaches.
4. **Divide.** Thirty covered lines out of 40 executable lines is 75 percent, and patchcov lists lines 61 through 70 as the ones to look at.

Now compare that with the project total. To keep the arithmetic simple, assume all 40 executable lines are new rather than replacements for old ones. After the merge the project has 10,040 executable lines, and the tests run 8,530 of them, so line coverage is 8,530 divided by 10,040, which is 84.96 percent. The total moved from 85.00 to 84.96, a drop of 0.04 percentage points. A rule such as "fail if total coverage falls by more than one point" would pass this pull request, even though a quarter of the new code is untested. That is the gap patch coverage closes: the change was small relative to the project, so the total could not see it, but the patch figure is computed over the change alone.

## The rule, and where it stops being true

Patch coverage is the number of covered executable lines in the patch divided by the number of executable lines in the patch. That is the whole definition. The cases below are the conditions under which the number is trustworthy, and the exceptions where it is not.

**The report and the diff must describe the same commit.** The coverage report refers to lines by number. If you generate it from one commit and compute the diff from another, line 61 in the report may be a different line in the diff, and the answer is wrong without any error message. So run the tests on the exact pull request head that you diff.

**Deleted lines contribute nothing.** A deleted line no longer exists in the new version of the file, so there is nothing to run or not run. If a pull request only deletes code or only edits documentation, it has zero executable changed lines. The ratio is then zero divided by zero, which has no value. A gate should treat that case as passing, because nothing new is untested. Check that your configuration does so before you require the check.

**Reformatting and moved code count as changed.** Git reports a line as modified if any character changed, including indentation. If an automatic formatter rewrites 300 lines in a file with weak tests, patch coverage will be low even though no behavior changed. This is a real exception, and the usual remedy is to land formatting changes in their own pull request, where you can waive the check on purpose.

**Line coverage shows that a line ran, not that its result was checked.** A test that calls a function and asserts nothing still covers every line the function executes. Line coverage also cannot see an untaken branch within one line, such as the second condition in `if a and b`, if that line ran at all. A patch coverage of 100 percent therefore means that no changed line went unexecuted. It does not mean the changes are well tested.

**Small patches give coarse numbers.** If a patch has 4 executable lines and 3 are covered, patch coverage is 75 percent, and a single line moves the figure by 25 points. For a 400-line patch, one line moves it by a quarter of a point. So the same percentage means very different things depending on the patch size, and you should read the line list alongside the percentage.

**Coverage must be complete when the check runs.** If your unit tests run in one job and your integration tests in another, and the code under change is exercised only by the integration tests, a check that sees only the unit test report will call that code untested. Either merge the reports before the check or do not gate on it.

## When to gate a pull request on it

To gate a pull request means to make a check fail so that the pull request cannot merge until the check passes. My recommendation is to gate on patch coverage when three conditions hold, and to measure first if they do not.

The first condition is that coverage is produced on every pull request, in the same workflow, and is complete at the time of the check. This is the last exception above turned into a requirement. Without it the gate will fail pull requests for reasons the author cannot fix.

The second is that your team already treats untested new code as a defect. A gate does not create that agreement. If reviewers regularly approve untested changes on purpose, a failing check will just train people to override it, and it will cost you more than it returns.

The third is that the coverage run is deterministic. If the report changes between two runs of the same commit, because of flaky tests or tests that are skipped depending on timing, then the gate will fail at random and people will stop trusting it.

If those hold, choose the threshold from your own history, not from a round number. Compute patch coverage for the last few dozen merged pull requests. If most of them score above 90 percent, a threshold of 80 percent will catch the outliers without blocking everyday work. Raise it later if the outliers stop appearing.

Do not start at 100 percent. Some lines are not worth testing, such as a defensive branch for a state the program cannot reach, and a 100 percent rule pushes authors toward two bad habits: writing tests that run lines without checking anything, and scattering exclusion comments to make the number pass. Both make the coverage data less truthful, which is the opposite of what you want.

If the conditions do not hold yet, run patchcov without failing the build. Printing the percentage and the uncovered lines in the job log is enough for a few weeks, and it shows you the distribution you need for choosing a threshold. Also keep the gate off where coverage is produced only in a nightly job, where large amounts of generated code are included in the report and cannot be excluded, or where the tests for a repository live in another repository. In those cases the number describes your setup, not the quality of the change.

One GitHub detail matters here. A failing check blocks merging only if you mark it as required in the branch protection rules for the target branch. Without that step, patchcov will report a failure and people can merge anyway.

## Running it

You use patchcov the same way in both forms, and the steps are the same whether you run the command locally or the Action in CI. This is the order:

1. Run your tests with coverage enabled and write the coverage report to a file.
2. Make sure the base commit is present in the checkout. The `actions/checkout` action fetches only one commit by default, which is not enough to find a merge base, so set its `fetch-depth` option to `0` to fetch the full history. This applies to any tool that diffs against the base branch.
3. Run patchcov with three pieces of information: where the coverage report is, which base to compare against, and the minimum patch coverage that should count as passing.
4. Mark the resulting check as required, if you decided to gate.

The output is the percentage, the count of covered and executable changed lines, and the uncovered lines grouped by file, so an author can open each file and see exactly which lines to test. When the percentage falls below the minimum, the command exits with a failing status, and in CI that is what fails the job. The repository README lists the supported coverage report formats and the current option names, and it is the reference to use for exact syntax, because the options may change as the tool develops.

## Why there is no service in the loop

Many coverage tools work by uploading your report to a hosted service, which computes the figures and posts them back. patchcov computes everything on the machine that runs it, from the report and the repository you already have. That has four practical consequences.

First, it works on pull requests from forks. GitHub does not give repository secrets to workflows triggered by pull requests from forks, so a tool that needs an upload token cannot authenticate there, and your contributors outside the organization get no result. patchcov needs no secret.

Second, the result cannot be delayed or lost by an outside outage. If a hosted service is down or slow, your required check hangs or fails through no fault of the author.

Third, your coverage data and your source layout stay inside your CI. That matters if the repository is private and your policy limits where such data goes.

Fourth, you can reproduce any result. The inputs are a commit, a base and a report, so an author can run the same command locally and get the same answer that CI gave, instead of guessing why a remote service computed something different. One caveat: this holds only if the local coverage run matches CI, for example the same test selection and the same excluded files.

The trade-off is that patchcov keeps no history. It will not draw a trend line or compare a pull request to last month. If you want trends, store the printed numbers wherever you keep other build metrics. What patchcov does is answer one precise question for one change, and answer it in a form your CI can enforce.

## Try it

Pick a recent merged pull request, generate its coverage report, and run patchcov against its base. Look first at the uncovered lines it lists, then at whether any of them surprise you. If they do, you have found the kind of gap the project total was hiding, and you now have a number you can decide whether to enforce.
