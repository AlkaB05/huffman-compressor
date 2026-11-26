/**
 * JavaScript port of src/huffman.cpp, used by the web demo.
 * Same tie-breaking and the same .huf container format, so a file compressed
 * here decompresses with the C++ CLI (and vice versa) byte-for-byte.
 *
 * Version 2 layout:
 *   bytes 0..3    magic "HUF2"
 *   byte  4       mode: 1 = Huffman-coded, 0 = stored (raw bytes)
 *   bytes 5..12   original size, uint64 little-endian
 *   bytes 13..14  file-name length, uint16 little-endian
 *   bytes 15..    original file name (UTF-8), then the payload
 * Version 1 files ("HUF1" / "HUF0", 12-byte header, no name) still decode.
 */
import { BitReader, BitWriter } from './bitio.js';
import { MinHeap } from './MinHeap.js';

const MAGIC_V2 = [0x48, 0x55, 0x46, 0x32]; // "HUF2"
const MAGIC_V1 = [0x48, 0x55, 0x46, 0x31]; // "HUF1" (legacy Huffman)
const MAGIC_V1_STORED = [0x48, 0x55, 0x46, 0x30]; // "HUF0" (legacy stored)
const MODE_STORED = 0;
const MODE_HUFFMAN = 1;
const FIXED_HEADER_V2 = 15;
const HEADER_V1 = 12;
const MAX_NAME_BYTES = 255;

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();
const startsWith = (bytes, magic) => bytes.length >= 4 && magic.every((b, k) => bytes[k] === b);

export function countFrequencies(bytes) {
  const freq = new Array(256).fill(0);
  for (let k = 0; k < bytes.length; k++) freq[bytes[k]]++;
  return freq;
}

/**
 * Greedy Huffman construction. Besides the tree it records every merge so the
 * UI can replay the algorithm step by step.
 * nodes[i] = { freq, symbol, left, right }  (left/right = -1 for leaves)
 */
export function buildTree(freq) {
  const nodes = [];
  const less = (a, b) => (a.freq !== b.freq ? a.freq < b.freq : a.order < b.order);
  const heap = new MinHeap(less);
  let order = 0;

  for (let s = 0; s < 256; s++) {
    if (!freq[s]) continue;
    nodes.push({ freq: freq[s], symbol: s, left: -1, right: -1 });
    heap.push({ freq: freq[s], order: order++, node: nodes.length - 1 });
  }
  if (heap.size === 0) return { nodes, root: -1, merges: [], leafCount: 0 };

  const leafCount = nodes.length;
  const merges = [];
  while (heap.size > 1) {
    const a = heap.pop();
    const b = heap.pop();
    nodes.push({ freq: a.freq + b.freq, symbol: -1, left: a.node, right: b.node });
    const id = nodes.length - 1;
    heap.push({ freq: a.freq + b.freq, order: order++, node: id });
    merges.push({ a: a.node, b: b.node, parent: id });
  }
  return { nodes, root: heap.pop().node, merges, leafCount };
}

export const isLeaf = (n) => n.left === -1 && n.right === -1;

/** codes[symbol] = '0101...' (string of bits), '' for the single-symbol case. */
export function buildCodes(tree) {
  const codes = new Array(256).fill(null);
  if (tree.root === -1) return codes;
  const stack = [[tree.root, '']];
  while (stack.length) {
    const [id, code] = stack.pop();
    const n = tree.nodes[id];
    if (isLeaf(n)) {
      codes[n.symbol] = code;
      continue;
    }
    stack.push([n.right, code + '1']);
    stack.push([n.left, code + '0']);
  }
  return codes;
}

function serializeTree(tree, writer) {
  const stack = [tree.root];
  while (stack.length) {
    const n = tree.nodes[stack.pop()];
    if (isLeaf(n)) {
      writer.writeBit(1);
      writer.writeBits(n.symbol, 8);
    } else {
      writer.writeBit(0);
      stack.push(n.right, n.left);
    }
  }
}

