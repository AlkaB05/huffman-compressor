# Huffman File Compressor

A lossless file compression and decompression tool written **from scratch in C++17** using **Huffman coding**: a hand-written min-heap priority queue, a greedy Huffman tree, bit-level I/O and a self-describing `.huf` file format. No compression libraries.

It ships with a **web demo** (`web/`) that replays the tree construction merge by merge, shows the code table and the packed bit stream, and compresses or decompresses files in the browser. Its output is byte-for-byte identical to the C++ CLI.

## Results

Measured with `make bench` (every file is decompressed and compared byte-for-byte):

| File | Original | Compressed | Saved |
| --- | ---: | ---: | ---: |
| `essay.txt` (English prose) | 4,433 B | 2,524 B | **43.1 %** |
| `gpl-3.0.txt` (GNU GPL v3 licence text) | 35,149 B | 20,365 B | **42.1 %** |
| `sensor_log.csv` (numeric log) | 90,050 B | 39,745 B | **55.9 %** |
| `source_code.cpp.txt` (C++ source) | 8,823 B | 5,488 B | **37.8 %** |
| `students.csv` (mixed CSV) | 66,619 B | 42,831 B | **35.7 %** |
| random bytes (100 KB) | 100,000 B | 100,017 B | stored raw (+17 B header incl. name) |

Plain text compresses by about 40–56 %, depending on how skewed its character frequencies are. Random or already-compressed data (PDF, DOCX/ZIP, JPEG, MP4) can't be compressed, which is exactly what information theory predicts. In that case the tool **stores the raw bytes** instead, so a file never grows by more than its header (4–5 bytes + the file name).

Very short text (a sentence or two) can't shrink either: Huffman must store its tree (about 10 bits per distinct character) next to the data, and that costs as much as it saves. With the compact header a 25-byte sentence becomes 29 bytes; around 100+ characters of text starts saving space.

## Same-format compression (web demo)

A `.huf` file is only useful to this tool, so for uploaded **PDF, DOCX/XLSX/PPTX/ODT/EPUB/ZIP and PNG** files the web demo also produces a **smaller file in the same format** (`report.pdf` → `report-compressed.pdf`) that opens anywhere.

These formats already compress their content with DEFLATE, which is LZ77 followed by Huffman coding. The demo re-runs that step at maximum effort and drops dead weight, never touching what the file shows:

| Format | What it does |
| --- | --- |
| PDF | re-deflates every Flate stream at level 9, compresses streams stored uncompressed, removes unreferenced objects, packs objects into compressed object streams (pdf-lib) |
| DOCX / XLSX / PPTX / ODT / EPUB / ZIP | re-deflates every entry at maximum level and optimizes PNG images inside; `mimetype` stays first and stored |
| PNG | merges IDAT chunks, re-deflates pixel data at level 9, drops text/time metadata |

Everything is lossless and checked before download: PDFs are re-parsed, ZIP entries byte-compared, PNG pixel data byte-compared. If re-encoding doesn't make the file smaller, the original is kept. Measured on real files (pages rendered and compared pixel by pixel):

| File | Original | Same-format output | Saved |
| --- | ---: | ---: | ---: |
| interview-prep PDF (22 pages) | 591,134 B | 227,535 B | **61.5 %** |
| industry report PDF (31 pages) | 4,827,023 B | 4,023,279 B | **16.7 %** |
| lecture notes PDF (41 pages) | 931,581 B | 869,737 B | **6.6 %** |
| PPTX deck | 2,359,686 B | 2,232,518 B | **5.4 %** |
| DOCX (text only) | 64,569 B | 64,569 B | already optimal |

Plain-text files have no compression inside their format, so for them the `.huf` is the compressed form (40–56 % smaller).

## Build and run (C++)

Requires `g++` (or `clang++`) with C++17 and `make`.

```bash
make                       # builds bin/huffman
make test                  # 18 test cases, 1,603 checks
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
| 0–1 | magic `HF` |
| 2 | mode: `1` = Huffman-coded, `0` = stored raw (used when Huffman would not make the file smaller) |
| 3 | length of the original file name (0–255) |
| 4… | original file name (UTF-8, directories stripped; empty for text typed in the web demo) |
| next 1–10 | original size in bytes (unsigned LEB128 varint: 1 byte below 128, 2 below 16 KiB, 3 below 2 MiB) |
| payload | mode 1: pre-order Huffman tree, then the encoded symbols, then 0–7 zero padding bits. Mode 0: the original bytes |

The fixed overhead is 5 bytes for a short unnamed input (version 2 used 15). Older version-2 (`HUF2`, 15-byte header) and version-1 (`HUF1` / `HUF0`, 12-byte header, no name) files still decompress.

See [`docs/INTERVIEW_GUIDE.md`](docs/INTERVIEW_GUIDE.md) for the full explanation.
