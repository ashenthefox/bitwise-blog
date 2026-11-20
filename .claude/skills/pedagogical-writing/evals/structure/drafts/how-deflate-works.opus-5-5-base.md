# How DEFLATE works

When you download a web page, open a PNG image, unpack a `.zip` file or read a `.gz` archive, your computer is almost certainly running the same decompression algorithm. That algorithm is DEFLATE. It was designed by Phil Katz for version 2 of PKZIP in the early 1990s and written up as RFC 1951 by Peter Deutsch in 1996. It is still the most widely deployed compression format in the world, even though newer formats compress better.

This post answers one question: how does DEFLATE take a file and produce a smaller file from which the original can be rebuilt exactly, byte for byte? The short answer is that DEFLATE runs two separate ideas one after the other. The first idea, called LZ77, finds stretches of data that already appeared earlier and replaces each with a short note that says "copy this many bytes from that far back". The second idea, called Huffman coding, takes everything LZ77 produced and writes common items with fewer bits and rare items with more bits. LZ77 removes repetition. Huffman coding removes skew, meaning the fact that some values are far more common than others.

The rest of the post builds both ideas from scratch, with worked examples, and then shows how DEFLATE fits them into one bit stream. By the end you should be able to explain to another programmer why a gzipped log file is a fifth of its original size, why a gzipped JPEG is not smaller at all, and what the bytes inside a `.gz` file actually say. You do not need any background in compression or information theory, but you should be comfortable with binary numbers and bits.

## What "smaller" means, and why some data cannot be made smaller

The first question is what kind of compression we are talking about, because the answer limits everything else. DEFLATE is lossless, which means the decompressor rebuilds the exact original bytes. JPEG and MP3 are lossy: they throw away detail that a human is unlikely to notice. DEFLATE never throws anything away, so it can only shrink data by finding patterns that let it describe the same bytes more briefly.

That leads to a fact that surprises many programmers: no lossless compressor can shrink every file. The reason is a counting argument. Take all files that are exactly 100 bits long. There are 2^100 of them. Now count all files shorter than 100 bits: there are 2^99 of length 99, 2^98 of length 98, and so on down to one file of length zero, which adds up to 2^100 − 1. So there are more 100-bit files than there are shorter files, and because a lossless compressor must map different inputs to different outputs (otherwise the decompressor could not tell them apart), at least one 100-bit file cannot get shorter.

The argument goes further than "at least one". To shrink a 100-bit file by at least 8 bits, the output must be 92 bits or shorter. There are fewer than 2^93 such outputs, which is fewer than 1 in 128 of the 2^100 inputs. So fewer than 1 in 128 of all possible files can be shrunk by even one byte, and this holds for any lossless compressor, however clever. Compression works in practice only because the files people actually store are not a random sample of all possible files. Text, source code, spreadsheets, logs and images are full of patterns, and a compressor is a program built to bet on specific kinds of pattern.

DEFLATE bets on two kinds. Being clear about which two tells you in advance when DEFLATE will work and when it will not.

## The two patterns DEFLATE looks for

DEFLATE looks for repetition and for skew, and it uses a different technique for each. It helps to see both in real data before seeing either technique.

Repetition means that a sequence of bytes appears more than once. Look at a few lines of a web server log:

```
192.168.1.20 - - [20/Nov/2026:10:15:02 +0000] "GET /index.html HTTP/1.1" 200 5120
192.168.1.20 - - [20/Nov/2026:10:15:03 +0000] "GET /style.css HTTP/1.1" 200 1834
192.168.1.21 - - [20/Nov/2026:10:15:03 +0000] "GET /index.html HTTP/1.1" 200 5120
```

The second line repeats long stretches of the first: `192.168.1.20 - - [20/Nov/2026:10:15:0` is 37 bytes that appeared one line earlier, and `HTTP/1.1" 200 ` appears again too. The third line repeats even more. If the compressor could say "the next 37 bytes are the same as the 37 bytes that started 84 bytes ago", it would replace 37 bytes with a few bytes of description. That is exactly what LZ77 does.

Skew means that some byte values occur much more often than others, even when nothing repeats in a longer run. In English text, the letter `e` makes up roughly 12% of letters, while `z` makes up well under 1%. In a file of digits, only 10 of the 256 possible byte values occur at all. A normal file spends 8 bits on every byte, no matter how common or rare that byte is. If common bytes could be written with 3 or 4 bits and rare ones with 10 or 12, the average would drop below 8. That is what Huffman coding does.

The two patterns are different, and each technique misses the pattern the other one catches. A file that contains the sentence "the cat sat on the mat" a thousand times is pure repetition, and Huffman coding alone would only shrink it to roughly half, because it can only shorten individual letters, not whole sentences. A file of random digits has no useful repetition at all, but it has strong skew, since only 10 byte values appear. Huffman coding can write each digit in about 3.3 bits instead of 8, while LZ77 would find almost nothing to copy. DEFLATE runs both, in that order, so that it catches both patterns.

## LZ77: replacing repeats with references to earlier data

LZ77 answers the question: how can a compressor describe a stretch of bytes it has already seen, more briefly than by writing the bytes again? The answer is to write a back reference: two numbers that say how far back the earlier copy starts and how many bytes to copy. The method is named after Abraham Lempel and Jacob Ziv, who published it in 1977.

Here is a worked example. Take the 18-byte input

```
to be or not to be
```

and number its positions starting from 0, so that `t` is at position 0, `o` at position 1, the first space at position 2, and so on:

| Position | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Byte | t | o | ␣ | b | e | ␣ | o | r | ␣ | n | o | t | ␣ | t | o | ␣ | b | e |

(The symbol ␣ stands for a space so that you can see it.)

The compressor walks through the input from left to right. At each position, it asks: do the bytes starting here also appear somewhere earlier in the input? If not, it writes the current byte as it is and moves on by one. If they do, it writes a back reference and skips forward over all the bytes the reference covers.

Walking through it step by step:

1. At position 0, nothing has come before, so there is nothing to copy. The compressor writes `t` as a plain byte.
2. Positions 1 through 12 are the same story in practice. Some single letters repeat (the `o` at position 6 already appeared at position 1), but a single repeated byte is not worth a back reference, for reasons covered in the next section. The compressor writes `o`, space, `b`, `e`, space, `o`, `r`, space, `n`, `o`, `t`, space as plain bytes.
3. At position 13, the next five bytes are `t`, `o`, space, `b`, `e`, and those same five bytes appear starting at position 0. The earlier copy starts 13 − 0 = 13 positions back. So the compressor writes one back reference meaning "copy 5 bytes, starting 13 bytes back", and jumps to position 18, which is the end of the input.

