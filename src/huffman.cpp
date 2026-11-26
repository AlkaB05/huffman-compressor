#include "huffman.hpp"

#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>
#include <utility>

#include "min_heap.hpp"

namespace huffman {

std::string sanitizeFileName(const std::string& raw);

namespace {

// File layout (version 2):
//   bytes 0..3    magic "HUF2"
//   byte  4       mode: 1 = Huffman-coded, 0 = stored (raw bytes)
//   bytes 5..12   original size, uint64 little-endian
//   bytes 13..14  length of the original file name, uint16 little-endian
//   bytes 15..    original file name (UTF-8, no directories), then the payload:
//                   mode 1: bit stream = [serialized tree][encoded symbols][zero padding]
//                   mode 0: the original bytes, unchanged
// Version 1 files ("HUF1" Huffman / "HUF0" stored, 12-byte header, no name)
// are still read so older .huf files keep working.
constexpr char kMagicV2[4] = {'H', 'U', 'F', '2'};
constexpr char kMagicV1Huffman[4] = {'H', 'U', 'F', '1'};
constexpr char kMagicV1Stored[4] = {'H', 'U', 'F', '0'};
constexpr std::uint8_t kModeStored = 0;
constexpr std::uint8_t kModeHuffman = 1;
constexpr std::size_t kFixedHeaderV2 = 15;
constexpr std::size_t kHeaderV1 = 12;
constexpr std::size_t kMaxNameBytes = 255;

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

struct Header {
    bool huffman;
    std::uint64_t size;
    std::string name;
    std::size_t dataStart;  // first byte of the payload
};

Bytes makeHeader(std::uint8_t mode, std::uint64_t size, const std::string& name) {
    Bytes h(kMagicV2, kMagicV2 + 4);
    h.push_back(mode);
    writeU64LE(h, size);
    h.push_back(static_cast<std::uint8_t>(name.size() & 0xFF));
    h.push_back(static_cast<std::uint8_t>(name.size() >> 8));
    h.insert(h.end(), name.begin(), name.end());
    return h;
}

Header parseHeader(const Bytes& in) {
    if (in.size() >= 4 && std::memcmp(in.data(), kMagicV2, 4) == 0) {
        if (in.size() < kFixedHeaderV2) throw std::runtime_error("corrupt input: truncated header");
        const std::uint8_t mode = in[4];
        if (mode != kModeStored && mode != kModeHuffman) throw std::runtime_error("corrupt input: unknown mode");
        const std::size_t nameLen = in[13] | (static_cast<std::size_t>(in[14]) << 8);
        if (nameLen > kMaxNameBytes || kFixedHeaderV2 + nameLen > in.size()) {
            throw std::runtime_error("corrupt input: bad file name length");
        }
        std::string name(in.begin() + kFixedHeaderV2, in.begin() + kFixedHeaderV2 + nameLen);
        return {mode == kModeHuffman, readU64LE(in, 5), sanitizeFileName(name), kFixedHeaderV2 + nameLen};
    }
    if (in.size() >= kHeaderV1 && (std::memcmp(in.data(), kMagicV1Huffman, 4) == 0 ||
                                   std::memcmp(in.data(), kMagicV1Stored, 4) == 0)) {
        return {in[3] == '1', readU64LE(in, 4), "", kHeaderV1};
    }
    throw std::runtime_error("not a Huffman (.huf) file: bad magic header");
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
std::string sanitizeFileName(const std::string& raw) {
    // Keep only the last path component so a crafted .huf file can never
    // make the decompressor write outside the chosen folder ("../../x").
    std::string name = raw.substr(raw.find_last_of("/\\") == std::string::npos ? 0 : raw.find_last_of("/\\") + 1);
    std::string clean;
    for (char c : name)
        if (static_cast<unsigned char>(c) >= 0x20 && c != 0x7F) clean += c;  // drop control characters
    if (clean == "." || clean == "..") clean.clear();
    if (clean.size() > kMaxNameBytes) clean.resize(kMaxNameBytes);
    return clean;
}

Bytes compress(const Bytes& input, const std::string& fileName) {
    const std::string name = sanitizeFileName(fileName);
    Bytes out = makeHeader(kModeHuffman, input.size(), name);
    if (input.empty()) return out;
    const std::size_t headerSize = out.size();

    // Pass 1: frequencies -> tree -> codes.
    HuffmanTree tree = HuffmanTree::build(countFrequencies(input));
    CodeTable codes = tree.buildCodes();

    // Pass 2: write the tree, then each byte's code.
    BitWriter writer(out);
    tree.serialize(writer);
    for (std::uint8_t b : input) writer.writeBits(codes[b].bits, codes[b].length);
    writer.flush();

    // Stored fallback: if Huffman did not make the payload smaller (already
    // compressed or random input), keep the raw bytes instead. Worst-case
    // growth is then just the header -- the same idea as DEFLATE's "stored"
    // blocks and ZIP's "store" method.
    if (out.size() - headerSize >= input.size()) {
        Bytes stored = makeHeader(kModeStored, input.size(), name);
        stored.insert(stored.end(), input.begin(), input.end());
        return stored;
    }
    return out;
}

bool isStored(const Bytes& compressed) {
    try {
        return !parseHeader(compressed).huffman;
    } catch (const std::runtime_error&) {
        return false;
    }
}

Decoded decode(const Bytes& compressed) {
    const Header h = parseHeader(compressed);
    Decoded result{h.name, {}, !h.huffman};
    const std::uint64_t originalSize = h.size;

    if (!h.huffman) {
        if (compressed.size() - h.dataStart != originalSize) throw std::runtime_error("corrupt input: stored size mismatch");
        result.data.assign(compressed.begin() + h.dataStart, compressed.end());
        return result;
    }
    if (originalSize == 0) return result;

    BitReader reader(compressed, h.dataStart);
    HuffmanTree tree = HuffmanTree::deserialize(reader);
    const auto& nodes = tree.nodes();
    const int root = tree.root();

    // Sanity bound: every symbol needs at least 1 bit (except the 1-symbol case).
    const std::uint64_t availableBits = (compressed.size() - h.dataStart) * 8ULL;
    if (!nodes[root].isLeaf() && originalSize > availableBits) {
        throw std::runtime_error("corrupt input: size field larger than data");
    }
    Bytes& out = result.data;
    out.reserve(originalSize);

    if (nodes[root].isLeaf()) {  // only one distinct byte value in the file
        out.assign(originalSize, nodes[root].symbol);
        return result;
    }

    // Walk from the root: 0 -> left, 1 -> right, emit at a leaf, restart.
    // Prefix-free codes mean we never need a separator between symbols.
    for (std::uint64_t produced = 0; produced < originalSize; ++produced) {
        int cur = root;
        while (!nodes[cur].isLeaf()) cur = reader.readBit() ? nodes[cur].right : nodes[cur].left;
        out.push_back(nodes[cur].symbol);
    }
    return result;
}

Bytes decompress(const Bytes& compressed) { return decode(compressed).data; }

Stats analyze(const Bytes& input) {
    Stats s;
    s.originalBytes = input.size();
    Bytes packed = compress(input);
    s.compressedBytes = packed.size();
    s.stored = isStored(packed);
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
