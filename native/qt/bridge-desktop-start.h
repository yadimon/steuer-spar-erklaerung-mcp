#include "bridge-desktop-marker.h"
#include "bridge-desktop-launch.h"
#include <regex>

static void verifyLaunchCase(const std::wstring &path, const std::string &mode, const Json &profile) {
    if (path.empty()) return;
    const auto name = path.substr(path.find_last_of(L"\\") + 1);
    // The profile owns the type inventory. Anchored ASCII year parsing matches supported SSE filenames.
    const std::wregex extension(LR"(\.([A-Za-z]+)([0-9]{4})(_Backup)?$)", std::regex_constants::icase);
    std::wsmatch match;
    if (!std::regex_search(name, match, extension)) throw DiscoveryError("unsupported-case", "Case extension is not supported");
    const auto type = match[1].str(); bool supportedType = false;
    for (const auto &candidate : profile.at("startModes"))
        if (_wcsicmp(type.c_str(), wide(candidate.get<std::string>()).c_str()) == 0) supportedType = true;
    if (!supportedType) throw DiscoveryError("unsupported-case", "Case type is not part of this profile");
    if (_wcsicmp(type.c_str(), wide(profile.at("startModes").at(mode).get<std::string>()).c_str()) != 0)
        throw DiscoveryError("mode-mismatch", "Case type differs from the requested start mode");
    const auto year = std::stoi(match[2].str()); bool allowedYear = year == profile.at("taxYear").get<int>();
    if (profile.at("additionalCaseYears").contains(mode))
        for (const auto &candidate : profile.at("additionalCaseYears").at(mode)) if (candidate == year) allowedYear = true;
    if (!allowedYear) throw DiscoveryError("unsupported-year", "Case year is not allowed for this start mode");
}

