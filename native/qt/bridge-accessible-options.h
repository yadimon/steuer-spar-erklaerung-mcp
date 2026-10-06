#pragma once

// Read every profiled option, including rows outside the viewport. A visual
// accessibility tree cannot prove a complete grid: Qt marks offscreen cells
// invisible. This is a read-only table-interface projection in one GUI lease.
static Json accessibleTableOptions(QWidget *main, const Json &request) {
    activateAccessibilityClient();
    if (!request.contains("toolTitle") || !request.at("toolTitle").is_string()
        || !request.contains("expectedRootHwnd") || !request.at("expectedRootHwnd").is_number_integer()
        || !request.contains("tableAid") || !request.at("tableAid").is_string()
        || !request.contains("toggleColumn") || !request.at("toggleColumn").is_number_integer()
        || !request.contains("labelColumn") || !request.at("labelColumn").is_number_integer())
        return error("INVALID_OPTION_TARGET", "A complete option read requires an exact window, table and column binding");
    const auto titleText = request.at("toolTitle").get<std::string>();
    const auto aidText = request.at("tableAid").get<std::string>();
    if (titleText.empty() || titleText.size() > 16384 || aidText.empty() || aidText.size() > 65536)
        return error("INVALID_OPTION_TARGET", "The exact option binding exceeds its text bounds");
    const auto title = QString::fromUtf8(titleText.c_str());
    std::vector<QWidget *> windows;
    for (auto *widget : QApplication::topLevelWidgets())
        if (widget != main && widget->isVisible() && widget->windowTitle() == title) windows.push_back(widget);
    if (windows.size() != 1) return error(windows.empty() ? "not-found" : "ambiguous", "The exact option window is not unique");
    auto *root = windows.front();
    auto *rootInterface = QAccessible::queryAccessibleInterface(root);
    if (root->thread() != QThread::currentThread() || !rootInterface || !rootInterface->isValid())
        return error("stale-window", "The exact option window has no valid GUI-thread accessibility root");
    const auto rootHwnd = accessibleHost(rootInterface);
    if (!rootHwnd || request.at("expectedRootHwnd").get<std::uint64_t>() != rootHwnd)
        return error("stale-window", "The exact option window changed before the read");
    if (!root->isEnabled() || accessibilityModalBlocked(root, request))
        return error("window-obstructed", "The exact option window is disabled or obstructed");
    QElapsedTimer timer; timer.start();
    std::vector<QTableView *> views;
    std::vector<QObject *> pending{root}; int visited = 0;
    while (!pending.empty()) {
        if (++visited > 50000 || timer.elapsed() > 1000)
            return error("OPTION_LOOKUP_BOUND", "The exact option-table lookup exceeded its bound");
        auto *object = pending.back(); pending.pop_back();
        if (auto *view = qobject_cast<QTableView *>(object)) {
            if (view->isVisible() && view->isEnabled() && view->thread() == QThread::currentThread()) {
                auto *iface = QAccessible::queryAccessibleInterface(view);
                if (iface && iface->isValid() && accessibleText(QAccessibleBridgeUtils::accessibleId(iface)) == aidText) views.push_back(view);
            }
        }
        for (auto *child : object->children()) pending.push_back(child);
    }
    if (views.size() != 1) return error("stale", "The exact enabled option table is not unique");
    auto *view = views.front();
    auto *iface = QAccessible::queryAccessibleInterface(view);
    auto *table = iface ? iface->tableInterface() : nullptr;
    if (!table || !view->model() || !belongsTo(view, root))
        return error("INVALID_OPTION_TABLE", "The exact option table has no owned model and grid interface");
    const auto modelRoot = view->rootIndex();
    const int rows = table->rowCount(), columns = table->columnCount();
    const int toggleColumn = request.at("toggleColumn").get<int>(), labelColumn = request.at("labelColumn").get<int>();
    if (rows < 0 || rows > 500 || columns < 2 || columns > 20
        || rows != view->model()->rowCount(modelRoot) || columns != view->model()->columnCount(modelRoot)
        || toggleColumn < 0 || toggleColumn >= columns || labelColumn < 0 || labelColumn >= columns || toggleColumn == labelColumn)
        return error("INVALID_OPTION_TABLE", "The option grid dimensions or profiled columns are invalid");
    if (view->model()->canFetchMore(modelRoot))
        return error("model-incomplete", "The option model can fetch more rows; no incomplete option set returned");
    Json options = Json::array();
    for (int row = 0; row < rows; ++row) {
        if (timer.elapsed() > 1000) return error("OPTION_LOOKUP_BOUND", "The complete option-grid read exceeded its bound");
        auto *label = table->cellAt(row, labelColumn), *toggle = table->cellAt(row, toggleColumn);
        if (!label || !label->isValid() || !toggle || !toggle->isValid())
            return error("INVALID_OPTION_TABLE", "An option row has no valid label or checkbox interface");
        const auto name = accessibleText(label->text(QAccessible::Name).trimmed());
        const auto state = toggle->state();
        if (name.empty() || !state.checkable || state.checkStateMixed)
            return error("INVALID_OPTION_TABLE", "An option row has no exact name and binary check state");
        auto *cell = toggle->tableCellInterface();
        if (!cell || cell->rowIndex() != row || cell->columnIndex() != toggleColumn || cell->table() != iface)
            return error("INVALID_OPTION_TABLE", "An option checkbox belongs to another grid position");
        const auto flags = view->model()->flags(view->model()->index(row, toggleColumn, modelRoot));
        bool binary = false;
        const auto checkState = view->model()->data(view->model()->index(row, toggleColumn, modelRoot), Qt::CheckStateRole).toInt(&binary);
        if (!binary || (checkState != Qt::Unchecked && checkState != Qt::Checked)
            || bool(state.checked) != (checkState == Qt::Checked))
            return error("INVALID_OPTION_TABLE", "An option row has no consistent binary model and accessible state");
        options.push_back({{"index", row}, {"name", name}, {"selected", bool(state.checked)},
            {"toggleRid", accessibleRuntimeId(toggle, rootHwnd)},
            {"toggleAid", accessibleText(QAccessibleBridgeUtils::accessibleId(toggle))},
            {"toggleName", accessibleText(toggle->text(QAccessible::Name), true)},
            {"enabled", bool(flags & Qt::ItemIsEnabled) && !state.disabled},
            {"visible", !state.invisible && !toggle->rect().isEmpty()}});
    }
    return {{"ok", true}, {"hwnd", rootHwnd}, {"tableAid", aidText}, {"rowCount", rows}, {"columnCount", columns},
        {"complete", true}, {"canFetchMore", false}, {"options", std::move(options)}};
}
