#include <array>
#include <optional>
#include <cstring>
#include <algorithm>

static std::wstring canonicalFile(HANDLE file) {
    std::wstring path(32768, L'\0');
    const auto count = GetFinalPathNameByHandleW(file, path.data(), static_cast<DWORD>(path.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (!count || count >= path.size()) throw std::runtime_error("Canonical bridge path is unavailable");
    path.resize(count);
    if (path.rfind(L"\\\\?\\", 0) == 0) path.erase(0, 4);
    if (path.size() < 4 || path[1] != L':') throw std::runtime_error("Bridge must resolve to a local drive");
    return path;
}
static std::optional<MODULEENTRY32W> existingBridge(DWORD pid, const std::wstring &path) {
    PhaseTimer timer(moduleMs);
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid));
    MODULEENTRY32W entry{}; entry.dwSize = sizeof(entry);
    std::optional<MODULEENTRY32W> found;
    if (!Module32FirstW(snapshot.value, &entry)) throw std::runtime_error("Bridge module inventory is unavailable");
    do {
        if (_wcsicmp(entry.szModule, L"sse-qt-read.dll") != 0) continue;
        if (found) throw std::runtime_error("Multiple bridge images are already loaded");
        Handle loadedFile(CreateFileW(entry.szExePath, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
        if (_wcsicmp(canonicalFile(loadedFile.value).c_str(), path.c_str()) != 0)
            throw std::runtime_error("A bridge image from a different path is already loaded; keep its original package until application exit");
        found = entry;
    } while (Module32NextW(snapshot.value, &entry));
    if (GetLastError() != ERROR_NO_MORE_FILES) throw std::runtime_error("Bridge module inventory did not complete");
    return found;
}
struct BridgeImage {
    Handle file;
    std::wstring path;
    HMODULE mapped = nullptr;
    IMAGE_NT_HEADERS64 headers{};
    DWORD startRva = 0, identityRva = 0;
    std::array<char, BRIDGE_BUILD_ID_SIZE> identity{};
    explicit BridgeImage(const std::wstring &requested)
        : file(CreateFileW(requested.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr)),
          path(canonicalFile(file.value)) {
        if (_wcsicmp(path.substr(path.find_last_of(L"\\/") + 1).c_str(), L"sse-qt-read.dll") != 0)
            throw std::runtime_error("Expected the canonical sse-qt-read.dll image name");
        mapped = LoadLibraryExW(path.c_str(), nullptr, DONT_RESOLVE_DLL_REFERENCES);
        if (!mapped) throw std::runtime_error("Bridge image could not be inspected");
        try {
            const auto *base = reinterpret_cast<const BYTE*>(mapped);
            const auto *dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
            if (dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew < sizeof(IMAGE_DOS_HEADER) || dos->e_lfanew > 1048576)
                throw std::runtime_error("Invalid bridge DOS header");
            headers = *reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
            if (headers.Signature != IMAGE_NT_SIGNATURE || headers.FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64
                || !(headers.FileHeader.Characteristics & IMAGE_FILE_DLL) || headers.OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC
                || headers.OptionalHeader.SizeOfImage < 4096 || headers.OptionalHeader.SizeOfImage > 128 * 1024 * 1024)
                throw std::runtime_error("Unsupported bridge PE image");
            const auto symbol = [&](const char *name, std::size_t length) {
                const auto address = reinterpret_cast<std::uintptr_t>(GetProcAddress(mapped, name));
                const auto offset = address - reinterpret_cast<std::uintptr_t>(mapped);
                if (!address || offset >= headers.OptionalHeader.SizeOfImage || length > headers.OptionalHeader.SizeOfImage - offset)
                    throw std::runtime_error("Bridge export is missing or outside its image");
                return static_cast<DWORD>(offset);
            };
            startRva = symbol("BridgeStart", 1); identityRva = symbol("BridgeBuildIdentity", identity.size());
            std::memcpy(identity.data(), base + identityRva, identity.size());
            const auto prefixLength = sizeof(SSE_BRIDGE_BUILD_PREFIX) - 1;
            if (std::memcmp(identity.data(), SSE_BRIDGE_BUILD_PREFIX, prefixLength) != 0 || identity.back() != '\0'
                || !std::all_of(identity.begin() + prefixLength, identity.end() - 1, [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); }))
                throw std::runtime_error("Bridge build identity is invalid or uses a different startup ABI");
        } catch (...) { FreeLibrary(mapped); mapped = nullptr; throw; }
    }
    ~BridgeImage() { if (mapped) FreeLibrary(mapped); }
    BridgeImage(const BridgeImage&) = delete;
};
static void readImage(HANDLE process, const MODULEENTRY32W &image, DWORD offset, void *buffer, std::size_t count) {
    if (offset >= image.modBaseSize || count > image.modBaseSize - offset) throw std::runtime_error("Loaded bridge metadata exceeds its image");
    SIZE_T copied = 0;
    if (!ReadProcessMemory(process, image.modBaseAddr + offset, buffer, count, &copied) || copied != count)
        throw std::runtime_error("Loaded bridge metadata is unavailable");
}
static DWORD remoteExport(HANDLE process, const MODULEENTRY32W &image, const IMAGE_NT_HEADERS64 &headers, const char *wanted) {
    const auto directory = headers.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXPORT];
    if (directory.Size < sizeof(IMAGE_EXPORT_DIRECTORY) || directory.VirtualAddress >= image.modBaseSize
        || directory.Size > image.modBaseSize - directory.VirtualAddress) throw std::runtime_error("Invalid loaded bridge export directory");
    IMAGE_EXPORT_DIRECTORY exports{};
    readImage(process, image, directory.VirtualAddress, &exports, sizeof(exports));
    if (!exports.NumberOfNames || exports.NumberOfNames > 128 || !exports.NumberOfFunctions || exports.NumberOfFunctions > 128)
        throw std::runtime_error("Loaded bridge export count exceeds the bound");
    std::vector<DWORD> names(exports.NumberOfNames), functions(exports.NumberOfFunctions);
    std::vector<WORD> ordinals(exports.NumberOfNames);
    readImage(process, image, exports.AddressOfNames, names.data(), names.size() * sizeof(DWORD));
    readImage(process, image, exports.AddressOfNameOrdinals, ordinals.data(), ordinals.size() * sizeof(WORD));
    readImage(process, image, exports.AddressOfFunctions, functions.data(), functions.size() * sizeof(DWORD));
    for (std::size_t i = 0; i < names.size(); ++i) {
        std::array<char, 64> name{};
        if (names[i] >= image.modBaseSize) throw std::runtime_error("Loaded bridge export name is outside its image");
        const auto length = std::min<std::size_t>(name.size(), image.modBaseSize - names[i]);
        readImage(process, image, names[i], name.data(), length);
        if (!std::memchr(name.data(), '\0', length)) throw std::runtime_error("Loaded bridge export name exceeds the bound");
        if (std::strcmp(name.data(), wanted) != 0) continue;
        if (ordinals[i] >= functions.size()) throw std::runtime_error("Loaded bridge export ordinal is invalid");
        const auto address = functions[ordinals[i]];
        if (!address || address >= image.modBaseSize || (address >= directory.VirtualAddress && address - directory.VirtualAddress < directory.Size))
            throw std::runtime_error("Loaded bridge export is forwarded or invalid");
        return address;
    }
    throw std::runtime_error("Required loaded bridge export is missing");
}
static void verifyBridgeImage(HANDLE process, const MODULEENTRY32W &loaded, const BridgeImage &expected) {
    IMAGE_DOS_HEADER dos{}; IMAGE_NT_HEADERS64 headers{};
    readImage(process, loaded, 0, &dos, sizeof(dos));
    if (dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < sizeof(IMAGE_DOS_HEADER) || dos.e_lfanew > 1048576)
        throw std::runtime_error("Loaded bridge DOS header is invalid");
    readImage(process, loaded, static_cast<DWORD>(dos.e_lfanew), &headers, sizeof(headers));
    if (headers.Signature != IMAGE_NT_SIGNATURE || headers.FileHeader.Machine != expected.headers.FileHeader.Machine
        || headers.FileHeader.TimeDateStamp != expected.headers.FileHeader.TimeDateStamp
        || headers.OptionalHeader.Magic != expected.headers.OptionalHeader.Magic
        || headers.OptionalHeader.SizeOfImage != expected.headers.OptionalHeader.SizeOfImage
        || loaded.modBaseSize != expected.headers.OptionalHeader.SizeOfImage)
        throw std::runtime_error("Loaded bridge PE identity differs from the requested image");
    if (remoteExport(process, loaded, headers, "BridgeStart") != expected.startRva
        || remoteExport(process, loaded, headers, "BridgeBuildIdentity") != expected.identityRva)
        throw std::runtime_error("Loaded bridge export addresses differ from the requested image");
    std::array<char, BRIDGE_BUILD_ID_SIZE> identity{};
    readImage(process, loaded, expected.identityRva, identity.data(), identity.size());
    if (identity != expected.identity) throw std::runtime_error("Loaded bridge build identity differs from the requested image");
}
