# How DEFLATE works

When you open a PNG image, unpack a ZIP archive, or load a web page that a server sent with gzip compression, your computer rebuilds the original bytes from a smaller stream written in one format: DEFLATE. DEFLATE is the compressed format inside gzip files, zlib streams, PNG images and most ZIP archives. It makes data smaller by applying two ideas, one after the other. The first idea, LZ77, removes repetition: when a string of bytes has appeared before, it replaces the new copy with a short note that says where the earlier copy is. The second idea, Huffman coding, removes skew: it gives values that occur often short bit patterns and values that occur rarely long ones.

This post explains each idea with a worked example, then shows how DEFLATE fits the two together into an actual stream of bits. By the end you should be able to take a short input, compress it into DEFLATE by hand, and get bytes that a real decompressor will accept. You should also be able to read a DEFLATE stream and rebuild the input from it. The format is specified in RFC 1951, written by L. Peter Deutsch in 1996. Phil Katz designed it a few years earlier for version 2 of his PKZIP archiver. The numbers in this post come from that specification unless I say otherwise.

## What compression can promise

Can a compressor make every input smaller? No, and seeing why tells you what DEFLATE actually does.

Start with what we require. DEFLATE is lossless, which means the decompressor rebuilds exactly the original bytes, every bit of them, not an approximation. So two different inputs must never compress to the same output, because the decompressor would have no way to tell which one to rebuild.

Now count. There are 256 different inputs that are exactly 8 bits long. The outputs shorter than 8 bits are the strings of 0 to 7 bits, and there are 1 + 2 + 4 + 8 + 16 + 32 + 64 + 128 = 255 of them. So 256 inputs would have to share 255 shorter outputs, and at least one input must get an output of 8 bits or more. The same count works for any length n: there are 2ⁿ inputs of n bits but only 2ⁿ − 1 strings shorter than n bits. So every lossless compressor leaves some inputs the same size or makes them larger. There is no exception to this.

What a compressor does instead is bet that real data has patterns. Text, source code, logs, spreadsheets and most images are full of patterns, so they shrink. Random bytes, and files that are already compressed (JPEG photos, MP3 audio, a gzip file compressed a second time), have no patterns left, so they do not shrink. DEFLATE limits how much it loses on such data. In the worst case it stores the bytes unchanged with 5 bytes of overhead per 65,535 bytes of input, which is about 0.008 percent. For 1 MiB (1,048,576 bytes) of random data that means 17 blocks and 85 bytes of overhead, plus 18 bytes if the result is a gzip file. Real compressors such as zlib often use smaller blocks than the maximum, so their overhead on random data is a few times higher. It is still a small fraction of a percent.

## Two kinds of waste in ordinary data

What patterns does DEFLATE look for? It looks for two kinds, repetition and skew, and it has one tool for each.

Repetition is the same string of bytes appearing more than once. Take this 37-byte sentence, which we will compress throughout the post:

```
she sells sea shells by the sea shore
```

"she" appears at the start and again inside "shells". "sea " appears twice. "lls " appears in "sells " and in "shells ". A source file repeats keywords and variable names in the same way, and a log file repeats timestamps and messages.

Skew is some byte values being much more common than others. Stored as plain bytes, every character costs 8 bits, whether it is "e" or "z". In English text, "e" makes up roughly 12.7 percent of letters and "z" about 0.07 percent, so "e" is roughly 170 times as common. Spending 8 bits on both is wasteful, because you could give "e" a shorter pattern and "z" a longer one and come out ahead on average.

These are two different things, and neither tool can do the other's job. Repetition is about the order of bytes; skew is about how often each value occurs, whatever the order. If you shuffle the letters of an English text, the repeated words disappear, but "e" is exactly as common as before. In the other direction, a file made of the byte values 0, 1, 2 up to 255 in order, repeated 100 times, is 25,600 bytes long. Every value appears exactly 100 times, so it has no skew at all, but everything after the first 256 bytes is a repeat.

DEFLATE applies LZ77 first and Huffman coding second, because the output of LZ77 still has skew. The bytes LZ77 leaves alone are ordinary letters with ordinary English frequencies, and the notes it writes for repeats are also skewed: short repeats are far more common than long ones. Huffman coding then shrinks that output.

## Part 1: LZ77 removes repetition

### The idea

How can a compressor avoid storing a string that has already appeared? It can write a short instruction instead: "copy this many bytes, starting this far back". If the instruction takes fewer bits than the bytes it replaces, the output shrinks. This idea comes from a 1977 paper by Abraham Lempel and Jacob Ziv, which is where the name LZ77 comes from.

### A worked example

Let us compress our sentence. I number the byte positions from 0 and write a space as ␣ so you can see it:

```
position: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36
byte:     s h e ␣ s e l l s ␣ s  e  a  ␣  s  h  e  l  l  s  ␣  b  y  ␣  t  h  e  ␣  s  e  a  ␣  s  h  o  r  e
```

The encoder (the program that compresses) reads from left to right. At each position it asks one question: do the next few bytes also appear somewhere earlier? If they do, and the repeat is at least 3 bytes long, it writes an instruction to copy them. If not, it writes the single byte unchanged and moves forward by one. I explain the minimum of 3 bytes later; for now take it as a rule of the format.

Positions 0 to 8 ("she␣sells") produce no repeat of 3 or more bytes. For example, at position 4 the encoder sees "sel", and the only earlier "s" (position 0) is followed by "h", so the repeat is only 1 byte long. At position 7 the bytes "ls␣" do not appear earlier either. So the encoder writes those 9 bytes unchanged. Then it continues:

| Position | Bytes starting here | Earliest copy found | What the encoder writes |
|---|---|---|---|
| 9 | ␣sea | ␣se at position 3; position 12 holds "a" but position 6 holds "l", so the repeat stops at 3 bytes | copy 3 bytes from 6 back |
| 12 | a␣sh | no earlier "a" | the byte "a" |
| 13 | ␣she | ␣s at positions 3 and 9, but both are followed by "e", not "h", so only 2 bytes repeat | the byte "␣" |
| 14 | shel | she at position 0; then position 3 is "␣" and position 17 is "l" | copy 3 bytes from 14 back |
| 17 | lls␣b | lls␣ at position 6; then position 10 is "s" and position 21 is "b" | copy 4 bytes from 11 back |
| 21 to 24 | b, y, ␣, t | no repeat of 3 bytes ("␣t" never appeared) | four single bytes |
| 25 | he␣sea | he␣se at position 1; then position 6 is "l" and position 30 is "a" | copy 5 bytes from 24 back |
| 30 | a␣sho | a␣sh at position 12; then position 16 is "e" and position 34 is "o" | copy 4 bytes from 18 back |
| 34 to 36 | o, r, e | "o" and "r" are new; "e" is the last byte, so no 3-byte repeat is possible | three single bytes |

Each "how far back" is the current position minus the position of the earlier copy. For instance, at position 9 the earlier copy starts at position 3, and 9 − 3 = 6.

The complete output, one item per line:

```
s
h
e
␣
s
e
l
l
s
copy 3 bytes from 6 back
a
␣
copy 3 bytes from 14 back
copy 4 bytes from 11 back
b
y
␣
t
copy 5 bytes from 24 back
copy 4 bytes from 18 back
o
r
e
```

That is 18 single bytes and 5 copy instructions. The copies cover 3 + 3 + 4 + 5 + 4 = 19 bytes, and 18 + 19 = 37, the length of the input.

Now the names for what you have seen. A byte that the encoder writes unchanged is called a literal. A copy instruction is called a match, and it has two numbers: the length is how many bytes to copy, and the distance is how far back the copy starts, counted from the current position. So "copy 5 bytes from 24 back" is a match with length 5 and distance 24. The stretch of earlier data that a match is allowed to refer to is called the window. In DEFLATE the window is the most recent 32,768 bytes, and it moves forward as the encoder moves forward, which is why it is often called a sliding window.

So the general rule of LZ77 is: walk through the input; at each position, if the upcoming bytes repeat something in the window and the repeat is long enough, write a match and skip past the repeated bytes; otherwise write one literal and move forward one byte.

### Decoding a match

How does the decoder (the program that decompresses) rebuild the input? It keeps everything it has written so far. For a literal it appends the byte. For a match it goes back by the distance and copies length bytes from there to the end of what it has written.

Follow the first match. After the nine literals, the decoder has written "she␣sells", positions 0 to 8, so the next byte goes to position 9. The match says length 3, distance 6, so the decoder starts copying at position 9 − 6 = 3 and copies positions 3, 4 and 5, which hold "␣", "s" and "e". The output is now "she␣sells␣se". Next comes the literal "a" and the literal "␣", giving "she␣sells␣sea␣", and the next position is 14. The match with length 3 and distance 14 starts at position 14 − 14 = 0 and copies "she". Carry on the same way and you get the whole sentence back.

Notice that the decoder never searches for anything. It only copies bytes it already has. The consequence is that decompression is fast and does about the same amount of work no matter how hard the encoder worked to find matches. A file compressed with zlib's slowest setting decompresses at roughly the same speed as one compressed with its fastest setting, even though compressing took many times longer.

### Matches that overlap themselves

What if the length of a match is larger than its distance? The format allows it, and it is how DEFLATE stores runs of the same byte cheaply.

Take ten bytes "aaaaaaaaaa". The encoder writes the literal "a", then at position 1 it sees that the next 9 bytes repeat what starts 1 byte back. So it writes a match with length 9 and distance 1. To decode it, the decoder copies position 0 to position 1. Then it copies position 1 to position 2, and position 1 is the byte it wrote a moment ago. Then position 2 to position 3, and so on. Each copied byte becomes the source for a later one. The same mechanism handles longer patterns: "ab" followed by a match with length 8 and distance 2 gives "ababababab", because the copy repeats whatever pattern is as long as the distance.

This works only if the decoder copies one byte at a time, front to back. A general memory copy that reads the whole source region before writing (or that copies in large chunks) would read positions that have not been written yet and produce garbage. Fast decoders do copy in chunks, but only after checking that the distance is at least as large as the chunk size.

The payoff is large. A run of 1,000 zero bytes costs one literal and four matches: three of length 258 and one of length 225, which together cover 774 + 225 = 999 bytes.

### The limits DEFLATE puts on matches

What matches can DEFLATE express? A match length must be between 3 and 258 bytes, and a distance must be between 1 and 32,768 bytes. A distance also cannot reach back further than the start of the data, so the first byte of any stream is always a literal. A decoder that sees a distance larger than the amount of output so far must reject the stream as invalid. Each of these limits has a reason and a consequence.

The minimum length of 3 exists because shorter matches rarely pay for themselves. A match must spend bits on both its length and its distance. With the predefined code we will meet later, the cheapest possible match costs 12 bits, while three literals cost at least 24 bits, so a length-3 match always wins there. A length-2 match would replace two literals, and with a code built for the data, common letters often take only 4 to 6 bits each, so two literals cost 8 to 12 bits. A match with a distance of a few thousand bytes costs a length pattern, a distance pattern and up to 11 more bits to say the exact distance, which is more than the literals it replaces. So 2-byte matches would usually lose, and finding them would cost search time. The format simply has no way to say "length 2".

The maximum length of 258 is 3 + 255, so an encoder can store "length minus 3" in one byte while it works. Longer repeats are written as several matches in a row, as the 1,000 zeros showed, so this limit costs only a few bits per 258 bytes.

The window of 32,768 bytes is the limit with the most visible consequence. Repetition further back than that is invisible to DEFLATE. Suppose you take 20,000 random bytes and write them twice in a row. The first copy cannot be compressed, but every byte of the second copy repeats what is 20,000 bytes back, which is inside the window. So the second copy becomes 78 matches (77 of length 258 and one of length 134). With the predefined code, each length-258 match costs 26 bits and the last one costs 31, about 2,033 bits or 255 bytes in total. The file of 40,000 bytes compresses to roughly 20,300 bytes. Now do the same with 40,000 random bytes. Every byte of the second copy repeats what is 40,000 bytes back, which is outside the window, so DEFLATE finds nothing, and the 80,000-byte file stays at roughly 80,000 bytes. The format fixed the window at 32,768 bytes in the early 1990s, when that kept the memory a decoder needs small. Newer formats such as zstd, xz and Brotli allow windows of megabytes for this reason.

### How an encoder finds matches quickly

How does an encoder find the longest earlier copy without comparing against every position in the window? Checking all 32,768 earlier positions for every byte of input would take tens of thousands of comparisons per byte, which is far too slow. Real encoders use a hash table keyed on 3-byte sequences.

A hash is a number computed from some bytes, used as an index into a table. For every position the encoder passes, it computes a hash of the 3 bytes starting there and records the position in the table under that hash. Positions with the same hash are linked into a list, newest first, called a hash chain. To find matches at the current position, the encoder hashes the next 3 bytes, walks the chain for that hash, and compares the actual bytes at each candidate position, keeping the longest match it finds.

This search cannot miss a valid match for a simple reason: a match is at least 3 bytes long, so it must start with the same 3 bytes as the current position, and those 3 bytes have the same hash. The reverse is not true. Different 3-byte sequences can share a hash, which is called a collision, so some candidates on the chain turn out not to match at all. That only wastes time; it never produces a wrong match, because the encoder compares real bytes before it uses a candidate.

Chains in repetitive data can be very long, so encoders limit how far they walk. This is the main thing zlib's compression levels change. Here are three of its levels:

| zlib level | Most chain entries checked | Stops searching early when it finds a match this long | Lazy matching (next section) |
|---|---|---|---|
| 1 | 4 | 8 | no |
| 6 (the default) | 128 | 128 | yes, unless the match is already 16 or longer |
| 9 | 4,096 | 258 | yes, unless the match is already 258 long |

Level 9 checks 32 times as many candidates as level 6. On typical data that makes the output only slightly smaller, often by a few percent or less, while compression takes noticeably longer. That is why 6 is the default.