function deserializeTree(reader) {
  const nodes = [];
  const read = (depth) => {
    if (nodes.length >= 511 || depth > 255) throw new Error('corrupt input: invalid Huffman tree');
    const id = nodes.length;
    nodes.push({ freq: 0, symbol: -1, left: -1, right: -1 });
    if (reader.readBit()) {
      nodes[id].symbol = reader.readBits(8);
    } else {
      const left = read(depth + 1);
      const right = read(depth + 1);
      nodes[id].left = left;
      nodes[id].right = right;
    }
    return id;
  };
  return { nodes, root: read(0) };
}

/**
 * Same rules as sanitizeFileName() in the C++ code, applied to UTF-8 bytes so
 * both produce identical headers: keep the last path component, drop control
 * characters, reject "." and "..", cap at 255 bytes.
 */
export function sanitizeFileNameBytes(raw) {
  let start = 0;
  for (let k = 0; k < raw.length; k++) if (raw[k] === 0x2f || raw[k] === 0x5c) start = k + 1;
  const kept = [];
  for (let k = start; k < raw.length; k++) if (raw[k] >= 0x20 && raw[k] !== 0x7f) kept.push(raw[k]);
  const isDots = (kept.length === 1 && kept[0] === 0x2e) || (kept.length === 2 && kept[0] === 0x2e && kept[1] === 0x2e);
  return Uint8Array.from(isDots ? [] : kept.slice(0, MAX_NAME_BYTES));
}

function header(mode, size, nameBytes) {
  const h = new Uint8Array(FIXED_HEADER_V2 + nameBytes.length);
  h.set(MAGIC_V2, 0);
  h[4] = mode;
  const view = new DataView(h.buffer);
  view.setBigUint64(5, BigInt(size), true);
  view.setUint16(13, nameBytes.length, true);
  h.set(nameBytes, FIXED_HEADER_V2);
  return h;
}

/** Huffman-coded container (mode 1), regardless of whether it is smaller. */
export function encodeHuffman(bytes, fileName = '') {
  const head = header(MODE_HUFFMAN, bytes.length, sanitizeFileNameBytes(utf8.encode(fileName)));
  if (bytes.length === 0) return head;
  const tree = buildTree(countFrequencies(bytes));
  const codes = buildCodes(tree);
  const writer = new BitWriter(head);
  serializeTree(tree, writer);
  for (let k = 0; k < bytes.length; k++) writer.writeCode(codes[bytes[k]]);
  return writer.finish();
}

/**
 * Huffman-code the input, but fall back to storing the raw bytes (mode 0)
 * when that would not be smaller (already-compressed or random data).
 * `fileName` is stored so the file can be restored with its original name.
 */
export function compress(bytes, fileName = '') {
  const nameBytes = sanitizeFileNameBytes(utf8.encode(fileName));
  const huff = encodeHuffman(bytes, fileName);
  const headerSize = FIXED_HEADER_V2 + nameBytes.length;
  if (bytes.length > 0 && huff.length - headerSize >= bytes.length) {
    const stored = new Uint8Array(headerSize + bytes.length);
    stored.set(header(MODE_STORED, bytes.length, nameBytes), 0);
    stored.set(bytes, headerSize);
    return stored;
  }
  return huff;
}

function parseHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (startsWith(bytes, MAGIC_V2)) {
    if (bytes.length < FIXED_HEADER_V2) throw new Error('corrupt input: truncated header');
    const mode = bytes[4];
    if (mode !== MODE_STORED && mode !== MODE_HUFFMAN) throw new Error('corrupt input: unknown mode');
    const nameLen = view.getUint16(13, true);
    if (nameLen > MAX_NAME_BYTES || FIXED_HEADER_V2 + nameLen > bytes.length) {
      throw new Error('corrupt input: bad file name length');
    }
    const nameBytes = sanitizeFileNameBytes(bytes.subarray(FIXED_HEADER_V2, FIXED_HEADER_V2 + nameLen));
    return {
      huffman: mode === MODE_HUFFMAN,
      size: Number(view.getBigUint64(5, true)),
      fileName: utf8Decoder.decode(nameBytes),
      dataStart: FIXED_HEADER_V2 + nameLen,
    };
  }
  if (bytes.length >= HEADER_V1 && (startsWith(bytes, MAGIC_V1) || startsWith(bytes, MAGIC_V1_STORED))) {
    return { huffman: bytes[3] === 0x31, size: Number(view.getBigUint64(4, true)), fileName: '', dataStart: HEADER_V1 };
  }
  throw new Error('not a .huf file: bad magic header');
}

