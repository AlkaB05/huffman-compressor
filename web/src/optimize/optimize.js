/**
 * Same-format compression: returns a smaller file of the SAME type (report.pdf
 * stays a working report.pdf), unlike the .huf container.
 *
 * Every format here already stores its content with DEFLATE (LZ77 + Huffman
 * coding), so the savings come from re-encoding that content harder and
 * dropping dead weight, never from changing what the file shows:
 *
 *   PDF            re-deflate every stream at level 9, Flate-encode streams that
 *                  were stored uncompressed, drop objects nothing points to,
 *                  pack small objects into compressed object streams
 *   DOCX/XLSX/...  (ZIP containers) re-deflate every entry at level 9 and
 *                  optimize PNG images stored inside
 *   PNG            merge IDAT chunks and re-deflate the pixel data at level 9,
 *                  drop text/time metadata chunks
 *
 * Everything is lossless: the result is checked (pages re-parsed, ZIP entries
 * byte-compared, PNG pixel data byte-compared) before it is offered, and the
 * original is kept when re-encoding does not make it smaller.
 */
import { deflateSync, unzipSync, unzlibSync, zipSync, zlibSync } from 'fflate';

const ZIP_TYPES = ['docx', 'xlsx', 'pptx', 'docm', 'xlsm', 'pptm', 'odt', 'ods', 'odp', 'epub', 'zip', 'jar', 'apk', 'vsdx', 'xps'];
const LEVEL = { level: 9 };

export const extensionOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();

const isPdf = (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04; // PK\3\4
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b) => b.length > 8 && PNG_SIG.every((v, k) => b[k] === v);

/** Which optimizer (if any) handles this file. Detected from the bytes, not just the name. */
export function formatOf(bytes, fileName = '') {
  if (isPdf(bytes)) return 'pdf';
  if (isPng(bytes)) return 'png';
  if (isZip(bytes)) return ZIP_TYPES.includes(extensionOf(fileName)) ? extensionOf(fileName) : 'zip';
  return null;
}

const equalBytes = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);

/**
 * @returns {Promise<{ format, bytes, originalBytes, optimizedBytes, smaller, method, steps }>}
 * `smaller` is false when the file is already as small as this tool can make it;
 * `bytes` is then the original file.
 */
