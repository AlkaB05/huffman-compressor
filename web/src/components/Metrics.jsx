import { formatBytes } from '../huffman/display.js';

export default function Metrics({ a }) {
  const headerBits = 96;
  const padBits = Math.max(0, a.compressedBytes * 8 - headerBits - a.treeBits - a.payloadBits);
  const totalBits = Math.max(1, a.compressedBytes * 8);
  const parts = [
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
          value={`${a.savedPercent.toFixed(1)}%`}
          sub={`${a.rows.length} distinct symbols`}
          tone={a.savedPercent > 0 ? 'good' : 'bad'}
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
          {a.savedPercent <= 0 && (
            <p className="note">Tiny inputs grow: the 12-byte header and the stored tree cost more than the bits Huffman saves.</p>
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