### Greedy and lazy matching

Is taking the longest match at the current position always the best choice? No, and the counter-example shows why encoders look one byte ahead.

An encoder that always takes the longest match at the current position is called greedy. Suppose the window contains the strings "abc" and "bcdefgh" in separate places, both about 100 bytes back, and the next input is "abcdefgh". A greedy encoder finds "abc" at the current position and takes a match of length 3. At "defgh" it finds the "defgh" inside the earlier "bcdefgh" and takes a match of length 5. That is two matches. A better choice is to write "a" as a literal and then match "bcdefgh", length 7. With the predefined code, a match with a distance near 100 costs 17 bits, and a literal "a" costs 8 bits. So the greedy choice costs 17 + 17 = 34 bits, and the alternative costs 8 + 17 = 25 bits.

Lazy matching catches this case. When the encoder finds a match, it does not write it immediately. It first checks whether the next position has a longer match. If it does, the encoder writes the current byte as a literal and considers the longer match instead, which may itself be postponed the same way. zlib skips the extra check when the current match is already long (16 or more at level 6), because long matches are rarely beaten and the check costs time.

Even lazy matching does not always find the smallest output, because a longer match is not always cheaper. In our sentence, at position 25 the encoder took "he␣se" (length 5, distance 24) and then "a␣sh" (length 4, distance 18). Another choice exists: write "h" and "e" as literals, then match "␣sea␣sh" at position 27, which repeats position 9 with length 7 and distance 18. Fewer matches and a longer match sounds better, but with the predefined code the first choice costs 15 + 15 = 30 bits and the second costs 8 + 8 + 15 = 31 bits. Tools such as Google's Zopfli try many choices and measure the real cost of each, which gives output typically a few percent smaller than zlib's level 9, at a speed on the order of a hundred times slower.

The important point behind all of this is that the DEFLATE format defines only what the decoder does. It does not say how the encoder should choose literals and matches. Any sequence of literals and matches that rebuilds the input is valid. Encoders differ in how small their output is and how fast they run, but every correct decoder rebuilds the same bytes from any valid stream.

### What LZ77 achieves on its own

How much did LZ77 save on our sentence? Very little, if we write its output naively, and the reason points to the second half of DEFLATE.

Suppose we write each literal as 1 flag bit (meaning "literal") plus its 8-bit value, so 9 bits. We write each match as 1 flag bit, 8 bits for the length and 15 bits for the distance (enough for distances up to 32,768), so 24 bits. Our 18 literals and 5 matches then take 18 × 9 + 5 × 24 = 162 + 120 = 282 bits, against 37 × 8 = 296 bits for the original. That saves 14 bits, under 5 percent.

Part of the reason is that the sentence is short, so its repeats are short. But the bigger reason is that fixed-width fields waste bits. Every distance takes 15 bits, although all five of our distances are below 32 and would fit in 5 bits. Every literal takes 8 bits, whether it is a common letter or a rare one. The lengths 3 and 4 make up four of our five matches, yet the length field gives them as much room as length 258. This unevenness in LZ77's output is skew, and removing skew is what Huffman coding does.

## Part 2: Huffman coding removes skew

### The problem with fixed-width codes

If some values occur much more often than others, how do we spend fewer bits on the common ones? We give each value its own bit pattern, short for common values and long for rare ones, chosen so the total comes out as small as possible.

Some vocabulary first. A symbol is one value from a fixed set of possible values, and the set is called an alphabet. For plain text the alphabet could be the 256 byte values. Later, DEFLATE's alphabets will include match lengths and distances as well as bytes.

Take the 11-letter message "abracadabra". It uses five symbols, with these counts: "a" 5 times, "b" 2, "r" 2, "c" 1, "d" 1. A fixed-width code needs 3 bits per symbol, because 2 bits only give 4 different patterns and we have 5 symbols. That makes 11 × 3 = 33 bits. Yet "a" is almost half the message. If "a" took 1 bit instead of 3, we would save 2 bits five times over.

### Prefix codes

If codewords have different lengths, how does the decoder know where one ends and the next begins? We cannot add separators, because a separator would itself cost bits. Instead we choose the patterns so that the bits themselves show where each one ends.

Here is what goes wrong otherwise. Suppose "a" is 0, "b" is 01 and "c" is 1. The bits 01 could mean "b", or "a" followed by "c". The decoder cannot tell. The problem is that the pattern for "a" is the beginning of the pattern for "b".

The fix is a rule: no symbol's pattern may be the beginning of another symbol's pattern. A set of patterns that follows this rule is called a prefix code (a prefix is a beginning part of a string). With a prefix code, the decoder reads bits one at a time until the bits so far equal some symbol's pattern. At that point it can stop, because no other pattern starts with those bits. Then it starts again on the next symbol.

From now on I will use three terms consistently. A codeword is the bit pattern assigned to one symbol. A code is the whole assignment of codewords to symbols. A code length is the number of bits in one codeword.

A prefix code can be drawn as a tree. Start at a root; a 0 bit means go left and a 1 bit means go right. Each codeword is a path from the root, and the symbol sits where the path ends. The prefix rule says that symbols sit only at the ends of branches, never at a point that a longer path passes through, because then that symbol's codeword would be the beginning of the longer one.

The tree also shows a limit on how short codewords can be. A codeword of length 1 uses up half of all possible bit strings (all strings starting with that bit), a codeword of length 2 uses up a quarter, and in general a codeword of length k uses up 1/2ᵏ. For a prefix code these fractions add up to at most 1. So you cannot shorten one codeword without lengthening another. This rule is known as the Kraft inequality, and it is the reason why giving one symbol a short codeword always costs something elsewhere.

### Huffman's algorithm

Which prefix code gives the smallest total for a given set of counts? David Huffman answered this in 1952 with a short algorithm: repeatedly combine the two least frequent items into one.

Here are the steps for "abracadabra":

1. List the symbols with their counts: a 5, b 2, r 2, c 1, d 1.
2. Take the two smallest counts, c (1) and d (1), and join them into one combined item with count 1 + 1 = 2. The list is now a 5, b 2, r 2, and the combined item {c, d} with 2.
3. Three items have count 2, so there is a tie. Pick any two; I join b (2) with {c, d} (2) into an item with count 4. The list is now a 5, r 2, and {b, c, d} with 4.
4. Join the two smallest, r (2) and {b, c, d} (4), into an item with count 6. The list is now a 5 and {r, b, c, d} with 6.
5. Join the last two, a (5) and the item with 6, into one item with count 11. Only one item is left, so we stop.

Each join is a branching point in a tree. The last join is the root, and its two parts are its two branches:

```
              (11)
            0/    \1
          a(5)    (6)
                0/    \1
              r(2)    (4)
                    0/    \1
                  b(2)    (2)
                        0/    \1
                      c(1)    d(1)
```

