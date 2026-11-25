import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, buildCodes, buildTree, compress, decompress } from '../src/huffman/huffman.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const enc = (s) => new TextEncoder().encode(s);

describe('JS Huffman port', () => {
  it('round-trips edge cases', () => {
    for (const input of [enc(''), enc('a'), enc('aaaaaaa'), enc('abracadabra'), Uint8Array.from({ length: 1024 }, (_, k) => k % 256)]) {
      expect(decompress(compress(input))).toEqual(input);
    }
  });

  it('CLRS example costs 224 bits', () => {
    const freq = new Array(256).fill(0);
    Object.entries({ a: 45, b: 13, c: 12, d: 16, e: 9, f: 5 }).forEach(([ch, f]) => (freq[ch.charCodeAt(0)] = f));
    const codes = buildCodes(buildTree(freq));
    const bits = freq.reduce((sum, f, s) => sum + (f ? f * codes[s].length : 0), 0);
    expect(bits).toBe(224);
  });

  it('records n - 1 merges for n symbols', () => {
    const a = analyze(enc('hello huffman'));
    expect(a.tree.merges.length).toBe(a.rows.length - 1);
    expect(a.verified).toBe(true);
  });

  const cli = join(root, 'bin', 'huffman');
  it.runIf(existsSync(cli))('produces byte-identical output to the C++ CLI', () => {
    const samples = join(root, 'samples');
    for (const name of readdirSync(samples)) {
      const input = new Uint8Array(readFileSync(join(samples, name)));
      const out = join('/tmp', `cmp-${process.pid}-${name}.huf`);
      execFileSync(cli, ['compress', join(samples, name), out]);
      expect(Buffer.from(compress(input)).equals(readFileSync(out))).toBe(true);
    }
  });
});
