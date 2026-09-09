#include <memory>
#include "bridge-pipe-peer.h"

// The broker owns the native session; its controller is the exact Node parent.
// Parent/target death terminates only this helper, allowing the DLL to retire its owner.
struct BrokerGuard {
    Handle controller, stop;
    HANDLE target, thread = nullptr;
    DWORD controllerPid;
    static DWORD WINAPI watch(void *raw) {
        const auto *guard = static_cast<BrokerGuard*>(raw);
        HANDLE waits[]{guard->stop.value, guard->controller.value, guard->target};
        const auto result = WaitForMultipleObjects(3, waits, FALSE, INFINITE);
        if (result != WAIT_OBJECT_0) TerminateProcess(GetCurrentProcess(), 70);
        return 0;
    }
    BrokerGuard(BridgeConfig &binding, HANDLE boundTarget)
        : controller(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, binding.ownerProcessId)),
          stop(CreateEventW(nullptr, TRUE, FALSE, nullptr)), target(boundTarget), controllerPid(binding.ownerProcessId) {
        FILETIME created{}, exited{}, kernel{}, user{}, ownCreated{};
        if (WaitForSingleObject(controller.value, 0) != WAIT_TIMEOUT
            || !GetProcessTimes(controller.value, &created, &exited, &kernel, &user)
            || ((std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime) != binding.ownerCreationTime
            || !GetProcessTimes(GetCurrentProcess(), &ownCreated, &exited, &kernel, &user)
            || CompareFileTime(&created, &ownCreated) > 0) throw std::runtime_error("Broker controller identity changed");
        binding.ownerProcessId = GetCurrentProcessId();
        binding.ownerCreationTime = (std::uint64_t(ownCreated.dwHighDateTime) << 32) | ownCreated.dwLowDateTime;
        thread = CreateThread(nullptr, 0, watch, this, 0, nullptr);
        if (!thread) throw std::runtime_error("Broker lifetime watcher could not start");
    }
    ~BrokerGuard() { SetEvent(stop.value); WaitForSingleObject(thread, INFINITE); CloseHandle(thread); }
};

static bool brokerStdio(HANDLE stream, void *buffer, DWORD length, bool write, bool allowEof = false) {
    DWORD offset = 0;
    while (offset < length) {
        DWORD count = 0;
        const auto ok = write ? WriteFile(stream, static_cast<BYTE*>(buffer) + offset, length - offset, &count, nullptr)
                              : ReadFile(stream, static_cast<BYTE*>(buffer) + offset, length - offset, &count, nullptr);
        if (!ok || !count) {
            if (!write && allowEof && offset == 0 && (!ok ? GetLastError() == ERROR_BROKEN_PIPE : true)) return false;
            throw std::runtime_error("Broker controller stream ended during a frame");
        }
        offset += count;
    }
    return true;
}
static void brokerPipe(HANDLE pipe, void *buffer, DWORD length, bool write, HANDLE target) {
    const auto deadline = GetTickCount64() + 8000;
    DWORD offset = 0;
    while (offset < length) {
        Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        OVERLAPPED io{}; io.hEvent = event.value;
        DWORD count = 0;
        const auto ok = write ? WriteFile(pipe, static_cast<BYTE*>(buffer) + offset, length - offset, &count, &io)
                              : ReadFile(pipe, static_cast<BYTE*>(buffer) + offset, length - offset, &count, &io);
        if (!ok && GetLastError() != ERROR_IO_PENDING) throw std::runtime_error("Broker native pipe transfer failed");
        if (!ok) {
            HANDLE waits[]{event.value, target};
            const auto now = GetTickCount64();
            const auto wait = WaitForMultipleObjects(2, waits, FALSE, now < deadline ? static_cast<DWORD>(deadline - now) : 0);
            if (wait != WAIT_OBJECT_0) {
                CancelIoEx(pipe, &io); GetOverlappedResult(pipe, &io, &count, TRUE);
                throw std::runtime_error("Broker native transfer deadline or process exit; outcome may be unknown");
            }
            if (!GetOverlappedResult(pipe, &io, &count, FALSE)) throw std::runtime_error("Broker native transfer completion failed");
        }
        if (!count) throw std::runtime_error("Broker native pipe ended during a frame");
        offset += count;
    }
}
static void runBroker(HANDLE pipe, HANDLE target) {
    const auto input = GetStdHandle(STD_INPUT_HANDLE), output = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD size = 0;
    while (brokerStdio(input, &size, sizeof(size), false, true)) {
        if (!size || size > 1048576) throw std::runtime_error("Broker request exceeds the frame bound");
        std::vector<BYTE> request(size);
        brokerStdio(input, request.data(), size, false);
        brokerPipe(pipe, &size, sizeof(size), true, target); brokerPipe(pipe, request.data(), size, true, target);
        brokerPipe(pipe, &size, sizeof(size), false, target);
        if (!size || size > 16 * 1024 * 1024) throw std::runtime_error("Broker response exceeds the frame bound");
        std::vector<BYTE> response(size); brokerPipe(pipe, response.data(), size, false, target);
        brokerStdio(output, &size, sizeof(size), true); brokerStdio(output, response.data(), size, true);
    }
}
