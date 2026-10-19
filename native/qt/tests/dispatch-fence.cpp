#include "../bridge-dispatch-fence.h"
#include <cstdlib>
#include <future>
#include <iostream>
#include <stdexcept>
#include <thread>

static void require(bool condition, const char *message) {
    if (!condition) { std::cerr << message << '\n'; std::exit(1); }
}
struct NativeSession { int identity; };

int main() {
    using State = NativeDispatchFence::State;
    using Cancellation = NativeDispatchFence::Cancellation;

    NativeDispatchFence queued(true);
    require(queued.cancelBeforeMutation() == Cancellation::Queued, "Queued cancellation must win before GUI admission");
    bool attempted = false;
    require(!queued.beginDispatch() && !claimNativeEditMutation(&queued, attempted) && !attempted,
        "A queue-cancelled callback must never dispatch or claim an action");
    require(queued.provenCancellation() == Cancellation::Queued, "Queue proof must come from the atomic terminal state");

    NativeDispatchFence cancelledPreparation(true);
    require(cancelledPreparation.beginDispatch() && cancelledPreparation.state() == State::Preparing,
        "An exact edit must enter read-only preparation first");
    std::promise<void> cancellationFinished;
    auto afterCancellation = cancellationFinished.get_future();
    std::thread canceller([&] {
        require(cancelledPreparation.cancelBeforeMutation() == Cancellation::Preparing,
            "Cancellation must win while the edit is still preparing");
        cancellationFinished.set_value();
    });
    afterCancellation.get();
    attempted = false;
    require(!claimNativeEditMutation(&cancelledPreparation, attempted) && !attempted,
        "A late permit must lose to the completed cancellation");
    canceller.join();
    require(cancelledPreparation.provenCancellation() == Cancellation::Preparing,
        "Preparation proof must identify the successful cancellation CAS");
    cancelledPreparation.complete();
    require(cancelledPreparation.state() == State::Done
        && !claimNativeEditMutation(&cancelledPreparation, attempted) && !attempted,
        "Draining completion must never reopen a cancelled edit's mutation permit");

    NativeDispatchFence permitted(true);
    require(permitted.beginDispatch(), "Fresh edit must dispatch");
    std::promise<void> permitFinished;
    auto afterPermit = permitFinished.get_future();
    attempted = false;
    std::thread mutation([&] {
        require(claimNativeEditMutation(&permitted, attempted), "Mutation permit must win before cancellation");
        permitFinished.set_value();
    });
    afterPermit.get();
    require(permitted.cancelBeforeMutation() == Cancellation::None && attempted
        && permitted.provenCancellation() == Cancellation::None,
        "A running edit must remain an unknown outcome on timeout, without cancellation proof");
    mutation.join();
    require(!claimNativeEditMutation(&permitted, attempted), "An edit's mutation permit must be single use");
    permitted.complete();
    require(permitted.cancelBeforeMutation() == Cancellation::None, "A completed edit must not acquire a cancellation proof");

    NativeDispatchFence legacy(false);
    require(legacy.beginDispatch() && legacy.state() == State::Running,
        "Legacy operations must enter Running without a new preparation phase");
    attempted = false;
    require(legacy.cancelBeforeMutation() == Cancellation::None
        && !claimNativeEditMutation(&legacy, attempted) && !attempted,
        "Legacy operations must neither gain preparation cancellation nor authorize exact edits");
    require(!claimNativeEditMutation(nullptr, attempted) && !attempted,
        "A missing fence must fail closed without inventing a mutation or cancellation");

    NativeSession outerSession{1}, nestedSession{2};
    const NativeSession *currentSession = nullptr;
    NativeDispatchFence *currentFence = nullptr;
    bool currentMutation = false;
    NativeDispatchFence outer(true), nested(true);
    require(outer.beginDispatch(), "Outer context must prepare");
    {
        NativeGuiContextScope outerScope(currentSession, currentMutation, currentFence, &outerSession, &outer);
        require(currentSession == &outerSession && currentFence == &outer && !currentMutation,
            "GUI context must bind the current session and fence");
        require(claimNativeEditMutation(currentFence, currentMutation), "Outer action must claim its own permit");
        {
            NativeGuiContextScope nestedScope(currentSession, currentMutation, currentFence, &nestedSession, &nested);
            require(currentSession == &nestedSession && currentFence == &nested && !currentMutation,
                "A nested busy callback must not inherit the outer attempted flag");
            require(!claimNativeEditMutation(currentFence, currentMutation) && !currentMutation,
                "An unadmitted nested callback must not claim another edit's permit");
        }
        require(currentSession == &outerSession && currentFence == &outer && currentMutation,
            "A nested callback must restore all three outer GUI context values");
        try {
            NativeGuiContextScope nestedScope(currentSession, currentMutation, currentFence, &nestedSession, nullptr);
            throw std::runtime_error("Synthetic callback failure");
        } catch (const std::runtime_error &) {}
        require(currentSession == &outerSession && currentFence == &outer && currentMutation,
            "Exception unwinding must restore the outer session, attempted flag and fence");
    }
    require(currentSession == nullptr && currentFence == nullptr && !currentMutation,
        "Completing the outer callback must restore its original empty context");
    std::cout << "Native edit dispatch fence passed\n";
    return 0;
}
