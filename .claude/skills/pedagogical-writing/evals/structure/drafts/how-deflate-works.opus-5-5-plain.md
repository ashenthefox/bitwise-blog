# How DEFLATE works

Some piece of software on your computer is almost certainly running DEFLATE right now. It is the compression inside every `.gz` file and every `.zip` archive. It sits under every PNG image and behind most web pages your browser has fetched with `Content-Encoding: gzip`. It is inside PDF streams, Java JARs, Office documents (which are ZIP files), Git's object store, and the zlib library that roughly every program links against. The format was designed in the early 1990s, written down in RFC 1951 in 1996, and has barely changed since.

DEFLATE is also a very good first compression format to learn, because it is two clean ideas stacked on top of each other:

1. **LZ77** removes *repetition*. When a stretch of bytes has appeared before, you replace it with a short note that says "go back this far and copy this many bytes."
2. **Huffman coding** removes *skew*. Some symbols turn up far more often than others, so you give the common ones short bit patterns and the rare ones long bit patterns.

Neither idea is complicated alone. What makes DEFLATE look intimidating is the packaging: the bit order, the length and distance tables, and the "Huffman code that describes another Huffman code" in the block header. These details are small conveniences, not deep magic. Each one exists for a reason you can explain in a sentence or two.

This post goes through the whole thing step by step. We'll start with what compression can and can't do, build LZ77 and Huffman coding separately, and then see how DEFLATE joins them into one bitstream. Along the way we'll decode real bytes by hand. At the end you'll have a complete decompressor in about a hundred lines of Python and a small compressor whose output zlib accepts.

You don't need any background in compression or information theory. You do need to be comfortable with bits, bytes, and reading code.

---

## Part 0: What compression is actually exploiting

### There is no free lunch

Start with an uncomfortable fact: **no lossless compressor can shrink every input.**

