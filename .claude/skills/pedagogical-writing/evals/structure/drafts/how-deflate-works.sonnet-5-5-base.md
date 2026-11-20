# How DEFLATE works

## The question this post answers

How can a program make a file smaller and still give back every original byte? DEFLATE answers with two ideas applied one after the other. The first, called LZ77, removes repetition: if a stretch of data appeared a moment ago, it says "copy that" instead of writing it again. The second, called Huffman coding, removes skew: if some byte values are common and others rare, it spends fewer bits on the common ones. Each idea saves something the other cannot, and together they make up the format.

DEFLATE is the compressed data format inside gzip files, inside the zlib library's streams, inside PNG images, and inside ZIP archives (the usual method for compressing each file in a ZIP). Phil Katz designed it for the ZIP format in the early 1990s, and RFC 1951, published in 1996, describes it. When a web server sends you a page with the header `Content-Encoding: gzip`, DEFLATE data is what travels over the wire.

This post builds the format up in the order you would invent it. First comes a short look at the two kinds of waste in data. Then LZ77 with small examples whose numbers you can check by hand. Then Huffman coding the same way. Then how DEFLATE joins them, including the exact tables and block types. The last big example compresses 12 bytes into 6 and then decompresses them, bit by bit. By the end you should be able to explain, without notes, how a DEFLATE stream gets smaller and how it is read back.

Both ideas are lossless, meaning the decompressed output is identical to the original, byte for byte. Nothing below throws information away.

## Two different kinds of waste

Data can be wasteful in two independent ways, and DEFLATE needs two tools because one tool fixes only one of them.

Start with an example of the first kind. Take the 12 bytes `abcabcabcabc`. Written out, that is 12 bytes, which is 96 bits. But you could describe the same data in a few words: "write `abc`, then repeat what you just wrote until you have 12 bytes in total". The information in the data is small, but the way it is written down repeats itself. This waste is called **repetition**: the same sequence of bytes appearing again later in the data. It is the waste that LZ77 removes.

The second kind needs a different example. Imagine a file that contains only the four letters A, C, G and T, such as a DNA sequence, stored one letter per byte. A byte can hold 256 different values, which takes 8 bits, but this file only ever uses 4 of them. Four values need only 2 bits each (there are four combinations of two bits: 00, 01, 10, 11). So the file could be a quarter of its size, and this holds even if no sequence of letters ever repeats. The waste here is that every symbol gets the same number of bits regardless of how often it occurs, or whether it occurs at all. When some symbols are used much more than others, or some never, we call the pattern **skew**: an uneven spread of how often each value occurs. Huffman coding removes this waste.

The two kinds are independent, and a file can have either, both, or neither:

| Data | Repetition | Skew |
|---|---|---|
| The same paragraph pasted ten times | a lot | some (letters are uneven) |
| A long run of random letters A, C, G, T | almost none | yes, only 4 of 256 values used |
| Bytes from a good random number generator | none | none |
| Plain English text | some (common words recur) | yes (`e` is far more common than `z`) |

Data in the last row cannot be compressed by DEFLATE, and I will return to that case later. Most real files, such as text, source code, HTML and uncompressed images, fall in the middle rows, which is why the combination works so well.

One more word before we start. A **bit** is a single 0 or 1, and everything below is about spending fewer bits to say the same thing. When I say a code "costs" some number of bits, that is all I mean.

## Part one: LZ77, which removes repetition

The question for this part is how to avoid writing out a stretch of bytes that already appeared earlier. The answer is to replace the second appearance with a short instruction pointing at the first.

### A worked example

Take the 18-character string `to be or not to be`. Here it is with each character numbered from zero, where `_` stands for a space so you can see it:

| Position | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Character | t | o | _ | b | e | _ | o | r | _ | n | o | t | _ | t | o | _ | b | e |

The compressor reads from left to right. At each position it asks: do the bytes starting here also appear earlier in the data? For the first 13 positions the answer is no, in the sense that matters. Some single characters repeat, for example `o` at positions 1, 6, 10 and 14, but a repeat of one or two bytes is too short to be worth an instruction. I will explain why a bit later. So the compressor copies those 13 characters, `to be or not_`, straight into its output. A byte copied unchanged like this is called a **literal**.

At position 13 something better happens. The five characters starting there are `to be`, and the five characters starting at position 0 are also `to be`. So instead of writing five literals, the compressor writes an instruction that means: "go back 13 positions, and copy 5 bytes". Position 13 minus 13 is position 0, which is where the earlier copy starts. This instruction is called a **match**. It consists of two numbers: a **length** (how many bytes to copy, here 5) and a **distance** (how far back the earlier copy starts, here 13).

The whole string is therefore stored as 13 literals followed by one match, which is 14 items instead of 18. Each of these items, a literal or a match, is called a **token**.

To decompress, the reader processes tokens in order. For a literal, it appends that byte to its output. For a match, it looks back distance bytes in the output it has already produced and copies length bytes from there. Reading `to be or not_` as 13 literals gives it the first 13 characters. Then the match says distance 13, length 5. The decoder steps back 13 bytes from the end of its output, which lands on the first `t`, and copies `t`, `o`, `_`, `b`, `e` to the end. The decoder never needs the original file. It only needs its own earlier output, which is why decompression is fast and simple.

### The general rule

LZ77 turns data into a sequence of tokens. A token is either a literal (one byte, written as it is) or a match (a length and a distance, meaning "copy length bytes that start distance bytes back in the output so far"). Wherever the data repeats something recent, a match replaces it. A match pays off when its two numbers cost fewer bits than the bytes they replace, and that depends on how long the repeated stretch is.

### Matches can overlap themselves

What if the length is larger than the distance? Take `abcabcabcabc` again. The compressor writes `a`, `b`, `c` as literals. At position 3 the bytes `abcabcabc`, nine of them, are the same as the bytes starting at position 0 for the first three, and then the pattern continues. The match is: distance 3, length 9.

