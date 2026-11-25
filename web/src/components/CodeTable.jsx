import { ArrowDownUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { symbolLabel, symbolName } from '../huffman/display.js';

const SORTS = {
  count: (a, b) => b.count - a.count || a.symbol - b.symbol,
  symbol: (a, b) => a.symbol - b.symbol,
  length: (a, b) => a.code.length - b.code.length || b.count - a.count,
};

export default function CodeTable({ rows, total, selected, setSelected }) {
  const [sort, setSort] = useState('count');
  const sorted = useMemo(() => [...rows].sort(SORTS[sort]), [rows, sort]);

  const Th = ({ id, children, className }) => (
    <th className={className} aria-sort={sort === id ? 'descending' : 'none'}>
      <button type="button" className={sort === id ? 'th-btn active' : 'th-btn'} onClick={() => setSort(id)}>
        {children}
        <ArrowDownUp size={11} aria-hidden="true" />
      </button>
    </th>
  );

  return (
    <section className="card table-card" aria-labelledby="codes-title">
      <header className="card-head">
        <h2 id="codes-title">Code table</h2>
        <span className="mono dim">{rows.length} symbols</span>
      </header>
      <div className="table-scroll">
        <table className="codes">
          <thead>
            <tr>
              <Th id="symbol">Symbol</Th>
              <Th id="count" className="num">Count</Th>
              <Th id="length">Code</Th>
              <th className="num">Bits</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.symbol}
                className={r.symbol === selected ? 'selected' : ''}
                onClick={() => setSelected(r.symbol === selected ? null : r.symbol)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(r.symbol === selected ? null : r.symbol);
                  }
                }}
                tabIndex={0}
                aria-selected={r.symbol === selected}
              >
                <td>
                  <span className="sym mono" title={symbolName(r.symbol)}>
                    {symbolLabel(r.symbol)}
                  </span>
                </td>
                <td className="num mono">
                  {r.count}
                  <span className="pct">{((r.count / total) * 100).toFixed(1)}%</span>
                </td>
                <td className="mono code-cell">{r.code || '(none)'}</td>
                <td className="num mono">{r.bits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
