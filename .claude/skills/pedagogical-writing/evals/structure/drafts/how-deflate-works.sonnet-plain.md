# How DEFLATE works

If you have ever opened a `.zip`, downloaded a `.png`, read a web page served with `Content-Encoding: gzip`, or run `git clone`, you have used DEFLATE. It is the compression format inside gzip, zlib, PNG and ZIP. It also compresses Git's object store, Java's JAR files, Word's `.docx` files, Android's APKs and a large share of the traffic on the web. Phil Katz designed it in the early 1990s for PKZIP. It was written up as RFC 1951 in 1996, and it has barely changed since. It is almost 30 years old and still among the most widely deployed pieces of software on Earth.

DEFLATE is also easy to understand. It is two ideas stacked on top of each other:

1. **LZ77** removes *repetition*. If a stretch of data has appeared before, say so instead of writing it again.
2. **Huffman coding** removes *skew*. If some symbols are more common than others, give the common ones shorter codes.

That is the whole format. The rest is plumbing: how the two stages connect, how the Huffman tables are described compactly, and how the bits are packed into bytes. This post goes through each idea step by step, with worked examples small enough to do by hand. At the end we assemble real DEFLATE bytes, then write a complete decompressor in about 100 lines of Python.

You do not need any background in compression. You should be comfortable with bytes, bits and binary numbers, and you should be able to read short Python snippets.

## The shape of the whole thing

Here is the pipeline, compressing left to right:

```
raw bytes ──► LZ77 ──► stream of tokens ──► Huffman ──► bits ──► packed into bytes
              (find        literal 'a'        (shorter
               repeats)    literal 'b'         codes for
                           match(len=6,        common
                           dist=3) ...         tokens)
```

Decompression runs the other way. Decode the Huffman codes to get tokens, then expand the tokens into bytes. The second half is simple, and the first half is mostly bookkeeping. The hard part for the compressor is deciding *which* tokens to emit. The format deliberately leaves that decision to the encoder, and that is why different programs can compress the same file to different sizes while every DEFLATE decoder reads all of them.

A few terms to settle now:

- A **literal** is a single byte emitted as-is.
- A **match** (or *back-reference*) is a pair `(length, distance)` that means "copy `length` bytes starting `distance` bytes back in the output".
- A **block** is a chunk of tokens compressed with one set of Huffman tables. A DEFLATE stream is a sequence of blocks.
- A **stream** is the whole DEFLATE-compressed payload. It is usually wrapped in a small header and checksum, as in gzip or zlib. We cover those wrappers near the end.

## Two kinds of redundancy

Compression is possible only when data is not random. Real data is not random, and its non-randomness takes two main forms.

### Repetition

Look at this string:

```
the quick brown fox jumps over the lazy dog; the quick brown fox naps
```

The phrase `the quick brown fox ` appears twice. The second copy carries no new information. If you already have the first, you can describe the second as "go back 44 bytes and copy 20". That is much shorter than 20 bytes. Repetition like this is everywhere:

- Source code repeats keywords, identifiers and indentation.
- HTML and JSON repeat tag names and keys thousands of times.
- Images have long runs of identical pixels, or rows that resemble the row above.
- Log files repeat the same message template with different numbers.

Repetition is about *sequences*. It happens when a specific run of several symbols shows up again.

### Skew

Now consider a string with no repeated phrases at all, such as ordinary English prose. Take a paragraph of a novel. Few multi-word phrases repeat, but the letters are far from uniformly distributed. In English text, `e` is roughly 12% of letters, while `z` is about 0.07%. A space is more common than any letter. If every character costs 8 bits, you are spending the same effort on `e` as on `z`. If you give `e` a 3-bit code and `z` a 12-bit code, the average cost per character falls, even though `z` got *longer*, because `z` is rare.

Skew is about *individual symbols*. It happens when some symbols are more probable than others.

### Why you need both

Neither technique catches what the other catches.

- Consider `abcabcabcabcabcabc`. Every letter appears equally often (a third each), so there is no skew for Huffman coding to exploit. But the repetition is total, and LZ77 compresses it to almost nothing.
- Consider a long English text with no repeated phrases. LZ77 finds almost nothing, but Huffman coding finds the skew and typically saves around 40% of the size.
- Consider real data, which has both. After LZ77 has replaced the repetition with tokens, the tokens themselves are skewed. Some literals are common, short matches are more common than long ones, and small distances are more common than large ones. So Huffman coding has plenty to work with *on the output of LZ77*.

That last point is the reason for the order. Doing LZ77 first and Huffman second means the Huffman stage compresses the *token stream*, whose statistics are heavily skewed. Doing them in the opposite order would not work, because Huffman-coded output looks like random bits with no repeated byte patterns left for LZ77 to find.

Let's take them one at a time.

## Part one: LZ77

Abraham Lempel and Jacob Ziv published the algorithm in 1977, and it is where the "LZ" in LZ77, LZSS, LZ4 and Zstandard comes from. The core idea fits in one sentence: *as you read the input, keep a window of recently seen bytes, and whenever the upcoming bytes match something in the window, replace them with a pointer into the window.*

### The sliding window

Imagine the compressor with a cursor moving through the input from left to right. Everything behind the cursor is "history". The part of the history within the last 32,768 bytes (32 KiB) is the **window**. Everything ahead of the cursor is "lookahead".

```
         window (last 32 KiB)        cursor
 ◄──────────────────────────────────┐ ▼
 ... t h e   c a t   s a t   o n ... | t h e   m a t ...
                                      └── lookahead
```

At each step the compressor asks: does the lookahead begin with a string that also appears in the window? If so, it finds the *longest* such string it can and emits a match token. The match token says how long the string is and how far back it starts. The cursor then jumps forward by the match length. If nothing in the window matches, or the match is too short to be worthwhile, it emits the single byte as a literal and advances by one.

The window slides because the cursor keeps moving. Bytes more than 32 KiB behind the cursor fall out of the window and can no longer be referenced. DEFLATE's limit is 32 KiB because distances are encoded in at most 15 bits (2^15 = 32768), and because in 1993 you did not want to spend megabytes of memory on a compressor.

### Tokens

DEFLATE's LZ77 stage produces two kinds of token:

- **Literal**: one byte, value 0–255.
- **Match**: `(length, distance)`, where length is 3–258 and distance is 1–32768.

Why does length start at 3? Because a match token costs bits, typically somewhere between 12 and 25, depending on the Huffman codes. A 2-byte match would save 16 bits of literals and cost about as much, so it is not worth it. A 3-byte match is the shortest that can reliably win. The upper limit of 258 is a quirk of how lengths are encoded, which we will see soon.

Notice there is no "end of match" ambiguity and no need to mark which tokens are which in the raw token stream. The Huffman stage later distinguishes them with the code itself.

### A worked example

Let's compress this 26-character string:

```
a rose is a rose is a rose
```

Number the positions from 0:

```
pos:  0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25
char: a _ r o s e _ i s _ a  _  r  o  s  e  _  i  s  _  a  _  r  o  s  e
```

(Here `_` is a space.) We start with an empty window and a cursor at position 0.

