// Diagnostic Win32 read: no UIA, injection, window activation or desktop switching.
#include <algorithm>
struct StatusControllerLease {
    Handle mutex{CreateMutexW(nullptr, FALSE, L"Local\\SteuerSparErklaerungApi.SseWorkerController")};
    StatusControllerLease() {
        const auto wait = WaitForSingleObject(mutex.value, 0);
        if (wait == WAIT_ABANDONED) {
            ReleaseMutex(mutex.value);
            throw DiscoveryError("worker-isolation-lost", "Previous controller ended without releasing its lease");
        }
        if (wait != WAIT_OBJECT_0) throw DiscoveryError("worker-busy", "Another controller holds the worker lease");
    }
    ~StatusControllerLease() { ReleaseMutex(mutex.value); }
};
static Json statusVersion(const std::wstring &path, bool withCompany = false) {
    DWORD ignored = 0;
    const auto size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
    if (!size) return {{"fileMajor", 0}, {"fileVersion", ""}, {"productName", ""}};
    if (size > 1024 * 1024) throw std::runtime_error("Version resource exceeds its bound");
    std::vector<BYTE> bytes(size);
    if (!GetFileVersionInfoW(path.c_str(), 0, size, bytes.data())) throw std::runtime_error("Version resource unavailable");
    VS_FIXEDFILEINFO *fixed = nullptr; UINT fixedSize = 0;
    int major = 0;
    if (VerQueryValueW(bytes.data(), L"\\", reinterpret_cast<void**>(&fixed), &fixedSize)
        && fixedSize >= sizeof(VS_FIXEDFILEINFO) && fixed->dwSignature == 0xfeef04bd) major = HIWORD(fixed->dwFileVersionMS);
    struct Translation { WORD language, codePage; };
    Translation *translations = nullptr; UINT translationSize = 0;
    const auto stringValue = [&](const wchar_t *key) -> std::string {
        if (!VerQueryValueW(bytes.data(), L"\\VarFileInfo\\Translation", reinterpret_cast<void**>(&translations), &translationSize)
            || translationSize < sizeof(Translation)) return "";
        wchar_t query[128]{};
        swprintf_s(query, L"\\StringFileInfo\\%04x%04x\\%s", translations[0].language, translations[0].codePage, key);
        wchar_t *value = nullptr; UINT length = 0;
        if (!VerQueryValueW(bytes.data(), query, reinterpret_cast<void**>(&value), &length) || !length) return "";
        if (length > 4096 || value[length - 1] != L'\0') throw std::runtime_error("Invalid bounded version string");
        return narrow(std::wstring(value, length - 1));
    };
    Json result = {{"fileMajor", major}, {"fileVersion", stringValue(L"FileVersion")}, {"productName", stringValue(L"ProductName")}};
    if (withCompany) result["companyName"] = stringValue(L"CompanyName");
    return result;
}
struct StatusWindows { DWORD pid; Json windows = Json::array(); std::string failure; };
static BOOL CALLBACK collectStatusWindow(HWND window, LPARAM raw) {
    auto &status = *reinterpret_cast<StatusWindows*>(raw);
    try {
        DWORD pid = 0; GetWindowThreadProcessId(window, &pid);
        if (pid != status.pid || !IsWindowVisible(window)) return TRUE;
        if (status.windows.size() >= 256) throw std::runtime_error("Desktop window inventory exceeds its bound");
        wchar_t title[512]{}, name[256]{}; RECT rect{};
        GetWindowTextW(window, title, 512);
        if (!GetClassNameW(window, name, 256)) throw std::runtime_error("Window class unavailable: " + std::to_string(GetLastError()));
        if (!GetWindowRect(window, &rect)) throw std::runtime_error("Window rectangle unavailable: " + std::to_string(GetLastError()));
        status.windows.push_back({{"hwnd", reinterpret_cast<std::uint64_t>(window)}, {"pid", pid},
            {"x", rect.left}, {"y", rect.top}, {"w", rect.right - rect.left}, {"h", rect.bottom - rect.top},
            {"cls", narrow(name)}, {"title", narrow(title)}, {"hung", IsHungAppWindow(window) != FALSE},
            {"minimiert", IsIconic(window) != FALSE}});
        return TRUE;
    } catch (const std::exception &error) { status.failure = error.what(); return FALSE; }
    catch (...) { status.failure = "Unknown window enumeration failure"; return FALSE; }
}
static Json desktopStatus(const Json &request) {
    StatusControllerLease lease;
    const auto desktopName = request.at("desktop").get<std::string>();
    if (desktopName.empty() || desktopName.size() > 64
        || desktopName.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-") != std::string::npos)
        throw DiscoveryError("desktop-marker-invalid", "Invalid diagnostic desktop name");
    const auto rawPid = request.at("pid").get<std::uint64_t>();
    if (rawPid > MAXDWORD) throw DiscoveryError("desktop-marker-invalid", "Invalid diagnostic process ID");
    const auto pid = static_cast<DWORD>(rawPid);
    Json result = {{"ok", true}, {"desktop", desktopName}, {"pid", pid}, {"process", nullptr},
        {"reachable", false}, {"windows", Json::array()}, {"loaderBuildIdentity", SSE_BRIDGE_BUILD_PREFIX SSE_BRIDGE_SOURCE_DIGEST}};
    // Keep the process handle open through enumeration to detect termination/PID reuse.
    HANDLE processRaw = pid ? OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid) : nullptr;
    if (pid && !processRaw && GetLastError() != ERROR_INVALID_PARAMETER)
        throw DiscoveryError("native-binding", "Marked process identity is not readable");
    std::unique_ptr<Handle> process;
    if (processRaw) process = std::make_unique<Handle>(processRaw);
    if (process && WaitForSingleObject(process->value, 0) == WAIT_TIMEOUT) {
        DWORD targetSession = 0, ownSession = 0;
        if (!ProcessIdToSessionId(pid, &targetSession) || !ProcessIdToSessionId(GetCurrentProcessId(), &ownSession)
            || targetSession != ownSession) throw DiscoveryError("native-binding", "Marked process is outside this Windows session");
        wchar_t image[32768]{}; DWORD size = 32768;
        FILETIME created{}, exited{}, kernel{}, user{};
        if (!QueryFullProcessImageNameW(process->value, 0, image, &size)
            || !GetProcessTimes(process->value, &created, &exited, &kernel, &user))
            throw DiscoveryError("native-binding", "Marked process identity changed");
        auto identity = statusVersion(std::wstring(image, size));
        identity["image"] = narrow(std::wstring(image, size));
        identity["creationTime"] = std::to_string((std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime);
        result["process"] = identity;
    }
    const auto desktop = OpenDesktopW(wide(desktopName).c_str(), 0, FALSE, DESKTOP_READOBJECTS);
    if (desktop) {
        result["reachable"] = true;
        StatusWindows status{pid};
        SetLastError(ERROR_SUCCESS);
        const auto enumerated = EnumDesktopWindows(desktop, collectStatusWindow, reinterpret_cast<LPARAM>(&status));
        const auto error = GetLastError();
        CloseDesktop(desktop);
        if (!status.failure.empty()) throw std::runtime_error("Owned desktop inventory failed: " + status.failure);
        // An empty desktop can return FALSE without setting an error (same contract as DSK.ListDesktopWindows).
        if (!enumerated && error != ERROR_SUCCESS)
            throw std::runtime_error("Owned desktop enumeration failed: " + std::to_string(error));
        std::stable_sort(status.windows.begin(), status.windows.end(), [](const Json &a, const Json &b) {
            return a.at("w").get<std::int64_t>() * a.at("h").get<std::int64_t>()
                > b.at("w").get<std::int64_t>() * b.at("h").get<std::int64_t>();
        });
        result["windows"] = status.windows;
    } else if (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_INVALID_HANDLE) {
        throw DiscoveryError("native-binding", "Marked desktop is not readable");
    }
    if (process && WaitForSingleObject(process->value, 0) != WAIT_TIMEOUT) {
        result["process"] = nullptr; result["windows"] = Json::array();
    }
    return result;
}
