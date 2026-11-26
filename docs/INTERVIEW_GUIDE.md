# Huffman File Compressor — Interview Guide

Everything you need to explain and defend this project. Read it once end to end, work through the `abracadabra` example (§3) by hand on paper, then use §12 (questions) and §13 (numbers) as a cheat sheet.

---

## 1. The 30-second pitch

> "It's a lossless compressor I wrote from scratch in C++ using Huffman coding. It counts how often each byte appears, builds an optimal prefix-free code with a greedy algorithm driven by a min-heap I implemented myself, and then packs the variable-length codes into bytes with bit manipulation. The compressed file stores a compact encoding of the tree, so the decompressor can rebuild it and restore the original byte-for-byte. On ordinary text files it saves about 40 to 55 percent. I also built a small web demo that replays the tree construction step by step and produces exactly the same `.huf` bytes as the C++ tool."

---

## 2. Resume bullets → where they live in the code

| Resume claim | What to point at |
| --- | --- |
| Lossless compression **and** decompression from scratch | `compress()` / `decompress()` in `src/huffman.cpp`; CLI in `src/main.cpp` |
| Huffman encoding | `HuffmanTree::build`, `buildCodes` in `src/huffman.cpp` |
| 40–60 % size reduction on standard text files | `make bench` → 42–43 % on English text, 56 % on a numeric CSV log (§10) |
| Min-heap-based priority queue | `include/min_heap.hpp` (generic template, written by hand) |
| Optimal prefix-free Huffman binary tree | greedy merge loop in `HuffmanTree::build`; tests check prefix-freeness and optimal cost |
| Character frequency map of the input file | `countFrequencies()` — a 256-entry array indexed by byte value |
| Greedy algorithm | always merge the two lowest-frequency nodes (§4.2) |
| Bit manipulation | `include/bit_io.hpp` (`BitWriter`, `BitReader`), codes stored as `uint64` bits + length |
| File I/O | `readFile` / `writeFile` in `src/main.cpp` (binary mode streams) |
| Binary trees | node pool + index-based children, pre-order (de)serialization |

**About the 40–60 % number:** say "around 40 to 55 percent on typical text, depending on the content". English prose lands at ~43 %; text with a small alphabet (numbers, logs, DNA) does better; mixed CSV with lots of distinct characters is ~36 %. Being precise here makes you more credible, not less.

---

## 3. Worked example: `abracadabra` (do this on paper once)

**Step 1 — count frequencies:** `a:5  b:2  r:2  c:1  d:1` (11 characters = 88 bits in ASCII).

**Step 2 — put every symbol in a min-heap, keyed by frequency.**

**Step 3 — greedy merging** (always pop the two smallest, push their sum):

| Merge | Pop | Pop | Push |
| --- | --- | --- | --- |
| 1 | c:1 | d:1 | (cd):2 |
| 2 | b:2 | r:2 | (br):4 |
| 3 | (cd):2 | (br):4 | (cdbr):6 |
| 4 | a:5 | (cdbr):6 | root:11 |

5 symbols → 4 merges (always n − 1).

**Step 4 — read codes off the tree** (left = 0, right = 1):

```
            11
          0/  \1
          a    6
             0/ \1
             2    4
           0/ \1 0/ \1
           c   d b   r
```

| Symbol | Count | Code | Bits used |
| --- | ---: | --- | ---: |
| a | 5 | `0` | 5 |
| b | 2 | `110` | 6 |
| r | 2 | `111` | 6 |
| c | 1 | `100` | 3 |
| d | 1 | `101` | 3 |
| **Total** | | | **23 bits** |

**23 bits instead of 88.** Average = 23 / 11 = **2.09 bits/symbol**; the entropy (theoretical minimum) is **2.04**.

**Step 5 — but the file is bigger!** Compressed with no file name stored, the `.huf` file is 24 bytes: a 15-byte header + 49 bits of tree + 23 bits of data (72 bits = 9 bytes). For tiny inputs the overhead dominates. (Storing the raw bytes would take 15 + 11 = 26 bytes, so Huffman is still the better of the two options here.) This is a great point to raise yourself (§8).