The argument is simple counting. There are 2^n different files of exactly n bits. There are only 2^n − 1 files shorter than n bits (that's 1 + 2 + 4 + … + 2^(n−1)). If a compressor turned every n-bit file into a shorter one, at least two different inputs would end up as the same output. A decompressor that gets that output can't know which input you meant. So any lossless scheme that makes some files smaller has to make other files the same size or larger.

This is the pigeonhole principle, and it shapes every design decision that follows. A compressor is a *bet*. It bets that the data you give it has some particular kind of structure, and it rewards inputs with that structure by making them shorter. Inputs without that structure come out about the same size, or a little larger. Try gzipping a file that's already gzipped, or a JPEG, or bytes from `/dev/urandom`. The output is a few bytes *bigger*.

So the useful question isn't "how do we compress data?" It's "what structure does real data usually have, and how do we take advantage of it?"

### Two kinds of structure

DEFLATE bets on two kinds of structure that turn up constantly in files people actually store.

**Repetition.** Real data repeats itself. Source code repeats keywords, identifiers, and indentation. HTML repeats tag names and attribute names. Log files repeat timestamps and message templates. Even English prose repeats common words and word endings. If the string `function` has appeared 200 bytes back, writing it out again costs eight bytes, while saying "copy 8 bytes from 200 back" might cost two or three.

**Skew.** Even without long repeats, some byte values are much more common than others. In English text, `e` and space are very common and `q` and `z` are rare. In most files many of the 256 possible byte values never appear at all. Storing every byte in a fixed 8 bits ignores this. If `e` is forty times more common than `z`, it ought to get a cheaper code.

These are different properties, and you can see that by finding data with one and not the other. The string `abcdefgh` repeated a thousand times has huge repetition but no skew, because all eight letters are equally common. A long string of random letters drawn so that 90% of them are `a` has strong skew but no useful long repeats. A good general-purpose compressor wants to exploit both.

DEFLATE does it in two stages:

```
original bytes
     │
     ▼
┌──────────┐   "literal 'h', literal 'e', ..., copy 7 bytes from 42 back, ..."
│  LZ77    │──────────────────────────────────────────────────────────────▶
└──────────┘
     │  stream of tokens (literals and back-references)
     ▼
┌──────────┐
│ Huffman  │   short bit codes for common tokens, long codes for rare ones
└──────────┘
     │
     ▼
compressed bits
```

LZ77 turns the input into a sequence of *tokens*. Huffman coding then turns those tokens into bits, choosing short bit patterns for the tokens that occur most often. Decompression runs the same pipeline backwards: decode the bits into tokens, then replay the tokens to rebuild the bytes.

Let's build each stage.

---

## Part 1: LZ77, removing repetition

### The idea

In 1977, Abraham Lempel and Jacob Ziv published a paper with the modest title "A Universal Algorithm for Sequential Data Compression." The scheme it described, now called LZ77, rests on one observation: when you're partway through some data, the best predictor of what comes next is often something you've already seen.

So you walk through the input from left to right. At each position you ask: *does the text starting here also appear somewhere in the recent past?* If it does, you emit a **back-reference**, a pair (length, distance), meaning "go back `distance` bytes in what has been output so far and copy `length` bytes from there." If it doesn't, you emit a **literal**, meaning "the next byte is just this byte."

Here's an example. Take the input:

```
the cat sat on the mat
```

Walking through it:

```
position  0: 't'  nothing earlier             → literal 't'
position  1: 'h'                              → literal 'h'
position  2: 'e'                              → literal 'e'
position  3: ' '                              → literal ' '
position  4: 'c'                              → literal 'c'
position  5: 'a'                              → literal 'a'
position  6: 't'                              → literal 't'
position  7: ' '                              → literal ' '
position  8: 's'                              → literal 's'
position  9: "at " appeared at position 5     → copy 3 from distance 4
position 12: 'o'                              → literal 'o'
position 13: 'n'                              → literal 'n'
position 14: " the " ... " " at 3? "the " at 0 → copy 4 from distance 14 (" the"? see below)
...
```

Let's do position 14 properly. The remaining text is ` the mat`. Earlier, at position 3, we have ` cat sat`, which matches only the single space. At position 0 we have `the `, but our text starts with a space, so that doesn't line up. Looking for ` the`: the text before position 14 is `the cat sat on`, and ` the` doesn't occur in it. So the best we can do here is short matches: ` ` alone, and then `the ` (4 bytes, at distance 15 from position 15). The full token stream comes out as:

```
literals: t h e ␣ c a t ␣ s
match:    (length 3, distance 4)     → "at␣"
literals: o n ␣
match:    (length 4, distance 15)    → "the␣"
literal:  m
match:    (length 2, distance ...)   ← too short to be worth it; see below
literals: a t
```

Short inputs like this barely compress, and that's expected. Back-references pay off when there's a lot of history to point into. The point of the example is the *shape* of the output: a mix of raw bytes and "copy from back there" instructions.

### Decoding is trivial

The asymmetry of LZ77 is its biggest selling point: **decompression is trivially simple and fast.** The decoder keeps the output it has produced so far. For a literal it appends the byte. For a back-reference it looks back `distance` bytes and copies `length` bytes forward:

```python
def lz77_decode(tokens):
    out = bytearray()
    for token in tokens:
        if token[0] == 'literal':
            out.append(token[1])
        else:
            _, length, distance = token
            start = len(out) - distance
            for k in range(length):
                out.append(out[start + k])
    return bytes(out)
```

No searching, no tables, no guessing. All of the hard work, which is *finding* the repeats, lands on the compressor. That suits most uses of compression: a file is compressed once and decompressed many times, often on weaker hardware.

### The overlap trick

Look at the copy loop above. It copies one byte at a time and reads `out[start + k]` *after* earlier iterations have already appended to `out`. That matters, because DEFLATE allows a back-reference whose length is **greater than its distance**.

Suppose the output so far ends in `ha`, and the next token is (length 8, distance 2). The decoder starts copying from two bytes back:

```
out = "ha"
copy out[0] = 'h'  → "hah"
copy out[1] = 'a'  → "haha"
copy out[2] = 'h'  → "hahah"      ← this byte didn't exist when the copy began
copy out[3] = 'a'  → "hahaha"
...
                   → "hahahahaha"
```

The copy reads bytes that it wrote itself a moment earlier. The result is that a back-reference with a short distance acts as a **run-length encoder**. A thousand zero bytes compress to one literal zero followed by back-references with distance 1. A repeating 3-byte pattern compresses to three literals and one long back-reference with distance 3.

This is why the copy has to go byte by byte (or at least behave as if it does). If you implement it with `memcpy` or a slice like `out[start:start+length]`, the overlapping case quietly produces wrong output. Fast decoders copy in larger chunks when distance ≥ length and fall back to careful copying when the ranges overlap.

Here's the example we'll come back to later in the post. The string `abcabcabcabc` (12 bytes) becomes:

```
literal 'a'
literal 'b'
literal 'c'
match (length 9, distance 3)
```

Three literals and one back-reference that overlaps itself three times.

### The window, and DEFLATE's limits

In principle, a back-reference could point anywhere in the past. In practice both the compressor and decompressor have to keep that past in memory, and the compressor has to search it. So LZ77 uses a **sliding window**: only the most recent N bytes can be referenced.

DEFLATE fixes these limits:

| Parameter      | Value         |
|----------------|---------------|
| Window size    | 32,768 bytes (32 KiB) |
| Minimum match length | 3 bytes |
| Maximum match length | 258 bytes |
| Distance range | 1 to 32,768 |

The 32 KiB window was a sensible choice for early-1990s PCs, and it's the biggest limitation of DEFLATE today. Repeats further apart than 32 KiB can't be found at all. If a file has two identical 1 MB halves, DEFLATE gains nothing from the second half being a copy of the first. Newer formats use windows of megabytes or more.

The minimum length of 3 is an economic choice. A back-reference costs something to encode, usually somewhere between 10 and 30 bits once all the parts are counted. A literal costs around 8 bits or less. A 2-byte match would rarely beat two literals, so DEFLATE doesn't allow them.

The maximum of 258 looks odd, but it's simply 3 + 255. That is, the length minus the minimum fits in a byte. Longer repeats are just split into several back-references, each up to 258.

### Finding matches: the hard part

Decoding is easy. Encoding means answering, at every position, "what's the longest earlier string in the window that matches the text starting here?" The naive answer is to try every earlier position:

```python
def longest_match_naive(data, i, window=32768):
    best_len, best_dist = 0, 0
    for j in range(max(0, i - window), i):
        length = 0
        while (length < 258 and i + length < len(data)
               and data[j + length] == data[i + length]):
            length += 1
        if length > best_len:
            best_len, best_dist = length, i - j
    return best_len, best_dist
```

That gives the best match, but it does up to 32,768 comparisons per input byte. Compressing a megabyte would take tens of billions of operations, which is far too slow.

The standard fix, used by zlib and by essentially every DEFLATE compressor, is a **hash chain**. The insight is that a match must be at least 3 bytes long, so any useful earlier position must begin with *the same three bytes* as the current position. We can index past positions by their first three bytes and only look at positions that pass that test.

zlib does this with two arrays:

- `head[h]` holds the most recent position whose next three bytes hash to `h`.
- `prev[p]` holds, for position `p`, the previous position with the same hash.

Together they form a linked list per hash value, from newest to oldest. To find matches for position `i`, you hash its three bytes, start at `head[h]`, and follow `prev` links. At each candidate you compare the actual bytes to measure the match length (different strings can share a hash). Then you insert `i` at the front of the chain.

Even with hashing, some chains get very long. In a file full of spaces, for example, every position whose next three bytes are spaces lands on the same chain. So compressors cap how far down the chain they'll go. That cap is the main dial between speed and compression ratio. In zlib, level 6 (the default) follows at most 128 links per position and level 9 follows up to 4096. A few other limits trim the work further. One is a "nice length": once a match is that long, stop searching because it's good enough. Another is a "good length": if we already have a decent match, search less hard for a better one.

Here's a simple version in Python. It uses a dictionary of lists rather than zlib's fixed-size arrays, but the idea is the same:

```python
def find_matches(data, window=32768, max_chain=64):
    chains = {}            # 3-byte string -> list of positions where it starts
    n = len(data)
    i = 0

    def insert(k):
        if k + 3 <= n:
            chains.setdefault(data[k:k+3], []).append(k)

    while i < n:
        best_len, best_dist = 0, 0
        if i + 3 <= n:
            # Walk candidates from most recent to oldest.
            for j in reversed(chains.get(data[i:i+3], [])[-max_chain:]):
                if i - j > window:
                    break                      # everything older is too far
                length = 0
                while (length < 258 and i + length < n
                       and data[j + length] == data[i + length]):
                    length += 1
                if length > best_len:
                    best_len, best_dist = length, i - j
                    if length == 258:
                        break                  # can't do better than the max
        if best_len >= 3:
            yield ('match', best_len, best_dist)
            for k in range(i, i + best_len):
                insert(k)
            i += best_len
        else:
            yield ('literal', data[i])
            insert(i)
            i += 1
```

Notice that the comparison `data[j + length] == data[i + length]` happily runs past position `i` when `j + length >= i`. That's how the compressor finds the overlapping matches described earlier. It compares against the *input*, which the decoder will have rebuilt by the time it needs those bytes.

### Greedy versus lazy

The function above is **greedy**: at each position it takes the longest match available and jumps past it. Greedy parsing is fast, but it isn't always best. Consider:

```
... abc ... bcdefgh ... abcdefgh
                        ^
```

At the marked position, the longest match might be `abc` (3 bytes, from the first occurrence). Greedy takes it, and the next position begins at `d`, where it finds `defgh`. But if we had emitted `a` as a literal and started matching at `b`, we would have found `bcdefgh` (7 bytes) in one go. One literal plus one 7-byte match usually costs less than two separate matches.

zlib's higher levels (4 through 9) use **lazy matching** to catch this. After finding a match at position `i`, the compressor also checks position `i+1`. If the match there is longer, it emits a literal for byte `i` and moves on to the better match, possibly repeating the check. Otherwise it commits to the match at `i`. This is cheap and usually gains a few percent.

You can go further. The truly optimal parse depends on how many bits each token will cost after Huffman coding, and those costs depend on the parse itself. Tools like Google's Zopfli iterate on this: parse, measure the costs, re-parse with the new costs, and repeat. They can produce DEFLATE streams 3–8% smaller than `gzip -9`, at about a hundred times the CPU cost. Every one of those streams is still standard DEFLATE that any decoder can read. That's a nice property of the design: the format only says what the tokens *mean*, and leaves the compressor free to choose them however it likes.

### What LZ77 alone doesn't do

After LZ77 we have a token stream, and it's shorter than the input in *tokens*. But nothing has been made smaller in *bits* yet. If we stored each literal as 9 bits (8 for the byte plus 1 for "this is a literal") and each match as 1 + 8 + 15 bits, we'd compress repetitive data somewhat and expand everything else.

We need an efficient way to write those tokens as bits, one that takes advantage of how lopsided the token frequencies usually are. Space is a much more common literal than `~`. Short distances are much more common than long ones. Matches of length 3 to 10 vastly outnumber matches of length 200. This is exactly the skew that Huffman coding exploits.

---

## Part 2: Huffman coding, removing skew

### Fixed-width codes waste space

Suppose we have a message over a small alphabet. Here's a classic:

```
abracadabra
```

Eleven symbols, five distinct letters. If we give each letter a fixed-width code, we need 3 bits per letter (2 bits gives only 4 combinations, too few for 5 letters). That's 33 bits total, compared with 88 bits as ASCII.

But the letters aren't equally common:

| symbol | count |
|--------|-------|
| a      | 5     |
| b      | 2     |
| r      | 2     |
| c      | 1     |
| d      | 1     |

Almost half the message is `a`. Giving `a` the same 3 bits as `d` treats a symbol that shows up five times the same as one that shows up once. We'd rather pay *less* for `a` and accept paying *more* for `d`, as long as the total goes down.

### Variable-length codes and the prefix property

The catch with variable-length codes is knowing where one code ends and the next begins. Suppose we picked:

```
a = 0
b = 1
r = 01
c = 10
d = 11
```

Then the bit string `01` could be `ab` or `r`. That's ambiguous, so it's useless.

The fix is a **prefix code**: no code may be a prefix of another. If `a = 0`, then no other code can start with `0`. With a prefix code, the decoder reads bits one at a time, and the moment the bits read so far match a code, that's the symbol. No longer code could start the same way, so there's nothing to wait for.

The best way to picture a prefix code is as a **binary tree**. Start at the root. A `0` bit means go left and a `1` bit means go right. Symbols sit at the leaves. Because symbols are only at leaves, no code can be a prefix of another, since reaching a leaf ends the path.

```
        (root)
        /    \
       0      1
      [a]    / \
            0   1
           / \  / \
          0  1 0   1
         [b][c][d][r]
```

This tree gives `a = 0`, `b = 100`, `c = 101`, `d = 110`, `r = 111`. Decoding is a walk down the tree that restarts at the root after each leaf.

The cost of a message is the sum, over symbols, of (count × code length). For `abracadabra` with this tree:

```
a: 5 × 1 = 5
b: 2 × 3 = 6
r: 2 × 3 = 6
c: 1 × 3 = 3
d: 1 × 3 = 3
              ──
              23 bits
```

That's 23 bits versus 33 for fixed width. So how do we find the *best* tree?

### Huffman's algorithm

In 1951, David Huffman was a graduate student at MIT in a course taught by Robert Fano. Students could take a final exam or write a term paper on finding the most efficient binary code. Fano himself had worked on the problem with Claude Shannon and hadn't fully solved it. Huffman, close to giving up and studying for the exam, came up with an algorithm that is provably optimal and absurdly simple:

1. Make a leaf node for each symbol, weighted by its count.
2. Repeatedly take the **two nodes with the lowest weights** and merge them under a new parent whose weight is their sum.
3. Stop when one node remains. That's the root.

The intuition is that the two rarest symbols should be the ones with the longest codes, and in an optimal tree they can always be placed as siblings at the deepest level. Merge them, treat the pair as one symbol, and solve the smaller problem the same way.

For `abracadabra`:

```
start:     a:5  b:2  r:2  c:1  d:1

merge c,d: a:5  b:2  r:2  (cd):2
merge b,r: a:5  (cd):2  (br):4
merge (cd),(br):  a:5  ((cd)(br)):6
merge a, rest:    (a((cd)(br))):11   ← root
```

Each symbol's code length is its depth in the final tree. `a` sits at depth 1 and the other four at depth 3, which is exactly the tree drawn above. (When weights tie, you can merge either pair. Different tie-breaks give different trees with the *same* total cost.)

A neat implementation detail: you don't need to build an explicit tree to get the code lengths. Each merge adds one level above every symbol in both merged groups, so you can just add one to their lengths:

```python
import heapq

def huffman_lengths(freqs):
    """freqs: dict symbol -> count. Returns dict symbol -> code length."""
    heap = [(f, i, [s]) for i, (s, f) in enumerate(freqs.items()) if f > 0]
    heapq.heapify(heap)
    lengths = {s: 0 for s in freqs}
    tiebreak = len(heap)
    while len(heap) > 1:
        f1, _, group1 = heapq.heappop(heap)
        f2, _, group2 = heapq.heappop(heap)
        for s in group1 + group2:
            lengths[s] += 1          # everyone in both groups gets one level deeper
        heapq.heappush(heap, (f1 + f2, tiebreak, group1 + group2))
        tiebreak += 1
    return lengths
```

(The `tiebreak` counter is there so Python never has to compare two lists when weights are equal.)

### How good is "optimal"?

Huffman codes are optimal among codes that assign a whole number of bits to each symbol. How close does that get to the theoretical limit?

Claude Shannon defined that limit in 1948. If symbol *s* occurs with probability *p(s)*, the minimum average number of bits per symbol for *any* lossless code is the **entropy**:

```
H = − Σ p(s) · log₂ p(s)
```

The quantity −log₂ p(s) is the "ideal" code length for a symbol. A symbol with probability 1/2 should cost 1 bit, probability 1/4 should cost 2 bits, probability 1/8 should cost 3 bits, and so on. For `abracadabra`:

```
a: p = 5/11 ≈ 0.455, ideal ≈ 1.14 bits
b: p = 2/11 ≈ 0.182, ideal ≈ 2.46 bits
r: p = 2/11,          ideal ≈ 2.46 bits
c: p = 1/11 ≈ 0.091, ideal ≈ 3.46 bits
d: p = 1/11,          ideal ≈ 3.46 bits

H ≈ 2.04 bits per symbol  →  about 22.4 bits for 11 symbols
```

Huffman gets 23 bits, very close to the limit. The gap comes from rounding: you can't spend 1.14 bits on an `a`, so the code spends 1. You can't spend 2.46 bits on `b`, so it spends 3. In general a Huffman code is within one bit per symbol of the entropy, and usually much closer.

The rounding hurts most when one symbol is *very* common. If a symbol has probability 0.99, its ideal cost is about 0.015 bits, but Huffman has to spend at least 1 bit on it. Arithmetic coding and its modern relative ANS (asymmetric numeral systems) avoid this by effectively spending fractional bits. They're a big part of why newer formats beat DEFLATE. For DEFLATE's purposes, though, the LZ77 stage has already absorbed most of the extreme redundancy (long runs of one byte become back-references), so the token frequencies left over are seldom skewed enough for this to matter much.

### The problem of sending the tree

Here's a practical issue. The decoder needs the same code as the encoder. If the code is built from the data's own symbol frequencies, the encoder has to *send the code* along with the data. Sending it carelessly could cost more than the code saves.

The obvious way to send a tree is to describe its structure, or to send the codes themselves. DEFLATE uses a much more compact trick: **canonical Huffman codes**.

### Canonical Huffman codes

Notice that what makes a Huffman code good is only the *lengths* of the codes. The actual bit patterns don't matter, as long as the code is a prefix code with those lengths. For `abracadabra`, any assignment where `a` has 1 bit and the others have 3 bits is equally good:

```
a=0   b=100 c=101 d=110 r=111
a=1   b=000 c=001 d=010 r=011
a=0   b=111 c=110 d=101 r=100
...
```

So let's agree on a rule that, given only the code lengths, produces one specific code. Then the encoder only has to send the lengths, one small number per symbol. The decoder rebuilds the identical code from them.

DEFLATE's rule is this:

1. Shorter codes come before longer codes, numerically.
2. Among codes of the same length, symbols take consecutive values in alphabet order.

The algorithm from RFC 1951 is short. First count how many codes have each length. Then work out the first code value for each length. Then hand out codes in symbol order:

```python
def canonical_codes(lengths):
    """lengths: list, lengths[symbol] = code length (0 = symbol unused).
       Returns list of (code, length) per symbol."""
    max_len = max(lengths)
    bl_count = [0] * (max_len + 1)
    for l in lengths:
        if l:
            bl_count[l] += 1

    # Smallest code value for each length.
    next_code = [0] * (max_len + 1)
    code = 0
    for bits in range(1, max_len + 1):
        code = (code + bl_count[bits - 1]) << 1
        next_code[bits] = code

    codes = []
    for l in lengths:
        if l:
            codes.append((next_code[l], l))
            next_code[l] += 1
        else:
            codes.append(None)
    return codes
```

The key line is `code = (code + bl_count[bits - 1]) << 1`. Moving from length *k−1* to length *k*, you step past all the codes of length *k−1* and then append a 0 bit. That keeps every longer code from starting with a shorter one.

Let's run it on `abracadabra`, with the alphabet in order `a, b, c, d, r` and lengths `1, 3, 3, 3, 3`:

```
bl_count[1] = 1, bl_count[2] = 0, bl_count[3] = 4

bits=1: code = (0 + 0) << 1 = 0     → next_code[1] = 0  (binary 0)
bits=2: code = (0 + 1) << 1 = 2     → next_code[2] = 2  (binary 10)
bits=3: code = (2 + 0) << 1 = 4     → next_code[3] = 4  (binary 100)

a (len 1): 0
b (len 3): 100
c (len 3): 101
d (len 3): 110
r (len 3): 111
```

That is exactly the tree we drew earlier. The encoder can now send this code as five numbers, `1 3 3 3 3`. For DEFLATE's 286-symbol literal/length alphabet, that means 286 small numbers. That's still a fair amount, and we'll see how DEFLATE compresses those too.

Canonical codes have another benefit. Codes of each length form a contiguous numeric range, so a decoder can tell which length it has by comparing against range boundaries instead of walking a tree. Fast decoders take this further and use lookup tables indexed by the next 9 or 10 bits of input, decoding a whole symbol with one array access.

### Length limits

One more wrinkle. A Huffman tree for a very skewed distribution can be very deep. If counts follow a Fibonacci-like pattern (1, 1, 2, 3, 5, 8, 13, …), the tree degenerates into a long chain and the rarest symbol's code is almost as long as the alphabet is big. Long codes are a pain for decoders, because lookup tables and bit buffers have to be sized for the worst case.

DEFLATE caps code lengths at **15 bits** for literals, lengths, and distances, and at **7 bits** for the "code length" codes we'll meet later. A compressor whose Huffman tree exceeds the limit has to adjust it. zlib uses a heuristic that moves overly deep leaves up and pushes others down to compensate. There's also an optimal algorithm for length-limited codes called *package-merge*. In practice the limit is rarely reached, and the cost of enforcing it is tiny.

---

## Part 3: Stacking them, the DEFLATE token alphabet

We now have both halves. LZ77 produces a stream of tokens: literals (byte values 0–255) and matches (a length from 3 to 258 and a distance from 1 to 32,768). Huffman coding needs a *finite alphabet of symbols* with frequencies. How do we turn the tokens into symbols?

### One alphabet for literals and lengths

The first decision is elegant. DEFLATE merges literals, match lengths, and an end marker into **one alphabet** of 286 symbols, called the *literal/length* alphabet:

| Symbols  | Meaning |
|----------|---------|
| 0–255    | Literal byte with that value |
| 256      | End of block |
| 257–285  | Start of a match; the symbol (plus extra bits) gives the length |

When the decoder reads a literal/length symbol, the value itself tells it what kind of token this is. Below 256 means a literal. 256 means stop. Above 256 means a match is coming, and a distance follows.

This is cleverer than it might first appear. A naive design would send a flag bit before each token ("literal or match?") and then the token itself. Merging the alphabets lets Huffman coding decide how much that distinction costs. In a file that's mostly literals, the match symbols get long codes and the literals get short ones. In a highly repetitive file, it goes the other way. The flag effectively costs a fractional, data-dependent number of bits instead of a full bit every time.

### Lengths: base values plus extra bits

There are 256 possible match lengths (3 through 258), but only 29 length symbols (257–285). DEFLATE groups the lengths into **buckets**. Each length symbol stands for a range of lengths. After the Huffman-coded symbol come a few **extra bits**, written as a plain binary number, that pick a specific length within the range:

| Symbol | Extra bits | Lengths |
|--------|-----------|---------|
| 257 | 0 | 3 |
| 258 | 0 | 4 |
| 259 | 0 | 5 |
| 260 | 0 | 6 |
| 261 | 0 | 7 |
| 262 | 0 | 8 |
| 263 | 0 | 9 |
| 264 | 0 | 10 |
| 265 | 1 | 11–12 |
| 266 | 1 | 13–14 |
| 267 | 1 | 15–16 |
| 268 | 1 | 17–18 |
| 269 | 2 | 19–22 |
| 270 | 2 | 23–26 |
| 271 | 2 | 27–30 |
| 272 | 2 | 31–34 |
| 273 | 3 | 35–42 |
| 274 | 3 | 43–50 |
| 275 | 3 | 51–58 |
| 276 | 3 | 59–66 |
| 277 | 4 | 67–82 |
| 278 | 4 | 83–98 |
| 279 | 4 | 99–114 |
| 280 | 4 | 115–130 |
| 281 | 5 | 131–162 |
| 282 | 5 | 163–194 |
| 283 | 5 | 195–226 |
| 284 | 5 | 227–257 |
| 285 | 0 | 258 |

To encode a length of 100: it falls in symbol 279's range (99–114), so we emit the Huffman code for 279, then the 4-bit number `100 − 99 = 1`.

The buckets are small for short lengths and grow exponentially. After the first eight single-length symbols, each group of four symbols uses one more extra bit than the group before. This matches how lengths are distributed in real data. Short matches are common and each has its own Huffman code, so the frequency differences between length 3, 4, and 5 are captured exactly. Long matches are rare. Huffman coding can't do much with rare symbols anyway, and a plain binary number is about the best you can do for a length somewhere between 131 and 162. Bucketing by order of magnitude keeps the alphabet small, which keeps the table that has to be sent small, while losing almost nothing in compression.

Two quirks are worth noting. Length 258 has its own symbol (285) with zero extra bits, because maximum-length matches are common in very repetitive data (long runs of zeros, for instance) and deserve a cheap code. Also, symbol 284 with 5 extra bits could in principle encode 227 + 31 = 258 as well. The format discourages this, and some decoders reject it, so encoders always use 285 for 258.

### Distances: same trick, separate alphabet

Distances work the same way, with a **separate** alphabet of 30 distance symbols:

| Symbol | Extra bits | Distances |
|--------|-----------|-----------|
| 0 | 0 | 1 |
| 1 | 0 | 2 |
| 2 | 0 | 3 |
| 3 | 0 | 4 |
| 4 | 1 | 5–6 |
| 5 | 1 | 7–8 |
| 6 | 2 | 9–12 |
| 7 | 2 | 13–16 |
| 8 | 3 | 17–24 |
| 9 | 3 | 25–32 |
| 10 | 4 | 33–48 |
| 11 | 4 | 49–64 |
| 12 | 5 | 65–96 |
| 13 | 5 | 97–128 |
| 14 | 6 | 129–192 |
| 15 | 6 | 193–256 |
| 16 | 7 | 257–384 |
| 17 | 7 | 385–512 |
| 18 | 8 | 513–768 |
| 19 | 8 | 769–1024 |
| 20 | 9 | 1025–1536 |
| 21 | 9 | 1537–2048 |
| 22 | 10 | 2049–3072 |
| 23 | 10 | 3073–4096 |
| 24 | 11 | 4097–6144 |
| 25 | 11 | 6145–8192 |
| 26 | 12 | 8193–12288 |
| 27 | 12 | 12289–16384 |
| 28 | 13 | 16385–24576 |
| 29 | 13 | 24577–32768 |

Here the pattern is very clean: every pair of symbols covers a power-of-two range, so the symbol number is roughly twice the base-2 logarithm of the distance. A distance of 1000 is symbol 19 (range 769–1024), with 8 extra bits holding `1000 − 769 = 231`.

Why a separate alphabet? Because the decoder always knows which one it's reading. A distance can only come right after a length symbol, so there's no need to share symbol numbers. Keeping distances separate gives them their own Huffman code, fitted to their own distribution. That distribution is often very skewed in useful ways: structured data like tables, with a fixed record size, tends to produce the same few distances over and over.

### Putting a match together

Here is a complete match, length 100 at distance 1000, as it appears in the bitstream:

```
[Huffman code for lit/len symbol 279]  [4 extra bits: 1]
[Huffman code for distance symbol 19]  [8 extra bits: 231]
```

Four fields, read in that order. Under the fixed Huffman codes we'll see shortly, symbol 279 costs 7 bits and distance symbol 19 costs 5, so the whole match costs 7 + 4 + 5 + 8 = 24 bits. That's 3 bytes to reproduce 100 bytes.

The whole DEFLATE data model is now in place:

- A stream of **literal/length symbols** (0–285), Huffman coded.
- After each length symbol: **extra bits** for the length, then a **distance symbol** (0–29), Huffman coded, then **extra bits** for the distance.
- Symbol **256** ends the current block.

What remains is the container: how the Huffman codes get chosen, how they're sent, and how everything is packed into bytes.

---

## Part 4: The bitstream

### Bits, and which way round they go

Before reading any real DEFLATE data, you need to understand its bit order. This trips up nearly everyone who writes a decoder for the first time.

DEFLATE treats the compressed data as **one long sequence of bits**. Bits are taken from each byte **starting with the least significant bit**: bit 0 of byte 0, then bit 1 of byte 0, …, bit 7 of byte 0, then bit 0 of byte 1, and so on.

Two kinds of value are packed into this sequence, and they go in differently:

1. **Ordinary numbers** (header fields, extra bits, stored-block lengths) are written **least significant bit first**. A 3-bit field with value 5 (binary `101`) goes into the stream as bits `1, 0, 1`, low bit first.
2. **Huffman codes** are written **starting with the first bit of the code**, which is its most significant bit when you think of the code as a number. The code `0010111` goes into the stream as `0, 0, 1, 0, 1, 1, 1`.

Why the split? Packing numbers low-bit-first is natural for a little-endian machine: you can load a 32-bit word and shift it right to pull fields off the bottom. Huffman codes have to be read one bit at a time from the top of the tree, so their "first" bit has to come first in the stream. The RFC simply states both rules.

For decoder authors, this means reading extra bits is easy, but Huffman decoding has to build the code up bit by bit (`code = (code << 1) | next_bit`), or it has to use tables indexed by *bit-reversed* codes. zlib does the latter for speed. For encoder authors, it means Huffman codes are usually bit-reversed before being dropped into a little-endian bit buffer.

Here's a bit reader that follows these rules:

```python
class BitReader:
    def __init__(self, data):
        self.data = data
        self.pos = 0        # index of current byte
        self.bit = 0        # how many bits of the current byte are used up

    def read_bit(self):
        if self.pos >= len(self.data):
            raise EOFError("ran out of input")
        b = (self.data[self.pos] >> self.bit) & 1
        self.bit += 1
        if self.bit == 8:
            self.bit = 0
            self.pos += 1
        return b

    def read_bits(self, n):
        """Read an n-bit number stored least-significant-bit first."""
        value = 0
        for i in range(n):
            value |= self.read_bit() << i
        return value

    def align_to_byte(self):
        """Skip the rest of the current byte."""
        if self.bit:
            self.bit = 0
            self.pos += 1
```

### Blocks

A DEFLATE stream is a sequence of **blocks**. Each block starts with a 3-bit header:

- **BFINAL** (1 bit): 1 if this is the last block in the stream.
- **BTYPE** (2 bits): how this block is encoded.
  - `00`: stored (uncompressed)
  - `01`: compressed with the fixed Huffman codes
  - `10`: compressed with dynamic Huffman codes, sent in the block header
  - `11`: reserved, which is an error

Blocks exist so that the Huffman codes can change partway through the data. A file might start with English text and switch to a table of numbers. One Huffman code fitted to the whole file would suit neither part well. A compressor can end a block wherever it thinks a fresh code would pay for its header and start a new one.

Back-references, though, **can cross block boundaries**. The 32 KiB window is continuous across the whole stream. A match in block 5 can point back into block 4. Blocks reset the Huffman codes, not the history.

There's no block size limit in the format, except that stored blocks max out at 65,535 bytes. zlib ends a compressed block when its internal buffer of pending tokens fills up (around 16K tokens at default settings), and then decides how to encode the block.

### Stored blocks

The simplest block type is just raw bytes:

```
[BFINAL][BTYPE=00]
... skip to the next byte boundary ...
LEN   (2 bytes, little-endian)
NLEN  (2 bytes, little-endian; must equal LEN with every bit flipped)
LEN bytes of raw data
```

Stored blocks are DEFLATE's escape hatch for data that won't compress. Remember the pigeonhole argument: some data *has* to get bigger. Stored blocks make sure "bigger" means only a few bytes of overhead per 64 KiB, rather than the expansion you'd get from forcing random bytes through Huffman codes. A good compressor works out the size of each block all three ways and picks the smallest.

NLEN is a simple integrity check: a corrupted length will almost certainly fail to match its complement. The byte alignment means the data portion can be copied with `memcpy`.

```python
def inflate_stored(reader, out):
    reader.align_to_byte()
    length = reader.read_bits(16)
    nlength = reader.read_bits(16)
    if length != (~nlength & 0xFFFF):
        raise ValueError("stored block length check failed")
    for _ in range(length):
        out.append(reader.read_bits(8))
```

### Fixed Huffman blocks

For small inputs, sending a custom Huffman table might cost more than it saves. So DEFLATE defines a **fixed** pair of codes, built into every decoder, which a block can use without sending any table.

The fixed literal/length code is given by code lengths:

| Symbols | Code length | Codes (binary) |
|---------|-------------|----------------|
| 0–143   | 8 bits | `00110000` – `10111111` |
| 144–255 | 9 bits | `110010000` – `111111111` |
| 256–279 | 7 bits | `0000000` – `0010111` |
| 280–287 | 8 bits | `11000000` – `11000111` |

(Symbols 286 and 287 never appear in valid data, but they're included so that the code is complete.)

The fixed distance code gives all 30 distance symbols 5-bit codes, simply their value in binary. Formally the code is defined over 32 symbols, with 30 and 31 never used.

The lengths encode a rough guess about typical data. Bytes 0–143 cover all of ASCII, including letters, digits, and punctuation, and get 8 bits. Bytes 144–255 are mostly high-bit bytes that are less common in text, and they get 9 bits. End-of-block and the shorter match lengths get 7 bits. Plug these lengths into the canonical code construction from earlier and you get exactly the codes in the right column. You can check: the 7-bit codes come first starting at 0, then the 8-bit codes, then the 9-bit codes.

In code, building the fixed decoders is two lines once we have a general builder (shown below):

```python
FIXED_LIT  = build_decoder([8]*144 + [9]*112 + [7]*24 + [8]*8)
FIXED_DIST = build_decoder([5]*32)
```

### Worked example: decoding by hand

Let's encode some real data with fixed codes, bit by bit. We'll start with the smallest possible example, the one-byte input `a`.

If you run `zlib.compress(b'a')` in Python, you get nine bytes:

```
78 9C 4B 04 00 00 62 00 62
```

The first two bytes are the zlib header and the last four are a checksum, both covered later. The DEFLATE data itself is the three bytes in the middle: `4B 04 00`. Let's see where they come from.

The tokens are a literal `a` (97) and then end-of-block (256). Building the bit sequence:

```
BFINAL = 1                          → 1
BTYPE  = 01 (number 1, LSB first)   → 1 0
literal 97: 8-bit code 0x30 + 97 = 145 = 10010001
                                    → 1 0 0 1 0 0 0 1
end of block 256: 7-bit code 0000000
                                    → 0 0 0 0 0 0 0
```

That's 3 + 8 + 7 = 18 bits. Now pack them into bytes, filling each byte from bit 0 upward:

```
stream bits  0–7:  1 1 0 1 0 0 1 0   → bit7..bit0 = 01001011 = 0x4B
stream bits  8–15: 0 0 1 0 0 0 0 0   → bit7..bit0 = 00000100 = 0x04
stream bits 16–17: 0 0  (+ padding)  →                         0x00
```

`4B 04 00`, as expected. If you've ever wondered why so many zlib streams start with `78 9C 4B`, there's your answer.

Now the more interesting example from earlier, `abcabcabcabc`. Its tokens are three literals and a match of length 9 at distance 3:

```
field           value          bits in stream order
───────────────────────────────────────────────────
BFINAL          1              1
BTYPE           01             1 0
literal 'a'     sym 97  → 145  1 0 0 1 0 0 0 1
literal 'b'     sym 98  → 146  1 0 0 1 0 0 1 0
literal 'c'     sym 99  → 147  1 0 0 1 0 0 1 1
length 9        sym 263 → 7    0 0 0 0 1 1 1
  (no extra bits: 263 means exactly 9)
distance 3      sym 2          0 0 0 1 0
  (no extra bits: distance symbol 2 means exactly 3)
end of block    sym 256 → 0    0 0 0 0 0 0 0
```

Length 9 is symbol 263, which is 256 + 7, so its 7-bit fixed code is the binary for 7, `0000111`. Distance 3 is distance symbol 2, whose 5-bit fixed code is `00010`.

That's 46 bits in total. Packed into bytes:

```
bits  0–7:   1 1 0 1 0 0 1 0   → 0x4B
bits  8–15:  0 0 1 1 0 0 1 0   → 0x4C
bits 16–23:  0 1 0 1 0 0 1 0   → 0x4A
bits 24–31:  0 1 1 0 0 0 0 1   → 0x86
bits 32–39:  1 1 0 0 0 1 0 0   → 0x23
bits 40–45:  0 0 0 0 0 0 (pad) → 0x00
```

Twelve bytes became six: `4B 4C 4A 86 23 00`. Paste those into `zlib.decompress(bytes.fromhex('4b4c4a862300'), -15)` (the `-15` means "raw DEFLATE, no header") and you'll get `b'abcabcabcabc'` back.

Going through one example like this by hand makes the rest of the format far less mysterious. Every DEFLATE stream is just more of the same, apart from the dynamic table header.

### Dynamic Huffman blocks

Fixed codes are a compromise. They're fine for tiny inputs, but for real data you want codes fitted to the actual symbol frequencies of each block. Dynamic blocks (BTYPE `10`) carry their own codes in the block header.

Thanks to canonical Huffman codes, a code is fully described by its list of code lengths. A dynamic block needs two codes, literal/length and distance, so it needs two lists of lengths: up to 286 numbers for one and up to 30 for the other. Each number is between 0 (symbol unused) and 15.

Writing 316 numbers at 4 bits each would cost about 158 bytes per block, which is too much. But those lists of lengths have structure of their own. They contain long runs of zeros (byte values that never occur in the block), runs of repeated values (neighboring byte values that are about equally common), and a skewed spread of values (lengths 7–9 are common, 1 and 15 rare). Does that sound familiar? It's the same repetition and skew that DEFLATE exists to remove. So DEFLATE compresses the code lengths **with run-length coding and another Huffman code**.

The dynamic block header goes like this:

```
HLIT   (5 bits): number of literal/length codes − 257   (257–286)
HDIST  (5 bits): number of distance codes − 1           (1–32)
HCLEN  (4 bits): number of code-length codes − 4        (4–19)

(HCLEN + 4) × 3 bits: code lengths for the "code length alphabet",
                      in a special order (see below)

HLIT + 257 code lengths for the literal/length alphabet  ┐ encoded with
HDIST + 1 code lengths for the distance alphabet         ┘ the code-length code
```

HLIT and HDIST let the encoder cut off the unused tail of each alphabet. If no match in the block is longer than 50, the literal/length list can stop around symbol 275. If all distances are under 4096, the distance list can stop at symbol 23.

**The code length alphabet** has 19 symbols:

| Symbol | Meaning |
|--------|---------|
| 0–15 | A code length of that value |
| 16 | Repeat the previous code length 3–6 times (2 extra bits) |
| 17 | Repeat a zero length 3–10 times (3 extra bits) |
| 18 | Repeat a zero length 11–138 times (7 extra bits) |

Symbols 16–18 are run-length codes. A run of 100 unused byte values becomes one symbol 18 with extra bits `100 − 11 = 89`, instead of 100 separate zeros. Symbol 16 handles runs of any repeated length, such as twelve letters that all got 7-bit codes. Its extra bits work the same way as all the others: a small LSB-first number added to a base.

These 19 symbols get their *own* Huffman code, described by code lengths of 3 bits each (so at most 7). This is the "Huffman code for the Huffman code" that makes the DEFLATE header look so convoluted. Read it as three layers:

```
Layer 1: 3-bit lengths          → build the code-length Huffman code
Layer 2: code-length symbols    → decode into literal/length and distance code lengths
Layer 3: those lengths          → build the two Huffman codes for the block data
```

And then the block data itself is decoded with the layer 3 codes. Each layer is a small instance of the same idea, so a decoder needs only one canonical-Huffman builder, used three times.

**The odd order.** The 3-bit lengths for the code-length alphabet aren't sent in order 0–18. They're sent in this order:

```
16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
```

HCLEN says how many of these are present, and anything past that is length 0, meaning unused. The order places the symbols most likely to be *used* at the front: the run codes, zero, and the mid-range lengths that Huffman codes for bytes usually have. Extreme lengths like 1, 2, 14, and 15 are rarely needed, so they go at the end where HCLEN can cut them off. It saves a few bits per block, which was worth having in 1993.

One more detail: the literal/length and distance code lengths are decoded as **one continuous sequence** of HLIT + 257 + HDIST + 1 values. A run code can cross from the end of the literal/length lengths into the start of the distance lengths. The decoder reads the whole sequence first and then splits it.

Here's the header parsing in code:

```python
CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

def read_dynamic_tables(reader):
    hlit  = reader.read_bits(5) + 257
    hdist = reader.read_bits(5) + 1
    hclen = reader.read_bits(4) + 4

    # Layer 1: lengths for the code-length alphabet, in the odd order.
    cl_lengths = [0] * 19
    for i in range(hclen):
        cl_lengths[CL_ORDER[i]] = reader.read_bits(3)
    cl_table = build_decoder(cl_lengths)

    # Layer 2: decode the literal/length and distance code lengths together.
    lengths = []
    while len(lengths) < hlit + hdist:
        sym = decode_symbol(reader, cl_table)
        if sym < 16:
            lengths.append(sym)
        elif sym == 16:
            if not lengths:
                raise ValueError("repeat code with no previous length")
            lengths += [lengths[-1]] * (3 + reader.read_bits(2))
        elif sym == 17:
            lengths += [0] * (3 + reader.read_bits(3))
        else:  # sym == 18
            lengths += [0] * (11 + reader.read_bits(7))
    if len(lengths) != hlit + hdist:
        raise ValueError("code lengths overran the table")

    # Layer 3: the two codes used for the block data.
    return build_decoder(lengths[:hlit]), build_decoder(lengths[hlit:])
```

How much does all this save? A typical dynamic header for a text block comes to somewhere around 60–80 bytes, against a block of tens of kilobytes. A compressor that's choosing block boundaries can compute the header's exact cost and weigh it against how much better the custom codes fit than the fixed ones.

---

## Part 5: A complete decompressor

We have every piece now. Here's a full, working DEFLATE decompressor ("inflater," in zlib's terminology). It's written for clarity rather than speed. A real implementation decodes Huffman symbols with lookup tables rather than a dictionary, and copies matches in bulk. But it handles every legal DEFLATE stream.

First, the length and distance tables from Part 3, written as base values and extra-bit counts:

```python
LENGTH_BASE  = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
                35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
                3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]

DIST_BASE  = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
              257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
              8193, 12289, 16385, 24577]
DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
              7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
```

Next, the Huffman decoder. `build_decoder` is the canonical code construction from Part 2. Instead of returning a list of codes, it returns a dictionary from (length, code) to symbol, so the decoder can look up the bits read so far:

```python
def build_decoder(lengths):
    max_len = max(lengths)
    bl_count = [0] * (max_len + 1)
    for l in lengths:
        if l:
            bl_count[l] += 1

    next_code = [0] * (max_len + 1)
    code = 0
    for bits in range(1, max_len + 1):
        code = (code + bl_count[bits - 1]) << 1
        next_code[bits] = code

    table = {}
    for symbol, l in enumerate(lengths):
        if l:
            table[(l, next_code[l])] = symbol
            next_code[l] += 1
    return table


def decode_symbol(reader, table):
    code = 0
    length = 0
    while length < 15:
        code = (code << 1) | reader.read_bit()   # Huffman codes arrive first-bit-first
        length += 1
        symbol = table.get((length, code))
        if symbol is not None:
            return symbol
    raise ValueError("invalid Huffman code")
```

The `code << 1 | bit` line is where the "Huffman codes are MSB-first" rule shows up. Each new bit goes on the *right*, so the first bit read ends up as the most significant.

Now the fixed codes:

```python
FIXED_LIT  = build_decoder([8] * 144 + [9] * 112 + [7] * 24 + [8] * 8)
FIXED_DIST = build_decoder([5] * 32)
```

The heart of the decompressor is the loop that decodes a compressed block. It's just the LZ77 decoder from Part 1, with Huffman decoding and extra bits in front:

```python
def inflate_block(reader, out, lit_table, dist_table):
    while True:
        sym = decode_symbol(reader, lit_table)
        if sym < 256:                          # literal
            out.append(sym)
        elif sym == 256:                       # end of block
            return
        elif sym <= 285:                       # match
            i = sym - 257
            length = LENGTH_BASE[i] + reader.read_bits(LENGTH_EXTRA[i])

            d = decode_symbol(reader, dist_table)
            if d >= 30:
                raise ValueError("invalid distance symbol")
            distance = DIST_BASE[d] + reader.read_bits(DIST_EXTRA[d])
            if distance > len(out):
                raise ValueError("distance reaches before start of output")

            start = len(out) - distance
            for k in range(length):            # byte by byte: overlap is allowed
                out.append(out[start + k])
        else:
            raise ValueError("invalid literal/length symbol")
```

And finally the top level, which reads block headers until it sees BFINAL:

```python
def inflate(data):
    reader = BitReader(data)
    out = bytearray()
    while True:
        bfinal = reader.read_bits(1)
        btype = reader.read_bits(2)
        if btype == 0:
            inflate_stored(reader, out)
        elif btype == 1:
            inflate_block(reader, out, FIXED_LIT, FIXED_DIST)
        elif btype == 2:
            lit_table, dist_table = read_dynamic_tables(reader)
            inflate_block(reader, out, lit_table, dist_table)
        else:
            raise ValueError("reserved block type 11")
        if bfinal:
            return bytes(out)
```

That's the whole thing. Together with `BitReader`, `inflate_stored`, and `read_dynamic_tables` from earlier, it's around 120 lines. You can test it against zlib's output:

```python
import zlib

def raw_deflate(data, level=6):
    c = zlib.compressobj(level, zlib.DEFLATED, -15)   # -15: raw DEFLATE, 32K window
    return c.compress(data) + c.flush()

sample = open('/usr/share/dict/words', 'rb').read()
for level in (0, 1, 6, 9):
    assert inflate(raw_deflate(sample, level)) == sample
```

Level 0 exercises stored blocks, and the other levels mostly produce dynamic blocks. To exercise fixed blocks, compress something tiny, or use the compressor in the next section.

A few things this decoder doesn't check, which a production decoder must:

- **Over-subscribed or incomplete codes.** A malicious header can give code lengths that don't form a valid prefix code, for example three symbols all of length 1. zlib rejects these. (There's one allowed exception: a distance code with a single symbol, which is legal and common when a block uses only one distance.)
- **A missing end-of-block code.** A dynamic block whose literal/length code has no code for symbol 256 can never end.
- **Output size limits.** A tiny DEFLATE stream can expand enormously. Long matches of length 258 at a cost of a couple of bits each give a ratio of about 1000:1 per stream, and nested archives multiply that. This is the "zip bomb." Any decoder that accepts untrusted input should cap its output.

