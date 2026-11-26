import { strToU8, unzipSync, unzlibSync, zipSync, zlibSync } from 'fflate';
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { formatOf, optimize, optimizePng } from '../src/optimize/optimize.js';

const text = 'The quick brown fox jumps over the lazy dog. '.repeat(400);

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 64x64 grey gradient PNG with poorly compressed (stored) pixel data and a text chunk. */
function makePng() {
  const w = 64;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, w);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const raw = new Uint8Array(w * (w + 1));
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x * 4) & 255;
  const idat = zlibSync(raw, { level: 0 });
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', strToU8('Comment\0made by a test')),
    chunk('IDAT', idat.subarray(0, 100)),
    chunk('IDAT', idat.subarray(100)),
    chunk('IEND', new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) png.set(p, (pos += p.length) - p.length);
  return { png, raw };
}

describe('same-format compression', () => {
  it('detects formats from the bytes', () => {
    expect(formatOf(strToU8('%PDF-1.7'), 'x.bin')).toBe('pdf');
    expect(formatOf(zipSync({ a: strToU8('a') }), 'report.docx')).toBe('docx');
    expect(formatOf(zipSync({ a: strToU8('a') }), 'archive')).toBe('zip');
    expect(formatOf(strToU8('plain text'), 'notes.txt')).toBe(null);
  });

  it('repacks a ZIP/DOCX smaller with identical entries in the same order', async () => {
    const entries = { mimetype: strToU8('application/x-test'), '[Content_Types].xml': strToU8(text), 'word/document.xml': strToU8(text + text) };
    const weak = zipSync(Object.fromEntries(Object.entries(entries).map(([k, d]) => [k, [d, { level: 1 }]])));
    const r = await optimize(weak, 'report.docx');
    expect(r.smaller).toBe(true);
    expect(r.optimizedBytes).toBeLessThan(weak.length);
    const back = unzipSync(r.bytes);
    expect(Object.keys(back)).toEqual(Object.keys(entries));
    for (const k of Object.keys(entries)) expect(back[k]).toEqual(entries[k]);
  });

  it('keeps the original when it cannot be made smaller', async () => {
    let seed = 42;
    const random = Uint8Array.from({ length: 4000 }, () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed >>> 24;
    });
    const stored = zipSync({ 'a.bin': [random, { level: 0 }] });
    const r = await optimize(stored, 'a.zip');
    expect(r.smaller).toBe(false);
    expect(r.bytes).toBe(stored);
  });

  it('re-encodes a PNG losslessly and drops text metadata', () => {
    const { png, raw } = makePng();
    const r = optimizePng(png);
    expect(r.bytes.length).toBeLessThan(png.length);
    const s = new TextDecoder('latin1').decode(r.bytes);
    expect(s.includes('tEXt')).toBe(false);
    const start = s.indexOf('IDAT') + 4;
    const len = new DataView(r.bytes.buffer).getUint32(start - 8);
    expect(unzlibSync(r.bytes.subarray(start, start + len))).toEqual(raw);
  });

  it('shrinks a PDF without changing its pages', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    // An uncompressed content stream and an orphaned object, as some PDF writers leave them.
    const contents = doc.context.register(doc.context.stream(`BT /F1 1 Tf ET\n% ${text}`));
    page.node.set(PDFName.of('Contents'), contents);
    doc.context.register(doc.context.stream(text));
    const original = await doc.save({ useObjectStreams: false });

    const r = await optimize(original, 'doc.pdf');
    expect(r.smaller).toBe(true);
    expect(r.optimizedBytes).toBeLessThan(original.length / 2);
    const back = await PDFDocument.load(r.bytes);
    expect(back.getPageCount()).toBe(1);
    expect(back.getPage(0).getSize()).toEqual({ width: 300, height: 300 });
  });
});