export async function optimize(bytes, fileName = '') {
  const format = formatOf(bytes, fileName);
  if (!format) throw new Error('unsupported format');
  let result;
  if (format === 'pdf') result = await optimizePdf(bytes);
  else if (format === 'png') result = optimizePng(bytes);
  else result = optimizeZip(bytes);

  const smaller = result.bytes.length < bytes.length;
  return {
    format,
    bytes: smaller ? result.bytes : bytes,
    originalBytes: bytes.length,
    optimizedBytes: smaller ? result.bytes.length : bytes.length,
    smaller,
    method: result.method,
    steps: result.steps,
  };
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let k = 0; k < bytes.length; k++) c = crcTable[(c ^ bytes[k]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readChunks(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = [];
  let pos = 8;
  while (pos + 12 <= png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    if (pos + 12 + len > png.length) throw new Error('truncated PNG');
    chunks.push({ type, data: png.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function writeChunk(out, type, data) {
  const head = new Uint8Array(8);
  const view = new DataView(head.buffer);
  view.setUint32(0, data.length);
  for (let k = 0; k < 4; k++) head[4 + k] = type.charCodeAt(k);
  const typed = new Uint8Array(4 + data.length);
  typed.set(head.subarray(4), 0);
  typed.set(data, 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(typed));
  out.push(head, data, crc);
}

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
};

// Metadata chunks that do not affect how the image looks.
const DROPPABLE_PNG = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME']);

export function optimizePng(png) {
  const chunks = readChunks(png);
  const idat = concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const pixels = unzlibSync(idat);
  const recompressed = zlibSync(pixels, LEVEL);
  const better = recompressed.length < idat.length ? recompressed : idat;

  const out = [Uint8Array.from(PNG_SIG)];
  let wroteIdat = false;
  let dropped = 0;
  for (const c of chunks) {
    if (DROPPABLE_PNG.has(c.type)) {
      dropped++;
      continue;
    }
    if (c.type === 'IDAT') {
      if (!wroteIdat) writeChunk(out, 'IDAT', better);
      wroteIdat = true;
      continue;
    }
    writeChunk(out, c.type, c.data);
  }
  const result = concat(out);
  // Lossless check: same decoded pixel data, same header.
  const check = readChunks(result);
  if (!equalBytes(unzlibSync(check.find((c) => c.type === 'IDAT').data), pixels)) throw new Error('PNG verification failed');

  const steps = [`Re-deflated pixel data at level 9 (${idat.length} → ${better.length} B)`];
  if (dropped) steps.push(`Removed ${dropped} text/time metadata chunk${dropped > 1 ? 's' : ''}`);
  return { bytes: result, method: 'Lossless PNG re-encode', steps };
}

// ---------------------------------------------------------------------------
// ZIP containers (DOCX, XLSX, PPTX, ODT, EPUB, ZIP ...)
// ---------------------------------------------------------------------------
export function optimizeZip(zip) {
  const entries = unzipSync(zip);
  const files = {};
  let pngs = 0;
  let pngSaved = 0;
  for (const [name, original] of Object.entries(entries)) {
    let data = original;
    if (/\.png$/i.test(name) && isPng(data)) {
      try {
        const png = optimizePng(data).bytes;
        if (png.length < data.length) {
          pngSaved += data.length - png.length;
          pngs++;
          data = png;
        }
      } catch {
        // Unusual PNG: keep it unchanged.
      }
    }
    // ODF/EPUB require "mimetype" first and uncompressed; anything DEFLATE cannot shrink is stored.
    const store = name === 'mimetype' || deflateSync(data, LEVEL).length >= data.length;
    files[name] = [data, store ? { level: 0 } : LEVEL];
  }
  const result = zipSync(files, { mtime: new Date('2000-01-01T00:00:00Z') });

  // Verify: same entry list in the same order, and every non-PNG entry byte-identical.
  const check = unzipSync(result);
  const names = Object.keys(entries);
  if (!equalBytes(Object.keys(check).map((n) => names.indexOf(n)), names.map((_, k) => k))) throw new Error('ZIP verification failed');
  for (const name of names) {
    if (!equalBytes(check[name], files[name][0])) throw new Error('ZIP verification failed');
  }

  const steps = [`Re-deflated ${names.length} entries at maximum level`];
  if (pngs) steps.push(`Losslessly optimized ${pngs} PNG image${pngs > 1 ? 's' : ''} inside (−${pngSaved} B)`);
  return { bytes: result, method: 'Repacked with maximum DEFLATE', steps };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
async function optimizePdf(pdf) {
  const { PDFDocument, PDFName, PDFRawStream, PDFRef, PDFDict, PDFArray } = await import('pdf-lib');
  let doc;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(e.message)) throw new Error('password-protected PDFs cannot be re-encoded');
    throw new Error('could not parse this PDF');
  }
  const pageCount = doc.getPageCount();
  const ctx = doc.context;
  const FLATE = PDFName.of('FlateDecode');
  const FILTER = PDFName.of('Filter');

  // 1. Drop objects that nothing references (left behind by edits and incremental saves).
  const reachable = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean);
  while (stack.length) {
    let obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (reachable.has(obj.tag)) continue;
      reachable.add(obj.tag);
      obj = ctx.lookup(obj);
    }
    if (!obj) continue;
    if (obj instanceof PDFRawStream) obj = obj.dict;
    if (obj instanceof PDFDict) for (const v of obj.values()) stack.push(v);
    else if (obj instanceof PDFArray) for (const v of obj.asArray()) stack.push(v);
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reachable.has(ref.tag)) {
      ctx.delete(ref);
      removed++;
    }
  }

  // 2. Re-deflate Flate streams at level 9; Flate-encode streams stored raw.
  let recompressed = 0;
  let encoded = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const filter = obj.dict.get(FILTER);
    const type = obj.dict.get(PDFName.of('Type'));
    if (type === PDFName.of('XRef') || type === PDFName.of('ObjStm')) continue;
    const onlyFlate = filter === FLATE || (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === FLATE);
    try {
      if (onlyFlate) {
        const better = zlibSync(unzlibSync(obj.contents), LEVEL);
        if (better.length < obj.contents.length) {
          ctx.assign(ref, PDFRawStream.of(obj.dict, better));
          recompressed++;
        }
      } else if (!filter && obj.contents.length > 32) {
        const packed = zlibSync(obj.contents, LEVEL);
        if (packed.length < obj.contents.length) {
          const dict = obj.dict.clone(ctx);
          dict.set(FILTER, FLATE);
          ctx.assign(ref, PDFRawStream.of(dict, packed));
          encoded++;
        }
      }
    } catch {
      // Damaged or non-standard stream: leave it exactly as it was.
    }
  }

  // 3. Write with compressed object streams (packs the many small dictionaries).
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });

  // Verify the result still parses with the same number of pages.
  const check = await PDFDocument.load(bytes, { updateMetadata: false });
  if (check.getPageCount() !== pageCount) throw new Error('PDF verification failed');

  const steps = [];
  if (recompressed) steps.push(`Re-deflated ${recompressed} compressed stream${recompressed > 1 ? 's' : ''} at level 9`);
  if (encoded) steps.push(`Compressed ${encoded} stream${encoded > 1 ? 's that were' : ' that was'} stored uncompressed`);
  if (removed) steps.push(`Removed ${removed} unused object${removed > 1 ? 's' : ''}`);
  steps.push('Packed objects into compressed object streams');
  return { bytes, method: 'Lossless PDF re-encode', steps };
}

