# How DEFLATE works

When a web server sends you a page compressed with gzip, when a program opens a PNG image, and when you unpack a ZIP archive, the same compression method is doing the work underneath. It is called DEFLATE. This post answers two questions. How does DEFLATE make data smaller? And could you do each step yourself, with a pencil, on a small example? By the end you should be able to explain it to a colleague and write the core of a compressor and a decompressor.

The short answer is that DEFLATE stacks two ideas. The first, LZ77, removes repetition: when a piece of data shows up for the second time, write down where the earlier copy is instead of writing the piece again. The second, Huffman coding, removes skew: when some values occur far more often than others, give the common values short patterns of bits and the rare values long patterns. LZ77 runs first, and Huffman coding then shrinks what LZ77 produced.

I explain each idea separately with small numbers, then show how DEFLATE joins them, then walk one example from raw text to the exact bytes of a compressed stream. The same 23 character example comes back several times so you can see where every bit goes.

## Where DEFLATE shows up

DEFLATE is a format for a stream of compressed bits, written down in a public specification called RFC 1951. By itself it has no file name, no checksum and no header. Four familiar formats wrap it:

- **gzip** (RFC 1952) puts a header of at least 10 bytes in front and an 8 byte trailer behind. The trailer holds a checksum of the original data and the original size.
- **zlib** (RFC 1950) is used by many programs as a library. It puts a 2 byte header in front and a 4 byte checksum behind.
- **PNG** stores the image rows inside a zlib stream. Before compressing, PNG applies a filtering step that makes neighbouring pixels easier to compress. That step is not part of DEFLATE.
- **ZIP** stores one DEFLATE stream per file, with no zlib header, and records sizes and checksums in its own headers.

Because all four contain the same core, learning DEFLATE once covers all of them. This also explains an annoying fact that we will meet at the end: for a very small input, the wrapper can be bigger than the saving.

## Bits, bytes, and what "smaller" means

I measure size in bits. A bit is one binary digit, 0 or 1. A byte is a group of 8 bits, so a byte can hold 256 different values (2 multiplied by itself 8 times). Ordinary files spend one byte per character, which means every character costs 8 bits whether it is the letter `e` or a rare symbol. DEFLATE succeeds when it spends fewer bits than that, on average.

## Can data get smaller at all?

Is there a trick that shrinks every file? No, and the reason matters because it tells you what DEFLATE can and cannot promise.

Count the possibilities. There are 8 different strings of exactly 3 bits (000, 001, up to 111). There are only 7 strings shorter than 3 bits: the empty string, 2 strings of 1 bit, and 4 strings of 2 bits. A compressor must send different inputs to different outputs, because otherwise the decompressor could not tell which input to restore. With 8 inputs and only 7 shorter outputs, at least one 3 bit input cannot get a shorter output. The same counting works for any size: there are 2 to the power n strings of n bits, but only 2 to the power n, minus 1, strings that are shorter.

So no compressor shrinks every input. Compression works by making some inputs shorter at the price of making others a little longer, and it pays off only because the data we care about (text, source code, tables, pictures with flat areas) is far from random. The rule is: compression helps exactly when the data has regularities the compressor knows how to exploit, and it cannot help data without regularities.

Two exceptions follow directly. Data that is already compressed or encrypted looks random, so DEFLATE gains nothing on it. And DEFLATE needs a safety net for such data, so that the output does not grow without limit. The safety net is the stored block, covered later. It copies the input unchanged at a cost of about 5 bytes for every 65,535 bytes, which is under 0.01 percent, plus the wrapper.

## The two kinds of waste DEFLATE removes

What regularities does DEFLATE look for? Two, and they are different from each other.

The first is repetition: the same sequence of bytes appears more than once. In the sentence "the cat sat on the mat", the three letters "at" appear three times, and "the " appears twice. HTML pages, source code and logs are full of repeated phrases such as `<div class=` or `return `. LZ77 targets this.

The second is skew: some byte values are used far more often than others, even when no long phrase repeats. In English text the letter `e` makes up about 12.7 percent of the letters and `z` about 0.07 percent. If every letter costs 8 bits, then `e` is badly overpaid, because a value that appears constantly could be written with fewer bits. Huffman coding targets this.

The two are independent. A file can repeat phrases while using all byte values equally often (then LZ77 helps and Huffman does not), or have heavy skew with no repeated phrase (then the reverse). Real data usually has both, which is why DEFLATE uses both.

The order matters, and there is a reason for it. LZ77 runs first because it looks for identical sequences of whole bytes. Huffman coding writes bytes as codes of different lengths, so after it, identical phrases no longer start at the same bit positions inside a byte, and finding them becomes much harder. LZ77 also creates new skew of its own, because the lengths and distances it produces are not equally common either. So the right order is LZ77 first, Huffman coding second.

## Part one: LZ77 removes repetition

### The problem it solves

LZ77 answers this question: if the next piece of data already appeared earlier, can we say so cheaply instead of writing it again? Yes. Instead of writing the piece, write "go back 7 bytes and copy 4 bytes". The name comes from Abraham Lempel and Jacob Ziv, who published the idea in 1977.

