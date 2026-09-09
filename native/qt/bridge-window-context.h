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