You can see exactly this in the web demo: pick "abracadabra" and step through the 4 merges.

---

## 4. The algorithm in detail

### 4.1 Count frequencies — `countFrequencies()`

One pass over the bytes, incrementing `freq[byte]` in a `std::array<uint64_t, 256>`. Using the byte value as the array index means O(1) per byte with no hashing — that's why an array beats a `std::map` or `unordered_map` here. Working on **bytes** (not characters) means any file type works: text, images, binaries.

### 4.2 Build the tree with a min-heap — `HuffmanTree::build()`

```
for every byte value s with freq[s] > 0:
    create a leaf, push (freq, leaf) into the min-heap
while heap has more than one node:
    a = pop()          # smallest
    b = pop()          # second smallest
    create parent with freq = a.freq + b.freq, left = a, right = b
    push(parent)
root = pop()
```

- **Greedy choice:** merging the two rarest symbols first pushes them deepest in the tree, so they get the longest codes, while frequent symbols stay near the root with short codes.
- **Why it's optimal (proof sketch, an "exchange argument"):**
  1. In some optimal tree, the two least-frequent symbols are siblings at the deepest level — if a more frequent symbol were deeper, swapping it with a rarer one would not increase the total cost.
  2. Merging those two into one "super-symbol" with the summed frequency reduces the problem to n − 1 symbols, and the cost changes by exactly `f(x) + f(y)` regardless of the rest of the tree. So an optimal tree for the smaller problem gives an optimal tree for the original. By induction, the greedy algorithm is optimal.
- **Deterministic tie-breaking:** each heap entry has an `order` counter (leaves get their order by byte value, new parents get increasing numbers). Equal frequencies come out in a fixed order, so the same input always gives the same tree and the same output file. That's also why the JavaScript port produces byte-identical files.
- **Memory:** nodes live in a `std::vector<Node>` and refer to children by **index** (`int left, right`), not raw pointers. No `new`/`delete`, no leaks, and the whole tree is contiguous in memory.

### 4.3 Generate codes — `buildCodes()`

Depth-first traversal from the root carrying the path so far: going left appends a `0` bit, going right appends a `1` bit. At a leaf, the accumulated bits are that symbol's code. Codes are stored as `Code { uint64_t bits; uint8_t length; }` — e.g. `b = 110` is `bits = 0b110, length = 3`.

**Edge case — only one distinct byte** (e.g. a file of 1,000 `z`s): the root is itself a leaf, so the code would have length 0. Handled specially: the encoder writes no data bits at all, and the decoder just repeats that byte `originalSize` times.

**Code length limit:** codes are kept in a 64-bit integer. A code longer than 64 bits needs Fibonacci-like frequencies and an input of roughly 10¹³ bytes (~10 TB), so it can't happen in practice; the code still checks and throws rather than silently corrupting data.

### 4.4 Prefix-free property

Every symbol is a **leaf**. A code is the path to its leaf, so one code can never be the beginning of another (that would require a leaf to have children). This is why the decoder needs **no separators** between symbols: read bits, walk down the tree, and the moment you hit a leaf you know a symbol has ended.

Tests also check the **Kraft equality** `Σ 2^(−length) = 1`, which holds exactly when the tree is *full* (every internal node has two children) — another sign the code wastes nothing.

### 4.5 Encode — `compress()`

1. Pass 1: frequencies → tree → code table.
2. Write the header: magic `HUF2`, mode, original size, and the original **file name** (§5.1).
3. Write the tree (§5), then each input byte's code, through a `BitWriter`.
4. Flush the last partial byte with zero padding.
5. If the result isn't smaller than storing the input raw, switch to the stored format (§4.6).

Two passes over the input are needed because the codes depend on the frequencies of the whole file.

### 4.6 Stored fallback (mode 0)

