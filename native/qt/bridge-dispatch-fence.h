#pragma once
#include <atomic>

// Only exact edit requests may remain cancellable while their GUI callback is
// reading. The permit and cancellation compete on this same atomic state.
class NativeDispatchFence {
public:
    enum class State { Queued, Preparing, Running, Done, QueueCancelled, PreparationCancelled };
    enum class Cancellation { None, Queued, Preparing };
private:
    const bool requiresPermit_;
    std::atomic<State> state_{State::Queued};
public:
    explicit NativeDispatchFence(bool requiresPermit) noexcept : requiresPermit_(requiresPermit) {}
    bool requiresPermit() const noexcept { return requiresPermit_; }
    State state() const noexcept { return state_.load(std::memory_order_acquire); }
    bool beginDispatch() noexcept {
        auto expected = State::Queued;
        return state_.compare_exchange_strong(expected, requiresPermit_ ? State::Preparing : State::Running,
            std::memory_order_acq_rel);
    }
    Cancellation cancelBeforeMutation() noexcept {
        auto expected = State::Queued;
        if (state_.compare_exchange_strong(expected, State::QueueCancelled, std::memory_order_acq_rel))
            return Cancellation::Queued;
        if (requiresPermit_ && expected == State::Preparing
            && state_.compare_exchange_strong(expected, State::PreparationCancelled, std::memory_order_acq_rel))
            return Cancellation::Preparing;
        return Cancellation::None;
    }
    Cancellation provenCancellation() const noexcept {
        const auto current = state();
        if (current == State::QueueCancelled) return Cancellation::Queued;
        if (current == State::PreparationCancelled) return Cancellation::Preparing;
        return Cancellation::None;
    }
    bool permitMutation() noexcept {
        if (!requiresPermit_) return false;
        auto expected = State::Preparing;
        return state_.compare_exchange_strong(expected, State::Running, std::memory_order_acq_rel);
    }
    void complete() noexcept { state_.store(State::Done, std::memory_order_release); }
};

// A missing fence must never authorize an edit or manufacture cancellation
// evidence. Legacy mutations do not call this exact-edit-only mechanism.
static bool claimNativeEditMutation(NativeDispatchFence *fence, bool &mutationStarted) noexcept {
    if (!fence || !fence->permitMutation()) return false;
    mutationStarted = true;
    return true;
}

struct NativeSession;
class NativeGuiContextScope {
    const NativeSession *&session_;
    bool &mutationStarted_;
    NativeDispatchFence *&fence_;
    const NativeSession *previousSession_;
    const bool previousMutationStarted_;
    NativeDispatchFence *previousFence_;
public:
    NativeGuiContextScope(const NativeSession *&session, bool &mutationStarted, NativeDispatchFence *&fence,
        const NativeSession *nextSession, NativeDispatchFence *nextFence) noexcept
        : session_(session), mutationStarted_(mutationStarted), fence_(fence),
          previousSession_(session), previousMutationStarted_(mutationStarted), previousFence_(fence) {
        session_ = nextSession;
        mutationStarted_ = false;
        fence_ = nextFence;
    }
    ~NativeGuiContextScope() {
        session_ = previousSession_;
        mutationStarted_ = previousMutationStarted_;
        fence_ = previousFence_;
    }
    NativeGuiContextScope(const NativeGuiContextScope &) = delete;
    NativeGuiContextScope &operator=(const NativeGuiContextScope &) = delete;
};
