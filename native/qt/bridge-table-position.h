#pragma once
#include "bridge-table-position-policy.h"

static Json tablePositionNumber(QWidget *root, const Json &request) {
    const std::unordered_set<std::string> fields{"id", "op", "nonce", "objectId", "binding", "targetRow",
        "expectedRootHwnd", "expectedPid", "expectedInputTick", "expectedWindowTitle"};
    if (request.size() != fields.size()) return noMutationError("INVALID_POSITION_TARGET", "Exact private positioning fields are required");
    for (const auto &item : request.items()) if (!fields.count(item.key()))
        return noMutationError("INVALID_POSITION_TARGET", "Unknown private positioning field");
    if (!request.at("targetRow").is_number_unsigned() || !request.at("expectedRootHwnd").is_number_unsigned()
        || !request.at("expectedPid").is_number_unsigned() || !request.at("expectedInputTick").is_number_unsigned()
        || !request.at("expectedWindowTitle").is_string() || !request.at("binding").is_object())
        return noMutationError("INVALID_POSITION_TARGET", "Exact private target, root, epoch and typed binding are required");
    const auto &binding = request.at("binding");
    const std::unordered_set<std::string> bindingFields{"tableId", "modelId", "tableAid", "tableName", "currentIndex", "selectedIndexes", "modelFingerprint"};
    if (binding.size() != bindingFields.size()) return noMutationError("INVALID_POSITION_TARGET", "Complete private focus binding is required");
    for (const auto &item : binding.items()) if (!bindingFields.count(item.key()))
        return noMutationError("INVALID_POSITION_TARGET", "Unknown private focus binding field");
    const auto hwnd = reinterpret_cast<HWND>(config.window);
    LASTINPUTINFO input{sizeof(LASTINPUTINFO), 0}; DWORD pid = 0;
    const auto checkpoint = [&]() -> const char * {
        if (request.at("expectedRootHwnd") != config.window || request.at("expectedPid") != GetCurrentProcessId()
            || !GetWindowThreadProcessId(hwnd, &pid) || pid != GetCurrentProcessId() || GetForegroundWindow() != hwnd || IsIconic(hwnd)
            || QApplication::activeWindow() != root->window() || !GetLastInputInfo(&input)
            || request.at("expectedInputTick") != input.dwTime || request.at("expectedWindowTitle") != utf8(root->windowTitle()))
            return "The exact root, foreground, title or original input epoch changed";
        return nullptr;
    };
    if (const auto *blocked = checkpoint()) return noMutationError("stale-window", blocked);
    auto *view = qobject_cast<QTableView *>(resolve(request, root));
    if (!view || std::strcmp(view->metaObject()->className(), "DialogUITable") != 0 || request.at("objectId") != binding.at("tableId")
        || view->objectName().isEmpty() || !view->model() || request.at("targetRow").get<std::uint64_t>() >= 1000)
        return noMutationError("INVALID_POSITION_TARGET", "Positioning requires the exact owned numbered input table");
    const auto header = view->model()->headerData(0, Qt::Horizontal).toString();
    if (header != QStringLiteral("Nr.") && header != QStringLiteral("Nr"))
        return noMutationError("INVALID_POSITION_TARGET", "The exact model has no leading Nr. column");
    const auto capture = [&]() { return tableCursorFocusBinding(view, execute({{"op", "table_read"},
        {"objectId", objectId(view)}, {"maxRows", 10000}, {"maxColumns", 100}})); };
    if (const auto *blocked = tableFocusWidgetObstruction(root, view)) return noMutationError("editor-open", blocked);
    if (capture() != binding) return noMutationError("stale", "The exact complete table/model/current-selection binding changed");
    const auto captureModel = [&]() { return capture().at("modelFingerprint"); };
    bool numberEditorPending = false;
    const auto postObstruction = [&](QWidget *ownedRoot, QTableView *ownedView, const QModelIndex &target) -> const char * {
        if (!tableFocusWidgetObstruction(ownedRoot, ownedView)) { numberEditorPending = false; return nullptr; }
        // No editor is closed in native navigation. Permit only the freshly
        // materialized exact Nr. delegate for the independent UIA closure proof.
        auto *editor = tablePositionNumberDelegate(ownedView, target);
        if (!editor)
            return "The new viewport editor is not the exact current Nr. delegate";
        auto *accessible = QAccessible::queryAccessibleInterface(editor);
        const auto expectedAid = binding.at("tableAid").get<std::string>() + ".qt_scrollarea_viewport."
            + utf8(ownedView->objectName()) + ".(" + std::to_string(target.row() + 1) + ").BelegNr";
        if (!accessible || !accessible->isValid()
            || accessibleText(QAccessibleBridgeUtils::accessibleId(accessible)) != expectedAid)
            return "The fresh Nr. delegate has no exact profiled accessible identity";
        if (const auto *blocked = tableFocusWidgetObstruction(ownedRoot, ownedView, editor)) return blocked;
        numberEditorPending = true; return nullptr;
    };
    const auto positioned = dispatchExactTablePosition(root, view, request.at("targetRow").get<int>(),
        binding.at("modelFingerprint"), captureModel, checkpoint, mutationStarted, postObstruction);
    if (positioned.error) {
        auto result = positioned.attempted ? error("position-outcome-unknown", positioned.error) : noMutationError("precondition-failed", positioned.error);
        if (positioned.attempted) result["outcomeUnknown"] = true;
        return result;
    }
    const auto after = capture();
    if (after.at("modelFingerprint") != binding.at("modelFingerprint")
        || after.at("currentIndex") != Json::array({request.at("targetRow"), 0})
        || after.at("selectedIndexes") != Json::array({Json::array({request.at("targetRow"), 0})})
        || checkpoint() || postObstruction(root, view, view->currentIndex())) {
        auto result = error("position-outcome-unknown", "The final exact model, target or original input epoch changed");
        result["outcomeUnknown"] = true; return result;
    }
    return {{"ok", true}, {"positioned", true}, {"numberEditorPending", numberEditorPending},
        {"physicalInputUsed", false}, {"inputTick", input.dwTime}, {"binding", after}};
}