After encoding, `compress()` compares the Huffman result with simply keeping the input as-is. If the Huffman payload is **not smaller** than the input, it writes the same header with mode `0` followed by the **raw bytes** instead. So:

- already-compressed files (PDF, DOCX/XLSX/ZIP, JPEG, PNG, MP4) and random data grow only by **the header** (15 bytes + the file name), never more;
- the decoder checks the mode byte: `0` → copy the bytes out, `1` → Huffman-decode.

This is the same idea as DEFLATE's *stored blocks* and ZIP's *store* method. Why can't we avoid growth completely? See the pigeonhole question in §12.

### 4.7 Decode — `decompress()`

1. Check the magic bytes, read the mode, the original size and the stored file name.
2. Rebuild the tree from the stored bits.
3. Repeat `originalSize` times: start at the root, read one bit at a time, go left on `0` / right on `1`, and output the symbol when you reach a leaf.

**The padding problem:** the last byte may contain up to 7 meaningless zero bits. Because the header stores the **original size**, the decoder stops after exactly that many symbols and never interprets the padding. (Other ways to solve this: store the number of padding bits, or add a special end-of-file symbol.)

---

## 5. Storing the tree in the file

The decoder must build *exactly* the same tree. Options:

| Option | Cost for n distinct symbols | Notes |
| --- | --- | --- |
| Store the frequency table | up to 256 × 8 bytes | simple, but big; decoder must use identical tie-breaking |
| **Pre-order tree bits (used here)** | (2n − 1) + 8n bits | `0` = internal node, `1` + 8 bits = leaf symbol |
| Canonical Huffman (code lengths only) | ~n bytes or 256 × 4 bits | what DEFLATE / gzip / JPEG use |

Pre-order encoding, e.g. for `abracadabra`: `0 1[a] 0 0 1[c] 1[d] 0 1[b] 1[r]`. Decoding is a simple recursive read: read a bit; if `1`, read 8 bits and make a leaf; if `0`, read the left subtree then the right subtree.

For English text (~60 distinct bytes) the tree costs about **75 bytes** — small next to the data. The decoder also validates the tree (at most 511 nodes, depth ≤ 255) so a corrupt file can't make it loop forever or overflow the stack.

---

### 5.1 Storing the original file name

