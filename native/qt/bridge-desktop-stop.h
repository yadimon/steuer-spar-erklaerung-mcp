#include "bridge-stop-uia.h"
#include "bridge-stop-policy.h"

struct StopDesktop {
    HDESK value = nullptr;
    HDESK previous = GetThreadDesktop(GetCurrentThreadId());
    explicit StopDesktop(const std::string &name) {
        value = OpenDesktopW(wide(name).c_str(), 0, FALSE, GENERIC_ALL);
        if (!value || !SetThreadDesktop(value)) {
            if (value) CloseDesktop(value);
            throw DiscoveryError("ownership", "Cannot bind helper thread to the marked desktop");
        }
    }
    ~StopDesktop() { SetThreadDesktop(previous); CloseDesktop(value); }
};
static void stopLiveHandle(HANDLE process) {
    if (WaitForSingleObject(process, 0) != WAIT_TIMEOUT) throw DiscoveryError("ownership", "Owned process is no longer alive");
}
static bool stopExited(HANDLE process, DWORD wait = 0) {
    const auto status = WaitForSingleObject(process, wait);
    if (status == WAIT_OBJECT_0) return true;
    if (status != WAIT_TIMEOUT) throw DiscoveryError("state-unknown", "Owned process wait failed");
    return false;
}
static HWND stopHwnd(const Json &window) { return reinterpret_cast<HWND>(window.at("hwnd").get<std::uint64_t>()); }
static void stopWindowIdentity(HDESK desktop, DWORD pid, const Json &expected) {
    bool found = false;
    for (const auto &window : launchWindows(desktop, pid)) if (window.at("hwnd") == expected.at("hwnd")) {
        if (window != expected) throw DiscoveryError("state-unknown", "Owned window changed before closing");
        found = true;
    }
    if (!found || !IsWindow(stopHwnd(expected))) throw DiscoveryError("ownership", "Owned window disappeared before closing");
}
static Json nativeDesktopStop(const Json &request) {
    Json result = {{"ok", false}, {"hartBeendet", false}, {"desktopMarkeEntfernt", false}, {"markerBeibehalten", true},
        {"mutationAttempted", false}, {"outcomeUnknown", false}, {"processExited", false}, {"speichernAntwort", nullptr},
        {"antwortMethode", nullptr}, {"dialogFehler", nullptr}, {"gracefulWaitMs", 0}, {"hauptfensterVorher", 0},
        {"hilfsfenster", Json::array()}, {"loaderBuildIdentity", SSE_BRIDGE_BUILD_PREFIX SSE_BRIDGE_SOURCE_DIGEST}};
    try {
        const bool discard = request.value("discardChanges", false), save = request.value("save", false);
        result["discardChanges"] = discard;
        // The caller supplies its absolute deadline, so helper startup and hashing consume the same budget.
        const auto wallNow = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        const auto remaining = request.at("deadlineUnixMs").get<std::int64_t>() - wallNow;
        if (remaining < 1 || remaining > 120000) throw DiscoveryError("native-deadline", "Stop deadline is expired or outside its bound");
        const auto deadline = StopClock::now() + std::chrono::milliseconds(remaining);
        const auto reserve = [&](int milliseconds) {
            if (StopClock::now() + std::chrono::milliseconds(milliseconds) >= deadline)
                throw DiscoveryError("native-deadline", "Insufficient time remains for a mutation and confirmed process exit");
        };
        if (save && discard) throw DiscoveryError("bad-args", "Save and discard cannot both be requested");
        if (save) throw DiscoveryError("confirmation-required", "Use hash-bound save before stopping; close never saves a case");
        const auto name = request.at("desktop").get<std::string>();
        const auto rawPid = request.at("pid").get<std::uint64_t>();
        const auto waitMs = request.at("waitMs").get<int>();
        if (!nativeDesktopName(name) || !rawPid || rawPid > MAXDWORD || waitMs < 1 || waitMs > 12000)
            throw DiscoveryError("bad-args", "Invalid bounded desktop stop arguments");
        result["desktop"] = name; result["pid"] = rawPid;
        const auto pid = static_cast<DWORD>(rawPid);
        StatusControllerLease lease;
        const auto markerPath = launchPath(request, "markerPath");
        auto marker = readNativeMarker(markerPath);
        if (marker.value.is_null() || marker.value.at("owner") != "sse" || marker.value.at("name") != name || marker.value.at("pid") != pid)
            throw DiscoveryError("ownership", "Locked desktop marker differs from the requested ownership");
        // Retain this exact process object through UI calls, exit observation and optional explicit discard termination.
        Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE | (discard ? PROCESS_TERMINATE : 0), FALSE, pid));
        stopLiveHandle(process.value);
        DWORD targetSession = 0, ownSession = 0;
        if (!ProcessIdToSessionId(pid, &targetSession) || !ProcessIdToSessionId(GetCurrentProcessId(), &ownSession) || targetSession != ownSession)
            throw DiscoveryError("ownership", "Marked process is outside the helper's Windows session");
        wchar_t path[32768]{}; DWORD size = 32768; FILETIME birth{}, exited{}, kernel{}, user{};
        if (!QueryFullProcessImageNameW(process.value, 0, path, &size) || !GetProcessTimes(process.value, &birth, &exited, &kernel, &user))
            throw DiscoveryError("ownership", "Marked process identity is unavailable");
        const std::wstring image(path, size), expectedImage = launchPath(request, "expectedImage");
        const auto creation = std::to_string((std::uint64_t(birth.dwHighDateTime) << 32) | birth.dwLowDateTime);
        if (_wcsicmp(image.c_str(), expectedImage.c_str()) || (request.contains("creationTime") && request.at("creationTime") != creation))
            throw DiscoveryError("ownership", "Marked process image or creation time differs");
        bool synthetic = false;