### One example, step by step

Take the text `abracadabra abracadabra`: the word abracadabra, one space, then the word again. That is 11 + 1 + 11 = 23 bytes. Number the positions from 0 to 22, so position 0 is the first `a` and position 11 is the space.

The compressor stands at position 0 and repeats one question: does the text that starts at my current position also appear earlier? If a match of at least 3 bytes exists, write down the match and jump past it. Otherwise write the current byte itself and move forward by one. Here is how that goes:

- Positions 0, 1 and 2 hold `a`, `b`, `r`. Nothing precedes them, so each is written as itself.
- Position 3 holds `a`. An `a` appeared earlier, at position 0, but the bytes after it differ (`b` earlier, `c` now), so only 1 byte matches. That is too short, so `a` is written as itself.
- Position 4 holds `c`, which has never appeared, so it is written as itself.
- Position 5 holds `a`. Earlier copies of `a` are followed by `b` and by `c`, but now it is followed by `d`, so again only 1 byte matches. It is written as itself.
- Position 6 holds `d`, new, so it is written as itself.
- Position 7 starts the text `abra `. Earlier, position 0 starts `abra` followed by `c`, but here the fifth byte is a space, so exactly 4 bytes match. The compressor writes: go back 7 bytes (position 7 minus position 0) and copy 4 bytes. It then jumps to position 11.
- Position 11 holds a space. It has never appeared, so it is written as itself.
- Position 12 starts the final `abracadabra`, 11 bytes up to the end. The same 11 bytes appear at position 0, so the compressor writes: go back 12 bytes and copy 11 bytes. The text is finished.

Another candidate at position 12 was the `abra` at position 7, but it matches only 4 bytes before the space breaks it, so the compressor prefers the 11 byte match. When several earlier places match, take the longest.

### Naming the pieces

A byte written as itself is called a **literal**. A "go back and copy" instruction is called a **match**, and it consists of two numbers: the **length**, which is how many bytes to copy, and the **distance**, which is how far back the copy starts. Our example is therefore seven literals (`a`, `b`, `r`, `a`, `c`, `a`, `d`), then the match with length 4 and distance 7, then the literal space, then the match with length 11 and distance 12.

That is 10 pieces for 23 bytes, but 10 pieces is not yet a size, because a match is bigger than a literal. We count the real bits in part three. What we can already see is the saving: the 11 byte match replaces 11 bytes with two small numbers.

Why is the minimum match length 3? The format has no way to write a length below 3. This is no real loss, because a match carries two numbers and costs more bits than one literal, so a match of 1 or 2 bytes would almost never save anything.

### Decoding

The decompressor is much simpler than the compressor, which is one reason LZ77 is popular. It keeps the output produced so far and processes the pieces in order. A literal is appended. A match copies bytes from the output, starting at the given distance before the current end.

On our example the output after the seven literals is `abracad`, which is 7 bytes. The match with length 4 and distance 7 looks 7 bytes back from the end, which is position 0, and copies 4 bytes (`abra`), giving `abracadabra`. The space literal makes it 12 bytes. The final match with length 11 and distance 12 looks 12 bytes back, which is position 0 again, and copies 11 bytes, giving all 23 bytes of the original.

### Matches that overlap themselves

What if the length is larger than the distance? Take the text `aaaaaaaaaa`, ten letters `a`. The compressor writes the first `a` as a literal. Then at position 1 the text `aaaaaaaaa` (9 bytes) matches the text starting at position 0 if we let the match run past its own starting point, because each `a` equals the one before it. The pieces are the literal `a` and a match with length 9 and distance 1.

Does this decode correctly? Only if the decoder copies one byte at a time. With distance 1, the first copied byte is the `a` at position 0. That byte is appended, so now the byte 1 position back is the byte just written, and the second copy reads it, and so on. After 9 steps the output is ten `a` letters. If a decoder instead copied a whole block at once, it would try to read bytes that do not exist yet. So the rule is: always copy one byte at a time, and then the length may be larger than the distance. This is how LZ77 gets repeated runs of one byte, or of a short pattern like `ababab`, almost for free.

### How far back and how long

DEFLATE limits matches in two ways. The length is from 3 to 258 bytes, and the distance is from 1 to 32,768 bytes. The decoder has to keep the last 32,768 bytes of its output available, and that region is called the **window**, because it slides forward as more output is produced.

The limits hold for every DEFLATE stream, and they have a consequence worth remembering. If a phrase repeats but the earlier copy is more than 32,768 bytes behind, LZ77 inside DEFLATE cannot point to it, and the repeat is not exploited. A very long match can also be split: a run of 1,000 identical bytes is written as one literal plus several matches, because no single match is longer than 258.

### Finding matches without checking everything

The question for the compressor is how to find the longest earlier match quickly. The brute force way is to compare the text at the current position with the text starting at every one of the up to 32,768 earlier positions. For a 1 MiB file (1,048,576 bytes) that is about 34 billion starting points to check, which is too slow.

