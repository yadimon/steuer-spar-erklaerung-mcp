// The close policy preserves the Worker's explicit discard and transmission boundaries.
#include <cwctype>
static bool stopEqual(const std::wstring &a, const wchar_t *b) { return _wcsicmp(a.c_str(), b) == 0; }
static std::wstring stopNormalized(const std::wstring &text) {
    if (text.empty()) return {};
    std::wstring lower(text.size(), L'\0');
    if (!LCMapStringEx(LOCALE_NAME_INVARIANT, LCMAP_LOWERCASE, text.data(), static_cast<int>(text.size()),
        lower.data(), static_cast<int>(lower.size()), nullptr, nullptr, 0))
        throw DiscoveryError("state-unknown", "Text normalization failed");
    std::wstring result;
    for (auto c : lower) {
        if (c == L'ä') c = L'a'; else if (c == L'ö') c = L'o'; else if (c == L'ü') c = L'u';
        if (c == L'ß') { result += L"ss"; continue; }
        WORD type = 0;
        if (!GetStringTypeW(CT_CTYPE1, &c, 1, &type)) throw DiscoveryError("state-unknown", "Text classification failed");
        if (type & (C1_ALPHA | C1_DIGIT)) result += c;
    }
    return result;
}
static bool stopTransmission(const std::wstring &text) {
    const auto normalized = stopNormalized(text);
    for (const auto stem : {L"elster", L"versend", L"versand", L"ubermittl", L"ubermittel", L"abschick",
        L"nachreich", L"abschliess", L"datenubertrag", L"transfer"})
        if (normalized.find(stem) != std::wstring::npos) return true;
    return normalized.rfind(L"senden", 0) == 0;
}
static bool stopMain(const Json &window) {
    return window.at("w") >= 900 && window.at("h") >= 600
        && launchContains(wide(window.at("title").get<std::string>()), L"SteuerSparErklärung");
}
static bool stopIgnored(const Json &window) {
    const auto cls = wide(window.at("cls").get<std::string>());
    return launchContains(cls, L"Shadow") || launchContains(cls, L"PopupDropShadow")
        || ((cls.rfind(L"UAC_", 0) == 0 || cls.rfind(L"UAC ", 0) == 0) && window.at("w") <= 80 && window.at("h") <= 80);
}
static bool stopSafeAuxiliary(const Json &window) {
    if (window.at("title").get<std::string>().empty()) return false;
    const auto title = wide(window.at("title").get<std::string>());
    const auto compact = window.at("w") <= 850 && window.at("h") <= 650;
    if (compact && (stopEqual(title, L"Steuer-Spar-Tipps") || title.rfind(L"Die Prüfung hat ergeben", 0) == 0)) return true;
    if (title.rfind(L"Werte-Info:", 0) == 0 && window.at("w") <= 900 && window.at("h") <= 700) return true;
    for (const auto &candidate : Json::parse(SSE_NATIVE_STOP_TOOLS_JSON))
        if (stopEqual(title, wide(candidate.get<std::string>()).c_str())) return true;
    return false;
}
static bool stopAuxiliaryNeedsTree(const Json &window) {
    const auto title = wide(window.at("title").get<std::string>());
    if (stopEqual(title, L"Steuer-Spar-Tipps")) return false;
    for (const auto &candidate : Json::parse(SSE_NATIVE_STOP_TOOLS_JSON))
        if (stopEqual(title, wide(candidate.get<std::string>()).c_str())) return false;
    return true;
}
static bool stopBlockedTree(const StopTree &tree, const Json &window) {
    const auto title = window.at("title").get<std::string>();
    if (!title.empty() && stopTransmission(wide(title))) return true;
    // Include every exposed name, including unsupported buttons. Incomplete trees never authorize an action.
    for (const auto &item : tree.elements) if (stopTransmission(item.name)) return true;
    return false;
}
static std::optional<std::size_t> stopDiscardButton(const StopTree &tree) {
    for (const auto name : {L"Nein", L"Nicht speichern", L"Verwerfen"}) {
        std::optional<std::size_t> selected;
        for (std::size_t index = 0; index < tree.elements.size(); ++index) {
            const auto &item = tree.elements[index];
            if ((item.type != UIA_ButtonControlTypeId && item.type != UIA_PaneControlTypeId) || !item.enabled || !stopEqual(item.name, name)) continue;
            if (selected) throw DiscoveryError("confirmation-required", "More than one enabled discard button has the same name");
            selected = index;
        }
        if (selected) return selected;
    }
    return std::nullopt;
}