---

## Part 6: A (tiny) compressor

Let's go the other way. We'll write a compressor that produces valid DEFLATE using the LZ77 matcher from Part 1 and the fixed Huffman codes. It won't match zlib's compression ratio, but it shows how small the encoder's job is once the format makes sense.

We need a bit writer that mirrors the reader. Numbers go in LSB-first, and Huffman codes get bit-reversed so that their first bit lands in the stream first:

```python
class BitWriter:
    def __init__(self):
        self.out = bytearray()
        self.acc = 0          # pending bits, low bits are the oldest
        self.nbits = 0

    def write_bits(self, value, n):
        """Write an n-bit number, least significant bit first."""
        self.acc |= value << self.nbits
        self.nbits += n
        while self.nbits >= 8:
            self.out.append(self.acc & 0xFF)
            self.acc >>= 8
            self.nbits -= 8

    def write_code(self, code, length):
        """Write a Huffman code, first (most significant) bit first."""
        reversed_code = 0
        for i in range(length):
            reversed_code = (reversed_code << 1) | ((code >> i) & 1)
        self.write_bits(reversed_code, length)

    def finish(self):
        if self.nbits:
            self.out.append(self.acc & 0xFF)
        return bytes(self.out)
```

The fixed literal/length code can be computed directly from the table in Part 4 rather than built:

