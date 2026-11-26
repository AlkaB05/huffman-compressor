// Runs the same-format optimizer off the main thread so big PDFs don't freeze the page.
import { optimize } from './optimize.js';

self.onmessage = async ({ data: { id, bytes, name } }) => {
  try {
    const result = await optimize(bytes, name);
    self.postMessage({ id, ok: true, result }, [result.bytes.buffer]);
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.message });
  }
};