Real compressors use a table. At each position they take the next 3 bytes as a key and store the position in a list for that key. To find candidates for the current position, they look up the list for the current 3 bytes, so they only compare against earlier places that already agree on the first 3 bytes, which every match needs anyway. In our example, the key `abr` has positions 0 and 7 when the compressor stands at position 12. It checks both, finds lengths 11 and 4, and picks 11.

The lists can get long, so compressors give up after a fixed number of candidates. This means a fast setting may miss the longest match, and a slow setting finds more. That is the main difference between compression levels such as `gzip -1` and `gzip -9`: not the format, only how hard the compressor searches. The output is valid DEFLATE either way.

### A version you can run

This brute force compressor is slow on big inputs, but it follows the procedure above exactly. A match is only taken if it has at least 3 bytes, and when two candidates have the same length it takes the nearer one, because a smaller distance never costs more bits.

```python
def lz77_pieces(data, window=32768, min_len=3, max_len=258):
    result = []
    i = 0
    while i < len(data):
        best_len = 0
        best_dist = 0
        for j in range(max(0, i - window), i):
            length = 0
            while (length < max_len and i + length < len(data)
                   and data[j + length] == data[i + length]):
                length += 1
            # Later j is nearer, so on a tie the nearer one wins.
            if length >= best_len:
                best_len = length
                best_dist = i - j
        if best_len >= min_len:
            result.append(("match", best_len, best_dist))
            i += best_len
        else:
            result.append(("literal", data[i]))
            i += 1
    return result


def lz77_decode(pieces):
    out = bytearray()
    for piece in pieces:
        if piece[0] == "literal":
            out.append(piece[1])
        else:
            _, length, distance = piece
            for _ in range(length):      # one byte at a time, on purpose
                out.append(out[-distance])
    return bytes(out)
```

Running `lz77_pieces(b"abracadabra abracadabra")` gives seven literals, the match with length 4 and distance 7, the literal 32 (the space), and the match with length 11 and distance 12, exactly as we worked it out by hand.

## Part two: Huffman coding removes skew

### The problem it solves

After LZ77, we have a list of literals, lengths and distances, and we must turn each into bits. How many bits should each one get? The simplest answer is the same number for all. Huffman coding answers differently: give common values short codes and rare values long codes, so that the total is smaller. It is named after David Huffman, who published it in 1952.

A word on terms before the example. A **symbol** is one item of whatever we are encoding (a letter, a byte value, and later a length). A **code** is the pattern of bits we write for a symbol, and its **code length** is how many bits that pattern has. I always say "code length" in full, to keep it apart from the length of a match in part one.

### An example with real numbers

To study Huffman coding alone, forget LZ77 for a moment and take a message of 16 symbols made from five different symbols:

`abacabadabaeabac`

Counting: `a` occurs 8 times, `b` 4 times, `c` 2 times, `d` once and `e` once, which adds up to 16.

Stored as ordinary bytes, the message costs 16 times 8 = 128 bits. Five different symbols can be told apart with 3 bits each, because 2 bits give only 4 patterns and 3 bits give 8. So a fixed width code costs 16 times 3 = 48 bits. But `a` makes up half the message, and spending 3 bits on it every time is wasteful. Can we use fewer bits for `a` and more for `d` and `e`, which are rare?

### Why codes of different lengths need a rule

Try it naively: `a` is `0`, `b` is `1`, `c` is `01`. Now the received bits `01` could mean `a` followed by `b`, or `c`. The decoder cannot tell, because it does not know where one code ends and the next begins. With fixed width codes this problem does not exist, since every code is 3 bits long.

The fix is a rule: no code may be the beginning of another code. A set of codes with this property is called a **prefix code**. With a prefix code, the decoder reads bits until what it has read equals one of the codes. It can stop right there, because no longer code starts with the same bits.

A prefix code can be drawn as a tree. Start at the top, and at every fork take the branch labelled 0 or 1. Each symbol sits at a leaf (a place with no further forks), and its code is the labels along the path from the top. Because symbols sit only at leaves, no path to one symbol passes through another symbol, which is exactly the prefix rule. Here is the tree we will build for our message:

```
            (top)
           0/    \1
          a      ( )
                0/  \1
               b     ( )
                    0/  \1
                   c     ( )
                        0/  \1
                       d      e
```

Reading off the paths gives `a` = 0, `b` = 10, `c` = 110, `d` = 1110, `e` = 1111.

### Building the tree: Huffman's procedure

How do we choose a good tree for given counts? Huffman's procedure is: take the two symbols with the smallest counts, join them into one group whose count is their sum, and repeat with the groups until only one group remains. On our counts:

1. Start with `a` 8, `b` 4, `c` 2, `d` 1, `e` 1. The two smallest are `d` and `e`. Join them into a group with count 2.
2. Now the items are `a` 8, `b` 4, `c` 2, and the group (`d`, `e`) 2. The two smallest are `c` and the group (`d`, `e`). Join them into a group with count 4.
3. Now `a` 8, `b` 4, and the group (`c`, `d`, `e`) 4. Join `b` with that group, giving a group with count 8.
4. Now `a` 8 and the group (`b`, `c`, `d`, `e`) 8. Join them, giving 16, and we are done.