The header also stores the **original file name** (like gzip's `FNAME` field), so `report.pdf` → `anything.huf` → `report.pdf` comes back with the right name and extension even if the `.huf` was renamed. Two details worth mentioning:

- **Security:** the name comes from an untrusted file, so the decoder keeps only the last path component and drops control characters. A crafted `.huf` containing `../../etc/passwd` restores as `passwd` in the chosen folder — it can never write elsewhere (a "path traversal" / "zip slip" bug).
- **Safety:** when you don't give an output path, the CLI refuses to overwrite an existing file.
- **Compatibility:** version-1 files (`HUF1`/`HUF0`, no name) still decode; the name falls back to the `.huf` file name minus `.huf`.

## 6. Bit manipulation — `include/bit_io.hpp`

Files are made of bytes, but Huffman codes are 1 to many bits long, so we need to **pack bits into bytes**.

**BitWriter**
```cpp
void writeBit(bool bit) {
    buffer_ = (buffer_ << 1) | bit;   // shift left, put the new bit at the bottom
    if (++count_ == 8) {              // byte full -> emit it
        out_.push_back(buffer_);
        buffer_ = 0; count_ = 0;
    }
}
void flush() {                        // pad the final byte with zeros
    if (count_ > 0) out_.push_back(buffer_ << (8 - count_));
}
```
`writeBits(code, length)` writes the lowest `length` bits of `code`, most significant first: `(code >> k) & 1` for `k = length−1 … 0`.

**BitReader**
```cpp
bool readBit() {
    if (count_ == 0) { buffer_ = in_[pos_++]; count_ = 8; }   // load next byte
    --count_;
    return (buffer_ >> count_) & 1;                          // shift + mask
}
```

Example: writing `0`, `110`, `111` gives bits `0110111` → padded byte `0110 1110` = `0x6E`.

The header's 64-bit size is written **little-endian** byte by byte (`(v >> 8k) & 0xFF`) so the format is the same on every machine, regardless of CPU endianness.

---

## 7. Complexity

Let `N` = input size in bytes, `n` = distinct symbols (≤ 256).

| Step | Time | Space |
| --- | --- | --- |
| Count frequencies | O(N) | O(1) — 256 counters |
| Build tree with heap | O(n log n) | O(n) |
| Build code table | O(n) | O(n) |
| Encode | O(N × average code length) = O(N) | O(N) output |
| Decode | O(total bits) = O(N × average code length) | O(N) output |

Since `n ≤ 256`, tree building is effectively constant time; the whole thing is **linear in the file size**. The current version reads the whole file into memory (simple and fast for normal files); for multi-GB files it would stream in chunks (§11).

---

## 8. Edge cases handled (and tested)

- **Empty file** → header only; decompresses to an empty file.
- **One distinct byte** (`zzzz…`) → tree is a single leaf; no data bits; 100,000 `z`s compress to 14 bytes.
- **Two symbols** → both get 1-bit codes.
- **All 256 byte values** → works on any binary file.
- **Random / already-compressed data** (PDF, DOCX, ZIP, JPEG) → ~8 bits per symbol already, so Huffman would grow the file (header + tree). The **stored fallback** keeps the raw bytes instead: the output is exactly input + header.
- **Very small inputs grow** (e.g. `abracadabra` with no name: 11 B → 24 B) because of fixed overhead; the tool picks whichever of Huffman (24 B) and stored (26 B) is smaller.
- **Renamed `.huf` files** → still restored as the original name and extension, because the name is inside the file.
- **Malicious names** like `../../etc/passwd` → reduced to `passwd`, so decompressing can never write outside the chosen folder.
- **Highly skewed (Fibonacci) frequencies** → deepest possible tree (20 symbols → max code length 19); still round-trips.
- **Corrupt input** → wrong magic, truncated data, or an impossible tree all throw a clear error instead of crashing.

---

## 9. Testing — `make test`

`tests/test_huffman.cpp` uses a tiny self-written `CHECK` macro (no framework needed), 17 cases / 1,597 checks:

- min-heap pops 1,000 random numbers in sorted order;
- empty, single-byte, single-symbol, two-symbol inputs;
- **textbook optimality**: the classic CLRS example (a:45, b:13, c:12, d:16, e:9, f:5) must cost exactly **224 bits**;
- **prefix-free**: no code is a prefix of another;
- **Kraft equality** sums to 1;
- all 256 byte values; 200 KB of random bytes; Fibonacci frequencies;
- average code length is ≥ entropy and < entropy + 1 (Shannon's bound for Huffman);
- stored fallback: random data → exactly input + header; compressible text is still Huffman-coded; tiny inputs pick the smaller option;
- the original file name round-trips (also in stored mode and with non-English characters), path tricks are stripped, and version-1 files without a name still decode;
- corrupt files are rejected.

`make bench` compresses every sample, decompresses it and compares it byte-for-byte with `cmp`.
The web demo's tests also check its `.huf` output is **byte-identical** to the C++ CLI on every sample.

---

## 10. Measured results

| File | Saved | Why |
| --- | ---: | --- |
| English prose (`essay.txt`) | 42.9 % | ~59 distinct bytes, entropy 4.36 bits/char |
| GPL v3 licence | 42.0 % | similar English text |
| Numeric sensor log | 55.9 % | mostly digits, `,` `.` and newline → very skewed |
| C++ source code | 37.7 % | more distinct symbols (braces, operators) |
| Mixed CSV with names | 35.7 % | many distinct letters + digits |
| Random bytes | stored, +header | incompressible → raw bytes kept |

Huffman's average code length for the essay is **4.39 bits/char**, very close to the entropy limit of **4.36**. That's the theory working: Huffman is always within 1 bit of entropy per symbol.

---

## 11. Limitations and what I'd do next

- **Huffman only uses single-byte frequencies.** It can't see repeated *phrases*. Real compressors (gzip/DEFLATE, PNG) first run **LZ77** to replace repeats with back-references, then Huffman-code the result. On the GPL licence text, `gzip -9` saves 65.5 % while pure Huffman saves 42.0 %.
- **Whole-number bit lengths:** a symbol with probability 0.9 still needs 1 full bit. **Arithmetic coding / ANS** (used in zstd) can spend fractions of a bit and get closer to entropy.
- **Canonical Huffman** would shrink the header to just the code lengths and allows faster table-based decoding.
- **Faster decoding:** look up 8–12 bits at a time in a precomputed table instead of walking the tree bit by bit.
- **Streaming** in fixed-size blocks for very large files, with a per-block tree (adapts to changing content).
- **Integrity check:** add a CRC32 of the original data to detect corruption.
- **Adaptive Huffman** (FGK / Vitter) builds the tree on the fly in one pass, with no need to store it.

---

## 12. Likely interview questions (with answers)

**Q: What is Huffman coding in one sentence?**
A greedy algorithm that builds an optimal prefix-free binary code, giving frequent symbols short codes and rare symbols long ones.

**Q: Why is it called greedy, and why does greedy work here?**
At every step it makes the locally best choice — merge the two least frequent nodes — and never reconsiders. It works because the two rarest symbols can always be siblings at the deepest level of some optimal tree, and merging them reduces the problem to a smaller one with the same structure (exchange argument + induction).

**Q: Why a min-heap? What's the complexity?**
We repeatedly need the two smallest items and then insert one. A min-heap does both in O(log n), giving O(n log n) to build the tree. A sorted array would make inserts O(n) → O(n²). (With the frequencies pre-sorted you can even do it in O(n) using two queues.)

**Q: How does your heap work?**
A complete binary tree in a vector: children of `i` at `2i+1` and `2i+2`, parent at `(i−1)/2`. Push appends and sifts up; pop moves the last element to the root and sifts down by swapping with the smaller child.

**Q: What is a prefix-free code and why do we need it?**
No code is a prefix of another. Without it, a bit string like `110` could mean "b" or "a then something", and we'd need separators. Because every symbol is a leaf of the tree, Huffman codes are automatically prefix-free.

**Q: How does the decompressor know the codes?**
The compressed file contains the tree, written in pre-order: `0` for an internal node, `1` followed by the 8-bit symbol for a leaf. The decoder rebuilds the identical tree from those bits.

**Q: How do you handle the leftover bits in the last byte?**
The last byte is padded with zeros. The header stores the original byte count, so the decoder stops after producing exactly that many bytes and never reads the padding as data.

**Q: What compression ratio do you get, and why not more?**
About 40–55 % on text. Huffman can't beat the entropy of single-character frequencies (~4.4 bits/char for English), and it ignores repeated words and phrases. Combining it with LZ77 (like gzip) would do much better.

**Q: Does it work on images or binaries?**
Yes, it works on raw bytes, so any file round-trips correctly. But already-compressed files (JPEG, PNG, ZIP, MP4, and most PDFs, whose content streams are Deflate-compressed) have near-uniform byte frequencies: about 7.2–8 bits of entropy per byte, so savings drop to roughly 0–10 %. A real 577 KB PDF saved 9.8 % (7.21 bits/byte vs an entropy of 7.19). The web demo explains this when it detects high-entropy input.

**Q: Why can a compressed file be bigger than the original?**
Fixed overhead (the header + the stored tree) and incompressible data. For random or already-compressed input, Huffman alone would grow the file, so my tool falls back to storing the raw bytes: the worst case is just the header (15 bytes + the file name).

**Q: How does decompression know the original file type?**
The original file name (with its extension) is stored in the header, so the decoder restores `report.pdf` as `report.pdf` even if the `.huf` was renamed. The name is sanitized first (directories and control characters removed) so a malicious file can't make the tool write outside the output folder.

**Q: Can any lossless compressor shrink every file?**
No — it's the pigeonhole principle. There are 2ⁿ different files of n bits but only 2ⁿ − 1 files shorter than n bits, so if some files get shorter, at least one must get longer (otherwise two inputs would map to the same output and you couldn't decompress both). The best you can do is bound the growth — here, to the size of the header.

**Q: What's entropy, and how close does Huffman get?**
Shannon entropy `H = −Σ p·log₂ p` is the minimum average number of bits per symbol any symbol-by-symbol lossless code can achieve. Huffman's average length L satisfies `H ≤ L < H + 1`. For the essay: H = 4.36, L = 4.39.

**Q: What if two symbols have the same frequency?**
Either can be picked; you get a different but equally optimal tree (same total bit count). I break ties by a fixed order so output is deterministic and reproducible.

**Q: What's the longest possible code?**
With n symbols, up to n − 1 bits (Fibonacci frequencies produce the deepest tree). I store codes in 64-bit integers; exceeding that would need ~10 TB of input, but it's still checked.

**Q: Why store children as indices instead of pointers?**
No manual memory management or leaks, all nodes are contiguous in one vector (cache-friendly), and the tree is trivial to copy or serialize.

**Q: How did you verify correctness?**
Round-trip tests on edge cases and random data, a textbook example with a known optimal cost (224 bits), property checks (prefix-free, Kraft equality, entropy bound), and a benchmark script that compares every decompressed file byte-for-byte with the original.

**Q: How would you make decoding faster?**
Table-driven decoding: peek the next k bits (say 10), look up the symbol and its code length in a 2^k table, then advance by that length. Canonical Huffman makes these tables easy to build.

**Q: What's the difference between Huffman and arithmetic coding?**
Huffman assigns each symbol a whole number of bits. Arithmetic coding encodes the whole message as one number in [0, 1) and can effectively use fractional bits per symbol, getting closer to entropy, at the cost of more computation.

**Q: Where is Huffman used in the real world?**
Inside DEFLATE (ZIP, gzip, PNG), JPEG, MP3, and HTTP/2 header compression (HPACK uses a fixed Huffman table).

**Q: Why C++?**
Direct control over bytes and bits, fast, and a good fit for implementing data structures by hand. File I/O uses binary-mode `ifstream`/`ofstream` so no newline translation corrupts the data on Windows.

---

## 13. Numbers worth remembering

- **abracadabra:** codes a=0, b=110, r=111, c=100, d=101 → 23 bits vs 88; 4 merges.
- **CLRS example:** optimal cost **224 bits**.
- **English text:** ~**43 %** smaller; **4.39** bits/char vs **8**; entropy **4.36**.
- **Numeric log:** **56 %** smaller. **Random / PDF / DOCX:** about **0–10 %**; when Huffman can't help, the file is stored raw (+ header only).
- **Header:** 15 bytes (4 magic + 1 mode + 8 size + 2 name length) + the file name. **Tree:** (2n − 1) + 8n bits.
- **Tree build:** O(n log n), n ≤ 256. **Encode/decode:** O(N).
- **Tests:** 17 cases, **1,597** checks, all passing.

## 14. A 2-minute demo script

1. `make && make test` — show all tests passing.
2. `./bin/huffman compress samples/essay.txt e.huf` → "42.9 % smaller".
3. `./bin/huffman decompress e.huf e.out && cmp samples/essay.txt e.out && echo identical`. (Without an output path it restores `essay.txt` by its stored name, and refuses to overwrite one that already exists.)
4. `./bin/huffman stats samples/essay.txt --codes | head -20` — space and `e` have the shortest codes.
5. Open the web demo, choose **abracadabra**, press play to watch the 4 merges, click `b` in the code table to light up its path `1 → 1 → 0`.
6. Drop `e.huf` onto the web page → it decompresses the file made by the C++ tool and offers **Download essay.txt**. Upload any PDF/DOCX and use **Download restored** to get the identical file back in its original format.