The output is 13 plain bytes followed by one back reference. These are the two kinds of item LZ77 produces, and DEFLATE has names for them. A plain byte written as itself is called a literal. A back reference is called a match, and it carries two numbers: the length, which is how many bytes to copy, and the distance, which is how many bytes back the copy starts. The literals and matches together are called tokens. So the example produced 14 tokens: 13 literals and one match with length 5 and distance 13.

Decompression runs the same story in reverse, and it is simpler. The decompressor reads the tokens in order and keeps everything it has produced so far. For each literal, it appends that byte to the output. For the match, it goes back 13 bytes from the current end of its output, which lands on the `t` at position 0, and copies 5 bytes from there to the end of the output. The result is `to be or not to be` again.

Notice what the decompressor does not need to know: it never has to search for anything, because the compressor already did the search and wrote down the answer. This is why DEFLATE decompression is fast on any input, while compression speed depends heavily on how hard the compressor searches. That asymmetry comes up again later.

You might be wondering whether this example actually saved anything. It replaced 5 bytes with one match, so the saving depends on how many bits a match costs. If a match cost 40 bits or more, replacing 5 bytes (40 bits) with it would save nothing. The answer depends on how DEFLATE writes matches as bits, which is the Huffman half of the story. For now, it is enough to know that in this particular example, DEFLATE writes the match in 14 bits, so the match saves 26 bits. We will see where 14 comes from later.

## The rules DEFLATE puts on matches

LZ77 is a general idea, and DEFLATE turns it into a format by fixing the allowed range of each number. Those ranges explain several real limits of gzip and zip, so they are worth knowing exactly.

The distance must be between 1 and 32,768. A distance of 1 means "start copying from the byte just before the current position". The upper limit of 32,768 bytes, which is 32 KiB, is called the window: the compressor can only refer back to the most recent 32 KiB of data. The reason for the limit is memory and speed in the early 1990s. The decompressor must keep the last 32 KiB of output in memory so that any match can be served, and the compressor must search that region. A larger window would find more repeats, but cost more memory and search time.

The window has a direct consequence you can measure. Make a file of 1 MB of random bytes and concatenate it with itself, so that the second megabyte is an exact copy of the first. The second half is entirely repetition, but every byte of it is about 1 MB away from its earlier copy, far beyond 32 KiB. So DEFLATE cannot see the repetition, and `gzip` turns the 2 MB file into slightly more than 2 MB. A compressor with a window larger than 1 MB, such as `xz` or `zstd` with a large window setting, would turn it into slightly more than 1 MB.

The length must be between 3 and 258. The lower limit of 3 exists because a match costs bits to describe, and a match of 1 or 2 bytes would almost never be cheaper than writing those bytes as literals. With the simplest coding DEFLATE offers, two literals typically cost 16 bits, while the cheapest possible match costs 12 bits, and a 2-byte match at a real distance usually costs more than that. Leaving 1- and 2-byte matches out of the format keeps the alphabet of possible lengths smaller, which makes the remaining lengths cheaper to write. The upper limit of 258 is 3 plus 255, so "length minus 3" fits in a single byte. Longer repeats are simply split into several matches: a 600-byte repeat becomes, for example, a match of length 258, another of length 258, and one of length 84.

There is one rule that the format allows and that looks wrong at first: the length may be larger than the distance. In other words, a match can copy bytes that the match itself is producing. This is called an overlapping match, and it turns out to be how DEFLATE handles runs of repeated bytes.

Here is a worked example. Take the 12-byte input `abcabcabcabc`. The compressor writes literals `a`, `b`, `c` for positions 0 to 2. At position 3, the remaining 9 bytes `abcabcabc` are the same as the bytes starting 3 positions back, as long as you allow the copy to run into itself. So the compressor writes one match with length 9 and distance 3.

The decompressor has `abc` in its output when it reaches the match. It must copy 9 bytes, starting 3 bytes back from the current end. The key is that it copies one byte at a time, and each copied byte immediately becomes part of the output that later steps can copy from:

1. The output is `abc`, 3 bytes long. Going back 3 lands on position 0, which holds `a`. Append `a`. The output is now `abca`.
2. The output is 4 bytes long. Going back 3 lands on position 1, `b`. Append it: `abcab`.
3. Going back 3 from position 5 lands on position 2, `c`. Append it: `abcabc`.
4. Going back 3 from position 6 lands on position 3. That byte did not exist when the match started; the decompressor wrote it in step 1. It holds `a`, so append `a`.
5. The process continues the same way for the remaining five bytes, each time copying a byte written three steps earlier, giving `abcabcabcabc` after nine copies in total.

The same rule turns a run of one repeated byte into a single match. A line of 80 `=` characters, which often appears in text files as a separator, becomes one literal `=` followed by a match with length 79 and distance 1. Each copied byte is the byte just before it, which is always `=`. So 80 bytes collapse into one literal and one match.

This matters for anyone writing a decompressor, because the obvious shortcut of calling `memcpy` on the whole range gives the wrong answer whenever the length is larger than the distance. `memcpy` assumes its source and destination do not overlap, and with an overlapping match they do. A correct decompressor copies byte by byte in this case, or uses a faster method that produces the same result.

## How the compressor finds matches

The LZ77 description above said "the compressor asks whether the bytes starting here appear earlier". This section answers how it does that without being slow, and why different compressors produce different outputs for the same input.

The first point is that the format does not say which matches the compressor must choose. Any sequence of literals and matches that the decompressor turns back into the original is valid. The compressor could even write every byte as a literal and never use a match; the output would be valid, just not small. So finding good matches is the compressor's own problem, and different programs solve it differently. That is why `gzip -1` and `gzip -9` produce different files from the same input, and why both can be decompressed by the same decompressor.

The slowest correct method is to compare the current position against every earlier position in the window. With a 32 KiB window, that is up to 32,768 comparisons for each byte of input, which makes compressing a 100 MB file take trillions of comparisons. No real compressor does this.

zlib, the library behind most DEFLATE compression, uses a hash table instead. A hash table here is an array indexed by a number computed from the next 3 bytes of input, so that the same 3 bytes always give the same index. Each entry holds the most recent position at which those 3 bytes were seen. Alongside it, zlib keeps a second array that, for each position, records the previous position that had the same hash. Following that second array from entry to entry gives a list of earlier positions that might start with the same 3 bytes, newest first. This list is called a hash chain.

The reason for using 3 bytes is the minimum match length. A match must be at least 3 bytes long, so any earlier position worth considering must start with the same 3 bytes as the current position. Hashing those 3 bytes lets the compressor skip every earlier position that cannot possibly match.

