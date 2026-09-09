#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <tlhelp32.h>
#include <bcrypt.h>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <stdexcept>
#include <chrono>
#include <nlohmann/json.hpp>
#include "bridge-protocol.h"
#include "bridge-compatibility.h"
#include "bridge-identity.h"

using Json = nlohmann::json;
static double moduleMs = 0, hashMs = 0, hashProviderMs = 0, hashReadMs = 0, hashUpdateMs = 0;
static double remoteMs = 0, discoveryMs = 0, desktopMs = 0;
struct PhaseTimer {
    double &total;
    std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
    explicit PhaseTimer(double &value) : total(value) {}
    ~PhaseTimer() { total += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count(); }
};
static Json timingDetail() {
    return {{"moduleEnumerationMs", moduleMs}, {"binaryHashMs", hashMs}, {"hashProviderMs", hashProviderMs},
        {"hashReadMs", hashReadMs}, {"hashUpdateMs", hashUpdateMs}, {"remoteCallMs", remoteMs},
        {"processWindowDiscoveryMs", discoveryMs}, {"desktopBindingMs", desktopMs}};
}
struct Handle {
    HANDLE value;
    explicit Handle(HANDLE h) : value(h) { if (!h || h == INVALID_HANDLE_VALUE) throw std::runtime_error("Win32 handle error " + std::to_string(GetLastError())); }
    ~Handle() { CloseHandle(value); }
    Handle(const Handle&) = delete;
};
static std::wstring wide(const std::string &s) {
    int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr, 0);
    if (!size) throw std::runtime_error("Invalid UTF-8 path");
    std::wstring result(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), result.data(), size);
    return result;
}
static MODULEENTRY32W module(DWORD pid, const std::wstring &name, bool exactPath = false) {
    PhaseTimer timer(moduleMs);
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid));
    MODULEENTRY32W entry{}; entry.dwSize = sizeof(entry);
    if (Module32FirstW(snapshot.value, &entry)) do {
        if (_wcsicmp(exactPath ? entry.szExePath : entry.szModule, name.c_str()) == 0) return entry;
    } while (Module32NextW(snapshot.value, &entry));
    throw std::runtime_error("Required target module not found");
}
static std::string sha256(const std::wstring &path) {
    PhaseTimer timer(hashMs);
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    {
        PhaseTimer providerTimer(hashProviderMs);
        if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) throw std::runtime_error("SHA256 unavailable");
    }
    Handle file(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    BCRYPT_HASH_HANDLE hash = nullptr;
    if (BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0) < 0) { BCryptCloseAlgorithmProvider(algorithm, 0); throw std::runtime_error("SHA256 initialization failed"); }
    std::vector<UCHAR> buffer(65536); DWORD count = 0;
    while (true) {
        {
            PhaseTimer readTimer(hashReadMs);
            if (!ReadFile(file.value, buffer.data(), static_cast<DWORD>(buffer.size()), &count, nullptr)) throw std::runtime_error("Hash read failed");
        }
        if (!count) break;
        {
            PhaseTimer updateTimer(hashUpdateMs);
            if (BCryptHashData(hash, buffer.data(), count, 0) < 0) throw std::runtime_error("Hash update failed");
        }
    }
    UCHAR bytes[32]{};
    if (BCryptFinishHash(hash, bytes, sizeof(bytes), 0) < 0) throw std::runtime_error("Hash finish failed");
    BCryptDestroyHash(hash); BCryptCloseAlgorithmProvider(algorithm, 0);
    static const char hex[] = "0123456789ABCDEF";
    std::string result; for (auto b : bytes) { result += hex[b >> 4]; result += hex[b & 15]; }
    return result;
}
static DWORD remoteCall(HANDLE process, LPTHREAD_START_ROUTINE function, const void *argument, std::size_t length) {
    PhaseTimer timer(remoteMs);
    auto *remote = VirtualAllocEx(process, nullptr, length, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
    if (!remote) throw std::runtime_error("Remote allocation failed");
    SIZE_T copied = 0;
    if (!WriteProcessMemory(process, remote, argument, length, &copied) || copied != length) {
        VirtualFreeEx(process, remote, 0, MEM_RELEASE); throw std::runtime_error("Remote argument copy failed");
    }
    const auto threadRaw = CreateRemoteThread(process, nullptr, 0, function, remote, 0, nullptr);
    if (!threadRaw) { VirtualFreeEx(process, remote, 0, MEM_RELEASE); throw std::runtime_error("Remote loader thread failed"); }
    Handle thread(threadRaw);
    if (WaitForSingleObject(thread.value, 10000) != WAIT_OBJECT_0) {
        // The target may still reference the argument. Keep it until process exit.
        throw std::runtime_error("Remote loader timed out; target outcome is unknown");
    }
    DWORD code = 0;
    const BOOL ok = GetExitCodeThread(thread.value, &code);
    VirtualFreeEx(process, remote, 0, MEM_RELEASE);
    if (!ok) throw std::runtime_error("Remote thread result unavailable");
    return code;
}
#include "bridge-discovery.h"
#include "bridge-image.h"
#include "bridge-broker.h"
static DWORD parentProcessId() {
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
    PROCESSENTRY32W entry{}; entry.dwSize = sizeof(entry);
    if (Process32FirstW(snapshot.value, &entry)) do {
        if (entry.th32ProcessID == GetCurrentProcessId()) return entry.th32ParentProcessID;
    } while (Process32NextW(snapshot.value, &entry));
    throw std::runtime_error("Loader parent process is unavailable");
}
static void bindOwner(BridgeConfig &config, const Json &request) {
    const DWORD parent = parentProcessId();
    if (!parent || (request.contains("ownerPid") && request.at("ownerPid").get<DWORD>() != parent))
        throw std::runtime_error("Session owner must be the loader's immediate caller");
    Handle owner(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, parent));
    FILETIME created{}, exited{}, kernel{}, user{};
    if (WaitForSingleObject(owner.value, 0) != WAIT_TIMEOUT || !GetProcessTimes(owner.value, &created, &exited, &kernel, &user))
        throw std::runtime_error("Session owner is no longer running");
    config.ownerProcessId = parent;
    config.ownerCreationTime = (std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
    if (request.contains("ownerCreationTime") && request.at("ownerCreationTime") != std::to_string(config.ownerCreationTime))
        throw std::runtime_error("Session owner creation time changed");
}
int main(int argc, char **argv) {
    HDESK privateDesktop = nullptr;
    try {
        const auto begin = std::chrono::steady_clock::now();
        if (argc != 2) throw std::runtime_error("Usage: bridge-load.exe config.json | --stdin | --broker");
        const bool broker = std::string(argv[1]) == "--broker";
        std::ifstream file;
        if (!broker && std::string(argv[1]) != "--stdin") file.open(argv[1], std::ios::binary);
        std::istream &input = std::string(argv[1]) == "--stdin" ? std::cin : file;
        std::string bytes; char character;
        if (broker) {
            DWORD length = 0;
            brokerStdio(GetStdHandle(STD_INPUT_HANDLE), &length, sizeof(length), false);
            if (!length || length > 65536) throw std::runtime_error("Broker bootstrap exceeds its 64 KiB bound");
            bytes.resize(length); brokerStdio(GetStdHandle(STD_INPUT_HANDLE), bytes.data(), length, false);
        } else {
            while (input.get(character)) {
                if (bytes.size() >= 65536) throw std::runtime_error("Loader request exceeds its 64 KiB bound");
                bytes += character;
            }
        }
        auto request = Json::parse(bytes);
        const auto mode = request.value("mode", std::string("legacy"));
        if (broker && mode != "attach") throw std::runtime_error("Broker requires automatic attachment mode");
        if (mode != "legacy" && mode != "discover" && mode != "attach") throw std::runtime_error("Unsupported loader mode");
        const bool automatic = mode != "legacy", readOnly = mode == "discover";
        if (request.contains("desktop")) {
            PhaseTimer timer(desktopMs);
            const auto name = wide(request.at("desktop").get<std::string>());
            if (name.empty() || name.size() > 64
                || name.find_first_not_of(L"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-") != std::wstring::npos)
                throw std::runtime_error("Invalid owned desktop name");
            privateDesktop = OpenDesktopW(name.c_str(), 0, FALSE, GENERIC_ALL);
            if (!privateDesktop || !SetThreadDesktop(privateDesktop))
                throw std::runtime_error("Could not bind loader thread to the existing private desktop");
            // SetThreadDesktop changes this worker thread's window namespace.
            // It does not switch the user's input desktop. Never call SwitchDesktop.
        }
        Json identity = Json::object();
        if (readOnly) selectDiscoveryTarget(request);
        if (automatic) {
            identity = discoverBinding(request);
            if (request.contains("desktop")) identity["desktop"] = request.at("desktop");
            request["hwnd"] = identity.at("hwnd"); request["creationTime"] = identity.at("creationTime");
        }
        identity["loaderBuildIdentity"] = SSE_BRIDGE_BUILD_PREFIX SSE_BRIDGE_SOURCE_DIGEST;
        BridgeConfig config;
        config.processId = request.at("pid").get<DWORD>();
        config.creationTime = std::stoull(request.at("creationTime").get<std::string>());
        config.window = request.at("hwnd").get<std::uint64_t>();
        std::wstring library;
        if (!readOnly) {
            bindOwner(config, request);
            const auto pipe = wide(request.at("pipe").get<std::string>());
            const auto nonce = request.at("nonce").get<std::string>();
            if (pipe.size() >= 160 || nonce.size() != 64) throw std::runtime_error("Invalid session binding");
            std::copy(pipe.begin(), pipe.end(), config.pipe); std::copy(nonce.begin(), nonce.end(), config.nonce);
            library = wide(request.at("dll").get<std::string>());
            if (library.size() < 4 || library[1] != L':') throw std::runtime_error("DLL path must be absolute");
        }
        const DWORD access = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | (broker ? SYNCHRONIZE : 0)
            | (readOnly ? 0 : PROCESS_CREATE_THREAD | PROCESS_VM_OPERATION | PROCESS_VM_WRITE);
        Handle process(OpenProcess(access, FALSE, config.processId));
        std::unique_ptr<BrokerGuard> brokerGuard;
        wchar_t image[32768]{}; DWORD pathLength = 32768;
        if (!QueryFullProcessImageNameW(process.value, 0, image, &pathLength)) throw std::runtime_error("Target image unavailable");
        const std::wstring imagePath(image, pathLength);
        const auto base = imagePath.substr(imagePath.find_last_of(L"\\/") + 1);
        if (_wcsicmp(base.c_str(), L"bridge-fixture.exe") && _wcsicmp(base.c_str(), L"SSE.exe")) throw std::runtime_error("Only the synthetic fixture and SSE are allowed");
        if (automatic) verifyRequestedProfile(request, _wcsicmp(base.c_str(), L"bridge-fixture.exe") == 0);
        if (!_wcsicmp(base.c_str(), L"SSE.exe")) {
            if (sha256(imagePath) != SSE_NATIVE_EXE_SHA256) throw std::runtime_error("Unsupported SSE image");
            if (sha256(module(config.processId, L"Dm.dll").szExePath) != SSE_NATIVE_DM_SHA256) throw std::runtime_error("Unsupported Dm image");
        }
        if (sha256(module(config.processId, L"Qt6Core.dll").szExePath) != SSE_NATIVE_QT_CORE_SHA256
            || sha256(module(config.processId, L"Qt6Widgets.dll").szExePath) != SSE_NATIVE_QT_WIDGETS_SHA256)
            throw std::runtime_error("Target Qt binary identity is unsupported");
        FILETIME created{}, exited{}, kernel{}, user{};
        if (!GetProcessTimes(process.value, &created, &exited, &kernel, &user)
            || ((std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime) != config.creationTime)
            throw std::runtime_error("Target PID creation time changed");
        DWORD owner = 0;
        if (!IsWindow(reinterpret_cast<HWND>(config.window)) || !GetWindowThreadProcessId(reinterpret_cast<HWND>(config.window), &owner) || owner != config.processId)
            throw std::runtime_error("Target window binding changed");
        if (automatic) {
            identity["profile"] = request.at("expectedProfile");
            identity["binaryIdentityVerified"] = true;
            identity["ok"] = true;
            if (readOnly) {
                identity["loaderMs"] = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - begin).count();
                identity["timingDetail"] = timingDetail();
                std::cout << identity.dump() << std::endl;
                return 0;
            }
        }
        if (broker) brokerGuard = std::make_unique<BrokerGuard>(config, process.value);
        const BridgeImage bridge(library);
        library = bridge.path;
        auto loaded = existingBridge(config.processId, library);
        const bool reused = loaded.has_value();
        if (!loaded) {
            auto *localLoad = GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW");
            HMODULE loadModule = nullptr;
            if (!localLoad || !GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                reinterpret_cast<LPCWSTR>(localLoad), &loadModule)) throw std::runtime_error("System loader unavailable");
            wchar_t loadPath[MAX_PATH]{};
            if (!GetModuleFileNameW(loadModule, loadPath, MAX_PATH)) throw std::runtime_error("System loader path unavailable");
            const std::wstring loadName(loadPath);
            auto remoteLoadModule = module(config.processId, loadName.substr(loadName.find_last_of(L"\\/") + 1));
            auto remoteLoad = reinterpret_cast<LPTHREAD_START_ROUTINE>(remoteLoadModule.modBaseAddr
                + (reinterpret_cast<BYTE*>(localLoad) - reinterpret_cast<BYTE*>(loadModule)));
            remoteCall(process.value, remoteLoad, library.c_str(), (library.size() + 1) * sizeof(wchar_t));
            loaded = existingBridge(config.processId, library);
            if (!loaded) throw std::runtime_error("Bridge did not appear after loading; do not repeat an uncertain startup");
        }
        verifyBridgeImage(process.value, *loaded, bridge);
        const auto code = remoteCall(process.value, reinterpret_cast<LPTHREAD_START_ROUTINE>(loaded->modBaseAddr + bridge.startRva), &config, sizeof(config));
        if (code != 0) throw std::runtime_error("Bridge rejected startup with code " + std::to_string(code));
        identity["ok"] = true; identity["pid"] = config.processId; identity["hwnd"] = config.window; identity["bridgeStarted"] = true;
        identity["ownerPid"] = config.ownerProcessId; identity["ownerCreationTime"] = std::to_string(config.ownerCreationTime);
        identity["bridgeImageVerified"] = true; identity["bridgeReused"] = reused;
        identity["bridgeBuildIdentity"] = bridge.identity.data();
        std::unique_ptr<Handle> brokerConnection;
        if (broker) {
            brokerConnection = std::make_unique<Handle>(CreateFileW(config.pipe, GENERIC_READ | GENERIC_WRITE, 0, nullptr,
                OPEN_EXISTING, FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr));
            verifyPipePeer(brokerConnection->value, process.value, config.processId, config.creationTime);
            identity["pipePeerVerified"] = true; identity["controllerPid"] = brokerGuard->controllerPid;
            identity["brokerPid"] = GetCurrentProcessId();
        }
        identity["loaderMs"] = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - begin).count();
        identity["timingDetail"] = timingDetail();
        if (broker) {
            auto ready = identity.dump() + "\n";
            brokerStdio(GetStdHandle(STD_OUTPUT_HANDLE), ready.data(), static_cast<DWORD>(ready.size()), true);
            runBroker(brokerConnection->value, process.value);
        } else std::cout << identity.dump() << std::endl;
        return 0;
    } catch (const DiscoveryError &e) {
        if (privateDesktop) CloseDesktop(privateDesktop);
        std::cerr << Json({{"ok", false}, {"kind", e.kind}, {"error", e.what()}}).dump() << std::endl;
        return 1;
    } catch (const std::exception &e) {
        if (privateDesktop) CloseDesktop(privateDesktop);
        std::cerr << Json({{"ok", false}, {"error", e.what()}}).dump() << std::endl;
        return 1;
    }
}
