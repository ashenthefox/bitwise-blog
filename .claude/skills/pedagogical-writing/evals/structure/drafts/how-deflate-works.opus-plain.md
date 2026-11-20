# How DEFLATE works

If you have ever downloaded a `.zip` file, opened a PNG, unpacked a `.tar.gz`, or loaded a web page served with `Content-Encoding: gzip`, you have used DEFLATE. It may be the most widely deployed compression format in existence. It sits inside gzip, zlib, PNG, ZIP, JAR files, Office documents (which are ZIP files with XML inside), PDF streams, HTTP compression, and a long tail of protocols and file formats that needed "some compression" and reached for the thing that was already everywhere.

DEFLATE is also old. Phil Katz designed it for PKZIP 2 in the early 1990s, and L. Peter Deutsch wrote it up as RFC 1951 in 1996. Newer formats like Zstandard and Brotli beat it on speed, ratio, or both. DEFLATE keeps going anyway: it is good enough, it is patent-free, every platform has a decoder, and the format is frozen, so a file compressed in 1995 still decompresses today.

It is also a very good format to learn from, because it is small enough to understand completely. DEFLATE is two ideas stacked on top of each other:

1. **LZ77** removes *repetition*. If a chunk of the input already appeared earlier, replace it with a short note that says "go back this far and copy this many bytes."
2. **Huffman coding** removes *skew*. Some symbols turn up far more often than others, so give the common ones short bit patterns and the rare ones long bit patterns.

Neither idea is complicated on its own. Most of what makes DEFLATE look intimidating in the spec is the glue: how the output of the first stage is turned into symbols for the second, how the Huffman codes are described compactly enough that sending them doesn't eat the savings, and how bits are packed into bytes. This post walks through each idea, then the glue, then decodes a real stream by hand, then builds a complete decompressor in about 150 lines of Python.

No background in compression is assumed. You should be comfortable reading code and thinking in binary.

## The two kinds of waste

Start with a fact that surprises people: **no lossless compressor can make every input smaller.** The argument is simple counting. There are 2<sup>n</sup> distinct files that are exactly *n* bits long. There are only 2<sup>n</sup> − 1 distinct files that are *shorter* than *n* bits (all the files of length 0, 1, 2, …, n − 1 added together). If a compressor mapped every *n*-bit file to a shorter one, two different inputs would have to share an output, and the decompressor couldn't tell which one to give back. That is the pigeonhole principle, and it means compression is always a bet. A compressor makes some inputs smaller by making others (slightly) larger, and it wins on average only if the inputs you actually feed it are the kind it was designed for.

So what kind of input is DEFLATE betting on? Data that is wasteful in one of two ways.

**Repetition.** Text repeats words and phrases. Source code repeats keywords, indentation, and identifiers. HTML repeats tag names. Log files repeat timestamps and message templates. Even binary formats repeat structures: a table of fixed-size records, a run of zero padding. If you store each repeat in full, you are storing information the reader already has.

**Skew.** Even with no repetition at all, symbols are rarely used evenly. In English text, `e` and space are everywhere and `q` and `z` hardly appear. In a file made of ASCII text, the 128 byte values with the high bit set might never occur. Yet a plain byte-per-character encoding spends exactly eight bits on every symbol, common or rare. That is waste of a different kind. No single symbol is redundant, but the encoding doesn't reflect what is likely.

These two kinds of waste call for two different tools, and that is exactly why DEFLATE has two stages. LZ77 looks for repeated *strings*, at any distance up to 32 KiB back, and replaces them with references. What is left is a stream of tokens: some single bytes that couldn't be matched, and some back-references. That stream is still skewed. Some bytes are much more common than others, short matches are more common than long ones, and nearby matches are more common than distant ones. Huffman coding then squeezes out that skew.

The order matters. Huffman coding first and LZ77 second would work badly, because Huffman's output is a bit stream with no byte alignment and very little visible repetition left for LZ77 to find. Removing repetition first and skew second lets each stage work on the kind of structure it is good at.

## Part one: LZ77

### Saying "same as before"

In 1977 Abraham Lempel and Jacob Ziv published a scheme that is now called LZ77. The idea fits in one sentence: as you write out the data, whenever the next few bytes match something you've already written, write a reference to the earlier copy instead.

Take this phrase:

```
she sells sea shells by the sea shore
```

Read left to right, pretending you are the compressor. The first few characters, `she sells s`, have nothing useful to point back to, so you emit them as they are. Each one is a **literal**. Then you reach `se` with a space in front of it: ` se`. You've seen ` se` before, at the start of ` sells`. So instead of writing those three characters you write a **match**: "go back 6 characters and copy 3."

Continue that way, and a simple compressor turns the phrase into this sequence of tokens (`␣` is a space):

```
s h e ␣ s e l l s  <3,6>  a ␣  <3,14>  <4,11>  b y ␣ t  <5,24>  <4,18>  o r e
```

Each `<length,distance>` pair means "copy `length` bytes, starting `distance` bytes back from the current end of the output." Let's check a couple of them:

- `<3,14>` is reached after writing `she sells sea ` (14 characters). Going back 14 lands on the very first `s`, and copying 3 characters gives `she`, the start of `shells`.
- `<4,11>` comes next. The output is now 17 characters long and ends in `...sea she`. Going back 11 lands on the `l` of `sells`, and copying 4 gives `lls `. Now we have `shells `.
- `<5,24>` copies `he se` from `she sells`, giving the `he se` that runs from `the` into `sea`.

Every character in the original is now covered by exactly one literal or one match: 18 literals plus matches of 3, 3, 4, 5 and 4 bytes, which adds up to 37, the length of the phrase.

Has this saved anything? On a 37-byte phrase, not obviously. A match isn't free; it needs room for a length and a distance. Whether a match beats the literals it replaces depends on how we encode the tokens, which is the job of part two. On real data, where matches are often dozens or hundreds of bytes long and the same phrases recur constantly, LZ77 alone already removes a lot. And here is the important point for what comes later: the token stream is a much *better* input for the second stage than the raw bytes were.

### Decoding is just copying

Here is the thing that makes LZ77 so attractive: decompressing it is almost trivially simple. The decoder keeps the output it has produced so far. A literal gets appended. A match means "look back `distance` bytes in what I've already written, and copy `length` bytes from there onto the end."

```python
def lz77_decode(tokens):
    out = bytearray()
    for t in tokens:
        if t[0] == "literal":
            out.append(t[1])
        else:
            _, length, distance = t
            start = len(out) - distance
            for k in range(length):
                out.append(out[start + k])
    return bytes(out)
```

The decoder never has to search for anything. All the hard work, finding the matches, happened in the compressor. This asymmetry runs through the whole of DEFLATE: compressing well takes effort and choices, and decompressing is mechanical. It's a good trade for the format's typical use. A file is compressed once and decompressed many times, often on weaker hardware, and the decoder never has to guess what the encoder was thinking.

It also means that **the format does not say how to compress.** The DEFLATE spec defines what a valid compressed stream looks like and how to decode it. It does not tell you which matches to choose. Two compressors can produce completely different streams for the same input, both valid, and one can be noticeably smaller than the other. That is why `gzip -1` and `gzip -9` make different files that any gzip can read.

### The overlap trick

Look again at that copy loop. It copies one byte at a time, and it reads from `out` while it writes to `out`. That detail is deliberate, and it gives LZ77 a neat ability for free.

Suppose the input is `abababababab`, twelve characters. A compressor can emit:

```
a  b  <10,2>
```

"Go back 2 and copy 10." But there are only two bytes behind us. How can we copy ten?