At each position, the compressor walks the hash chain. For each candidate on the chain, it compares bytes forward from the candidate and from the current position, and counts how many match. It keeps the longest match it found. Because the chain is ordered newest first, when two candidates give the same length, the first one found is the nearest, which has the smaller distance, and smaller distances are cheaper to write.

The chain for a common 3-byte sequence, such as `the` in English or `   ` (three spaces) in indented code, can contain thousands of positions. Walking all of them is slow, so zlib caps the number of candidates it checks, and this cap is the main thing the compression level changes. At level 1, zlib checks at most 4 candidates per position. At level 6, which is the default, it checks at most 128. At level 9, it checks at most 4,096. zlib also stops early once it has found a match at least as long as a length it considers good enough: 8 bytes at level 1, 128 at level 6 and 258 at level 9. So a higher level does find longer matches, but each step up costs more time for a smaller gain, which is why level 9 is often several times slower than level 6 while producing output only a few percent smaller. The exact gain depends on the data.

### Greedy and lazy matching

Finding the longest match at the current position is not always the best choice, and the reason is that taking a match decides what the compressor does at the next several positions too. A compressor that always takes the longest match at the current position is called greedy. A worked example shows how greedy matching can lose.

Take the 17-byte input `xabcybcdefzabcdef`, with positions numbered from 0:

| Position | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Byte | x | a | b | c | y | b | c | d | e | f | z | a | b | c | d | e | f |

Positions 0 to 10 contain no repeated 3-byte sequences, so they become 11 literals. The interesting part starts at position 11.

A greedy compressor at position 11 sees `abcdef`. The longest earlier match is `abc` at position 1, which is followed by `y` rather than `d`, so the match is 3 bytes long, at distance 11 − 1 = 10. The compressor takes it and jumps to position 14. At position 14 it sees `def`, which matches the `def` at position 7, giving a match with length 3 and distance 7. So greedy matching ends with two matches.

A smarter compressor would notice that position 12 starts `bcdef`, and that `bcdef` appears at position 5. That is a 5-byte match at distance 12 − 5 = 7. If the compressor writes `a` as a literal at position 11 and then takes the 5-byte match at position 12, it covers the same six bytes with one literal and one match.

Which is cheaper depends on bit costs, which we have not reached yet, so here are the numbers from the simplest DEFLATE coding, explained later. A match with length 3 and distance 10 costs 14 bits. A match with length 3 and distance 7 costs 13 bits. So the greedy choice costs 27 bits. The literal `a` costs 8 bits and a match with length 5 and distance 7 costs 13 bits, so the smarter choice costs 21 bits, which is 6 bits less.

zlib catches cases like this with a technique called lazy matching. After finding a match at the current position, the compressor also looks for a match at the next position before committing. If the match at the next position is longer, it writes the current byte as a literal and keeps the longer match instead. If not, it takes the match it had. zlib uses lazy matching at levels 4 to 9, and uses greedy matching at levels 1 to 3 because greedy matching is faster.

Lazy matching is a rule of thumb, not a guarantee. It looks only one position ahead, so it misses cases where the better match starts two or more positions later. It can also make things worse in some cases, because it compares match lengths rather than actual bit costs. Finding the truly smallest DEFLATE output for an input is a hard optimisation problem. Google's Zopfli compressor searches far more thoroughly and, by Google's published measurements, produces output about 3% to 8% smaller than zlib at its maximum level, but it runs around 80 times slower, which is why it is used only for files that are compressed once and downloaded many times. Every Zopfli output is ordinary DEFLATE, so any standard decompressor reads it.

### Why LZ77 alone is not enough

At this point we have a list of tokens, but no file. The tokens still have to be written as bits, and the obvious way to write them wastes most of what LZ77 gained.

Suppose we write each token with a fixed format: one bit to say "literal" or "match", then 8 bits for a literal byte, or for a match 8 bits of length and 15 bits of distance. A literal then costs 9 bits, which is more than the original 8. A match costs 24 bits, no matter how short or near it is. On text with few long repeats, this format can make the file bigger, because most tokens are literals and each now costs an extra bit.

The fix is to notice that the tokens have skew. In English text, the literal `e` is far more common than the literal `Q`. Short lengths, such as 3, 4 or 5, are far more common than length 200. Small distances are more common than large ones, because repetition tends to be local. A coding that spends fewer bits on common tokens and more on rare ones would make the token list much smaller than any fixed format. That coding is Huffman coding.

## Huffman coding: short codes for common symbols

Huffman coding answers the question: given a list of symbols and how often each occurs, which bit pattern should each symbol get, so that the whole list takes as few bits as possible? A symbol here is any item from a fixed set; it could be a byte, a letter, or one of DEFLATE's token types. David Huffman published the method in 1952, while he was a student.

We will work it out on the 11-character string `abracadabra` before stating any rules. First, count how often each character appears:

| Character | Count |
|---|---|
| a | 5 |
| b | 2 |
| r | 2 |
| c | 1 |
| d | 1 |

### The baseline: codes that are all the same length

The simplest approach gives every symbol a bit pattern of the same length. Each symbol's bit pattern is called its code. Stored as ordinary 8-bit bytes, the string takes 11 × 8 = 88 bits. But there are only 5 different characters, and 3 bits give 2^3 = 8 different patterns, which is enough for 5. So we could give `a` the code 000, `b` 001, `r` 010, `c` 011 and `d` 100, and the string would take 11 × 3 = 33 bits.

That is already much smaller, and it shows a first source of savings: if a file uses only a few of the 256 possible byte values, fewer bits per symbol are enough. But fixed-length codes ignore the counts. The character `a` appears 5 times and costs 3 bits each time, the same as `d`, which appears once.

### Codes of different lengths, and the problem they create

If `a` got a 1-bit code, the 5 occurrences of `a` would cost 5 bits instead of 15. The other characters would need longer codes to make room, but since they are rarer, the total could still drop. The difficulty is that when codes have different lengths, the decoder must be able to tell where one code ends and the next begins, because the compressed data is one long string of bits with no separators.

Here is a choice of codes that fails: `a` gets 0, `b` gets 01, and `c` gets 1. The encoded bits for `ac` are 0 then 1, which is `01`. The encoded bits for `b` are also `01`. A decoder that reads `01` cannot tell whether it means `b` or `ac`, so this code cannot be decoded reliably.

The problem is that the code for `a`, which is 0, is the beginning of the code for `b`, which is 01. The fix is to forbid this: no code may be the beginning of any other code. A set of codes with this property is called a prefix code. (The name comes from the rule that no code is a prefix of another; "prefix-free code" would be more accurate, but "prefix code" is the standard term.) With a prefix code, the decoder reads bits one at a time, and the moment the bits read so far equal some symbol's code, it knows that symbol is complete, because no longer code could start with those same bits.

