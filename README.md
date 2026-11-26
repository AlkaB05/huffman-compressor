# Huffman File Compressor

A lossless file compression and decompression tool written **from scratch in C++17** using **Huffman coding**: a hand-written min-heap priority queue, a greedy Huffman tree, bit-level I/O and a self-describing `.huf` file format. No compression libraries.

It ships with a **web demo** (`web/`) that replays the tree construction merge by merge, shows the code table and the packed bit stream, and compresses or decompresses files in the browser. Its output is byte-for-byte identical to the C++ CLI.

## Results

Measured with `make bench` (every file is decompressed and compared byte-for-byte):

| File | Original | Compressed | Saved |
| --- | ---: | ---: | ---: |
| `essay.txt` (English prose) | 4,433 B | 2,533 B | **42.9 %** |
| `gpl-3.0.txt` (GNU GPL v3 licence text) | 35,149 B | 20,373 B | **42.0 %** |
| `sensor_log.csv` (numeric log) | 90,050 B | 39,753 B | **55.9 %** |
| `source_code.cpp.txt` (C++ source) | 8,823 B | 5,497 B | **37.7 %** |
| `students.csv` (mixed CSV) | 66,619 B | 42,839 B | **35.7 %** |
| random bytes (100 KB) | 100,000 B | 100,025 B | stored raw (+25 B header incl. name) |

Plain text compresses by about 40–56 %, depending on how skewed its character frequencies are. Random or already-compressed data (PDF, DOCX/ZIP, JPEG, MP4) can't be compressed, which is exactly what information theory predicts. In that case the tool **stores the raw bytes** instead, so a file never grows by more than its header (15 bytes + the file name).

## Build and run (C++)

Requires `g++` (or `clang++`) with C++17 and `make`.

```bash
make                       # builds bin/huffman
make test                  # 17 test cases, 1,597 checks
make bench                 # compress + verify every file in samples/

./bin/huffman compress   samples/essay.txt out.huf   # output path optional (default: essay.txt.huf)
./bin/huffman decompress out.huf                     # restores "essay.txt" next to out.huf
./bin/huffman decompress out.huf copy.txt            # or choose the output path
./bin/huffman stats      samples/essay.txt --codes
```

The original file name is stored inside the `.huf`, so a file always comes back with its own name and extension (`report.pdf` → `anything.huf` → `report.pdf`), even if the `.huf` was renamed. Default output paths never overwrite an existing file.

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
| 0–3 | magic `HUF2` |
| 4 | mode: `1` = Huffman-coded, `0` = stored raw (used when Huffman would not make the file smaller) |
| 5–12 | original size in bytes (uint64, little-endian) |
| 13–14 | length of the original file name (uint16, little-endian, ≤ 255) |
| 15… | original file name (UTF-8, directories stripped), then the payload |
| payload | mode 1: pre-order Huffman tree, then the encoded symbols, then 0–7 zero padding bits. Mode 0: the original bytes |

Older version-1 files (`HUF1` / `HUF0`, 12-byte header, no name) still decompress.

See [`docs/INTERVIEW_GUIDE.md`](docs/INTERVIEW_GUIDE.md) for the full explanation.