export function isHuf(bytes) {
  return startsWith(bytes, MAGIC_V2) || (bytes.length >= HEADER_V1 && (startsWith(bytes, MAGIC_V1) || startsWith(bytes, MAGIC_V1_STORED)));
}

export function isStored(bytes) {
  try {
    return !parseHeader(bytes).huffman;
  } catch {
    return false;
  }
}

/** Header size in bytes (fixed part + stored name). */
export function headerSize(bytes) {
  return parseHeader(bytes).dataStart;
}

/** Inverse of compress(): returns { fileName, bytes, stored }. */
export function decode(packed) {
  const h = parseHeader(packed);
  if (!h.huffman) {
    if (packed.length - h.dataStart !== h.size) throw new Error('corrupt input: stored size mismatch');
    return { fileName: h.fileName, bytes: packed.slice(h.dataStart), stored: true };
  }
  const result = { fileName: h.fileName, bytes: new Uint8Array(h.size), stored: false };
  if (h.size === 0) return result;

  const reader = new BitReader(packed, h.dataStart);
  const { nodes, root } = deserializeTree(reader);
  if (!isLeaf(nodes[root]) && h.size > (packed.length - h.dataStart) * 8) {
    throw new Error('corrupt input: size field larger than data');
  }
  const out = result.bytes;
  if (isLeaf(nodes[root])) {
    out.fill(nodes[root].symbol);
    return result;
  }
  for (let k = 0; k < h.size; k++) {
    let cur = root;
    while (!isLeaf(nodes[cur])) cur = reader.readBit() ? nodes[cur].right : nodes[cur].left;
    out[k] = nodes[cur].symbol;
  }
  return result;
}

export function decompress(packed) {
  return decode(packed).bytes;
}

/** Everything the UI needs about one input, computed in a single pass. */
export function analyze(bytes, fileName = '') {
  const freq = countFrequencies(bytes);
  const tree = buildTree(freq);
  const codes = buildCodes(tree);
  const t0 = performance.now();
  const packed = compress(bytes, fileName);
  const compressMs = performance.now() - t0;
  const t1 = performance.now();
  const restoredFile = decode(packed);
  const restored = restoredFile.bytes;
  const decompressMs = performance.now() - t1;
  const verified = restored.length === bytes.length && restored.every((b, k) => b === bytes[k]);

  const n = bytes.length;
  let entropy = 0;
  let payloadBits = 0;
  const rows = [];
  for (let s = 0; s < 256; s++) {
    if (!freq[s]) continue;
    const p = freq[s] / n;
    entropy -= p * Math.log2(p);
    payloadBits += freq[s] * codes[s].length;
    rows.push({ symbol: s, count: freq[s], code: codes[s], bits: freq[s] * codes[s].length });
  }
  const treeBits = rows.length ? 2 * rows.length - 1 + 8 * rows.length : 0;
  const stored = isStored(packed);
  return {
    stored,
    huffmanBytes: stored ? encodeHuffman(bytes, fileName).length : packed.length,
    headerBytes: headerSize(packed),
    storedName: restoredFile.fileName,
    restored,
    freq,
    tree,
    codes,
    rows,
    packed,
    verified,
    compressMs,
    decompressMs,
    originalBytes: n,
    compressedBytes: packed.length,
    entropy,
    avgBits: n ? payloadBits / n : 0,
    payloadBits,
    treeBits,
    savedPercent: n ? (1 - packed.length / n) * 100 : 0,
  };
}