```python
def fixed_lit_code(sym):
    if sym < 144:
        return 0x30 + sym, 8              # 00110000 ...
    if sym < 256:
        return 0x190 + (sym - 144), 9     # 110010000 ...
    if sym < 280:
        return sym - 256, 7               # 0000000 ...
    return 0xC0 + (sym - 280), 8          # 11000000 ...
```

We also need to map a length or distance to its bucket. A linear search backwards through the base tables does it. Real compressors use precomputed lookup arrays.

```python
def length_index(length):
    for i in reversed(range(len(LENGTH_BASE))):
        if LENGTH_BASE[i] <= length:
            return i

def dist_index(distance):
    for i in reversed(range(len(DIST_BASE))):
        if DIST_BASE[i] <= distance:
            return i
```

Going backwards means length 258 maps to index 28 (symbol 285), not to symbol 284 with extra bits, as the format expects.

And here's the compressor. It writes a single fixed-Huffman block containing every token:

```python
def deflate_fixed(data):
    w = BitWriter()
    w.write_bits(1, 1)                    # BFINAL = 1: this is the only block
    w.write_bits(1, 2)                    # BTYPE = 01: fixed Huffman codes
    for token in find_matches(data):
        if token[0] == 'literal':
            w.write_code(*fixed_lit_code(token[1]))
        else:
            _, length, distance = token
            i = length_index(length)
            w.write_code(*fixed_lit_code(257 + i))
            w.write_bits(length - LENGTH_BASE[i], LENGTH_EXTRA[i])
            d = dist_index(distance)
            w.write_code(d, 5)            # fixed distance codes: 5 bits, value = symbol
            w.write_bits(distance - DIST_BASE[d], DIST_EXTRA[d])
    w.write_code(*fixed_lit_code(256))   # end of block
    return w.finish()
```

