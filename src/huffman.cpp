#include "huffman.hpp"

#include <cmath>
#include <cstring>
#include <stdexcept>
#include <utility>

#include "min_heap.hpp"

namespace huffman {

namespace {

// File layout:
//   bytes 0..3   magic "HUF1"
//   bytes 4..11  original size, uint64 little-endian
//   bytes 12..   bit stream = [serialized tree][encoded symbols][zero padding]
constexpr char kMagic[4] = {'H', 'U', 'F', '1'};
constexpr std::size_t kHeaderBytes = 12;

// A tree over at most 256 symbols has at most 2*256 - 1 nodes.
constexpr std::size_t kMaxNodes = 511;

/**
 * Entry stored in the priority queue. `order` breaks ties between equal
 * frequencies so the tree (and therefore the output) is deterministic.
 */
struct HeapItem {
    std::uint64_t freq;
    std::uint32_t order;
    int node;

    bool operator<(const HeapItem& other) const {
        if (freq != other.freq) return freq < other.freq;
        return order < other.order;
    }
};

void writeU64LE(Bytes& out, std::uint64_t v) {
    for (int k = 0; k < 8; ++k) out.push_back(static_cast<std::uint8_t>((v >> (8 * k)) & 0xFF));
}

std::uint64_t readU64LE(const Bytes& in, std::size_t pos) {
    std::uint64_t v = 0;
    for (int k = 0; k < 8; ++k) v |= static_cast<std::uint64_t>(in[pos + k]) << (8 * k);
    return v;
}

}  // namespace

FrequencyTable countFrequencies(const Bytes& data) {
    FrequencyTable freq{};
    for (std::uint8_t b : data) ++freq[b];
    return freq;
}

// ---------------------------------------------------------------------------
// Tree construction (greedy)
// ---------------------------------------------------------------------------
HuffmanTree HuffmanTree::build(const FrequencyTable& freq) {
    HuffmanTree tree;
    MinHeap<HeapItem> heap;
    std::uint32_t order = 0;

    // 1. One leaf per symbol that actually appears.
    for (int s = 0; s < 256; ++s) {
        if (freq[s] == 0) continue;
        Node leaf;
        leaf.freq = freq[s];
        leaf.symbol = static_cast<std::uint8_t>(s);
        tree.nodes_.push_back(leaf);
        heap.push({freq[s], order++, static_cast<int>(tree.nodes_.size() - 1)});
    }
    if (heap.empty()) return tree;  // empty input -> empty tree

    // 2. Greedy step: take the two least-frequent nodes and merge them under a
    //    new parent whose frequency is their sum. n leaves -> n - 1 merges.
    while (heap.size() > 1) {
        HeapItem a = heap.pop();
        HeapItem b = heap.pop();
        Node parent;
        parent.freq = a.freq + b.freq;
        parent.left = a.node;
        parent.right = b.node;
        tree.nodes_.push_back(parent);
        heap.push({parent.freq, order++, static_cast<int>(tree.nodes_.size() - 1)});
    }

    // 3. The last node standing is the root.
    tree.root_ = heap.pop().node;
    return tree;
}

// ---------------------------------------------------------------------------
// Code table
// ---------------------------------------------------------------------------
CodeTable HuffmanTree::buildCodes() const {
    CodeTable table{};
    if (empty()) return table;

    // Iterative DFS. Each entry carries the path bits taken to reach the node.
    struct Frame {
        int node;
        std::uint64_t bits;
        std::uint8_t length;
    };
    std::vector<Frame> stack{{root_, 0, 0}};
    while (!stack.empty()) {
        Frame f = stack.back();
        stack.pop_back();
        const Node& n = nodes_[f.node];
        if (n.isLeaf()) {
            // A single-symbol file has a root that is a leaf: its code is
            // empty (length 0) and decoding just repeats the symbol.
            table[n.symbol] = {f.bits, f.length};
            continue;
        }
        if (f.length >= 64) {
            // Only possible with Fibonacci-like frequencies on inputs larger
            // than ~10 TB; guarded so it can never silently corrupt output.
            throw std::runtime_error("Huffman code longer than 64 bits");
        }
        std::uint8_t len = static_cast<std::uint8_t>(f.length + 1);
        stack.push_back({n.right, (f.bits << 1) | 1u, len});  // right = append 1
        stack.push_back({n.left, (f.bits << 1), len});        // left  = append 0
    }
    return table;
}

// ---------------------------------------------------------------------------
// Tree serialization (stored in the compressed file so it can be decoded)
//   internal node -> bit 0, then left subtree, then right subtree
//   leaf          -> bit 1, then the 8-bit symbol
// Cost: (2n - 1) + 8n bits for n distinct symbols, e.g. ~110 bytes for text.
// ---------------------------------------------------------------------------
void HuffmanTree::serialize(BitWriter& out) const {
    if (empty()) return;
    std::vector<int> stack{root_};
    while (!stack.empty()) {
        int idx = stack.back();
        stack.pop_back();
        const Node& n = nodes_[idx];
        if (n.isLeaf()) {
            out.writeBit(1);
            out.writeBits(n.symbol, 8);
        } else {
            out.writeBit(0);
            stack.push_back(n.right);  // pushed first so left is written first
            stack.push_back(n.left);
        }
    }
}

HuffmanTree HuffmanTree::deserialize(BitReader& in) {
    HuffmanTree tree;
    tree.root_ = tree.readNode(in, 0);
    return tree;
}

int HuffmanTree::readNode(BitReader& in, int depth) {
    if (nodes_.size() >= kMaxNodes || depth > 255) throw std::runtime_error("corrupt input: invalid Huffman tree");
    int idx = static_cast<int>(nodes_.size());
    nodes_.push_back(Node{});
    if (in.readBit()) {
        nodes_[idx].symbol = static_cast<std::uint8_t>(in.readBits(8));
    } else {
        int left = readNode(in, depth + 1);  // nodes_ may reallocate: never hold a reference across calls
        int right = readNode(in, depth + 1);
        nodes_[idx].left = left;
        nodes_[idx].right = right;
    }
    return idx;
}

// ---------------------------------------------------------------------------
// Compress / decompress
// ---------------------------------------------------------------------------
Bytes compress(const Bytes& input) {
    Bytes out(kMagic, kMagic + 4);
    writeU64LE(out, input.size());
    if (input.empty()) return out;

    // Pass 1: frequencies -> tree -> codes.
    HuffmanTree tree = HuffmanTree::build(countFrequencies(input));
    CodeTable codes = tree.buildCodes();

    // Pass 2: write the tree, then each byte's code.
    BitWriter writer(out);
    tree.serialize(writer);
    for (std::uint8_t b : input) writer.writeBits(codes[b].bits, codes[b].length);
    writer.flush();
    return out;
}

Bytes decompress(const Bytes& compressed) {
    if (compressed.size() < kHeaderBytes || std::memcmp(compressed.data(), kMagic, 4) != 0) {
        throw std::runtime_error("not a Huffman (.huf) file: bad magic header");
    }
    const std::uint64_t originalSize = readU64LE(compressed, 4);
    Bytes out;
    if (originalSize == 0) return out;

    BitReader reader(compressed, kHeaderBytes);
    HuffmanTree tree = HuffmanTree::deserialize(reader);
    const auto& nodes = tree.nodes();
    const int root = tree.root();

    // Sanity bound: every symbol needs at least 1 bit (except the 1-symbol case).
    const std::uint64_t availableBits = (compressed.size() - kHeaderBytes) * 8ULL;
    if (!nodes[root].isLeaf() && originalSize > availableBits) {
        throw std::runtime_error("corrupt input: size field larger than data");
    }
    out.reserve(originalSize);

    if (nodes[root].isLeaf()) {  // only one distinct byte value in the file
        out.assign(originalSize, nodes[root].symbol);
        return out;
    }

    // Walk from the root: 0 -> left, 1 -> right, emit at a leaf, restart.
    // Prefix-free codes mean we never need a separator between symbols.
    for (std::uint64_t produced = 0; produced < originalSize; ++produced) {
        int cur = root;
        while (!nodes[cur].isLeaf()) cur = reader.readBit() ? nodes[cur].right : nodes[cur].left;
        out.push_back(nodes[cur].symbol);
    }
    return out;
}

Stats analyze(const Bytes& input) {
    Stats s;
    s.originalBytes = input.size();
    Bytes packed = compress(input);
    s.compressedBytes = packed.size();
    if (input.empty()) return s;

    FrequencyTable freq = countFrequencies(input);
    HuffmanTree tree = HuffmanTree::build(freq);
    CodeTable codes = tree.buildCodes();
    const double n = static_cast<double>(input.size());
    for (int sym = 0; sym < 256; ++sym) {
        if (freq[sym] == 0) continue;
        ++s.distinctSymbols;
        double p = freq[sym] / n;
        s.entropyBitsPerSymbol -= p * std::log2(p);
        s.payloadBits += freq[sym] * codes[sym].length;
    }
    s.avgCodeLength = s.payloadBits / n;
    s.savingsPercent = (1.0 - static_cast<double>(s.compressedBytes) / n) * 100.0;
    return s;
}

}  // namespace huffman
