#pragma once
#include <windows.h>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <utility>
#include <nlohmann/json.hpp>

// Private RPC diagnostics only. The GUI is the sole producer; the pipe thread
// may copy an immutable published prefix while the GUI is still executing.
enum class NativeEditPhase {
    GuiEnter, ControllerAcquired, RootBefore, RootAfter, ActionEnter,
    LookupBefore, LookupAfter, EditEnter, PrepareBefore, PrepareAfter, PermitClaimed, PermitRefused,
    SelectAllBefore, SelectAllAfter,
    InsertBefore, InsertAfter, CommitBefore, CommitAfter, GuiComplete
};

static const char *nativeEditPhaseName(NativeEditPhase phase) noexcept {
    switch (phase) {
    case NativeEditPhase::GuiEnter: return "gui.enter";
    case NativeEditPhase::ControllerAcquired: return "controller.acquired";
    case NativeEditPhase::RootBefore: return "root.before";
    case NativeEditPhase::RootAfter: return "root.after";
    case NativeEditPhase::ActionEnter: return "action.enter";
    case NativeEditPhase::LookupBefore: return "lookup.before";
    case NativeEditPhase::LookupAfter: return "lookup.after";
    case NativeEditPhase::EditEnter: return "edit.enter";
    case NativeEditPhase::PrepareBefore: return "prepare.before";
    case NativeEditPhase::PrepareAfter: return "prepare.after";
    case NativeEditPhase::PermitClaimed: return "permit.claimed";
    case NativeEditPhase::PermitRefused: return "permit.refused";
    case NativeEditPhase::SelectAllBefore: return "selectAll.before";
    case NativeEditPhase::SelectAllAfter: return "selectAll.after";
    case NativeEditPhase::InsertBefore: return "insert.before";
    case NativeEditPhase::InsertAfter: return "insert.after";
    case NativeEditPhase::CommitBefore: return "commit.before";
    case NativeEditPhase::CommitAfter: return "commit.after";
    case NativeEditPhase::GuiComplete: return "gui.complete";
    }
    return "unrecognized";
}

class NativeEditTrace {
    struct Record { NativeEditPhase phase; std::int64_t monotonicUs; DWORD threadId; };
    static constexpr unsigned int capacity = 32, countMask = 0xffu;
    static constexpr unsigned int completeBit = 1u << 8, overflowBit = 1u << 9;
    std::array<Record, capacity> records_{};
    const std::chrono::steady_clock::time_point began_ = std::chrono::steady_clock::now();
    unsigned int count_ = 0;
    std::atomic<unsigned int> published_{0};

    std::int64_t nowUs() const noexcept {
        return std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now() - began_).count();
    }
public:
    void mark(NativeEditPhase phase) noexcept {
        const auto completion = phase == NativeEditPhase::GuiComplete ? completeBit : 0u;
        if (count_ == capacity) {
            published_.fetch_or(overflowBit | completion, std::memory_order_release);
            return;
        }
        records_[count_] = {phase, nowUs(), GetCurrentThreadId()};
        // No reader touches a slot until its immutable contents are published.
        published_.store(++count_ | completion, std::memory_order_release);
    }
    nlohmann::json snapshot() const {
        const auto state = published_.load(std::memory_order_acquire);
        const auto count = state & countMask;
        auto records = nlohmann::json::array();
        for (unsigned int index = 0; index < count; ++index) {
            const auto &record = records_[index];
            records.push_back({{"sequence", index + 1}, {"phase", nativeEditPhaseName(record.phase)},
                {"monotonicUs", record.monotonicUs}, {"threadId", record.threadId}});
        }
        return {{"schemaVersion", 1}, {"capacity", capacity},
            {"clock", "request-relative-steady-microseconds"}, {"capturedAtUs", nowUs()},
            {"captureComplete", (state & completeBit) != 0}, {"overflow", (state & overflowBit) != 0},
            {"records", std::move(records)}};
    }
};

static thread_local NativeEditTrace *currentNativeEditTrace = nullptr;
static void markNativeEdit(NativeEditPhase phase) noexcept {
    if (currentNativeEditTrace) currentNativeEditTrace->mark(phase);
}

class NativeEditTraceScope {
    NativeEditTrace *previous_;
public:
    explicit NativeEditTraceScope(NativeEditTrace *trace) noexcept : previous_(currentNativeEditTrace) {
        currentNativeEditTrace = trace;
        markNativeEdit(NativeEditPhase::GuiEnter);
    }
    ~NativeEditTraceScope() {
        markNativeEdit(NativeEditPhase::GuiComplete);
        currentNativeEditTrace = previous_;
    }
    NativeEditTraceScope(const NativeEditTraceScope &) = delete;
    NativeEditTraceScope &operator=(const NativeEditTraceScope &) = delete;
};
