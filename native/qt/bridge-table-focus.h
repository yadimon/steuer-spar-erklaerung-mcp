#pragma once
#include "bridge-table-focus-policy.h"

static Json tableFocusSelection(QTableView *view) {
    Json selected = Json::array();
    const auto indexes = view->selectionModel()->selectedIndexes();
    if (indexes.size() > 100000) throw std::runtime_error("Table selection exceeds its explicit bound");
    for (const auto &index : indexes) {
        if (!index.isValid() || index.model() != view->model() || index.parent().isValid())
            throw std::runtime_error("Table selection is not owned by the exact flat model");
        selected.push_back({index.row(), index.column()});
    }
    std::sort(selected.begin(), selected.end());
    return selected;
}

static Json tableFocusModelProof(Json model) {
    model.erase("modelMs");
    if (!model.value("ok", false) || !model.value("complete", false)
        || model.value("canFetchMore", true) || model.at("readRows") != model.at("rows"))
        throw std::runtime_error("Table focus requires a complete raw model proof");
    return model;
}

static Json tableCursorFocusBinding(QTableView *view, const Json &model) {
    if (!view || !view->model() || !view->selectionModel()) return nullptr;
    if (!model.value("complete", false) || model.value("canFetchMore", true)) return nullptr;
    activateAccessibilityClient();
    auto *iface = QAccessible::queryAccessibleInterface(view);
    if (!iface || !iface->isValid() || !iface->tableInterface()) return nullptr;
    const auto aid = accessibleText(QAccessibleBridgeUtils::accessibleId(iface));
    const auto name = utf8(view->objectName());
    if (aid.empty() || name.empty()) return nullptr;
    const auto current = view->currentIndex();
    return {{"tableId", objectId(view)}, {"modelId", objectId(view->model())},
        {"tableAid", aid}, {"tableName", name},
        {"currentIndex", {current.isValid() ? current.row() : -1, current.isValid() ? current.column() : -1}},
        {"selectedIndexes", tableFocusSelection(view)},
        {"modelFingerprint", cellsFingerprint(tableFocusModelProof(model))}};
}

// Broker-only focus transaction. It does not activate or raise the main window.
// Public table operations retain their own page, summary and dirty-state proof.
static Json tableFocusOnly(QWidget *root, const Json &request) {
    if (!request.contains("expectedRootHwnd") || !request.contains("expectedPid")
        || !request.contains("expectedInputTick") || !request.contains("expectedWindowTitle") || !request.contains("binding")
        || !request.at("expectedRootHwnd").is_number_unsigned()
        || !request.at("expectedPid").is_number_unsigned()
        || !request.at("expectedInputTick").is_number_unsigned()
        || !request.at("expectedWindowTitle").is_string() || request.at("expectedWindowTitle").get_ref<const std::string &>().size() > 65536
        || !request.at("binding").is_object())
        return noMutationError("INVALID_FOCUS_TARGET", "Table focus requires exact window/title, process, input epoch and private binding");
    const auto &binding = request.at("binding");
    if (binding.size() != 7 || !binding.contains("tableId") || !binding.contains("modelId")
        || !binding.contains("tableAid") || !binding.contains("tableName")
        || !binding.contains("currentIndex") || !binding.contains("selectedIndexes")
        || !binding.contains("modelFingerprint"))
        return noMutationError("INVALID_FOCUS_TARGET", "Table focus requires the complete private native binding");
    const auto hwnd = reinterpret_cast<HWND>(config.window);
    LASTINPUTINFO input{sizeof(LASTINPUTINFO), 0};
    DWORD pid = 0;
    if (request.at("expectedRootHwnd") != config.window || request.at("expectedPid") != GetCurrentProcessId()
        || !GetWindowThreadProcessId(hwnd, &pid) || pid != GetCurrentProcessId()
        || GetForegroundWindow() != hwnd || IsIconic(hwnd)
        || request.at("expectedWindowTitle") != utf8(root->windowTitle())
        || QApplication::activeWindow() != root->window() || !GetLastInputInfo(&input)
        || request.at("expectedInputTick") != input.dwTime)
        return noMutationError("stale-window", "The exact foreground window or input epoch changed before table focus");
    auto *view = qobject_cast<QTableView *>(resolve(request, root));
    if (!view || std::strcmp(view->metaObject()->className(), "DialogUITable") != 0
        || request.at("objectId") != binding.at("tableId"))
        return noMutationError("INVALID_FOCUS_TARGET", "Table focus targets only the exact owned input table");
    if (const auto *blocked = tableFocusWidgetObstruction(root, view))
        return noMutationError("editor-open", blocked);
    const auto capture = [&]() {
        auto model = execute({{"op", "table_read"}, {"objectId", objectId(view)}, {"maxRows", 10000}, {"maxColumns", 100}});
        const auto proof = tableCursorFocusBinding(view, model);
        if (tableFocusWidgetObstruction(root, view))
            throw std::runtime_error("The exact table gained an obstruction during its complete proof");
        if (GetForegroundWindow() != hwnd || !GetLastInputInfo(&input)
            || request.at("expectedInputTick") != input.dwTime
            || request.at("expectedWindowTitle") != utf8(root->windowTitle()))
            throw std::runtime_error("The exact foreground or input epoch changed during table proof");
        return proof;
    };
    if (capture() != binding)
        return noMutationError("stale", "The exact table/model identity, contents or selection changed before focus");
    // Re-read the epoch after the bounded full-model proof and immediately before
    // the single focus call. Focus itself sends no physical input.
    if (GetForegroundWindow() != hwnd || !GetLastInputInfo(&input) || request.at("expectedInputTick") != input.dwTime
        || request.at("expectedWindowTitle") != utf8(root->windowTitle()))
        return noMutationError("stale-window", "The exact foreground or input epoch changed during focus preparation");
    const auto checkpoint = [&]() -> const char * {
        if (GetForegroundWindow() != hwnd || !GetLastInputInfo(&input)
            || request.at("expectedInputTick") != input.dwTime
            || request.at("expectedWindowTitle") != utf8(root->windowTitle()))
            return "The exact foreground or input epoch changed immediately before table focus";
        return nullptr;
    };
    const auto focused = dispatchExactTableFocus(root, view, binding, capture, checkpoint, mutationStarted);
    if (focused.error) {
        auto result = focused.attempted ? error("focus-outcome-unknown", focused.error)
            : noMutationError("precondition-failed", focused.error);
        if (focused.attempted) result["outcomeUnknown"] = true;
        return result;
    }
    if (GetForegroundWindow() != hwnd || !GetLastInputInfo(&input) || request.at("expectedInputTick") != input.dwTime
        || request.at("expectedWindowTitle") != utf8(root->windowTitle())) {
        auto result = error("focus-outcome-unknown", "The exact foreground or input epoch changed during table focus");
        result["outcomeUnknown"] = focused.attempted;
        return result;
    }
    return {{"ok", true}, {"focused", true}, {"focusChanged", focused.attempted},
        {"physicalInputUsed", false}, {"inputTick", input.dwTime}, {"binding", binding}};
}
