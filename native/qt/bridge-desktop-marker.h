// Ownership is read and, when necessary, deleted through the same locked file handle.
struct NativeMarker {
    std::unique_ptr<Handle> file;
    Json value = nullptr;
};
static bool nativeDesktopName(const std::string &name) {
    return !name.empty() && name.size() <= 64
        && name.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-") == std::string::npos;
}
static bool markerWhitespace(wchar_t c) {
    return (c >= 9 && c <= 13) || c == 32 || c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200a)
        || c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff;
}
static Json parseNativeMarker(const std::string &bytes) {
    try {
        auto text = bytes.empty() ? std::wstring() : wide(bytes);
        const auto first = std::find_if_not(text.begin(), text.end(), markerWhitespace);
        const auto last = std::find_if_not(text.rbegin(), text.rend(), markerWhitespace).base();
        const auto raw = first < last ? narrow(std::wstring(first, last)) : std::string();
        if (raw.empty()) throw std::runtime_error("Empty marker");
        if (raw[0] != '{') {
            if (!nativeDesktopName(raw)) throw std::runtime_error("Invalid legacy marker");
            return {{"schemaVersion", 0}, {"owner", "sse"}, {"name", raw}, {"pid", nullptr}};
        }
        auto value = Json::parse(raw);
        const auto legacy = value.is_object() && value.size() == 2 && value.contains("name") && value.contains("pid");
        const auto versioned = value.is_object() && value.size() == 4 && value.contains("schemaVersion")
            && value.contains("owner") && value.contains("name") && value.contains("pid")
            && value["schemaVersion"].is_number() && value["schemaVersion"] == 1
            && (value["owner"] == "sse" || value["owner"] == "center-test");
        if ((!legacy && !versioned) || !value["name"].is_string() || !nativeDesktopName(value["name"].get<std::string>())
            || !value["pid"].is_number()) throw std::runtime_error("Invalid marker fields");
        const auto pid = value["pid"].get<double>();
        if (!(pid >= 1 && pid <= MAXDWORD) || pid != static_cast<DWORD>(pid)) throw std::runtime_error("Invalid marker PID");
        value["pid"] = static_cast<DWORD>(pid);
        if (legacy) { value["schemaVersion"] = 0; value["owner"] = "sse"; }
        return value;
    } catch (...) { throw DiscoveryError("desktop-marker-invalid", "Desktop marker is not a valid bounded ownership document"); }
}
static NativeMarker readNativeMarker(const std::wstring &path) {
    const auto raw = CreateFileW(path.c_str(), GENERIC_READ | DELETE, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (raw == INVALID_HANDLE_VALUE) {
        if (GetLastError() == ERROR_FILE_NOT_FOUND) return {};
        throw DiscoveryError("desktop-marker-invalid", "Desktop marker cannot be read exclusively");
    }
    NativeMarker marker{std::make_unique<Handle>(raw)};
    BY_HANDLE_FILE_INFORMATION info{}; LARGE_INTEGER size{};
    if (!GetFileInformationByHandle(raw, &info) || (info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))
        || !GetFileSizeEx(raw, &size) || size.QuadPart < 1 || size.QuadPart > 4096)
        throw DiscoveryError("desktop-marker-invalid", "Desktop marker is not a bounded regular file");
    std::string bytes(static_cast<std::size_t>(size.QuadPart), '\0'); DWORD read = 0;
    if (!ReadFile(raw, bytes.data(), static_cast<DWORD>(bytes.size()), &read, nullptr) || read != bytes.size())
        throw DiscoveryError("desktop-marker-invalid", "Desktop marker read did not complete");
    marker.value = parseNativeMarker(bytes);
    return marker;
}
static void deleteNativeMarker(NativeMarker &marker) {
    FILE_DISPOSITION_INFO disposition{TRUE};
    if (!marker.file || !SetFileInformationByHandle(marker.file->value, FileDispositionInfo, &disposition, sizeof(disposition)))
        throw DiscoveryError("marker-cleanup", "Owned desktop marker could not be removed");
    marker.file.reset();
}
static Json ownedNativeMarker(const std::string &name, DWORD pid) {
    return {{"schemaVersion", 1}, {"owner", "sse"}, {"name", name}, {"pid", pid}};
}
static void writeNativeMarker(const std::wstring &path, const Json &value) {
    const auto bytes = value.dump();
    {
        Handle file(CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
        DWORD written = 0;
        if (!WriteFile(file.value, bytes.data(), static_cast<DWORD>(bytes.size()), &written, nullptr)
            || written != bytes.size() || !FlushFileBuffers(file.value))
            throw DiscoveryError("marker-cleanup", "Exclusive desktop marker write did not complete");
    }
    if (readNativeMarker(path).value != value) throw DiscoveryError("marker-cleanup", "Desktop marker readback differs from the owned process");
}
static bool removeNativeMarkerIfOwned(const std::wstring &path, const Json &expected) {
    auto marker = readNativeMarker(path);
    if (marker.value.is_null()) return true;
    if (marker.value["owner"] != expected["owner"] || marker.value["name"] != expected["name"] || marker.value["pid"] != expected["pid"]) return false;
    deleteNativeMarker(marker);
    return readNativeMarker(path).value.is_null();
}