Try it:

```python
>>> deflate_fixed(b'abcabcabcabc').hex(' ')
'4b 4c 4a 86 23 00'
>>> zlib.decompress(deflate_fixed(b'abcabcabcabc'), -15)
b'abcabcabcabc'
```

Those are the same six bytes we worked out by hand.

On real text, this compressor typically lands noticeably behind `gzip -6`. The gap comes almost entirely from three places:

1. **Fixed codes instead of fitted ones.** The fixed code spends 8 bits on every ASCII letter. A dynamic code fitted to English text spends 4–5 bits on `e`, `t`, and space and more on rare characters, and it fits the length and distance codes to the actual match statistics too. This is usually the largest gain.
2. **Greedy parsing instead of lazy.** That's worth a few percent.
3. **A single block.** Real compressors start new blocks so the codes can adapt as the data changes.

Adding dynamic blocks to this compressor is a good exercise. Count symbol frequencies over the tokens, run `huffman_lengths` (with a length limit), run-length encode the resulting code lengths with symbols 16/17/18, build a Huffman code for *those*, and write the header in the order described in Part 4. It's tedious but not hard, and when you're done you'll understand DEFLATE better than most people who use it every day.

### What a production compressor decides

To see what makes zlib or a modern successor like libdeflate good, it helps to list the decisions a DEFLATE encoder makes. None of them are dictated by the format:

