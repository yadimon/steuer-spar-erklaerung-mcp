#pragma once

// A checkbox in an item view is model data. Qt's accessible toggle action
// changes selection; it does not commit CheckStateRole as the item delegate does.
// This exact mechanism is private to catalogue-bound receipt transactions.
static Json setAccessibleTableCheckState(QWidget *root, QAccessibleInterface *target, const Json &request) {
    if (!request.contains("expectedChecked") || !request.at("expectedChecked").is_boolean()
        || !request.contains("checked") || !request.at("checked").is_boolean()
        || !request.contains("expectedRowTitle") || !request.at("expectedRowTitle").is_string()
        || !request.contains("titleColumn") || !request.at("titleColumn").is_number_integer())
        return noMutationError("INVALID_EDIT", "The exact table checkbox requires row identity and old/requested binary states");
    auto *cell = target->tableCellInterface();
    auto *table = cell ? cell->table() : nullptr;
    // Accessible tree row numbers are flattened. This mechanism accepts only
    // flat QTableView models, for which accessible and model row indices agree.
    auto *view = table ? qobject_cast<QTableView *>(table->object()) : nullptr;
    if (!cell || !view || !belongsTo(view, root) || !view->model()
        || view->thread() != QThread::currentThread() || !view->isEnabled())
        return noMutationError("ACTION_UNSUPPORTED", "The exact checkbox is not an owned flat Qt table cell");
    if (request.contains("notifyClicked") && !request.at("notifyClicked").is_boolean())
        return noMutationError("INVALID_EDIT", "The optional checkbox notification must be explicit and binary");
    const bool notifyClicked = request.value("notifyClicked", false);
    if (notifyClicked) {
        if (!request.contains("expectedRootAid") || !request.at("expectedRootAid").is_string()
            || !request.contains("expectedTableAid") || !request.at("expectedTableAid").is_string())
            return noMutationError("INVALID_EDIT", "A checkbox business notification requires exact root/table identities");
        auto *rootInterface = QAccessible::queryAccessibleInterface(root);
        if (!rootInterface || !rootInterface->isValid()
            || request.at("expectedRootAid").get<std::string>() != accessibleText(QAccessibleBridgeUtils::accessibleId(rootInterface))
            || request.at("expectedTableAid").get<std::string>() != accessibleText(QAccessibleBridgeUtils::accessibleId(table)))
            return noMutationError("stale", "The exact checkbox notification root or table identity changed");
        if (view->metaObject()->indexOfSignal("clicked(QModelIndex)") < 0)
            return noMutationError("ACTION_UNSUPPORTED", "The exact checkbox view has no typed clicked notification");
    }
    const auto titleColumn = request.at("titleColumn").get<int>();
    const auto expectedTitle = actionText(request.at("expectedRowTitle"));
    if (expectedTitle.isEmpty() || titleColumn < 0 || titleColumn >= view->model()->columnCount(view->rootIndex()))
        return noMutationError("INVALID_EDIT", "The exact checkbox row-title binding is invalid");
    const auto index = view->model()->index(cell->rowIndex(), cell->columnIndex(), view->rootIndex());
    const auto titleIndex = view->model()->index(cell->rowIndex(), titleColumn, view->rootIndex());
    if (!index.isValid() || !titleIndex.isValid()
        || view->model()->data(titleIndex, Qt::DisplayRole).toString() != expectedTitle)
        return noMutationError("stale", "The exact checkbox row identity changed before dispatch");
    const auto flags = view->model()->flags(index);
    if (!(flags & Qt::ItemIsEnabled) || !(flags & Qt::ItemIsUserCheckable)
        || (flags & Qt::ItemIsUserTristate) || (flags & Qt::ItemIsAutoTristate))
        return noMutationError("ACTION_UNSUPPORTED", "The exact table checkbox is not enabled and binary");
    bool readable = false;
    const auto current = view->model()->data(index, Qt::CheckStateRole).toInt(&readable);
    if (!readable || (current != Qt::Unchecked && current != Qt::Checked))
        return noMutationError("ACTION_UNSUPPORTED", "The exact table checkbox has no binary model state");
    const auto expected = request.at("expectedChecked").get<bool>();
    const auto wanted = request.at("checked").get<bool>();
    if ((current == Qt::Checked) != expected || !target->state().checkable || target->state().checked != expected)
        return noMutationError("stale", "The exact table checkbox changed before dispatch");
    if (expected == wanted) return {{"ok", true}, {"checked", wanted}, {"changed", false}, {"notificationDispatched", false}};
    QPointer<QTableView> liveView(view);
    QPointer<QWidget> liveRoot(root);
    QPointer<QAbstractItemModel> liveModel(view->model());
    const QPersistentModelIndex liveIndex(index), liveTitle(titleIndex);
    mutationStarted = true;
    const bool accepted = liveModel->setData(liveIndex, wanted ? Qt::Checked : Qt::Unchecked, Qt::CheckStateRole);
    // A dataChanged callback can remove the row, replace its model or delete
    // its owner. Never dereference an object or index invalidated by that commit.
    if (!liveView || !liveModel || !liveIndex.isValid() || !liveTitle.isValid() || liveView->model() != liveModel
        || liveModel->data(liveTitle, Qt::DisplayRole).toString() != expectedTitle)
        return error("stale", "The exact checkbox row disappeared or changed during its model commit");
    const auto after = liveModel->data(liveIndex, Qt::CheckStateRole).toInt(&readable);
    if (!accepted || !readable || after != (wanted ? Qt::Checked : Qt::Unchecked))
        return error("ACTION_DISPATCH_FAILED", "The exact table checkbox model did not accept the requested state");
    if (notifyClicked) {
        // Qt's delegate model commit and item-view clicked signal are separate.
        // Application dirty tracking may depend on that notification. Bind it
        // to the same persistent index; never replay a callback or stale model.
        // Selection has its own application callbacks and can recheck an
        // unchecked row. The typed notification needs only its bound index;
        // do not introduce a second, unrelated selection mutation.
        const auto bound = [&] {
            return liveRoot && liveRoot->isVisible() && liveRoot->isEnabled() && liveView && liveModel
                && belongsTo(liveView, liveRoot) && liveIndex.isValid() && liveTitle.isValid() && liveView->model() == liveModel
                && liveModel->data(liveTitle, Qt::DisplayRole).toString() == expectedTitle
                && liveModel->data(liveIndex, Qt::CheckStateRole).toInt(&readable) == (wanted ? Qt::Checked : Qt::Unchecked) && readable;
        };
        if (!bound()) { auto failure = error("stale", "The exact checkbox binding changed before its clicked notification");
            failure["outcomeUnknown"] = true; return failure; }
        const QModelIndex notificationIndex(liveIndex);
        if (!QMetaObject::invokeMethod(liveView, "clicked", Qt::DirectConnection, Q_ARG(QModelIndex, notificationIndex))) {
            auto failure = error("ACTION_DISPATCH_FAILED", "The exact checkbox clicked signal could not be dispatched");
            failure["outcomeUnknown"] = true; return failure;
        }
        if (!bound()) { auto failure = error("stale", "The exact checkbox binding changed during its clicked notification");
            failure["outcomeUnknown"] = true; return failure; }
    }
    return {{"ok", true}, {"checked", wanted}, {"changed", true}, {"modelRole", "CheckStateRole"}, {"notificationDispatched", notifyClicked}};
}
