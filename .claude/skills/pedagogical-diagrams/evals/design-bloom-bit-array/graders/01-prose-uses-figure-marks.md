---
type: llm
---

PASS if the prose around the figure shows the figure's own mark inline wherever it names a drawn part, so a reader can match text and figure without hovering. Either counts:
- an explicit inline glyph or swatch in the part's colour or shape ("a ● set bit"); or
- this blog's `data-ref` spans (`<span data-ref="figure-id:part-id">`), which draw a swatch in the part's colour before the phrase, used on the phrases that name the figure's parts (at least three of them).

FAIL if the prose names parts only in plain words or colour words ("the orange bits"), or uses `data-ref` on fewer than three part names.