A prefix code can be drawn as a binary tree. Each symbol sits at a leaf. To get a symbol's code, start at the root and write 0 for each step to a left child and 1 for each step to a right child, until you reach the symbol. A code's length is the depth of its leaf. Because symbols are only at leaves, no symbol's path passes through another symbol, which is exactly the prefix rule.

### Building the Huffman code step by step

Huffman's method builds the tree from the bottom up, starting with the rarest symbols. The procedure is:

1. Make one node for each symbol, labelled with its count.
2. Take the two nodes with the smallest counts and join them under a new node whose count is the sum of theirs.
3. Repeat step 2 until only one node is left. That node is the root.

Applying it to `abracadabra`:

1. The nodes are a (5), b (2), r (2), c (1), d (1).
2. The two smallest are c (1) and d (1). Join them into a node with count 2. The nodes are now a (5), b (2), r (2), and the c-and-d node (2).
3. Three nodes are tied at count 2. Any two of them may be chosen; take b and r. Join them into a node with count 4. The nodes are now a (5), the c-and-d node (2), and the b-and-r node (4).
4. The two smallest are the c-and-d node (2) and the b-and-r node (4). Join them into a node with count 6. The nodes are a (5) and this new node (6).
5. Join the last two into the root, with count 11, which is the total number of characters, as it must be.

Reading the depths off the tree: `a` hangs directly off the root, so its code is 1 bit long. The other four characters each sit three steps down: root, then the count-6 node, then either the count-2 or the count-4 node, then the leaf. So `b`, `r`, `c` and `d` each get 3-bit codes.

The total cost is the count of each symbol times its code length, added up: 5 × 1 for `a`, plus 2 × 3 for `b`, 2 × 3 for `r`, 1 × 3 for `c` and 1 × 3 for `d`. That is 5 + 6 + 6 + 3 + 3 = 23 bits, compared with 33 bits for the 3-bit fixed codes and 88 bits for plain bytes.

The tie in step 3 deserves a check, because a different choice gives a different tree. Suppose we had joined the c-and-d node with r instead of b with r. Then the depths would be: `a` 1 bit, `b` 2 bits, `r` 3 bits, `c` and `d` 4 bits each. The total is 5 × 1 + 2 × 2 + 2 × 3 + 1 × 4 + 1 × 4 = 5 + 4 + 6 + 4 + 4 = 23 bits, the same as before. This holds in general: breaking ties differently can change individual code lengths, but every tree Huffman's method can produce for the same counts has the same total cost.

The reason the method works is that the two rarest symbols should be the ones with the longest codes, and in a best possible tree they can always be placed side by side at the deepest level. Joining them first commits to that placement. After the join, the pair behaves like a single symbol whose count is their sum, and the same argument applies again to the smaller problem. Huffman proved that repeating this gives a prefix code with the smallest possible total, which is the property the next section makes precise.

## How good Huffman coding is, and where it falls short

Huffman coding is the best prefix code for a given set of counts, but "best" holds only under specific conditions, and DEFLATE's design is partly shaped by where those conditions fail. So it is worth saying exactly what is guaranteed.

The guarantee is this: among all prefix codes that give each symbol a whole number of bits, and given the counts of each symbol, no code produces a smaller total than Huffman's. The guarantee does not include the cost of telling the decoder what the code is, which can be large for short inputs. It also treats each symbol on its own, ignoring which symbols tend to follow which. That second limit is the reason LZ77 runs first: Huffman coding cannot notice that `the` keeps appearing as a unit, but LZ77 can.

There is a theoretical limit that tells us how close Huffman coding gets. If each symbol is treated independently and occurs with a known probability, the smallest average number of bits per symbol that any coding method can reach is called the entropy. For a symbol with probability p, the ideal cost is log2(1/p) bits, and the entropy is the average of that ideal cost over all symbols, weighted by how often each occurs. A symbol that occurs half the time ideally costs log2(2) = 1 bit; one that occurs a quarter of the time ideally costs log2(4) = 2 bits.

For `abracadabra`, `a` has probability 5/11, so it ideally costs log2(11/5), about 1.14 bits. `b` and `r` each have probability 2/11 and ideally cost about 2.46 bits. `c` and `d` each have probability 1/11 and ideally cost about 3.46 bits. Weighting by counts, the ideal total is about 5 × 1.14 + 4 × 2.46 + 2 × 3.46, which comes to about 22.4 bits, or about 2.04 bits per character. Huffman's 23 bits work out to about 2.09 bits per character. So in this case Huffman coding is within 0.05 bits per character of the theoretical limit.

That closeness is typical, but not guaranteed. The general result is that Huffman coding's average cost is always less than the entropy plus 1 bit per symbol. The gap comes from the fact that every code must be a whole number of bits, while the ideal cost log2(1/p) is usually a fraction. When probabilities are close to powers of one half (one half, one quarter, one eighth), the ideal costs are close to whole numbers, and Huffman coding is almost perfect. When one symbol is extremely common, the gap becomes large.

Here is the bad case with numbers. Suppose a file contains two symbols, A with probability 0.99 and B with probability 0.01. Huffman coding must give each symbol at least 1 bit, so A gets 0 and B gets 1, for an average of exactly 1 bit per symbol. The entropy is 0.99 × log2(1/0.99) + 0.01 × log2(100), which is about 0.99 × 0.0145 + 0.01 × 6.64, or about 0.081 bits per symbol. So in this case Huffman coding uses more than 12 times the theoretical minimum.

DEFLATE mostly avoids this case because LZ77 runs first. A file that is 99% one byte value consists mostly of long runs of that byte, and LZ77 turns each run into one literal and an overlapping match with distance 1, as in the line of `=` signs earlier. After that, the very common symbol no longer dominates the token list. Newer formats such as Zstandard handle the remaining gap with different coding methods that can spend fractions of a bit per symbol, which is one of the reasons they compress better.

Huffman coding also cannot help when there is no skew. If all 256 byte values occur equally often, every symbol has probability 1/256, the entropy is exactly 8 bits per byte, and Huffman's method gives every byte an 8-bit code, which saves nothing. This is the situation for data that is already compressed or encrypted. A JPEG image, an MP3 file, a `.zip` file or an encrypted file looks to DEFLATE like random bytes: no useful repetition for LZ77 and no skew for Huffman coding. Running `gzip` on such a file produces output slightly larger than the input, for reasons the section on blocks explains.

## Canonical Huffman codes: sending the code cheaply

Huffman coding creates a new problem: the decoder needs the same code the encoder used, and that code depends on the counts in the data, which the decoder does not have. So the code must be sent along with the data. The question this section answers is how to send it in as few bits as possible.

