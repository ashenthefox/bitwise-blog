# Form and content

What the picture shows and how it is laid out: the form, what to leave out, hierarchy,
position, and several pictures of one idea. Sources and their strength are in
[sources.md](sources.md). Page examples are figure ids in `docs/how-deflate-works.html`.

## Contents

- Choose the form from the structure of the idea
- Name the one point, then remove the rest
- Hierarchy: what dominates
- Position carries meaning
- Several pictures of one idea
- Show good and bad before the reader judges

## Choose the form from the structure of the idea

Ask what shape the idea has, then draw that shape. The **Congruence Principle** (Tversky,
Morrison & Bétrancourt 2002) says the structure of the graphic should correspond to the
structure of the idea in the reader's head. Larkin & Simon (1987) give the mechanism: a
diagram helps when things used together sit at one location, so an inference is a glance and
not a search. A diagram that does not do this is no better than the sentences.

| The idea has the shape of | Draw | What it makes obvious | In this repo |
| --- | --- | --- | --- |
| containment, a hierarchy | nesting, or a tree | what is inside what; a leaf is an endpoint | `huffman-tree`: no code is the start of another, because every letter is a leaf |
| a sequence | a row read left to right, or a column top to bottom | order, and what a step consumes | `<bh-stepper>` over one figure |
| layout in memory or in a stream | a strip of cells, to scale | adjacency, offsets, how much is where | `window`, `bit-output` |
| messages between parties | `<bh-sequence>` | who talks to whom, in what order | `<bh-sequence>` in a `figure.diagram` |
| states and transitions | a state chart | which moves are possible from here | |
| a quantity split into parts | a bar divided into parts, to scale | which part is most of the whole | `tree-cost`: "how little of the tree is tree" |
| a value that depends on parameters | a plot or a playground | how it changes as one input moves | `<bh-playground>` |
| A before and after | two frames in one fixed layout | what changed | `<bh-versions>` |

Two pictures of one operation can make different properties obvious. Show both and say what
each shows (`window` and `join` are two pictures of the same tokens: positions and copies, then symbols).

**Test.** Say the idea's shape in one phrase ("a tree whose leaves are letters"). If the
figure does not have that shape, either the figure or the phrase is wrong.

**Counter-case.** Congruence is not realism. Tversky et al. note that people hold angles and
lengths in gross categories, so finer distinctions "will not be accurately apprehended": a
route is drawn as turns, not as exact road geometry.

## Name the one point, then remove the rest