Every join makes a fork in the tree. The symbols in a joined group all end up one fork deeper, so a symbol's code length is the number of joins its group went through. Symbol `a` was only joined in the last step, so its code length is 1. Symbol `b` was joined in steps 3 and 4, so 2. Symbol `c` took part in steps 2, 3 and 4, so 3. Symbols `d` and `e` took part in all four joins, so 4. That matches the tree above.

The cost of the whole message is each count multiplied by its code length, added up: 8 times 1, plus 4 times 2, plus 2 times 3, plus 1 times 4, plus 1 times 4, which is 8 + 8 + 6 + 4 + 4 = 30 bits. Compare that with 128 bits as bytes and 48 bits with a fixed width of 3 bits.

Encoding the message `abacabadabaeabac` symbol by symbol gives `0 10 0 110 0 10 0 1110 0 10 0 1111 0 10 0 110`, which written together is `010011001001110010011110100110`. Counting the bits in groups of five, `01001 10010 01110 01001 11101 00110`, confirms there are 30.

Decoding that string uses the tree. The first bit is 0, which reaches the leaf `a`. Next, 1 goes right, then 0 goes left, reaching `b`. Next, 0 gives `a`. Then 1, 1, 0 reaches `c`. Each time a leaf is reached, the decoder outputs its symbol and starts again from the top.

### Why joining the two smallest is right

There are two reasons. First, in a best possible code the two least common symbols must be at the deepest level. If a rarer symbol had a shorter code than a more common one, swapping the two would lower the total number of bits. Second, the deepest level always has at least two leaves that are siblings (they share a fork), so the two rarest symbols can be treated as siblings, and joining them into one group leaves a smaller version of the same problem. Repeating this gives the whole procedure.

The result is optimal in a precise sense: among all prefix codes that give each symbol a whole number of bits, no code uses fewer bits in total for these counts. When counts tie, different choices can produce different trees, but they cost the same number of bits.

The word "whole" hides a limit. A symbol cannot have a code length of 0.47 bits. Suppose a message uses only two symbols, one 90 percent of the time and the other 10 percent. Huffman coding gives each a 1 bit code, so it spends exactly 1 bit per symbol. The theoretical best for those odds is about 0.469 bits per symbol, so Huffman coding wastes more than half. In our example the counts were 1/2, 1/4, 1/8, 1/16 and 1/16, which are powers of one half, so Huffman coding hit the theoretical best exactly (1.875 bits per symbol, and 30 divided by 16 is 1.875). When the odds are not powers of one half, as with 90 and 10, it falls short. A different method called arithmetic coding can spend fractions of a bit, but DEFLATE does not use it. In DEFLATE the shortfall is softened because a single match stands for many bytes, so the 1 bit minimum is paid once per match instead of once per byte.

### Telling the decoder which code you used

The decoder needs the same code. Sending the whole tree would be expensive. But notice that the tree is not needed, only the code length of each symbol. DEFLATE defines a rule that turns code lengths into codes, so both sides compute the same codes. The rule has two parts: shorter codes come numerically before longer codes, and codes of the same length are given out in increasing order of the symbol.

Here it is on our lengths (`a` 1, `b` 2, `c` 3, `d` 4, `e` 4). The only code of length 1 is `0`, given to `a`. To start the codes of length 2, take the last code used, `0`, add 1 to get `1`, and then append a 0 to lengthen it to 2 bits, giving `10`, which goes to `b`. For length 3, take `10`, add 1 to get `11`, append a 0 to get `110`, which goes to `c`. For length 4, take `110`, add 1 to get `111`, append a 0 to get `1110`, which goes to `d`. The next symbol of the same length, `e`, gets that code plus 1, which is `1111`. These are the same codes as the tree gave, but now they came from the lengths alone. In general the tree you build might label left and right branches differently and so give different codes of the same lengths, and the rule above picks one canonical choice that both sides can reproduce.

The same idea as a program, in two small functions:

```python
import heapq

def huffman_lengths(counts):
    """counts: dict symbol -> how many times it occurs (all above 0)."""
    if len(counts) == 1:
        return {symbol: 1 for symbol in counts}
    heap = [(count, i, [symbol])
            for i, (symbol, count) in enumerate(sorted(counts.items()))]
    heapq.heapify(heap)
    lengths = {symbol: 0 for symbol in counts}
    next_id = len(heap)
    while len(heap) > 1:
        count1, _, group1 = heapq.heappop(heap)
        count2, _, group2 = heapq.heappop(heap)
        for symbol in group1 + group2:
            lengths[symbol] += 1          # one fork deeper
        heapq.heappush(heap, (count1 + count2, next_id, group1 + group2))
        next_id += 1
    return lengths


def canonical_codes(lengths):
    """lengths: dict symbol -> code length. Returns symbol -> bit string."""
    max_len = max(lengths.values())
    how_many = [0] * (max_len + 1)
    for length in lengths.values():
        how_many[length] += 1
    how_many[0] = 0
    next_code = [0] * (max_len + 1)
    code = 0
    for bits in range(1, max_len + 1):
        code = (code + how_many[bits - 1]) << 1
        next_code[bits] = code
    codes = {}
    for symbol in sorted(lengths):
        length = lengths[symbol]
        codes[symbol] = format(next_code[length], "0" + str(length) + "b")
        next_code[length] += 1
    return codes
```