The naive way is to send the tree itself, or every symbol's full code. DEFLATE uses a smarter trick: it sends only the length of each symbol's code, and both sides build the actual codes from those lengths using an agreed rule. A Huffman code built from lengths by this rule is called a canonical Huffman code.

The key fact is that, for compression, only the code lengths matter. The total cost is the sum of count times length, so any prefix code with the same lengths compresses equally well. Given a valid set of lengths, the encoder is free to choose whichever codes are easiest to rebuild, and the rule DEFLATE uses is the following:

1. Sort the symbols by code length, shortest first, and among symbols with the same length, by symbol value.
2. Give the first symbol a code made of all zeros, with its code length.
3. For each following symbol, add 1 to the previous code. If the new symbol's code length is longer than the previous one, append zeros on the right until the code has the new length.

Applied to `abracadabra` with the lengths from the first tree, `a` with length 1 and `b`, `c`, `d`, `r` with length 3:

1. Sorted, the order is `a` (length 1), then `b`, `c`, `d`, `r` (length 3, in alphabetical order, which is the order of their byte values).
2. `a` gets the 1-bit code `0`.
3. `b` has length 3. Add 1 to `0` to get `1`, then append two zeros to reach length 3: `100`.
4. `c` gets `100` plus 1, which is `101`.
5. `d` gets `110`.
6. `r` gets `111`.

Check that this is a prefix code: the only 1-bit code is `0`, and every 3-bit code starts with `1`, so none starts with `0`, and no two 3-bit codes are equal. The encoded string is `a` 0, `b` 100, `r` 111, `a` 0, `c` 101, `a` 0, `d` 110, `a` 0, `b` 100, `r` 111, `a` 0, which is 1 + 3 + 3 + 1 + 3 + 1 + 3 + 1 + 3 + 3 + 1 = 23 bits, as predicted.

To send this code, the encoder sends just five numbers: 1, 3, 3, 3, 3, one per symbol in a fixed order, and the decoder runs the same rule to get the same codes. This saving matters a great deal at DEFLATE's scale. DEFLATE's main alphabet, described in the next section, has up to 286 symbols, and codes may be up to 15 bits long. Sending each symbol's length takes a few bits, and DEFLATE then compresses that list of lengths further, as described in the section on blocks.

The rule also lets decoders work quickly. Within each length, codes are consecutive numbers, so a decoder can work out which symbol a code belongs to with a little arithmetic rather than by walking a tree. In practice, fast decoders build a lookup table indexed by the next several bits of input; zlib's decoder, for instance, uses a first table indexed by the next 9 bits for its main alphabet. One table lookup then gives both the symbol and how many bits its code used.

DEFLATE limits every code in its two main alphabets to at most 15 bits, so that decoders can rely on a fixed maximum. Huffman's method can occasionally produce longer codes, but only when counts are extremely uneven. For example, it takes 17 symbols whose counts grow like the Fibonacci sequence (1, 1, 2, 3, 5, 8 and so on up to 1,597), about 4,180 symbols in total, for Huffman's method to produce a 16-bit code. When it happens, the encoder shortens the longest codes and lengthens some others to stay within 15 bits, which costs a small amount of compression compared with the unrestricted Huffman code.

## Putting the two together: DEFLATE's alphabets

Now we can join the two halves. LZ77 produces a list of tokens, and Huffman coding needs a fixed set of symbols with counts. The question is how to turn literals, lengths and distances into symbols, given that lengths range over 256 values and distances over 32,768.

DEFLATE uses two alphabets, each with its own Huffman code. The first, which RFC 1951 calls the literal/length alphabet, has 286 symbols that are actually used:

- Symbols 0 to 255 are the 256 possible literal bytes. Symbol 97 means "output the byte 97", which is the letter `a`.
- Symbol 256 means "this block of data ends here". It is called the end-of-block symbol; blocks are explained in the next section.
- Symbols 257 to 285 each stand for a range of match lengths.

The second alphabet is the distance alphabet, with 30 symbols, numbered 0 to 29, each standing for a range of distances.

Putting literals and lengths into one alphabet solves the "is this a literal or a match?" question for free. The decoder reads one symbol from the literal/length alphabet; if it is below 256 it is a literal, if it is 256 the block is over, and if it is above 256 it is the start of a match. No separate flag bit is needed, and the Huffman code automatically decides how many bits each of those cases costs, according to how often it occurs.

A distance always follows a length, so the decoder always knows which alphabet the next symbol belongs to: after a length symbol it reads one distance symbol, then goes back to the literal/length alphabet. Keeping distances in their own alphabet also gives them their own counts. If they shared an alphabet with literals, the Huffman code would have to cover all of them at once, and the distance statistics would blur with the literal statistics.

### Ranges and extra bits

Giving every possible length and distance its own symbol would make the alphabets huge: 256 length symbols and 32,768 distance symbols. Large alphabets are a problem for two reasons. The table of code lengths that must be sent with the data would be enormous, and the counts would be spread so thinly that most distances would occur once or never, which gives Huffman coding little skew to work with.

DEFLATE's solution is to group values into ranges. Each length or distance symbol stands for a range of values, and right after the symbol comes a small number of extra bits that say exactly which value in the range is meant. These extra bits are written as a plain binary number, not with Huffman coding.

Here is how one length is written. Suppose the match length is 20. Symbol 269 covers lengths 19 to 22 and is followed by 2 extra bits. The encoder writes the Huffman code for symbol 269, then 20 − 19 = 1 as a 2-bit number, `01`. The decoder reads symbol 269, reads 2 bits, gets 1, and adds it to the start of the range: 19 + 1 = 20.

Here is how one distance is written. Suppose the distance is 300. Distance symbol 16 covers distances 257 to 384 and is followed by 7 extra bits. The encoder writes the Huffman code for distance symbol 16, then 300 − 257 = 43 as a 7-bit number. The decoder reads symbol 16, reads 7 bits, gets 43, and computes 257 + 43 = 300.

The ranges are narrow where values are common and wide where they are rare. The full length table is:

| Symbols | Extra bits | Lengths |
|---|---|---|
| 257 to 264 | 0 | 3 to 10, one length per symbol |
| 265 to 268 | 1 | 11–12, 13–14, 15–16, 17–18 |
| 269 to 272 | 2 | 19–22, 23–26, 27–30, 31–34 |
| 273 to 276 | 3 | 35–42, 43–50, 51–58, 59–66 |
| 277 to 280 | 4 | 67–82, 83–98, 99–114, 115–130 |
| 281 to 284 | 5 | 131–162, 163–194, 195–226, 227–257 |
| 285 | 0 | 258 |

Lengths 3 to 10 each get their own symbol because short matches are the most common, so it pays to let Huffman coding give each its own code. Length 258 also gets its own symbol, 285, with no extra bits, because long runs of the same byte produce many maximum-length matches in a row, so 258 is far more common than nearby lengths such as 250.