How can you copy 9 bytes from a place that only has 3 bytes in front of it? The trick is that the decoder copies one byte at a time, and each copied byte is immediately part of the output and can be copied again. Walk through it. The output so far is `abc`, with length 3. The match says distance 3, so the decoder copies the byte 3 back, which is `a`, and the output becomes `abca`. The next byte to copy is again 3 back from the new end, which is `b`, giving `abcab`. Then `c`, giving `abcabc`. Then the byte 3 back is the `a` that was just written, giving `abcabca`. And so on until nine bytes have been copied, giving `abcabcabcabc`.

A related case is a run of one repeated byte. The string `aaaaaaaa` (eight a's) is one literal `a`, then a match with distance 1 and length 7. Distance 1 means "copy the byte right before the end", and the one-byte-at-a-time rule makes that produce seven more a's.

This only works if the decoder really copies one byte at a time. A decoder that copies the whole block of bytes in one step, as a plain memory copy of overlapping regions would, gets the wrong answer whenever length is greater than distance. This is a classic bug in hand-written decoders.

### The window: how far back a match may reach

A match cannot point just anywhere. In DEFLATE the distance is at most 32,768 bytes, so the compressor and the decompressor only need to remember the most recent 32,768 bytes of data. That range is called the **window**, because it slides forward along the data as more of it is processed.

There are two reasons for this limit, and both are about cost. First, the decoder must keep the window in memory, and 32 kilobytes was a modest amount in the early 1990s. Second, the compressor must search the window for matches, and a bigger window means more places to search. The distance also has to be written in bits, and the format's distance table stops at 32,768, which is 2 to the power 15.

This limit has a consequence that surprises people. Repetition that is farther apart than 32,768 bytes is invisible to DEFLATE. If a file contains the same 1 MB image twice in a row, the second copy cannot point to the first, because every byte of the second copy is more than 32,768 bytes from its twin. The second copy gets compressed about as badly as the first. This is a property of DEFLATE's window and not of repetition removal in general.

A distance can also not reach back before the start of the data, because there is nothing there. At position 13 in our example, no distance larger than 13 would be legal.

### How long can a match be?

In DEFLATE a match has length at least 3 and at most 258. The maximum comes from how the format writes lengths, and I will show the table later. The minimum of 3 deserves a "because".

Two-byte repeats are almost never worth a match. A match must store both a length and a distance, and in the cheapest case the format spends about 12 bits on that pair (a 7 bit code for the length and a 5 bit code for the distance, in the fixed codes I will describe below). Two literals in the same fixed codes cost 16 bits. So a match of length 2 would save at most 4 bits and usually nothing, and the format omits it. With length 3, three literals cost 24 bits against 12 for the cheapest match, so a saving is possible.

The words "possible" and "cheapest" matter, because a match does not always win, even at length 3. The distance is written as a code plus extra bits, and for far distances the extra bits are many. A match of length 3 at distance 30,000 costs 7 bits for the length code, 5 for the distance code, and 13 extra bits, which is 25 bits in total. Three literals cost 24 bits in the fixed codes. So in that case the match is one bit larger than the literals. The zlib library, the reference implementation of DEFLATE, knows this and by default drops length 3 matches whose distance is above 4,096. The format permits such matches, and zlib simply declines to use them.

### Finding matches quickly

So far I have written "the compressor sees that these bytes appeared before" as if it were free. It is not, and this is where compressors differ the most.

Doing it naively means that at every position, the compressor compares the upcoming bytes against every earlier position in the window, up to 32,768 comparisons per byte, and for a megabyte of data that is billions of comparisons. Real compressors use a shortcut. zlib looks at the next three bytes and turns them into a number with a hash function, which is a fixed recipe that maps any three bytes to a number in a small range. It then keeps a table, indexed by that number, of the most recent position where three bytes with that number started. Each position also stores a link to the previous position that had the same number, so positions with the same number form a chain.

To find matches at a position, the compressor hashes the next three bytes, jumps to the start of the matching chain, and walks along it, checking each candidate. Two different three byte strings can end up with the same number, so the compressor must compare the actual bytes of each candidate and not trust the hash. Three bytes are used because a match needs at least three bytes anyway, and any match shorter than that would not be looked for.

Here is the walk on a small input, the 18 character string `abc_bcdefg_abcdefg`. Positions are numbered from zero as before. At position 11 the next three bytes are `abc`, and the chain for them has one earlier entry, position 0. Position 11 minus position 0 is a distance of 11, and the compressor compares further bytes: position 3 holds `_` but position 14 holds `d`, so the match is exactly 3 bytes long.

The compressor does not have to walk the entire chain. A long chain means many candidates, so zlib stops after a limited number of steps, and the limit depends on the compression level you chose. Levels 1 to 9 trade time for compression: a higher level walks further down the chains and tries harder to find the longest match, at the cost of speed. Because it can stop early, the compressor is not guaranteed to find the longest or best match. This is allowed, because any valid sequence of tokens decompresses correctly. All that varies is how small the output ends up. This is an important point about DEFLATE in general: the format fixes how to read tokens, not how to choose them.

### Greedy and lazy matching

When the compressor finds a match, should it take it immediately? The simplest approach is called **greedy**: take the longest match at the current position and move on. A smarter variant is called **lazy**: after finding a match at one position, peek at the next position, and if a longer match starts there, emit the current byte as a literal and take the longer match instead.

Use `abc_bcdefg_abcdefg` again. At position 11 the longest match is `abc`, length 3, distance 11. A greedy compressor takes it, then continues at position 14, where `defg` matches the `defg` at positions 6 to 9 (length 4, distance 8). That is two matches for the last seven characters.

A lazy compressor takes the first match as a candidate, but before using it, it looks at position 12. There the bytes `bcdefg` match positions 4 to 9, which gives length 6 and distance 8, and the input ends right after that. So the lazy compressor emits `a` at position 11 as a literal and then one match of length 6. That is one literal and one match, against two matches. Whether that is cheaper in bits depends on the codes chosen later, but it is typically better, because one fewer match means one fewer length code and distance code to write.

zlib uses the lazy strategy for compression levels 4 to 9, which includes the default level 6, and a faster greedy strategy for levels 1 to 3. The lazy check costs extra time, so it is a trade, and not every compressor makes the same choice.

### What LZ77 leaves behind

After LZ77 the data is a list of tokens, and there are usually far fewer of them than there were bytes if the data had repetition. But we have not yet said how to write tokens in bits. If every literal still took 8 bits and every match took, say, 24 bits for a length and a distance, the saving would be small, and for data with no repetition there would be nothing to save at all. For data without repetition, LZ77 produces only literals, and that is exactly the byte sequence you started with.

Also notice that the tokens have a lopsided look. Some byte values appear as literals more than others, some lengths appear more than others (short matches are far more common than long ones), and some distances are more common than others. This unevenness is skew, and that is what Huffman coding exploits. This is why the two steps are stacked in that order. LZ77 turns repeated stretches into a short list of tokens, and Huffman coding then writes those tokens compactly.

Could the order be swapped? Not usefully. Huffman coding writes each byte as a different number of bits, and the result is no longer a sequence of whole bytes with repeated stretches that line up. A repeated word would be written as a bit pattern that starts at a different bit position each time, so a search for repeated bytes would not find it. LZ77 has to go first, on the bytes, while repetitions are still visible.

## Part two: Huffman coding, which removes skew

The question for this part is how to spend fewer bits on symbols that occur often, without making the data impossible to decode. The answer is to give each symbol its own code of whatever length suits it, shorter for common symbols and longer for rare ones, and to choose the codes so that a decoder can always tell where one code ends and the next begins. David Huffman published a method for building the best such codes in 1952.

Some words first. A **symbol** is one item to be encoded, for example one letter. The **alphabet** is the set of all symbols that can occur. A **code** is the sequence of bits that stands for one symbol, and its **code length** is the number of bits in it. The **frequency** of a symbol is how many times it occurs in the data.

### A worked example

Take the word `abracadabra`, which has 11 letters. Count the frequency of each letter:

- `a` occurs 5 times
- `b` occurs 2 times
- `r` occurs 2 times
- `c` occurs 1 time
- `d` occurs 1 time

That is 5 + 2 + 2 + 1 + 1 = 11 letters. The alphabet here is these five letters, and the skew is plain: `a` is almost half the data.

What would the plain approach cost? Stored as ordinary bytes, 11 letters take 88 bits. Even if we only distinguish the five letters that occur, we need 3 bits for each, because 2 bits give only 4 combinations, which is too few for five letters, and 3 bits give 8. That is 11 times 3, so 33 bits. Can skew do better than 33? Yes, but the codes must not be ambiguous, and that needs the next idea.

### Why codes must not be the start of other codes

If codes have different lengths, the decoder gets a long string of bits with no separators, and it must know where each code ends. Suppose we gave `a` the code `0`, `b` the code `1`, and `c` the code `01`. Then the bits `01` could mean `c`, or they could mean `a` followed by `b`. The decoder cannot tell. The problem arises because the code for `a` (`0`) is the beginning of the code for `c` (`01`).

The fix is a rule: no code may be the beginning of another code. A set of codes obeying this rule is called a **prefix code**. With a prefix code, the decoder reads bits one at a time, and as soon as the bits it has read equal a complete code, that code is the symbol, since no longer code can start the same way. No separators and no guessing are needed.

A convenient way to design a prefix code is a binary tree. Start at a root. Each symbol sits at the end of a branch, and the code is the path to it, with 0 for one direction and 1 for the other. Symbols placed at the ends of branches (the leaves) can never be the beginning of other symbols' codes, because the path to a leaf does not continue past it. The depth of a leaf is the code length of its symbol.

### Building the tree: Huffman's method

Huffman's method builds this tree from the bottom up, always joining the two least frequent things.

1. Make a list with one entry per symbol, each carrying its frequency.
2. Take the two entries with the smallest frequencies, and join them under a new entry whose frequency is their sum.
3. Put the new entry in the list in place of the two. Repeat step 2 until one entry is left. That entry is the root.

Here it is on `abracadabra`. The starting list is a:5, b:2, r:2, c:1, d:1.

- Step 1: the two smallest are `c` (1) and `d` (1). Join them into a new entry `cd` with frequency 2. The list is now a:5, b:2, r:2, cd:2.
- Step 2: the smallest entries are b:2, r:2 and cd:2, all tied at 2. Any two will do, so take `b` and `r`, and join them into `br` with frequency 4. The list is a:5, cd:2, br:4.
- Step 3: the two smallest are cd:2 and br:4. Join them into a new entry with frequency 6. The list is a:5 and an entry of 6.
- Step 4: join a:5 and the entry of 6 to get the root, with frequency 11, which equals the number of letters. That is a useful check.

Now read the depths. `a` hangs directly off the root, so its code length is 1. The entry of 6 hangs off the root too, and `cd` and `br` hang from it, so those two are at depth 2. Their children `c`, `d`, `b` and `r` are all at depth 3. So the code lengths are `a` 1, and `b`, `c`, `d`, `r` each 3.

The total cost of the word is the sum over the symbols of frequency times code length: `a` costs 5 times 1 = 5, `b` costs 2 times 3 = 6, `r` costs 2 times 3 = 6, `c` costs 1 times 3 = 3, `d` costs 1 times 3 = 3. That adds up to 5 + 6 + 6 + 3 + 3 = 23 bits. Against 33 bits for equal length codes and 88 bits for plain bytes, that is a clear saving.

Why does joining the two least frequent entries work? The reason is that the rarest symbols should have the longest codes, because every extra bit on a rare symbol is paid rarely. The two rarest symbols therefore belong at the bottom of the tree as neighbours, sharing a parent. Joining them first builds exactly that, and what is left is a smaller version of the same problem, with the two replaced by one entry that stands for "either of them". Repeating the argument gives a tree that cannot be improved. A tree built this way has the smallest possible total cost among all prefix codes that give each symbol its own whole number of bits.

Ties, like the three-way tie at 2 in step 2, can be broken either way. If we had joined `cd` with `b` first instead, we would have got a different tree, with code lengths 1, 2, 3, 4, 4, namely `a` 1, `r` 2, `b` 3, and `c` and `d` 4. Its total cost is 5 times 1, plus 2 times 2, plus 2 times 3, plus 1 times 4, plus 1 times 4, which is 5 + 4 + 6 + 4 + 4 = 23. The total is the same, 23 bits, but the individual code lengths differ. All the trees that Huffman's method can produce are equally good in total cost.

### Assigning the actual bits

For the first tree, I will use the codes in the form DEFLATE uses, which I explain in the next subsection. They are:

| Symbol | Code length | Code |
|---|---|---|
| a | 1 | `0` |
| b | 3 | `100` |
| c | 3 | `101` |
| d | 3 | `110` |
| r | 3 | `111` |

Check the prefix rule: `0` is not the beginning of any of the 3 bit codes, since they all start with `1`, and the four 3 bit codes are all different from each other, so none of them is the beginning of another.

Now encode `abracadabra` letter by letter: `a` is `0`, `b` is `100`, `r` is `111`, `a` is `0`, `c` is `101`, `a` is `0`, `d` is `110`, `a` is `0`, `b` is `100`, `r` is `111`, `a` is `0`. Joined together this gives `01001110101011001001110`. Count the bits: 1 + 3 + 3 + 1 + 3 + 1 + 3 + 1 + 3 + 3 + 1 = 23, matching the total above.

Decoding reads bits one at a time. The first bit is `0`, which is a complete code, so the first letter is `a`. The next bit is `1`, which is not a complete code, so keep reading: `10` is not a code either, `100` is, so the second letter is `b`. Then `1`, `11`, `111` gives `r`, then `0` gives `a`, then `101` gives `c`, and so on. At each step exactly one reading is possible, which is the point of the prefix rule.

### How close to the best possible is that?

Information theory gives a lower limit for how small data can get when each symbol is coded on its own, based on frequencies. A symbol with probability p carries log base 2 of 1 over p bits of information. For `abracadabra` the probabilities are 5/11 for `a`, 2/11 for `b` and `r`, and 1/11 for `c` and `d`. The sum works out to about 2.04 bits per letter, or about 22.4 bits for 11 letters. Huffman coding gave 23. It cannot reach 22.4 because every code must have a whole number of bits.

That whole number requirement is the main limit of Huffman coding. If one symbol has a probability of 0.9, the information limit for it is about 0.15 bits, but Huffman coding still spends at least 1 bit on it, so the code cannot capture the full skew. Huffman coding is exactly optimal in the special case where all probabilities are powers of one half, such as 1/2, 1/4, 1/8. For example, take 1,000 symbols that fall into four kinds, with 500, 250, 125 and 125 occurrences. Huffman gives code lengths 1, 2, 3 and 3, for a total of 500 times 1, plus 250 times 2, plus 125 times 3 twice, which is 500 + 500 + 750 = 1,750 bits. The information limit is the same, 1.75 bits per symbol. Equal length 8 bit codes would cost 8,000 bits, so the Huffman version is more than four times smaller.

Methods that avoid the whole number limit exist, with arithmetic coding being the best known, but DEFLATE uses Huffman coding. It is fast to decode, and in the 1990s arithmetic coding was entangled with patents.

### When Huffman coding does not help

If all symbols are equally frequent, Huffman coding has nothing to exploit. With 256 equally likely byte values, the best tree is a balanced one where every code is 8 bits, which is the plain byte encoding. Random data and data that has already been compressed look like this, and DEFLATE cannot make them smaller. The format has an escape hatch for that case, described below.

### Canonical codes: how DEFLATE avoids storing the tree

The decoder needs the codes, so the compressed data must carry them somehow. Storing the full tree or every code would be costly. DEFLATE uses a trick: the decoder only receives the **code lengths**, one number per symbol, and rebuilds the actual codes from them using fixed rules. Codes built this way are called **canonical** codes.

The rules are these:

1. Codes with a smaller length come before codes with a larger length, and as numbers they are smaller when read as the first bits of the value.
2. Among codes of the same length, symbols earlier in the alphabet get numerically smaller codes.

The procedure that follows is simple. Start with the code 0 at the shortest length. Give each symbol of that length the next number up. When you move to the next longer length, take the next unused number and shift it left by one bit, which appends a 0.

Apply it to `abracadabra` with lengths `a` 1, `b` 3, `c` 3, `d` 3, `r` 3. The shortest length is 1, with one symbol, `a`, which gets the code `0`. The next number up is 1, and moving to length 2 shifts it to binary `10`. There are no symbols with length 2, so we move on to length 3: the next unused number at length 2 is 2 (binary `10`), and shifting once more gives 4, which is `100` in three bits. So `b` gets `100`, `c` gets the next number, `101`, `d` gets `110`, and `r` gets `111`. Those are exactly the codes in the table above.

Because the rules are fixed, the compressor and decompressor both arrive at the same codes from the same lengths. The compressor only has to store, for each symbol, a small number: its code length. The price is that you cannot choose arbitrary codes, but because every valid tree of a given set of lengths is equally good, nothing is lost.

DEFLATE also limits how long a code may be. Codes for the main alphabets are at most 15 bits long, and the codes used to describe the other codes (a third alphabet, covered below) are at most 7 bits. Plain Huffman building can produce longer codes if there is an extreme skew. For example, with frequencies that grow like the Fibonacci numbers, the tree becomes very deep. In that case the compressor must adjust the lengths, giving up a little optimality to stay within 15. Decoders then know that 15 bits is the most they ever need to look at.

## Part three: how DEFLATE joins them

The question now is how the output of LZ77, a list of literals and matches, gets turned into one stream of bits using Huffman codes. A match contains two numbers, a length and a distance, and a literal contains one byte value. The answer is that DEFLATE uses two Huffman alphabets, one for lengths and literals together and one for distances, and some numbers are written as a Huffman code followed by a few plain extra bits.

### The first alphabet: literals, the end symbol, and lengths

The first alphabet has symbols numbered 0 to 285:

- Symbols 0 to 255 are literals, one for each possible byte value. Symbol 97 stands for the byte 97, the letter `a`.
- Symbol 256 is a special **end symbol**, marking the end of a block of data (blocks are explained below).
- Symbols 257 to 285 each stand for a length of a match, or for a range of lengths.

Literals and lengths share one alphabet on purpose. When the decoder reads a symbol from it, the symbol's number tells the decoder what comes next. A number below 256 is a literal, so output that byte and read the next symbol. 256 means the block is over. A number above 256 is a match, so the decoder next reads a distance. No extra marker bit is needed to say "literal or match", because the alphabet carries that information. This also lets the Huffman coding fit the balance between literals and matches in the actual data: if matches are rare, the length symbols get long codes, and if literals are rare, they do.

### The second alphabet: distances

Distances have their own alphabet of 30 symbols, numbered 0 to 29. A distance symbol is only read right after a length symbol, so the decoder always knows which alphabet to use. Keeping distances separate is sensible because they have a different pattern of skew than literals and lengths. Short distances, for instance, are usually more common than long ones.

### Why symbols stand for ranges, and extra bits

The format has up to 258 possible lengths, and 32,768 possible distances. Giving each possible value its own symbol would make the alphabets huge. Distances would need 32,768 symbols, and the code lengths for all of them would have to be stored. Also, most of those symbols would hardly ever occur, so their frequencies would be nearly meaningless.

So DEFLATE groups values into ranges. A symbol stands for a range, and the exact value within the range is given by a few plain bits written right after the code. These are called **extra bits**. They are not Huffman coded, they are just a number written with a fixed count of bits, counting from the start of the range.

Here is the full table for lengths. A symbol in the first column covers the lengths in the third column, and is followed by the number of extra bits in the second column.

| Symbol | Extra bits | Lengths covered |
|---|---|---|
| 257 | 0 | 3 |
| 258 | 0 | 4 |
| 259 | 0 | 5 |
| 260 | 0 | 6 |
| 261 | 0 | 7 |
| 262 | 0 | 8 |
| 263 | 0 | 9 |
| 264 | 0 | 10 |
| 265 | 1 | 11 to 12 |
| 266 | 1 | 13 to 14 |
| 267 | 1 | 15 to 16 |
| 268 | 1 | 17 to 18 |
| 269 | 2 | 19 to 22 |
| 270 | 2 | 23 to 26 |
| 271 | 2 | 27 to 30 |
| 272 | 2 | 31 to 34 |
| 273 | 3 | 35 to 42 |
| 274 | 3 | 43 to 50 |
| 275 | 3 | 51 to 58 |
| 276 | 3 | 59 to 66 |
| 277 | 4 | 67 to 82 |
| 278 | 4 | 83 to 98 |
| 279 | 4 | 99 to 114 |
| 280 | 4 | 115 to 130 |
| 281 | 5 | 131 to 162 |
| 282 | 5 | 163 to 194 |
| 283 | 5 | 195 to 226 |
| 284 | 5 | 227 to 257 |
| 285 | 0 | 258 |

The last two rows have a quirk. Symbol 284 with 5 extra bits could in principle cover 227 to 258, which is 32 values, but the format gives length 258 its own symbol, 285, with no extra bits. This makes the longest possible match cheap to write, which is useful for long runs of identical data. So symbol 284 only covers 227 to 257.

And here is the table for distances:

| Symbol | Extra bits | Distances covered |
|---|---|---|
| 0 | 0 | 1 |
| 1 | 0 | 2 |
| 2 | 0 | 3 |
| 3 | 0 | 4 |
| 4 | 1 | 5 to 6 |
| 5 | 1 | 7 to 8 |
| 6 | 2 | 9 to 12 |
| 7 | 2 | 13 to 16 |
| 8 | 3 | 17 to 24 |
| 9 | 3 | 25 to 32 |
| 10 | 4 | 33 to 48 |
| 11 | 4 | 49 to 64 |
| 12 | 5 | 65 to 96 |
| 13 | 5 | 97 to 128 |
| 14 | 6 | 129 to 192 |
| 15 | 6 | 193 to 256 |
| 16 | 7 | 257 to 384 |
| 17 | 7 | 385 to 512 |
| 18 | 8 | 513 to 768 |
| 19 | 8 | 769 to 1,024 |
| 20 | 9 | 1,025 to 1,536 |
| 21 | 9 | 1,537 to 2,048 |
| 22 | 10 | 2,049 to 3,072 |
| 23 | 10 | 3,073 to 4,096 |
| 24 | 11 | 4,097 to 6,144 |
| 25 | 11 | 6,145 to 8,192 |
| 26 | 12 | 8,193 to 12,288 |
| 27 | 12 | 12,289 to 16,384 |
| 28 | 13 | 16,385 to 24,576 |
| 29 | 13 | 24,577 to 32,768 |

You do not need to memorise these. The pattern is what matters: the ranges get wider as the numbers get larger. For small values the table is exact, with no extra bits. For large values, the symbol only says roughly how large and the extra bits supply the detail. The designers' reasoning was that for a far distance such as 20,000, knowing the exact value matters little for choosing a code, since distances near each other are about equally likely, while the short distances are the common ones and deserve exact symbols. This is a design judgement about typical data, not a mathematical law, but it keeps the alphabets small while spending the Huffman coding where the skew is. The cost is that the extra bits are never compressed.

### Two examples of using the tables

Suppose a match has length 100 and distance 1,000.

For the length: 100 falls in the range 99 to 114, which is symbol 279 with 4 extra bits. The extra value is the length minus the start of the range, so 100 minus 99 is 1, written in 4 bits as `0001`. The decoder reverses this: symbol 279 means start at 99, read 4 extra bits giving 1, and 99 plus 1 is 100.

For the distance: 1,000 falls in the range 769 to 1,024, which is symbol 19 with 8 extra bits. The extra value is 1,000 minus 769, which is 231, written in 8 bits as `11100111`. The decoder reads symbol 19, starts at 769, reads the 8 extra bits giving 231, and gets 769 plus 231, which is 1,000.

So this match is written as: the Huffman code for length symbol 279, then 4 extra bits, then the Huffman code for distance symbol 19, then 8 extra bits. Compared with writing 100 literals, which would cost at least several hundred bits, this match costs the two Huffman codes plus 12 extra bits. Even if each code is 7 or 8 bits, the total is under 30 bits.

For the "to be or not to be" example from earlier, the match had length 5 and distance 13. Length 5 is symbol 259, with no extra bits. Distance 13 is in the range 13 to 16, symbol 7 with 2 extra bits, and the extra value is 13 minus 13, which is 0, written as `00`.

### Blocks: a stream is cut into pieces

A DEFLATE stream is a sequence of **blocks**, and each block is a stretch of tokens with its own header. The first three bits of every block are:

- one bit called BFINAL, which is 1 if this is the last block in the stream, and 0 otherwise;
- two bits called BTYPE, which say how the rest of the block is stored.

BTYPE has three valid values, so every block is one of three types.

**Type 00, stored.** The data is copied as it is, with no compression. After the three header bits, the stream skips ahead to the next byte boundary, and then comes a 2 byte length, a 2 byte value that is the length with all bits flipped (a check against corruption), and then that many raw bytes. A stored block holds at most 65,535 bytes. This is the escape hatch for data that cannot be compressed. Its overhead is at most 5 bytes per block: the 3 header bits padded out to one byte, plus the 4 length bytes. So incompressible data grows by at most about 5 bytes in every 65,535, which is under one hundredth of a percent.

**Type 01, fixed Huffman codes.** The block uses a Huffman code that is defined once and for all by the DEFLATE specification, so no code lengths need to be stored. This is good for short blocks, where the cost of storing code lengths would exceed the savings. The fixed codes for the first alphabet are:

| Symbols | Code length | Codes (in binary) |
|---|---|---|
| 0 to 143 | 8 | 00110000 to 10111111 |
| 144 to 255 | 9 | 110010000 to 111111111 |
| 256 to 279 | 7 | 0000000 to 0010111 |
| 280 to 287 | 8 | 11000000 to 11000111 |

The numbers go up to 287 because the fixed table defines two extra symbols, 286 and 287, which are never used in valid data. Distances in a fixed block use a 5 bit code, which is simply the symbol number written in 5 bits (30 and 31 are also unused). In the fixed code, common literals such as ordinary ASCII letters take 8 bits, the same as plain bytes, so the fixed code saves nothing on literals. It still helps with matches, because the length and distance codes are short.

**Type 10, dynamic Huffman codes.** The compressor builds Huffman codes from the actual frequencies in this block, using the method from Part two, and stores the code lengths at the start of the block. This is the type that gives the best compression on larger blocks, and it is what most DEFLATE data uses.

**Type 11** is reserved and invalid.

Why have blocks at all? Because the pattern of skew can change within a file. Think of a file that starts as English text and ends as binary data: the best codes for the first part are bad for the second. With blocks, each stretch gets codes fitted to it. The cost is that each dynamic block carries its own header. The compressor therefore chooses where to end a block, and for each block it can pick whichever of the three types gives the fewest bits. zlib, for instance, ends a block after about 16 thousand tokens with default settings, and for each block works out the size of all three options.

Two facts about blocks that are easy to get wrong. First, blocks do not reset the window: a match in one block may point back into the previous block, up to 32,768 bytes, because the decoder keeps the window across blocks. Second, each block ends with the end symbol, 256, so the decoder knows when to stop reading tokens and look for the next block header.

### The dynamic block header

A dynamic block must tell the decoder the code lengths for two alphabets, the first of up to 286 symbols and the distance alphabet of up to 30. Listing those lengths plainly would use many bits, so DEFLATE compresses the list itself, using a third Huffman code. This looks like a loop, but it is only one level deep. After the three bits of block header, a dynamic block has:

1. **HLIT**, 5 bits: the number of symbols actually used in the first alphabet, minus 257. The first alphabet always includes 256 literals plus the end symbol, so at least 257 are always counted. The result is a number of symbols from 257 to 286.
2. **HDIST**, 5 bits: the number of distance symbols used, minus 1, giving 1 to 32.
3. **HCLEN**, 4 bits: how many entries of the third alphabet's code lengths follow, minus 4, giving 4 to 19.
4. Then HCLEN plus 4 numbers, each in 3 bits. These are the code lengths for the third alphabet, which has 19 symbols. They come in this fixed order of symbols: 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15. The order puts the symbols that are usually least needed last, so that the unused entries at the end can be cut off using HCLEN.
5. Finally, the code lengths of the first alphabet and then the distance alphabet, written as one continuous list, using the third alphabet's Huffman code.

The third alphabet's symbols 0 to 15 mean "this symbol has that code length", where 0 means the symbol is not used at all. The other three are shorthand for runs, because long runs of unused symbols are common:

- Symbol 16 means "repeat the previous code length 3 to 6 times", followed by 2 extra bits.
- Symbol 17 means "repeat a length of 0 for 3 to 10 times", followed by 3 extra bits.
- Symbol 18 means "repeat a length of 0 for 11 to 138 times", followed by 7 extra bits.

A small example shows why that helps. Suppose a block uses no symbols for a stretch of 65 consecutive symbols, and then five symbols in a row each have code length 4. Plain, that is 65 zeros followed by five 4s, which is 70 numbers. With the shorthand, the 65 zeros are one symbol 18, with extra bits holding 65 minus 11, which is 54. The five 4s are the symbol 4 once, then symbol 16 with the extra bits holding 4 minus 3, which is 1, meaning "repeat the previous length four more times". That is a total of three symbols, not 70, though each is followed by extra bits where noted. A run symbol 16 cannot be the first one in the list, since it needs a previous length to repeat.

Because the first alphabet and the distance alphabet are written as one list, a run may carry across from the end of one into the start of the other.

The header is real overhead, and this explains a rule of thumb: a dynamic block only pays for itself when the block has enough data. Go back to "to be or not to be", whose tokens are 13 literals, one match and the end symbol. Counting the first alphabet's symbols: space occurs 4 times, `o` 3 times, `t` 2 times, and each of `b`, `e`, `r`, `n`, the length symbol 259 and the end symbol 256 once. Building the tree gives code lengths 2 for space and `o`, 3 for `t`, and 4 for the other six symbols, a total of 8 + 6 + 6 + 24 = 44 bits for the 15 symbols, plus 1 bit for the single distance symbol (the format requires at least one bit even when only one distance symbol is used) and 2 extra bits. That is 47 bits, compared with 125 bits in the fixed code: 104 for 13 literals at 8 bits, 14 for the match (7 for the length code, 5 for the distance code and 2 extra bits), and 7 for the end symbol. That looks like a saving of 78 bits. But the dynamic header would have to describe code lengths for 260 symbols, since the highest symbol used is 259, with all the gaps filled by zeros and runs. That header runs to well over 78 bits, so for a string this small an encoder picks the fixed code. For the 1,000 symbol example I gave earlier, with the saving of 6,250 bits, the header is a rounding error.

### A detail about bit order

When bits are packed into bytes, DEFLATE fills each byte starting from its least significant bit (the one worth 1). Header fields and extra bits are written as numbers, with their own least significant bit first. But Huffman codes are the exception: they are written starting from the most significant bit of the code, in the order you would read the code as a string like `0111`. The reason is that a decoder has to walk down the tree from the top as bits arrive, and the first bit of the code is the top branch. This difference trips up almost everyone who writes a decoder, and it matters in the next section, where I pack bits into bytes.

## Putting it all together on 12 bytes

Now one complete example, from raw bytes to compressed bytes and back. The input is `abcabcabcabc`, the 12 bytes from earlier, and I will use a fixed Huffman block, since a block this small is exactly where the fixed code is the better choice.

### Step 1: LZ77

The compressor emits literals `a`, `b` and `c`. At position 3 the next nine bytes `abcabcabc` match the data starting at position 0 (with overlap, as explained before), so it emits a match with length 9 and distance 3. That covers positions 3 to 11, which is everything. The tokens are three literals and one match, followed by the end symbol.

### Step 2: turn tokens into symbols

- Literal `a` is byte 97, so symbol 97. Literal `b` is symbol 98, and `c` is symbol 99.
- Length 9 is symbol 263, which covers exactly length 9, with 0 extra bits.
- Distance 3 is distance symbol 2, which covers exactly distance 3, with 0 extra bits.
- The end symbol is 256.

### Step 3: write the codes from the fixed table

Literals 0 to 143 have 8 bit codes that start at `00110000`, which is the number 48. So symbol 97 has code 48 + 97 = 145, which is `10010001` in binary. Symbol 98 is 146, `10010010`. Symbol 99 is 147, `10010011`.

Symbols 256 to 279 have 7 bit codes starting at `0000000`. So symbol 263 is 7 above the start, which is `0000111`. The end symbol 256 is `0000000`.

The distance symbol 2 in a fixed block is written in 5 bits: `00010`.

The block header is BFINAL = 1 (this is the last and only block) and BTYPE = 01 (fixed codes). Since BTYPE is a number, its least significant bit goes first, so it is written as `1` then `0`. The header is the three bits `1`, `1`, `0`.

### Step 4: the bit stream

In order, the stream is:

| Part | Bits |
|---|---|
| Header: BFINAL, BTYPE | `110` |
| Literal a | `10010001` |
| Literal b | `10010010` |
| Literal c | `10010011` |
| Length symbol 263 | `0000111` |
| Distance symbol 2 | `00010` |
| End symbol 256 | `0000000` |

That is 3 + 8 + 8 + 8 + 7 + 5 + 7 = 46 bits.

### Step 5: pack into bytes

Bits are packed starting from the least significant bit of the first byte. Write the 46 bits in order and cut them into groups of 8:

- Bits 1 to 8: `1 1 0 1 0 0 1 0`. The first bit is worth 1, the second 2, the third 4, and so on, so this byte is 1 + 2 + 8 + 64 = 75, which is hexadecimal `4B`.
- Bits 9 to 16: `0 0 1 1 0 0 1 0`, which is 4 + 8 + 64 = 76, hexadecimal `4C`.
- Bits 17 to 24: `0 1 0 1 0 0 1 0`, which is 2 + 8 + 64 = 74, hexadecimal `4A`.
- Bits 25 to 32: `0 1 1 0 0 0 0 1`, which is 2 + 4 + 128 = 134, hexadecimal `86`.
- Bits 33 to 40: `1 1 0 0 0 1 0 0`, which is 1 + 2 + 32 = 35, hexadecimal `23`.
- Bits 41 to 46 are the remaining six bits, all zeros, since they are the last six bits of the end symbol, and two padding bits fill the byte: `00`, hexadecimal `00`.

So the compressed data is the six bytes `4B 4C 4A 86 23 00`. I worked this out by hand from the rules, and a real compressor could pick different tokens and produce different bytes. But any correct DEFLATE decoder reads these six bytes and returns `abcabcabcabc`, and you can check it yourself with Python's `zlib.decompress(bytes.fromhex("4b4c4a86230 0".replace(" ", "")), -15)`, where the negative window size value tells zlib to expect raw DEFLATE data with no wrapper.

The input was 12 bytes and the output is 6, half the size, from 3 literals and 1 match.

### Step 6: decompress

The decoder reads bits in the order the compressor wrote them.

1. The first bit is BFINAL, which is 1, so this is the last block. The next two bits are BTYPE, read as a number with the first bit as the least significant: bits `1`, `0` give 1, meaning fixed codes.
2. Now read a symbol using the fixed code. The next bits are `1001000...`. As 7 bit codes only cover `0000000` to `0010111`, and this starts with `1`, it is longer, so read the eighth bit: `10010001`. This falls in the 8 bit range for symbols 0 to 143, and subtracting the start `00110000` (48) from 145 gives 97. Symbol 97 is below 256, so output the byte 97, which is `a`.
3. Next, `10010010` is 146, minus 48 gives 98, the letter `b`. Then `10010011` gives `c`. The output is `abc`.
4. Next the bits are `0000111`. The first seven bits are in the 7 bit range, and 7 above the start means symbol 256 + 7 = 263. That is above 256, so it is a length. Symbol 263 has 0 extra bits and means length 9.
5. A length is always followed by a distance symbol, which in a fixed block is 5 bits: `00010` is 2, which means distance 3, with 0 extra bits.
6. Copy 9 bytes starting 3 bytes back from the end of the output, one byte at a time. The output grows from `abc` to `abcabcabcabc`.
7. The next code is `0000000`, which is symbol 256, the end symbol. The block is over. BFINAL was 1, so the stream is over, and the remaining two bits in the last byte are padding to be ignored.

The decoder did not need the original data, and it did not need any table except the fixed one.

## Where the format is used: the wrappers

Raw DEFLATE data has no name, no checksum, and no marker saying where it begins. The formats that carry it add a small wrapper:

- **gzip** (RFC 1952) puts a header of at least 10 bytes in front, then the DEFLATE data, then an 8 byte trailer holding a CRC-32 checksum of the original data and its length. The header can also hold a file name and a timestamp.
- **zlib** (RFC 1950) puts a 2 byte header in front and a 4 byte Adler-32 checksum after the data. The zlib library is the common software that reads and writes this format, and its function names are what most programming languages call under the hood when you compress something.
- **PNG** images store their pixel data, after a filtering step that makes neighbouring pixels more alike, as a zlib stream inside the file's image data chunks.
- **ZIP** archives store each file with a method number. Method 8 means raw DEFLATE data, and the checksum and sizes are kept in the archive's own directory.

These wrappers matter for small inputs. Our 12 byte example becomes 6 bytes raw, 12 bytes as a zlib stream (2 + 6 + 4), and at least 24 bytes as a gzip file (10 + 6 + 8). So compressing tiny data with gzip makes it larger, and the cause is the wrapper and not DEFLATE.

## What to remember, and where this breaks down

The central claim is that DEFLATE is two ideas stacked. LZ77 comes first and works on bytes: it replaces a stretch that appeared within the last 32,768 bytes with a match, a length from 3 to 258 and a distance from 1 to 32,768. Huffman coding comes second and works on the tokens: it gives short codes to common symbols and long codes to rare ones, and because the codes are canonical, only the code lengths need to be stored.

Here is the summary again as a chain of cause and effect, which is how I would explain it to a colleague.

1. Data wastes space in two ways, repetition and skew, and they are independent.
2. LZ77 attacks repetition. It writes each token as a literal or as a match pointing back into the window, and a decoder simply copies bytes one at a time.
3. The tokens are then unevenly distributed. Huffman coding attacks that skew by building a prefix code from their frequencies, so the decoder can read bits without separators.
4. DEFLATE writes literals and lengths from one alphabet and distances from another. Long ranges of lengths and distances are grouped into symbols, with extra bits giving the exact value.
5. The stream is cut into blocks, and each block is stored raw, with fixed codes, or with codes fitted to it by storing their code lengths in a header, whichever is smallest.

And these are the conditions and exceptions worth keeping in mind:

- **Repetition farther than 32,768 bytes apart is invisible** to DEFLATE, so the same large chunk appearing twice, far apart, gets no benefit.
- **Matches are only worth it above a size.** Length 2 repeats are not representable at all, and a length 3 match at a large distance can be larger than three literals. zlib avoids length 3 matches beyond distance 4,096 for that reason.
- **The compressor chooses the tokens**, not the format. Different compressors, and different levels of the same one, produce different valid streams for the same input. Higher levels search harder and usually produce smaller output, but all of them decompress with the same decoder.
- **Huffman coding is optimal only among codes that give each symbol a whole number of bits.** For a symbol that is extremely common, the cost cannot go below 1 bit, which can be much more than the information limit. In the example `abracadabra` the gap was small: 23 bits against about 22.4.
- **Uniformly spread data cannot be compressed by either idea.** Random data and already compressed data have no repetition and no skew, and DEFLATE falls back to stored blocks, which add at most about 5 bytes per 65,535.
- **Small inputs may not shrink at all**, both because a dynamic header costs more than it saves and because a gzip or zlib wrapper adds bytes. For a typical large text file, DEFLATE often brings the size down to roughly a third to 40 percent of the original, but this varies widely with the content, and I give that as a rough figure and not a rule.

If you want to go further, RFC 1951 is short for a specification and is readable once you have the picture above. A good exercise is to write a small decoder for it: read the three header bits, handle the three block types, rebuild canonical codes from lengths as in the `abracadabra` example, and copy matches one byte at a time. The decoder is a few hundred lines in most languages, and it is the best way to check that you can explain how DEFLATE makes data smaller.
