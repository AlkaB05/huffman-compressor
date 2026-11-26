import { symbolLabel } from '../huffman/display.js';

const PREVIEW_SYMBOLS = 60;
const PREVIEW_BYTES = 48;

export default function BitStream({ bytes, codes, packed, selected }) {
  const symbols = Array.from(bytes.slice(0, PREVIEW_SYMBOLS));
  const hex = Array.from(packed.slice(0, PREVIEW_BYTES), (b) => b.toString(16).padStart(2, '0'));
  return (
    <section className="card stream-card" aria-labelledby="stream-title">
      <header className="card-head">
        <h2 id="stream-title">Encoded bit stream</h2>
        <span className="mono dim">first {Math.min(PREVIEW_SYMBOLS, bytes.length)} symbols</span>
      </header>
      <p className="help">Each symbol is replaced by its code and the codes are packed back-to-back, 8 bits per byte. No separators are needed because no code is a prefix of another.</p>
      <div className="tokens">
        {symbols.map((s, k) => (
          <span key={k} className={s === selected ? 'token selected' : k % 2 ? 'token odd' : 'token'}>
            <span className="token-sym mono">{symbolLabel(s)}</span>
            <span className="token-code mono">{codes[s] || '∅'}</span>
          </span>
        ))}
        {bytes.length > PREVIEW_SYMBOLS && <span className="token more mono">…</span>}
      </div>
      <div className="hex">
        <span className="hex-label">.huf bytes</span>
        <code className="mono">
          <span className="hex-magic">{hex.slice(0, 4).join(' ')}</span> <span className="hex-size">{hex.slice(4, 12).join(' ')}</span>{' '}
          {hex.slice(12).join(' ')}
          {packed.length > PREVIEW_BYTES ? ' …' : ''}
        </code>
        <span className="help">
          <span className="hex-magic">magic “{String.fromCharCode(...packed.slice(0, 4))}”</span> · <span className="hex-size">original size (uint64 LE)</span> ·{' '}
          {packed[3] === 0x30 ? 'raw bytes (stored)' : 'tree + data bits'}
        </span>
      </div>
    </section>
  );
}