Reading the paths, with 0 for left and 1 for right, gives the codewords: a is 0, r is 10, b is 110, c is 1110, d is 1111. The code lengths are 1, 2, 3, 4 and 4. Check the Kraft inequality: 1/2 + 1/4 + 1/8 + 1/16 + 1/16 = 1, so no space is wasted.

Now encode "abracadabra":

```
a   b   r  a  c    a  d    a  b   r  a
0   110 10 0  1110 0  1111 0  110 10 0
```

That is 1 + 3 + 2 + 1 + 4 + 1 + 4 + 1 + 3 + 2 + 1 = 23 bits. You can also compute it from the counts: 5 × 1 + 2 × 3 + 2 × 2 + 1 × 4 + 1 × 4 = 23. The fixed-width code took 33 bits, and plain bytes take 88.

Why does joining the two rarest symbols give the best code? Two facts make it safe. First, in some best code the two rarest symbols have the longest codewords, because if a rarer symbol had a shorter codeword than a more common one, swapping the two codewords would save bits. Second, those two can be siblings, meaning their codewords differ only in the last bit. That is because the deepest level of a best tree never has a lone branch end: a lone deepest symbol could move up one level and save a bit every time it occurs. So we can glue the two rarest symbols together into one item whose count is the sum of theirs. That leaves the same problem with one symbol fewer, and the best code for the smaller problem, with one more bit added for the two glued symbols, is a best code for the larger one. Repeating the gluing until one item is left therefore builds a best code.

Ties do not affect the total. If at step 3 you had joined b with r instead, you would get a code with lengths 1, 3, 3, 3 and 3 for a, b, r, c and d. That is a different code, but it also takes 5 × 1 + 6 × 3 = 23 bits. Both are equally good.

### How close to the best possible

Is 23 bits the smallest that "abracadabra" can possibly take? Among prefix codes with whole-bit codewords, yes. But there is a lower limit for any coding of these frequencies, and Huffman coding lands just above it.

Suppose a symbol makes up a fraction p of the message. Information theory says that, on average, no lossless coding can spend fewer than log₂(1/p) bits on that symbol when each symbol is coded on its own. For "a", p is 5/11, so the limit is log₂(11/5) ≈ 1.14 bits. For "b" and "r", p is 2/11 and the limit is about 2.46 bits each. For "c" and "d", p is 1/11 and the limit is about 3.46 bits each. Averaging over the message: (5 × 1.14 + 2 × 2.46 + 2 × 2.46 + 1 × 3.46 + 1 × 3.46) / 11 ≈ 2.04 bits per symbol. That average is called the entropy of the symbol frequencies. Here it is 2.04 bits per symbol, or about 22.44 bits for the whole message. Huffman's 23 bits are 2.09 bits per symbol, 0.05 bits per symbol above the limit.

In general, a Huffman code's average codeword length L and the entropy H satisfy H ≤ L < H + 1. So Huffman coding never spends more than 1 extra bit per symbol over the entropy. This statement holds for the model it assumes: each symbol is treated independently, with only its overall count taken into account. Huffman coding sees nothing about order, such as "u" almost always following "q". LZ77 captures some order information, because a repeated string is a pattern of order, and that is part of why the two methods work well together.

### Where whole bits cost the most

When is the 1 bit of slack large? When one symbol dominates. Take an alphabet of two symbols with frequencies 99 percent and 1 percent. Every codeword needs at least 1 bit, so Huffman coding spends 1 bit per symbol. The entropy is 0.99 × log₂(1/0.99) + 0.01 × log₂(1/0.01) ≈ 0.014 + 0.066 = 0.08 bits per symbol. The Huffman code is about 12 times larger than the limit.

In DEFLATE this case hurts less than the example suggests, because a dominant byte usually comes in long runs, and LZ77 turns runs into matches before Huffman coding sees them. But it is a real limit of the format. Newer formats such as zstd use another method, asymmetric numeral systems, for parts of their data, because it can spend a fraction of a bit on a symbol.

### The decoder needs the code

How does the decoder know the code? The Huffman code depends on the counts in this particular data, and the decoder does not have the data. There are two options. Both sides can agree on a code in advance, which costs nothing to send but fits no data perfectly. Or the encoder can send the code along with the data, which fits exactly but costs bits. DEFLATE offers both, and the encoder chooses between them for each part of the stream. We will come back to how it sends a code cheaply.

## Part 3: Huffman coding the output of LZ77

### Three kinds of numbers in one stream

What exactly does DEFLATE apply Huffman coding to? LZ77 produces three kinds of numbers: literal bytes (0 to 255), match lengths (3 to 258) and match distances (1 to 32,768). The decoder also has to know, at each point, whether the next item is a literal or a match. DEFLATE handles this with two alphabets and a trick for large numbers.

### One alphabet for literals and lengths

How does the decoder tell a literal from a match without spending a flag bit on each? DEFLATE puts literals and lengths into the same alphabet, so the codeword itself says which one it is.

That alphabet has 286 symbols, which I will call the literal and length alphabet. Symbols 0 to 255 are the literal bytes with those values. Symbol 256 marks the end of a block, a term I explain shortly; the decoder needs it to know when to stop reading codewords. Symbols 257 to 285 stand for match lengths. A second alphabet, the distance alphabet, has 30 symbols, 0 to 29, for match distances.

Merging literals and lengths into one alphabet means that "literal or match" costs no separate bit. One Huffman code covers all 286 symbols, so if matches are rare in some data, the length symbols get long codewords, and if literals are rare, they do. The frequencies of the two kinds are absorbed into the code lengths automatically. The decoder never confuses the two alphabets, because a distance always comes immediately after a length. When the decoder reads a symbol from 257 to 285, it knows the next codeword belongs to the distance code. Otherwise, it reads the next codeword from the literal and length code.

### Length symbols and extra bits

How can 29 symbols cover 256 different lengths? Each symbol stands for a range of lengths, and a few plain bits after the codeword say which length in the range is meant. Those bits are called extra bits.

There are two reasons for using ranges. A Huffman code over all 256 lengths (or all 32,768 distances) would need a description of all those code lengths in the block header, which is expensive to send. And most individual long lengths appear once or not at all in a block, so their counts are too small for Huffman coding to do anything useful with them. Grouping them pools the counts.

Short ranges are used for small values and wide ranges for large ones. Short matches are common, so each small length gets its own symbol and Huffman coding can distinguish their frequencies. Among long matches, a length of 100 is about as likely as 101, so there is little to gain from separate codewords. The extra bits are written as a plain binary number, not Huffman coded, because the values within a range are close to equally likely.

Here is the full table:

| Symbol | Extra bits | Lengths | Symbol | Extra bits | Lengths |
|---|---|---|---|---|---|
| 257 | 0 | 3 | 272 | 2 | 31–34 |
| 258 | 0 | 4 | 273 | 3 | 35–42 |
| 259 | 0 | 5 | 274 | 3 | 43–50 |
| 260 | 0 | 6 | 275 | 3 | 51–58 |
| 261 | 0 | 7 | 276 | 3 | 59–66 |
| 262 | 0 | 8 | 277 | 4 | 67–82 |
| 263 | 0 | 9 | 278 | 4 | 83–98 |
| 264 | 0 | 10 | 279 | 4 | 99–114 |
| 265 | 1 | 11–12 | 280 | 4 | 115–130 |
| 266 | 1 | 13–14 | 281 | 5 | 131–162 |
| 267 | 1 | 15–16 | 282 | 5 | 163–194 |
| 268 | 1 | 17–18 | 283 | 5 | 195–226 |
| 269 | 2 | 19–22 | 284 | 5 | 227–257 |
| 270 | 2 | 23–26 | 285 | 0 | 258 |
| 271 | 2 | 27–30 | | | |

Take a match of length 20. It falls in the range 19 to 22, so the symbol is 269, which has 2 extra bits. The extra bits hold the offset from the start of the range, 20 − 19 = 1, written as a 2-bit number. The decoder reads symbol 269, reads 2 extra bits, gets 1, and computes 19 + 1 = 20. A length of 100 falls in the range 99 to 114: symbol 279, 4 extra bits holding 1.

There is one exception in the table. Symbol 284 has 5 extra bits, which could count up to 31 and reach 227 + 31 = 258, but 258 has its own symbol, 285, with no extra bits. So with symbol 284 the extra bits only go up to 30, and the specification makes length 258 cheap because it is the length of every match in the middle of a long run.

### Distance symbols

Distances work the same way, with wider ranges because distances go up to 32,768:

| Symbol | Extra bits | Distances | Symbol | Extra bits | Distances |
|---|---|---|---|---|---|
| 0 | 0 | 1 | 15 | 6 | 193–256 |
| 1 | 0 | 2 | 16 | 7 | 257–384 |
| 2 | 0 | 3 | 17 | 7 | 385–512 |
| 3 | 0 | 4 | 18 | 8 | 513–768 |
| 4 | 1 | 5–6 | 19 | 8 | 769–1024 |
| 5 | 1 | 7–8 | 20 | 9 | 1025–1536 |
| 6 | 2 | 9–12 | 21 | 9 | 1537–2048 |
| 7 | 2 | 13–16 | 22 | 10 | 2049–3072 |
| 8 | 3 | 17–24 | 23 | 10 | 3073–4096 |
| 9 | 3 | 25–32 | 24 | 11 | 4097–6144 |
| 10 | 4 | 33–48 | 25 | 11 | 6145–8192 |
| 11 | 4 | 49–64 | 26 | 12 | 8193–12288 |
| 12 | 5 | 65–96 | 27 | 12 | 12289–16384 |
| 13 | 5 | 97–128 | 28 | 13 | 16385–24576 |
| 14 | 6 | 129–192 | 29 | 13 | 24577–32768 |

Each pair of symbols doubles the range, so a distance of about d needs about log₂(d) − 1 extra bits. A distance of 6 is symbol 4 with 1 extra bit holding 6 − 5 = 1. A distance of 20,000 is symbol 28 with 13 extra bits holding 20,000 − 16,385 = 3,615. The consequence is that distant matches cost more bits than nearby ones, so a nearby copy of a string is worth more to the encoder than a distant copy of the same length. zlib uses this fact: at its default settings it drops matches of length 3 whose distance is more than 4,096, because such a match costs about as much as the three literals it replaces.

### Our sentence as symbols

Here is our sentence's LZ77 output converted into symbols and extra bits. The literal symbols are simply the byte values: "s" is 115, "h" 104, "e" 101, space 32, "l" 108, "a" 97, "b" 98, "y" 121, "t" 116, "o" 111 and "r" 114.

| Item | Literal or length symbol | Distance symbol | Extra bits |
|---|---|---|---|
| s h e ␣ s e l l s | 115, 104, 101, 32, 115, 101, 108, 108, 115 | | |
| length 3, distance 6 | 257 | 4 | distance: 1 bit, value 1 |
| a ␣ | 97, 32 | | |
| length 3, distance 14 | 257 | 7 | distance: 2 bits, value 1 |
| length 4, distance 11 | 258 | 6 | distance: 2 bits, value 2 |
| b y ␣ t | 98, 121, 32, 116 | | |
| length 5, distance 24 | 259 | 8 | distance: 3 bits, value 7 |
| length 4, distance 18 | 258 | 8 | distance: 3 bits, value 1 |
| o r e | 111, 114, 101 | | |
| end of block | 256 | | |

That is 24 symbols from the literal and length alphabet, 5 symbols from the distance alphabet, and 1 + 2 + 2 + 3 + 3 = 11 extra bits.

## Blocks

### Why the stream is split into blocks

What happens when the data changes character halfway through, say a file with English text followed by a table of numbers? A single Huffman code would fit neither part well. DEFLATE therefore divides its output into blocks, and each block chooses its own code.

A block is a section of the compressed stream with its own 3-bit header and its own way of coding symbols. The header's first bit is called BFINAL; it is 1 on the last block of the stream and 0 on all others. The next two bits, called BTYPE, give the block type: 0 for a stored block, 1 for a block that uses the fixed code, and 2 for a block that uses a dynamic code, which is one the encoder builds and sends. The value 3 is reserved, and a decoder must reject a stream that uses it. Every block except a stored one ends with the end-of-block symbol, 256, which is the symbol whose only job is to say "this block is over".

Blocks divide the coding, not the data. A match may refer back across a block boundary to anything within the last 32,768 bytes of output, including bytes from a stored block. So starting a new block costs a header but never loses the window.

### Stored blocks

What should the encoder do with data that will not compress? It writes a stored block, which holds the bytes unchanged. After the 3 header bits, the encoder skips to the next byte boundary (it fills the rest of the current byte with zero bits). Then it writes LEN, the number of bytes in the block as a 2-byte number, and NLEN, which is LEN with every bit flipped, so the decoder can detect a damaged length. Then come the LEN bytes themselves. Because LEN has 16 bits, a stored block holds at most 65,535 bytes. The overhead is the 3 header bits rounded up to a byte, plus 4 bytes for LEN and NLEN, so 5 bytes per block when the block starts on a byte boundary. That is the source of the worst-case figure at the start of this post.

### The fixed code

When is it not worth sending a code? When the block is small, because a code description costs dozens of bytes. For that case DEFLATE defines a fixed code that both sides know in advance:

| Literal and length symbols | Code length | Codewords |
|---|---|---|
| 0–143 | 8 | 00110000 to 10111111 |
| 144–255 | 9 | 110010000 to 111111111 |
| 256–279 | 7 | 0000000 to 0010111 |
| 280–287 | 8 | 11000000 to 11000111 |

Within each row the codewords count up in order, so symbol 0 is 00110000 (48 in binary), symbol 1 is 00110001, and in general a symbol from 0 to 143 has the codeword equal to the symbol plus 48 in 8 bits. Symbol 256 is 0000000, and symbol 263 is 0000111, which is 263 − 256 = 7 in 7 bits. In the fixed code every distance symbol is 5 bits long, and its codeword is the symbol number in binary, so distance symbol 4 is 00100. The fixed code includes codewords for literal and length symbols 286 and 287 and distance symbols 30 and 31, which makes the table a complete code, but those symbols never appear in valid data.