- **Pos 0, `a`:** the window is empty. Emit literal `a`.
- **Pos 1, `_`:** the window contains only `a`. No match. Emit literal `_`.
- **Pos 2–5, `r`, `o`, `s`, `e`:** nothing in the window matches these. Four more literals.
- **Pos 6, `_`:** a space exists at position 1, but the text after it there is `_ro`, while here it is `_is`. The match is only one byte long, which is below the minimum of 3. Emit literal.
- **Pos 7, 8, 9:** `i`, `s`, `_` are in the same situation. Three literals. (There was an `s` at position 4 and a space at position 6, but none extend to 3 bytes.)
- **Pos 10, `a`:** now it gets interesting. The lookahead is `a rose is a rose` (16 characters, positions 10–25). The window begins with the same 16 characters: `a rose is a rose` (positions 0–15). This is a match of length 16 at distance 10 (the match starts at position 0, and 10 − 0 = 10).

Ten literals plus one match covers the whole string:

```
L(a) L(_) L(r) L(o) L(s) L(e) L(_) L(i) L(s) L(_)  M(len=16, dist=10)
```

Twenty-six bytes became eleven tokens. The match token is vastly cheaper than the 16 bytes it replaces.

### Matches may overlap themselves

There is something odd in that example. The match has length 16 but distance 10. It claims to copy 16 bytes starting from 10 bytes back, but only 10 bytes exist back there before the cursor. Where do bytes 11 through 16 come from?

From the bytes the copy itself has just produced. This is allowed, and it is one of the best features of LZ77. The decoder performs the copy *one byte at a time*, and each byte it writes becomes part of the window, so it can be read a moment later:

```
out[10] = out[0]    # 'a'
out[11] = out[1]    # ' '
...
out[19] = out[9]    # ' '
out[20] = out[10]   # 'a'  <- the byte we just wrote
out[21] = out[11]   # ' '  <- ditto
...
out[25] = out[15]   # 'e'
```

The decoder's loop looks like this:

```python
for _ in range(length):
    out.append(out[-distance])
```

The important consequence is that **distance 1 is run-length encoding**. A string of 100 `x` bytes compresses to a literal `x`, followed by a match with length 99 and distance 1. The decoder copies the previous byte over and over. More generally, a short repeating pattern of period *p* compresses to one copy of the pattern followed by a match with distance *p* and the remaining length. That is exactly what happens with `abcabcabc`, which we will encode all the way to bits later.

Be careful in an implementation. A fast decoder might be tempted to copy `length` bytes with a single `memcpy`, but when `distance < length` the source and destination ranges overlap and `memcpy` gives the wrong answer. Real decoders handle this case separately: a byte-by-byte loop, or a doubling copy that repeats the already-written pattern.

### Decoding is trivial

You may have noticed that the decoder never searches for anything. It reads a token, and then either appends a byte or copies from earlier output. That asymmetry is characteristic of LZ77: *decompression is fast and simple, and compression is where the work is*. A decompressor can run at gigabytes per second, because the main loop is little more than a table lookup and a copy.

### Finding matches

The expensive part is finding, at each position, the longest earlier match. The naive method compares the lookahead against every position in the 32 KiB window. That is roughly 32,000 comparisons per byte of input, which is far too slow.

The classic fix, used by zlib and gzip, is a **hash chain**. The compressor maintains two arrays:

- `head[h]`: the most recent position where the 3 bytes hashing to `h` occurred.
- `prev[pos]`: the previous position (before `pos`) with the same 3-byte hash as `pos`.

To find candidates at the cursor, hash the next three bytes to get `h`, then walk the chain: start at `head[h]`, then `prev[head[h]]`, and so on. Each position visited is a place where the same three bytes (barring hash collisions, which you check) occurred earlier, so each is a candidate for a match. For each candidate you compare forward to see how long the match really is, and keep the longest. A sketch in Python:

```python
def longest_match(data, pos, head, prev, max_chain=128):
    best_len, best_dist = 0, 0
    h = hash3(data, pos)
    cand = head.get(h, -1)
    chain = 0
    while cand >= 0 and pos - cand <= 32768 and chain < max_chain:
        # compare forward
        n = 0
        while (n < 258 and pos + n < len(data)
               and data[cand + n] == data[pos + n]):
            n += 1
        if n > best_len:
            best_len, best_dist = n, pos - cand
            if n == 258:
                break
        cand = prev.get(cand, -1)
        chain += 1
    return best_len, best_dist
```

(Real implementations use fixed-size arrays indexed with a mask rather than dictionaries, but the logic is the same.)

Three details matter in practice:

- **Chains are walked newest first.** The nearest candidates come first, so if two candidates give the same length, you naturally prefer the closer one. Closer matches have smaller distance codes and fewer extra bits, so they are cheaper to encode.
- **The chain is capped.** Chains in repetitive data can be thousands of entries long. A `max_chain` limit trades compression ratio for speed. This is the main thing the compression "level" controls: `gzip -1` walks very short chains and gives up quickly, while `gzip -9` walks long ones and searches harder.
- **The hash is of 3 bytes**, because 3 is the minimum match length. Any match of 3 or more bytes must begin with some 3-byte string that is in the table, so no match is missed except through the chain cap.

After emitting a match, the compressor must still insert the positions it skipped over into the hash table, since future matches may start inside this one. (Fast modes skip this for long matches, which is another speed/ratio tradeoff.)

### Lazy matching

Greedy parsing always takes the longest match at the cursor. It is simple, but it is not always best. Suppose at position *i* the longest match is 3 bytes, but at position *i+1* there is a 10-byte match. Taking the 3-byte match first advances the cursor by 3 and may make the 10-byte match impossible, because its starting position has been swallowed.

zlib uses **lazy matching** to handle this. After finding a match at *i*, it also looks at *i+1*. If the match at *i+1* is longer, it emits the byte at *i* as a literal and moves on to take the better match. Otherwise it commits to the first. This costs an extra match search per token, and it typically improves compression by a few percent. Lazy evaluation is switched on at higher levels, and tuned by a few parameters (when a match is "good enough" to stop searching, how long a match must be before laziness is skipped, and so on).

You can go further. **Optimal parsing**, as used by tools such as Zopfli, treats tokenization as a shortest-path problem. It computes the cheapest way to cover the input using estimated bit costs for each token, and iterates because the costs depend on the Huffman codes, which depend on the tokens. It is slow, often 50–100 times slower than `gzip -9`, and it typically squeezes a further few percent out. The output is still plain DEFLATE that any decoder can read.

### The constants, collected

| Property | Value |
| --- | --- |
| Window size | 32 KiB (32,768 bytes) |
| Minimum match length | 3 |
| Maximum match length | 258 |
| Minimum distance | 1 |
| Maximum distance | 32,768 |
| Maximum compression ratio | ≈ 1032:1 |

The last row is a fun consequence of the others. The cheapest possible match costs at least 1 bit for its length/literal code and 1 bit for its distance code, so 2 bits can produce at most 258 bytes. That gives 258 × 8 / 2 = 1032. This is why "zip bombs" built on plain DEFLATE top out at about three orders of magnitude per layer.

### What comes out of LZ77

After the LZ77 stage the data has become a mix of literals and `(length, distance)` pairs. It is already shorter than the input if the data was repetitive, but we have not yet decided how to write the tokens as bits. The naive approach would give literals 9 bits (a flag plus 8 bits) and matches 1 + 8 + 15 bits or so. That wastes a lot, because the tokens are heavily skewed. Some bytes are far more common than others, and short matches at small distances are far more common than long matches at big distances. Skew is what Huffman coding exploits.

