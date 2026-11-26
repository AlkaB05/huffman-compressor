import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { forestAt, layoutForest, symbolLabel, symbolName } from '../huffman/display.js';

const X_GAP = 34;
const Y_GAP = 58;
const PAD = 28;

export default function TreeView({ tree, step, setStep, selected, setSelected }) {
  const total = tree.merges.length;
  const [playing, setPlaying] = useState(false);
  const timer = useRef(0);

  useEffect(() => {
    if (!playing) return undefined;
    if (step >= total) {
      setPlaying(false);
      return undefined;
    }
    timer.current = window.setTimeout(() => setStep(step + 1), total > 40 ? 120 : 550);
    return () => window.clearTimeout(timer.current);
  }, [playing, step, total, setStep]);

  const roots = useMemo(() => forestAt(tree, step), [tree, step]);
  const layout = useMemo(() => layoutForest(tree.nodes, roots), [tree, roots]);
  const next = step < total ? tree.merges[step] : null;
  const justMade = step > 0 && step <= total ? tree.merges[step - 1].parent : -1;

  // Path from root to the selected symbol's leaf (only meaningful on the full tree).
  const highlight = useMemo(() => {
    const set = new Set();
    if (selected == null || step !== total) return set;
    const parent = new Map();
    tree.nodes.forEach((n, id) => {
      if (n.left !== -1) {
        parent.set(n.left, id);
        parent.set(n.right, id);
      }
    });
    let id = tree.nodes.findIndex((n) => n.left === -1 && n.symbol === selected);
    while (id !== undefined && id !== -1) {
      set.add(id);
      id = parent.get(id);
    }
    return set;
  }, [tree, selected, step, total]);

  const scrollRef = useRef(null);
  // Bring the traced leaf into view on wide trees (scrolls only the tree box, not the page).
  useEffect(() => {
    const box = scrollRef.current;
    const leaf = box?.querySelector('.node.leaf.lit');
    if (!box || !leaf) return;
    const b = box.getBoundingClientRect();
    const l = leaf.getBoundingClientRect();
    box.scrollTo({
      left: box.scrollLeft + (l.left - b.left) - b.width / 2,
      top: box.scrollTop + (l.top - b.top) - b.height / 2,
      behavior: 'smooth',
    });
  }, [highlight]);

  // New tree: centre the root horizontally.
  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
  }, [tree]);

  const showFreq = tree.leafCount <= 48;
  const width = layout.width * X_GAP + PAD * 2;
  const height = (layout.maxDepth + 1) * Y_GAP + PAD * 2 - 10;
  const px = (id) => PAD + layout.pos.get(id).x * X_GAP + X_GAP / 2;
  const py = (id) => PAD + layout.pos.get(id).depth * Y_GAP + 6;

  const edges = [];
  const nodes = [];
  for (const [id] of layout.pos) {
    const n = tree.nodes[id];
    const leaf = n.left === -1;
    const isNext = next && (id === next.a || id === next.b);
    const lit = highlight.has(id);
    if (!leaf) {
      for (const [child, bit] of [
        [n.left, '0'],
        [n.right, '1'],
      ]) {
        const on = lit && highlight.has(child);
        edges.push(
          <g key={`e${id}-${child}`} className={on ? 'edge lit' : 'edge'}>
            <line x1={px(id)} y1={py(id)} x2={px(child)} y2={py(child)} />
            <text x={(px(id) + px(child)) / 2 + (bit === '0' ? -7 : 7)} y={(py(id) + py(child)) / 2} className="edge-bit">
              {bit}
            </text>
          </g>,
        );
      }
    }
    const cls = ['node', leaf ? 'leaf' : 'internal', isNext && 'next', id === justMade && 'new', lit && 'lit']
      .filter(Boolean)
      .join(' ');
    nodes.push(
      <g
        key={`n${id}`}
        className={cls}
        transform={`translate(${px(id)} ${py(id)})`}
        onClick={leaf ? () => setSelected(n.symbol === selected ? null : n.symbol) : undefined}
      >
        <title>{leaf ? `${symbolName(n.symbol)}: ${n.freq}` : `merged weight ${n.freq}`}</title>
        {leaf ? <rect x={-13} y={-13} width={26} height={26} rx={6} /> : <circle r={leaf ? 13 : 9} />}
        {leaf && (
          <text className={symbolLabel(n.symbol).length > 1 ? 'node-label small' : 'node-label'} dy="0.35em">
            {symbolLabel(n.symbol)}
          </text>
        )}
        {(showFreq || !leaf) && (showFreq || isNext) && (
          <text className="node-freq" dy={leaf ? 27 : -14}>
            {n.freq}
          </text>
        )}
      </g>,
    );
  }

  return (
    <section className="card tree-card" aria-labelledby="tree-title">
      <header className="card-head wrap">
        <div>
          <h2 id="tree-title">Building the Huffman tree</h2>
          <p className="help">
            {step === 0
              ? 'Every symbol starts as a leaf in the min-heap, keyed by its count.'
              : step < total
                ? `Merge ${step} of ${total}: the two lowest-weight nodes become children of a new node.`
                : 'Done. Left edge = 0, right edge = 1. Click a leaf or a table row to trace its code.'}
          </p>
        </div>
        <div className="stepper" role="group" aria-label="Build steps">
          <button type="button" className="icon-btn" onClick={() => setStep(0)} disabled={step === 0} aria-label="First step">
            <ChevronsLeft size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setStep(step - 1)} disabled={step === 0} aria-label="Previous merge">
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-btn play"
            onClick={() => {
              if (step >= total) setStep(0);
              setPlaying(!playing);
            }}
            disabled={total === 0}
            aria-label={playing ? 'Pause' : 'Play merges'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button type="button" className="icon-btn" onClick={() => setStep(step + 1)} disabled={step >= total} aria-label="Next merge">
            <ChevronRight size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setStep(total)} disabled={step >= total} aria-label="Last step">
            <ChevronsRight size={16} />
          </button>
          <span className="mono dim step-count">
            {step}/{total}
          </span>
        </div>
      </header>

      <input
        className="step-slider"
        type="range"
        min="0"
        max={total}
        value={step}
        onChange={(e) => setStep(Number(e.target.value))}
        aria-label="Merge step"
      />

      <div className="heap-row" aria-label="Min-heap contents, in pop order">
        <span className="heap-title">Min-heap</span>
        <ol className="heap">
          {roots.slice(0, 24).map((id) => {
            const n = tree.nodes[id];
            const isNext = next && (id === next.a || id === next.b);
            return (
              <li key={id} className={isNext ? 'heap-item next' : 'heap-item'}>
                <span className="mono">{n.left === -1 ? symbolLabel(n.symbol) : '•'}</span>
                <span className="mono dim">{n.freq}</span>
              </li>
            );
          })}
          {roots.length > 24 && <li className="heap-more mono dim">+{roots.length - 24} more</li>}
        </ol>
      </div>

      <div className="tree-scroll" ref={scrollRef}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Huffman tree diagram">
          <g>{edges}</g>
          <g>{nodes}</g>
        </svg>
      </div>
    </section>
  );
}
