---
type: llm
---

PASS if this holds of the answer: Besides the quoted "high-level summary" line, it tells the user to look for other rules in the prompt that ask for brevity and to remove or rewrite them. Searching the prompt for words such as "concise", "brief" or "short" counts, and so does dropping the rest of the conciseness block the quoted line came from.
FAIL if the quoted line is the only brevity rule it deals with (delete it, replace it, or keep it for chat only), or if it only proposes a new instruction about length to add.