The fixed code favors what is common in text. Bytes 0 to 143 include all printable ASCII characters and get 8 bits, the same as plain bytes. Bytes 144 to 255 are rarer in text and get 9 bits. Short lengths and the end-of-block symbol get 7 bits, because matches are cheap and frequent. So for most text, a fixed block never spends more on a literal than the byte itself took, and it gains on every match.

### Our sentence with the fixed code

How large is our sentence as one fixed block? Let us add it up. The header is 3 bits. All 18 literals are below 144, so they cost 8 bits each, 144 bits in total. The match lengths 3, 4 and 5 are symbols 257, 258 and 259, which cost 7 bits each. Each distance symbol costs 5 bits, plus its extra bits. So the five matches cost:

- length 3, distance 6: 7 + 5 + 1 = 13 bits
- length 3, distance 14: 7 + 5 + 2 = 14 bits
- length 4, distance 11: 7 + 5 + 2 = 14 bits
- length 5, distance 24: 7 + 5 + 3 = 15 bits
- length 4, distance 18: 7 + 5 + 3 = 15 bits

That is 71 bits for the matches. The end-of-block symbol adds 7 bits. The total is 3 + 144 + 71 + 7 = 225 bits. A stream must end on a whole byte, so it rounds up to 29 bytes, down from 37.

Compare the other two choices. A stored block would take 1 byte for the header bits and padding, 4 bytes for LEN and NLEN, and 37 bytes of data: 42 bytes, which is larger than the input. A dynamic block would fit the data's own frequencies better, but, as the next section shows, describing its code costs more than it saves on 37 bytes. So the fixed block wins here.

Notice what happens if you save this as a gzip file. The gzip wrapper adds at least 18 bytes, so the file becomes 29 + 18 = 47 bytes, larger than the 37-byte input. This is normal for tiny inputs. Compression only pays once the data is large enough for its patterns to outweigh the fixed costs.

### How an encoder chooses a block type

How does the encoder decide between the three types? zlib collects symbols until an internal buffer fills (16,384 symbols at its default memory setting) or the input ends. It then computes the exact size of the block as a stored block, as a fixed block and as a dynamic block, and writes whichever is smallest. Other encoders try harder, for example by looking for points where the data's statistics change and ending blocks there.

## Sending the code: dynamic blocks

### The problem

How can an encoder describe a Huffman code for up to 286 literal and length symbols and 30 distance symbols without spending more bits than the code saves? DEFLATE answers with three ideas applied in layers: send only the code lengths, compress the list of lengths with repeat instructions, and Huffman code that list too.

### Canonical Huffman codes: only the lengths are needed

Do we need to send the codewords themselves? No. If both sides follow the same rule for turning code lengths into codewords, the lengths are enough. A code built this way is called a canonical Huffman code, and DEFLATE requires all its codes to be canonical. The rule is: shorter codewords come before longer ones in binary counting order, and codewords of the same length are given to symbols in the order of the symbol numbers.

Let us rebuild a code for "abracadabra" from its code lengths alone: a is 1, b is 3, c is 4, d is 4 and r is 2. The steps are:

1. Count the codewords of each length. Here there is one of length 1, one of length 2, one of length 3 and two of length 4.
2. Find the first codeword of each length. The first codeword of length 1 is 0. For each next length, take the first codeword of the previous length, add the number of codewords of the previous length, and double the result. Length 2 starts at (0 + 1) × 2 = 2, which is 10 in binary. Length 3 starts at (2 + 1) × 2 = 6, which is 110. Length 4 starts at (6 + 1) × 2 = 14, which is 1110.
3. Go through the symbols in alphabet order and give each the next unused codeword of its length. a (length 1) gets 0. b (length 3) gets 110. c (length 4) gets 1110. d (length 4) gets the next one, 1111. r (length 2) gets 10.

This works because of how step 2 is built. Adding the count skips past the codewords already given out at the previous length. Doubling appends a 0 bit, which gives a longer codeword that does not begin with any shorter codeword. So the result is always a prefix code with exactly the requested lengths. In this case it happens to be the same code we drew from the tree, but that is a coincidence of this example: in general the canonical code differs from the tree's codewords while having the same lengths, and therefore the same total size. The fixed code in the previous section is also a canonical code. Feed it the lengths 8, 9, 7 and 8 for its four ranges and you get exactly the codewords in its table.

### Writing the code lengths with repeats

How long is the list of code lengths? There is one length per symbol, so a dynamic block lists up to 286 lengths for the literal and length alphabet followed by up to 30 for the distance alphabet. A length of 0 means the symbol does not occur in this block and has no codeword. In text, most byte values never occur, so the list is full of long runs of zeros, and DEFLATE compresses it with repeat instructions.

The list is written in a third alphabet, the code length alphabet, which has 19 symbols. Symbols 0 to 15 mean "the next code length is this number". Symbol 16 means "repeat the previous code length 3 to 6 times" and is followed by 2 extra bits giving the count minus 3. Symbol 17 means "3 to 10 zeros" and is followed by 3 extra bits giving the count minus 3. Symbol 18 means "11 to 138 zeros" and is followed by 7 extra bits giving the count minus 11. Code lengths never exceed 15, which is why symbols 0 to 15 are enough.

For example, suppose that in some block symbol 10 (the newline byte) has code length 7, symbol 32 (space) has code length 3, symbols 97 to 101 ("a" to "e") each have code length 5, and no other symbol below 102 occurs. The first 102 code lengths are written like this:

- symbols 0 to 9 are ten zeros: symbol 17 with extra bits holding 10 − 3 = 7
- symbol 10 has length 7: symbol 7
- symbols 11 to 31 are 21 zeros: symbol 18 with extra bits holding 21 − 11 = 10
- symbol 32 has length 3: symbol 3
- symbols 33 to 96 are 64 zeros: symbol 18 with extra bits holding 64 − 11 = 53
- symbol 97 has length 5: symbol 5
- symbols 98 to 101 repeat that length four more times: symbol 16 with extra bits holding 4 − 3 = 1

So 102 code lengths take seven code length symbols plus 3 + 7 + 7 + 2 = 19 extra bits. The literal and length list and the distance list are written as one continuous sequence, so a run of zeros at the end of the first list may continue into the second.

### The code length code

How are the 19 code length symbols themselves coded? With a Huffman code too, called the code length code, whose codewords are at most 7 bits long. Its code lengths are sent as plain 3-bit numbers, in this fixed order:

```
16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
```

The header says how many of these 3-bit numbers are present, and every entry after the last one present is taken to be 0, meaning that code length symbol is not used. The order lists first the entries that blocks need most often: the repeat symbols and the common code lengths around 7 and 8. The rarely used very short and very long lengths come last, so a block that does not use them can cut them off. Each entry cut saves 3 bits.

### The layout of a dynamic block

Here is everything a dynamic block contains, in the order it appears:

1. The 3-bit block header: BFINAL, then BTYPE with value 2.
2. HLIT, 5 bits: the number of literal and length code lengths minus 257, so 257 to 286 lengths follow. Symbols above the last one listed do not occur.
3. HDIST, 5 bits: the number of distance code lengths minus 1, so 1 to 32 lengths follow.
4. HCLEN, 4 bits: the number of code length code entries minus 4, so 4 to 19 entries follow.
5. The code length code: HCLEN + 4 entries of 3 bits each, in the order shown above.
6. The HLIT + 257 literal and length code lengths followed by the HDIST + 1 distance code lengths, written with the code length code and its repeat symbols.
7. The data: literal and length codewords, each length followed by its extra bits, then a distance codeword and its extra bits, ending with the codeword for symbol 256.

### What a dynamic code would cost for our sentence

Would a dynamic block help our 37-byte sentence? It would save bits on the data and lose more on the header.

First the saving. Our 24 literal and length symbols have these counts: "s", "e" and space appear 3 times each; "l", 257 and 258 appear twice each; and "h", "a", "b", "y", "t", "o", "r", 259 and 256 appear once each. Running Huffman's algorithm on these counts gives codes of 3 to 5 bits, totaling 91 bits, against 186 bits with the fixed code (18 literals at 8 bits and 6 symbols at 7 bits). The distance symbols 4, 6, 7, 8 and 8 take 10 bits with their own Huffman code, against 25 bits with the fixed code. The 11 extra bits are the same either way. So the data saves 95 + 15 = 110 bits.

Now the header. The highest literal and length symbol used is 259, so the list needs 260 entries and HLIT is 3. The highest distance symbol used is 8, so HDIST is 8. The list of 269 code lengths compresses to 34 code length symbols carrying 30 extra bits. The distance code uses a code length of 1, and code length symbol 1 is second to last in the order above, so the header must include 18 of the 19 entries: 54 bits. Add 14 bits for HLIT, HDIST and HCLEN, and 34 code length symbols at roughly 2 to 4 bits each. I have not built the exact code length code here, so the total is an estimate: about 190 bits, give or take a couple of dozen. Spending about 190 bits to save 110 bits loses roughly 80 bits, so the fixed block is the right choice for this sentence.

For larger blocks the balance flips. The header cost depends on how many symbols are used, not on the size of the block, and is typically a few dozen bytes for text. A block of 16,384 symbols of English text spends that once, and saves bits on every one of the thousands of literals whose codewords are shorter than in the fixed code. That is why almost all of a large gzip file is made of dynamic blocks.

### The 15-bit limit

Is a Huffman code always valid in DEFLATE? Not quite. DEFLATE limits code lengths to 15 bits for the literal and length code and the distance code, and to 7 bits for the code length code, so decoders can use small fixed-size tables. Huffman's algorithm can produce a code longer than 15 bits only when the block contains at least 2,584 symbols with counts that grow like the Fibonacci numbers (each count about the sum of the two before it). That is rare, but possible, so encoders must check. When it happens, zlib adjusts the lengths with a simple method that is not always optimal. A method called package-merge finds the best code under a length limit exactly, at more cost in time.

## From symbols to bytes

### The problem of bit order

How are codewords and extra bits packed into bytes? DEFLATE writes a stream of bits, and it has a specific rule for the order of bits, which is the most common source of bugs in hand-written decoders.

The rule has three parts. First, bits fill each byte starting from the lowest bit (bit 0, the one worth 1) and moving up to the highest (bit 7, worth 128). Second, numbers that are not Huffman codewords, such as BTYPE, the extra bits, HLIT, LEN and the 3-bit code length entries, are written starting with their lowest bit. Third, Huffman codewords are written starting with their first bit, the leftmost one as I have printed them, so the decoder meets the bits in the order it needs them to walk the tree.

### A worked example: "hello"

Let us compress the five bytes "hello" into one fixed block and write out every bit. There are no repeats of 3 bytes, so the block holds five literals and the end-of-block symbol.

First the header. BFINAL is 1, written as the bit 1. BTYPE is 1 (fixed code), written as a 2-bit number starting with its lowest bit, which gives the bits 1, 0. So the first three bits are 1, 1, 0.

Next the codewords. With the fixed code, each literal below 144 has the 8-bit codeword equal to its value plus 48:

| Symbol | Value | Value + 48 | Codeword |
|---|---|---|---|
| h | 104 | 152 | 10011000 |
| e | 101 | 149 | 10010101 |
| l | 108 | 156 | 10011100 |
| l | 108 | 156 | 10011100 |
| o | 111 | 159 | 10011111 |
| end of block | 256 | | 0000000 |

Written in stream order, the whole block is these 50 bits:

```
110 10011000 10010101 10011100 10011100 10011111 0000000
```

Now cut the stream into groups of 8 bits, add zeros at the end to finish the last byte, and turn each group into a byte. The first bit of each group goes into bit 0 of the byte, so to read the byte's value in the usual way (highest bit on the left), reverse the group:

| Bits in stream order | Reversed (bit 7 down to bit 0) | Byte |
|---|---|---|
| 1 1 0 1 0 0 1 1 | 1 1 0 0 1 0 1 1 | 0xCB |
| 0 0 0 1 0 0 1 0 | 0 1 0 0 1 0 0 0 | 0x48 |
| 1 0 1 1 0 0 1 1 | 1 1 0 0 1 1 0 1 | 0xCD |
| 1 0 0 1 0 0 1 1 | 1 1 0 0 1 0 0 1 | 0xC9 |
| 1 0 0 1 0 0 1 1 | 1 1 0 0 1 0 0 1 | 0xC9 |
| 1 1 1 0 0 0 0 0 | 0 0 0 0 0 1 1 1 | 0x07 |
| 0 0 (then 6 zeros of padding) | 0 0 0 0 0 0 0 0 | 0x00 |

The DEFLATE stream is `cb 48 cd c9 c9 07 00`, seven bytes for a five-byte input. If you run `zlib.compress(b"hello")` in Python, you get exactly these seven bytes between a 2-byte zlib header and a 4-byte checksum: `78 9c cb 48 cd c9 c9 07 00 06 2c 02 15`. Notice that the codewords cross byte boundaries freely. The codeword for "h" starts in the first byte and ends in the second, which is why decoders work on a bit stream, not a byte stream.

## Reading a DEFLATE stream

How does a decoder put all of this together? It follows these steps, and you can follow them by hand:

1. Read 1 bit for BFINAL and 2 bits for BTYPE.
2. If BTYPE is 0, skip to the next byte boundary, read LEN and NLEN (2 bytes each, lowest byte first), check that NLEN is LEN with all bits flipped, copy the next LEN bytes to the output unchanged, and go to step 6.
3. If BTYPE is 1, use the fixed codes. If BTYPE is 2, read HLIT, HDIST and HCLEN, read the code length code, use it to read the code lengths, and build the two canonical codes from them. If BTYPE is 3, reject the stream.
4. Read one codeword with the literal and length code. If the symbol is below 256, append that byte to the output and repeat this step. If it is 256, the block is over: go to step 6.
5. Otherwise the symbol is a length symbol. Look up its base length and number of extra bits, read the extra bits, and add them to the base. Then read one codeword with the distance code, look up its base distance and extra bits, read the extra bits, and add them. Copy length bytes, one at a time, starting distance bytes back from the end of the output. Go back to step 4.
6. If BFINAL was 1, stop. Otherwise go back to step 1 for the next block.

