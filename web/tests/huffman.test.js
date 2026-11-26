import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { forestAt } from '../src/huffman/display.js';
import { analyze, buildCodes, buildTree, compress, decode, decompress, isStored, sanitizeFileNameBytes } from '../src/huffman/huffman.js';

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

  it('forestAt tolerates a step larger than the tree (switching to a smaller input)', () => {
    const small = analyze(enc('abracadabra')).tree; // 4 merges
    expect(() => forestAt(small, 31)).not.toThrow();
    expect(forestAt(small, 31)).toEqual([small.root]);
  });

  it('falls back to stored mode when Huffman would not help', () => {
    const random = Uint8Array.from({ length: 50000 }, (_, k) => (k * 2654435761) >>> 24 ^ (k * 40503) & 255);
    const packed = compress(random);
    expect(isStored(packed)).toBe(true);
    expect(packed.length).toBe(random.length + 15);
    expect(decompress(packed)).toEqual(random);
    expect(isStored(compress(enc('abracadabra')))).toBe(false); // 21 B Huffman < 23 B stored
    expect(isStored(compress(enc('abc')))).toBe(true);
  });

  it('stores the original file name and restores it', () => {
    const input = enc('some report text, some report text, some report text');
    const out = decode(compress(input, 'Quarterly Report.pdf'));
    expect(out.fileName).toBe('Quarterly Report.pdf');
    expect(out.bytes).toEqual(input);
    expect(decode(compress(enc('abc'), 'tiny.docx'))).toMatchObject({ fileName: 'tiny.docx', stored: true });
    expect(decode(compress(enc('hello hello'), 'naïve résumé.txt')).fileName).toBe('naïve résumé.txt');
  });

  it('strips directories and control characters from names', () => {
    const name = (s) => new TextDecoder().decode(sanitizeFileNameBytes(enc(s)));
    expect(name('../../etc/passwd')).toBe('passwd');
    expect(name('C:\\Users\\me\\notes.docx')).toBe('notes.docx');
    expect(name('..')).toBe('');
    expect(name('bad\nname.txt')).toBe('badname.txt');
  });

  it('still reads version-1 files without a name', () => {
    const v0 = Uint8Array.from([0x48, 0x55, 0x46, 0x30, 3, 0, 0, 0, 0, 0, 0, 0, 120, 121, 122]);
    expect(decode(v0)).toMatchObject({ fileName: '', stored: true });
    expect(decompress(v0)).toEqual(enc('xyz'));
  });

  const cli = join(root, 'bin', 'huffman');
  it.runIf(existsSync(cli))('produces byte-identical output to the C++ CLI', () => {
    const samples = join(root, 'samples');
    for (const name of readdirSync(samples)) {
      const input = new Uint8Array(readFileSync(join(samples, name)));
      const out = join('/tmp', `cmp-${process.pid}-${name}.huf`);
      execFileSync(cli, ['compress', join(samples, name), out]);
      expect(Buffer.from(compress(input, name)).equals(readFileSync(out))).toBe(true);
    }
  });

  it.runIf(existsSync(cli))('matches the C++ CLI in stored mode too', () => {
    const input = Buffer.from(Array.from({ length: 30000 }, (_, k) => ((k * 2654435761) >>> 13) & 255));
    const src = join('/tmp', `cmp-${process.pid}-rand.bin`);
    writeFileSync(src, input);
    execFileSync(cli, ['compress', src, `${src}.huf`]);
    const fromCli = readFileSync(`${src}.huf`);
    expect(Buffer.from(compress(new Uint8Array(input), `cmp-${process.pid}-rand.bin`)).equals(fromCli)).toBe(true);
    expect(isStored(new Uint8Array(fromCli))).toBe(true);
  });
});