Calling `canonical_codes(huffman_lengths({"a": 8, "b": 4, "c": 2, "d": 1, "e": 1}))` gives `0`, `10`, `110`, `1110` and `1111`. For DEFLATE you would call `canonical_codes` only with symbols whose length is above 0, because a symbol that never occurs gets no code.

### Conditions that DEFLATE adds

Two conditions apply on top of the plain method. First, DEFLATE limits every code length to at most 15 bits. Huffman's procedure can produce a longer code when the counts are extremely uneven and the data is large. When that happens, real compressors shorten the longest codes and lengthen some shorter ones until every length is 15 or less, which costs a little compression. Second, the lengths you send must describe a valid prefix code. If too many symbols claim short codes, there are not enough bit patterns to go around, and decoders reject such a stream.

## Part three: how DEFLATE joins them

### The shape of a stream: blocks

A DEFLATE stream is a series of **blocks**. Each block starts with 3 bits. The first bit says whether this is the last block (1 means last). The next 2 bits, read as a number, say what kind of block follows:

- `00` is a **stored block**: the bytes are copied unchanged, with no LZ77 and no Huffman coding.
- `01` is a **fixed block**: LZ77 pieces encoded with one Huffman code that is built into the format, so nothing needs to be sent about it.
- `10` is a **dynamic block**: LZ77 pieces encoded with Huffman codes that the compressor built for this block, preceded by a description of those codes.
- `11` is not allowed.

Blocks exist because data changes character. The first part of a file might be English text and the next part a table of numbers, and one Huffman code is a poor fit for both. A new block lets the compressor switch codes, at the cost of describing the new codes. Matches may reach back across block boundaries, because the window slides over everything written so far, not only the current block.

### Turning matches into symbols: two alphabets

The Huffman codes in DEFLATE are built over two sets of symbols. A set of symbols is called an **alphabet**. The first, the literal and length alphabet, has symbols 0 to 285:

- Symbols 0 to 255 are literals (the byte value itself).
- Symbol 256 means "end of this block".
- Symbols 257 to 285 stand for match lengths.

The second, the distance alphabet, has symbols 0 to 29, each standing for a range of distances.

Putting literals and lengths in one alphabet means the decoder needs only one decision at each step: decode one symbol, and if it is below 256 it is a literal, if it is 256 the block is over, and if it is above 256 a match follows. After a length symbol, a distance always follows, so the decoder knows to switch to the distance code. This is why distances can have their own alphabet without any marker to tell the two apart.

Why not give every length from 3 to 258 and every distance from 1 to 32,768 its own symbol? Then the distance alphabet would have 32,768 symbols, and describing a code for it would cost more than it saves. Instead, DEFLATE groups the values into ranges, gives each range one symbol, and then writes the position inside the range as plain bits, called **extra bits**. The extra bits value is the actual number minus the smallest number in the range. Extra bits are not Huffman coded. That costs little, because inside a range the exact value is spread nearly evenly, so Huffman coding would have little skew to remove (this is approximately true, not exactly).

Here are the two tables. They are fixed by the format. For lengths:

| Symbols | Extra bits | Lengths covered |
|---|---|---|
| 257 to 264 | 0 | 3 to 10, one length per symbol (257 is 3, 258 is 4, up to 264 is 10) |
| 265 to 268 | 1 | 11 to 12, 13 to 14, 15 to 16, 17 to 18 |
| 269 to 272 | 2 | 19 to 22, 23 to 26, 27 to 30, 31 to 34 |
| 273 to 276 | 3 | 35 to 42, 43 to 50, 51 to 58, 59 to 66 |
| 277 to 280 | 4 | 67 to 82, 83 to 98, 99 to 114, 115 to 130 |
| 281 to 284 | 5 | 131 to 162, 163 to 194, 195 to 226, 227 to 257 |
| 285 | 0 | 258 |

For distances:

| Symbols | Extra bits | Distances covered |
|---|---|---|
| 0 to 3 | 0 | 1, 2, 3, 4 |
| 4 to 5 | 1 | 5 to 6, 7 to 8 |
| 6 to 7 | 2 | 9 to 12, 13 to 16 |
| 8 to 9 | 3 | 17 to 24, 25 to 32 |
| 10 to 11 | 4 | 33 to 48, 49 to 64 |
| 12 to 13 | 5 | 65 to 96, 97 to 128 |
| 14 to 15 | 6 | 129 to 192, 193 to 256 |
| 16 to 17 | 7 | 257 to 384, 385 to 512 |
| 18 to 19 | 8 | 513 to 768, 769 to 1024 |
| 20 to 21 | 9 | 1025 to 1536, 1537 to 2048 |
| 22 to 23 | 10 | 2049 to 3072, 3073 to 4096 |
| 24 to 25 | 11 | 4097 to 6144, 6145 to 8192 |
| 26 to 27 | 12 | 8193 to 12288, 12289 to 16384 |
| 28 to 29 | 13 | 16385 to 24576, 24577 to 32768 |

