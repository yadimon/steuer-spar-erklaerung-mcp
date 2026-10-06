#pragma once
#include <QtWidgets/QTreeView>

// QAccessibleTree flattens visible rows. Bind its label to the actual viewport
// index, then use SSE's typed navigation signal rather than a flat root index.
static Json activateAccessibleNavigationItem(QWidget *root, QAccessibleInterface *target) {
    auto *cell = target->tableCellInterface();
    auto *table = cell ? cell->table() : nullptr;
    auto *view = table ? qobject_cast<QTreeView *>(table->object()) : nullptr;
    if (!cell || !view || view->objectName() != "NavWidgetSSE" || target->role() != QAccessible::TreeItem || !belongsTo(view, root)
        || !view->model() || view->thread() != QThread::currentThread()
        || !view->isEnabled() || !view->isVisible() || cell->columnIndex() != 0
        || view->metaObject()->indexOfSignal("gotoModelIndex(QModelIndex)") < 0)
        return noMutationError("ACTION_UNSUPPORTED", "The exact target is not an owned typed navigation-tree label");
    const auto rect = target->rect();
    if (rect.isEmpty()) return noMutationError("stale", "The exact navigation label is not visible");
    auto *window = accessibleWindow(target);
    const auto nativeRect = QHighDpi::toNativePixels(QRectF(rect), window).toRect();
    const QPoint nativeGlobal(nativeRect.x() + std::min(50, std::max(8, nativeRect.width() / 3)),
        nativeRect.y() + nativeRect.height() / 2);
    const auto local = view->viewport()->mapFromGlobal(QHighDpi::fromNativePixels(nativeGlobal, window));
    const auto index = view->indexAt(local);
    const auto display = view->model()->data(index, Qt::AccessibleTextRole);
    const auto title = display.isValid() ? display.toString() : view->model()->data(index, Qt::DisplayRole).toString();
    const auto flags = view->model()->flags(index);
    if (title.isEmpty() || !view->viewport()->rect().contains(local) || !index.isValid() || index.column() != 0
        || !view->visualRect(index).contains(local) || !(flags & Qt::ItemIsEnabled) || !(flags & Qt::ItemIsSelectable)
        || accessibleText(title, true) != accessibleText(target->text(QAccessible::Name), true))
        return noMutationError("stale", "The observed navigation label does not bind one live hierarchical model index");
    mutationStarted = true;
    if (!QMetaObject::invokeMethod(view, "gotoModelIndex", Qt::DirectConnection, Q_ARG(QModelIndex, index))) {
        auto failure = error("ACTION_DISPATCH_FAILED", "The exact typed navigation signal could not be dispatched; no replay was attempted");
        failure["outcomeUnknown"] = true;
        return failure;
    }
    return {{"ok", true}, {"modelIndexBinding", "viewport-hierarchical"}, {"dispatch", "qt-navigation-signal"}};
}