The distance table follows the same pattern. Distance symbols 0 to 3 stand for distances 1 to 4 exactly, with no extra bits. After that, every two symbols share the same number of extra bits, and that number grows by one each time: symbols 4 and 5 have 1 extra bit and cover distances 5 to 6 and 7 to 8; symbols 6 and 7 have 2 extra bits and cover 9 to 12 and 13 to 16; and so on, up to symbols 28 and 29, which have 13 extra bits and cover 16,385 to 24,576 and 24,577 to 32,768. Each range is twice as wide as the range two symbols earlier, so 30 symbols are enough to reach 32,768.

Writing the extra bits without Huffman coding is a simplification, and it is only approximately right. It assumes that every value within a range is about equally likely, so that compressing them would not help. That is roughly true for narrow ranges, but less so for wide ones: within the range 24,577 to 32,768, the nearer distances are somewhat more common than the farther ones, so a small amount of compression is lost. The designers accepted that loss in exchange for small alphabets, small code tables and simple decoding.

## Blocks: how the code changes as the data changes

Data often changes character partway through. A `tar` archive might contain a text file followed by a compiled program, and the best Huffman code for English text is a poor code for machine code. So DEFLATE splits its output into blocks, and each block can use its own Huffman codes. This section explains the three kinds of block and how the encoder chooses among them.

Every block starts with a 3-bit header. The first bit, called BFINAL, is 1 if this is the last block of the stream and 0 otherwise. The next two bits, called BTYPE, give the block type: 0 for a stored block, 1 for a block with fixed Huffman codes, and 2 for a block with dynamic Huffman codes. The value 3 is reserved and is treated as an error. There is no limit on how many blocks a stream contains, and each block except a stored block ends with the end-of-block symbol, 256.

### Stored blocks

A stored block contains raw bytes with no compression at all. After the header, the encoder skips ahead to the next byte boundary, then writes the block's length as a 2-byte number, called LEN, followed by the same number with every bit flipped, called NLEN, which lets the decoder detect some corruption. Then come the LEN bytes themselves. LEN can be at most 65,535.

Stored blocks exist for data that does not compress, such as the JPEG case from earlier. If the compressor tried Huffman coding on such data, the output would be slightly larger than the input, because the code table costs bits and every byte would still need 8 bits. A stored block costs at most about 5 bytes on top of the data: the 3 header bits plus padding up to a byte boundary, and the 4 bytes of LEN and NLEN. So for incompressible data, the cost is about 5 bytes per 65,535 bytes, less than 0.01%. This is why a gzipped JPEG is a few bytes larger than the JPEG, not hundreds of bytes larger.

### Blocks with fixed Huffman codes

A block with fixed Huffman codes uses code lengths that are written into the DEFLATE specification, so the block does not need to send any code table. The fixed code lengths for the literal/length alphabet are:

| Symbols | Code length | Codes |
|---|---|---|
| 0 to 143 | 8 bits | `00110000` to `10111111` |
| 144 to 255 | 9 bits | `110010000` to `111111111` |
| 256 to 279 | 7 bits | `0000000` to `0010111` |
| 280 to 287 | 8 bits | `11000000` to `11000111` |

(Symbols 286 and 287 receive codes so that the code table is complete, but they never appear in valid data.) Every distance symbol gets a 5-bit code in fixed blocks, which is just the symbol number written in 5 bits.

The fixed code has a sensible shape. Byte values 0 to 143 include the digits, the uppercase and lowercase letters and the common punctuation, since all printable ASCII characters are below 128, and those cost 8 bits, the same as plain bytes. Byte values 144 to 255, which are rarer in text, cost 9 bits. The end-of-block symbol and the common short lengths cost only 7 bits. So text in a fixed block costs about the same per literal as the original, and all the saving comes from matches.

Fixed blocks are for small amounts of data, where sending a custom code would cost more than it saves. To see why, consider `abracadabra` again. LZ77 finds one match: at position 7, the 4 bytes `abra` repeat the start of the string at distance 7. So the tokens are 7 literals and one match with length 4 and distance 7. In a fixed block, each literal costs 8 bits, the length symbol 258 costs 7 bits, and distance 7 is distance symbol 5 (range 7 to 8) at 5 bits plus 1 extra bit, so the match costs 13 bits. With the 3-bit header and the 7-bit end-of-block symbol, the total is 3 + 56 + 13 + 7 = 79 bits, which rounds up to 10 bytes, against 11 bytes of input. A dynamic block for the same data would need to send its code lengths first, and a rough count puts that table alone above 100 bits, already more than the entire fixed block. So for 11 bytes, the fixed code wins easily, even though the custom Huffman code we built earlier is far better at the symbols themselves.

### Blocks with dynamic Huffman codes

A block with dynamic Huffman codes carries its own code lengths for both alphabets, built from the counts of the tokens in that block. This is the block type used for almost all of a typical compressed file, and its header is the most intricate part of DEFLATE. The challenge is to send up to 286 literal/length code lengths and up to 30 distance code lengths in as few bits as possible.

The header starts with three counts:

- HLIT, in 5 bits: how many literal/length code lengths follow, minus 257. Values 0 to 29 cover 257 to 286 lengths. The encoder can stop the list early when the highest-numbered length symbols are unused, because unused symbols have a code length of 0.
- HDIST, in 5 bits: how many distance code lengths follow, minus 1, covering 1 to 32.
- HCLEN, in 4 bits: how many code lengths follow for a third, small alphabet that the next paragraphs describe, minus 4, covering 4 to 19.

The list of code lengths has strong patterns of its own. In an English text file, most of the 256 possible byte values never appear, so most literal code lengths are 0, often in long runs. Lengths of used symbols cluster around a few values, such as 5 to 9 bits. So DEFLATE compresses the list of code lengths, using the same two ideas as the main data: runs of repeated values, and a Huffman code.

To do this, DEFLATE defines a third alphabet of 19 symbols, used only for writing code lengths. RFC 1951 calls its codes the code length codes. Symbols 0 to 15 mean "the next code length is this value". The other three symbols handle runs:

- Symbol 16 means "repeat the previous code length 3 to 6 times", with 2 extra bits giving the count minus 3.
- Symbol 17 means "the next 3 to 10 code lengths are 0", with 3 extra bits giving the count minus 3.
- Symbol 18 means "the next 11 to 138 code lengths are 0", with 7 extra bits giving the count minus 11.

