#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <fstream>
#include <string>
#include <nlohmann/json.hpp>

static LRESULT CALLBACK fixtureWindow(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == WM_CLOSE) { DestroyWindow(window); return 0; }
    if (message == WM_TIMER) { DestroyWindow(window); return 0; }
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(window, message, wparam, lparam);
}
int wmain(int argc, wchar_t **argv) {
    if (argc < 2 || argc > 3) return 2;
    const std::wstring mode = argv[1];
    if (argc == 3) {
        std::ofstream output(argv[2]);
        output << nlohmann::json({{"pid", GetCurrentProcessId()}}).dump();
        output.flush();
    }
    if (mode == L"-mexit") return 3;
    if (mode == L"-mhang") { Sleep(60000); return 4; }
    WNDCLASSW definition{}; definition.lpfnWndProc = fixtureWindow; definition.hInstance = GetModuleHandleW(nullptr);
    definition.lpszClassName = L"SseNativeStartFixture";
    if (!RegisterClassW(&definition)) return 5;
    const bool dialog = mode == L"-mdialog";
    const auto title = dialog ? L"Steuerprogramm" : L"SteuerSparErklärung – synthetic startup";
    const auto window = CreateWindowW(definition.lpszClassName, title, WS_OVERLAPPEDWINDOW, 0, 0,
        dialog ? 500 : 1200, dialog ? 300 : 800, nullptr, nullptr, definition.hInstance, nullptr);
    if (!window) return 6;
    ShowWindow(window, SW_SHOWNOACTIVATE);
    SetTimer(window, 1, 30000, nullptr);
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
    return 0;
}
