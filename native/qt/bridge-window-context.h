struct NativeWindowInventory {
    std::wstring image, qtClass;
    Json loaded = Json::array(), startup = Json::array();
    bool failed = false;
};
static BOOL CALLBACK collectNativeMainWindow(HWND window, LPARAM raw) {
    auto &inventory = *reinterpret_cast<NativeWindowInventory*>(raw);
    if (!IsWindowVisible(window) || GetWindow(window, GW_OWNER)) return TRUE;
    wchar_t className[256]{};
    if (!GetClassNameW(window, className, 256) || inventory.qtClass != className) return TRUE;
    RECT bounds{};
    if (!GetWindowRect(window, &bounds)) { inventory.failed = true; return FALSE; }
    if (bounds.right - bounds.left < 900 && !IsIconic(window)) return TRUE;
    wchar_t title[4096]{}; GetWindowTextW(window, title, 4096);
    const bool loaded = std::wstring(title).find(L"SteuerSparErklärung") != std::wstring::npos;
    if (!loaded && std::wstring(title) != L"Steuerprogramm") return TRUE;
    DWORD pid = 0;
    if (!GetWindowThreadProcessId(window, &pid)) { inventory.failed = true; return FALSE; }
    const auto process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) { inventory.failed = true; return FALSE; }
    wchar_t image[32768]{}; DWORD size = 32768;
    const auto queried = QueryFullProcessImageNameW(process, 0, image, &size); CloseHandle(process);
    if (!queried) { inventory.failed = true; return FALSE; }
    if (_wcsicmp(inventory.image.c_str(), image) != 0) return TRUE;
    auto &windows = loaded ? inventory.loaded : inventory.startup;
    if (windows.size() >= 64) { inventory.failed = true; return FALSE; }
    windows.push_back({{"pid", pid}, {"hwnd", reinterpret_cast<std::uint64_t>(window)}});
    return TRUE;
}
static Json windowContext() {
    NativeWindowInventory inventory;
    wchar_t image[32768]{};
    const auto size = GetModuleFileNameW(nullptr, image, 32768);
    if (!size || size >= 32768) throw std::runtime_error("Native context image is unavailable");
    inventory.image.assign(image, size); inventory.qtClass = L"Qt";
    for (const char *version = qVersion(); *version; ++version) if (*version != '.') inventory.qtClass += wchar_t(*version);
    inventory.qtClass += L"QWindowIcon";
    if (!EnumDesktopWindows(GetThreadDesktop(GetCurrentThreadId()), collectNativeMainWindow, reinterpret_cast<LPARAM>(&inventory)) || inventory.failed)
        throw std::runtime_error("Native main-window inventory did not complete");
    const auto &windows = inventory.loaded.empty() ? inventory.startup : inventory.loaded;
    const bool bound = std::any_of(windows.begin(), windows.end(), [](const Json &window) {
        return window.at("pid") == GetCurrentProcessId() && window.at("hwnd") == config.window;
    });
    return {{"ok", true}, {"boundMain", bound}, {"unique", bound && windows.size() == 1}, {"windows", windows}};
}