## Part two: Huffman coding

David Huffman invented his algorithm in 1952 as a student, supposedly to avoid taking a final exam. It builds an optimal *prefix code* for a given set of symbol frequencies.

### Variable-length codes and the prefix problem

ASCII gives every character 8 bits. That makes decoding trivial: take 8 bits, look up the character. But as we saw, if some symbols are common, then using fewer bits for them and more bits for rare ones lowers the average.

The problem with variable-length codes is knowing where one code ends and the next begins. Suppose we assign `A = 0`, `B = 1`, `C = 01`. Then the bit string `01` could mean `AB` or `C`. The decoder cannot tell.

The standard solution is a **prefix code** (or prefix-free code): no code is a prefix of another. With `A = 0`, `B = 10`, `C = 11`, the bit string `0 10 11 0` can only be read as `A B C A`. As soon as the decoder has seen a complete code, it knows that code is finished, because no longer code begins with it. No separators are needed.

Any prefix code can be drawn as a binary tree. Each symbol is a leaf, and a code is the path from the root: left is 0, right is 1. Because symbols sit only at leaves, no code can be a prefix of another. Decoding means walking from the root, taking one branch per bit, and emitting a symbol when you hit a leaf (and returning to the root).

```
          (root)
          /    \
        0/      \1
        A       / \
              0/   \1
              B     C

   A = 0,  B = 10,  C = 11
```

### Building the optimal tree

Given symbol frequencies, how do we choose the tree to minimize the total encoded size? Huffman's insight was a greedy rule: *the two rarest symbols should be the deepest leaves, siblings of each other.* Apply that repeatedly:

1. Make a leaf node for each symbol, weighted by its frequency.
2. Take the two nodes with the smallest weights. Join them under a new parent node whose weight is their sum.
3. Put the parent back into the pool. Repeat until one node remains. That is the root.

### A worked example

Take 100 symbols drawn from an alphabet of six: A, B, C, D, E, F, with these counts:

| Symbol | A | B | C | D | E | F |
| --- | --- | --- | --- | --- | --- | --- |
| Count | 45 | 13 | 12 | 16 | 9 | 5 |

