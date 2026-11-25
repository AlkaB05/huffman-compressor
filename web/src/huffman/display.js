/** Human-readable label for a byte value. */
export function symbolLabel(s) {
  if (s === 32) return 'SP';
  if (s === 10) return 'LF';
  if (s === 13) return 'CR';
  if (s === 9) return 'TAB';
  if (s > 32 && s < 127) return String.fromCharCode(s);
  return s.toString(16).toUpperCase().padStart(2, '0');
}

export function symbolName(s) {
  if (s === 32) return 'space';
  if (s === 10) return 'newline';
  if (s === 13) return 'carriage return';
  if (s === 9) return 'tab';
  if (s > 32 && s < 127) return `"${String.fromCharCode(s)}"`;
  return `byte 0x${s.toString(16).toUpperCase().padStart(2, '0')}`;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Lay out a forest of (sub)trees for SVG. Leaves get consecutive x slots
 * (in-order), each parent sits centred above its two children.
 */
export function layoutForest(nodes, roots) {
  const pos = new Map();
  let x = 0;
  let maxDepth = 0;
  const place = (id, depth) => {
    const n = nodes[id];
    maxDepth = Math.max(maxDepth, depth);
    if (n.left === -1) {
      pos.set(id, { x: x++, depth });
      return;
    }
    place(n.left, depth + 1);
    place(n.right, depth + 1);
    pos.set(id, { x: (pos.get(n.left).x + pos.get(n.right).x) / 2, depth });
  };
  roots.forEach((r, k) => {
    if (k > 0) x += 0.5; // gap between separate trees in the forest
    place(r, 0);
  });
  return { pos, width: Math.max(1, x), maxDepth };
}

/** Roots of the forest after `step` merges, in the order the heap would pop them. */
export function forestAt(tree, step) {
  const alive = new Set();
  for (let i = 0; i < tree.leafCount; i++) alive.add(i);
  for (let k = 0; k < step; k++) {
    const m = tree.merges[k];
    alive.delete(m.a);
    alive.delete(m.b);
    alive.add(m.parent);
  }
  // Matches the heap order: frequency, then creation order (leaves first by symbol).
  return [...alive].sort((p, q) => tree.nodes[p].freq - tree.nodes[q].freq || p - q);
}
