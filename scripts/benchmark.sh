#!/usr/bin/env bash
# Compresses every file in samples/, checks the round trip byte-for-byte,
# and prints the size reduction for each one.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=./bin/huffman
[ -x "$BIN" ] || make -s bin/huffman
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Random bytes: shows Huffman cannot shrink data with no skew in frequencies.
head -c 100000 /dev/urandom > "$TMP/random.bin"

printf "%-24s %12s %12s %9s %10s\n" "file" "original" "compressed" "saved" "roundtrip"
for f in samples/* "$TMP/random.bin"; do
  name=$(basename "$f")
  "$BIN" compress "$f" "$TMP/$name.huf" > /dev/null
  "$BIN" decompress "$TMP/$name.huf" "$TMP/$name.out" > /dev/null
  if cmp -s "$f" "$TMP/$name.out"; then ok="OK"; else ok="MISMATCH"; fi
  o=$(stat -c %s "$f"); c=$(stat -c %s "$TMP/$name.huf")
  pct=$(awk -v o="$o" -v c="$c" 'BEGIN { printf "%.1f%%", (1 - c / o) * 100 }')
  printf "%-24s %12s %12s %9s %10s\n" "$name" "$o" "$c" "$pct" "$ok"
done