With a fixed-length code you need 3 bits per symbol (six symbols don't fit in 2 bits), so 300 bits in all. Now build the tree.

**Step 1.** The two smallest are F (5) and E (9). Merge them into a node of weight 14.
Pool: A 45, B 13, C 12, D 16, [EF] 14.

**Step 2.** The two smallest are C (12) and B (13). Merge: 25.
Pool: A 45, D 16, [EF] 14, [CB] 25.

**Step 3.** The two smallest are [EF] 14 and D 16. Merge: 30.
Pool: A 45, [CB] 25, [EFD] 30.

**Step 4.** The two smallest are [CB] 25 and [EFD] 30. Merge: 55.
Pool: A 45, [CBEFD] 55.

**Step 5.** Merge the last two: 100. Done.

The tree looks like this:

```
                 100
                /    \
              A 45     55
                      /   \
                   25       30
                  /  \     /  \
                C 12 B 13 D 16  14
                               /  \
                             F 5  E 9
```

(Which side is left or right is arbitrary here. For now just read off the depths.) The code lengths are:

| Symbol | Count | Length | Bits used |
| --- | --- | --- | --- |
| A | 45 | 1 | 45 |
| B | 13 | 3 | 39 |
| C | 12 | 3 | 36 |
| D | 16 | 3 | 48 |
| E | 9 | 4 | 36 |
| F | 5 | 4 | 20 |
| **Total** | 100 | | **224** |

That is 224 bits instead of 300: 2.24 bits per symbol rather than 3. The most common symbol, A, got a 1-bit code, which accounts for most of the savings.

### How good is Huffman coding?

Claude Shannon showed that the best possible average code length for a source with these symbol probabilities is its *entropy*, H = −Σ p·log₂(p). For our distribution that works out to about 2.22 bits per symbol. Huffman got 2.24, which is very close. In general Huffman is optimal among codes that assign a whole number of bits to each symbol, and it is never more than 1 bit per symbol above entropy.

That last caveat is the weakness. If one symbol has probability 0.99, its ideal cost is about 0.0145 bits, but Huffman must spend at least 1 bit on it. Arithmetic coding and the newer ANS-based coders (used in Zstandard) can spend fractional bits, so they can beat Huffman on very skewed data. DEFLATE predates them and is stuck with whole bits. In practice, for the token streams LZ77 produces, the loss is small.

### Ties

Look back at step 1 of any Huffman construction: what if two nodes have equal weights? Different tie-breaking can produce different trees with different code lengths, but they all give the same total size. Because of this, there is no single "correct" Huffman code for a given input. Many equally good ones exist. This matters for the next idea.

### Canonical Huffman codes

A decoder needs the tree, so the compressor must send it. Sending the actual tree shape would be wasteful. DEFLATE uses a neat trick: it transmits only the **code length** of each symbol, and both sides derive the actual codes from the lengths by a fixed rule. A code defined by that rule is called a **canonical Huffman code**.

The rule from RFC 1951 is:

1. Codes of shorter length numerically precede codes of longer length (when read as binary numbers).
2. Among codes of the same length, they are assigned in increasing order of symbol value.

In other words: sort the symbols by (length, symbol value). Hand out codes in that order, counting upward by 1 each time. When you move to a longer length, shift left (append a 0 bit) first.

Apply this to our example. The lengths are A=1, B=3, C=3, D=3, E=4, F=4.

- Length 1: A gets `0`.
- Moving to length 3: the next code after `0` is `1`, and shifting to length 3 gives `100`. B gets `100`, C gets `101`, D gets `110`.
- Moving to length 4: the next code after `110` is `111`, and shifting to length 4 gives `1110`. E gets `1110`, F gets `1111`.

| Symbol | Length | Canonical code |
| --- | --- | --- |
| A | 1 | `0` |
| B | 3 | `100` |
| C | 3 | `101` |
| D | 3 | `110` |
| E | 4 | `1110` |
| F | 4 | `1111` |

Check that it is prefix-free: `0` is not a prefix of anything else, since the rest begin with `1`. `100`, `101` and `110` are not prefixes of `1110`/`1111`, since those begin `111`. It works.

The rule in code, straight from the RFC's algorithm:

```python
def canonical_codes(lengths):
    """lengths: dict symbol -> code length (nonzero only).
    Returns dict symbol -> (code, length)."""
    max_len = max(lengths.values())
    bl_count = [0] * (max_len + 1)
    for l in lengths.values():
        bl_count[l] += 1

    next_code = [0] * (max_len + 2)
    code = 0
    for bits in range(1, max_len + 1):
        code = (code + bl_count[bits - 1]) << 1
        next_code[bits] = code

    codes = {}
    for sym in sorted(lengths):
        l = lengths[sym]
        codes[sym] = (next_code[l], l)
        next_code[l] += 1
    return codes
```

(`bl_count[0]` is zero here, since only symbols with nonzero lengths appear in the dict.)

And the Huffman construction that produces the lengths:

```python
import heapq

def huffman_lengths(freqs):
    """freqs: dict symbol -> count. Returns dict symbol -> code length."""
    heap = [(f, n, [s]) for n, (s, f) in enumerate(sorted(freqs.items()))]
    heapq.heapify(heap)
    depth = {s: 0 for s in freqs}
    n = len(heap)
    while len(heap) > 1:
        f1, _, syms1 = heapq.heappop(heap)
        f2, _, syms2 = heapq.heappop(heap)
        for s in syms1 + syms2:
            depth[s] += 1          # every leaf under the new node goes one level deeper
        heapq.heappush(heap, (f1 + f2, n, syms1 + syms2))
        n += 1
    return depth
```

This tracks only depths and never builds an explicit tree, because the depths are all we need. (A one-symbol alphabet needs special handling, since it would get depth 0 and DEFLATE needs at least 1 bit.) Feed it `{'A':45,'B':13,'C':12,'D':16,'E':9,'F':5}` and you get lengths 1, 3, 3, 3, 4, 4, which `canonical_codes` turns into the table above.

Why does canonical form matter so much? Three reasons:

1. **Compactness.** The header carries one small number per symbol, with no tree structure.
2. **Determinism.** Encoder and decoder arrive at identical codes from identical lengths, whichever tie-breaking the encoder's Huffman builder used.
3. **Fast decoding.** The codes of each length form a contiguous numeric range, which lets a decoder work from counts alone, as we will see.

### The 15-bit limit

DEFLATE restricts Huffman code lengths to at most 15 bits. Unrestricted Huffman can produce very long codes for very rare symbols (with Fibonacci-like frequencies the tree can get as deep as the alphabet is large). Capping the length keeps decoder tables small and lets decoders use a 15-bit lookup window.

If plain Huffman produces a code longer than 15, the encoder must adjust. There are exact algorithms (package-merge computes the optimal length-limited code), but zlib uses a cheap heuristic: it shortens overlong codes and lengthens some shorter ones until the lengths satisfy the **Kraft inequality**, which says a prefix code with lengths ℓᵢ exists if and only if

Σ 2^(−ℓᵢ) ≤ 1.

Our example: 2⁻¹ + 3·2⁻³ + 2·2⁻⁴ = 0.5 + 0.375 + 0.125 = 1. It is exactly 1, which means the code is **complete**: every possible bit string eventually decodes to some symbol, with no wasted code space. Huffman codes are always complete. DEFLATE decoders generally insist on complete codes, with narrow exceptions for single-symbol cases.

### Decoding canonical codes

The obvious decoder walks an explicit tree one bit at a time. The canonical structure gives something more elegant that needs only an array of counts, the number of codes of each length, and a list of symbols sorted by (length, value):

```python
def decode_symbol(bits, count, symbols):
    code = first = index = 0
    for length in range(1, 16):
        code |= bits.read(1)          # append next bit to the code so far
        c = count[length]             # how many codes have this length
        if code - c < first:          # code falls inside this length's range
            return symbols[index + (code - first)]
        index += c                    # skip past symbols of this length
        first += c                    # first code of next length starts here...
        first <<= 1                   # ...shifted left
        code <<= 1
    raise ValueError("bad code")
```

Here `first` is the numeric value of the first (smallest) code at the current length. Because codes of one length are consecutive numbers, the code we have read is a valid code at this length exactly when it lies in `[first, first + count)`. Otherwise it must continue into a longer code. The offset `code - first` indexes into the symbols of this length. This is the approach taken by `puff.c`, the small reference decoder shipped with zlib, and it is short enough to memorize.

Production decoders are faster. They peek at several bits at once and use a precomputed lookup table, say 9 or 10 bits wide, that maps directly to `(symbol, length)` for any code short enough to fit, with a secondary table for the rare long codes. The idea is the same.

## Gluing the stages together: DEFLATE's alphabets

We now have tokens from LZ77 and a way to Huffman-code symbols. The remaining question: how do you turn tokens (literals, lengths, distances) into *symbols* for Huffman?

Lengths range over 3–258 and distances over 1–32768. Giving each value its own symbol would create a huge alphabet and a huge table header, and most values would be too rare to benefit. DEFLATE takes a middle path: **group nearby values into buckets, Huffman-code the bucket, and send the position within the bucket as raw "extra bits".** The extra bits are not compressed, since within a bucket all values are about equally likely.

### Two alphabets

DEFLATE uses two Huffman codes in each block:

1. The **literal/length alphabet**, with symbols 0–285:
   - 0–255: literal bytes.
   - 256: end of block.
   - 257–285: length codes (each with zero or more extra bits).
2. The **distance alphabet**, with symbols 0–29, each with zero or more extra bits.

Putting literals and lengths in *one* alphabet is deliberate. After any token, the decoder reads one symbol from the literal/length tree. If that symbol is below 256, it is a literal. If it is 256, the block is done. If it is above 256, it is a length code, and the decoder then knows to read some extra bits and then a distance symbol. No separate flag bit is needed to say "literal or match", because the Huffman code for the symbol already says so. The cost of the flag is absorbed into the skewed code lengths.

Distances come only after a length, so they can safely use their own alphabet.

### The length codes

| Code | Extra bits | Lengths | | Code | Extra bits | Lengths |
| --- | --- | --- | --- | --- | --- | --- |
| 257 | 0 | 3 | | 272 | 2 | 31–34 |
| 258 | 0 | 4 | | 273 | 3 | 35–42 |
| 259 | 0 | 5 | | 274 | 3 | 43–50 |
| 260 | 0 | 6 | | 275 | 3 | 51–58 |
| 261 | 0 | 7 | | 276 | 3 | 59–66 |
| 262 | 0 | 8 | | 277 | 4 | 67–82 |
| 263 | 0 | 9 | | 278 | 4 | 83–98 |
| 264 | 0 | 10 | | 279 | 4 | 99–114 |
| 265 | 1 | 11–12 | | 280 | 4 | 115–130 |
| 266 | 1 | 13–14 | | 281 | 5 | 131–162 |
| 267 | 1 | 15–16 | | 282 | 5 | 163–194 |
| 268 | 1 | 17–18 | | 283 | 5 | 195–226 |
| 269 | 2 | 19–22 | | 284 | 5 | 227–257 |
| 270 | 2 | 23–26 | | 285 | 0 | 258 |
| 271 | 2 | 27–30 | | | | |

The pattern is clear. The first eight codes handle lengths 3–10 exactly. After that, each group of four consecutive codes shares an extra-bit count, and the count grows by one each time, so each bucket is twice as wide as in the previous group. Small lengths, which are common, get precise codes. Large lengths, which are rare, are lumped into wider buckets.

Code 285 is a special case that covers *exactly* 258 with no extra bits. Length 258 is the maximum, and in highly repetitive data (long runs) it occurs very often, so it deserves its own code. This is also why the maximum is 258 and not 257. Code 284 with 5 extra bits could in principle reach 258 (227 + 31), and the format forbids that, so that length has just one representation, via code 285.

To decode a length: take the symbol's base length from the table and add the value of the extra bits. For code 267 with extra bits `1`, the length is 15 + 1 = 16.

### The distance codes

| Code | Extra bits | Distances | | Code | Extra bits | Distances |
| --- | --- | --- | --- | --- | --- | --- |
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

It is the same idea, with bucket sizes doubling every two codes. Nearby distances (which are the most common) are cheap and precise, and far distances are coarse and expensive. The shape reflects reality. In most data, a repeat is more likely to be recent than ancient.

Codes 30 and 31 exist in the 5-bit space of the fixed distance code, but they never appear in valid streams. Likewise, literal/length symbols 286 and 287 are reserved and never valid.

In code, these tables compress down to four small lists, which we will reuse in the decoder:

```python
LEN_BASE   = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,
              35,43,51,59,67,83,99,115,131,163,195,227,258]
LEN_EXTRA  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,
              3,3,3,3,4,4,4,4,5,5,5,5,0]
DIST_BASE  = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,
              257,385,513,769,1025,1537,2049,3073,
              4097,6145,8193,12289,16385,24577]
DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,
              7,7,8,8,9,9,10,10,11,11,12,12,13,13]
```

Index into them with `symbol - 257` for lengths, and with the distance symbol for distances.

### An end-of-block symbol

Why is there a symbol 256, "end of block"? The block length is not stored anywhere in a Huffman-compressed block. This lets the encoder start writing a block without knowing how long it will turn out to be, which is helpful when streaming. The decoder reads tokens until it sees 256. The price is that every block must give symbol 256 a Huffman code, and it will be used exactly once per block.

## The block format

A DEFLATE stream is one or more blocks, back to back. Blocks are *not* byte-aligned (except stored blocks, which force alignment). Every block starts with a 3-bit header:

- **BFINAL** (1 bit): 1 if this is the last block of the stream.
- **BTYPE** (2 bits): the kind of block:
  - `00`: stored (uncompressed).
  - `01`: compressed with the *fixed* Huffman codes.
  - `10`: compressed with *dynamic* Huffman codes (tables sent in the block).
  - `11`: reserved. It is an error.

Blocks don't reset the window. A match in block 2 may point back into block 1, as long as it is within 32 KiB. A block boundary exists only so the encoder can change Huffman tables or fall back to stored data.

### Bit order, the single most confusing thing

DEFLATE packs bits into bytes **starting from the least significant bit**. The first bit of the stream is bit 0 (value 1) of byte 0, the next is bit 1 (value 2), and so on up to bit 7, and then it continues in byte 1.

There are two kinds of values in the stream, and they are packed differently:

- **Plain numbers** (BFINAL, BTYPE, HLIT, extra bits, lengths, and so on) are packed with their *least significant bit first*. A 2-bit field with value 2 (binary `10`) is written as bit `0` and then bit `1`.
- **Huffman codes** are packed with their *most significant bit first*, that is, starting from the root of the tree. The code `110` is written as `1`, `1`, `0`.

This reconciles because both are "natural" for their jobs. A decoder walking a tree takes bits from the root downward, which is MSB-first for codes. Fields that are just numbers are most convenient to extract with shift-and-mask from a bit buffer, which is LSB-first. The result is a format that is slightly confusing to implement by hand, so keep this in mind:

```
Byte 0                    Byte 1
bit7 bit6 ... bit1 bit0   bit7 ... bit0
 ◄──── fill direction ─────
stream:  b0 b1 b2 ... b7 | b8 b9 ... b15
```

A common source of bugs is writing Huffman codes in the wrong bit order. Typical encoders reverse the bits of each code once, when building the table, so they can write it with the same LSB-first routine they use for everything else.

### Stored blocks (BTYPE = 00)

For incompressible data (already-compressed files, random bytes), the encoder falls back to storing the bytes verbatim. After the 3 header bits, the encoder skips to the next byte boundary and writes:

- **LEN** (2 bytes, little-endian): the number of data bytes, up to 65,535.
- **NLEN** (2 bytes, little-endian): the bitwise complement of LEN, as a simple integrity check.
- LEN bytes of raw data.

The worst-case expansion of DEFLATE is therefore small: 5 bytes of overhead per 65,535 bytes of stored data. That is why it is safe to run DEFLATE on already-compressed data. It won't blow up.

### Fixed Huffman blocks (BTYPE = 01)

For short inputs, sending a custom Huffman table costs more than it saves. DEFLATE defines a **fixed** pair of codes for those cases, known in advance to both sides, so no table is sent.

The fixed literal/length code uses these lengths:

| Symbols | Code length | Code range (binary) |
| --- | --- | --- |
| 0–143 | 8 | `00110000` – `10111111` |
| 144–255 | 9 | `110010000` – `111111111` |
| 256–279 | 7 | `0000000` – `0010111` |
| 280–287 | 8 | `11000000` – `11000111` |

These follow from applying the canonical rule to those lengths. The fixed distance code is simpler: all 30 distance symbols use 5-bit codes, equal to the symbol number written in 5 bits. Distance symbol 2 is `00010`.

The fixed code is mildly skewed toward text-like data. Literals 0–143 (which include all ASCII) cost 8 bits, so ASCII text gets no benefit from the literal alphabet itself, and the compression comes entirely from matches. The fixed code is a fallback for short or odd inputs, not for typical files.

### Dynamic Huffman blocks (BTYPE = 10)

For anything of real size, the encoder computes the optimal Huffman codes for this block's actual token statistics, and sends the code lengths ahead of the data. The challenge is to send those lengths compactly, since a literal/length alphabet may have up to 286 symbols and a distance alphabet up to 30. The designers' answer was to *Huffman-code the code lengths themselves*, which is a third Huffman code in each dynamic block.

The dynamic header after BFINAL/BTYPE is:

1. **HLIT** (5 bits): number of literal/length codes, minus 257. So 257–286 codes.
2. **HDIST** (5 bits): number of distance codes, minus 1. So 1–32 codes.
3. **HCLEN** (4 bits): number of code-length codes, minus 4. So 4–19.
4. **HCLEN + 4 values of 3 bits each:** the code lengths (0–7) of the *code-length alphabet*, in this peculiar order:

   `16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15`

   Codes at the end of that list are the least likely to be used, so a header can truncate the list and say "the remaining ones have length 0" by sending a small HCLEN.
5. **The code lengths of the literal/length alphabet, then the distance alphabet**, encoded with the code-length Huffman code from step 4, as one continuous sequence of HLIT + 257 + HDIST + 1 lengths.
6. **The block's data**, encoded with the two codes just defined, ending with symbol 256.

The code-length alphabet has 19 symbols:

| Symbol | Meaning |
| --- | --- |
| 0–15 | A code length of exactly that value (0 means "symbol not used") |
| 16 | Repeat the *previous* length 3–6 times (2 extra bits: count − 3) |
| 17 | Repeat length 0 for 3–10 times (3 extra bits: count − 3) |
| 18 | Repeat length 0 for 11–138 times (7 extra bits: count − 11) |

Run-length symbols matter because most real blocks use only a fraction of the 286 literal/length symbols. In a text file, bytes 0–31 mostly don't appear, nor do bytes 128–255. Those long runs of zero lengths collapse into one or two symbol-18 codes. Runs of repeated nonzero lengths (frequent in the middle of the table) are handled by symbol 16. Symbol 16 cannot start a run, since it repeats the previous length. A repeat may cross from the literal/length lengths into the distance lengths, because they are one sequence.

So a dynamic block header is a Huffman-coded description of Huffman codes, which describe the tokens, which describe the data. Three layers of the same trick.

## Walkthrough: compressing `abcabcabc` by hand

Time to put everything together and produce real bytes. We'll compress the nine-byte string `abcabcabc` as a single fixed-Huffman block.

**Step 1: LZ77.** Positions 0, 1, 2 (`a`, `b`, `c`) have no earlier matches, so they are literals. At position 3 the lookahead `abcabc` matches the window starting 3 bytes back, and the match extends through the end of the input (length 6, which overlaps itself as described earlier). Tokens:

```
L(a)  L(b)  L(c)  M(len=6, dist=3)
```

**Step 2: map tokens to symbols.**

- `a` = 97, `b` = 98, `c` = 99: literal symbols 97, 98, 99.
- Length 6 → symbol 260 (zero extra bits).
- Distance 3 → distance symbol 2 (zero extra bits).
- Then the end-of-block symbol 256.

**Step 3: look up fixed Huffman codes.**

- Literals 0–143 have 8-bit codes starting at `00110000` (48). So literal *n* is the 8-bit representation of 48 + *n*.
  - `a`: 48 + 97 = 145 = `10010001`
  - `b`: 48 + 98 = 146 = `10010010`
  - `c`: 48 + 99 = 147 = `10010011`
- Symbols 256–279 have 7-bit codes starting at `0000000`, so symbol *s* is *s* − 256 in 7 bits.
  - 260: 4 = `0000100`
  - 256: 0 = `0000000`
- Distance symbol 2 is 5 bits: `00010`.

**Step 4: assemble the bits, in stream order.**

- Header: BFINAL = 1 → `1`. BTYPE = 01 (fixed). It's a plain number, written LSB-first, so the bits are `1` then `0`. Header bits: `1 1 0`.
- `a`: `1 0 0 1 0 0 0 1` (Huffman, MSB first)
- `b`: `1 0 0 1 0 0 1 0`
- `c`: `1 0 0 1 0 0 1 1`
- length 260: `0 0 0 0 1 0 0`
- distance 2: `0 0 0 1 0`
- end of block: `0 0 0 0 0 0 0`

The total is 3 + 24 + 7 + 5 + 7 = 46 bits. Pad with two zero bits to reach 48, which is 6 bytes.

**Step 5: pack into bytes, LSB first.** Each group of 8 stream bits becomes a byte, with the first bit as the least significant.

Writing the stream out in groups of eight:

```
bits 1-8:    1 1 0 1 0 0 1 0   → reading right-to-left: 01001011 = 0x4B
bits 9-16:   0 0 1 1 0 0 1 0   → 01001100 = 0x4C
bits 17-24:  0 1 0 1 0 0 1 0   → 01001010 = 0x4A
bits 25-32:  0 1 1 0 0 0 0 1   → 10000110 = 0x86
bits 33-40:  0 0 0 0 0 1 0 0   → 00100000 = 0x20
bits 41-48:  0 0 0 0 0 0 0 0   → 00000000 = 0x00
```

The compressed stream is:

```
4B 4C 4A 86 20 00
```

Six bytes for nine. Not a dramatic saving, since the input is tiny, but every byte is accounted for. Look at the first three bytes: `4B 4C 4A`. They're the letters `a`, `b`, `c`, each shifted and smeared by the 3-bit header. If you've ever peeked at the hex of a compressed short string and wondered why `4B 4C 4A` looked familiar, this is why: they are `abc` with a header shoved in front.

You can check this in Python:

```python
import zlib
d = zlib.decompressobj(-15)          # negative wbits = raw DEFLATE, no wrapper
print(d.decompress(bytes.fromhex("4b4c4a862000")))   # b'abcabcabc'
```

Real zlib's own compressor, given `abcabcabc`, picks the same tokens. For a stream this short it chooses a fixed block, because a dynamic header would cost more than it saves, as we are about to see.

## Walkthrough: what would a dynamic header look like?

Suppose we had forced a *dynamic* block for the same data. The alphabet used is tiny: literals `a`, `b`, `c`, length symbol 260, and the end-of-block symbol 256. Five symbols in the literal/length alphabet. In the distance alphabet we use one symbol, 2.

We need code lengths satisfying Kraft. One valid choice:

- `a`, `b`, `c`: 2 bits each
- 256 (end of block), 260: 3 bits each

Check: 3 × 2⁻² + 2 × 2⁻³ = 0.75 + 0.25 = 1. Complete.

For the distance alphabet there is one used symbol. DEFLATE says a lone distance code is given a 1-bit code (a deliberately incomplete code).

Now the lengths must be listed, in order, for symbols 0 through 260 (the highest literal/length symbol we use is 260, so HLIT = 261 − 257 = 4), followed by distance symbols 0 through 2 (HDIST = 3 − 1 = 2). The full sequence of lengths has 261 + 3 = 264 entries:

- Symbols 0–96: 97 zeros
- Symbols 97, 98, 99: `2 2 2`
- Symbols 100–255: 156 zeros
- Symbol 256: `3`
- Symbols 257–259: `0 0 0`
- Symbol 260: `3`
- Distance symbols 0, 1, 2: `0 0 1`

Run-length encode that with the code-length alphabet:

```
18 (97 zeros: extra = 97 - 11 = 86)
2, 2, 2
18 (138 zeros: extra = 127)
18 (18 zeros: extra = 7)
3
17 (3 zeros: extra = 0)
3
0, 0, 1
```

That's 12 code-length symbols (plus extra bits), instead of 264 individual numbers. The alphabet used there is {0, 1, 2, 3, 17, 18}, so the code-length code has six symbols with their own Huffman lengths, and HCLEN is chosen so the 3-bit length list reaches as far down the odd permutation order as the last non-zero entry needs. All of this is overhead before the first data bit. In this tiny example it comes to dozens of bits, more than the 46-bit fixed block in total. That is why encoders compare: they compute the size of the stored, fixed and dynamic encodings and pick the smallest. For a few hundred bytes or more, dynamic wins almost every time.

## Writing a DEFLATE decompressor

We have everything needed to write a complete decoder. This is a compact Python version. It is not fast and it does not validate everything, but it is correct for valid streams, and it's about the length of the format itself.

First, the bit reader. Bytes are consumed LSB-first, and we keep a small buffer:

```python
class BitReader:
    def __init__(self, data):
        self.data = data
        self.pos = 0          # next byte to load
        self.buf = 0          # bit buffer
        self.cnt = 0          # bits in buffer

    def bits(self, n):
        """Read n bits as an integer, LSB first. (Used for plain fields.)"""
        while self.cnt < n:
            self.buf |= self.data[self.pos] << self.cnt
            self.pos += 1
            self.cnt += 8
        val = self.buf & ((1 << n) - 1)
        self.buf >>= n
        self.cnt -= n
        return val

    def align(self):
        """Discard bits up to the next byte boundary."""
        self.buf = 0
        self.cnt = 0
```

`align` can simply drop the buffer, because bytes are loaded only on demand, so the buffer never holds a whole unused byte.

Next, building a decoding table from code lengths. This is the `count`/`symbols` pair used by the canonical decoder from before:

```python
def build(lengths):
    count = [0] * 16
    for l in lengths:
        count[l] += 1
    count[0] = 0
    offs = [0] * 16
    for l in range(1, 15):
        offs[l + 1] = offs[l] + count[l]
    symbols = [0] * len(lengths)
    for sym, l in enumerate(lengths):
        if l:
            symbols[offs[l]] = sym
            offs[l] += 1
    return count, symbols

def decode(br, table):
    count, symbols = table
    code = first = index = 0
    for length in range(1, 16):
        code |= br.bits(1)
        c = count[length]
        if code - c < first:
            return symbols[index + (code - first)]
        index += c
        first += c
        first <<= 1
        code <<= 1
    raise ValueError("invalid Huffman code")
```

`symbols` lists the symbols sorted by (length, value), which is just what the canonical rule needs. Reading a Huffman code one bit at a time with `br.bits(1)` is automatically MSB-first with respect to the code, which is exactly how codes are stored. The two bit orders resolve themselves in the code: plain fields read many bits at once, and Huffman codes read one bit at a time and build the number up from the top.

Now the fixed tables, which are just `build` on the lengths from the RFC:

```python
FIXED_LIT  = build([8] * 144 + [9] * 112 + [7] * 24 + [8] * 8)
FIXED_DIST = build([5] * 30)
```

The token loop, using the `LEN_BASE`, `LEN_EXTRA`, `DIST_BASE` and `DIST_EXTRA` lists from earlier:

```python
def inflate_codes(br, out, lit, dist):
    while True:
        sym = decode(br, lit)
        if sym < 256:
            out.append(sym)                          # literal
        elif sym == 256:
            return                                   # end of block
        else:
            sym -= 257
            length = LEN_BASE[sym] + br.bits(LEN_EXTRA[sym])
            d = decode(br, dist)
            distance = DIST_BASE[d] + br.bits(DIST_EXTRA[d])
            if distance > len(out):
                raise ValueError("distance too far back")
            for _ in range(length):                  # byte by byte: overlap-safe
                out.append(out[-distance])
```

The order of operations matches the format exactly: length symbol, length extra bits, distance symbol, distance extra bits. The bounds check on `distance` matters. A malicious stream can claim a distance larger than the output so far, and without the check you would read memory that was never written (in C) or hit an index error or negative index (in Python).

Dynamic tables, following the header layout exactly:

```python
ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

def read_dynamic_tables(br):
    hlit  = br.bits(5) + 257
    hdist = br.bits(5) + 1
    hclen = br.bits(4) + 4

    cl_lengths = [0] * 19
    for i in range(hclen):
        cl_lengths[ORDER[i]] = br.bits(3)
    cl_table = build(cl_lengths)

    lengths = []
    while len(lengths) < hlit + hdist:
        sym = decode(br, cl_table)
        if sym < 16:
            lengths.append(sym)
        elif sym == 16:
            lengths += [lengths[-1]] * (3 + br.bits(2))
        elif sym == 17:
            lengths += [0] * (3 + br.bits(3))
        else:
            lengths += [0] * (11 + br.bits(7))
    if len(lengths) != hlit + hdist:
        raise ValueError("code length run overshoots")
    return build(lengths[:hlit]), build(lengths[hlit:])
```

Note that `lengths` is one list for both alphabets, with the split made only at the end. That is how runs can cross from one alphabet into the other.

And finally the block loop:

```python
def inflate(data):
    br = BitReader(data)
    out = bytearray()
    while True:
        final = br.bits(1)
        kind = br.bits(2)
        if kind == 0:                                # stored
            br.align()
            n = br.bits(16)
            nn = br.bits(16)
            if n != (~nn & 0xFFFF):
                raise ValueError("stored block length check failed")
            out += data[br.pos : br.pos + n]
            br.pos += n
        elif kind == 1:                              # fixed Huffman
            inflate_codes(br, out, FIXED_LIT, FIXED_DIST)
        elif kind == 2:                              # dynamic Huffman
            lit, dist = read_dynamic_tables(br)
            inflate_codes(br, out, lit, dist)
        else:
            raise ValueError("reserved block type")
        if final:
            return bytes(out)
```

That is a full DEFLATE decompressor. Test it against zlib:

```python
import zlib, os

def raw_deflate(data, level=6):
    c = zlib.compressobj(level, zlib.DEFLATED, -15)
    return c.compress(data) + c.flush()

for payload in [b"", b"abcabcabc", b"a rose is a rose is a rose",
                b"x" * 1000, open(__file__, "rb").read(), os.urandom(5000)]:
    assert inflate(raw_deflate(payload)) == payload
```

The `os.urandom` case will go through stored blocks, the tiny cases through fixed blocks, and the source file through dynamic blocks. Every path of the format gets exercised in a few lines.

The reference to study when you want to see the same logic in C is `puff.c` in zlib's `contrib/puff` directory. It is a single-file inflater of a few hundred lines, written to be read, and it is where the counting-based decoding above comes from.

## What the encoder decides

The decoder is a pure function of the bitstream, and the encoder has freedom. Everything below is a choice a compressor makes, and each choice leaves the format unchanged:

**Tokenization.** Which matches to take, whether to be greedy or lazy, how deep to search. This is the speed/ratio dial. The fast levels of zlib use greedy matching with short chains, and the high levels use lazy matching with long chains. Zopfli runs full optimal parsing.

**Block boundaries.** The encoder chooses when to end a block and start a new one. Since each block has its own Huffman codes, a file whose statistics change (a PDF with text followed by an image, say) benefits from a boundary at the transition. A block that is too short wastes bytes on table headers, and one that is too long forces one set of codes to serve mismatched data. zlib's heuristic is simple: it ends a block when its internal buffer of symbols fills up. More sophisticated encoders examine the statistics to find better split points.

**Block type.** After tokenizing a block, a good encoder computes the exact cost of coding it three ways (stored, fixed, dynamic) and emits whichever is smallest. This is why DEFLATE never expands data by more than a sliver, and why very short inputs usually use fixed blocks.

**Huffman details.** Ties in the tree construction, handling of the 15-bit limit, and how the code-length alphabet is used (when to prefer repeat codes) are all free. Different encoders also vary in how aggressively they trim HLIT and HDIST.

**Skipping history.** Encoders can restrict the window, trading ratio for memory. zlib's `windowBits` parameter picks a window between 512 bytes and 32 KiB. A decoder just needs a window at least that large, and a decoder that gives itself the full 32 KiB works with everything.

Most of the difference between "gzip -1" and "gzip -9", and between zlib, libdeflate, Zopfli and 7-Zip's DEFLATE encoder, comes from these choices. libdeflate makes better choices than zlib at the same speed, and Zopfli squeezes harder at a large time cost. All of them emit streams that your Python inflater above decodes.

## The wrappers: gzip, zlib, PNG, ZIP

DEFLATE as specified in RFC 1951 is a bare stream of bits with no magic number, no checksum and no length. Real-world formats wrap it:

**zlib (RFC 1950)** adds a 2-byte header and a 4-byte trailer. The header says "this is DEFLATE with window size 2^N" and carries a few flag bits. The first byte is usually `0x78` (DEFLATE with a 32 KiB window). The second byte encodes the compression level hint and a checksum that makes the pair divisible by 31, giving the familiar combinations `78 01`, `78 5E`, `78 9C` and `78 DA`. `78 9C` is the default level. The trailer is an **Adler-32** checksum of the uncompressed data, stored big-endian. Adler-32 is a fast checksum built from two running sums modulo 65,521. Git stores its objects as zlib streams.

**gzip (RFC 1952)** has a 10-byte header: the magic bytes `1F 8B`, the method byte `08` (DEFLATE), flags, a modification time, extra flags and an OS identifier. Optional fields (original filename, comment, extra data) may follow. Then comes the DEFLATE stream, then an 8-byte trailer: a **CRC-32** of the uncompressed data and the uncompressed size modulo 2³². A `.tar.gz` is a tar archive, which is just a long concatenation of files, compressed with gzip. Because the window is only 32 KiB and the compressor sees the tar as one stream, gzip compresses across file boundaries only within that window.

**PNG** compresses image data with zlib. Before compression, each scanline is passed through a *filter* (None, Sub, Up, Average or Paeth), which replaces each pixel byte with a difference from its neighbors. This turns smooth gradients and flat regions into runs of small numbers and zeros, which is very friendly to both LZ77 (repeats) and Huffman (heavy skew toward zero). The concatenated contents of all `IDAT` chunks form a single zlib stream. This is the standard example of *preprocessing to create redundancy for DEFLATE to exploit*.

**ZIP** stores each file separately. Each entry has a header and a compression method; method 8 means DEFLATE, and the payload is a **raw** DEFLATE stream with no zlib or gzip wrapper. The CRC-32 and sizes live in the entry's header or in the central directory at the end of the archive. Because every file is compressed independently, ZIP can extract a single file without decompressing the rest. The price is that similar files do not help each other, as they do in a `.tar.gz`. Office documents, JAR files, APKs and EPUBs are all ZIP archives.

**HTTP** has a confusing corner. `Content-Encoding: gzip` means a gzip wrapper, as you would expect. `Content-Encoding: deflate` is *supposed* to mean the zlib wrapper, but some servers historically sent raw DEFLATE and clients had to guess, so most people just use gzip.

The common feature of all of them is that the DEFLATE stream is the same. If you strip the wrapper (2 header bytes and 4 trailer bytes for zlib, or the gzip header and its 8-byte trailer), what remains is a raw stream, which is what the Python `inflate()` above expects. In Python, `zlib.decompressobj(-15)` reads raw streams, `zlib.decompressobj(15)` reads zlib streams, and `zlib.decompressobj(31)` reads gzip.

## Limits, weaknesses and failure modes

DEFLATE is good, but it does have limits you should know:

**The 32 KiB window.** Repetition farther than 32 KiB apart is invisible. Modern formats such as Zstandard and Brotli use windows of megabytes (or much larger), and they find long-range redundancy that DEFLATE cannot. This is the largest single reason DEFLATE loses to its successors on, say, large collections of similar files.

**Whole-bit Huffman codes.** As noted, Huffman can't spend less than a bit per symbol. Modern entropy coders (ANS, arithmetic coding) do better on highly skewed distributions.

**Static statistics within a block.** A Huffman table is fixed for its block, with no adaptation to the local context. Compressors with context modeling (PPM, CM, or the context-aware parts of Brotli) can exploit "what tends to follow what".

**No built-in dictionary or preprocessing.** Brotli ships a built-in dictionary of common web strings, which helps small files. DEFLATE starts cold every time (though zlib allows a user-supplied "preset dictionary" that primes the window, which some protocols use).

Even so, a newer format has to be dramatically better to dislodge something that is everywhere, fast, patent-free, and implemented in every language.

### Security considerations

If you write or use a decompressor, remember it parses untrusted input.

- **Decompression bombs.** As computed earlier, DEFLATE can expand by roughly 1000×, so a 1 MB file can inflate to a gigabyte. Always cap the output size, and be aware that ZIP archives can nest further bombs (a zip within a zip), or overlap entries so one compressed block appears to serve many files. Never trust sizes declared in a header without checking.
- **Distances past the start.** A match whose distance exceeds the bytes produced so far is invalid. Reject it, or you will read uninitialized memory in languages that allow it.
- **Oversubscribed and incomplete codes.** Validate that the code lengths from a dynamic header form a code satisfying the Kraft inequality. An oversubscribed code is ambiguous. Incomplete codes are legal only in the special single-code cases. zlib's `inflate` checks both, and a decoder built on the counting trick above can verify it while building tables.
- **Repeat code misuse.** Symbol 16 with no previous length, or a repeat that overruns HLIT + HDIST, is an error to be detected rather than trusted.
- **Truncated streams.** If the input ends in the middle of a block, fail cleanly. The simple `BitReader` above would raise an `IndexError`, which is honest but not graceful.

For production use, use a maintained library (zlib, zlib-ng, libdeflate, or your language's standard library) rather than the toy decoder above. They have been fuzzed for decades.

## Putting it back together

Here is the whole story again, now that every piece has been opened.

You start with bytes. The **LZ77** stage walks over them with a 32 KiB sliding window. Where the upcoming bytes already occurred in the window, it emits a `(length, distance)` match with length 3–258 and distance 1–32768. Otherwise it emits a literal. Matches may overlap themselves, so a distance of 1 gives run-length encoding for free. Finding matches efficiently uses hash chains, and smarter encoders add lazy matching or optimal parsing.

The tokens are mapped onto two alphabets: literals, end-of-block and length codes share one alphabet of up to 286 symbols, and distances use another with 30. Length and distance values are grouped into buckets, with the position inside the bucket sent as raw extra bits.

The **Huffman** stage then gives each symbol a prefix code whose length reflects how often the symbol occurs. Frequent symbols get short codes and rare ones get long codes. Only the code *lengths* are transmitted, because both sides rebuild the same canonical codes from them. In dynamic blocks those lengths are themselves run-length encoded and Huffman-coded, with their own small alphabet of 19 symbols. Lengths are limited to 15 bits.

Blocks come in three kinds: stored (for incompressible data), fixed (for tiny inputs, with no table to send) and dynamic (for everything else). The encoder picks whichever is smallest. Bits are packed starting at the least significant bit of each byte, with plain fields LSB-first and Huffman codes MSB-first. Wrappers such as gzip, zlib and ZIP add headers and checksums around the stream, but the payload is DEFLATE in all of them.

The two stages divide the work cleanly. LZ77 is a *dictionary* method: it knows nothing about symbol frequencies but sees long-range structure. Huffman is a *statistical* method: it knows nothing about structure but sees the frequencies. Stacked, they cover each other's blind spots, which is why a compression scheme this simple has survived since the early nineties.

### Where to go next

- **Read RFC 1951.** It is only about 25 pages, written in plain language, and now that you know the ideas it is very readable. The tables and the canonical-code algorithm in it match what we've used here.
- **Read `puff.c`** from zlib's `contrib` directory. It's a complete inflater optimized for clarity, and a good compare-and-contrast with the Python above.
- **Write the encoder.** The decoder is the easy half. Try a greedy LZ77 with hash chains, then count symbol frequencies, build code lengths with `huffman_lengths`, enforce the 15-bit limit, and write a dynamic block header. If `zlib.decompress` can read your output, you've understood the format.
- **Look inside real files.** Tools such as `infgen` (by Mark Adler, zlib's co-author) print a human-readable disassembly of any DEFLATE stream, showing every literal, match and block header. Running it on small files is the fastest way to build intuition for what encoders actually produce.
- **Compare with the successors.** Zstandard, Brotli and LZMA make the same two moves with different parts replaced. They use larger windows, better entropy coders (ANS or range coding instead of Huffman), and more elaborate token models. Once you know DEFLATE, the improvements are easy to follow, because you know what each one is improving.

DEFLATE rewards the time you put into it. Two clear ideas, a handful of tables and a few dozen lines of decoder code are enough to read the data inside so many of the files on your computer.
