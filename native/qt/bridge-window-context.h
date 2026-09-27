#include <algorithm>
#include <cwchar>
#include <cwctype>
#include "bridge-windows.h"
static Json windowContext() {
    wchar_t image[32768]{};
    const auto size = GetModuleFileNameW(nullptr, image, 32768);
    if (!size || size >= 32768) throw std::runtime_error("Native context image is unavailable");
    std::wstring qtClass = L"Qt";
    for (const char *version = qVersion(); *version; ++version) if (*version != '.') qtClass += wchar_t(*version);
    qtClass += L"QWindowIcon";
    const auto windows = nativeMainWindows(std::wstring(image, size), qtClass);
    const bool bound = std::any_of(windows.begin(), windows.end(), [](const Json &window) {
        return window.at("pid") == GetCurrentProcessId() && window.at("hwnd") == config.window;
    });
    return {{"ok", true}, {"boundMain", bound}, {"unique", bound && windows.size() == 1}, {"windows", windows}};
}

struct ProcessWindowInventory {
    Json windows = Json::array();
    int visibleCount = 0;
    bool failed = false;
};

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

static bool processWindowIgnoredClass(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character) { return std::towlower(character); });
    return value.find(L"tooltip") != std::wstring::npos || value.find(L"shadow") != std::wstring::npos
        || value.find(L"popup") != std::wstring::npos;
}

static BOOL CALLBACK collectProcessWindow(HWND window, LPARAM raw) {
    auto &inventory = *reinterpret_cast<ProcessWindowInventory*>(raw);
    try {
        if (!IsWindowVisible(window)) return TRUE;
        DWORD pid = 0;
        if (!GetWindowThreadProcessId(window, &pid)) throw std::runtime_error("Window process is unavailable");
        if (pid != GetCurrentProcessId()) return TRUE;
        // The worker's window count includes untitled, shadow and tooltip windows; keep that population countable.
        ++inventory.visibleCount;
        wchar_t title[4096]{};
        if (!GetWindowTextW(window, title, 4096) || !title[0]) return TRUE;
        wchar_t className[256]{};
        if (!GetClassNameW(window, className, 256)) throw std::runtime_error("Window class is unavailable");
        if (processWindowIgnoredClass(className)) return TRUE;
        if (inventory.windows.size() >= 256) throw std::runtime_error("Process window inventory exceeds its bound");
        RECT bounds{};
        if (!GetWindowRect(window, &bounds)) throw std::runtime_error("Window bounds are unavailable");
        inventory.windows.push_back({{"hwnd", reinterpret_cast<std::uint64_t>(window)}, {"pid", pid},
            {"class", processWindowUtf8(className)}, {"title", processWindowUtf8(title)},
            {"x", static_cast<int>(bounds.left)}, {"y", static_cast<int>(bounds.top)},
            {"w", static_cast<int>(bounds.right - bounds.left)}, {"h", static_cast<int>(bounds.bottom - bounds.top)},
            {"minimized", IsIconic(window) != FALSE}, {"hung", IsHungAppWindow(window) != FALSE}});
        return TRUE;
    } catch (...) {
        inventory.failed = true;
        return FALSE;
    }
}

static Json processWindowInventory() {
    ProcessWindowInventory inventory;
    if (!EnumDesktopWindows(GetThreadDesktop(GetCurrentThreadId()), collectProcessWindow,
        reinterpret_cast<LPARAM>(&inventory)) || inventory.failed) {
        throw std::runtime_error("Process window inventory did not complete");
    }
    std::stable_sort(inventory.windows.begin(), inventory.windows.end(), [](const Json &left, const Json &right) {
        return left.at("hwnd").get<std::uint64_t>() < right.at("hwnd").get<std::uint64_t>();
    });
    return {{"ok", true}, {"windows", std::move(inventory.windows)}, {"visibleWindowCount", inventory.visibleCount}};
}
