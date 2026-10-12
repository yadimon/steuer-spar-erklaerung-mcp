#include <stdexcept>
#include <iostream>
#include <nlohmann/json.hpp>
using Json = nlohmann::json;
#include "../bridge-table-summary-policy.h"

static void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}

int main() {
    const std::string prefix = "Synthetic.DialogUI.";
    const std::string section = "/.SonstigeKfzkosten";
    const std::string tableSuffix = section + "./.SonstigeKfzkosten.Kosten";
    Json profiles = Json::array();
    for (const auto &kind : {std::string("Mit"), std::string("Ohne")}) {
        profiles.push_back({{"id", "vehicle_costs_" + kind}, {"sumLabel", "Subtotal " + kind},
            {"tableAidSuffix", tableSuffix},
            {"summaryAidSuffix", section + "./.SonstigeKfzkosten.Summen./.SonstigeKfzkosten.Summen.TabSumKost"
                + kind + "./.SonstigeKfzkosten.Summen.TabSumKost" + kind + ".Wert"}});
    }
    // Both subtotals bind the table above the first subtotal. The second one's
    // preceding Y line must not authorize a different table/model.
    const int tableY = 100, withY = 300, withoutY = 350;
    require(tableY < withY && tableY < withoutY && !(tableY > withY), "Synthetic two-subtotal geometry is wrong");
    for (const auto &profile : profiles) {
        const auto fieldAid = prefix + profile.at("summaryAidSuffix").get<std::string>();
        const auto bound = tableSummaryPolicy::bind(profiles, profile.at("sumLabel"), fieldAid);
        require(bound.known && bound.valid, "Exact known subtotal was rejected");
        require(bound.tableAid == prefix + tableSuffix, "Both subtotals must bind the same full model");
        require(bound.groupAid == prefix + section, "The actual section identity must be exact");
        require(bound.captionAid == fieldAid.substr(0, fieldAid.size() - 5) + ".Caption", "Caption sibling is wrong");
        auto duplicate = profiles; duplicate.push_back(profile);
        require(!tableSummaryPolicy::bind(duplicate, profile.at("sumLabel"), fieldAid).valid, "Ambiguous profile was accepted");
        require(!tableSummaryPolicy::bind(profiles, profile.at("sumLabel"), fieldAid + ".Other").valid, "Near AID was accepted");
        require(!tableSummaryPolicy::bind(profiles, profile.at("sumLabel"), "Foreign.Wert").valid, "Unbound field was accepted");
    }
    require(!tableSummaryPolicy::bind(profiles, "Unknown subtotal", "Foreign.Wert").known, "Unknown profile was invented");
    require(tableSummaryPolicy::sameGroup(7, {9, 8, 7, 2}), "Exact actual QObject group was rejected");
    require(!tableSummaryPolicy::sameGroup(7, {9, 8, 2}), "A common main/root is not the exact section group");
    require(!tableSummaryPolicy::sameGroup(0, {0}), "Missing group identity was accepted");
    require(!tableSummaryPolicy::sameGroup(7, {7, 7}), "Repeated ancestor/cycle was accepted");
    const auto headers = Json::array({"Nr", "Datum", "Bezeichnung", "Betrag", "%", "Netto"});
    require(tableSummaryPolicy::mixedCostHeaders(headers, Json::array()), "Mixed-rate cost model was rejected");
    auto wrong = headers; wrong[3] = "Kategorie";
    require(!tableSummaryPolicy::mixedCostHeaders(wrong, Json::array()), "Another cost model was accepted");
    require(!tableSummaryPolicy::mixedCostHeaders(headers, Json::array({3})), "Missing visible amount was accepted");
    // Rate-zero and taxable rows are not selected/filtered by this binding.
    require(tableSummaryPolicy::mixedCostHeaders(headers, Json::array()), "Subtotal must retain all model rates");
    std::cout << "Native exact subtotal catalogue/group/model policy passed\n";
}
