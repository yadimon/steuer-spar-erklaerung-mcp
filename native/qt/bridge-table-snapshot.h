#pragma once
#include <algorithm>
#include <limits>
#include "bridge-compatibility.h"
#include "bridge-table-summary-policy.h"

static std::string tableSummaryAccessibleId(QObject *object) {
    auto *iface = QAccessible::queryAccessibleInterface(object);
    if (!iface || !iface->isValid()) return {};
    return accessibleText(QAccessibleBridgeUtils::accessibleId(iface));
}

// Exact accessible catalogue identity plus actual QObject ancestry, all from
// this controller-protected GUI-thread snapshot. Neither Y nor objectName is
// an identity substitute for the known mixed-rate cost model.
static bool tableSummaryGroupBound(QObject *table, QObject *field, const std::string &groupAid, QWidget *root) {
    QObject *group = nullptr;
    int depth = 0;
    for (auto *parent = table->parent(); parent && parent != root && depth++ < 128; parent = parent->parent()) {
        if (tableSummaryAccessibleId(parent) == groupAid) {
            if (group) return false;
            group = parent;
        }
    }
    if (!group || depth >= 128) return false;
    std::vector<std::uint64_t> ancestors;
    depth = 0;
    for (auto *parent = field->parent(); parent && parent != root && depth++ < 128; parent = parent->parent())
        ancestors.push_back(objectId(parent));
    return depth < 128 && tableSummaryPolicy::sameGroup(objectId(group), ancestors);
}

