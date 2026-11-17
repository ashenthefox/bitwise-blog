---
type: llm
---

Count the findings that come with a concrete change: one that says what to add, move, cut or reword, and where, so the author could make it without further design work.
PASS if the first finding has such a change and at least two other findings do.
FAIL if the first finding has none, or fewer than three findings in all have one. "Improve this", "consider revising" and "check it in the browser" are not concrete changes.
Do not fail the answer because some other finding or aside has no change.
