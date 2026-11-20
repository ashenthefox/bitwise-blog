# How DEFLATE works

Every time you load a web page over HTTP with `Content-Encoding: gzip`, open a PNG, unzip a file, or read a `.docx` or `.jar`, you are running DEFLATE. It is probably the most widely deployed compression format in the world. It was designed by Phil Katz in the late 1980s for PKZIP, formalized in RFC 1951 in 1996, and it has outlived nearly every technology that was around when it was written.

DEFLATE is also surprisingly small. The whole specification is about 15 pages. If you are a programmer who has never looked inside a compressor, it is an excellent first one to understand, because it is made of two simple ideas stacked on top of each other:

1. **LZ77** removes *repetition*. If the data says the same thing twice, say it once and then point back at it.
2. **Huffman coding** removes *skew*. If some symbols are common and others rare, give the common ones short codes and the rare ones long codes.

That's the whole format. The rest is bookkeeping, and the bookkeeping is where the interesting engineering lives. This post goes through each idea step by step, then through how they are glued together into a bitstream, with working code along the way. By the end you should be able to read RFC 1951 without fear, and write a decompressor (a "inflater") in an afternoon.

A note on names, since they confuse everyone at first:

- **DEFLATE** is the compressed data format (RFC 1951).
- **zlib** is a thin wrapper format (RFC 1950) around DEFLATE: a 2-byte header and a 4-byte Adler-32 checksum. It is also the name of the most popular C library that implements DEFLATE.
- **gzip** is another wrapper (RFC 1952): a larger header with filename and timestamp, and a CRC-32 trailer.
- **PNG** stores its pixel data as a zlib stream, split across `IDAT` chunks.
- **ZIP** stores each file as a raw DEFLATE stream (compression method 8) with its own metadata elsewhere.

So when someone says "gzip compression," the compression part is DEFLATE and the gzip part is an envelope.

## 1. What compression can and cannot do

Before the mechanics, a bit of framing, because it explains why DEFLATE has the shape it does.

Lossless compression works by exploiting *redundancy*. Data that is truly random has none, and no compressor can shrink it (on average it will grow slightly). Real data, though, is full of redundancy, and it comes in a few distinct flavors:

- **Repetition of long patterns.** The text `function` appears hundreds of times in a JavaScript file. An HTML document repeats `</div>` constantly. A log file repeats timestamps and hostnames.
- **Skewed symbol frequencies.** In English text the letter `e` is far more common than `z`. In a PNG of a sky, a handful of pixel values dominate.
- **Predictability from context.** After `q` in English, `u` is very likely. (DEFLATE mostly does *not* exploit this; fancier compressors like PPM and modern context-mixing compressors do.)

DEFLATE targets the first two. LZ77 handles the first, Huffman coding handles the second. The reason they are stacked, and not alternatives, is that they attack different kinds of redundancy and so their gains multiply. Run LZ77 first and you get a stream of literals and back-references. That stream is itself skewed (some literals and some match lengths are much more common than others), which is exactly what Huffman coding is good at squeezing.

Here is the pipeline in one picture:

```
 raw bytes
     │
     ▼
 ┌────────────┐   literals + (length, distance) pairs
 │   LZ77     │ ─────────────────────────────────────┐
 └────────────┘                                      │
                                                     ▼
                                              ┌────────────┐
                                              │  Huffman   │
                                              └────────────┘
                                                     │
                                                     ▼
                                           compressed bitstream
```

Decompression runs it backward: decode Huffman symbols, then replay the LZ77 instructions to rebuild the bytes.

## 2. Idea one: LZ77, or "say it once, then point"

### 2.1 The intuition

Consider this string:

```
the cat sat on the mat, the cat sat on the hat
```

Notice that `the cat sat on the ` appears at the start, and again after the comma. The second copy is redundant. Instead of writing it out again, we could write: "go back 21 characters and copy 20 characters." That instruction is much shorter than the text it replaces.

This is the whole idea of LZ77, published by Abraham Lempel and Jacob Ziv in 1977. The compressor maintains a **sliding window** of recently seen data. As it scans forward, at each position it asks: "Does the upcoming data match something in the window?" If yes, it emits a **match**, a `(length, distance)` pair meaning "copy `length` bytes starting `distance` bytes back." If no, it emits the byte as a **literal**.

In DEFLATE, the window is 32 KiB, so distances range from 1 to 32768, and match lengths range from 3 to 258. A match shorter than 3 bytes is not worth encoding, since the pair itself costs about as much as the literals.

### 2.2 A worked example

Take the string `abcabcabcabc`. Twelve bytes. Walking through it:

| Position | Upcoming | Action |
|---|---|---|
| 0 | `abcabc...` | Nothing in the window yet. Emit literal `a`. |
| 1 | `bcabc...` | No match. Emit literal `b`. |
| 2 | `cabca...` | No match. Emit literal `c`. |
| 3 | `abcabcabc` | Window contains `abc`. Match found, distance 3. |

Now the interesting part. At position 3, the upcoming text is `abcabcabc` (nine bytes). The window holds only `abc`. But the match is allowed to be **longer than its distance**. We emit `(length=9, distance=3)`, and the decoder copies byte by byte:

```
output so far: a b c
copy 1: output[3] = output[0] = a   →  a b c a
copy 2: output[4] = output[1] = b   →  a b c a b
copy 3: output[5] = output[2] = c   →  a b c a b c
copy 4: output[6] = output[3] = a   →  ...
```

Each copied byte becomes available as source for later copied bytes. The match "overlaps itself." So twelve bytes become three literals plus one match: `a`, `b`, `c`, `(9, 3)`.

This overlapping behavior is not a quirk; it is the feature that makes **run-length encoding** a special case of LZ77. A run of 100 zero bytes becomes a literal `0` followed by `(99, 1)`: "copy 99 bytes from one byte back." The decoder has to copy one byte at a time, in order, and must **not** use a bulk `memcpy`, since source and destination overlap. This is a classic bug in hand-written inflaters. (An optimized decoder can use `memmove` only when `distance >= length`; otherwise it needs the byte loop or a pattern-replication trick.)

