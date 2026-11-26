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
        CHECK(packed.size() == 5);  // header only: "HF" + mode + name length 0 + size varint 0
        CHECK(decompress(packed).empty());
    });

    test("single byte and single repeated symbol", [] {
        roundTrip(fromString("a"));
        roundTrip(Bytes(100000, 'z'));
        // 1 distinct symbol: tree = 1 leaf (9 bits -> 2 bytes) and no payload.
        // Header: 4 fixed bytes + 3-byte varint for 100000.
        CHECK(compress(Bytes(100000, 'z')).size() == 7 + 2);
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
        // Stored fallback: never grows by more than the 7-byte header (3-byte size varint).
        Bytes packed = compress(in);
        CHECK(isStored(packed));
        CHECK(packed.size() == in.size() + 7);
    });

    test("compressible text is Huffman-coded, not stored", [] {
        std::string text;
        for (int k = 0; k < 100; ++k) text += "the quick brown fox jumps over the lazy dog. ";
        Bytes packed = compress(fromString(text));
        CHECK(!isStored(packed));
        CHECK(packed.size() < text.size());
    });

    test("tiny input: picks whichever is smaller", [] {
        // abracadabra: Huffman = 5 + 9 bytes = 14 < stored 5 + 11 = 16 -> Huffman
        CHECK(!isStored(compress(fromString("abracadabra"))));
        CHECK(compress(fromString("abracadabra")).size() == 14);
        // abc: Huffman = 5 + 5 bytes = 10 > stored 5 + 3 = 8 -> stored
        Bytes in = fromString("abc");
        Bytes packed = compress(in);
        CHECK(isStored(packed));
        CHECK(packed.size() == in.size() + 5);
        CHECK(decompress(packed) == in);
        // Short sentences: overhead is a few bytes, not tens of bytes.
        Bytes sentence = fromString("hello how are you, are yo");
        CHECK(compress(sentence).size() <= sentence.size() + 5);
        CHECK(decompress(compress(sentence)) == sentence);
        std::string para;
        for (int k = 0; k < 3; ++k) para += "hello world, hey how are you? ";
        CHECK(compress(fromString(para)).size() < para.size());
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

    test("original file name is stored and restored", [] {
        Bytes in = fromString("quarterly numbers 1,2,3,4,5,6,7,8,9 and more numbers 1,2,3");
        Decoded d = decode(compress(in, "Report Q3.pdf"));
        CHECK(d.fileName == "Report Q3.pdf");
        CHECK(d.data == in);
        // Also in stored mode.
        Decoded s = decode(compress(fromString("abc"), "tiny.txt"));
        CHECK(s.stored);
        CHECK(s.fileName == "tiny.txt");
        // Header grows by exactly the name length.
        CHECK(compress(in, "Report Q3.pdf").size() == compress(in).size() + 13);
    });

    test("file names cannot escape the output folder", [] {
        CHECK(sanitizeFileName("../../etc/passwd") == "passwd");
        CHECK(sanitizeFileName("C:\\Users\\me\\notes.docx") == "notes.docx");
        CHECK(sanitizeFileName("..").empty());
        CHECK(sanitizeFileName(std::string("bad\nname.txt")) == "badname.txt");
        CHECK(sanitizeFileName(std::string(300, 'a')).size() == 255);
        Decoded d = decode(compress(fromString("hello hello"), "/abs/path/../evil.sh"));
        CHECK(d.fileName == "evil.sh");
    });

    test("version-1 files (no stored name) still decode", [] {
        Bytes in;
        for (int k = 0; k < 50; ++k) for (char c : std::string("mississippi ")) in.push_back(c);
        Bytes v3 = compress(in);  // no name, 600 bytes -> 4 fixed + 2-byte varint = 6-byte header
        CHECK(!isStored(v3));
        // Same payload behind the old 12-byte "HUF1" header.
        Bytes v1 = {'H', 'U', 'F', '1'};
        for (int k = 0; k < 8; ++k) v1.push_back(static_cast<std::uint8_t>((in.size() >> (8 * k)) & 0xFF));
        v1.insert(v1.end(), v3.begin() + 6, v3.end());
        Decoded d = decode(v1);
        CHECK(d.data == in);
        CHECK(d.fileName.empty());
        // Old stored format "HUF0".
        Bytes v0 = {'H', 'U', 'F', '0', 3, 0, 0, 0, 0, 0, 0, 0, 'x', 'y', 'z'};
        CHECK(decompress(v0) == fromString("xyz"));
    });

    test("version-2 files (\"HUF2\", 15-byte header) still decode", [] {
        Bytes in = fromString("abracadabra");
        Bytes v3 = compress(in, "x.txt");  // header: 4 + 5 name + 1 varint = 10
        Bytes v2 = {'H', 'U', 'F', '2', 1};
        for (int k = 0; k < 8; ++k) v2.push_back(static_cast<std::uint8_t>((in.size() >> (8 * k)) & 0xFF));
        v2.push_back(5);
        v2.push_back(0);
        for (char c : std::string("x.txt")) v2.push_back(c);
        v2.insert(v2.end(), v3.begin() + 10, v3.end());
        Decoded d = decode(v2);
        CHECK(d.data == in);
        CHECK(d.fileName == "x.txt");
    });

    test("corrupt input is rejected", [] {
        bool threw = false;
        try { decompress(fromString("NOPE00000000")); } catch (const std::runtime_error&) { threw = true; }
        CHECK(threw);
        // A text file that happens to start with "HF" is not a .huf file.
        threw = false;
        try { decompress(fromString("HF is a chemical formula")); } catch (const std::runtime_error&) { threw = true; }
        CHECK(threw);

        std::string longText;
        for (int k = 0; k < 20; ++k) longText += "some text that will be truncated. ";
        Bytes packed = compress(fromString(longText));
        packed.resize(packed.size() - 3);
        threw = false;
        try { decompress(packed); } catch (const std::runtime_error&) { threw = true; }
        CHECK(threw);

        // Name length pointing past the end of the file.
        Bytes bad = compress(fromString("hello"), "a.txt");
        bad.resize(7);  // header says 5 name bytes, only 3 present
        threw = false;
        try { decompress(bad); } catch (const std::runtime_error&) { threw = true; }
        CHECK(threw);
    });

    std::printf("\n%d checks, %d failed\n", g_checks, g_failed);
    return g_failed == 0 ? 0 : 1;
}
