#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <shellapi.h>
#include <fstream>
#include <string>
#include <nlohmann/json.hpp>

static std::wstring fixtureMode, probePath;
static HWND primaryWindow = nullptr, initialWindow = nullptr;
static void writeProbe(const char *phase) {
    if (probePath.empty()) return;
    std::ofstream output(probePath.c_str());
    output << nlohmann::json({{"pid", GetCurrentProcessId()}, {"phase", phase},
        {"hwnd", reinterpret_cast<std::uint64_t>(primaryWindow)},
        {"initialHwnd", reinterpret_cast<std::uint64_t>(initialWindow)}}).dump();
    output.flush();
}
static HWND createFixtureWindow(const wchar_t *title, bool compact, HWND owner = nullptr) {
    return CreateWindowW(L"SseNativeStartFixture", title, WS_OVERLAPPEDWINDOW, 0, 0,
        compact ? 500 : 1200, compact ? 300 : 800, owner, nullptr, GetModuleHandleW(nullptr), nullptr);
}
static LRESULT CALLBACK fixtureWindow(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == WM_CLOSE) { DestroyWindow(window); return 0; }
    if (message == WM_TIMER && wparam == 2) {
        KillTimer(window, 2);
        if (fixtureMode == L"-mmorph") {
            SetWindowTextW(window, L"SteuerSparErklärung – synthetic startup");
            SetWindowPos(window, nullptr, 0, 0, 1200, 800, SWP_NOACTIVATE | SWP_NOZORDER);
        } else {
            primaryWindow = createFixtureWindow(L"SteuerSparErklärung – synthetic startup", fixtureMode == L"-msplashdialog");
            if (!primaryWindow) { PostQuitMessage(7); return 0; }
            ShowWindow(primaryWindow, SW_SHOWNOACTIVATE);
            SetTimer(primaryWindow, 1, 30000, nullptr);
            DestroyWindow(window);
        }
        writeProbe(fixtureMode == L"-msplashdialog" ? "dialog" : "main");
        return 0;
    }
    if (message == WM_TIMER) { DestroyWindow(window); return 0; }
    if (message == WM_DESTROY) { if (window == primaryWindow) PostQuitMessage(0); return 0; }
    return DefWindowProcW(window, message, wparam, lparam);
}
static int runFixture(int argc, wchar_t **argv) {
    if (argc < 2 || argc > 3) return 2;
    const std::wstring mode = argv[1];
    fixtureMode = mode;
    if (argc == 3) probePath = argv[2];
    writeProbe("started");
    if (mode == L"-mexit") return 3;
    if (mode == L"-mhang") { Sleep(60000); return 4; }
    WNDCLASSW definition{}; definition.lpfnWndProc = fixtureWindow; definition.hInstance = GetModuleHandleW(nullptr);
    definition.lpszClassName = L"SseNativeStartFixture";
    if (!RegisterClassW(&definition)) return 5;
    const bool productDialog = mode == L"-mproductdialog";
    const bool dialog = mode == L"-mdialog" || productDialog;
    const bool splash = mode == L"-msplash" || mode == L"-mmorph" || mode == L"-msplashdialog";
    // A delayed WM_TIMER must not let the first HWND satisfy case readiness.
    // Keep replacement's first broad frame generic until the new case window.
    const bool replacement = mode == L"-mreplace";
    const auto title = (dialog && !productDialog) || splash || replacement ? L"Steuerprogramm" : L"SteuerSparErklärung – synthetic startup";
    const auto window = createFixtureWindow(title, dialog || splash);
    if (!window) return 6;
    primaryWindow = initialWindow = window;
    ShowWindow(window, SW_SHOWNOACTIVATE);
    SetTimer(window, 1, 30000, nullptr);
    if (splash || mode == L"-mreplace") SetTimer(window, 2, splash ? 750 : 250, nullptr);
    if (mode == L"-mblocked" || mode == L"-mambiguous") {
        const auto other = createFixtureWindow(L"SteuerSparErklärung – synthetic second window", mode == L"-mblocked",
            mode == L"-mblocked" ? window : nullptr);
        if (!other) return 8;
        ShowWindow(other, SW_SHOWNOACTIVATE);
    }
    writeProbe("initial");
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
    return 0;
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    int argc = 0;
    auto argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv) return 9;
    const auto result = runFixture(argc, argv);
    LocalFree(argv);
    return result;
}
