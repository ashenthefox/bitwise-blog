---
type: llm
---

This is about where the check's logic lives, whatever the answer builds around it.
PASS if the answer says the check itself (does each directory have a SKILL.md, does the name match the directory) is code that gets run: a script, a lint or a repo check, new or existing. Any instructions it writes for Claude only say to run that code and act on what it reports.
FAIL if the answer has Claude do the check by following written steps (list the directories, open each SKILL.md, compare the names), or leaves open whether the check is code or instructions.
Do not fail an answer for putting the check in an existing repo script and not in one bundled with a skill, for recommending no skill at all, or for not mentioning context or tokens.
