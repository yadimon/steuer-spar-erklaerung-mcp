#include <algorithm>
#include <cwchar>
#include <cwctype>
#include <map>
#include "bridge-windows.h"
// The kernel's normalised Win32 path, the same source the peer comparison reads, never the loader's launch spelling.
static std::wstring currentProcessImage() {
    wchar_t image[32768]{}; DWORD size = 32768;
    if (!QueryFullProcessImageNameW(GetCurrentProcess(), 0, image, &size) || !size) throw std::runtime_error("Native context image is unavailable");
    return std::wstring(image, size);
}
// Get-SSEProcessIdentity accepts a peer by executable name and install-folder name, never by its full path.
static std::wstring imageIdentity(std::wstring path) {
    std::transform(path.begin(), path.end(), path.begin(), [](wchar_t character) { return std::towlower(character); });
    std::replace(path.begin(), path.end(), L'/', L'\\');
    const auto file = path.rfind(L'\\');
    if (file == std::wstring::npos || file == 0) return path;
    const auto folder = path.rfind(L'\\', file - 1);
    return path.substr(folder == std::wstring::npos ? 0 : folder + 1);
}
static Json windowContext() {
    const auto image = currentProcessImage();
    std::wstring qtClass = L"Qt";
    for (const char *version = qVersion(); *version; ++version) if (*version != '.') qtClass += wchar_t(*version);
    qtClass += L"QWindowIcon";
    const auto windows = nativeMainWindows(image, qtClass);
    const bool bound = std::any_of(windows.begin(), windows.end(), [](const Json &window) {
        return window.at("pid") == GetCurrentProcessId() && window.at("hwnd") == config.window;
    });
    return {{"ok", true}, {"boundMain", bound}, {"unique", bound && windows.size() == 1}, {"windows", windows}};
}

struct ProcessWindowInventory {
    std::wstring identity;
    std::map<DWORD, bool> productProcesses;
    Json windows = Json::array();
    Json untitled = Json::array();
    int visibleCount = 0;
    int productCount = 0;
    int enumerated = 0;
    bool failed = false;
};

// Get-Windows spans every process running the product; a process this one may not open is no product process
// (the worker cannot read its identity either), while an opened process whose image cannot be read ends the inventory.
static bool processRunsProductImage(ProcessWindowInventory &inventory, DWORD pid) {
    const auto known = inventory.productProcesses.find(pid);
    if (known != inventory.productProcesses.end()) return known->second;
    bool same = false;
    if (const auto process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)) {
        wchar_t image[32768]{}; DWORD size = 32768;
        const auto queried = QueryFullProcessImageNameW(process, 0, image, &size); CloseHandle(process);
        if (!queried) throw std::runtime_error("Window process image is unavailable");
        same = imageIdentity(std::wstring(image, size)) == inventory.identity;
    }
    inventory.productProcesses.emplace(pid, same);
    return same;
}

static std::string processWindowUtf8(const wchar_t *value) {
    const auto characters = static_cast<int>(std::wcslen(value));
    const auto size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, characters, nullptr, 0, nullptr, nullptr);
    if (size < 1) throw std::runtime_error("Window text is not valid UTF-16");
    std::string result(static_cast<std::size_t>(size), '\0');
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, characters,
        result.data(), size, nullptr, nullptr) != size) {
        throw std::runtime_error("Window text could not be encoded as UTF-8");
    }
    return result;
}

// The worker treats only shadow classes as harmless; Qt popups and tooltips carry "DropShadow" as well.
static bool processWindowIgnoredClass(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character) { return std::towlower(character); });
    return value.find(L"shadow") != std::wstring::npos;
}

static BOOL CALLBACK collectProcessWindow(HWND window, LPARAM raw) {
    auto &inventory = *reinterpret_cast<ProcessWindowInventory*>(raw);
    try {
        if (!IsWindowVisible(window)) return TRUE;
        DWORD pid = 0;
        if (!GetWindowThreadProcessId(window, &pid)) throw std::runtime_error("Window process is unavailable");
        const bool own = pid == GetCurrentProcessId();
        if (!own && !processRunsProductImage(inventory, pid)) return TRUE;
        // The worker's page count spans every product process and includes untitled, shadow and tooltip windows;
        // keep both populations countable while only this process's windows are listed and classified.
        ++inventory.productCount;
        if (!own) return TRUE;
        ++inventory.visibleCount;
        wchar_t className[256]{};
        if (!GetClassNameW(window, className, 256)) throw std::runtime_error("Window class is unavailable");
        if (processWindowIgnoredClass(className)) return TRUE;
        // Get-Windows orders equal-area windows by enumeration (Z) order; the index keeps that order readable.
        const int order = inventory.enumerated++;
        wchar_t title[4096]{};
        const bool titled = GetWindowTextW(window, title, 4096) && title[0];
        // An untitled window that is no shadow window cannot be classified by title; list it separately.
        auto &target = titled ? inventory.windows : inventory.untitled;
        if (target.size() >= 256) throw std::runtime_error("Process window inventory exceeds its bound");
        RECT bounds{};
        if (!GetWindowRect(window, &bounds)) throw std::runtime_error("Window bounds are unavailable");
        Json entry = {{"hwnd", reinterpret_cast<std::uint64_t>(window)}, {"order", order}, {"pid", pid},
            {"class", processWindowUtf8(className)},
            {"x", static_cast<int>(bounds.left)}, {"y", static_cast<int>(bounds.top)},
            {"w", static_cast<int>(bounds.right - bounds.left)}, {"h", static_cast<int>(bounds.bottom - bounds.top)},
            {"minimized", IsIconic(window) != FALSE}, {"hung", IsHungAppWindow(window) != FALSE}};
        if (titled) entry["title"] = processWindowUtf8(title);
        target.push_back(std::move(entry));
        return TRUE;
    } catch (...) {
        inventory.failed = true;
        return FALSE;
    }
}

static Json processWindowInventory() {
    ProcessWindowInventory inventory;
    inventory.identity = imageIdentity(currentProcessImage());
    if (!EnumDesktopWindows(GetThreadDesktop(GetCurrentThreadId()), collectProcessWindow,
        reinterpret_cast<LPARAM>(&inventory)) || inventory.failed) {
        throw std::runtime_error("Process window inventory did not complete");
    }
    const auto byHandle = [](const Json &left, const Json &right) {
        return left.at("hwnd").get<std::uint64_t>() < right.at("hwnd").get<std::uint64_t>();
    };
    std::stable_sort(inventory.windows.begin(), inventory.windows.end(), byHandle);
    std::stable_sort(inventory.untitled.begin(), inventory.untitled.end(), byHandle);
    return {{"ok", true}, {"windows", std::move(inventory.windows)}, {"untitledWindows", std::move(inventory.untitled)},
        {"visibleWindowCount", inventory.visibleCount}, {"productWindowCount", inventory.productCount}};
}
