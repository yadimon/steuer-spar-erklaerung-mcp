// The job is assigned atomically by CreateProcess, before application code runs.
// Until verified marker handoff, closing/crashing the helper terminates its owned process tree.
struct LaunchJob {
    Handle job{CreateJobObjectW(nullptr, nullptr)};
    std::vector<BYTE> storage;
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = nullptr;
    LaunchJob() {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof(limits)))
            throw DiscoveryError("launch", "Could not establish owned process cleanup");
        SIZE_T size = 0; InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
        storage.resize(size); attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
        if (!InitializeProcThreadAttributeList(attributes, 1, 0, &size)) {
            attributes = nullptr; throw DiscoveryError("launch", "Could not initialize atomic process ownership");
        }
        if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, &job.value, sizeof(job.value), nullptr, nullptr)) {
            DeleteProcThreadAttributeList(attributes); attributes = nullptr;
            throw DiscoveryError("launch", "This Windows runtime cannot bind process ownership atomically");
        }
    }
    void handoff() {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        if (!SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof(limits)))
            throw DiscoveryError("launch", "Could not hand off the verified owned process");
    }
    ~LaunchJob() { if (attributes) DeleteProcThreadAttributeList(attributes); }
};
struct LaunchDesktop {
    HDESK value = nullptr;
    explicit LaunchDesktop(const std::wstring &name) {
        const auto existing = OpenDesktopW(name.c_str(), 0, FALSE, DESKTOP_READOBJECTS);
        if (existing) { CloseDesktop(existing); throw DiscoveryError("desktop-occupied", "Requested desktop already exists and cannot be adopted"); }
        if (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_INVALID_HANDLE)
            throw DiscoveryError("desktop", "Requested desktop cannot be checked");
        value = CreateDesktopW(name.c_str(), nullptr, nullptr, 0, GENERIC_ALL, nullptr);
        if (!value) throw DiscoveryError("desktop", "Could not create the owned desktop");
    }
    ~LaunchDesktop() { if (value) CloseDesktop(value); }
};
static Json launchWindows(HDESK desktop, DWORD pid) {
    StatusWindows status{pid}; SetLastError(ERROR_SUCCESS);
    const auto enumerated = EnumDesktopWindows(desktop, collectStatusWindow, reinterpret_cast<LPARAM>(&status));
    const auto error = GetLastError();
    if (!status.failure.empty() || (!enumerated && error != ERROR_SUCCESS))
        throw DiscoveryError("launch", "Owned desktop window inventory did not complete");
    std::stable_sort(status.windows.begin(), status.windows.end(), [](const Json &a, const Json &b) {
        return a.at("w").get<std::int64_t>() * a.at("h").get<std::int64_t>()
            > b.at("w").get<std::int64_t>() * b.at("h").get<std::int64_t>();
    });
    return status.windows;
}
static bool launchContains(const std::wstring &value, const wchar_t *needle) {
    return !value.empty() && FindNLSStringEx(LOCALE_NAME_INVARIANT, FIND_FROMSTART | NORM_IGNORECASE,
        value.data(), static_cast<int>(value.size()), needle, -1, nullptr, nullptr, nullptr, 0) >= 0;
}
static std::pair<Json, Json> launchCandidates(const Json &windows, bool withCase) {
    Json loaded = Json::array(), generic = Json::array(), dialogs = Json::array();
    for (const auto &window : windows) {
        const auto text = window.at("title").get<std::string>();
        const auto title = text.empty() ? std::wstring() : wide(text);
        const auto isSse = launchContains(title, L"SteuerSparErklärung");
        const auto isGeneric = _wcsicmp(title.c_str(), L"Steuerprogramm") == 0;
        const auto large = window.at("w").get<int>() >= 900 || window.at("minimiert").get<bool>();
        if (isSse && (withCase || large)) loaded.push_back(window);
        if (!withCase && isGeneric && large) generic.push_back(window);
        if ((isGeneric && window.at("w").get<int>() < 900)
            || (!title.empty() && !isSse && !launchContains(title, L"Steuer-Spar-Tipps") && !isGeneric)) dialogs.push_back(window);
    }
    return {loaded.empty() ? generic : loaded, dialogs};
}
static std::wstring launchPath(const Json &request, const char *key) {
    const auto value = request.at(key).get<std::string>();
    if (value.empty() || value.size() > 32768 || value.find_first_of("\"\r\n\t") != std::string::npos || value.find('\0') != std::string::npos)
        throw DiscoveryError("bad-args", "Invalid native launch path");
    const auto path = wide(value);
    if (path.size() < 4 || path[1] != L':' || path[2] != L'\\') throw DiscoveryError("bad-args", "Native launch requires an absolute local path");
    return path;
}
