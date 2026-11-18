---
type: regex
pattern: '\b(high(?![-\w])|xhigh|max)\b[^.\n]{0,60}\beffort\b|\beffort\b[^.\n]{0,60}\b(high(?![-\w])|xhigh|max)\b|\b(rais\w*|increas\w*|bump\w*|turn(ing)?\s+up|higher)\b[^.\n]{0,30}\beffort\b[\s\S]{0,200}?\b(high(?![-\w])|xhigh|max)\b|\beffort\b[\s\S]{0,200}?\b(high|xhigh)`?\s+or\s+(above|higher)\b'
flags: i
---
