#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>

#include "huffman.hpp"

using huffman::Bytes;
namespace fs = std::filesystem;

namespace {

Bytes readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open input file: " + path);
    return Bytes(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

void writeFile(const std::string& path, const Bytes& data) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot open output file: " + path);
    out.write(reinterpret_cast<const char*>(data.data()), static_cast<std::streamsize>(data.size()));
    if (!out) throw std::runtime_error("failed writing output file: " + path);
}

void usage() {
    std::cerr << "Huffman file compressor\n\n"
                 "Usage:\n"
                 "  huffman compress   <input> [output.huf]   (default: <input>.huf)\n"
                 "  huffman decompress <input.huf> [output]   (default: original file name, same folder)\n"
                 "  huffman stats      <input> [--codes]\n\n"
                 "Default output paths never overwrite an existing file.\n";
}

std::string printable(int sym) {
    if (sym == '\n') return "'\\n'";
    if (sym == '\r') return "'\\r'";
    if (sym == '\t') return "'\\t'";
    if (sym == ' ') return "' '";
    if (sym >= 33 && sym < 127) return std::string("'") + static_cast<char>(sym) + "'";
    char buf[8];
    std::snprintf(buf, sizeof buf, "0x%02X", sym);
    return buf;
}

/** When the user did not name the output, refuse to clobber an existing file. */
void ensureFree(const std::string& path) {
    if (fs::exists(path)) throw std::runtime_error(path + " already exists; pass an explicit output path to overwrite it");
}

double msSince(std::chrono::steady_clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        usage();
        return 1;
    }
    const std::string cmd = argv[1];
    try {
        if (cmd == "compress" && (argc == 3 || argc == 4)) {
            auto t0 = std::chrono::steady_clock::now();
            const std::string inPath = argv[2];
            std::string outPath = argc == 4 ? argv[3] : inPath + ".huf";
            if (argc == 3) ensureFree(outPath);
            Bytes input = readFile(inPath);
            // Store the original file name so decompress can restore it, extension included.
            Bytes output = huffman::compress(input, fs::path(inPath).filename().string());
            writeFile(outPath, output);
            double saved = input.empty() ? 0.0 : (1.0 - double(output.size()) / input.size()) * 100.0;
            std::printf("%s -> %s: %zu -> %zu bytes (%.1f%% smaller) in %.1f ms%s\n", inPath.c_str(), outPath.c_str(),
                        input.size(), output.size(), saved, msSince(t0),
                        huffman::isStored(output) ? "\n  note: Huffman would not shrink this data (already compressed?), stored raw" : "");
            return 0;
        }
        if (cmd == "decompress" && (argc == 3 || argc == 4)) {
            auto t0 = std::chrono::steady_clock::now();
            const std::string inPath = argv[2];
            huffman::Decoded d = huffman::decode(readFile(inPath));
            std::string outPath;
            if (argc == 4) {
                outPath = argv[3];
            } else {
                // Restore next to the .huf using the name stored at compression time.
                std::string name = d.fileName;
                if (name.empty()) {  // version-1 file without a stored name: drop ".huf"
                    fs::path p = fs::path(inPath).filename();
                    name = p.extension() == ".huf" ? p.stem().string() : p.string() + ".out";
                }
                outPath = (fs::path(inPath).parent_path() / name).string();
                ensureFree(outPath);
            }
            writeFile(outPath, d.data);
            std::printf("%s -> %s: restored %zu bytes in %.1f ms\n", inPath.c_str(), outPath.c_str(), d.data.size(),
                        msSince(t0));
            return 0;
        }
        if (cmd == "stats" && (argc == 3 || argc == 4)) {
            Bytes input = readFile(argv[2]);
            huffman::Stats s = huffman::analyze(input);
            std::printf("File               : %s\n", argv[2]);
            std::printf("Original size      : %llu bytes\n", (unsigned long long)s.originalBytes);
            std::printf("Compressed size    : %llu bytes (header + tree + data)\n",
                        (unsigned long long)s.compressedBytes);
            std::printf("Space saved        : %.2f%%%s\n", s.savingsPercent, s.stored ? "  (stored raw: Huffman would not help)" : "");
            std::printf("Distinct symbols   : %u\n", s.distinctSymbols);
            std::printf("Entropy (min avg)  : %.4f bits/symbol\n", s.entropyBitsPerSymbol);
            std::printf("Huffman avg length : %.4f bits/symbol (vs 8 bits uncompressed)\n", s.avgCodeLength);

            if (argc == 4 && std::string(argv[3]) == "--codes") {
                auto freq = huffman::countFrequencies(input);
                auto codes = huffman::HuffmanTree::build(freq).buildCodes();
                std::printf("\n%-8s %10s  %s\n", "symbol", "count", "code");
                for (int sym = 0; sym < 256; ++sym) {
                    if (!freq[sym]) continue;
                    std::string bits;
                    for (int k = codes[sym].length - 1; k >= 0; --k) bits += ((codes[sym].bits >> k) & 1) ? '1' : '0';
                    std::printf("%-8s %10llu  %s\n", printable(sym).c_str(), (unsigned long long)freq[sym],
                                bits.empty() ? "(single symbol)" : bits.c_str());
                }
            }
            return 0;
        }
        usage();
        return 1;
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << "\n";
        return 2;
    }
}
