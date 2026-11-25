CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic
CPPFLAGS += -Iinclude

HEADERS := $(wildcard include/*.hpp)

.PHONY: all test bench clean

all: bin/huffman

bin/huffman: src/main.cpp src/huffman.cpp $(HEADERS)
	@mkdir -p bin
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) src/main.cpp src/huffman.cpp -o $@

bin/tests: tests/test_huffman.cpp src/huffman.cpp $(HEADERS)
	@mkdir -p bin
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) tests/test_huffman.cpp src/huffman.cpp -o $@

test: bin/tests
	./bin/tests

bench: bin/huffman
	./scripts/benchmark.sh

clean:
	rm -rf bin