- **Which matches to emit.** Greedy, lazy, or a cost-based optimal parse. Longer searches find better matches at the price of speed.
- **Where to end blocks.** zlib ends a block when its token buffer fills. Smarter encoders look for points where the statistics change.
- **Which block type to use.** For each block, compute the exact size as stored, fixed, and dynamic, and pick the smallest. zlib does this.
- **How to build the code-length encoding.** There's more than one way to run-length encode the code lengths, and a little cleverness saves bytes in the header.

The decoder doesn't care about any of these choices. That separation, with a fixed and simple decoder and an encoder free to be as clever as it likes, is a big reason DEFLATE has lasted. Compressors from 2026 produce streams that a decoder written in 1993 can read.

---

## Part 7: The wrappers, gzip, zlib, PNG, ZIP

A raw DEFLATE stream has no header, no checksum, and no record of the original size. It is just blocks. Every practical use wraps it in some container. The three main wrappers are worth knowing, because "is this zlib or gzip or raw?" is a common source of confusion and bugs.

### zlib (RFC 1950)

The zlib format adds a 2-byte header and a 4-byte trailer:

```
CMF  (1 byte):  compression method (8 = DEFLATE) and window size
FLG  (1 byte):  flags, including a check value
...  DEFLATE stream ...
ADLER32 (4 bytes, big-endian): checksum of the uncompressed data
```

