---
type: llm
---

This is about what the answer says the text of each step should say.
PASS if the answer says the step text should give the reason (why a pointer moves or stays, what the operation does) and leave to the figure what moved, or says to cut step text that only restates what the figure shows.
FAIL if the step text it proposes is a record of the state (slot numbers, "tail 3 → 4", "head = 1, tail = 4, count = 3"), with or without the operation's name, and the answer never says that the text is for the reason and the figure for the move. Naming the operation ("enqueue D") is not a reason by itself.
Do not fail the answer for also putting slot numbers or a count in the figure.