Here is how that works on a typical case. In a plain text file, byte values 0 to 9 are control characters that never appear, byte value 10 is the newline, which appears on every line, and byte values 11 to 31 are again unused. Suppose the newline gets a 7-bit code. The first 32 code lengths are then: ten zeros, one 7, and twenty-one zeros. The encoder writes symbol 17 with extra bits for 10 − 3 = 7, which covers the ten zeros; then symbol 7 for the newline's length; then symbol 18 with extra bits for 21 − 11 = 10, which covers the twenty-one zeros. Three symbols and their extra bits replace 32 separate code lengths.

The 19 symbols of this third alphabet get their own Huffman code, sent as code lengths of 3 bits each, so each length is 0 to 7. That makes this the smallest piece of the header, and it is sent first, right after HLIT, HDIST and HCLEN. Its lengths are sent in this fixed order: 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15. The order puts the symbols that are most often used first and the ones most often unused last, so the encoder can usually stop before the end of the list. HCLEN says how many to read, and any that are not sent are taken to be 0, meaning unused. For example, very long codes such as 15 bits and very short codes such as 1 bit are rare in the main alphabets, so the code length symbols 15 and 1 are placed at the end.

So a dynamic block is laid out as follows: the 3-bit block header; HLIT, HDIST and HCLEN; the 3-bit code lengths for the code length alphabet; the literal/length and distance code lengths, written using that code length alphabet; the tokens, written with the two Huffman codes; and finally the end-of-block symbol. The header typically costs tens of bytes, which is negligible in a block that covers tens of thousands of bytes of input and decisive in a block that covers only a few dozen.

### How the encoder chooses blocks

The DEFLATE format does not say where blocks should begin and end or which type each should be. That is again left to the encoder, and choosing well is a trade-off: each new dynamic block costs a header, but lets the code follow changes in the data.

zlib uses a simple rule. It collects tokens in a buffer, and when the buffer is full, which happens after 16,384 tokens with zlib's default memory settings, it ends the block. Since the tokens are already known at that point, zlib can calculate exactly how many bits the block would take as a stored block, as a fixed block and as a dynamic block, and it writes whichever is smallest. More careful encoders, such as Zopfli, also try different places to split the data into blocks, which helps when the data changes character partway through a buffer.

## A complete block, bit by bit

We now have everything needed to write out a whole DEFLATE stream for the first example, `to be or not to be`, and count every bit. This is also where the claim from earlier, that the match costs 14 bits, comes from.

The input is 18 bytes, and LZ77 gave 13 literals followed by one match with length 5 and distance 13. For data this short, a fixed block is the right choice, for the same reason as with `abracadabra`. Here are the parts of the block in order, with each code written most significant bit first, as RFC 1951 writes them:

| Part | Meaning | Bits | Count |
|---|---|---|---|
| BFINAL | This is the last block | `1` | 1 |
| BTYPE | Fixed Huffman codes (type 1) | 2 bits for the value 1 | 2 |
| Literal `t` | Symbol 116 | `10100100` | 8 |
| Literal `o` | Symbol 111 | `10011111` | 8 |
| Literal space | Symbol 32 | `01010000` | 8 |
| Literal `b` | Symbol 98 | `10010010` | 8 |
| Literal `e` | Symbol 101 | `10010101` | 8 |
| Literal space | Symbol 32 | `01010000` | 8 |
| Literal `o` | Symbol 111 | `10011111` | 8 |
| Literal `r` | Symbol 114 | `10100010` | 8 |
| Literal space | Symbol 32 | `01010000` | 8 |
| Literal `n` | Symbol 110 | `10011110` | 8 |
| Literal `o` | Symbol 111 | `10011111` | 8 |
| Literal `t` | Symbol 116 | `10100100` | 8 |
| Literal space | Symbol 32 | `01010000` | 8 |
| Length 5 | Symbol 259, no extra bits | `0000011` | 7 |
| Distance 13 | Distance symbol 7 (range 13 to 16) | `00111` | 5 |
| Distance extra bits | 13 − 13 = 0, in 2 bits | `00` | 2 |
| End of block | Symbol 256 | `0000000` | 7 |

Each literal's fixed code is its byte value plus 48, written in 8 bits, because the fixed codes for symbols 0 to 143 run from `00110000` (which is 48) upwards. For `t`, 116 + 48 = 164, which is `10100100` in binary. The length symbol 259 is the fourth of the 7-bit codes that start at `0000000` for symbol 256, so it is `0000011`. Distance 13 falls in the range 13 to 16 of distance symbol 7, which has 2 extra bits, and since 13 is the start of the range, the extra bits are 0.

Adding up: 3 bits of header, 13 × 8 = 104 bits of literals, 7 + 5 + 2 = 14 bits for the match, and 7 bits for the end-of-block symbol. That is 3 + 104 + 14 + 7 = 128 bits, which is exactly 16 bytes. The input was 18 bytes, so the block is 2 bytes smaller. As a stored block, the same data would take 1 byte for the header and padding, 4 bytes for LEN and NLEN, and 18 bytes of data, which is 23 bytes, so a fixed block is clearly the better choice here.

All the saving here comes from the single match: it replaced 5 literals, which would have cost 40 bits, with 14 bits. On longer text with a dynamic block, the literals get cheaper too, because common letters receive codes shorter than 8 bits.

If you write a decoder yourself, you need one more detail about how bits are packed into bytes, which the table above does not show. DEFLATE fills each byte starting from its least significant bit. Numbers such as BTYPE, LEN and the extra bits are written with their least significant bit first. Huffman codes, however, are written with their most significant bit first, which is the order shown in the table. This mixture is a common source of bugs in first attempts at a decoder. If you want to compare against a real implementation, compress the same 18 bytes with zlib and look at the bytes between zlib's 2-byte header and its 4-byte checksum, which are described in the section on containers.

## Decompression, from start to finish

With the format in place, decompression is a short loop, and seeing it written out confirms that the decoder never has to make a choice. Every decision was made by the encoder and written into the stream.

The decoder repeats the following for each block:

1. Read the 3-bit block header: BFINAL and BTYPE.
2. If the block is stored, skip to the next byte boundary, read LEN and NLEN, check that NLEN is LEN with all bits flipped, and copy LEN bytes to the output.
3. If the block uses fixed codes, build the fixed Huffman codes from the table in the specification. If it uses dynamic codes, read HLIT, HDIST and HCLEN, read the code length alphabet's lengths and build its code, use that code to read the literal/length and distance code lengths, and build those two codes. Every code is built from its lengths with the canonical rule.
4. Read one symbol from the literal/length code. If it is below 256, append that byte to the output and repeat this step. If it is 256, the block is finished.
5. Otherwise, it is a length symbol. Read its extra bits and compute the length. Then read one symbol from the distance code, read its extra bits and compute the distance. Copy that many bytes, one at a time, starting that distance back from the end of the output, so that overlapping matches work. Go back to step 4.
6. After the block ends, stop if BFINAL was 1; otherwise read the next block.

