---
name: advisors
description: Consults the Duncan Sabien shoulder advisor. A subagent answers in his voice from his posts in the local private data and cites the post behind each claim, and a mediator checks those citations. Use only when the user asks for it by name, with `/advisors`, "ask Duncan", "what would Duncan Sabien say about this", "consult my shoulder advisor" or "get the advisor's take". Not for a reflective, decision or writing question that names no advisor, not for writing, restructuring or reviewing an explainer or any other page (pedagogical-writing), and not for the advisor tooling itself (`npm run advisor`, the corpus, the leak check).
---

# Advisors

Puts the user's question to a shoulder advisor: a subagent that answers in one writer's voice,
grounded in that writer's posts on disk. You orchestrate. You are not an advisor voice.

There is one advisor, Duncan Sabien (`advisor-duncan-sabien`). His posts and the profile that
describes his voice are private data under `corpus/private/duncan-sabien/`; the repo's
`corpus/README.md` says why none of it is committed.

## Rules that must survive compaction

1. **No private data, no consultation.** If `corpus/private/duncan-sabien/PROFILE.md` cannot be
   read, stop and tell the user to run `npm run advisor -- link <path to the private data>`.
   Never answer in the advisor's voice from what you remember of his writing: grounding in the
   posts on disk is the whole point.
2. **Pass the user's prompt to the advisor verbatim**, and pass the advisor's and the mediator's
   output to the user verbatim.
3. **One round.** The advisor answers once and the mediator reviews once.
4. **Never write a consultation into a tracked file**, and never present it as his words. It is
   a simulation, and the repo is public.
5. **Fire only on request.** If the user did not ask for the advisor, answer normally.

## Process

### 1. Check the data

Read the first lines of `corpus/private/duncan-sabien/PROFILE.md`. Use `Read` with that exact
path: `corpus/private` is git-ignored, so a search from the repo root never enters it. If the
file is missing, apply rule 1 and stop.

### 2. Note the user's own material (optional)

`corpus/private/thoughts/INDEX.md` and `corpus/private/library/INDEX.md` list the user's notes
and rated sources. Either may be absent, which is fine. If one has an entry on the prompt's
topic, note its path for step 3.

### 3. Ask the advisor

Spawn one subagent:

```text
subagent_type: advisor-duncan-sabien
prompt: <the user's prompt, verbatim>
        <optional, on its own line: "The user has notes at <path> on this topic. Engage with them.">
```

Do not summarise, reword or pre-frame the prompt. If the agent type does not exist, the session
started before the agent file did: say so and ask the user to restart the session.

### 4. Have the mediator review it

Spawn the mediator once:

```text
subagent_type: mediator
prompt: |
  **User's original prompt:**

  <the user's prompt, verbatim>

  ---

  **Advisor response:**

  <the advisor's response, verbatim>
```

If the advisor errored, returned nothing, or said it could not ground a response, skip the
mediator and tell the user what happened.

### 5. Present

In this order:

1. One line: "Consulted Duncan Sabien (a simulation grounded in his posts)."
2. The advisor's response, verbatim.
3. The mediator's review, verbatim.
4. Your own answer, only if the prompt also asked you for something (code as well as advice,
   say). Label it as yours.

## What goes wrong

- **Answering for him.** If you are editing, shortening or summarising what the advisor said,
  stop and paste it.
- **Consulting unasked.** A question about writing craft or a decision that names no advisor
  belongs to you, or to `pedagogical-writing` if it is about an explainer.
- **A second round.** Do not send the mediator's review back to the advisor. The user will ask
  if they want one.
- **The mediator giving its own view.** It checks grounding and holds no position. If its review
  argues the question itself, say so when you present it.