The first byte is almost always `0x78`: method 8 in the low four bits, and a window size code of 7 (meaning 2^(7+8) = 32 KiB) in the high four bits. The second byte is chosen so that the 16-bit value `CMF × 256 + FLG` is divisible by 31. That's a cheap sanity check that a stream really is zlib. Its top bits also record the compression level as a hint: `78 01` (fastest), `78 5E`, `78 9C` (default), `78 DA` (best). `0x789C` is 30876, which is 31 × 996.

Adler-32 is a fast checksum built from two running sums, modulo 65521. For our input `a`, the first sum is 1 + 97 = 98 = `0x62` and the second is 98, giving `00 62 00 62`. Put it all together and you get the nine bytes we saw: `78 9C | 4B 04 00 | 00 62 00 62`.

zlib wrapping is used inside **PNG** and **PDF**, and by most programs that call the zlib library directly.

### gzip (RFC 1952)

The gzip file format has a larger header, aimed at files:

```
1F 8B          magic number
08             compression method (DEFLATE)
FLG            flags: is there a filename? a comment? extra fields?
MTIME (4)      modification time
XFL            extra flags (hints at compression level)
OS             operating system that created it
[optional fields: original filename, comment, extra data, header CRC]
... DEFLATE stream ...
CRC32 (4 bytes, little-endian): checksum of the uncompressed data
ISIZE (4 bytes, little-endian): uncompressed size, modulo 2^32
```

