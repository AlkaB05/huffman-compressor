/** Binary min-heap. JavaScript port of include/min_heap.hpp. */
export class MinHeap {
  constructor(less) {
    this.data = [];
    this.less = less; // less(a, b) === true when a should be popped first
  }

  get size() {
    return this.data.length;
  }

  push(item) {
    const d = this.data;
    d.push(item);
    let i = d.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(d[i], d[parent])) break;
      [d[i], d[parent]] = [d[parent], d[i]];
      i = parent;
    }
  }

  pop() {
    const d = this.data;
    const top = d[0];
    const last = d.pop();
    if (d.length > 0) {
      d[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < d.length && this.less(d[l], d[s])) s = l;
        if (r < d.length && this.less(d[r], d[s])) s = r;
        if (s === i) break;
        [d[i], d[s]] = [d[s], d[i]];
        i = s;
      }
    }
    return top;
  }
}
