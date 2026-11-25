/** MSB-first bit writer. Port of BitWriter in include/bit_io.hpp. */
export class BitWriter {
  constructor(initialBytes = []) {
    this.bytes = [...initialBytes];
    this.buffer = 0;
    this.count = 0;
  }

  writeBit(bit) {
    this.buffer = ((this.buffer << 1) | bit) & 0xff;
    if (++this.count === 8) {
      this.bytes.push(this.buffer);
      this.buffer = 0;
      this.count = 0;
    }
  }

  /** Write a code given as a string of '0'/'1' characters. */
  writeCode(code) {
    for (let k = 0; k < code.length; k++) this.writeBit(code.charCodeAt(k) - 48);
  }

  writeBits(value, n) {
    for (let k = n - 1; k >= 0; k--) this.writeBit((value >> k) & 1);
  }

  finish() {
    if (this.count > 0) this.bytes.push((this.buffer << (8 - this.count)) & 0xff);
    this.buffer = 0;
    this.count = 0;
    return Uint8Array.from(this.bytes);
  }
}

export class BitReader {
  constructor(bytes, startByte) {
    this.bytes = bytes;
    this.pos = startByte;
    this.buffer = 0;
    this.count = 0;
  }

  readBit() {
    if (this.count === 0) {
      if (this.pos >= this.bytes.length) throw new Error('corrupt input: unexpected end of bit stream');
      this.buffer = this.bytes[this.pos++];
      this.count = 8;
    }
    this.count--;
    return (this.buffer >> this.count) & 1;
  }

  readBits(n) {
    let v = 0;
    for (let k = 0; k < n; k++) v = (v << 1) | this.readBit();
    return v;
  }
}