gzip uses CRC-32 instead of Adler-32. CRC-32 is slower to compute but catches more kinds of errors. The ISIZE field is why `gzip -l` can report the uncompressed size without decompressing. It's also why that size is wrong for files over 4 GiB, since it's stored mod 2^32.

A curious gzip property: two gzip files concatenated together form a valid gzip file, which decompresses to the concatenation of their contents. This is called a multi-member file.

The HTTP `Content-Encoding: gzip` header means exactly this format. There's also `Content-Encoding: deflate`, which by its spec means the *zlib* format, not raw DEFLATE. Some early servers and browsers got this wrong and sent raw DEFLATE, so robust clients still sniff for a zlib header and accept either.

### ZIP

ZIP archives (method number 8) store **raw** DEFLATE streams, one per file, with no zlib or gzip wrapper. The ZIP format's own headers hold the name, sizes, and a CRC-32 for each file, plus a central directory at the end of the archive so you can list the files without reading the whole thing. Because each file is compressed separately, ZIP can extract any single file without decompressing the rest. The tradeoff is that it can't use repetition *between* files the way `tar.gz` can.

### PNG

PNG is worth singling out because it shows what you have to do when your data doesn't naturally fit DEFLATE's bets.

PNG was created in the mid-1990s, partly in response to the patent on LZW, the compression behind GIF. DEFLATE was patent-free, so PNG used it. But raw pixel data compresses poorly with LZ77 and Huffman coding. A smooth gradient has no exact repeats, and its byte values are spread over a wide range.

So PNG **filters** each row of pixels before compression. Each row can be replaced by its differences from the pixel to the left (Sub), from the pixel above (Up), from the average of the two (Average), or from a clever predictor called Paeth. In a smooth gradient, the differences are small numbers, mostly near zero, with heavy skew and plenty of repeats. The filters turn pixel data into the kind of data DEFLATE is good at. The filtered rows are then concatenated, compressed as a single zlib stream, and split across one or more `IDAT` chunks.

The general lesson: if your data doesn't have DEFLATE's kinds of redundancy, transform it until it does. Delta encoding, transposing tables into columns, and sorting are common examples. Much of practical compression engineering is that kind of transformation.

### In Python

Python's `zlib` module handles all three wrappers through one parameter, `wbits`:

```python
zlib.decompress(data, -15)   # raw DEFLATE
zlib.decompress(data, 15)    # zlib wrapper (the default)
zlib.decompress(data, 31)    # gzip wrapper (16 + 15)
zlib.decompress(data, 47)    # auto-detect zlib or gzip (32 + 15)
```

If you ever get `zlib.error: Error -3 while decompressing data: incorrect header check`, it almost always means you passed one format where zlib expected another.

---

## Part 8: DEFLATE's limits, and what came after

DEFLATE is now over thirty years old. It's worth being clear about where it falls short, both to understand why newer formats exist and to see why DEFLATE is still everywhere anyway.

**The 32 KiB window.** This is the big one. Repeats more than 32 KiB apart are invisible. Modern data is often large and repetitive at large scales: think of JSON responses with the same structure throughout, log files, or a codebase with many similar files. Zstandard, Brotli, and LZMA (used by xz and 7-Zip) all support windows of megabytes to gigabytes.

**Huffman's integer bits.** As covered in Part 2, Huffman coding can't spend less than one bit on a symbol. Newer formats replace it with arithmetic coding or ANS, both of which effectively spend fractional bits. Zstandard uses an ANS variant called FSE for some of its streams. LZMA uses a binary arithmetic coder.

**No context modeling.** DEFLATE's Huffman codes are the same no matter what came before. In real data, what comes next depends strongly on context. After `q`, a `u` is very likely. After a `<` in HTML, a tag name is very likely. LZMA's arithmetic coder conditions its probabilities on the previous bytes and on position. Brotli uses context modeling and also ships with a large built-in dictionary of common web strings, so even a short HTML file can reference text it has never seen.

**Simple match encoding.** In structured data, the same distance often repeats: the same column in every row, the same offset in every record. DEFLATE has to re-encode that distance each time. LZMA, Zstandard, and Brotli keep a small cache of recently used distances and can say "same distance as last time" in a couple of bits.

**Single-threaded decoding.** The bitstream has no way to find block boundaries without decoding everything before them. Parallel decompression needs workarounds like splitting the input into independent streams (as pigz does for compression).

Given all that, why is DEFLATE still everywhere?

- **It's good enough.** On typical text, a good DEFLATE encoder reduces size to perhaps a quarter or a third. Newer formats might get another 10–30% on top. For many uses that difference doesn't justify a change.
- **It's universal.** Every platform, language, and browser can decode it. No other compressed format comes close to that reach.
- **It's cheap to decode.** Decoders are small, fast, and need only 32 KiB of history. That matters on embedded devices.
- **It's baked into file formats.** PNG, ZIP, PDF, and gzip-on-the-web can't change their compression without breaking billions of existing files and programs.

Zstandard is now the default choice for many new systems, and Brotli has taken over much of web text compression. But DEFLATE will be read, and written, for decades to come.

---

## Summary

DEFLATE is two ideas stacked up, plus some careful packaging.

**LZ77 removes repetition.** Walk through the input. Wherever the upcoming bytes match something in the last 32 KiB, emit a back-reference (length 3–258, distance 1–32,768) instead of the bytes. Otherwise emit a literal. Back-references can overlap their own output, which gives run-length encoding for free. Decoding is a trivial copy loop. Encoding is a search problem, made practical with hash chains on 3-byte prefixes, and tuned with chain limits and lazy matching.

**Huffman coding removes skew.** Give frequent symbols short codes and rare symbols long ones, arranged as a prefix code so the decoder always knows where each code ends. Huffman's algorithm builds the optimal code by repeatedly merging the two rarest symbols. Canonical codes mean only the code lengths need to be sent.

**DEFLATE joins them** by putting literals, match lengths, and an end-of-block marker into one 286-symbol alphabet, and distances into a second 30-symbol alphabet. Both use small Huffman-coded "bucket" symbols followed by raw extra bits, with buckets growing exponentially because large values are rare.

**The bitstream** is a sequence of blocks, read LSB-first from each byte, with numbers packed low bit first and Huffman codes first bit first. Each block is stored, fixed-Huffman, or dynamic-Huffman. Dynamic blocks send their code lengths compressed with run-length codes and another, smaller Huffman code. The block structure lets codes adapt to changing data, while the LZ77 window carries on across block boundaries.

**The wrappers** (zlib, gzip, ZIP) add headers and checksums. **PNG** shows that you can reshape data so that it has more of what DEFLATE exploits.

If you want to go deeper, the best next step is to read RFC 1951 itself. It's only about 15 pages, and after this post it should read like a summary of things you already know. After that, try adding dynamic blocks to the toy compressor, or speeding up the decoder with table-driven Huffman decoding. Then look at how Zstandard or Brotli build on the same foundation with bigger windows, better entropy coding, and smarter context. Underneath, they're still finding repeats and coding the leftovers efficiently, which is the same pair of ideas DEFLATE uses.