You do not have to memorize them: for distances, each pair of symbols has one more extra bit than the pair before it, and the covered range doubles each time.

Two examples from our text. The match with length 11 has symbol 265, which covers lengths 11 to 12 with 1 extra bit, and the extra value is 11 minus 11 = 0. The match with distance 12 has symbol 6, which covers distances 9 to 12 with 2 extra bits, and the extra value is 12 minus 9 = 3, written as the two bits `11`.

The order inside a match is: the length symbol (Huffman coded), the length extra bits, then the distance symbol (Huffman coded, using the distance code), then the distance extra bits. Symbol 285 is a special case that means exactly 258 and has no extra bits, which keeps the longest matches cheap.

### The fixed block, and our example in real bits

A fixed block uses these Huffman code lengths, defined by the format:

| Symbols | Code length | Code values |
|---|---|---|
| 0 to 143 | 8 bits | 00110000 to 10111111 |
| 144 to 255 | 9 bits | 110010000 to 111111111 |
| 256 to 279 | 7 bits | 0000000 to 0010111 |
| 280 to 287 | 8 bits | 11000000 to 11000111 |

Every distance symbol uses 5 bits and the code is just the symbol number written in binary. Symbols 286 and 287, and distance symbols 30 and 31, exist in the tables but are never used. The literals 0 to 143 have the code `00110000` plus the byte value (that is, 48 plus the value, written in 8 bits), which is how the table above arises.

Now encode `abracadabra abracadabra` as a single fixed block, which is also the last block. Using the pieces from part one:

| Piece | What is written | Bits |
|---|---|---|
| Block header | final block `1`, type fixed `01` (see the note on bit order below) | 3 |
| Literal `a` (97) | 48 + 97 = 145, which is `10010001` | 8 |
| Literal `b` (98) | 146, `10010010` | 8 |
| Literal `r` (114) | 162, `10100010` | 8 |
| Literal `a` | `10010001` | 8 |
| Literal `c` (99) | 147, `10010011` | 8 |
| Literal `a` | `10010001` | 8 |
| Literal `d` (100) | 148, `10010100` | 8 |
| Match, length 4 | symbol 258, 7 bit code (258 minus 256 = 2) `0000010`, no extra bits | 7 |
| Match, distance 7 | symbol 5, `00101`, then 1 extra bit with value 7 minus 7 = 0, `0` | 6 |
| Literal space (32) | 48 + 32 = 80, `01010000` | 8 |
| Match, length 11 | symbol 265, 7 bit code (265 minus 256 = 9) `0001001`, then 1 extra bit `0` | 8 |
| Match, distance 12 | symbol 6, `00110`, then 2 extra bits with value 3, `11` | 7 |
| End of block | symbol 256, `0000000` | 7 |

The total is 3 + 56 + 7 + 6 + 8 + 8 + 7 + 7 = 102 bits. The original was 23 times 8 = 184 bits, so the output is about 55 percent of the size. Since bytes are whole, 102 bits rounds up to 13 bytes, with 2 padding bits at the end, and 13 bytes against 23 is about 57 percent. Notice that in this example all of the saving comes from LZ77. The literals still cost 8 bits each, because the fixed code gives every common letter 8 bits. A dynamic block, which can give common symbols shorter codes, is what lets Huffman coding contribute on larger data.

### Packing the bits into bytes: a rule that trips everyone up

Bits must be put into bytes in a precise order. There are two rules, and they differ on purpose:

- Numbers (the header fields, extra bits, and similar) are written starting with their least significant bit.
- Huffman codes are written starting with the first bit of the code, that is, as the code reads from left to right.

The reason is the decoder: it reads Huffman codes one bit at a time while walking down a tree, so the first bit of the code must come first. Numbers, on the other hand, are naturally assembled from the least significant end.

Within a byte, the first bit of the stream goes into the least significant position (the 1s place), the next bit into the 2s place, and so on. Take the first 8 bits of our stream. The header was final block `1` and type `01`, a number written least significant bit first, so it appears as `1`, `1`, `0`. Then comes the code for `a`, `10010001`, from which the first 5 bits `1`, `0`, `0`, `1`, `0` fit in this byte. So the first byte contains the stream bits `1 1 0 1 0 0 1 0`, and its value is 1 times 1, plus 1 times 2, plus 0 times 4, plus 1 times 8, plus 0 times 16, plus 0 times 32, plus 1 times 64, plus 0 times 128, which is 75, hexadecimal `4B`. Continuing in the same way through all 102 bits gives the 13 bytes:

`4B 4C 2A 4A 4C 4E 4C 01 51 0A 48 6C 00`

I worked these bytes out by hand, so if you want to check them, give them to a raw DEFLATE decoder (in Python, `zlib.decompressobj(-15).decompress(bytes.fromhex("4b4c2a4a4c4e4c01510a486c00"))`, where the negative window size means "no zlib header") and you should get the original text back. A real compressor such as zlib may choose different pieces or a different block type, so do not expect its output to be identical. Any stream that decodes to the right text is valid.

How does this compare once wrapped? The raw stream is 13 bytes. In a zlib wrapper it becomes 13 + 2 + 4 = 19 bytes. In a gzip file it becomes at least 13 + 10 + 8 = 31 bytes, which is more than the 23 byte input. So for tiny inputs gzip can make the file bigger, because the wrapper's fixed overhead is larger than the saving.

### Can the compressor do better than the longest match?

Taking the longest match at every position, called the greedy strategy, is not always best. Consider the 24 byte text `abc_bcdefghij_abcdefghij`, where `_` stands for a space-like separator character. Positions: `a` is 0, `b` is 1, `c` is 2, `_` is 3, then `bcdefghij` occupies positions 4 to 12, another `_` is at 13, and the final `abcdefghij` occupies 14 to 23.

At position 14, the longest match is the 3 bytes `abc` from position 0 (distance 14), because position 3 holds `_` where the text now has `d`. A greedy compressor takes it. Then at position 17 it matches `defghij` (7 bytes) from position 6, distance 11. Using the fixed codes, the first match costs 7 bits for the length symbol 257 plus 5 + 2 bits for distance 14 (symbol 7, 2 extra bits), which is 14 bits. The second costs 7 bits for the length symbol 261 plus 5 + 2 bits for distance 11 (symbol 6, 2 extra bits), which is 14 bits. In total, 28 bits.

Now suppose the compressor looks one position ahead before committing. At position 15 the text `bcdefghij` (9 bytes) matches position 4, distance 11. So writing `a` as a literal (8 bits) and then that one match (length symbol 263 with 7 bits, plus 7 bits for distance 11, so 14 bits) costs 22 bits. That is 6 bits fewer, even though it starts with a literal. The strategy of checking whether the next position offers a clearly longer match, and if so writing a literal now, is called **lazy matching**. Zlib uses it at its higher effort levels (4 to 9, as far as I know). It is a compressor choice only, so decoders do not notice. It also shows why "optimal LZ77" is harder than it looks: the best set of pieces depends on what the pieces will cost in bits.

### The dynamic block: sending your own codes

A dynamic block is worth its cost when the data is big enough and skewed enough. The compressor counts how often each symbol occurs in the block, builds one Huffman code for the literal and length alphabet and one for the distance alphabet, and writes the code lengths before the data. Describing the codes needs three fields after the 3 bit block header:

- **HLIT**, 5 bits: how many literal and length symbols have a code length written, minus 257 (so 257 to 286 symbols).
- **HDIST**, 5 bits: how many distance symbols have a code length written, minus 1 (so 1 to 32).
- **HCLEN**, 4 bits: how many entries of a third table are written, minus 4 (so 4 to 19). More on this table in a moment.

The code lengths are themselves compressed, using a third small Huffman code. Its alphabet has 19 symbols. Symbols 0 to 15 mean "this symbol has this code length", where 0 means the symbol is unused. The other three are shortcuts for runs:

- Symbol 16 means "repeat the previous code length", 3 to 6 times, with 2 extra bits holding the count minus 3.
- Symbol 17 means "repeat the length 0", 3 to 10 times, with 3 extra bits holding the count minus 3.
- Symbol 18 means "repeat the length 0", 11 to 138 times, with 7 extra bits holding the count minus 11.

For example, take these 15 code lengths: `4 4 4 4 4 4 4 0 0 0 0 0 5 5 5`. They can be written as the length 4, then symbol 16 with extra value 3 (meaning six more repeats, since 6 minus 3 is 3), then symbol 17 with extra value 2 (five zeros, since 5 minus 3 is 2), then `5`, `5`, `5` written one by one, because a repeat needs at least 3 copies after the first. That is 6 symbols instead of 15. A run may continue from the end of the literal and length lengths into the start of the distance lengths, because the two lists are written as one sequence.

The lengths of the 19 symbols of this third code (at most 7 bits each) are written first, each as a 3 bit number, in the odd order 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15. The order puts the symbols least likely to be used at the end, so a block that does not use them can omit them by choosing a smaller HCLEN. After that come the code lengths for the two main alphabets, encoded with the third code, and then the data itself, ending with symbol 256.

A compressor decides between block types by computing the cost of each: stored, fixed, and dynamic including its description. It keeps the smallest. For our 23 byte example, the description alone would eat most or all of the saving, so the fixed block wins, as we used. For larger and skewed data the dynamic block wins. Many implementations end a block when an internal buffer of pieces fills up, and zlib is one of them.

### The stored block, and the worst case