The decoder must keep the last 32,768 bytes of output available at all times, because any match in any later block may reach that far back. Production decoders such as zlib do not read codewords one bit at a time. They peek at the next 9 or 10 bits and look the symbol up in a table, which finds most codewords in a single step, but the result is the same as the bit-by-bit walk described here.

## The wrappers: gzip, zlib, PNG and ZIP

What does a DEFLATE stream lack that a file needs? It has no checksum to detect corruption and no record of the original size or name. Each format that uses DEFLATE adds these in its own wrapper around the same stream.

A gzip file starts with a header of at least 10 bytes: the identifying bytes 0x1f and 0x8b, the byte 8 (meaning DEFLATE), flags, a modification time and a few other fields, optionally followed by the original file name. Then comes the DEFLATE stream. It ends with 8 bytes: a CRC-32 checksum of the original data and the original size modulo 2³² (the size's remainder after dividing by 4,294,967,296). The decompressor recomputes the checksum over the bytes it rebuilt, and a mismatch means the file is damaged.

A zlib stream is lighter. It has a 2-byte header and a 4-byte Adler-32 checksum at the end, 6 bytes in total. In the header `78 9c` from the "hello" example, the 8 in 0x78 means DEFLATE and the 7 means a window of 2⁽⁷⁺⁸⁾ = 32,768 bytes. The second byte is chosen so that the two bytes, read as one 16-bit number (0x789C, which is 30,876), divide evenly by 31. That check lets a decoder spot a stream that is not zlib. Web servers name these formats in the HTTP Content-Encoding header. The name "deflate" there was meant to mean the zlib format, but some servers sent the raw DEFLATE stream with no wrapper, so browsers accept both.

PNG stores its image data as one zlib stream, split across chunks named IDAT. Before compressing, it applies a filter to each row of pixels to make the data easier for LZ77 and Huffman coding. For example, a row of grayscale values 10, 11, 12, 13, 14, 15, 16, 17 is a smooth gradient with no repeated bytes. The Sub filter replaces each byte with its difference from the byte one pixel to the left, giving 10, 1, 1, 1, 1, 1, 1, 1. That row is now one literal followed by a run, which LZ77 turns into a match, and the many 1s make the literal frequencies strongly skewed. Each row starts with a byte saying which of the five filters was used, so the decoder can undo it.

A ZIP archive compresses each file separately, most commonly with method 8, which is DEFLATE, and stores each file's CRC-32 in its headers. Compressing separately lets you extract one file without decompressing the others. The consequence is that repetition between files is invisible: a thousand small files with the same structure compress far worse in a ZIP than in a .tar.gz, where tar first joins the files into one stream and gzip can then find the repeats between neighboring files, as long as they are within 32,768 bytes of each other.

## What DEFLATE cannot do

Where does DEFLATE fall short, and what does each limit cost? Each limit follows from something you have seen.

The 32,768-byte window means repeats further back are lost, as the random 40,000-byte file showed: it doubled in size with no compression of the second copy. Whole-bit codewords mean a very common symbol still costs at least 1 bit, as the 99 percent example showed: 12 times the entropy. Huffman coding counts symbols without looking at what came before, so DEFLATE cannot use patterns like "after this byte, that byte is likely", which newer formats model directly. And data that has already been compressed has neither repetition nor skew left, so DEFLATE stores it in stored blocks and the output is a little larger than the input.

These limits explain why formats like zstd, xz and Brotli usually produce smaller output on the same data. DEFLATE remains everywhere because every system can read it, its decoder is small and fast, and its compression on ordinary text is good: English prose commonly shrinks to roughly a third of its size, though the ratio depends heavily on the text.

## Try it yourself

Can you compress ten bytes of "a" into a fixed block and get the exact bytes? Here are the inputs to work from. The LZ77 output is one literal "a" followed by a match with length 9 and distance 1, as in the section on overlapping matches. Try it before reading on.

Here is the answer, step by step. The header is BFINAL 1 and BTYPE 1, written as the bits 1, 1, 0. The literal "a" is 97, and 97 + 48 = 145, so its codeword is 10010001. Length 9 is symbol 263, with no extra bits, and its fixed codeword is 263 − 256 = 7 in 7 bits: 0000111. Distance 1 is distance symbol 0, with no extra bits, and its codeword is 00000. The end-of-block symbol is 0000000. That makes 3 + 8 + 7 + 5 + 7 = 30 bits:

```
110 10010001 0000111 00000 0000000
```

Grouped into bytes, with the first bit of each group going into bit 0:

| Bits in stream order | Reversed | Byte |
|---|---|---|
| 1 1 0 1 0 0 1 0 | 0 1 0 0 1 0 1 1 | 0x4B |
| 0 0 1 0 0 0 0 1 | 1 0 0 0 0 1 0 0 | 0x84 |
| 1 1 0 0 0 0 0 0 | 0 0 0 0 0 0 1 1 | 0x03 |
| 0 0 0 0 0 0 (then 2 zeros of padding) | 0 0 0 0 0 0 0 0 | 0x00 |

The stream is `4b 84 03 00`: four bytes for ten. A different encoder might choose different literals and matches, for example two literals followed by a match of length 8, and produce different bytes. Both streams are valid, and any correct decoder rebuilds the same ten bytes of "a" from either.

## Summary

DEFLATE makes data smaller in two stages. LZ77 removes repetition: the encoder walks through the input and, wherever the next 3 to 258 bytes repeat something within the last 32,768 bytes, it writes a match giving the length to copy and the distance back to the earlier copy; everything else it writes as literals. The decoder rebuilds the data by appending literals and copying matches one byte at a time, which also lets a match overlap itself to write long runs.

Huffman coding then removes skew. For a set of symbol counts, Huffman's algorithm repeatedly joins the two rarest items and produces a prefix code whose total size is the smallest possible with whole-bit codewords, within 1 bit per symbol of the entropy. DEFLATE applies it to two alphabets: one with literals, the end-of-block symbol and length ranges, and one with distance ranges, where extra bits pick the exact value within each range.

The stream is a sequence of blocks. Each block is stored unchanged, coded with the fixed code, or coded with a dynamic code that the block describes in its header as a list of code lengths, compressed with repeat symbols and its own small Huffman code, which both sides turn into a canonical code. Bits fill bytes from the lowest bit up, numbers are written lowest bit first, and Huffman codewords are written first bit first. Wrap the stream in a few header bytes and a checksum, and you have a gzip file, a zlib stream, the inside of a PNG, or a file in a ZIP archive.
