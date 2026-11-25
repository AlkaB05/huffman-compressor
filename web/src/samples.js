function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = seeded(3);
const dna = Array.from({ length: 1600 }, () => 'ACGT'[Math.floor(rng() * 4)]).join('').replace(/(.{80})/g, '$1\n');

const logs = Array.from({ length: 40 }, (_, k) => {
  const level = ['INFO', 'INFO', 'INFO', 'WARN', 'ERROR'][k % 5];
  return `2026-11-25 10:${String(k % 60).padStart(2, '0')}:00 ${level} request served path=/api/items status=${level === 'ERROR' ? 500 : 200}`;
}).join('\n');

export const SAMPLES = [
  {
    key: 'prose',
    label: 'English prose',
    text: `Huffman coding is a lossless data compression algorithm. The idea is to assign variable-length codes to input characters, where the lengths of the assigned codes are based on the frequencies of the corresponding characters. The most frequent character gets the smallest code and the least frequent character gets the largest code. The codes are prefix codes, which means that no code is the prefix of the code assigned to any other character. This is how Huffman coding makes sure that there is no ambiguity when decoding the generated bit stream. There are mainly two major parts in Huffman coding: first build a Huffman tree from the input characters, then traverse the tree and assign codes to the characters.`,
  },
  { key: 'abra', label: 'abracadabra', text: 'abracadabra' },
  { key: 'dna', label: 'DNA (4 letters)', text: dna },
  { key: 'logs', label: 'Server logs', text: logs },
];