### 2.3 The decoder is trivial

The LZ77 half of decompression is about ten lines. Here it is in Python, operating on a list of tokens where a token is either an `int` (a literal byte) or a `(length, distance)` tuple:

```python
def lz77_decode(tokens):
    out = bytearray()
    for t in tokens:
        if isinstance(t, int):
            out.append(t)
        else:
            length, distance = t
            for _ in range(length):
                out.append(out[-distance])
    return bytes(out)

tokens = [ord('a'), ord('b'), ord('c'), (9, 3)]
print(lz77_decode(tokens))   # b'abcabcabcabc'
```

`out[-distance]` is the byte `distance` positions back from the current end. Because we append one byte per iteration, the overlapping case just works.

All the difficulty of LZ77 is on the *compressor* side. The format only specifies what a valid token stream looks like; it says nothing about how you find good matches. That freedom is why there are many DEFLATE compressors (zlib, zopfli, libdeflate, 7-Zip's encoder) producing different outputs of different sizes, all readable by the same decoder.

### 2.4 Finding matches: the compressor's real job

The naive approach is to try every position in the 32 KiB window at each step and take the longest match. That is O(window × length) per position and far too slow for large inputs.

zlib instead uses a **hash table of 3-byte prefixes**. The idea:

1. For each position `i`, hash the three bytes `data[i], data[i+1], data[i+2]`.
2. The hash table maps that hash to the most recent position with the same hash. Each position also stores a link to the *previous* position with the same hash, forming a **hash chain**.
3. To find a match at position `i`, walk the chain: each entry is a earlier position whose first three bytes (probably) match. For each candidate, compare further bytes to measure the match length. Keep the longest.
4. Stop after a maximum chain length, which is the main speed/ratio knob.

Here is a deliberately simple version:

```python
def lz77_encode(data, window=32768, min_len=3, max_len=258, max_chain=64):
    tokens = []
    head = {}          # 3-byte key -> most recent position
    prev = {}          # position -> previous position with same key
    i = 0
    n = len(data)

    def insert(pos):
        if pos + 3 <= n:
            key = data[pos:pos+3]
            prev[pos] = head.get(key, -1)
            head[key] = pos

    while i < n:
        best_len, best_dist = 0, 0
        if i + min_len <= n:
            key = data[i:i+3]
            cand = head.get(key, -1)
            chain = 0
            while cand != -1 and i - cand <= window and chain < max_chain:
                l = 0
                while (l < max_len and i + l < n
                       and data[cand + l] == data[i + l]):
                    l += 1
                if l > best_len:
                    best_len, best_dist = l, i - cand
                cand = prev.get(cand, -1)
                chain += 1

        if best_len >= min_len:
            tokens.append((best_len, best_dist))
            for k in range(best_len):
                insert(i + k)
            i += best_len
        else:
            tokens.append(data[i])
            insert(i)
            i += 1
    return tokens
```

A few things to notice. The comparison loop `data[cand + l] == data[i + l]` naturally allows overlapping matches, since `cand + l` can run past `i` into bytes we are in the middle of matching. We insert every position we skip over into the hash table, so later matches can start inside earlier matches. And `max_chain` is the speed knob: zlib's levels 1 through 9 mostly differ in how long a chain they are willing to walk and how hard they try to find a better match.

Try it:

```python
data = b"the cat sat on the mat, the cat sat on the hat"
toks = lz77_encode(data)
assert lz77_decode(toks) == data
print(toks)
```

You will get a run of literals for the first sentence, then a match back to the start for the repeated phrase, then a literal or two where `hat` differs from `mat`.

### 2.5 Lazy matching

There is a subtle improvement worth knowing, because it is in zlib's default levels. Greedy matching takes the longest match at the current position immediately. But sometimes that is a mistake: a slightly worse match now would let you take a much longer match one byte later.

**Lazy matching** handles this. After finding a match at position `i`, the compressor also looks at position `i+1`. If the match there is longer, it emits a literal for `data[i]` and uses the better match. This costs extra time and typically gains a few percent in ratio. Optimal parsers (like zopfli) go further and use dynamic programming over the whole input to find the cheapest token sequence given actual Huffman code costs. Zopfli typically produces output 3 to 8 percent smaller than zlib's best level, at the cost of being very slow, and the result is still plain DEFLATE that any inflater can read.

### 2.6 What LZ77 gives us

After LZ77, we have a sequence of tokens: literals (0 to 255) and matches (length 3 to 258, distance 1 to 32768). If the input was repetitive, the token stream is much shorter than the input. But if we encoded those tokens naively, say 1 flag bit plus 8 bits per literal and 15 plus 8 bits per match, we would waste a lot. Literal `e` and literal `~` would cost the same, even though `e` is vastly more common. Short distances might be much more common than long ones. That skew is what the second stage exploits.

## 3. Idea two: Huffman coding, or "common things get short names"

### 3.1 The intuition

Suppose you must encode a message made of four symbols, A, B, C, D. The obvious fixed-length scheme uses 2 bits each: `A=00, B=01, C=10, D=11`. A 1000-symbol message costs 2000 bits.

Now suppose the message is 70% A, 20% B, 5% C, 5% D. Consider this variable-length code instead:

```
A = 0
B = 10
C = 110
D = 111
```

The expected cost per symbol is 0.70×1 + 0.20×2 + 0.05×3 + 0.05×3 = 0.70 + 0.40 + 0.15 + 0.15 = 1.40 bits. A 1000-symbol message costs about 1400 bits: a 30% saving, with no loss of information.

There is a catch, though. With variable-length codes, how does the decoder know where one code ends and the next begins? The answer is the **prefix property**: no code is a prefix of any other code. In the table above, `0` is a code, so nothing else may start with `0`; `10` is a code, so nothing else may start with `10`; and so on. With the prefix property, the decoder reads bits one at a time and the moment the bits read so far equal a code, it knows that symbol is done. No separators needed.

Any prefix code can be drawn as a binary tree where symbols sit at leaves, and the code for a symbol is the path from the root (0 = left, 1 = right):

```
        (root)
        /    \
      A(0)   (1)
             /  \
          B(10) (11)
                /  \
            C(110) D(111)
```

Decoding is walking this tree: read a bit, go left or right, and when you hit a leaf, emit that symbol and restart at the root.

### 3.2 Building the optimal code

In 1952, David Huffman, then a graduate student, found the algorithm that produces the *optimal* prefix code for a given set of symbol frequencies. It is a greedy algorithm and fits in a few lines:

1. Make a leaf node for every symbol, with weight equal to its frequency.
2. Repeatedly take the two nodes with the smallest weights and merge them into a new parent whose weight is their sum.
3. Stop when one node remains. That is the root.

Rare symbols get merged first, so they end up deep in the tree (long codes). Common symbols are merged last, so they sit near the root (short codes).

Worked example. Frequencies: A=45, B=13, C=12, D=16, E=9, F=5. (This is the classic textbook example.)

```
Start:    F5  E9  C12  B13  D16  A45

Merge F5+E9    → N14.        Now: C12 B13 N14 D16 A45
Merge C12+B13  → N25.        Now: N14 D16 N25 A45
Merge N14+D16  → N30.        Now: N25 N30 A45
Merge N25+N30  → N55.        Now: A45 N55
Merge A45+N55  → root 100.
```

The resulting code lengths: A gets 1 bit, and C, B, D get 3 bits, and E, F get 4 bits. Weighted cost: 45×1 + (12+13+16)×3 + (9+5)×4 = 45 + 123 + 56 = 224 bits per 100 symbols, versus 300 bits for a fixed 3-bit code.

Here is a compact implementation that computes only the code **lengths**, which, as we are about to see, is all DEFLATE needs:

```python
import heapq

def huffman_lengths(freqs):
    """freqs: dict symbol -> count. Returns dict symbol -> code length."""
    items = [(f, i, [s]) for i, (s, f) in enumerate(freqs.items()) if f > 0]
    if len(items) == 1:
        return {items[0][2][0]: 1}
    heapq.heapify(items)
    lengths = {s: 0 for _, _, syms in items for s in syms}
    counter = len(items)
    while len(items) > 1:
        f1, _, s1 = heapq.heappop(items)
        f2, _, s2 = heapq.heappop(items)
        for s in s1 + s2:
            lengths[s] += 1          # every symbol under the merge gets one level deeper
        heapq.heappush(items, (f1 + f2, counter, s1 + s2))
        counter += 1
    return lengths

print(huffman_lengths({'A':45,'B':13,'C':12,'D':16,'E':9,'F':5}))
# {'A': 1, 'B': 3, 'C': 3, 'D': 3, 'E': 4, 'F': 4}
```

Instead of building an explicit tree, each merge adds one to the depth of every symbol beneath it. That is quadratic in the worst case but fine for alphabets of a few hundred symbols.

### 3.3 The entropy limit

How good can this get? Claude Shannon showed that the minimum average bits per symbol for a source is its **entropy**, `H = -Σ p·log₂(p)`. For our 70/20/5/5 example, H ≈ 1.26 bits, and Huffman achieved 1.40. Huffman is optimal among codes that use a *whole number of bits per symbol*, but it can't use fractional bits. A symbol with probability 0.99 ideally costs 0.015 bits, but Huffman must spend at least 1. That is why arithmetic coding and ANS (used in zstd, via FSE) can beat Huffman, and why DEFLATE is not state of the art. But Huffman is simple, fast, and needs no multiplication or division, which mattered a great deal in 1989.

### 3.4 Canonical Huffman codes

Here is the part of DEFLATE that people find clever the first time they see it.

The decoder needs to know the code, so the compressor must transmit it. Sending the whole tree is expensive. But notice something: for a given set of code *lengths*, there are many valid assignments of actual bit patterns. If we pick a **canonical** assignment by a fixed rule, the decoder can reconstruct every code from the lengths alone. We never send the codes, only the length of each symbol's code.

The rule in DEFLATE (RFC 1951, section 3.2.2):

1. Shorter codes numerically precede longer codes (in the sense of the bit strings read as a left-aligned binary fraction).
2. Among codes of the same length, they are assigned in increasing order of symbol value.

The algorithm:

```python
def canonical_codes(lengths):
    """lengths: list indexed by symbol, 0 means unused. Returns list of (code, length)."""
    max_len = max(lengths)
    bl_count = [0] * (max_len + 1)
    for l in lengths:
        if l:
            bl_count[l] += 1

    next_code = [0] * (max_len + 2)
    code = 0
    for bits in range(1, max_len + 1):
        code = (code + bl_count[bits - 1]) << 1 if bits > 1 else 0
        next_code[bits] = code

    codes = [(0, 0)] * len(lengths)
    for sym, l in enumerate(lengths):
        if l:
            codes[sym] = (next_code[l], l)
            next_code[l] += 1
    return codes
```

Careful with `bl_count[0]`: it must be treated as 0 (we skipped zero-length symbols above, so it is). In the RFC the line is `code = (code + bl_count[bits-1]) << 1`, with `bl_count[0] = 0`; my `if bits > 1` guard is equivalent for the first iteration.

Example. Symbols A through F with lengths `A=1, B=3, C=3, D=3, E=4, F=4`:

- Length-1 codes: A gets `0`.
- Length-3 codes start at `(0+1)<<1 = 2`, then `(2+0)<<1 = 4`, so the first 3-bit code is `100`. B=`100`, C=`101`, D=`110`.
- Length-4 codes start at `(4+3)<<1 = 14` = `1110`. E=`1110`, F=`1111`.

Check the prefix property: `0`, `100`, `101`, `110`, `1110`, `1111`. None is a prefix of another. 

This is a big win. Instead of transmitting a tree, DEFLATE transmits an array of small integers (code lengths, at most 15), and both sides rebuild the same codes. And such an array compresses well itself, as we will see.

### 3.5 Decoding canonical codes

A canonical code is also easy to decode without building a tree. The key observation: for each length, the codes of that length form a contiguous numeric range. So the decoder reads bits one at a time, maintaining the value read so far, and at each length checks whether the value falls inside that length's range:

```python
def build_decoder(lengths):
    max_len = max(lengths)
    count = [0] * (max_len + 1)
    for l in lengths:
        count[l] += 1
    count[0] = 0
    # symbols sorted by (length, symbol value)
    symbols = sorted((s for s, l in enumerate(lengths) if l),
                     key=lambda s: (lengths[s], s))
    return count, symbols

def decode_symbol(read_bit, count, symbols):
    code = 0      # bits read so far, as a number
    first = 0     # first canonical code of the current length
    index = 0     # index into `symbols` of the first symbol of this length
    for length in range(1, len(count)):
        code |= read_bit()
        c = count[length]
        if code - c < first:               # code falls in this length's range
            return symbols[index + (code - first)]
        index += c
        first += c
        first <<= 1
        code <<= 1
    raise ValueError("invalid code")
```

This is essentially the algorithm from zlib's `puff.c`, a tiny reference inflater in about 800 lines of C that is worth reading in full. Production inflaters use lookup tables indexed by the next 9 or 10 bits to decode most symbols in a single step instead of bit by bit.

### 3.6 The length limit

DEFLATE caps code lengths at 15 bits (and 7 bits for one of the auxiliary alphabets, as we will see). Plain Huffman can produce longer codes for very skewed distributions: with Fibonacci-like frequencies, the tree degenerates into a long chain. So real compressors need a **length-limited** variant. zlib uses a heuristic: build the tree, and if any code exceeds the limit, shorten the overlong ones and lengthen some shorter ones until the Kraft inequality (`Σ 2^-length ≤ 1`) is satisfied again. The result is slightly suboptimal but always valid. There is also an exact algorithm, package-merge, used by some encoders.

The Kraft inequality, by the way, is the precise condition for a set of lengths to describe a valid prefix code. If `Σ 2^-length` is exactly 1, the code is **complete** (every bit pattern decodes to something); if less than 1, it is **incomplete** (some bit patterns are unused); if more than 1, it is impossible. Inflaters check this to reject corrupt data. (DEFLATE does permit incomplete codes in one narrow case: a code with a single symbol, which uses one bit.)

## 4. Gluing them together: the DEFLATE format

Now we know both ideas. What remains is deciding exactly how a stream of LZ77 tokens is represented using Huffman codes. This is where DEFLATE's specific design choices show up.

### 4.1 Bits, not bytes

First, a fact that trips up everyone: DEFLATE is a **bitstream**. Fields are not byte-aligned (except in stored blocks). Bits are packed starting from the **least significant bit** of each byte. So if you read 3 bits and then 5 bits from the byte `0b10110101`, the first value is the low three bits (`101` = 5) and the second is the upper five bits (`10110` = 22).

There is one more twist. Plain numeric fields (like lengths and "extra bits") are packed **least significant bit first**: the first bit read is the lowest bit of the value. But **Huffman codes are packed most significant bit first**: the first bit read is the *top* bit of the code. This is because a Huffman decoder walks the tree from the root, and the root decision corresponds to the first bit of the code. This inconsistency is the source of countless bugs. When you write the encoder you must bit-reverse each Huffman code before inserting it into the LSB-first output; when you write the decoder, you read bits one at a time and shift them into the code from the bottom, as `decode_symbol` above does.

A bit reader for the decoder side:

```python
class BitReader:
    def __init__(self, data):
        self.data = data
        self.pos = 0        # byte position
        self.bitbuf = 0
        self.bitcnt = 0

    def bit(self):
        if self.bitcnt == 0:
            self.bitbuf = self.data[self.pos]
            self.pos += 1
            self.bitcnt = 8
        b = self.bitbuf & 1
        self.bitbuf >>= 1
        self.bitcnt -= 1
        return b

    def bits(self, n):
        """Read n bits as an integer, LSB first (for numeric fields)."""
        v = 0
        for i in range(n):
            v |= self.bit() << i
        return v
```

`bits(n)` is for numbers; `bit()` fed into `decode_symbol` is for Huffman codes.

### 4.2 Blocks

A DEFLATE stream is a sequence of **blocks**. Each block starts with a 3-bit header:

- 1 bit: `BFINAL`. Is this the last block?
- 2 bits: `BTYPE`. What kind of block?
  - `00`: **stored**. Raw bytes, no compression.
  - `01`: **fixed Huffman**. Compressed with a predefined code.
  - `10`: **dynamic Huffman**. Compressed with codes described in the block itself.
  - `11`: reserved (error).

The top-level decoder loop is therefore:

```python
def inflate(data):
    br = BitReader(data)
    out = bytearray()
    while True:
        final = br.bits(1)
        btype = br.bits(2)
        if btype == 0:
            stored_block(br, out)
        elif btype == 1:
            huffman_block(br, out, FIXED_LITLEN, FIXED_DIST)
        elif btype == 2:
            litlen, dist = read_dynamic_tables(br)
            huffman_block(br, out, litlen, dist)
        else:
            raise ValueError("bad block type")
        if final:
            break
    return bytes(out)
```

Blocks exist because data changes character. The first part of a file might be text and the second part binary; a single Huffman code fit to the whole file would suit neither. By cutting the stream into blocks, the compressor can use a fresh, tuned code for each. The cost is the overhead of describing each block's code, so blocks are typically tens of kilobytes. Importantly, LZ77 matches can reach back across block boundaries: the 32 KiB window slides continuously, and only the Huffman tables are per-block.

### 4.3 Stored blocks

The simplest type. After the 3-bit header, the reader skips to the next byte boundary, then reads:

- `LEN`: 2 bytes, little-endian, the number of data bytes.
- `NLEN`: 2 bytes, the one's complement of `LEN` (a sanity check).
- `LEN` bytes of raw data.

The maximum is 65535 bytes per block. Stored blocks exist so incompressible data (already-compressed JPEGs, encrypted data) grows by only 5 bytes per 64 KiB instead of expanding under Huffman coding.

```python
def stored_block(br, out):
    br.bitcnt = 0                       # discard remaining bits in current byte
    ln = br.data[br.pos] | (br.data[br.pos + 1] << 8)
    nln = br.data[br.pos + 2] | (br.data[br.pos + 3] << 8)
    if ln != (~nln & 0xFFFF):
        raise ValueError("stored block length mismatch")
    br.pos += 4
    out += br.data[br.pos:br.pos + ln]
    br.pos += ln
```

### 4.4 One alphabet for literals and lengths

Now the central design question. We have two kinds of tokens, literals and matches. How do we tell them apart in a Huffman-coded stream? We could spend a flag bit per token, but DEFLATE does something more elegant: it merges both into a single alphabet, the **literal/length alphabet**, with 286 symbols in use (numbered 0..285):

- **0 to 255**: literal bytes.
- **256**: end of block.
- **257 to 285**: match lengths.

A single Huffman code covers all of these. When the decoder reads a symbol below 256, it is a literal. At 256, the block ends. Above 256, it is a length code and a distance follows. The "is it a literal or a match" flag costs nothing separately; it is baked into the Huffman code, so if literals are common they get short codes, and if matches are common the match symbols do.

Lengths range from 3 to 258, which is 256 distinct values, but the alphabet only has 29 length symbols. So length symbols are not exact; they are *ranges*, and a few **extra bits** following the symbol pick the exact value within the range. This is a common trick: Huffman-code the "bucket" (which is skewed and worth modeling), and send the position within the bucket as raw bits (which is nearly uniform, so it isn't worth modeling).

The table:

| Symbol | Extra bits | Lengths | | Symbol | Extra bits | Lengths |
|---|---|---|---|---|---|---|
| 257 | 0 | 3 | | 271 | 2 | 19-22 |
| 258 | 0 | 4 | | 272 | 2 | 23-26 |
| 259 | 0 | 5 | | 273 | 3 | 27-34 |
| 260 | 0 | 6 | | 274 | 3 | 35-42 |
| 261 | 0 | 7 | | 275 | 3 | 43-50 |
| 262 | 0 | 8 | | 276 | 3 | 51-58 |
| 263 | 0 | 9 | | 277 | 4 | 59-66 |
| 264 | 0 | 10 | | 278 | 4 | 67-82 |
| 265 | 1 | 11-12 | | 279 | 4 | 83-98 |
| 266 | 1 | 13-14 | | 280 | 4 | 99-114 |
| 267 | 1 | 15-16 | | 281 | 5 | 115-130 |
| 268 | 1 | 17-18 | | 282 | 5 | 131-162 |
| 269 | 2 | 19-22 | | 283 | 5 | 163-194 |
| 270 | 2 | 23-26 | | 284 | 5 | 195-226 |
| | | | | 285 | 0 | 258 |

Wait, that table is not right as I laid it out, and it is worth getting exactly right, so here is the correct version. Symbols 257 to 264 are lengths 3 to 10 with no extra bits. Then each group of four symbols shares an extra-bit count that increases by one:

| Symbols | Extra bits | Lengths covered |
|---|---|---|
| 257-264 | 0 | 3-10 |
| 265-268 | 1 | 11-18 |
| 269-272 | 2 | 19-34 |
| 273-276 | 3 | 35-66 |
| 277-280 | 4 | 67-130 |
| 281-284 | 5 | 131-257 |
| 285 | 0 | 258 |

For example, symbol 265 covers lengths 11 and 12 (1 extra bit), 266 covers 13-14, 267 covers 15-16, 268 covers 17-18. Symbol 269 covers 19-22 (2 extra bits), and so on. Symbol 284 with 5 extra bits would nominally reach 258, but 258 is given its own symbol 285 with zero extra bits, since the maximum length is so common in highly repetitive data; so symbol 284 covers 227-257.

Rather than memorize it, derive it in code:

```python
LENGTH_BASE = []
LENGTH_EXTRA = []
base = 3
for sym in range(257, 285):
    extra = max(0, (sym - 261) // 4)
    LENGTH_BASE.append(base)
    LENGTH_EXTRA.append(extra)
    base += 1 << extra
LENGTH_BASE.append(258)   # symbol 285
LENGTH_EXTRA.append(0)
```

The pattern: 8 symbols with 0 extra bits, then 4 symbols for each extra-bit count from 1 to 5, then the special 258. Indexing by `sym - 257`.

Symbols 286 and 287 exist in the fixed code but must never appear in data. They are there only to make the fixed code's structure tidy.

### 4.5 The distance alphabet

Distances get their own, separate alphabet of 30 symbols (0 to 29), with their own Huffman code. Using a separate code makes sense: the statistics of distances look nothing like the statistics of literals. A separate alphabet also tells the decoder what to expect: after a length symbol, the next Huffman-coded symbol is *always* a distance.

Distances range 1 to 32768, bucketed the same way: the first four symbols (0-3) are distances 1-4 with no extra bits, then each pair of symbols shares an increasing number of extra bits:

| Symbols | Extra bits | Distances |
|---|---|---|
| 0-3 | 0 | 1-4 |
| 4-5 | 1 | 5-8 |
| 6-7 | 2 | 9-16 |
| 8-9 | 3 | 17-32 |
| 10-11 | 4 | 33-64 |
| 12-13 | 5 | 65-128 |
| 14-15 | 6 | 129-256 |
| 16-17 | 7 | 257-512 |
| 18-19 | 8 | 513-1024 |
| 20-21 | 9 | 1025-2048 |
| 22-23 | 10 | 2049-4096 |
| 24-25 | 11 | 4097-8192 |
| 26-27 | 12 | 8193-16384 |
| 28-29 | 13 | 16385-32768 |

Same idea: the bucketing is roughly logarithmic. Short distances are precise because they are common and cheap to distinguish, and long distances are coarse in the Huffman symbol but exact thanks to the extra bits. Again, derived in code:

```python
DIST_BASE = []
DIST_EXTRA = []
base = 1
for sym in range(30):
    extra = max(0, sym // 2 - 1)
    DIST_BASE.append(base)
    DIST_EXTRA.append(extra)
    base += 1 << extra
```

Check: symbol 4 has `extra = 4//2 - 1 = 1`, base 5, covering 5-6; symbol 5 has base 7, covering 7-8. Symbol 29 has extra 13, base 24577, covering 24577-32768. 

One subtlety of the bit order: the extra bits are numeric fields, so they are read LSB first, even though they come right after a Huffman code that is read MSB first.

### 4.6 Decoding a compressed block

We now have everything to write the heart of the decoder:

```python
def huffman_block(br, out, litlen_dec, dist_dec):
    while True:
        sym = decode_symbol(br.bit, *litlen_dec)
        if sym < 256:
            out.append(sym)
        elif sym == 256:
            return
        else:
            i = sym - 257
            length = LENGTH_BASE[i] + br.bits(LENGTH_EXTRA[i])
            dsym = decode_symbol(br.bit, *dist_dec)
            distance = DIST_BASE[dsym] + br.bits(DIST_EXTRA[dsym])
            if distance > len(out):
                raise ValueError("distance too far back")
            for _ in range(length):
                out.append(out[-distance])
```

That is the whole inner loop of every DEFLATE decompressor in existence, modulo speed. Read a symbol; literal, end, or match; if match, read extra bits for the length, read a distance symbol, read extra bits for the distance, copy.

Note the check `distance > len(out)`. A malicious stream could point before the start of the output; a careful decoder must reject that or it will read out of bounds. (In ZIP and gzip the window starts empty. zlib also supports a preset dictionary, which lets the window start pre-filled, but that is an advanced feature.)

### 4.7 Fixed Huffman blocks

For short inputs, spending bytes to describe a custom Huffman code can cost more than it saves. So DEFLATE defines a fixed code that needs no description. Block type `01` uses it.

The fixed literal/length code has these lengths:

| Symbols | Code length |
|---|---|
| 0-143 | 8 |
| 144-255 | 9 |
| 256-279 | 7 |
| 280-287 | 8 |

and the fixed distance code is simply 5 bits for every one of the 30 (really 32) symbols, so a distance symbol is just its 5-bit number, in MSB-first order.

Feed those lengths to the canonical algorithm and you get the actual codes: the 7-bit codes `0000000`-`0010111` for 256-279, the 8-bit codes `00110000`-`10111111` for literals 0-143, and so on. Fixed blocks are tuned for text-like data, where ordinary ASCII literals get 8 bits (the same as raw, so no gain there), and gains come from matches.

```python
FIXED_LL_LENGTHS = [8]*144 + [9]*112 + [7]*24 + [8]*8
FIXED_DIST_LENGTHS = [5]*30

FIXED_LITLEN = build_decoder(FIXED_LL_LENGTHS)
FIXED_DIST = build_decoder(FIXED_DIST_LENGTHS)
```

The fixed code is a good place to practice. Compress `b"aaaaaaaaaa"` by hand: literal `a` (0x61, symbol 97, 8 bits `10010001`: since 97 + 0x30 = 0x91), then a match of length 9 at distance 1, then end-of-block. Header bits `1 10` (final, type 01 sent LSB first as `1, 1, 0`), then the literal's 8 bits, then length symbol 263 (length 9, no extra bits, 7-bit code `0000111`), then distance symbol 0 (`00000`), then symbol 256 (`0000000`). That's 3 + 8 + 7 + 5 + 7 = 30 bits, 4 bytes, for 10 input bytes. Real zlib output for this input is exactly that, plus the zlib header and checksum if you are using that wrapper.

### 4.8 Dynamic Huffman blocks: sending the codes

Dynamic blocks (type `10`) are where DEFLATE earns its compression. The compressor counts symbol frequencies in the block, builds optimal length-limited Huffman codes for the literal/length alphabet and the distance alphabet, and then must tell the decoder the code lengths. Thanks to canonical codes, only the lengths are needed. But up to 286 + 30 = 316 lengths is still a lot of data, and DEFLATE does what any good format would: it compresses the lengths too, with *another* Huffman code. That is the part that feels like a hall of mirrors the first time, so let's go slowly.

The dynamic block header is:

1. `HLIT` (5 bits): number of literal/length codes minus 257. So 257 to 286 codes.
2. `HDIST` (5 bits): number of distance codes minus 1. So 1 to 32.
3. `HCLEN` (4 bits): number of **code length codes** minus 4. So 4 to 19.
4. `HCLEN + 4` three-bit values: the code lengths for the 19-symbol **code length alphabet**, in a strange fixed order: `16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15`.
5. Then, Huffman-coded with that code length code, the `HLIT + 257` literal/length code lengths followed by the `HDIST + 1` distance code lengths, treated as one continuous sequence.

The odd order in step 4 puts the symbols least likely to be used last, so that trailing zero-length entries can be dropped by lowering `HCLEN`. That is a micro-optimization that saves a few bits.

The **code length alphabet** has 19 symbols:

- **0 to 15**: a literal code length of that value (0 meaning "this symbol is unused").
- **16**: copy the previous code length 3 to 6 times (2 extra bits, value + 3).
- **17**: repeat a zero length 3 to 10 times (3 extra bits, value + 3).
- **18**: repeat a zero length 11 to 138 times (7 extra bits, value + 11).

So the code lengths themselves are run-length encoded. That matters because they are full of runs: a typical block uses few of the rare literals, so the length array has long stretches of zeros, and runs of identical lengths for similar symbols.

The three layers, to keep them straight:

1. The **code length code** (max 7 bits per code, since lengths are 3 bits each) describes...
2. the **literal/length and distance codes** (max 15 bits per code), which describe...
3. the **actual data**.

Reading the tables:

```python
CL_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]

def read_dynamic_tables(br):
    hlit  = br.bits(5) + 257
    hdist = br.bits(5) + 1
    hclen = br.bits(4) + 4

    cl_lengths = [0] * 19
    for i in range(hclen):
        cl_lengths[CL_ORDER[i]] = br.bits(3)
    cl_dec = build_decoder(cl_lengths)

    lengths = []
    while len(lengths) < hlit + hdist:
        sym = decode_symbol(br.bit, *cl_dec)
        if sym < 16:
            lengths.append(sym)
        elif sym == 16:
            if not lengths:
                raise ValueError("repeat with no previous length")
            lengths += [lengths[-1]] * (3 + br.bits(2))
        elif sym == 17:
            lengths += [0] * (3 + br.bits(3))
        else:  # 18
            lengths += [0] * (11 + br.bits(7))

    if len(lengths) != hlit + hdist:
        raise ValueError("code length run overflows")
    litlen = build_decoder(lengths[:hlit])
    dist = build_decoder(lengths[hlit:])
    return litlen, dist
```

Two details. First, the runs can cross from the literal/length lengths into the distance lengths; they are one sequence, so the decoder must not reset between them. Second, a real decoder must check that the end-of-block symbol (256) has a nonzero length, or the block can never end.

A hardened `build_decoder` would also validate the Kraft sum so that oversubscribed or (apart from the one-symbol special case) incomplete codes are rejected. The simple version above skips that, which is fine for learning and not fine for decoding untrusted input.

### 4.9 A full round trip

With all pieces in place, you can run the decoder against the real thing. Python's `zlib` module can produce raw DEFLATE (negative `wbits` means no wrapper):

```python
import zlib

def raw_deflate(data, level=9):
    c = zlib.compressobj(level, zlib.DEFLATED, -15)
    return c.compress(data) + c.flush()

text = b"the cat sat on the mat, the cat sat on the hat " * 20
packed = raw_deflate(text)
print(len(text), "->", len(packed))
assert inflate(packed) == text
```

That input is 980 bytes of very repetitive text, and it will compress down to somewhere around 50 to 60 bytes. If `inflate` returns the original, you have written a correct DEFLATE decompressor. (You still need to fill in the stored-block and fixed-table pieces, which are above; the compressor above will usually emit a fixed or dynamic block for tiny inputs.)

If the output mismatches, the usual culprits are, in rough order of likelihood: Huffman codes read in the wrong bit order, the overlapping-copy case handled with a bulk copy, off-by-one in the length or distance tables, and forgetting that code lengths run across the literal/distance boundary.

## 5. Looking inside a real stream

It is educational to dump the blocks of a real stream. Here is a small tracer that prints each block's type and size, built on the pieces above:

```python
def trace(data):
    br = BitReader(data)
    n = 0
    out = bytearray()
    while True:
        final = br.bits(1)
        btype = br.bits(2)
        before = len(out)
        if btype == 0:
            stored_block(br, out); kind = "stored"
        elif btype == 1:
            huffman_block(br, out, FIXED_LITLEN, FIXED_DIST); kind = "fixed"
        elif btype == 2:
            ll, d = read_dynamic_tables(br)
            huffman_block(br, out, ll, d); kind = "dynamic"
        else:
            raise ValueError("bad block")
        print(f"block {n}: {kind:8s} -> {len(out)-before} bytes"
              f"{' (final)' if final else ''}")
        n += 1
        if final:
            break
```

Run it on the compressed form of a large source file and you will typically see dynamic blocks of a few tens of kilobytes each. On already-compressed input (a JPEG, say) you will see stored blocks, since zlib falls back to them when Huffman coding would not help. On tiny input you will see one fixed block.

The choice among the three is the encoder's: it computes the exact size of the block under each representation and picks the smallest. That decision is a nice example of a general design principle in DEFLATE: **the format gives the encoder many options and the decoder none**. The decoder is a simple, deterministic machine; all the cleverness lives on the encoder side, and it can improve over time without breaking compatibility.

## 6. The wrappers: gzip, zlib, PNG, ZIP

With the core understood, the wrappers are almost boring, which is the point.

**zlib (RFC 1950).** Two header bytes: `CMF` (compression method 8 for DEFLATE, plus the window size as a log2 minus 8) and `FLG` (check bits so that the 16-bit header is a multiple of 31, a flag for a preset dictionary, and a compression-level hint). Then the raw DEFLATE stream. Then a 4-byte big-endian **Adler-32** checksum of the uncompressed data. The most common header you will see is `78 9C` (default compression); `78 01` is no/low compression and `78 DA` is best compression. If you have ever looked at the hex of a PNG and seen `78 9C` right after `IDAT`, that is why.

Adler-32 is a deliberately cheap checksum: two running 16-bit sums modulo 65521, the largest prime below 2^16. It is fast but weaker than CRC for short inputs.

**gzip (RFC 1952).** A 10-byte header: magic bytes `1F 8B`, method `08`, flags, a 4-byte modification time, extra flags, and an OS byte. Optional fields follow depending on the flags: extra data, original filename (zero-terminated), a comment, a header CRC. Then the raw DEFLATE stream. Then a 4-byte **CRC-32** of the uncompressed data and a 4-byte length modulo 2^32. A gzip file can contain several concatenated members, and `gunzip` decodes them as one stream, which is a handy property for appending to logs.

Note that gzip compresses a single stream. It has no notion of a directory or multiple files. That is why `.tar.gz` exists: `tar` bundles files into one stream, and gzip compresses it. One consequence is that extracting one file from a `.tar.gz` requires decompressing everything before it.

**ZIP.** Here DEFLATE is just one of the compression methods (method 8). Each file is compressed independently as a raw DEFLATE stream with no zlib or gzip header, and the archive stores a CRC-32 and sizes in a per-file header plus a central directory at the end. Independence is what gives ZIP random access: you can read the central directory, seek to one file, and inflate only that. The price is that matches cannot reference data in other files, so ZIP compresses a directory of similar small files worse than `.tar.gz` does. Many other formats are secretly ZIP files: `.docx`, `.xlsx`, `.jar`, `.apk`, `.epub`.

**PNG.** The image's scanlines are first passed through **filters**: each row is tagged with a filter type (None, Sub, Up, Average, or Paeth) that replaces each byte by its difference from a prediction based on neighboring pixels. Filtering does not reduce the size by itself, but it converts smooth gradients into streams of small numbers near zero, which is highly skewed data, just what Huffman coding wants, and highly repetitive in flat regions, just what LZ77 wants. The filtered bytes are then compressed as a single zlib stream, which may be split across multiple `IDAT` chunks (the chunk boundaries have no relation to DEFLATE block boundaries). This is a general pattern: a **transform** that exposes redundancy, followed by a generic compressor that removes it. Tools like `optipng`, `zopflipng`, and `oxipng` shrink PNGs mostly by trying filter strategies and using a stronger DEFLATE encoder, without changing a single decoded pixel.

## 7. Why it works so well, and why it is not the end

It is worth pausing on why such a modest design has lasted. A few reasons:

- **Small state.** The decoder needs the 32 KiB window plus a few kilobytes of tables. It runs on microcontrollers and in browsers alike.
- **Fast decoding.** Decoding is a tight loop of table lookups and byte copies, easily hundreds of megabytes per second per core, and libraries like libdeflate and zlib-ng push it much further.
- **Encoder freedom.** As described, the format allows any parse and any block splitting, so encoders improved for decades (zopfli, libdeflate, zlib-ng, hardware accelerators) without any change to the decoders deployed in the wild.
- **Patent-free and simple.** The format was unencumbered and fits in a short document, so it was implemented everywhere.

Its limitations are equally clear from the design:

- **The 32 KiB window.** Repetition farther back than 32 KiB is invisible. Modern formats use windows of megabytes or more (Zstandard, Brotli, LZMA).
- **Whole-bit Huffman codes.** As discussed, Huffman can't spend a fractional bit. Zstandard's FSE and range coders do better.
- **No context modeling.** Each symbol is coded independently, apart from the LZ77 step. A model that conditions on previous symbols can do much better on text.
- **Block-level adaptivity only.** The codes are static within a block, so the compressor must guess block boundaries, and the code description is overhead that is paid for every block.
- **Bit-at-a-time dependencies.** Decoding is inherently serial: where the next symbol begins depends on decoding the previous one, which limits parallelism.

Brotli, Zstandard, and LZMA all fix some combination of these, and for new systems they are usually better choices. But DEFLATE is what every browser, every language's standard library, and every operating system already speaks, so it remains the safe default for interchange.

## 8. A compact summary of the format

If you want a one-screen reference to keep next to your editor:

**Stream**: a sequence of blocks until one has `BFINAL = 1`.

**Block header**: `BFINAL` (1 bit), `BTYPE` (2 bits). Numeric fields are LSB first; Huffman codes are MSB first.

**BTYPE 00, stored**: skip to byte boundary; `LEN` (16), `NLEN` (16); `LEN` raw bytes.

**BTYPE 01, fixed**: literal/length lengths 8/9/7/8 for 0-143/144-255/256-279/280-287; distance codes are 5 bits.

**BTYPE 10, dynamic**: `HLIT` (5), `HDIST` (5), `HCLEN` (4); `HCLEN + 4` 3-bit lengths in order `16 17 18 0 8 7 9 6 10 5 11 4 12 3 13 2 14 1 15`; then `HLIT + 257` plus `HDIST + 1` lengths coded with the code length code, using symbols 16 (repeat previous 3-6), 17 (zeros 3-10), 18 (zeros 11-138).

**Compressed data**: repeat: decode a literal/length symbol. `< 256`: output the byte. `== 256`: end of block. `> 256`: compute the length from the table plus extra bits, decode a distance symbol, compute the distance plus extra bits, then copy `length` bytes from `distance` back, one at a time.

**Limits**: window 32768 bytes, match length 3 to 258, code lengths up to 15 bits (7 for the code length code).

**Canonical codes**: for each length, codes are consecutive integers; the first code of each length is `(first code of previous length + count of previous length) << 1`; within a length, symbols are assigned in increasing symbol order.

## 9. Exercises

The best way to make this stick is to build it. Some suggestions in increasing difficulty:

1. **Finish the inflater.** Assemble the snippets above into one file, test it against `zlib.compress` output with the 2-byte header skipped and the 4-byte trailer ignored, and against many random and text inputs at all compression levels. Fuzz it with corrupted input to make sure it raises errors instead of crashing or looping.
2. **Hand-assemble a fixed block.** Write a tiny encoder that emits only fixed-Huffman blocks, with the LZ77 encoder from section 2.4 supplying tokens. You will need a bit writer and the bit-reversal of Huffman codes. Check that Python's `zlib.decompress` accepts your output.
3. **Add dynamic blocks.** Count frequencies, build length-limited code lengths, run-length encode them with symbols 16/17/18, build the code length code, and emit the header. Compare your sizes against zlib's. You will likely be within a few percent.
4. **Add block-type selection.** For each block, compute the exact bit cost of stored, fixed, and dynamic representations, and emit the cheapest.
5. **Improve the parser.** Add lazy matching, then try an optimal parse: compute, for each position, the cheapest way to reach the end given estimated code costs, iterating a few times as the Huffman costs converge. This is, in essence, what zopfli does.
6. **Make it fast.** Replace the bit-at-a-time decoder with a table lookup on the next 10 bits, keep a 64-bit bit buffer, and handle the common-case match copy with word-sized copies. You can gain more than an order of magnitude.

## 10. Closing thoughts

DEFLATE rewards the way a programmer thinks about problems: find the two or three simple ideas that matter, and make them compose cleanly. LZ77 says "don't repeat yourself." Huffman says "don't spend the same number of bits on things that happen at different rates." The rest, the bucketed length and distance codes with extra bits, canonical codes so only lengths need transmitting, run-length encoding of those lengths via a third Huffman code, block types so incompressible data costs almost nothing, are each a small, local, well-motivated optimization that squeezes out one more source of waste.

Once you have read it through, a lot of everyday software stops being magic. A `.gz` file is a 10-byte header, a sequence of blocks, and an 8-byte trailer. A PNG is filtered scanlines in a zlib stream. A `.docx` is a folder of XML files, each a DEFLATE stream. And the next time something offers you "maximum compression," you will know it means "walk longer hash chains and spend more time choosing block boundaries," not "a different algorithm."

The best next step is the one from the exercises: write the decoder. It is only a few hundred lines in any language, and when it correctly inflates its first real `.gz` file, you will understand a piece of infrastructure that quietly carries a very large share of the world's data.
