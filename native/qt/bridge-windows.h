// Shared Win32 inventory for first discovery and each retained-session context check.
struct NativeWindowInventory {
    std::wstring image, qtClass;
    Json loaded = Json::array(), startup = Json::array();
    bool failed = false;
};
static BOOL CALLBACK collectNativeMainWindow(HWND window, LPARAM raw) {
    auto &inventory = *reinterpret_cast<NativeWindowInventory*>(raw);
    try {
        if (!IsWindowVisible(window) || GetWindow(window, GW_OWNER)) return TRUE;
        wchar_t className[256]{};
        if (!GetClassNameW(window, className, 256) || inventory.qtClass != className) return TRUE;
        RECT bounds{};
        if (!GetWindowRect(window, &bounds)) throw std::runtime_error("Window bounds unavailable");
        if (bounds.right - bounds.left < 900 && !IsIconic(window)) return TRUE;
        wchar_t title[4096]{}; GetWindowTextW(window, title, 4096);
        const bool loaded = std::wstring(title).find(L"SteuerSparErklärung") != std::wstring::npos;
        if (!loaded && std::wstring(title) != L"Steuerprogramm") return TRUE;
        DWORD pid = 0;
        if (!GetWindowThreadProcessId(window, &pid)) throw std::runtime_error("Window process unavailable");
        const auto process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!process) throw std::runtime_error("Window process identity unavailable");
        wchar_t image[32768]{}; DWORD size = 32768;
        const auto queried = QueryFullProcessImageNameW(process, 0, image, &size); CloseHandle(process);
        if (!queried) throw std::runtime_error("Window process image unavailable");
        if (_wcsicmp(inventory.image.c_str(), image) != 0) return TRUE;
        auto &windows = loaded ? inventory.loaded : inventory.startup;
        if (windows.size() >= 64) throw std::runtime_error("Native main-window inventory exceeds its bound");
        windows.push_back({{"pid", pid}, {"hwnd", reinterpret_cast<std::uint64_t>(window)}});
        return TRUE;
    } catch (...) {
        // C++ exceptions must not cross the Win32 callback boundary.
        inventory.failed = true; return FALSE;
    }
}
static Json nativeMainWindows(const std::wstring &image, const std::wstring &qtClass) {
    NativeWindowInventory inventory; inventory.image = image; inventory.qtClass = qtClass;
    if (!EnumDesktopWindows(GetThreadDesktop(GetCurrentThreadId()), collectNativeMainWindow, reinterpret_cast<LPARAM>(&inventory)) || inventory.failed)
        throw std::runtime_error("Native main-window inventory did not complete");
    return inventory.loaded.empty() ? inventory.startup : inventory.loaded;
}
