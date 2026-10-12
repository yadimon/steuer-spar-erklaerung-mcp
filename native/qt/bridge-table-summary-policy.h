#pragma once
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

namespace tableSummaryPolicy {
struct Binding {
    bool known = false;
    bool valid = false;
    std::string tableAid;
    std::string groupAid;
    std::string captionAid;
    std::string profileId;
};

// Only the shipped catalogue may authorize a subtotal outside the preceding
// summary's geometric region. No caller-supplied mapping is accepted.
static Binding bind(const Json &profiles, const std::string &label, const std::string &fieldAid) {
    Binding result;
    if (!profiles.is_array()) return result;
    int matchingProfiles = 0;
    for (const auto &profile : profiles) {
        if (profile.value("sumLabel", "") != label) continue;
        result.known = true;
        ++matchingProfiles;
        const auto suffix = profile.value("summaryAidSuffix", std::string());
        const auto tableSuffix = profile.value("tableAidSuffix", std::string());
        if (suffix.empty() || fieldAid.size() <= suffix.size()
            || fieldAid.compare(fieldAid.size() - suffix.size(), suffix.size(), suffix) != 0) continue;
        const auto groupEnd = tableSuffix.rfind("./.");
        if (groupEnd == std::string::npos || groupEnd == 0 || suffix.size() < 5
            || suffix.substr(suffix.size() - 5) != ".Wert") continue;
        const auto prefix = fieldAid.substr(0, fieldAid.size() - suffix.size());
        result.tableAid = prefix + tableSuffix;
        result.groupAid = prefix + tableSuffix.substr(0, groupEnd);
        result.captionAid = fieldAid.substr(0, fieldAid.size() - 5) + ".Caption";
        result.profileId = profile.value("id", "");
        result.valid = !result.profileId.empty();
    }
    if (matchingProfiles != 1) result.valid = false;
    return result;
}

static bool sameGroup(std::uint64_t tableGroup, const std::vector<std::uint64_t> &fieldAncestors) {
    return tableGroup != 0 && std::count(fieldAncestors.begin(), fieldAncestors.end(), tableGroup) == 1;
}

static bool mixedCostHeaders(const Json &headers, const Json &hidden) {
    if (!headers.is_array() || !hidden.is_array()) return false;
    Json visible = Json::array();
    for (std::size_t column = 0; column < headers.size(); ++column) {
        if (std::find(hidden.begin(), hidden.end(), Json(column)) == hidden.end()) visible.push_back(headers[column]);
    }
    return visible == Json::array({"Nr.", "Datum", "Bezeichnung", "Betrag", "%", "Netto"})
        || visible == Json::array({"Nr", "Datum", "Bezeichnung", "Betrag", "%", "Netto"});
}
}
