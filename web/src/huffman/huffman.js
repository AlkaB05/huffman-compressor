/**
 * JavaScript port of src/huffman.cpp, used by the web demo.
 * Same tie-breaking and the same .huf container format, so a file compressed
 * here decompresses with the C++ CLI (and vice versa) byte-for-byte.
 *
 *   bytes 0..3   magic "HUF1" (Huffman-coded) or "HUF0" (stored raw)
 *   bytes 4..11  original size, uint64 little-endian
 *   bytes 12..   HUF1: [pre-order tree bits][encoded symbols][zero padding]
 *                HUF0: the original bytes, unchanged
 */
import { BitReader, BitWriter } from './bitio.js';
import { MinHeap } from './MinHeap.js';

const MAGIC = [0x48, 0x55, 0x46, 0x31]; // "HUF1"
const MAGIC_STORED = [0x48, 0x55, 0x46, 0x30]; // "HUF0"
const HEADER = 12;

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

function header(magic, size) {
  const h = new Uint8Array(HEADER);
  h.set(magic, 0);
  new DataView(h.buffer).setBigUint64(4, BigInt(size), true);
  return h;
}

/** Huffman-coded container ("HUF1"), regardless of whether it is smaller. */
export function encodeHuffman(bytes) {
  const head = header(MAGIC, bytes.length);
  if (bytes.length === 0) return head;
  const tree = buildTree(countFrequencies(bytes));
  const codes = buildCodes(tree);
  const writer = new BitWriter(head);
  serializeTree(tree, writer);
  for (let k = 0; k < bytes.length; k++) writer.writeCode(codes[bytes[k]]);
  return writer.finish();
}

/**
 * Huffman-code the input, but fall back to storing the raw bytes ("HUF0")
 * when that would not be smaller (already-compressed or random data).
 * Worst-case growth is then the 12-byte header.
 */
export function compress(bytes) {
  const huff = encodeHuffman(bytes);
  if (bytes.length > 0 && huff.length >= HEADER + bytes.length) {
    const stored = new Uint8Array(HEADER + bytes.length);
    stored.set(header(MAGIC_STORED, bytes.length), 0);
    stored.set(bytes, HEADER);
    return stored;
  }
  return huff;
}

export function isStored(bytes) {
  return bytes.length >= HEADER && MAGIC_STORED.every((b, k) => bytes[k] === b);
}

export function isHuf(bytes) {
  return bytes.length >= HEADER && (MAGIC.every((b, k) => bytes[k] === b) || isStored(bytes));
}

export function decompress(packed) {
  if (!isHuf(packed)) throw new Error('not a .huf file: bad magic header');
  const size = Number(new DataView(packed.buffer, packed.byteOffset, packed.byteLength).getBigUint64(4, true));
  if (isStored(packed)) {
    if (packed.length - HEADER !== size) throw new Error('corrupt input: stored size mismatch');
    return packed.slice(HEADER);
  }
  if (size === 0) return new Uint8Array(0);

  const reader = new BitReader(packed, HEADER);
  const { nodes, root } = deserializeTree(reader);
  if (!isLeaf(nodes[root]) && size > (packed.length - HEADER) * 8) {
    throw new Error('corrupt input: size field larger than data');
  }
  const out = new Uint8Array(size);
  if (isLeaf(nodes[root])) return out.fill(nodes[root].symbol);

  for (let k = 0; k < size; k++) {
    let cur = root;
    while (!isLeaf(nodes[cur])) cur = reader.readBit() ? nodes[cur].right : nodes[cur].left;
    out[k] = nodes[cur].symbol;
  }
  return out;
}

/** Everything the UI needs about one input, computed in a single pass. */
export function analyze(bytes) {
  const freq = countFrequencies(bytes);
  const tree = buildTree(freq);
  const codes = buildCodes(tree);
  const t0 = performance.now();
  const packed = compress(bytes);
  const compressMs = performance.now() - t0;
  const t1 = performance.now();
  const restored = decompress(packed);
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
    huffmanBytes: stored ? encodeHuffman(bytes).length : packed.length,
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
