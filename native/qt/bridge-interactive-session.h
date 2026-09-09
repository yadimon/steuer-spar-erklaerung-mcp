// Read-only observation; never switches or activates a desktop.
static Json interactiveSession() {
    DWORD session = 0, foregroundPid = 0, foregroundSession = 0;
    if (!ProcessIdToSessionId(GetCurrentProcessId(), &session)) throw std::runtime_error("Current session unavailable");
    USEROBJECTFLAGS flags{}; DWORD required = 0;
    if (!GetUserObjectInformationW(GetProcessWindowStation(), UOI_FLAGS, &flags, sizeof(flags), &required))
        throw std::runtime_error("Window station visibility unavailable");
    const auto window = GetForegroundWindow();
    if (!window || !GetWindowThreadProcessId(window, &foregroundPid) || !foregroundPid
        || !ProcessIdToSessionId(foregroundPid, &foregroundSession)) throw std::runtime_error("Foreground session unavailable");
    DWORD verifiedPid = 0;
    if (GetForegroundWindow() != window || !GetWindowThreadProcessId(window, &verifiedPid) || verifiedPid != foregroundPid)
        throw std::runtime_error("Foreground identity changed during observation");
    return {{"ok", true}, {"userInteractive", (flags.dwFlags & WSF_VISIBLE) != 0},
        {"sessionId", session}, {"foregroundHwnd", reinterpret_cast<std::uintptr_t>(window)},
        {"foregroundPid", foregroundPid}, {"foregroundSessionId", foregroundSession}};
}
