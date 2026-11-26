import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { formatBytes } from '../huffman/display.js';

/** Result of compressing the file in its own format (PDF stays PDF, DOCX stays DOCX). */
export default function SameFormat({ state, ext }) {
  const label = ext.toUpperCase();
  if (state.status === 'working') {
    return (
      <section className="section same-format" aria-live="polite">
        <span className="section-label">Compressed {label}</span>
        <p className="same-working">
          <LoaderCircle size={15} className="spin" aria-hidden="true" /> Re-encoding the {label} and checking it is identical…
        </p>
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className="section same-format">
        <span className="section-label">Compressed {label}</span>
        <p className="note">Could not re-encode this file ({state.error}). The .huf download below still works.</p>
      </section>
    );
  }
  if (state.status !== 'done') return null;

  const r = state.result;
  const saved = (1 - r.optimizedBytes / r.originalBytes) * 100;
  return (
    <section className="section same-format" aria-label={`Compressed ${label}`}>
      <span className="section-label">
        Compressed {label} <span className="mono faint">{r.method}</span>
      </span>
      <dl className="kpis">
        <Kpi label="Original" value={formatBytes(r.originalBytes)} sub={`.${ext}`} />
        <Kpi label="Compressed" value={formatBytes(r.optimizedBytes)} sub={`still a .${ext}`} />
        <Kpi label="Space saved" value={r.smaller ? `${saved.toFixed(1)}%` : '0%'} sub={r.smaller ? `−${formatBytes(r.originalBytes - r.optimizedBytes)}` : 'already optimal'} tone={r.smaller ? 'good' : undefined} />
        <Kpi label="Content" value="Identical" sub="lossless, verified" tone="ok" />
      </dl>
      {r.smaller ? (
        <ul className="same-steps">
          {r.steps.map((s) => (
            <li key={s}>
              <CheckCircle2 size={13} aria-hidden="true" /> {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">This {label} is already packed as tightly as lossless re-encoding allows, so the original is the smallest version.</p>
      )}
      <p className="note insight">
        {label} files already compress their content with DEFLATE, which is LZ77 followed by Huffman coding (the algorithm below). To keep
        the file a working .{ext}, this re-runs that DEFLATE step at maximum effort instead of wrapping the file in a .huf. The Huffman
        analysis below shows why: the bytes are already near-random, so a second Huffman pass alone gains little.
      </p>
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