A stored block begins with the usual 3 bits, then the rest of the current byte is skipped, so the data starts on a byte boundary. Then come LEN, a 2 byte number giving how many bytes follow (at most 65,535), and NLEN, which is LEN with every bit flipped. The decoder uses NLEN to check LEN. The data bytes follow unchanged.

For the 5 bytes `hello` as the only block: the first byte holds the final flag `1` and type `00`, so the bits are `1 0 0` followed by 5 padding zeros, which is the value 1, hexadecimal `01`. LEN is 5, so the next two bytes are `05 00` (least significant byte first). NLEN is 65,530 (hexadecimal `FFFA`), so `FA FF`. Then `68 65 6C 6C 6F`. In full: `01 05 00 FA FF 68 65 6C 6C 6F`, which is 10 bytes for 5 bytes of data. For larger inputs the overhead stays at about 5 bytes per block, which is the safety net promised earlier.

## Doing it without help

Here are the full procedures in order, so you can do or program them yourself.

To compress:

1. Run LZ77 over the input to get literals and matches, using lengths 3 to 258 and distances 1 to 32,768.
2. Turn every literal into its byte value as a symbol, and every match into a length symbol (with extra bits) and a distance symbol (with extra bits), using the two tables. Add symbol 256 at the end of the block.
3. Count how often each symbol occurs in each of the two alphabets.
4. Build Huffman code lengths from the counts, limit them to 15 bits, and turn them into codes with the canonical rule.
5. Compute the size of a stored block, a fixed block and a dynamic block, and use the smallest. If the data is random, the stored block wins.
6. Write the bits in the order given earlier (3 bit header, then the block contents), packing numbers with the least significant bit first and Huffman codes with their first bit first, and pad the last byte with zeros.

To decompress:

1. Read 1 bit (is this the last block) and 2 bits (block type).
2. For a stored block, skip to the next byte boundary, read LEN and NLEN, and copy LEN bytes. For a fixed block use the built-in codes. For a dynamic block read HLIT, HDIST and HCLEN, read the third code, decode the code lengths, and build both codes with the canonical rule.
3. Decode a symbol with the literal and length code. If it is below 256, append that byte to the output. If it is 256, the block is over. If it is above 256, read its extra bits to get the length, decode a distance symbol with the distance code, read its extra bits to get the distance, and copy one byte at a time from that far back.
4. After the end of a block, stop if the final bit was 1, otherwise read the next block header.

A few mistakes are common. The bit order is the largest source of bugs, so remember: numbers least significant first, Huffman codes first bit first. A match must never reach back further than the output you have (and in the very first bytes, the distance cannot exceed what has been written). A decoder must copy matches one byte at a time. And the window carries across blocks, so do not clear it.

A short exercise with a check: compress `abababab` (8 bytes) as one fixed block. At position 0 and 1 nothing precedes, so `a` and `b` are literals. At position 2, `ababab` (6 bytes) matches from position 0, distance 2, and it runs to the end of the text. The pieces are `a`, `b`, and a match with length 6 and distance 2. The bits are 3 for the header, 8 and 8 for the two literals, 7 for the length symbol 260 (code `0000100`), 5 for the distance symbol 1 (code `00001`), and 7 for the end of block symbol, so 3 + 8 + 8 + 7 + 5 + 7 = 38 bits, which is 5 bytes against the original 8. If your count differs, recheck the table row for the length and for the distance.

## Limits worth knowing

DEFLATE has a best case. Every Huffman code takes at least 1 bit, so the cheapest possible match, with length 258 and distance 1, costs at least 2 bits (one for each symbol, with no extra bits). That match stands for 258 bytes, which is 2,064 bits, so DEFLATE can never shrink data by more than a factor of 2,064 divided by 2, that is 1,032. You can see the idea with 1,000 identical bytes in a fixed block, which needs one literal, three matches of length 258 and distance 1, and one match of length 225 and distance 1, for 75 bits in total, which is 10 bytes. A fixed block cannot reach 1,032 because its codes are longer than 1 bit, but it gets close to 100.

The worst case is covered by the stored block: DEFLATE adds at most about 5 bytes per 65,535, plus the wrapper.

DEFLATE has real weaknesses too. The window is only 32,768 bytes, so repetition farther apart than that is invisible to it. Huffman codes use whole bits, so skewed symbols with odds like 90 to 10 are paid for generously. Newer formats such as Zstandard and Brotli use larger windows and finer coding, and they usually compress better, but DEFLATE remains everywhere because it is simple, small, patent free and already built into every system.

## Summary

DEFLATE makes data smaller by combining two ideas in a fixed order. LZ77 finds earlier copies of the data within the last 32,768 bytes and replaces a repeated piece of 3 to 258 bytes with its length and its distance. Huffman coding then gives short bit patterns to common symbols and long ones to rare symbols, with the patterns chosen so that no pattern begins another and so that both sides can rebuild them from code lengths alone. Together, in the example you followed, they turned 23 bytes into 13 bytes of raw DEFLATE, and the same two steps, applied block by block, scale to files of any size.
