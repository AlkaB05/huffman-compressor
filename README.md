# Huffman File Compressor

A lossless file compression and decompression tool written **from scratch in C++17** using **Huffman coding**: a hand-written min-heap priority queue, a greedy Huffman tree, bit-level I/O and a self-describing `.huf` file format. No compression libraries.

It ships with a **web demo** (`web/`) that replays the tree construction merge by merge, shows the code table and the packed bit stream, and compresses or decompresses files in the browser. Its output is byte-for-byte identical to the C++ CLI.

## Results

Measured with `make bench` (every file is decompressed and compared byte-for-byte):

| File | Original | Compressed | Saved |
| --- | ---: | ---: | ---: |
| `essay.txt` (English prose) | 4,433 B | 2,521 B | **43.1 %** |
| `gpl-3.0.txt` (GNU GPL v3 licence text) | 35,149 B | 20,359 B | **42.1 %** |
| `sensor_log.csv` (numeric log) | 90,050 B | 39,736 B | **55.9 %** |
| `source_code.cpp.txt` (C++ source) | 8,823 B | 5,475 B | **37.9 %** |
| `students.csv` (mixed CSV) | 66,619 B | 42,824 B | **35.7 %** |
| random bytes (100 KB) | 100,000 B | 100,332 B | −0.3 % |

Plain text compresses by about 40–56 %, depending on how skewed its character frequencies are. Random data can't be compressed, which is exactly what information theory predicts.

## Build and run (C++)

Requires `g++` (or `clang++`) with C++17 and `make`.

```bash
make                       # builds bin/huffman
make test                  # 12 test cases, 1,572 checks
make bench                 # compress + verify every file in samples/

./bin/huffman compress   samples/essay.txt essay.huf
./bin/huffman decompress essay.huf essay.out
./bin/huffman stats      samples/essay.txt --codes
```

`stats` prints the entropy, the average Huffman code length and (with `--codes`) every symbol's frequency and code.

## Web demo

```bash
cd web
npm install
npm run dev       # http://localhost:5173
npm test          # JS port tests, including byte-identical output vs the C++ CLI
```

## Project layout

```
include/
  min_heap.hpp      generic binary min-heap (priority queue)
  bit_io.hpp        BitWriter / BitReader: pack and unpack single bits
  huffman.hpp       Node, HuffmanTree, compress / decompress / analyze API
src/
  huffman.cpp       tree building, code generation, tree serialization, file format
  main.cpp          CLI: compress, decompress, stats; file I/O
tests/test_huffman.cpp
scripts/benchmark.sh
samples/            text files used for the benchmark
web/                React demo (JS port of the same algorithm and format)
docs/INTERVIEW_GUIDE.md
```

## `.huf` file format

| Bytes | Content |
| --- | --- |
| 0–3 | magic `HUF1` |
| 4–11 | original size in bytes (uint64, little-endian) |
| 12… | bit stream: pre-order Huffman tree, then the encoded symbols, then 0–7 zero padding bits |

See [`docs/INTERVIEW_GUIDE.md`](docs/INTERVIEW_GUIDE.md) for the full explanation.
