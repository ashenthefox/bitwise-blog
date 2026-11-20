# Announcing patchcov

Today we are releasing patchcov, a command and a GitHub Action that answer one question about a pull request: which of the lines this change added or modified did your tests never run? It reads your git diff and the coverage report your test run already produces. It prints a percentage and the exact uncovered lines, and it can fail the build below a threshold you choose. It uploads nothing and needs no account, token or hosted service.

The rest of this post explains what the number means, shows it on a small example, and says when it is a good idea to make it block a merge.

## The problem: the project-wide number hides what a change did

Suppose your CI reports that the project has 80% line coverage, and a pull request arrives. You want to know whether the author tested their change. The project-wide percentage cannot tell you, because it is an average over every executable line in the repository, and a change touches a tiny fraction of them.

Here is a concrete case. Your project has 10,000 executable lines, meaning lines that the coverage tool can mark as run or not run (comments, blank lines and similar are not executable lines). Of these, 8,000 ran during the tests, so coverage is 8,000 divided by 10,000, which is 80.00%.

A pull request adds 17 executable lines. Of those, 14 run during the tests and 3 do not. After the merge there are 10,017 executable lines and 8,014 of them are covered. That is 8,014 divided by 10,017, which is 80.004%, and it displays as 80.00%. The project number did not move at all, yet three new lines have no test. Because the repository is large and the change is small, the average absorbs the gap.

The reverse happens too. A pull request that adds a well-tested file can raise the project number while quietly leaving an old, risky function untested. The project-wide figure answers "how tested is the codebase?" It does not answer "how tested is this change?"

## A worked example

Patch coverage is the answer to the second question. Patch coverage is the fraction of executable lines that a change added or modified which were run by the tests. Here is the 17-line pull request from above, with its details.

The pull request changes two files.

In `billing.py` it adds 12 lines. Three of them are a comment and two blank lines, so they are not executable. The other 9 are executable. The tests run 6 of those 9. The three that never run are lines 41, 42 and 47.

In `report.py` it adds 8 lines, all executable, and the tests run all 8.

The steps are as follows.

1. List the lines the change added or modified, because those are the only lines the author is responsible for in this pull request. Here that is 12 plus 8, which is 20 lines.
2. Discard the lines that are not executable, because a comment cannot be "not tested". That removes the 3 non-executable lines in `billing.py`, leaving 9 plus 8, which is 17 lines.
3. Count how many of those 17 lines the coverage report marks as run. That is 6 in `billing.py` plus 8 in `report.py`, which is 14.
4. Divide: 14 divided by 17 is 0.8235, so patch coverage is 82.35%.

The percentage alone is useful, but the more valuable output is the list of the 3 missed lines, because a reviewer can go straight to `billing.py` lines 41, 42 and 47 and ask whether they matter. If those lines are the error handling for a failed payment, you probably want a test. If they are a defensive check that cannot happen, you may not.

Now compare with the project-wide number, which stayed at 80.00%. Patch coverage reported 82.35%, so you might think it is just a slightly different number. The difference is that patch coverage can swing widely with the change. If the author had tested only 3 of those 17 lines, patch coverage would be 3 divided by 17, which is 17.65%, while the project-wide number would barely move: 8,003 divided by 10,017 is 79.90%. The project number is nearly deaf to the change. Patch coverage hears it clearly.

## The general rule