Before drawing, write the point as one sentence that the caption can start from ("the two
savings are independent"). Every element must serve that sentence. Heiser & Tversky (2005)
state in their introduction that effective diagrams "abstract the essential information, and
omit information that is irrelevant to the problem or task at hand"; Mayer's coherence
principle found that learners did better when extra material was removed (23 of 23 tests, the
chapter abstract's median effect size 0.86).

- **Cut by asking what the reader loses.** Remove an element; if the point survives, leave
  it out. Realism, decoration and a second idea are the usual cuts. Tversky et al. say
  animations should "lean toward the schematic and away from the realistic", and the same
  holds for a still.
- **Keep the hard part.** What is cut must not be what makes the idea hard. A figure that
  makes the difficulty look already solved teaches a wrong model (see "Simple, but not too
  simple" in `pedagogical-writing`).
- **A real instance, not a symbol.** Draw one concrete case with real values (the example
  string, the 35 bytes), while the prose speaks generally.
- **Say what was simplified**, in the caption: "each block is drawn as wide as the bits it
  costs", "four boxes stand for 512 numbers". This is the figure half of "what not to read
  into a figure". Why each liberty is taken belongs with it
  ([text-and-labels.md](text-and-labels.md)).
- **Seductive detail has a price.** A pretty extra costs working memory that the point needed
  (the meta-analysis behind this is listed in `pedagogical-writing`'s sources: its abstract read, the size unverified).
  Keep it out of the figure; put it in a `.sidenote` or a fold.

## Hierarchy: what dominates

The subject of the current point should dominate; context should recede. Reliably visible,
smallest effective difference: weight, size or an outline on the subject; context in the
neutral grey of the theme, not another hue.

- **Spend one emphasis per frame.** If everything is bold, nothing is. In a stepper, light
  only what the current step teaches and dim the rest (Mayer's signalling principle: 24 of 28
  tests, median d = 0.41 on transfer tests; d = 0.36 for visual cues alone, "with stronger
  effects for certain forms of cueing such as spreading color and weaker effects for other
  forms such as arrows"). The chapter's own limits: it works better "when it is used sparingly
  rather than excessively" and "when the display is complex rather than simple". A cue can
  also move the eye without moving understanding: in Hegarty's 2003 report, readers of an
  animation looked where its cues pointed and understood the mechanism no better.
- **Order by importance, not by data.** The thing the reader must read first goes where
  reading starts (top-left in a left-to-right page), and is the biggest.
- **The Apprehension Principle is the limit.** Differences the eye cannot tell apart at the
  size the figure is shown carry nothing. A label of 5px on a phone is not apprehended: check
  the figure at phone width (`CLAUDE.md`, "Verifying changes").
- Colour is a meaning, not an ornament: see "One colour vocabulary" in
  [text-and-labels.md](text-and-labels.md), and `CLAUDE.md` → Diagrams for `c1`–`c6`.

## Position carries meaning

Place things so that position itself says something, and keep that mapping stable.

- **Things used together go together** (Larkin & Simon). If the reader must compare two
  values, put them next to each other in one frame, not on two figures a screen apart.
  Tversky (2011): "things that are closer conceptually are placed closer on a page".
- **More goes up; time runs the way the reader reads.** Tversky (2011) advises: "use the
  vertical for evaluative dimensions, mapping increases upwards. Use the horizontal for
  neutral dimensions, especially time, mapping increases in reading order." The horizontal
  half follows the reader's script, so it reverses for a right-to-left language, and she
  calls these mappings "incomplete and variable".
- **Align what corresponds.** When two rows describe the same items (symbols and their
  codes), give them the same x so the correspondence is a vertical line the eye follows.
  `decode-table` aligns code lengths, canonical codes and table entries.
- **Keep the layout fixed across the figures of a page.** The same row for the same kind of
  thing each time (input on top, output below) means the reader learns the layout once.
  Change a layout only to mark a change in what is being shown, and say so.
- **Scale is a position too.** When the length of a mark is the quantity, draw it to scale
  and say so (`tree-cost`: "each block is drawn as wide as the bits it costs"), and put an
  anchor mark beside it (the example's 41 bits of data).
- **Side by side for comparison.** Several states in one fixed frame, not a toggle: comparing
  from memory is a memory test (Patel's "show all > show interactivity > show less", moved
  here from `pedagogical-writing`; see [process-diagrams.md](process-diagrams.md)).

## Several pictures of one idea

Two or more pictures of one idea (a tree and a table of the same code) are worth their space
only if each has a stated job. Ainsworth's DeFT framework (2006, read as the author's
manuscript; see [sources.md](sources.md)) names three jobs a second picture can do. It can
**complement** the first (it supports a different process or holds different information),
**constrain** how the first is read (a familiar picture explains an unfamiliar one), or let
the reader **construct** an understanding that neither gives alone. She offers her advice
"as heuristics for guiding experimentation not as cast in stone principles".

- **Say what each is for**, in the prose or the caption: "the tree shows why no code is a
  prefix of another; the table is what the decoder actually reads". The wording is the
  skill's; the three jobs above are what "for" can mean.
- **Use the fewest that do the job.** "It seems wise to use the minimum number of
  representations consistent with the pedagogical function", and "an excessive number of
  representations rarely helps learning".
- **The reader pays to relate them.** "A very large number of studies have observed that
  learners find translating between representations difficult", and the more two pictures
  differ in format, the harder it is. Start with one, add the second when the first has a
  named limit, and say what it fixes.
- **When one picture explains the other, show them together and make the correspondence
  visible.** For this case Ainsworth says "designers must find ways of signalling the
  mapping" and that the two "should be co-present". The cues she lists are "consistent
  labels" and "the same colours to represent the same objects" (Kalyuga et al.'s second
  experiment found the same for text and diagram: colour coding reduced the search for
  referents). Here that is shared colour, an aligned layout, and `data-ref` from the prose.
- **When the reader must combine two pictures, show them together too.** That much is hers.
  Making the mapping visible in this case is the skill's extension, and she warns against
  doing all of it for the reader: if translation is "made too easy", the insight that comes
  from working it out "does not occur". Leave the reader one step, and check it with a
  `details.predict`.
- **When the two only do different jobs, do not invite the reader to map one onto the
  other.** For the complementary case learners "need not understand the relation between
  them", and she notes that learners often try to translate between pictures that sit
  together even when the task does not need it. Consider showing them apart.
- **A picture that only explains another can go once the reader knows the other.** Ainsworth's
  2008 chapter says such a picture "is not necessary if the learner has understood the second
  representation".
- **Never two pictures that say the same thing** with no stated difference.

## Show good and bad before the reader judges

When the reader will use a figure to judge something (is this hash function uniform, is this
filter too full, is this queue healthy), first show one clearly good and one clearly bad
instance, side by side or one after the other, and say what visibly tells them apart. Then
bring in the harder inputs, each chosen to expose a different weakness. A reader who has not
seen both ends cannot tell whether a middling picture is fine.
- Sam Rose, *Hashing* (observed, paraphrased): a good hash's grid looks like TV static, a bad
  one shows a light and dark band; the same two functions then meet random strings, the numbers
  1 to 10,000 as strings, and common English words, and only the bad one changes.
- Page: two 32-bit filters side by side, one with 4 words (few bits set, a lookup for an absent
  word fails) and one with 20 (most bits set, almost every lookup says maybe), with the caption
  naming the fraction of bits set as the thing to read.
- The rule is the skill's synthesis from that pattern; no study read here tests it. It is the
  figure's side of `pedagogical-writing`'s "diagnostic view".
