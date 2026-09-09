#pragma once
#include <algorithm>
#include <limits>

// Called inside one GUI-thread controller lease: table and summaries belong
// to the same application state, with no second pipe request between them.
static Json tableSnapshot(const Json &request, QWidget *root) {
    if (!root->isEnabled() || QApplication::activeModalWidget()) return error("window-obstructed", "The bound window is disabled or modal");
    auto context = execute({{"op", "objects"}, {"projection", "table-context"}, {"visibleOnly", true}});
    auto &controls = context.at("objects");
    std::vector<Json> tables, labels;
    for (const auto &control : controls) {
        if (control.value("class", "") == "DialogUITable") tables.push_back(control);
        if (control.value("kind", "") == "label") labels.push_back(control);
    }
    std::sort(labels.begin(), labels.end(), [](const Json &left, const Json &right) {
        const auto &a = left.at("rootRect"), &b = right.at("rootRect");
        return a.at(1) == b.at(1) ? a.at(0) < b.at(0) : a.at(1) < b.at(1);
    });
    const auto summaryValue = [&controls](const Json &label) -> Json {
        Json fields = Json::array();
        for (const auto &control : controls) {
            const auto kind = control.value("kind", "");
            if (control.at("parentId") == label.at("parentId")
                && (kind == "lineEdit" || kind == "spinBox" || kind == "plainTextEdit" || kind == "comboBox")) fields.push_back(control);
        }
        if (fields.size() != 1 || fields[0].value("sensitive", false) || !fields[0].contains("value")) return nullptr;
        return fields[0].at("value");
    };
    const auto isSummary = [](const Json &label) {
        const auto text = QString::fromStdString(label.value("value", "")).trimmed();
        return text == "Summe" || text.startsWith("Summe ") || text == "Gesamtsumme" || text.startsWith("Gesamtsumme ");
    };
    const auto sumLabel = request.value("sumLabel", std::string());
    const int occurrence = request.value("sumOccurrence", 1);
    if (occurrence < 1 || occurrence > 1000 || sumLabel.size() > 2000) throw std::runtime_error("Invalid summary selector bounds");
    Json binding = nullptr, selectedSum = nullptr;
    const auto tableCount = tables.size();
    if (!sumLabel.empty()) {
        std::vector<Json> matches;
        for (const auto &label : labels) {
            if (QString::fromStdString(label.value("value", "")).compare(QString::fromStdString(sumLabel), Qt::CaseInsensitive) == 0) matches.push_back(label);
        }
        if (static_cast<std::size_t>(occurrence) > matches.size()) return error("precondition-failed", "Requested summary label/occurrence is absent");
        const auto &label = matches[occurrence - 1];
        selectedSum = summaryValue(label);
        if (!selectedSum.is_string()) return error("precondition-failed", "Requested summary has no unique readable value field");
        const int sumY = label.at("rootRect").at(1).get<int>();
        int previousY = std::numeric_limits<int>::min();
        for (const auto &other : labels) if (isSummary(other)) {
            const int y = other.at("rootRect").at(1).get<int>();
            if (y < sumY && y > previousY) previousY = y;
        }
        std::vector<Json> inRegion;
        for (const auto &table : tables) {
            const auto &rect = table.at("rootRect");
            const int y = rect.at(1).get<int>();
            if (y > previousY && y < sumY && y + rect.at(3).get<int>() <= sumY) inRegion.push_back(table);
        }
        tables = std::move(inRegion);
        binding = {{"sumLabel", sumLabel}, {"sumOccurrence", occurrence}, {"sumY", sumY},
            {"previousSummaryY", previousY}, {"summeKandidaten", matches.size()}, {"coordinateSpace", "qt-root"}};
    }
    if (tables.empty()) return error("no-table", "No visible input table belongs to the selected region");
    if (tables.size() != 1) return error("ambiguous-table", "More than one visible input table matches; supply its summary label");
    const int maxRows = request.value("maxRows", 200);
    if (maxRows < 1 || maxRows > 1000) throw std::runtime_error("maxRows must be 1..1000");
    auto result = execute({{"op", "table_read"}, {"objectId", tables[0].at("id")},
        {"maxRows", maxRows + 1}, {"allowPartial", true}});
    if (!result.value("ok", false)) return result;
    result["table"] = tables[0]; result["tableCount"] = tableCount;
    result["summary"] = selectedSum; result["binding"] = binding;
    result["summaries"] = Json::array();
    std::unordered_map<std::string, int> occurrences;
    for (const auto &label : labels) if (isSummary(label) && result["summaries"].size() < 12) {
        const auto text = label.at("value").get<std::string>();
        result["summaries"].push_back({{"label", text}, {"vorkommen", ++occurrences[text]}, {"wert", summaryValue(label)}});
    }
    result["windowEnabled"] = root->isEnabled(); result["modalBlocked"] = QApplication::activeModalWidget() != nullptr;
    return result;
}
