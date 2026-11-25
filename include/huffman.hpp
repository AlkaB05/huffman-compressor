#pragma once

#include <array>
#include <cstdint>
#include <vector>

#include "bit_io.hpp"

namespace huffman {

using FrequencyTable = std::array<std::uint64_t, 256>;

/**
 * One node of the Huffman tree. Nodes live in a std::vector "pool" and refer
 * to their children by index, so there are no raw pointers to leak or free.
 */
struct Node {
    std::uint64_t freq = 0;
    int left = -1;   // child for bit 0 (-1 = none)
    int right = -1;  // child for bit 1 (-1 = none)
    std::uint8_t symbol = 0;  // only meaningful for leaves

    bool isLeaf() const { return left == -1 && right == -1; }
};

/** A prefix code: the lowest `length` bits of `bits`, read MSB first. */
struct Code {
    std::uint64_t bits = 0;
    std::uint8_t length = 0;
};

using CodeTable = std::array<Code, 256>;

class HuffmanTree {
public:
    /** Greedy construction with a min-heap: repeatedly merge the two rarest nodes. */
    static HuffmanTree build(const FrequencyTable& freq);

    /** Pre-order bit encoding of the tree shape + leaf symbols (stored in the file header). */
    void serialize(BitWriter& out) const;
    static HuffmanTree deserialize(BitReader& in);

    /** Walk root -> leaves: going left appends 0, going right appends 1. */
    CodeTable buildCodes() const;

    bool empty() const { return root_ == -1; }
    int root() const { return root_; }
    const std::vector<Node>& nodes() const { return nodes_; }

private:
    int readNode(BitReader& in, int depth);

    std::vector<Node> nodes_;
    int root_ = -1;
};

FrequencyTable countFrequencies(const Bytes& data);

/** Compress raw bytes into the .huf container format (see docs/INTERVIEW_GUIDE.md). */
Bytes compress(const Bytes& input);

/** Exact inverse of compress(). Throws std::runtime_error on corrupt input. */
Bytes decompress(const Bytes& compressed);

struct Stats {
    std::uint64_t originalBytes = 0;
    std::uint64_t compressedBytes = 0;
    std::uint64_t payloadBits = 0;     // encoded data only (no header / tree)
    unsigned distinctSymbols = 0;
    double entropyBitsPerSymbol = 0;   // Shannon lower bound
    double avgCodeLength = 0;          // what Huffman actually achieves
    double savingsPercent = 0;         // (1 - compressed / original) * 100
};

Stats analyze(const Bytes& input);

}  // namespace huffman
