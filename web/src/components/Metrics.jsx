import { formatBytes } from '../huffman/display.js';

export default function Metrics({ a }) {
  const headerBits = 96;
  const padBits = Math.max(0, a.compressedBytes * 8 - headerBits - a.treeBits - a.payloadBits);
  const totalBits = Math.max(1, a.compressedBytes * 8);
  const parts = a.stored
    ? [
        ['Header', headerBits, 'seg-header'],
        ['Raw bytes (stored)', a.originalBytes * 8, 'seg-pad'],
      ]
    : [
        ['Header', headerBits, 'seg-header'],
        ['Tree', a.treeBits, 'seg-tree'],
        ['Data', a.payloadBits, 'seg-data'],
        ['Padding', padBits, 'seg-pad'],
      ];

  return (
    <section className="section" aria-label="Compression results">
      <dl className="kpis">
        <Kpi label="Original" value={formatBytes(a.originalBytes)} sub={`${a.originalBytes * 8} bits`} />
        <Kpi label="Compressed" value={formatBytes(a.compressedBytes)} sub={`${a.compressMs.toFixed(1)} ms to encode`} />
        <Kpi
          label="Space saved"
          value={a.stored ? 'Stored raw' : `${a.savedPercent.toFixed(1)}%`}
          sub={a.stored ? '+12 B header only' : `${a.rows.length} distinct symbols`}
          tone={a.stored ? undefined : a.savedPercent > 0 ? 'good' : 'bad'}
        />
        <Kpi
          label="Round trip"
          value={a.verified ? 'Lossless' : 'Mismatch'}
          sub={`${a.decompressMs.toFixed(1)} ms to decode`}
          tone={a.verified ? 'ok' : 'bad'}
        />
      </dl>

      <div className="split">
        <div className="sub">
          <h3 className="sub-title">Bits per symbol</h3>
          <Bar label="Fixed width" value={8} tone="muted" />
          <Bar label="Huffman average" value={a.avgBits} tone="accent" />
          <Bar label="Entropy floor" value={a.entropy} tone="ghost" />
        </div>
        <div className="sub">
          <h3 className="sub-title">
            File layout <span className="mono faint">{a.compressedBytes * 8} bits</span>
          </h3>
          <div className="stack" role="img" aria-label={parts.map(([l, b]) => `${l} ${b} bits`).join(', ')}>
            {parts.map(([label, bits, cls]) =>
              bits > 0 ? <div key={label} className={`stack-seg ${cls}`} style={{ flexGrow: bits / totalBits }} title={`${label}: ${bits} bits`} /> : null,
            )}
          </div>
          <ul className="stack-legend">
            {parts.map(([label, bits, cls]) => (
              <li key={label}>
                <span className={`swatch ${cls}`} aria-hidden="true" />
                {label}
                <span className="mono faint">{bits}</span>
              </li>
            ))}
          </ul>
          {a.stored && (
            <p className="note insight">
              <strong>Stored, not Huffman-coded.</strong> Huffman would have produced {formatBytes(a.huffmanBytes)} (bigger than the
              input), so the file keeps the raw bytes and only adds the 12-byte header. Zip and gzip do the same.
              {a.entropy > 7 &&
                ` This data is already close to random (${a.entropy.toFixed(2)} of 8 bits of entropy per byte): PDFs, DOCX/ZIP, images and videos are compressed internally, so there is little left to squeeze. Try a plain-text file to see 40%+ savings.`}
              {a.entropy <= 7 && ' For tiny inputs the header and stored tree cost more than Huffman saves.'}
            </p>
          )}
          {!a.stored && a.savedPercent <= 0 && (
            <p className="note">
              Tiny inputs grow: the 12-byte header and the stored tree cost more than Huffman saves. Storing the raw bytes would be
              even bigger here ({formatBytes(a.originalBytes + 12)}), so Huffman is still the better choice.
            </p>
          )}
          {!a.stored && a.entropy > 7 && a.originalBytes >= 1024 && (
            <p className="note insight">
              This data is already close to random ({a.entropy.toFixed(2)} of 8 bits of entropy per byte). PDFs, images, ZIPs and
              videos are compressed internally, so every byte value appears about equally often and Huffman has little to work
              with. Try a plain-text file to see 40%+ savings.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={tone ? `kpi ${tone}` : 'kpi'}>
      <dt>{label}</dt>
      <dd>
        <span className="kpi-value">{value}</span>
        <span className="kpi-sub mono">{sub}</span>
      </dd>
    </div>
  );
}

function Bar({ label, value, tone }) {
  return (
    <div className="bar">
      <span className="bar-label">{label}</span>
      <div className="bar-track" aria-hidden="true">
        <div className={`bar-fill ${tone}`} style={{ width: `${Math.min(100, (value / 8) * 100)}%` }} />
      </div>
      <span className="bar-value mono">{value.toFixed(2)}</span>
    </div>
  );
}
