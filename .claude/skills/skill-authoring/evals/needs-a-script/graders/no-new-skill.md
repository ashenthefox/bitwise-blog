---
type: llm
---

This is about whether the answer builds a new skill at all.
PASS if the answer says the check does not need a new skill: it belongs in a check the repo runs (a lint or check script, an npm script, CI, a pre-commit step or a hook), and a skill is unnecessary, or at most an optional thin wrapper that the answer says may not be needed.
FAIL if what the answer recommends building is a new skill (a SKILL.md, with or without a script of its own), even a short one that only runs a script, and it never says the check can do without a new skill.
Mentioning a hook, a pre-commit step or CI neither passes nor fails the answer.
