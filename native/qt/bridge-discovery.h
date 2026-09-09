// Bound process/window discovery without UIA, CIM, input or desktop switching.
#include "bridge-windows.h"
struct DiscoveryError : std::runtime_error {
    std::string kind;
    DiscoveryError(const char *code, const char *message) : std::runtime_error(message), kind(code) {}
};
static void selectDiscoveryTarget(Json &request) {
    PhaseTimer timer(discoveryMs);
    if (!request.contains("expectedImage")) throw DiscoveryError("native-binding", "Discovery requires an explicit executable");
    if (request.contains("pid")) {
        const auto process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, request.at("pid").get<DWORD>());
        if (!process) {
            if (GetLastError() == ERROR_INVALID_PARAMETER) throw DiscoveryError("desktop-marker-stale", "Owned desktop process is no longer running");
            throw DiscoveryError("native-binding", "Owned desktop process identity is unavailable");
        }
        const auto state = WaitForSingleObject(process, 0); CloseHandle(process);
        if (state != WAIT_TIMEOUT) throw DiscoveryError("desktop-marker-stale", "Owned desktop process is no longer running");
    }
    const auto windows = nativeMainWindows(wide(request.at("expectedImage").get<std::string>()), L"Qt692QWindowIcon");
    Json matches = Json::array();
    for (const auto &window : windows) {
        if (!request.contains("hwnd") || request.at("hwnd") == window.at("hwnd")) matches.push_back(window);
    }
    if (matches.size() != 1) throw DiscoveryError(matches.empty() ? "no-window" : "ambiguous", "An unambiguous current product window is required");
    if (request.contains("pid") && request.at("pid") != matches[0].at("pid"))
        throw DiscoveryError("native-binding", "Selected window differs from the owned desktop process");
    request["pid"] = matches[0].at("pid"); request["hwnd"] = matches[0].at("hwnd");
}
static std::string narrow(const std::wstring &value) {
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
        static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) throw std::runtime_error("Invalid UTF-16 identity text");
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
        result.data(), size, nullptr, nullptr);
    return result;
}
struct DiscoveryWindows { DWORD pid; std::vector<HWND> windows; };
static BOOL CALLBACK collectSseWindow(HWND hwnd, LPARAM parameter) {
    auto &found = *reinterpret_cast<DiscoveryWindows*>(parameter);
    DWORD owner = 0; GetWindowThreadProcessId(hwnd, &owner);
    if (owner != found.pid || GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;
    wchar_t className[256]{}; GetClassNameW(hwnd, className, 256);
    if (std::wstring(className) != L"Qt692QWindowIcon") return TRUE;
    wchar_t title[4096]{}; GetWindowTextW(hwnd, title, 4096);
    if (std::wstring(title).find(L"SteuerSparErklärung") == std::wstring::npos) return TRUE;
    if ((GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_CAPTION) != WS_CAPTION) return TRUE;
    found.windows.push_back(hwnd);
    return TRUE;
}
static Json discoverBinding(const Json &request) {
    PhaseTimer timer(discoveryMs);
    const auto pid = request.at("pid").get<DWORD>();
    if (pid == 0) throw std::runtime_error("Discovery requires an explicitly owned process ID");
    Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid));
    DWORD processSession = 0, ownSession = 0;
    if (!ProcessIdToSessionId(pid, &processSession) || !ProcessIdToSessionId(GetCurrentProcessId(), &ownSession)
        || processSession != ownSession) throw std::runtime_error("Target is outside this Windows session");
    if (WaitForSingleObject(process.value, 0) != WAIT_TIMEOUT) throw std::runtime_error("Target process is no longer running");
    wchar_t image[32768]{}; DWORD imageLength = 32768;
    if (!QueryFullProcessImageNameW(process.value, 0, image, &imageLength)) throw std::runtime_error("Target image unavailable");
    const std::wstring imagePath(image, imageLength);
    if (request.contains("expectedImage") && _wcsicmp(imagePath.c_str(), wide(request.at("expectedImage").get<std::string>()).c_str()))
        throw std::runtime_error("Target image differs from the explicitly configured executable");
    FILETIME created{}, exited{}, kernel{}, user{};
    if (!GetProcessTimes(process.value, &created, &exited, &kernel, &user)) throw std::runtime_error("Target creation time unavailable");
    const auto creationTime = std::to_string((std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime);
    if (request.contains("creationTime") && request.at("creationTime") != creationTime)
        throw std::runtime_error("Target PID creation time changed");
    HWND window = nullptr;
    if (request.contains("hwnd")) window = reinterpret_cast<HWND>(request.at("hwnd").get<std::uint64_t>());
    else {
        DiscoveryWindows found{pid, {}};
        if (!EnumDesktopWindows(GetThreadDesktop(GetCurrentThreadId()), collectSseWindow, reinterpret_cast<LPARAM>(&found)))
            throw std::runtime_error("Could not enumerate the explicitly bound desktop");
        if (found.windows.size() != 1)
            throw std::runtime_error("Expected exactly one SSE main window on the bound desktop; found " + std::to_string(found.windows.size()));
        window = found.windows.front();
    }
    DWORD owner = 0;
    if (!IsWindow(window) || !GetWindowThreadProcessId(window, &owner) || owner != pid)
        throw std::runtime_error("Target window is stale or belongs to another process");
    return {{"pid", pid}, {"hwnd", reinterpret_cast<std::uint64_t>(window)}, {"creationTime", creationTime},
        {"image", narrow(imagePath)}, {"sessionId", processSession}, {"bindingDiscovered", true}};
}
static void verifyRequestedProfile(const Json &request, bool synthetic) {
    // Compatibility is generated from the checked-in native product binding.
    const Json actual = synthetic ? Json({{"id", "synthetic"}, {"qtVersion", "6.9.2"}})
        : Json::parse(SSE_NATIVE_PROFILE_JSON);
    if (!request.contains("expectedProfile")) throw std::runtime_error("Automatic binding requires an explicit product profile");
    if (request.at("expectedProfile") != actual) throw std::runtime_error("Configured product profile does not match the native compatibility binding");
}