Given a base (usually the branch you are merging into) and a head (the pull request's code), patchcov does the following.

1. It asks git for the lines that exist in the head and were added or modified relative to the merge base. The merge base is the most recent commit the two branches share. Using it, rather than the tip of the target branch, means commits that landed on the target branch after you branched are not blamed on you.
2. It reads your coverage report and keeps only the changed lines that the report lists as executable.
3. It reports the covered fraction, and lists each uncovered changed line by file and line number.

The reasons behind these choices matter because each has an exception.

Deleted lines are ignored, because they no longer exist in the head, so there is nothing to run. A renamed file with no content changes contributes no changed lines, because the lines themselves did not change. A line whose text you edited counts as changed, because the new behavior of that line is untested until something runs it.

If a change contains no executable lines at all, for example a documentation edit, then the fraction is zero divided by zero, which has no value. patchcov reports that there were no executable changed lines and treats the check as passing, because there is nothing to fail. If you would rather such pull requests were flagged, you will need to do that in your own workflow.

One condition must hold for any of this to be correct: the line numbers in the coverage report must refer to the same version of the files as the diff. If your CI measures coverage on one commit and diffs another, the line numbers drift and the result is wrong. Run the tests on the exact commit you diff. On GitHub, that means the merge commit that `actions/checkout` produces for pull request events, or the pull request head if you diff against the merge base explicitly.

## Running the command

You give patchcov a coverage report and a base to compare with:

```sh
patchcov --coverage coverage.xml --base origin/main
```

The report formats it reads are Cobertura XML and LCOV. Most coverage tools can write one of these: coverage.py can write Cobertura XML, and many JavaScript, Go and Rust tools can write LCOV. The output looks like this for the example above:

```text
Patch coverage: 82.35% (14 of 17 changed executable lines covered)

billing.py   6 of 9   missed lines: 41, 42, 47
report.py    8 of 8
```

To make it a gate, add a minimum:

```sh
patchcov --coverage coverage.xml --base origin/main --min 80
```

With `--min 80`, patchcov exits with a nonzero status when patch coverage is below 80%, which is the signal every CI system understands as a failed step. In the example, 82.35% is at least 80, so it passes. With `--min 90` the same change fails, and the output still lists lines 41, 42 and 47.

Because it needs only git and a file on disk, it works the same on your laptop as in CI. You can run it before pushing, which is often the more useful moment, since you learn about the three missed lines before a reviewer does.

One practical point: your CI must have enough git history to find the merge base. Many CI systems fetch only the latest commit by default (a shallow clone), and then git cannot compute the diff. With `actions/checkout`, set `fetch-depth: 0` to fetch the full history, or fetch enough of the base branch to include the merge base.

## Running it as a GitHub Action

The Action wraps the same command. Run your tests so that they write a coverage report, then add a step:

```yaml
name: tests
on: pull_request

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Run tests with coverage
        run: make test-coverage   # writes coverage.xml
      - name: Check patch coverage
        uses: patchcov/patchcov-action@v1
        with:
          coverage: coverage.xml
          base: origin/${{ github.base_ref }}
          min: 80
```

The step fails if patch coverage is below `min`, and it writes the table of missed lines into the job summary, so a reviewer sees it without opening logs. Everything runs inside the job on the runner you already pay for. No coverage data leaves your repository, which also means the check keeps working for private repositories, forks without access to secrets, and self-hosted runners without outbound internet access.

If you leave out `min`, the step only reports and never fails. That is a deliberate default, and the next section explains why you may want to start there.

## When to gate a pull request on patch coverage

Gate on patch coverage when the number reliably means "the author did not test this line." That is true under three conditions.

First, the tests that cover your code run in the same job that patchcov checks, so that the coverage report is complete. If half your coverage comes from an integration test job that runs separately, the unit test job's report will show many lines as uncovered that are in fact tested elsewhere. The gate would then fail correct pull requests, and people learn to ignore or bypass it. In that case, merge the reports from the jobs first, or do not gate.

Second, the tests are deterministic. If a flaky test sometimes does not run, the same patch can pass on one run and fail on the next, because the lines it exercises appear covered only when it runs. A gate that fails at random costs more trust than it earns.

Third, your team has agreed on a threshold. Choose it by looking at recent history: run patchcov in report-only mode for a few weeks, look at the distribution of patch coverage across merged pull requests, and set the threshold slightly below what most healthy pull requests achieve. A threshold of 100% sounds appealing but is rarely sustainable, because some lines legitimately cannot be tested cheaply, such as a last-resort handler for an operating system error.

Do not gate, and use report-only mode instead, in these cases:

- **Your project has little coverage today.** A gate on new code is a good way to stop the problem from growing, but if you have no test infrastructure yet, a failing check on every pull request is likely to be removed rather than satisfied.
- **Large amounts of generated or vendored code change.** Generated files can produce huge diffs with no meaningful tests. Exclude them from the coverage report, or from the diff, before you gate.
- **Your pull requests are often tiny.** A patch of two executable lines can only score 0%, 50% or 100%, so a threshold of 80% means "both lines must be tested." That is sometimes right and sometimes arbitrary. For small patches, treat a failure as a prompt for a human decision rather than as proof of a problem.

A good compromise is a gate at a modest level, such as 70% or 80%, plus the list of missed lines shown to reviewers. The gate catches pull requests where testing was plainly skipped, and the list lets humans judge the borderline ones.

## Where the number can mislead

Patch coverage inherits every limit of the coverage report it reads. Two limits are worth knowing.

The first is that "covered" means "the line ran", not "the line was checked." A test that calls a function and asserts nothing makes every line in that function covered. So patch coverage can show 100% on a change that is not meaningfully tested. It can prove that a line is untested, since a line that never ran cannot have been verified, but it cannot prove that a line is well tested. Treat a low number as a strong signal and a high number as weak evidence.

The second is that line coverage does not see branches. Consider the single line `return a if x else b`. If the tests only ever make `x` true, the line runs, so it is covered, but the `b` side was never tried. If your coverage tool writes branch data and you want it considered, you need a tool that reads branch data, and patchcov currently measures lines only. The difference can be significant in code with many conditions on one line, and it means patch coverage can be slightly more optimistic than the truth. We cannot say by how much in general, because it depends on how densely your code packs branches into single lines.

## Why we built it without a service

Hosted coverage services compute patch coverage too, and for many teams they are a fine choice. We built patchcov for people who want a smaller arrangement: the answer computed from two inputs they already have, git history and a coverage report, by a program they can run anywhere and read. That gives you a few concrete properties. The result is reproducible, because the same inputs always give the same output. It is auditable, because there is no separate system whose numbers you must trust. It also fails in a visible way, because if the coverage file is missing or the history is too shallow, patchcov exits with an error naming the problem rather than reporting a misleading percentage.

## Try it

Run patchcov on a branch of your own project, in report-only mode first. Look at the lines it lists as missed and ask whether the list matches your sense of what that change left untested. If it does, pick a threshold from your recent history and turn the gate on. If it does not, the likeliest causes are a coverage report generated from a different commit than the diff, or a shallow clone, and the error messages are written to point you at both.

We would like to hear where the numbers surprise you, especially for formats and languages we have not tested well. Open an issue on the repository with the coverage file's format, the diff, and the output you expected.