#ifdef SSE_NATIVE_STOP_TEST
        synthetic = request.at("expectedProfile").value("id", "") == "synthetic" && name.rfind("SSEStopTest_", 0) == 0
            && stopEqual(image.substr(image.find_last_of(L"\\/") + 1), L"bridge-stop-fixture.exe");
#endif
        verifyRequestedProfile(request, synthetic);
        Handle executable(CreateFileW(image.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
        if (!synthetic && sha256(image) != SSE_NATIVE_EXE_SHA256)
            throw DiscoveryError("unsupported-version", "Marked process differs from the compiled product pin");
        StopDesktop desktop(name);
        auto windows = launchWindows(desktop.value, pid);
        if (windows.empty()) throw DiscoveryError("ownership", "Marked process has no window on its owned desktop");
        const auto parent = parentProcessId(); Handle owner(OpenProcess(SYNCHRONIZE, FALSE, parent));
        if (!parent || parentProcessId() != parent) throw DiscoveryError("ownership", "Caller process identity changed");
        const auto checkMutation = [&] { stopLiveHandle(process.value); stopLiveHandle(owner.value); };
        const auto postClose = [&](const Json &window) {
            stopWindowIdentity(desktop.value, pid, window); checkMutation();
            reserve(6000);
            if (!IsWindowEnabled(stopHwnd(window))) throw DiscoveryError("dialog-open", "Owned window became disabled before close submission");
            if (!PostMessageW(stopHwnd(window), WM_CLOSE, 0, 0)) throw DiscoveryError("state-unknown", "Close submission failed");
            result["mutationAttempted"] = true;
        };
        Json main = nullptr;
        for (const auto &window : windows) if (stopMain(window)) { main = window; result["hauptfensterVorher"] = result["hauptfensterVorher"].get<int>() + 1; }
        if (result.at("hauptfensterVorher") > 1) throw DiscoveryError("ambiguous", "More than one main window is present");
        if (main.is_null() && !discard) throw DiscoveryError("confirmation-required", "No main window; explicit discard is required to terminate the owned process");
        const auto gracefulStart = StopClock::now();
        if (!main.is_null()) {
            reserve(6000);
            StopAutomation uia(pid, std::min(StopClock::now() + std::chrono::seconds(6), deadline - std::chrono::seconds(6)));
            const auto dirty = uia.dirty(stopHwnd(main)); result["ungespeichert"] = dirty;
            if (dirty.is_null() && !discard) throw DiscoveryError("state-unknown", "Save state is unreadable; nothing was closed");
            if (dirty == true && !discard) throw DiscoveryError("confirmation-required", "Unsaved changes require hash-bound save or explicit discard");
            for (const auto &window : windows) {
                if (window.at("hwnd") == main.at("hwnd") || stopIgnored(window)) continue;
                if (!stopSafeAuxiliary(window)) throw DiscoveryError("dialog-open", "A pre-existing window must be read and answered separately before stopping");
                if (stopTransmission(wide(window.at("title").get<std::string>())))
                    throw DiscoveryError("blocked", "Auxiliary window has transmission-related content");
                if (stopAuxiliaryNeedsTree(window) && stopBlockedTree(uia.tree(stopHwnd(window)), window))
                    throw DiscoveryError("blocked", "Auxiliary window exposes transmission-related content");
            }
            if (!IsWindowEnabled(stopHwnd(main)) || main.at("hung") == true)
                throw DiscoveryError("dialog-open", "Main window is disabled or unresponsive");
            // Re-inventory immediately before any close. No newly appearing auxiliary/dialog may be adopted.
            if (launchWindows(desktop.value, pid) != windows) throw DiscoveryError("state-unknown", "Owned window inventory changed");
            if (!discard && uia.dirty(stopHwnd(main)) != false) throw DiscoveryError("state-unknown", "Clean save state changed before closing");
            for (const auto &window : windows) {
                if (window.at("hwnd") == main.at("hwnd") || !stopSafeAuxiliary(window)) continue;
                postClose(window);
                const auto auxLimit = StopClock::now() + std::chrono::milliseconds(350);
                while (IsWindow(stopHwnd(window)) && StopClock::now() < auxLimit && !stopExited(process.value, 25)) {}
                result["hilfsfenster"].push_back({{"hwnd", window.at("hwnd")}, {"title", window.at("title")},
                    {"closedBeforeMain", !IsWindow(stopHwnd(window))}, {"closed", false}});
            }
            // An auxiliary close may itself open a modal. Never queue the main close through a disabled window.
            if (!IsWindowEnabled(stopHwnd(main))) throw DiscoveryError("dialog-open", "An auxiliary close disabled the main window");
            for (const auto &window : launchWindows(desktop.value, pid)) {
                if (window.at("hwnd") == main.at("hwnd") || stopIgnored(window)) continue;
                if (std::find(windows.begin(), windows.end(), window) == windows.end())
                    throw DiscoveryError("dialog-open", "An auxiliary close opened a new window");
            }
            postClose(main); result["closeSubmitted"] = true;
            const auto limit = std::min(StopClock::now() + std::chrono::milliseconds(waitMs), deadline - std::chrono::seconds(6));
            std::set<std::uint64_t> answered;
            while (!stopExited(process.value, 25) && StopClock::now() < limit) {
                if (!discard) continue;
                for (const auto &window : launchWindows(desktop.value, pid)) {
                    if (window.at("hwnd") == main.at("hwnd") || stopIgnored(window) || stopSafeAuxiliary(window)) continue;
                    const auto handle = window.at("hwnd").get<std::uint64_t>();
                    if (answered.count(handle)) continue; // A delivered invocation is never repeated for this HWND.
                    if (answered.size() >= 3) throw DiscoveryError("confirmation-required", "Close dialog round limit reached");
                    uia.deadline = std::min(limit, StopClock::now() + std::chrono::seconds(4));
                    const auto first = uia.tree(stopHwnd(window));
                    if (stopBlockedTree(first, window)) throw DiscoveryError("blocked", "Close dialog has transmission-related content");
                    const auto selected = stopDiscardButton(first);
                    if (!selected) throw DiscoveryError("confirmation-required", "Close dialog exposes no unique permitted discard button");
                    const auto fresh = uia.tree(stopHwnd(window));
                    if (first.state != fresh.state || stopDiscardButton(fresh) != selected)
                        throw DiscoveryError("state-unknown", "Close dialog content changed before invocation");
                    const auto pattern = uia.invokePattern(fresh.elements[*selected]);
                    stopWindowIdentity(desktop.value, pid, window); checkMutation();
                    reserve(6000);
                    answered.insert(handle); result["mutationAttempted"] = true;
                    const auto invoked = pattern->Invoke();
                    if (FAILED(invoked)) throw DiscoveryError("state-unknown", "Discard invocation outcome is unknown; do not invoke again");
                    result["speichernAntwort"] = narrow(fresh.elements[*selected].name); result["antwortMethode"] = "uia-invoke";
                    break;
                }
            }
            result["gracefulWaitMs"] = std::chrono::duration<double, std::milli>(StopClock::now() - gracefulStart).count();
        }
        if (!stopExited(process.value)) {
            if (!discard) throw DiscoveryError("confirmation-required", "SSE remained open; explicit discard is required for force termination");
            checkMutation(); reserve(5500); result["mutationAttempted"] = true;
            if (!TerminateProcess(process.value, 1)) throw DiscoveryError("still-running", "Owned process termination could not be submitted");
            result["hartBeendet"] = true;
            if (!stopExited(process.value, 5000)) throw DiscoveryError("still-running", "Owned process did not exit after explicit discard termination");
        }
        result["processExited"] = true;
        for (auto &aux : result["hilfsfenster"]) aux["closed"] = !IsWindow(stopHwnd(aux));
        deleteNativeMarker(marker);
        result["desktopMarkeEntfernt"] = readNativeMarker(markerPath).value.is_null();
        if (result.at("desktopMarkeEntfernt") != true) throw DiscoveryError("marker-cleanup", "Marker deletion readback failed");
        result["markerBeibehalten"] = false; result["ok"] = true;
    } catch (const DiscoveryError &error) {
        result["kind"] = error.kind; result["error"] = error.what();
    } catch (const std::exception &) {
        result["kind"] = "state-unknown"; result["error"] = "Native desktop stop could not complete its bounded ownership checks";
    }
    result["outcomeUnknown"] = result.at("mutationAttempted") == true && result.at("processExited") != true;
    return result;
}