static void checkLaunchMarker(const std::wstring &path, const std::wstring &expectedImage) {
    auto marker = readNativeMarker(path);
    if (marker.value.is_null()) return;
    if (marker.value.at("owner") != "sse") throw DiscoveryError("desktop-marker-owner", "Desktop belongs to a different controller");
    if (marker.value.at("pid").is_null()) throw DiscoveryError("stale-marker", "Legacy desktop marker has no verifiable process identity");
    const auto pid = marker.value.at("pid").get<DWORD>();
    const auto raw = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid);
    if (raw) {
        Handle process(raw);
        if (WaitForSingleObject(raw, 0) == WAIT_TIMEOUT) {
            wchar_t image[32768]{}; DWORD size = 32768;
            if (QueryFullProcessImageNameW(raw, 0, image, &size) && _wcsicmp(image, expectedImage.c_str()) == 0)
                throw DiscoveryError("desktop-active", "An owned SSE process is already running");
            throw DiscoveryError("stale-marker", "The marked process is alive but cannot be adopted");
        }
    } else if (GetLastError() != ERROR_INVALID_PARAMETER) throw DiscoveryError("stale-marker", "Marked process state cannot be verified");
    const auto desktop = OpenDesktopW(wide(marker.value.at("name").get<std::string>()).c_str(), 0, FALSE, DESKTOP_READOBJECTS);
    if (desktop) {
        // A remaining visible window makes reuse uncertain even if its old PID has died.
        bool occupied = false;
        SetLastError(ERROR_SUCCESS);
        const auto enumerated = EnumDesktopWindows(desktop, [](HWND window, LPARAM rawOccupied) -> BOOL {
            if (IsWindowVisible(window)) *reinterpret_cast<bool*>(rawOccupied) = true;
            return TRUE;
        }, reinterpret_cast<LPARAM>(&occupied));
        const auto error = GetLastError(); CloseDesktop(desktop);
        if (occupied || (!enumerated && error != ERROR_SUCCESS)) throw DiscoveryError("desktop-occupied", "Stale owned desktop is not demonstrably empty");
    } else if (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_INVALID_HANDLE)
        throw DiscoveryError("stale-marker", "Stale desktop cannot be inspected");
    deleteNativeMarker(marker);
}
static Json nativeDesktopStart(const Json &request) {
    StatusControllerLease lease;
    const auto name = request.at("desktop").get<std::string>();
    const auto mode = request.at("startMode").get<std::string>();
    const auto timeout = request.at("waitMs").get<int>();
    if (!nativeDesktopName(name) || timeout < 1 || timeout > 90000
        || mode.empty() || mode.find_first_not_of("abcdefghijklmnopqrstuvwxyz") != std::string::npos)
        throw DiscoveryError("bad-args", "Invalid native desktop start arguments");
    const auto image = launchPath(request, "expectedImage"), markerPath = launchPath(request, "markerPath");
    const auto base = image.substr(image.find_last_of(L"\\") + 1), folder = image.substr(0, image.find_last_of(L"\\"));
    bool synthetic = false;
#ifdef SSE_NATIVE_START_TEST
    synthetic = request.at("expectedProfile").value("id", "") == "synthetic"
        && (_wcsicmp(base.c_str(), L"bridge-start-fixture.exe") == 0 || _wcsicmp(base.c_str(), L"SSE.exe") == 0);
#endif
    verifyRequestedProfile(request, synthetic);
    const auto profile = Json::parse(SSE_NATIVE_START_PROFILE_JSON);
    const auto executableRaw = CreateFileW(image.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (executableRaw == INVALID_HANDLE_VALUE) throw DiscoveryError("unsupported-version", "Configured executable is not readable");
    Handle executableFile(executableRaw);
    if (!synthetic && (_wcsicmp(base.c_str(), L"SSE.exe") != 0 || sha256(image) != SSE_NATIVE_EXE_SHA256))
        throw DiscoveryError("unsupported-version", "Executable differs from the pinned supported SSE image");
    if (!synthetic && !profile.at("startModes").contains(mode))
        throw DiscoveryError("bad-args", "Unsupported SSE start mode");
    auto product = statusVersion(image, true);
    if (!product.contains("companyName")) product["companyName"] = "";
    product["image"] = narrow(image);
    if (!synthetic && (product.at("fileMajor") != profile.at("engineFileMajor")
        || _wcsicmp(folder.substr(folder.find_last_of(L"\\") + 1).c_str(),
            wide(profile.at("executable").at("installationFolderName").get<std::string>()).c_str()) != 0))
        throw DiscoveryError("unsupported-version", "Executable version or installation folder differs from the selected product profile");
    const auto withCase = request.contains("casePath");
    const auto casePath = withCase ? launchPath(request, "casePath") : std::wstring();
    if (!synthetic) verifyLaunchCase(casePath, mode, profile);
    std::unique_ptr<Handle> caseFile;
    if (withCase) caseFile = std::make_unique<Handle>(CreateFileW(casePath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    const auto parent = parentProcessId();
    Handle owner(OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parent));
    if (!parent || parentProcessId() != parent || WaitForSingleObject(owner.value, 0) != WAIT_TIMEOUT)
        throw DiscoveryError("aborted", "Native launch owner is no longer alive");
    checkLaunchMarker(markerPath, image);
    LaunchDesktop desktop(wide(name));
    LaunchJob job;
    STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup);
    auto desktopPath = L"WinSta0\\" + wide(name); startup.StartupInfo.lpDesktop = desktopPath.data();
    startup.lpAttributeList = job.attributes;
    const auto command = L"\"" + image + L"\" -m" + wide(mode) + (withCase ? L" \"" + casePath + L"\"" : L"");
    auto mutableCommand = command;
    PROCESS_INFORMATION info{};
    if (!CreateProcessW(image.c_str(), mutableCommand.data(), nullptr, nullptr, FALSE,
        EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED, nullptr, folder.c_str(), &startup.StartupInfo, &info))
        throw DiscoveryError("launch", "Could not create the atomically owned SSE process");
    Handle process(info.hProcess), thread(info.hThread);
    const auto owned = ownedNativeMarker(name, info.dwProcessId);
    const auto started = std::chrono::steady_clock::now();
    const auto elapsed = [&]() { return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count(); };
    try {
        // SSE must be allowed to open/update its case; the identity check precedes resume.
        caseFile.reset();
        if (ResumeThread(thread.value) == MAXDWORD) throw DiscoveryError("launch", "Could not resume the owned SSE process");
        Json windows = Json::array(), mains = Json::array(), dialogs = Json::array();
        for (;;) {
            if (WaitForSingleObject(owner.value, 0) != WAIT_TIMEOUT) throw DiscoveryError("aborted", "Native launch owner exited before handoff");
            if (WaitForSingleObject(process.value, 0) != WAIT_TIMEOUT) throw DiscoveryError("launch", "Owned SSE process exited during startup");
            windows = launchWindows(desktop.value, info.dwProcessId);
            auto candidates = launchCandidates(windows, withCase); mains = std::move(candidates.first); dialogs = std::move(candidates.second);
            if (!mains.empty() || !dialogs.empty()) break;
            if (elapsed() >= timeout) throw DiscoveryError("startup-timeout", "Owned SSE process produced no verified startup window before its deadline");
            HANDLE waits[] = {process.value, owner.value};
            WaitForMultipleObjects(2, waits, FALSE, static_cast<DWORD>(std::min(25.0, std::max(1.0, timeout - elapsed()))));
        }
        writeNativeMarker(markerPath, owned);
        if (WaitForSingleObject(owner.value, 0) != WAIT_TIMEOUT || WaitForSingleObject(process.value, 0) != WAIT_TIMEOUT)
            throw DiscoveryError("launch", "Process ownership changed before marker handoff");
        // Prepare the complete reply before making the process persistent. Lost transport after handoff is an unknown outcome.
        Json result = {{"ok", true}, {"desktop", name}, {"pid", info.dwProcessId}, {"startPid", info.dwProcessId},
            {"wartesekunden", elapsed() / 1000.0}, {"kommandozeile", narrow(command)}, {"fenster", windows}, {"product", product},
            {"ready", mains.size() == 1}, {"blockedByDialog", !dialogs.empty()}, {"dialogWindows", dialogs}, {"instance", nullptr},
            {"loaderBuildIdentity", SSE_BRIDGE_BUILD_PREFIX SSE_BRIDGE_SOURCE_DIGEST}};
        if (mains.size() == 1) result["instance"] = {{"pid", info.dwProcessId}, {"hwnd", mains[0].at("hwnd")},
            {"title", mains[0].at("title")}, {"bindingMode", "desktop-launch-window"}};
        job.handoff();
        return result;
    } catch (const std::exception &error) {
        const auto *typed = dynamic_cast<const DiscoveryError*>(&error);
        const std::string kind = typed ? typed->kind : "launch";
        Json errors = Json::array();
        if (WaitForSingleObject(process.value, 0) == WAIT_TIMEOUT && !TerminateJobObject(job.job.value, 1)) errors.push_back("Owned process termination failed");
        const auto exited = WaitForSingleObject(process.value, 5000) == WAIT_OBJECT_0;
        bool removed = false, recovery = false;
        try {
            if (exited) removed = removeNativeMarkerIfOwned(markerPath, owned);
            else {
                auto marker = readNativeMarker(markerPath);
                recovery = marker.value == owned;
                if (marker.value.is_null()) { marker.file.reset(); writeNativeMarker(markerPath, owned); recovery = true; }
            }
        } catch (...) { errors.push_back("Owned marker cleanup or recovery could not be verified"); }
        if (!exited) errors.push_back("Owned process has not exited");
        if (exited && !removed) errors.push_back("Marker removal could not be verified");
        return {{"ok", false}, {"kind", exited && removed ? kind : "launch-cleanup"}, {"error", "Native desktop start failed; inspect ownership and cleanup state"},
            {"desktop", name}, {"pid", info.dwProcessId}, {"processStillRunning", !exited}, {"markerBeibehalten", recovery},
            {"markerRemoved", removed}, {"cleanupErrors", errors}, {"outcomeUnknown", !exited || !removed},
            {"loaderBuildIdentity", SSE_BRIDGE_BUILD_PREFIX SSE_BRIDGE_SOURCE_DIGEST}};
    }
}
