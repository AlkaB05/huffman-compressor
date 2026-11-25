#pragma once

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace huffman {

using Bytes = std::vector<std::uint8_t>;

/**
 * Packs individual bits into bytes, most-significant bit first.
 *
 * Example: writing bits 1,0,1 then flush() produces the byte 1010'0000.
 * The last byte is padded with zero bits; the decoder knows how many symbols
 * to read (original size is in the header), so it never reads the padding.
 */
class BitWriter {
public:
    explicit BitWriter(Bytes& out) : out_(out) {}

    void writeBit(bool bit) {
        buffer_ = static_cast<std::uint8_t>((buffer_ << 1) | (bit ? 1u : 0u));
        if (++count_ == 8) {
            out_.push_back(buffer_);
            buffer_ = 0;
            count_ = 0;
        }
    }

    /** Write the lowest `n` bits of `bits`, highest of those first. */
    void writeBits(std::uint64_t bits, unsigned n) {
        for (unsigned k = n; k-- > 0;) writeBit((bits >> k) & 1u);
    }

    /** Pad the final partial byte with zeros and emit it. */
    void flush() {
        if (count_ > 0) {
            out_.push_back(static_cast<std::uint8_t>(buffer_ << (8 - count_)));
            buffer_ = 0;
            count_ = 0;
        }
    }

private:
    Bytes& out_;
    std::uint8_t buffer_ = 0;  // bits collected so far for the current byte
    unsigned count_ = 0;       // how many bits are in buffer_ (0..7)
};

/** Reads bits back out of a byte buffer, most-significant bit first. */
class BitReader {
public:
    BitReader(const Bytes& in, std::size_t startByte) : in_(in), pos_(startByte) {}

    bool readBit() {
        if (count_ == 0) {
            if (pos_ >= in_.size()) throw std::runtime_error("corrupt input: unexpected end of bit stream");
            buffer_ = in_[pos_++];
            count_ = 8;
        }
        --count_;
        return (buffer_ >> count_) & 1u;  // mask out one bit
    }

    std::uint64_t readBits(unsigned n) {
        std::uint64_t value = 0;
        for (unsigned k = 0; k < n; ++k) value = (value << 1) | (readBit() ? 1u : 0u);
        return value;
    }

private:
    const Bytes& in_;
    std::size_t pos_;
    std::uint8_t buffer_ = 0;
    unsigned count_ = 0;  // unread bits left in buffer_
};

}  // namespace huffman
