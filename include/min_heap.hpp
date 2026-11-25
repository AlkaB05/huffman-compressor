#pragma once

#include <cstddef>
#include <functional>
#include <stdexcept>
#include <utility>
#include <vector>

namespace huffman {

/**
 * Binary min-heap (priority queue) written from scratch.
 *
 * The heap is a complete binary tree stored in a flat array:
 *   parent(i) = (i - 1) / 2,  left(i) = 2i + 1,  right(i) = 2i + 2
 * Invariant: every parent is <= its children, so the minimum is at index 0.
 *
 *   push : O(log n)  - append at the end, then sift up
 *   pop  : O(log n)  - move last element to the root, then sift down
 *   top  : O(1)
 */
template <typename T, typename Less = std::less<T>>
class MinHeap {
public:
    explicit MinHeap(Less less = Less()) : less_(less) {}

    bool empty() const { return data_.empty(); }
    std::size_t size() const { return data_.size(); }

    const T& top() const {
        if (data_.empty()) throw std::out_of_range("MinHeap::top on empty heap");
        return data_.front();
    }

    void push(T value) {
        data_.push_back(std::move(value));
        siftUp(data_.size() - 1);
    }

    T pop() {
        if (data_.empty()) throw std::out_of_range("MinHeap::pop on empty heap");
        T result = std::move(data_.front());
        data_.front() = std::move(data_.back());
        data_.pop_back();
        if (!data_.empty()) siftDown(0);
        return result;
    }

private:
    void siftUp(std::size_t i) {
        while (i > 0) {
            std::size_t parent = (i - 1) / 2;
            if (!less_(data_[i], data_[parent])) break;
            std::swap(data_[i], data_[parent]);
            i = parent;
        }
    }

    void siftDown(std::size_t i) {
        const std::size_t n = data_.size();
        while (true) {
            std::size_t left = 2 * i + 1;
            std::size_t right = left + 1;
            std::size_t smallest = i;
            if (left < n && less_(data_[left], data_[smallest])) smallest = left;
            if (right < n && less_(data_[right], data_[smallest])) smallest = right;
            if (smallest == i) break;
            std::swap(data_[i], data_[smallest]);
            i = smallest;
        }
    }

    std::vector<T> data_;
    Less less_;
};

}  // namespace huffman