Run the loop and see. After the two literals, `out` is `ab`, so `start` is 0.

- k=0: copy `out[0]` (`a`). Output: `aba`
- k=1: copy `out[1]` (`b`). Output: `abab`
- k=2: copy `out[2]`, the `a` we wrote a moment ago. Output: `ababa`
- …and so on until ten bytes have been copied.

The source and the destination overlap, so the copy keeps feeding on its own output. A match whose distance is smaller than its length repeats the last `distance` bytes over and over. With distance 1, it repeats a single byte, which is exactly run-length encoding: `<258,1>` after an `x` produces 258 more `x`s. LZ77 doesn't need a separate mechanism for runs.

This is also a classic bug. If you implement the copy with something like `memcpy` or a slice copy (`out += out[start:start+length]`), you'll copy only the bytes that existed before the copy began, and overlapping matches will come out wrong. Fast decoders do use wide memory copies, but they handle the overlapping case specially. When in doubt, copy byte by byte.

### The window and the limits

In principle a match could point back to anywhere in the data. In practice the compressor has to search for matches, and the decoder has to keep old output around to copy from. Both get expensive if "anywhere" is unbounded. So LZ77 schemes use a **sliding window**: only the most recent *W* bytes are eligible as match sources.

DEFLATE fixes the limits as follows:

- **Distances** run from 1 to 32,768. The window is 32 KiB.
- **Lengths** run from 3 to 258.

The window size is a memory-era decision. In the early 1990s, 32 KiB of buffer was a reasonable amount to demand from a decoder. Today it is tiny, and it is DEFLATE's biggest handicap compared with newer formats, which use windows of megabytes or more. If a paragraph is repeated 40 KiB later, DEFLATE can't see it.

Why must a match be at least 3 bytes long? Because a match isn't free. In the encoding we'll see in part three, even the cheapest match costs about a dozen bits, for its length and its distance together. A literal typically costs somewhere between 5 and 9 bits once Huffman coding has done its work. A two-byte match would rarely beat two literals, and allowing it would bloat the alphabet of possible lengths. So DEFLATE simply doesn't have two-byte matches.

Why 258 as the upper limit? 258 is 3 + 255. The length minus the minimum fits in a single byte, which was convenient for the original implementation. It isn't a deep constant. Longer matches are just split: a run of 1,000 identical bytes becomes a literal followed by a few `<258,1>` matches and a shorter one to finish.

### Finding matches

The decoder's job is easy. The compressor's job is to find good matches, quickly. At every position in the input, it wants to know: of all the places in the last 32 KiB, which one shares the longest prefix with what comes next?

The naive approach tries every earlier position in the window and compares byte by byte. That is up to 32,768 comparisons per input byte, which is far too slow.

The standard trick, used by zlib and most DEFLATE compressors, is a **hash chain**. Since every match is at least 3 bytes long, any useful earlier position must start with the same three bytes as the current one. So:

- Keep a table `head` that maps each 3-byte string to the most recent position where it occurred.
- Keep a second table `prev` that maps each position to the *previous* position with the same 3 bytes.

Together these form a linked list, the chain, of every earlier position starting with a given 3-byte string, newest first. To find candidates for the current position, look up its 3 bytes in `head` and walk the chain. Each step is a real candidate that matches at least the first 3 bytes. You compare further to see how long the match really is.

Here is a small greedy compressor that turns bytes into LZ77 tokens this way:

```python
WINDOW = 32768
MIN_MATCH, MAX_MATCH = 3, 258
MAX_CHAIN = 64

def lz77_tokens(data):
    head = {}   # 3-byte string -> most recent position
    prev = {}   # position -> previous position with the same 3 bytes
    tokens = []
    i, n = 0, len(data)

    def insert(pos):
        if pos + MIN_MATCH <= n:
            key = data[pos:pos + MIN_MATCH]
            if key in head:
                prev[pos] = head[key]
            head[key] = pos

    while i < n:
        best_len, best_dist = 0, 0
        if i + MIN_MATCH <= n:
            candidate = head.get(data[i:i + MIN_MATCH])
            chain = 0
            while (candidate is not None
                   and i - candidate <= WINDOW
                   and chain < MAX_CHAIN):
                length = 0
                limit = min(MAX_MATCH, n - i)
                while (length < limit
                       and data[candidate + length] == data[i + length]):
                    length += 1
                if length > best_len:
                    best_len, best_dist = length, i - candidate
                    if length == limit:
                        break
                candidate = prev.get(candidate)
                chain += 1

        if best_len >= MIN_MATCH:
            tokens.append(("match", best_len, best_dist))
            for k in range(best_len):
                insert(i + k)
            i += best_len
        else:
            tokens.append(("literal", data[i]))
            insert(i)
            i += 1
    return tokens
```

Notice a few details:

- **The chain is capped** (`MAX_CHAIN`). On highly repetitive input, the chain for a common 3-byte string like `"the"` or three zero bytes can get very long. Walking all of it would be slow, and the newest candidates are usually as good as any. The cap is one of the main knobs that separates fast compression levels from thorough ones.
- **Every position is inserted**, even the ones skipped over inside a match. Otherwise a future match could fail to find a source that happens to start in the middle of an earlier match. (zlib's fastest levels skip some of those insertions for long matches, trading a little ratio for speed.)
- **The comparison loop handles overlap naturally.** If `candidate + length` runs past `i`, it is comparing against bytes that will be produced by this very match, which is exactly the overlap trick in reverse.

A real compressor such as zlib uses fixed-size arrays rather than dictionaries, a rolling hash that may produce collisions (so it must still verify matches), and it bounds memory by reusing array slots as the window slides. The structure, though, is just this.

### Greedy vs lazy matching

The compressor above is **greedy**: at each position it takes the longest match it can find, right away. Greedy is fast and often fine, but it can be fooled.

Consider an input where, at position *i*, the longest match is 3 bytes, but at position *i* + 1 a 100-byte match begins. Greedy takes the 3-byte match, which jumps the cursor to *i* + 3, past the start of the better match. It might pick up the tail end of that 100-byte match a bit later, but it has already paid for an extra match token and lost some coverage.

**Lazy matching** fixes the most common version of this. Having found a match at position *i*, the compressor checks position *i* + 1 before committing. If the match there is longer, it emits the byte at *i* as a literal and takes the later match instead. If not, it takes the match at *i* as planned. It costs one extra search per match and often wins a few percent.

zlib's compression levels are mostly combinations of these choices. Levels 1 to 3 use a greedy strategy with short chains. Levels 4 to 9 use lazy matching with progressively longer chains, along with thresholds like "stop searching once you've found a match this long" and "don't bother being lazy if the current match is already good." Level 6, the default, sits in the middle. Level 9 searches hardest, and on most inputs it gains only a little over level 6 at a noticeable cost in time.

Going further, a compressor could choose matches to minimize the *final encoded size*, not just to maximize match lengths. That is **optimal parsing**, and it requires knowing what each literal and match will cost in bits, which depends on the Huffman codes, which depend on the choice of matches. Tools like Google's Zopfli iterate on this circular problem and produce DEFLATE streams several percent smaller than zlib's level 9, at a cost of being orders of magnitude slower. The output is still ordinary DEFLATE. Any decoder can read it.

### What LZ77 leaves behind

After LZ77, the data has become a sequence of tokens, each either a literal byte or a `(length, distance)` pair. On typical input, this stream has some obvious patterns:

- Literals still follow the skew of the original data. In English text, they are mostly lowercase letters and spaces, with common letters far ahead of rare ones.
- Short matches are much more common than long ones. Lengths 3, 4, and 5 dominate.
- Short distances are more common than long ones. Things tend to repeat nearby.

None of this is repetition any more, so LZ77 can't do anything with it. All of it is skew. That is the second stage's job.

## Part two: Huffman coding

### Fixed width is wasteful

Suppose you want to store the eleven-character string `abracadabra`. As ASCII, that is 8 bits per character, 88 bits in total. But only five distinct letters appear: `a`, `b`, `r`, `c`, `d`. Five symbols need only 3 bits each to tell apart (3 bits give 8 combinations), so a custom fixed-width code like this would do:

| symbol | code |
|---|---|
| a | 000 |
| b | 001 |
| r | 010 |
| c | 011 |
| d | 100 |

That's 33 bits. Better, but the counts are wildly uneven:

| symbol | count |
|---|---|
| a | 5 |
| b | 2 |
| r | 2 |
| c | 1 |
| d | 1 |

Nearly half the string is `a`. Spending 3 bits on every `a`, the same as on a `d` that appears once, seems wasteful. What if `a` got a shorter code?

### Variable-length codes and the prefix rule

Let's try giving `a` a single bit. The trouble with variable-length codes is that the reader needs to know where one code ends and the next begins. In a fixed-width code, that is easy: every 3 bits is a symbol. In a variable-length code, we need another guarantee.

Suppose we chose `a = 0`, `b = 01`, `r = 10`. If the decoder sees `010`, is that `a r` (0, 10) or `b a` (01, 0)? It can't tell. The code is ambiguous.

The fix is the **prefix rule**: no code is allowed to be the beginning of another code. If `a` is `0`, then no other code may start with `0`. Every other code must start with `1`. With this rule, decoding is unambiguous and requires no lookahead. Read bits one at a time; as soon as the bits you've read form a complete code, that's your symbol, and you start fresh. (These are often called "prefix codes," which is confusing because the defining property is that no code is a prefix of another. "Prefix-free codes" is the more precise name.)

A clean way to picture a prefix code is a binary tree. Start at the root. Each `0` bit means go left, each `1` means go right. Symbols live only at leaves. Because symbols are only at leaves, you can never pass through one symbol on the way to another, which is exactly the prefix rule. Decoding means walking from the root to a leaf, emitting the symbol there, and jumping back to the root.

Here is a prefix code for our string:

| symbol | code |
|---|---|
| a | 0 |
| b | 100 |
| c | 101 |
| d | 110 |
| r | 111 |

Draw it as a tree: from the root, `0` goes straight to the leaf `a`. `1` goes to an internal node, whose two children are internal nodes that each hold two leaves at depth 3.

```
            (root)
           0/    \1
          a       *
               0/   \1
              *       *
            0/ \1   0/ \1
            b   c   d   r
```

Encoding `abracadabra` with it:

```
a   b   r   a c   a d   a b   r   a
0 100 111 0 101 0 110 0 100 111 0
```

That's 5 × 1 + 2 × 3 + 2 × 3 + 1 × 3 + 1 × 3 = **23 bits**, down from 33 with fixed-width codes and 88 with ASCII. And it decodes without ambiguity: walk the bits from the root, and every time you land on a leaf, emit and restart.

### How short can it get?

Is 23 bits the best we can do? There is a precise answer, from Claude Shannon's information theory. If a symbol has probability *p*, an ideal code would spend log<sub>2</sub>(1/*p*) bits on it. Rare symbols cost more; common ones cost less. A symbol with probability ½ costs 1 bit, probability ¼ costs 2 bits, probability ⅛ costs 3, and so on. The average of this cost over all symbols is the **entropy** of the distribution:

> *H* = Σ *p* × log<sub>2</sub>(1/*p*)

For `abracadabra`, the probabilities are 5/11, 2/11, 2/11, 1/11 and 1/11. The entropy is about 2.04 bits per symbol, or about 22.4 bits for the whole string. No code that assigns a fixed bit pattern to each symbol can beat that on average, given only these frequencies.

Our 23 bits are within a fraction of a bit of the limit. The tiny gap exists because codes must be a whole number of bits long, while the ideal cost of `a`, log<sub>2</sub>(11/5) ≈ 1.14 bits, is not.

Note the phrase "given only these frequencies." Entropy here measures what's achievable by a code that treats each symbol independently. A smarter model that noticed `abra` appears twice could do better. That's precisely what LZ77 is for. Huffman coding works only on the frequencies of single symbols, and doesn't care about order at all.

### Building the tree

In 1951, David Huffman, then a graduate student at MIT, found a simple procedure that produces the best possible prefix code for any set of symbol frequencies. It is a greedy algorithm, and it builds the tree bottom-up:

1. Make a leaf for every symbol, weighted by its count. Put them all in a pool.
2. Take the two items with the smallest weights out of the pool. Make them the two children of a new internal node whose weight is the sum of theirs. Put that node back in the pool.
3. Repeat step 2 until only one item remains. That's the root.

Let's run it on `abracadabra`. The pool starts as:

```
a:5  b:2  r:2  c:1  d:1
```

**Step 1.** The two smallest are `c:1` and `d:1`. Merge them into a node of weight 2.

```
a:5  b:2  r:2  (c,d):2
```

**Step 2.** Now there's a three-way tie at weight 2. Any two will do. Take `b` and `r`.

```
a:5  (c,d):2  (b,r):4
```

**Step 3.** The smallest two are `(c,d):2` and `(b,r):4`. Merge them into a node of weight 6.

```
a:5  ((c,d),(b,r)):6
```

**Step 4.** Merge the last two into the root, weight 11.

The depth of each leaf is its code length: `a` is at depth 1, and `b`, `r`, `c`, `d` are all at depth 3. This is the tree we drew earlier, and its total cost is 23 bits.

What about that tie in step 2? Suppose we had merged `(c,d)` with `b` instead. Then the pool would be `a:5  r:2  (c,d,b):4`, then `a:5  (r,(c,d,b)):6`, then the root. The code lengths would be: `a` 1, `r` 2, `b` 3, `c` 4, `d` 4. Total cost: 5 × 1 + 2 × 2 + 2 × 3 + 1 × 4 + 1 × 4 = 23 bits. A different shape, the same cost. Huffman codes are not unique, but all of them are equally optimal. This will matter later: DEFLATE needs encoder and decoder to agree on an exact code, so the format has to pin one down.

In code, a priority queue (min-heap) does the "take the two smallest" step efficiently. Since DEFLATE only needs code *lengths*, as we'll see, we can track each symbol's depth rather than build an explicit tree:

```python
import heapq

def huffman_lengths(freqs):
    # Each heap entry: (weight, tiebreak, {symbol: depth})
    heap = [(w, i, {s: 0}) for i, (s, w) in enumerate(freqs.items())]
    heapq.heapify(heap)
    if len(heap) == 1:
        return {s: 1 for s in freqs}
    counter = len(heap)
    while len(heap) > 1:
        w1, _, a = heapq.heappop(heap)
        w2, _, b = heapq.heappop(heap)
        merged = {s: d + 1 for s, d in {**a, **b}.items()}
        heapq.heappush(heap, (w1 + w2, counter, merged))
        counter += 1
    return heap[0][2]
```

Every merge pushes all symbols on both sides one level deeper. When a single item remains, each symbol's depth is its code length. The `counter` field breaks ties so Python never has to compare two dictionaries. Running it on the counts of `abracadabra` gives `a` a length of 1 and the other four symbols a length of 3.

### Why it's optimal

You don't need the proof to use Huffman coding, but the intuition is short and worth having.

In any optimal prefix code, the two least frequent symbols can be placed as siblings at the deepest level of the tree. If a more frequent symbol sat deeper than a less frequent one, swapping them would shorten the total. And in an optimal tree, the deepest level always has at least two leaves side by side, because a lone leaf with no sibling could be moved up a level for free.

So it is safe to commit to "the two rarest symbols are siblings." Once you've done that, you can treat the pair as a single combined symbol whose frequency is their sum. Now you have a smaller instance of the same problem: find the optimal tree for one fewer symbol. Every choice Huffman's algorithm makes is safe, and it ends with the optimal tree.

### Where Huffman falls short

Huffman coding is optimal among codes that give each symbol a whole number of bits. That restriction has costs:

- **Every symbol costs at least one bit.** If one symbol has probability 0.99, its ideal cost is about 0.015 bits, but Huffman must spend a whole bit on it. For extremely skewed data, that's a lot of waste. (This is partly why LZ77 matters so much in DEFLATE. Long runs get turned into matches before Huffman ever sees them.)
- **Rounding.** A symbol whose ideal cost is 1.14 bits gets either 1 or 2. On average, Huffman codes land close to the entropy, but the loss can be noticeable on small alphabets.
- **The code has to be transmitted.** The decoder must know the code to read the data. If the code is optimized for this particular data, its description has to be sent too. DEFLATE spends real effort shrinking that description, as we'll see.

Modern formats use **arithmetic coding** or **asymmetric numeral systems (ANS)**, which can spend fractional bits per symbol. Zstandard, for example, uses an ANS variant. Huffman coding is simpler and very fast, and for DEFLATE's purposes it gets most of the gain.

## Part three: putting them together

We now have two tools: LZ77, which turns bytes into a stream of literals and matches, and Huffman coding, which turns a stream of symbols into short bit patterns. DEFLATE's design is about connecting them. The questions are:

- What are the "symbols" that Huffman coding sees, given that LZ77 tokens come in two kinds and matches can have hundreds of possible lengths and tens of thousands of possible distances?
- How does the decoder learn the Huffman codes?
- How are the bits laid out in bytes?

### One alphabet for literals and lengths

A naive design would first send a flag bit for each token, "literal" or "match," then encode the token. DEFLATE does something smarter: it folds the flag into the Huffman code itself.

It defines a single alphabet of 286 symbols, called the **literal/length alphabet**:

- **0–255**: literal bytes.
- **256**: end of block.
- **257–285**: match lengths.

When the decoder reads a symbol and it's below 256, that's a literal byte. If it's 256, the block is over. If it's 257 or above, it's the start of a match, and a distance follows. The question "literal or match?" is answered by the same Huffman code that carries the value, so it costs nothing extra. If literals are common, they get short codes; if matches are common, the length symbols do. Huffman sorts it out.

But there are 256 possible match lengths (3 to 258), and only 29 length symbols. How do they fit? With **extra bits**. Each length symbol stands for a *range* of lengths. After the symbol, the encoder writes a few raw bits that pick the exact length within the range:

| symbol | extra bits | lengths | | symbol | extra bits | lengths |
|---|---|---|---|---|---|---|
| 257 | 0 | 3 | | 271 | 2 | 27–30 |
| 258 | 0 | 4 | | 272 | 2 | 31–34 |
| 259 | 0 | 5 | | 273 | 3 | 35–42 |
| 260 | 0 | 6 | | 274 | 3 | 43–50 |
| 261 | 0 | 7 | | 275 | 3 | 51–58 |
| 262 | 0 | 8 | | 276 | 3 | 59–66 |
| 263 | 0 | 9 | | 277 | 4 | 67–82 |
| 264 | 0 | 10 | | 278 | 4 | 83–98 |
| 265 | 1 | 11–12 | | 279 | 4 | 99–114 |
| 266 | 1 | 13–14 | | 280 | 4 | 115–130 |
| 267 | 1 | 15–16 | | 281 | 5 | 131–162 |
| 268 | 1 | 17–18 | | 282 | 5 | 163–194 |
| 269 | 2 | 19–22 | | 283 | 5 | 195–226 |
| 270 | 2 | 23–26 | | 284 | 5 | 227–257 |
| | | | | 285 | 0 | 258 |

For example, a match of length 20 is sent as symbol 269 followed by the 2-bit value 1 (because 20 is the second value in the range 19–22, and counting starts at 0).

This is a hybrid. The Huffman-coded part captures the skew between "short," "medium," and "long" matches. The extra bits are sent raw, because within a range the exact value is roughly uniform and wouldn't compress well anyway. The ranges get wider as lengths grow, which is roughly logarithmic, so the common short lengths each get their own symbol and the rare long lengths share.

Length 258 is a special case with a symbol all to itself (285) and no extra bits. Long runs of identical bytes produce many maximum-length matches in a row, so making 258 cheap helps. Symbol 284 nominally has room for 227 to 258, but 258 is always sent as 285.

Symbols 286 and 287 also exist in one specific context (the fixed code we'll meet shortly) but never appear in valid data.

### Distances

After a length, the decoder expects a distance. Distances use a **separate alphabet**, with their own Huffman code, because their statistics have nothing to do with literals. There are 30 distance symbols, built the same way, with extra bits widening as the distance grows:

| symbol | extra bits | distances | | symbol | extra bits | distances |
|---|---|---|---|---|---|---|
| 0 | 0 | 1 | | 15 | 6 | 193–256 |
| 1 | 0 | 2 | | 16 | 7 | 257–384 |
| 2 | 0 | 3 | | 17 | 7 | 385–512 |
| 3 | 0 | 4 | | 18 | 8 | 513–768 |
| 4 | 1 | 5–6 | | 19 | 8 | 769–1024 |
| 5 | 1 | 7–8 | | 20 | 9 | 1025–1536 |
| 6 | 2 | 9–12 | | 21 | 9 | 1537–2048 |
| 7 | 2 | 13–16 | | 22 | 10 | 2049–3072 |
| 8 | 3 | 17–24 | | 23 | 10 | 3073–4096 |
| 9 | 3 | 25–32 | | 24 | 11 | 4097–6144 |
| 10 | 4 | 33–48 | | 25 | 11 | 6145–8192 |
| 11 | 4 | 49–64 | | 26 | 12 | 8193–12288 |
| 12 | 5 | 65–96 | | 27 | 12 | 12289–16384 |
| 13 | 5 | 97–128 | | 28 | 13 | 16385–24576 |
| 14 | 6 | 129–192 | | 29 | 13 | 24577–32768 |

Past the first four, the pattern is clear: every two symbols, the number of extra bits goes up by one, and each pair of symbols covers the next doubling of the distance range. So the Huffman code encodes roughly the *magnitude* of the distance (which follows a skewed distribution: nearby is common, far away is rare) and the extra bits fill in the exact value.

The distance alphabet is used only after a length symbol. That's why it can have its own code: the decoder always knows which alphabet it's reading from, based on what it just read.

So, in the end, every LZ77 token becomes:

- **literal**: one literal/length symbol.
- **match**: one literal/length symbol, its extra bits, one distance symbol, its extra bits.

### Blocks

A DEFLATE stream is a sequence of **blocks**. Each block has its own Huffman codes, which lets a compressor adapt as the data changes. A file that starts with English text and ends with a table of numbers benefits from different codes for each part.

Every block begins with a 3-bit header:

- **BFINAL** (1 bit): 1 if this is the last block in the stream.
- **BTYPE** (2 bits): how the block is encoded.
  - `00`: **stored**. No compression. The raw bytes follow.
  - `01`: **fixed Huffman**. Uses a predefined code, built into the spec.
  - `10`: **dynamic Huffman**. The block begins with a description of its own codes.
  - `11`: reserved. A decoder must treat it as an error.

**Stored blocks** exist because some data doesn't compress. Already-compressed data, encrypted data and random bytes all look uniform, so trying to compress them only adds overhead. A stored block skips to the next byte boundary after its header, then has a 16-bit length LEN, then its one's complement NLEN (a simple sanity check), then LEN bytes copied verbatim. The cost is 5 bytes or so per block of up to 65,535 bytes, so DEFLATE never makes incompressible data much bigger. (The pigeonhole principle says it must make *some* data bigger. Stored blocks ensure it's only by a tiny amount.)

**Fixed Huffman blocks** avoid sending a code description, which is useful for short data where the description would cost more than it saves.

**Dynamic Huffman blocks** carry custom codes for this block, tuned to its contents. Almost everything of any size ends up in dynamic blocks.

Both Huffman block types contain the same thing after their codes are established: a sequence of literal/length symbols (with distances where needed), ending with symbol 256.

Block boundaries do not reset the LZ77 window. A match in one block can reach back into data from previous blocks, up to 32 KiB. Only the Huffman codes change.

### Bit order

Before going further, we need to deal with the most confusing detail of DEFLATE: how bits are packed into bytes. It's the part almost everyone gets wrong on the first attempt.

DEFLATE is a bit stream, not a byte stream. Fields have all sorts of widths (1, 2, 3, 5, 7 bits…) and are packed back to back with no regard for byte boundaries. The rules are:

1. **Within each byte, bits are consumed starting from the least significant bit.** The first bit of the stream is bit 0 (the `1` bit) of the first byte. The eighth bit is bit 7 (the `128` bit). Then the next byte starts, again from bit 0.
2. **Ordinary numeric fields** (BFINAL, BTYPE, extra bits, header counts, stored LEN) are packed **least significant bit first**. The first bit you read is the field's 1s place, the second is its 2s place, and so on.
3. **Huffman codes** are packed **most significant bit first**. The first bit you read is the first bit of the code, the one closest to the root of the tree.

Rule 3 sounds like it contradicts rule 2, but it is natural from the decoder's point of view. A Huffman decoder walks the tree one bit at a time from the root. It needs the root-most bit first, whatever that means numerically. A fixed-width number, on the other hand, can be assembled in any order as long as both sides agree, and LSB-first matches the way bits come out of each byte.

Here is a bit reader that implements both. Everything in a DEFLATE decoder rests on it:

```python
class BitReader:
    def __init__(self, data):
        self.data = data
        self.pos = 0      # byte position
        self.bit = 0      # bit position within the current byte

    def read_bit(self):
        if self.pos >= len(self.data):
            raise EOFError("unexpected end of stream")
        b = (self.data[self.pos] >> self.bit) & 1
        self.bit += 1
        if self.bit == 8:
            self.bit = 0
            self.pos += 1
        return b

    def read_bits(self, n):
        # Ordinary fields: least significant bit first.
        value = 0
        for i in range(n):
            value |= self.read_bit() << i
        return value

    def align_to_byte(self):
        if self.bit != 0:
            self.bit = 0
            self.pos += 1
```

A Huffman decoder doesn't use `read_bits`. It calls `read_bit` repeatedly, shifting each new bit in at the bottom, `code = (code << 1) | bit`, so the first bit read ends up as the most significant. That's rule 3.

If you're writing bytes out by hand, it helps to remember that when you write a byte in binary the usual way, with bit 7 on the left, the stream reads it from **right to left**.

### Canonical codes: sending only the lengths

Now for the clever part. A dynamic block has to tell the decoder its Huffman codes. A literal/length code has up to 286 symbols, and each symbol's code can be up to 15 bits long. Sending each code explicitly would be expensive.

DEFLATE's insight is that **you only need to send the code lengths.** Remember that Huffman codes aren't unique. Many different trees have the same set of code lengths, and all of them compress equally well. So DEFLATE picks one specific code for any given set of lengths, called the **canonical Huffman code**, defined by two rules:

1. Shorter codes come before longer codes, numerically (when the codes are compared as if left-aligned).
2. Among codes of the same length, symbols are assigned consecutive values in symbol order.

Given just the list of lengths, both sides can rebuild the exact same codes. The algorithm from RFC 1951 is three short steps:

1. Count how many codes have each length: `bl_count[n]`.
2. Compute the first code of each length. Starting at zero, for each length *n* from 1 up: `code = (code + bl_count[n-1]) << 1`, and that's `next_code[n]`.
3. Go through the symbols in order. Each symbol with a nonzero length *n* gets `next_code[n]`, then `next_code[n]` increases by one.

Let's apply it to `abracadabra`, with symbols in alphabetical order `a b c d r` and lengths `1 3 3 3 3`.

1. `bl_count[1] = 1`, `bl_count[2] = 0`, `bl_count[3] = 4`.
2. `next_code[1] = (0 + 0) << 1 = 0`. `next_code[2] = (0 + 1) << 1 = 2`, which is `10` in binary. `next_code[3] = (2 + 0) << 1 = 4`, which is `100`.
3. `a` (length 1) gets `0`. `b` (length 3) gets `100`. `c` gets `101`. `d` gets `110`. `r` gets `111`.

That is exactly the code we used earlier. Now try the second tree, the one where the tie went the other way, with lengths `a:1, b:3, c:4, d:4, r:2`:

1. `bl_count[1] = 1`, `bl_count[2] = 1`, `bl_count[3] = 1`, `bl_count[4] = 2`.
2. `next_code[1] = 0`. `next_code[2] = (0 + 1) << 1 = 2` (`10`). `next_code[3] = (2 + 1) << 1 = 6` (`110`). `next_code[4] = (6 + 1) << 1 = 14` (`1110`).
3. `a` gets `0`. `b` gets `110`. `c` gets `1110`. `d` gets `1111`. `r` gets `10`.

A valid prefix code with the right lengths, determined entirely by those lengths. So the encoder only needs to send 286 small numbers for literals/lengths and 30 for distances. As we'll see, even those get compressed.

Why does the shift-left trick work? Picture the codes sorted from shortest to longest. All codes of length *n* form a consecutive range. The first code of length *n* + 1 is what you get by taking the code just past the last code of length *n* and appending a `0`, which is what the left shift does. This leaves room so that no longer code starts with a shorter one. That's the prefix rule, built in.

In Python, building a decoder from code lengths takes a few lines. This version stores codes in a dictionary keyed by `(length, code)`, which is slow but easy to follow:

```python
class Huffman:
    def __init__(self, lengths):
        # Canonical construction: count codes of each length,
        # then hand out consecutive codes in symbol order.
        max_len = max(lengths)
        bl_count = [0] * (max_len + 1)
        for n in lengths:
            if n:
                bl_count[n] += 1
        next_code = [0] * (max_len + 2)
        code = 0
        for bits in range(1, max_len + 1):
            code = (code + bl_count[bits - 1]) << 1
            next_code[bits] = code
        self.table = {}
        for symbol, n in enumerate(lengths):
            if n:
                self.table[(n, next_code[n])] = symbol
                next_code[n] += 1
        self.max_len = max_len

    def decode(self, reader):
        # Huffman codes arrive most significant bit first.
        code = 0
        for n in range(1, self.max_len + 1):
            code = (code << 1) | reader.read_bit()
            symbol = self.table.get((n, code))
            if symbol is not None:
                return symbol
        raise ValueError("invalid Huffman code")
```

A symbol with length 0 doesn't appear in the block at all, and gets no code. That matters: in a typical text file, most of the 256 possible byte values never occur, so most literal lengths are zero.

Real decoders replace the dictionary with lookup tables: peek at the next 9 or 10 bits, use them as an index into a table that says "this is symbol X, and it used N bits," with a second-level table for the rare longer codes. That turns decoding into a couple of memory reads per symbol, which is why DEFLATE decompression can run at hundreds of megabytes per second.

### The fixed Huffman code

Fixed Huffman blocks (BTYPE `01`) use code lengths defined in the spec, so nothing has to be sent. For the literal/length alphabet:

| symbols | code length | codes |
|---|---|---|
| 0–143 | 8 | `00110000` – `10111111` |
| 144–255 | 9 | `110010000` – `111111111` |
| 256–279 | 7 | `0000000` – `0010111` |
| 280–287 | 8 | `11000000` – `11000111` |

All 30 distance symbols (plus the two unused ones) get 5-bit codes, which is just the distance symbol in binary: symbol 1 is `00001`, symbol 2 is `00010`, and so on.

These lengths reflect a rough guess at typical data. Bytes 0–143 cover ASCII text, digits and punctuation, and get 8 bits, no worse than raw. High bytes get 9 bits. The most common match lengths and the end-of-block symbol get just 7 bits. It isn't great, but for a short input it beats sending a custom code. The table is canonical too: feed those lengths into the canonical algorithm (including the dummy symbols 286 and 287, which is the only reason they exist) and you get exactly these codes.

A handy consequence: a decoder can tell code lengths apart by their first few bits. Any code whose first 7 bits are at most `0010111` is a 7-bit code. Anything starting `0011` through `1011` or `11000` is an 8-bit code. Anything starting `11001` or higher is a 9-bit code.

### The dynamic header: Huffman-coding the Huffman code

A dynamic block needs to send 286 literal/length code lengths and 30 distance code lengths. That's still a few hundred numbers, each between 0 and 15, which at 4 bits each would be around 160 bytes per block. For a 2 KB block, that overhead hurts.

So DEFLATE compresses the code lengths themselves, using the same two ideas yet again: a little run-length encoding to remove repetition, and a Huffman code to remove skew.

First, the lengths are written as a sequence of symbols from a third, small alphabet, the **code length alphabet**, with 19 symbols:

- **0–15**: a code length of that value.
- **16**: repeat the previous code length 3–6 times (2 extra bits).
- **17**: repeat a length of zero 3–10 times (3 extra bits).
- **18**: repeat a length of zero 11–138 times (7 extra bits).

Runs are extremely common in code length lists. A text file never uses bytes 0–8, for example, so the first nine literal lengths are all zero, and the high byte values 128–255 might all be zero too. Many letters end up with the same length, side by side. Symbol 18 alone can wipe out a gap of up to 138 unused symbols in a few bits.

For instance, if a block's literal lengths start with 97 zeros (no bytes below `a`), the encoder can send symbol 18 with the extra-bits value 86 (because 11 + 86 = 97), then the length for `a`, and so on.

The literal/length lengths and the distance lengths are treated as one long sequence, so a run can even spill over from one into the other.

Then those code-length symbols are themselves Huffman coded, with a code that's custom to this block. Its lengths are sent too, but there are only 19 of them, each 3 bits, so that's cheap.

Here's the complete layout of a dynamic block header, right after the 3 bits of BFINAL and BTYPE:

1. **HLIT** (5 bits): the number of literal/length codes, minus 257. Range 257–286. Trailing symbols beyond this count implicitly have length 0. A block that never uses long matches can leave off the top length symbols.
2. **HDIST** (5 bits): the number of distance codes, minus 1. Range 1–32.
3. **HCLEN** (4 bits): the number of code length codes, minus 4. Range 4–19.
4. **HCLEN + 4** values of 3 bits each: the code lengths for the code length alphabet, in this specific order:

   ```
   16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
   ```

   Lengths not sent (at the end of this list) are zero.
5. **HLIT + 257** literal/length code lengths, followed by **HDIST + 1** distance code lengths, all encoded with the code length code from step 4.

Then the compressed data itself follows, using the two codes built from step 5, until symbol 256.

That strange order in step 4 deserves a comment. The idea is to put the code-length symbols most likely to be used at the front, and the ones least likely to be used at the end. Since only HCLEN + 4 entries are sent, the unused ones at the end can be left out. Symbols 16, 17 and 18 (the repeat codes) and 0 (unused symbols) are almost always used, so they come first. Middle code lengths like 8, 7, 9 and 6 are common. Very short lengths like 1 and 2 and the longest like 15 are rare, so they come last and can usually be dropped.

It's turtles, but only three deep: the data is Huffman coded, the code lengths for that are run-length and Huffman coded, and the code lengths for *that* are sent as plain 3-bit numbers. All of it amounts to a few dozen bytes per block in practice.

Here's the decoder for this header:

```python
CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5,
                     11, 4, 12, 3, 13, 2, 14, 1, 15]

def read_dynamic_tables(r):
    hlit = r.read_bits(5) + 257
    hdist = r.read_bits(5) + 1
    hclen = r.read_bits(4) + 4

    cl_lengths = [0] * 19
    for i in range(hclen):
        cl_lengths[CODE_LENGTH_ORDER[i]] = r.read_bits(3)
    cl_code = Huffman(cl_lengths)

    lengths = []
    while len(lengths) < hlit + hdist:
        sym = cl_code.decode(r)
        if sym < 16:
            lengths.append(sym)
        elif sym == 16:
            if not lengths:
                raise ValueError("repeat with no previous length")
            lengths += [lengths[-1]] * (3 + r.read_bits(2))
        elif sym == 17:
            lengths += [0] * (3 + r.read_bits(3))
        else:
            lengths += [0] * (11 + r.read_bits(7))
    if len(lengths) > hlit + hdist:
        raise ValueError("code lengths overran the header counts")

    return Huffman(lengths[:hlit]), Huffman(lengths[hlit:])
```

### Length limits

There's one more constraint. DEFLATE caps code lengths at **15 bits** for the literal/length and distance codes, and **7 bits** for the code length code (it only has 3 bits per length to send them with).

A plain Huffman tree can get deeper than that. If symbol frequencies follow something like the Fibonacci sequence (1, 1, 2, 3, 5, 8, …), every merge adds one level and you get a long, skinny tree. With a few hundred symbols and lopsided frequencies in a large block, depths past 15 do happen.

So a DEFLATE encoder has to produce **length-limited** Huffman codes. It's a well-studied problem. The optimal solution is the **package-merge** algorithm, which finds the best code with all lengths at most *L*. zlib uses a cheaper heuristic: build the normal Huffman tree, and if any lengths exceed the limit, adjust them by taking leaves from overly deep levels and moving them up, then rebalancing so the code is still valid. The result is slightly worse than optimal in rare cases, which nobody minds.

Whatever the method, the result must still be a valid prefix code. The test for that is the **Kraft inequality**: the sum of 2<sup>−length</sup> over all used symbols can't exceed 1. A code that sums to exactly 1 is *complete*: every possible bit sequence decodes to something. DEFLATE requires codes to be complete, with one carve-out: if only one distance code is used, it can have length 1, leaving the other one-bit pattern unused. A careful decoder checks for over-subscribed and incomplete codes and rejects them, which helps catch corrupted input instead of decoding garbage.

## Worked example: five bytes by hand

Let's decode a real DEFLATE stream bit by bit. Here are five bytes:

```
4B 4C 42 40 00
```

If you have Python handy, `zlib.decompress(bytes.fromhex("4b4c424000"), -15)` will decode them for you. (The `-15` means "raw DEFLATE, 32 KiB window, no wrapper." We'll come back to wrappers.) But let's do it ourselves.

First, write each byte in binary, the usual way, most significant bit on the left:

```
4B = 01001011
4C = 01001100
42 = 01000010
40 = 01000000
00 = 00000000
```

The stream reads each byte from its least significant bit, so flip each one to get the bits in stream order:

```
4B → 1 1 0 1 0 0 1 0
4C → 0 0 1 1 0 0 1 0
42 → 0 1 0 0 0 0 1 0
40 → 0 0 0 0 0 0 1 0
00 → 0 0 0 0 0 0 0 0
```

Now read left to right across all of them.

**Block header.** The first bit is `1`: BFINAL, this is the last block. The next two bits are `1`, `0`. BTYPE is a plain number, so it's read least significant bit first: the 1s place is 1 and the 2s place is 0, giving BTYPE = 1, a **fixed Huffman** block.

```
1 | 1 0 | 1 0 0 1 0 ...
```

**First symbol.** Huffman codes arrive root-first, so now we just append bits one at a time until we have a complete code. The rest of the first byte gives `1 0 0 1 0`. Five bits starting with `10` can't be a 7-bit code (those start with `00`), so we're in 8-bit or 9-bit territory. `10010...` is below `11001`, so it's an 8-bit code. We need three more bits, from the second byte: `0 0 1`. The code is `10010001`, which is 145.

The 8-bit codes `00110000` (48) to `10111111` (191) stand for symbols 0 to 143, so symbol = 145 − 48 = **97**, which is ASCII `a`. Output so far: `a`.

**Second symbol.** The next bits are the rest of the second byte, `1 0 0 1 0`, and then three from the third byte, `0 1 0`. That's `10010010`, 146, symbol **98**, ASCII `b`. Output: `ab`.

**Third symbol.** The rest of the third byte is `0 0 0 1 0`. Starting with `00`, this is a 7-bit code; take two more bits from the fourth byte: `0 0`. The code is `0001000`, which is 8. The 7-bit codes `0000000`–`0010111` stand for symbols 256–279, so this is symbol 256 + 8 = **264**: a match of length **10**, with no extra bits.

**Distance.** A match is always followed by a distance symbol. In a fixed block, that's 5 bits, Huffman-ordered. The next five bits from the fourth byte are `0 0 0 0 1`, which is distance symbol **1**: distance **2**, no extra bits.

The decoder copies 10 bytes starting 2 back. That's the overlap trick: `ab` becomes `abababababab`.

**Fourth symbol.** The last bit of the fourth byte is `0`, followed by `0 0 0 0 0 0` from the fifth byte. That's `0000000`, symbol **256**: end of block. Since BFINAL was set, the stream is done. The two remaining bits of the last byte are padding.

The result is `abababababab`. Twelve bytes became five. The tally:

| field | bits |
|---|---|
| block header | 3 |
| literal `a` | 8 |
| literal `b` | 8 |
| length 10 (symbol 264) | 7 |
| distance 2 (symbol 1) | 5 |
| end of block | 7 |
| padding | 2 |
| **total** | **40** |

This example uses a fixed block because the input is tiny. For anything substantial, a dynamic block's custom code would cut the cost of each literal well below 8 bits, at the price of a header.

## A complete decoder in Python

We've already built every piece: the bit reader, the canonical Huffman decoder, and the dynamic header reader. What remains are the length and distance tables, the fixed code, and two small loops. Here is the rest of a complete DEFLATE decoder:

```python
LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
               35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
                3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
             257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
             8193, 12289, 16385, 24577]
DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
              7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]


def fixed_tables():
    lit = [8] * 144 + [9] * 112 + [7] * 24 + [8] * 8
    dist = [5] * 30
    return Huffman(lit), Huffman(dist)


def inflate_block(r, out, lit_code, dist_code):
    while True:
        sym = lit_code.decode(r)
        if sym < 256:
            out.append(sym)
        elif sym == 256:
            return
        else:
            i = sym - 257
            length = LENGTH_BASE[i] + r.read_bits(LENGTH_EXTRA[i])
            d = dist_code.decode(r)
            distance = DIST_BASE[d] + r.read_bits(DIST_EXTRA[d])
            if distance > len(out):
                raise ValueError("distance reaches before start of output")
            start = len(out) - distance
            for k in range(length):      # byte by byte: copies may overlap
                out.append(out[start + k])


def inflate(data):
    r = BitReader(data)
    out = bytearray()
    while True:
        final = r.read_bits(1)
        btype = r.read_bits(2)
        if btype == 0:
            r.align_to_byte()
            length = r.read_bits(16)
            nlength = r.read_bits(16)
            if length != nlength ^ 0xFFFF:
                raise ValueError("stored block length check failed")
            out += data[r.pos:r.pos + length]
            r.pos += length
        elif btype == 1:
            inflate_block(r, out, *fixed_tables())
        elif btype == 2:
            inflate_block(r, out, *read_dynamic_tables(r))
        else:
            raise ValueError("invalid block type 3")
        if final:
            return bytes(out)
```

Together with `BitReader`, `Huffman`, `CODE_LENGTH_ORDER` and `read_dynamic_tables` from earlier, that's the entire format. You can test it against Python's own zlib:

```python
import zlib

def raw_deflate(data, level=6):
    c = zlib.compressobj(level, zlib.DEFLATED, -15)
    return c.compress(data) + c.flush()

sample = open("/usr/share/dict/words", "rb").read()
for level in (0, 1, 6, 9):
    assert inflate(raw_deflate(sample, level)) == sample
```

Level 0 exercises stored blocks, and the other levels produce dynamic blocks for any input of real size. Short inputs will give you fixed blocks.

A few things this decoder skips that a production one wouldn't:

- **Speed.** It decodes Huffman codes one bit at a time with a dictionary lookup, and is easily a thousand times slower than zlib. The fix is table-driven decoding, as described earlier, plus reading the input in words rather than bits.
- **Validation.** It doesn't check that Huffman codes are complete and not over-subscribed, and it doesn't reject length symbols 286 and 287 or distance symbols 30 and 31 if they appear. A hostile input could slip things past it.
- **Memory.** It keeps the whole output in memory. A streaming decoder only needs the last 32 KiB, the size of the window.
- **Wrappers.** It reads raw DEFLATE only, no zlib or gzip headers. Those are next.

## The wrappers: zlib, gzip, PNG and ZIP

DEFLATE by itself is a bare bit stream. It has no magic number to identify it, no checksum to catch corruption, and no record of the original file name or size. Every format that uses DEFLATE wraps it in something that adds what that format needs.

**zlib** (RFC 1950) is the thinnest wrapper. It's a 2-byte header, the raw DEFLATE stream, and a 4-byte checksum:

- The first byte, CMF, holds the compression method (8, meaning DEFLATE) in its low four bits and the window size in its high four bits. `7` means a 32 KiB window. Together that's `0x78`.
- The second byte, FLG, holds the compression level as a hint, a flag for a preset dictionary, and check bits chosen so that the two header bytes, read as a 16-bit big-endian number, are divisible by 31. This is why zlib streams almost always start with `78 01`, `78 5E`, `78 9C` or `78 DA`, depending on the level.
- The trailer is an **Adler-32** checksum of the uncompressed data, stored big-endian. Adler-32 is fast to compute but weaker than a CRC for short inputs.

The wrapper is called zlib because it was designed alongside the zlib library, by Jean-loup Gailly and Mark Adler, which is also the most widely used DEFLATE implementation. Confusingly, "zlib" thus means both a library and a format, and the library can produce raw DEFLATE, the zlib format, and gzip. In Python's `zlib` module, the `wbits` parameter chooses among them: 9 to 15 for the zlib format, −9 to −15 for raw DEFLATE, and 25 to 31 for gzip.

**gzip** (RFC 1952) is designed for files. Its header is at least 10 bytes:

- Magic number `1F 8B`.
- Compression method, `08` for DEFLATE.
- A flags byte saying which optional fields follow: original file name, comment, extra data, header CRC.
- A 4-byte modification time, an "extra flags" byte, and an operating system byte.

After the optional fields comes the DEFLATE stream, then an 8-byte trailer: a **CRC-32** of the uncompressed data and the uncompressed size modulo 2<sup>32</sup>, both little-endian. A gzip file can also contain several of these "members" back to back. Decompressing it gives the concatenation of their contents, which is why `cat a.gz b.gz > c.gz` works.

HTTP's `Content-Encoding: gzip` uses this format. `Content-Encoding: deflate` was meant to use the zlib format, but some early servers sent raw DEFLATE instead, so robust clients accept either.

**PNG** stores image data as a zlib stream, split across one or more `IDAT` chunks, which concatenate to form a single stream. PNG adds a clever step *before* compression. Each row of pixels is first transformed by a **filter**: None, Sub (subtract the pixel to the left), Up (subtract the pixel above), Average, or Paeth (subtract a prediction from the left, upper, and upper-left neighbours). On a smooth gradient, raw pixel values are all different, but the differences between neighbours are small and similar. Filtering turns a gradient into a stream of small, repetitive numbers, which is exactly the kind of skew and repetition DEFLATE handles well. It's a good illustration of a general principle: compressors are much stronger when the data is first transformed into a form that suits their model.

**ZIP** archives compress each file separately, usually with raw DEFLATE (compression method 8 in the file header). Metadata lives in a per-file local header and in a central directory at the end of the archive. The CRC-32 and sizes for each file are stored there, not in the compressed stream. Compressing each file separately means you can extract one without decompressing the others, at the cost of ratio, since repetition across files isn't shared. A `.tar.gz` makes the opposite trade: it concatenates everything first and compresses the whole tarball as one stream, so similar files help each other, but getting at the last file means decompressing everything before it.

## How encoders make choices

We've said the format leaves the encoder free to make choices. Here are the main ones, and how zlib makes them.

**Which matches to take.** This is the LZ77 stage: hash chains, greedy or lazy matching, chain length limits. It's controlled by the compression level and dominates compression time.

**Where to end blocks.** zlib collects tokens in a buffer and, when the buffer fills (16,384 tokens with the default memory settings) or the input ends, closes the current block. It doesn't try very hard to put block boundaries where the data changes character. Smarter encoders do: they estimate the cost of encoding a range of tokens with one Huffman code versus splitting it in two, and look for splits that pay for an extra header. Zopfli and some other high-effort encoders do this kind of search.

**Which block type to use.** When a block is closed, zlib computes how many bits it would take as a dynamic block (including the header), as a fixed block, and as a stored block, and emits the smallest. This is how DEFLATE avoids blowing up incompressible data, and why short inputs get fixed blocks.

**How to build the codes.** Count symbol frequencies in the block, build length-limited Huffman codes, then encode the code lengths as compactly as possible using the 16, 17 and 18 repeat symbols.

**Flushing.** For streaming uses like network protocols, a sender sometimes needs the receiver to be able to decode everything sent so far, without ending the stream. zlib's "sync flush" closes the current block and then emits an empty stored block, which pads the output to a byte boundary. Its four bytes, `00 00 FF FF` (LEN = 0, NLEN = 0xFFFF), are a familiar sight in network traces. The LZ77 window is preserved across a sync flush, so later data can still refer back to earlier data.

There's also a feature for small inputs: **preset dictionaries**. zlib lets both sides agree in advance on up to 32 KiB of "pretend this came before the data." Matches can then reach back into the dictionary. For short messages with predictable content (say, small JSON records with the same keys), a good dictionary can make a large difference, since otherwise there's nothing in the window to match against at the start. The zlib header has a flag to say a dictionary was used, plus the dictionary's Adler-32 so the receiver can check it has the right one.

## What DEFLATE can't do

DEFLATE has lasted thirty years because it's simple and good enough. But it helps to know where it leaves compression on the table, because that's exactly what newer formats were designed to fix.

**The window is small.** 32 KiB was generous in 1993 and is tiny now. Zstandard and LZMA can use windows of many megabytes, so they find repetition that is far apart: the same block of code in two files in a tarball, the same template on two pages of a document.

**Huffman wastes fractions of bits.** As discussed, every symbol costs a whole number of bits. Arithmetic coding and ANS get closer to the entropy, especially for highly skewed symbols. Zstandard uses an ANS variant, LZMA uses a range coder (a form of arithmetic coding), and both see gains from it.

**No context modeling.** DEFLATE codes each literal with the same Huffman code regardless of what came just before it. In English, the letter after a `q` is almost certainly `u`, but DEFLATE can't exploit that unless LZ77 happens to find a match. Brotli selects among several Huffman codes based on the previous bytes, which captures some of this. Compressors that model context very heavily, like those in the PAQ family, compress far better, but at a huge cost in speed.

**No repeat-offset tricks.** Structured data often has matches at the same distance again and again: fields in fixed-size records, columns in a table. Newer formats keep a short list of recently used distances and let a match say "same distance as last time" very cheaply. DEFLATE has to re-send the distance each time.

**Minimum match of three.** In some binary data, a two-byte match at a repeated distance would be useful. DEFLATE can't express it.

**Everything resets per block, except the window.** Each dynamic block must describe its codes from scratch. There's no way to say "same codes as the previous block, with these tweaks."

Fixing these is most of what separates DEFLATE from its successors. But look at the structure of Zstandard, Brotli, or LZMA, and you'll find the same two ideas: an LZ77-style stage that finds repetition and produces literals and matches, followed by an entropy coding stage that removes skew. The details are more sophisticated, the core is the same. Learn DEFLATE and you've learned the skeleton of almost every general-purpose lossless compressor in use today.

## Wrapping up

DEFLATE is two ideas stacked, plus some careful glue:

- **LZ77** turns repetition into back-references: "copy *length* bytes from *distance* back." Decoding is a simple copy loop, and letting the copy overlap its own output gives run-length encoding for free. Finding good matches is the encoder's problem, solved with hash chains and lazy matching, and the format doesn't dictate how.
- **Huffman coding** turns skew into short codes for common symbols and long codes for rare ones. A greedy merge of the two rarest symbols, repeated, builds an optimal prefix code.
- **The glue** folds literals and match lengths into one alphabet so the code itself answers "literal or match?", gives distances their own alphabet, splits large values into a Huffman-coded bucket plus raw extra bits, sends only code lengths and rebuilds canonical codes from them, compresses those lengths with yet another tiny Huffman code, and packs it all into bytes with an order that takes a moment to get used to.

The best way to understand it is to build it. Take the decoder above, compress a few files with Python's zlib, and decode them. Add tracing to print each literal and match. Then try the other direction: turn the `lz77_tokens` function into a real encoder that emits fixed Huffman blocks, check that zlib can decompress your output, and then work up to dynamic blocks with your own Huffman codes. Once your encoder's output decodes correctly in someone else's decoder, you'll understand DEFLATE better than most people who use it every day, which is to say, almost everyone.