// Called inside one GUI-thread controller lease: table and summaries belong
// to the same application state, with no second pipe request between them.
static Json tableSnapshot(const Json &request, QWidget *root) {
    if (!root->isEnabled() || QApplication::activeModalWidget()) return error("window-obstructed", "The bound window is disabled or modal");
    const bool withCursorFocusBinding = request.value("withCursorFocusBinding", false);
    auto context = execute({{"op", "objects"}, {"projection", "table-context"}, {"visibleOnly", true},
        {"withNativeGeometry", withCursorFocusBinding}});
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
    const auto summaryField = [&controls](const Json &label) -> Json {
        Json fields = Json::array();
        for (const auto &control : controls) {
            const auto kind = control.value("kind", "");
            if (control.at("parentId") == label.at("parentId")
                && (kind == "lineEdit" || kind == "spinBox" || kind == "plainTextEdit" || kind == "comboBox")) fields.push_back(control);
        }
        if (fields.size() != 1 || fields[0].value("sensitive", false) || !fields[0].contains("value")) return nullptr;
        return fields[0];
    };
    const auto summaryValue = [&summaryField](const Json &label) -> Json {
        const auto field = summaryField(label);
        return field.is_null() ? Json(nullptr) : field.at("value");
    };
    const auto isSummary = [](const Json &label) {
        const auto text = QString::fromStdString(label.value("value", "")).trimmed();
        return text == "Summe" || text.startsWith("Summe ") || text == "Gesamtsumme" || text.startsWith("Gesamtsumme ");
    };
    const auto sumLabel = request.value("sumLabel", std::string());
    const int occurrence = request.value("sumOccurrence", 1);
    if (occurrence < 1 || occurrence > 1000 || sumLabel.size() > 2000) throw std::runtime_error("Invalid summary selector bounds");
    Json binding = nullptr, selectedSum = nullptr;
    tableSummaryPolicy::Binding cataloguedProfile;
    QPointer<QObject> selectedField, selectedCaption;
    std::string selectedFieldAid;
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
        const auto field = summaryField(label);
        auto *fieldObject = resolve({{"objectId", field.at("id")}}, root);
        const auto profiles = Json::parse(SSE_NATIVE_TABLE_REGION_BINDINGS_JSON);
        // Generic summaries need no accessible interface. Known mixed-rate
        // subtotals retain the exact catalogue AID and actual-group proof.
        auto profile = tableSummaryPolicy::bind(profiles, label.at("value").get<std::string>(), "");
        if (profile.known) {
            activateAccessibilityClient();
            profile = tableSummaryPolicy::bind(profiles, label.at("value").get<std::string>(),
                tableSummaryAccessibleId(fieldObject));
        }
        std::vector<Json> inRegion;
        if (profile.known) {
            auto *captionObject = resolve({{"objectId", label.at("id")}}, root);
            if (!profile.valid || tableSummaryAccessibleId(captionObject) != profile.captionAid
                || captionObject->parent() != fieldObject->parent())
                return error("precondition-failed", "The catalogued subtotal identity is not proven");
            for (const auto &table : tables) {
                auto *object = resolve({{"objectId", table.at("id")}}, root);
                auto *view = qobject_cast<QTableView *>(object);
                if (tableSummaryAccessibleId(object) == profile.tableAid && view && view->model()
                    && tableSummaryGroupBound(object, fieldObject, profile.groupAid, root)) inRegion.push_back(table);
            }
            if (inRegion.size() != 1)
                return error("precondition-failed", "The catalogued subtotal has no unique same-group table model");
            cataloguedProfile = profile;
            selectedField = fieldObject; selectedCaption = captionObject;
            selectedFieldAid = tableSummaryAccessibleId(fieldObject);
        } else {
            for (const auto &table : tables) {
                const auto &rect = table.at("rootRect");
                const int y = rect.at(1).get<int>();
                if (y > previousY && y < sumY && y + rect.at(3).get<int>() <= sumY) inRegion.push_back(table);
            }
        }
        tables = std::move(inRegion);
        binding = {{"sumLabel", sumLabel}, {"sumOccurrence", occurrence}, {"sumY", sumY},
            {"previousSummaryY", previousY}, {"summeKandidaten", matches.size()}, {"coordinateSpace", "qt-root"}};
        if (profile.known) binding["profileId"] = profile.profileId;
    }
    if (tables.empty()) return error("no-table", "No visible input table belongs to the selected region");
    if (tables.size() != 1) return error("ambiguous-table", "More than one visible input table matches; supply its summary label");
    const int maxRows = request.value("maxRows", 200);
    if (maxRows < 1 || maxRows > 1000) throw std::runtime_error("maxRows must be 1..1000");
    const QPointer<QTableView> view = qobject_cast<QTableView *>(resolve({{"objectId", tables[0].at("id")}}, root));
    if (!view || !view->model()) return error("precondition-failed", "Selected table has no model");
    const QPointer<QAbstractItemModel> model = view->model();
    auto result = execute({{"op", "table_read"}, {"objectId", tables[0].at("id")},
        {"maxRows", maxRows + 1}, {"allowPartial", true}});
    if (!result.value("ok", false)) return result;
    if (!view || !model || view->model() != model) return error("precondition-failed", "Selected table model changed during its read");
    if (binding.is_object() && binding.contains("profileId")
        && !tableSummaryPolicy::mixedCostHeaders(result.at("headers"), result.at("hiddenColumns")))
        return error("precondition-failed", "Catalogued mixed-rate cost table headers are not proven");
    if (cataloguedProfile.known) {
        if (!selectedField || !selectedCaption || !view->isVisible()
            || tableSummaryAccessibleId(view.data()) != cataloguedProfile.tableAid
            || tableSummaryAccessibleId(selectedField.data()) != selectedFieldAid
            || tableSummaryAccessibleId(selectedCaption.data()) != cataloguedProfile.captionAid
            || selectedField->parent() != selectedCaption->parent()
            || !tableSummaryGroupBound(view.data(), selectedField.data(), cataloguedProfile.groupAid, root))
            return error("precondition-failed", "Catalogued subtotal identity changed during its model read");
        const auto freshField = describe(selectedField.data(), objectId(selectedField->parent()));
        if (!freshField.contains("value") || freshField.at("value") != selectedSum)
            return error("precondition-failed", "Catalogued subtotal value changed during its model read");
    }
    result["cursorFocusBinding"] = withCursorFocusBinding ? tableCursorFocusBinding(view.data(), result) : Json(nullptr);
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
