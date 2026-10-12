#pragma once
#include <QtWidgets/QApplication>
#include <QtWidgets/QTableView>
#include <QtWidgets/QAbstractButton>
#include <QtWidgets/QLineEdit>
#include <QtWidgets/QComboBox>
#include <QtWidgets/QAbstractSpinBox>
#include <QtWidgets/QTextEdit>
#include <QtWidgets/QPlainTextEdit>
#include <QtCore/QPointer>
#include <QtCore/QItemSelectionModel>
#include <QtCore/QThread>
#include <vector>

// This policy never clicks a cell, changes selection, commits an editor, or
// synthesizes a key. The broker separately binds the window and model proof.
static const char *tableFocusWidgetObstruction(QWidget *root, QTableView *view, QWidget *provenNumberDelegate = nullptr) {
    if (!root || !view || root->thread() != QThread::currentThread()
        || view->thread() != QThread::currentThread() || view->window() != root->window()
        || !root->isEnabled() || !view->isVisible() || !view->isEnabled()
        || QApplication::activeModalWidget() || QApplication::activePopupWidget())
        return "The exact table is unavailable or blocked by a modal/popup";
    if (!view->model() || !view->selectionModel() || view->rootIndex().isValid()
        || view->focusProxy() || view->focusPolicy() == Qt::NoFocus)
        return "The exact table has no directly focusable flat model";
    const auto editor = [](QWidget *widget) {
        return qobject_cast<QLineEdit *>(widget) || qobject_cast<QComboBox *>(widget)
            || qobject_cast<QAbstractSpinBox *>(widget) || qobject_cast<QTextEdit *>(widget)
            || qobject_cast<QPlainTextEdit *>(widget);
    };
    // Unknown QWidget delegates can commit on FocusOut without deriving from
    // an ordinary editor class. Only the exact root/view and owned passive
    // button route have a positive pre-dispatch focus proof here.
    if (auto *focused = QApplication::focusWidget(); focused && focused != view && focused != root && focused != provenNumberDelegate) {
        bool owned = false;
        for (auto *ancestor = focused; ancestor; ancestor = ancestor->parentWidget())
            if (ancestor == root) { owned = true; break; }
        if (!owned || editor(focused) || !qobject_cast<QAbstractButton *>(focused))
            return "The currently focused widget is not a proven owned passive focus source";
    }
    std::vector<QObject *> pending{view->viewport()};
    int visited = 0;
    while (!pending.empty()) {
        if (++visited > 20000) return "The exact table editor inventory exceeds its bound";
        auto *object = pending.back(); pending.pop_back();
        // Delegate editors need not derive from QLineEdit/QComboBox. The exact
        // viewport is painted by the view; any other visible descendant widget
        // is an unproven editor or index widget and blocks this focus-only path.
        if (auto *widget = qobject_cast<QWidget *>(object); widget && widget != view->viewport()
            && widget != provenNumberDelegate && widget->isVisible())
            return "The exact table contains an unproven visible viewport widget";
        for (auto *child : object->children()) pending.push_back(child);
    }
    auto *model = view->model();
    const int rows = model->rowCount(), columns = model->columnCount();
    if (rows < 0 || rows > 10000 || columns < 1 || columns > 100
        || static_cast<qint64>(rows) * columns > 100000 || model->canFetchMore(QModelIndex()))
        return "The exact table model is not completely bounded";
    // Qt's first OtherFocusReason event can create a current index implicitly.
    // Require an already bound current index; selection preparation belongs to
    // the outer cursor transaction and must receive its own fresh readback.
    const auto current = view->currentIndex();
    if (rows > 0 && (!current.isValid() || current.model() != model || current.parent().isValid()))
        return "The exact table has no already bound current model index";
    for (int row = 0; row < rows; ++row) for (int column = 0; column < columns; ++column) {
        const auto index = model->index(row, column);
        if (!index.isValid()) return "The exact table contains an invalid model index";
        if (auto *widget = view->indexWidget(index); widget && widget->isVisible()) {
            // Qt also returns ordinary delegate editors from indexWidget().
            // The positioning producer has independently proved this exact
            // unchanged Nr. delegate, including its accessible identity. Its
            // same pointer may occur only at the current leading Nr. index.
            if (widget != provenNumberDelegate || index != current || index.column() != 0
                || view->currentIndex() != current)
                return "The exact table contains a live index widget";
        }
    }
    return nullptr;
}

enum class TableFocusStatus { Unchanged, Focused, PreconditionFailed, OutcomeUnknown };
struct TableFocusResult { TableFocusStatus status; bool attempted; const char *error; };

// Capture is the same complete raw model/selection proof used by the broker.
// A subclass can run arbitrary application callbacks on focus events. Compare
// immediately afterwards; an uncertain result is never repaired or repeated.
template<typename State, typename Capture, typename Checkpoint>
static TableFocusResult dispatchExactTableFocus(QWidget *root, QTableView *view,
    const State &expected, Capture capture, Checkpoint checkpoint, bool &mutationStarted) {
    if (const auto *blocked = tableFocusWidgetObstruction(root, view))
        return {TableFocusStatus::PreconditionFailed, false, blocked};
    QPointer<QWidget> liveRoot(root), parent(view->parentWidget());
    QPointer<QTableView> live(view);
    QPointer<QAbstractItemModel> model(view->model());
    QPointer<QItemSelectionModel> selection(view->selectionModel());
    const auto identitiesUnchanged = [&]() {
        return liveRoot && live && parent && model && selection
            && live->parentWidget() == parent && live->window() == liveRoot->window()
            && live->model() == model && live->selectionModel() == selection;
    };
    if (capture() != expected)
        return {TableFocusStatus::PreconditionFailed, false, "The exact table proof changed before focus"};
    if (!identitiesUnchanged())
        return {TableFocusStatus::PreconditionFailed, false, "The exact root/table/model/selection identity changed before focus"};
    if (const auto *blocked = checkpoint())
        return {TableFocusStatus::PreconditionFailed, false, blocked};
    if (QApplication::focusWidget() == live && live->hasFocus())
        return {TableFocusStatus::Unchanged, false, nullptr};
    mutationStarted = true;
    live->setFocus(Qt::OtherFocusReason);
    if (!identitiesUnchanged())
        return {TableFocusStatus::OutcomeUnknown, true, "The exact root/table/model/selection identity changed during focus"};
    if (QApplication::focusWidget() != live || !live->hasFocus())
        return {TableFocusStatus::OutcomeUnknown, true, "The exact table did not retain keyboard focus"};
    if (const auto *blocked = tableFocusWidgetObstruction(liveRoot, live))
        return {TableFocusStatus::OutcomeUnknown, true, blocked};
    if (capture() != expected)
        return {TableFocusStatus::OutcomeUnknown, true, "The exact table proof changed during focus"};
    return {TableFocusStatus::Focused, true, nullptr};
}
