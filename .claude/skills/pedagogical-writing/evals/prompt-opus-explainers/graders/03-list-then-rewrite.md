---
type: llm
---

PASS if this holds of the answer: It makes finding the problems and rewriting two separate steps: one request returns a list of the problems in the draft, and a later request (or a person, or another model) does the rewrite with that list in hand.
FAIL if it recommends the critique-then-revise loop the user already tried, or if its only alternative is a single new request that both finds the problems and rewrites them, even one in a fresh context. A further option offered beside a passing proposal (skipping the second request, a regex for the phrases) does not fail it.
