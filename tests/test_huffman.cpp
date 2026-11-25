// Minimal self-contained test runner (no external framework needed).
#include <cstdio>
#include <functional>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

#include "huffman.hpp"
#include "min_heap.hpp"

using namespace huffman;

static int g_failed = 0;
static int g_checks = 0;

#define CHECK(cond)                                                                \
    do {                                                                           \
        ++g_checks;                                                                \
        if (!(cond)) {                                                             \
            ++g_failed;                                                            \
            std::printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);          \
        }                                                                          \
    } while (0)

static Bytes fromString(const std::string& s) { return Bytes(s.begin(), s.end()); }

static void roundTrip(const Bytes& input) {
    Bytes packed = compress(input);
    Bytes restored = decompress(packed);
    CHECK(restored == input);
}

static void test(const char* name, const std::function<void()>& fn) {
    int before = g_failed;
    try {
        fn();
    } catch (const std::exception& e) {
        ++g_failed;
        std::printf("  EXCEPTION %s\n", e.what());
    }
    std::printf("%s %s\n", g_failed == before ? "[ OK ]" : "[FAIL]", name);
}

int main() {
    test("min-heap pops in sorted order", [] {
        MinHeap<int> h;
        std::mt19937 rng(7);
        std::vector<int> v(1000);
        for (int& x : v) x = static_cast<int>(rng() % 10000);
        for (int x : v) h.push(x);
        int prev = -1;
        while (!h.empty()) {
            int x = h.pop();
            CHECK(x >= prev);
            prev = x;
        }
    });

    test("empty input", [] {
        Bytes packed = compress({});
        CHECK(packed.size() == 12);  // header only
        CHECK(decompress(packed).empty());
    });

    test("single byte and single repeated symbol", [] {
        roundTrip(fromString("a"));
        roundTrip(Bytes(100000, 'z'));
        // 1 distinct symbol: tree = 1 leaf (9 bits -> 2 bytes) and no payload.
        CHECK(compress(Bytes(100000, 'z')).size() == 12 + 2);
    });

    test("two symbols get 1-bit codes", [] {
        Bytes in = fromString("abababababbbbbaaaa");
        auto codes = HuffmanTree::build(countFrequencies(in)).buildCodes();
        CHECK(codes['a'].length == 1);
        CHECK(codes['b'].length == 1);
        roundTrip(in);
    });

    test("textbook example (CLRS 16.3): optimal cost = 224 bits", [] {
        FrequencyTable f{};
        f['a'] = 45; f['b'] = 13; f['c'] = 12; f['d'] = 16; f['e'] = 9; f['f'] = 5;
        auto codes = HuffmanTree::build(f).buildCodes();
        std::uint64_t bits = 0;
        for (int s = 0; s < 256; ++s) bits += f[s] * codes[s].length;
        CHECK(bits == 224);
        CHECK(codes['a'].length == 1);  // most frequent symbol -> shortest code
    });

    test("codes are prefix-free", [] {
        Bytes in = fromString("the quick brown fox jumps over the lazy dog, again and again!");
        auto freq = countFrequencies(in);
        auto codes = HuffmanTree::build(freq).buildCodes();
        for (int a = 0; a < 256; ++a) {
            for (int b = 0; b < 256; ++b) {
                if (a == b || !freq[a] || !freq[b] || codes[a].length > codes[b].length) continue;
                // Is code[a] a prefix of code[b]?
                std::uint64_t prefixOfB = codes[b].bits >> (codes[b].length - codes[a].length);
                CHECK(prefixOfB != codes[a].bits);
            }
        }
    });

    test("Kraft equality holds (tree is full)", [] {
        Bytes in = fromString("mississippi river banks are muddy in spring");
        auto freq = countFrequencies(in);
        auto codes = HuffmanTree::build(freq).buildCodes();
        double sum = 0;
        for (int s = 0; s < 256; ++s)
            if (freq[s]) sum += 1.0 / static_cast<double>(1ULL << codes[s].length);
        CHECK(sum > 0.999999 && sum < 1.000001);
    });

    test("all 256 byte values round-trip", [] {
        Bytes in;
        for (int rep = 0; rep < 10; ++rep)
            for (int b = 0; b < 256; ++b) in.push_back(static_cast<std::uint8_t>(b));
        roundTrip(in);
    });

    test("random binary data round-trips (and barely compresses)", [] {
        std::mt19937 rng(123);
        Bytes in(200000);
        for (auto& b : in) b = static_cast<std::uint8_t>(rng());
        roundTrip(in);
        Stats s = analyze(in);
        CHECK(s.avgCodeLength > 7.9);  // ~8 bits: random data has max entropy
    });

    test("skewed (Fibonacci) frequencies build a deep tree and round-trip", [] {
        Bytes in;
        std::uint64_t a = 1, b = 1;
        for (int s = 0; s < 20; ++s) {
            in.insert(in.end(), a, static_cast<std::uint8_t>('A' + s));
            std::uint64_t c = a + b;
            a = b;
            b = c;
        }
        auto codes = HuffmanTree::build(countFrequencies(in)).buildCodes();
        int maxLen = 0;
        for (auto& c : codes) maxLen = std::max<int>(maxLen, c.length);
        CHECK(maxLen == 19);  // n symbols with Fibonacci weights -> depth n - 1
        roundTrip(in);
    });

    test("average code length within 1 bit of entropy", [] {
        std::string text;
        for (int k = 0; k < 200; ++k) text += "Huffman coding assigns shorter codes to more frequent symbols. ";
        Stats s = analyze(fromString(text));
        CHECK(s.avgCodeLength >= s.entropyBitsPerSymbol - 1e-9);
        CHECK(s.avgCodeLength < s.entropyBitsPerSymbol + 1.0);
    });

    test("corrupt input is rejected", [] {
        bool threw = false;
        try { decompress(fromString("NOPE00000000")); } catch (const std::runtime_error&) { threw = true; }
        CHECK(threw);

        Bytes packed = compress(fromString("some text that will be truncated"));
        packed.resize(packed.size() - 3);
        threw = false;
        try { decompress(packed); } catch (const std::runtime_error&) { threw = true; }
        CHECK(threw);
    });

    std::printf("\n%d checks, %d failed\n", g_checks, g_failed);
    return g_failed == 0 ? 0 : 1;
}
