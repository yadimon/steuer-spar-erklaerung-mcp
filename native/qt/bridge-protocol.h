#pragma once
#include <cstdint>
#include <cstddef>
#if !defined(_WIN64) || !defined(_M_X64)
#error The native bridge startup ABI requires Windows x64.
#endif
#define SSE_BRIDGE_BUILD_PREFIX "SSE_NATIVE_BRIDGE_V2:"
inline constexpr std::size_t BRIDGE_BUILD_ID_SIZE = sizeof(SSE_BRIDGE_BUILD_PREFIX) + 64;

// Internal startup ABI shared by the native loader and Qt bridge.
struct BridgeConfig {
    std::uint32_t magic = 0x53534542;
    std::uint32_t version = 2;
    std::uint32_t processId = 0;
    std::uint32_t ownerProcessId = 0;
    std::uint64_t creationTime = 0;
    std::uint64_t ownerCreationTime = 0;
    std::uint64_t window = 0;
    wchar_t pipe[160]{};
    char nonce[65]{};
};