The decoder must keep at least the last 32,768 bytes of output, because a match may reach back that far, even across block boundaries. That is the full memory requirement for the window, apart from the code tables. Note that matches may refer to data from earlier blocks, so the Huffman codes change at block boundaries but the window carries over.

## Where DEFLATE lives: zlib, gzip, PNG and ZIP

A DEFLATE stream on its own does not say what it contains or let you check that it decompressed correctly. So every format that uses DEFLATE wraps it in a container that adds a header and a checksum. The question for a programmer is usually "what are the bytes around the DEFLATE data?", and the answer depends on the container.

The zlib format, defined in RFC 1950, is the thinnest container. It adds 2 bytes in front of the DEFLATE stream and 4 bytes after it. The first byte names the compression method and window size; for DEFLATE with a 32 KiB window, it is `0x78`. The second byte holds a few flags, including the compression level the encoder reported, and its value makes the two bytes together divisible by 31, which serves as a quick check. That is why so many zlib streams start with `78 9C` (the default level) or `78 DA` (the highest levels). The 4 bytes at the end are an Adler-32 checksum of the uncompressed data, which the decoder recomputes to detect corruption.

The gzip format, defined in RFC 1952, is what the `gzip` command writes. It adds at least 10 bytes in front: the two identifying bytes `1F 8B`, a method byte of 8 for DEFLATE, a flags byte, 4 bytes for the modification time, one byte of extra flags and one byte naming the operating system. Optional fields, such as the original file name, may follow if the flags say so. After the DEFLATE stream come 8 bytes: a CRC-32 checksum of the uncompressed data and the uncompressed size modulo 2^32. So gzip adds at least 18 bytes of overhead, and the stored size is only correct for files smaller than 4 GiB. Combined with the stored blocks described earlier, this explains why gzipping an incompressible file of 1 MB adds roughly 18 bytes plus about 5 bytes for each 64 KiB block, which comes to about 100 bytes in total.

On the web, a server sends compressed responses with the header `Content-Encoding: gzip` for the gzip format. The value `deflate` in the same header is defined to mean the zlib format, but some old servers sent raw DEFLATE streams instead, so clients learned to accept both.

PNG images store their pixel data as one zlib stream, split across one or more chunks named IDAT. Before compressing, PNG transforms each row of pixels with one of five filters, and the filters exist to create the patterns DEFLATE looks for. Take a row of pixels in a smooth gradient with byte values 10, 12, 14, 16, 18, 20 and so on. No byte repeats, so LZ77 finds no matches, and the values are spread out, so there is little skew. The filter that PNG calls Sub replaces each byte with the difference from the byte to its left, giving 10, 2, 2, 2, 2, 2. Now LZ77 sees a run and writes one overlapping match with distance 1, and the value 2 is so common that Huffman coding gives it a very short code. The filter is undone after decompression, so no information is lost.

ZIP archives compress each file separately, using compression method 8, which is raw DEFLATE with no zlib or gzip wrapper. The ZIP format stores the CRC-32 checksum and sizes in its own headers instead. Compressing each file separately has a consequence you can measure: in a ZIP archive, a file cannot use matches from another file. In a `.tar.gz` archive, all files are joined first and compressed as one stream, so a file can reference earlier files, but only within the 32 KiB window. So an archive of many small, similar files, such as a directory of short configuration files that share most of their text, usually comes out noticeably smaller as `.tar.gz` than as `.zip`. The difference shrinks or disappears when the files are large or unrelated, because then there is little to reference across file boundaries anyway.

## What DEFLATE does well and where it falls short

DEFLATE's two ideas give a clear picture of what kinds of data it compresses well. English prose usually shrinks to somewhere between 30% and 40% of its size; that range is approximate and varies with the text. Source code, HTML, JSON and server logs, which repeat field names, keywords and whole lines, often shrink further, frequently to between 10% and 25%. Data that is already compressed or encrypted does not shrink at all, and grows by a few bytes per 64 KiB plus the container's overhead.

You can see how much each idea contributes by switching one off. zlib has a setting called `Z_HUFFMAN_ONLY` that disables matching, so the output uses only literals and Huffman coding. On English text, this usually gives somewhere around 55% to 65% of the original size, roughly 4.5 to 5 bits per character, because skew alone can only shorten individual letters. Turning LZ77 back on brings the same text down to the 30% to 40% range, because the repeated words and phrases become matches. These figures are approximate and vary with the text; you can measure them for your own data with any zlib binding, for example by passing `strategy=zlib.Z_HUFFMAN_ONLY` to `zlib.compressobj` in Python.

The limits of DEFLATE follow directly from the design. The 32 KiB window means repetition more than 32,768 bytes apart is invisible, as the duplicated 1 MB file showed. Huffman coding's whole-number bit lengths waste space when one symbol is very common, as the 99% example showed, although LZ77 removes most such cases first. The minimum match length of 3 and the per-block code tables are also compromises chosen for 1990s hardware.

Newer formats keep the same two-stage structure but improve each stage. Zstandard, Brotli and xz use much larger windows, measured in megabytes rather than kilobytes, and replace Huffman coding with methods that can spend fractions of a bit per symbol, or use Huffman coding with more context. They usually compress noticeably better, and Zstandard is also faster. DEFLATE remains in use because it is everywhere: every browser, operating system and programming language can read it, and formats such as PNG and ZIP are defined in terms of it.

## Summary

DEFLATE makes data smaller by running two techniques one after the other. First, LZ77 walks through the data and, wherever the upcoming bytes already appeared within the last 32 KiB, replaces them with a match: a length from 3 to 258 and a distance from 1 to 32,768, meaning "copy this many bytes from that far back". Everything else is written as literal bytes. Matches may overlap the bytes they produce, which turns runs of one byte into a single match. The compressor finds matches with hash tables over 3-byte sequences, and the compression level controls how hard it searches.

Second, Huffman coding writes the resulting tokens with codes whose lengths depend on how often each symbol occurs, so that common symbols cost few bits and rare ones cost many. Literals, lengths and the end-of-block marker share one alphabet, and distances have another. Lengths and distances are grouped into ranges, with plain extra bits picking the exact value. Each block either stores data raw, uses fixed codes from the specification, or sends its own codes as a compressed list of code lengths, from which both sides build identical canonical Huffman codes.

The decoder reverses this without making any decisions: it reads symbols, outputs literals, and copies matches from its last 32 KiB of output. A container such as zlib, gzip, PNG or ZIP wraps the stream with a header and a checksum. If you can explain why a log file shrinks to a fifth of its size while a JPEG does not shrink at all, by saying which of the two patterns each file has, you have the whole idea.
