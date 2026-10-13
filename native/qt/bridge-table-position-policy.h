#pragma once
#include "bridge-table-focus-policy.h"
#include <QtCore/QPersistentModelIndex>

struct TablePositionResult { bool attempted; const char *error; };

static QLineEdit *tablePositionNumberDelegate(QTableView *view, const QModelIndex &target) {
    auto *editor = qobject_cast<QLineEdit *>(QApplication::focusWidget());
    if (!view || !target.isValid() || target.model() != view->model() || target.parent().isValid() || target.column() != 0
        || !editor || editor->parentWidget() != view->viewport() || !editor->isVisible() || !editor->isEnabled()
        || editor->geometry() != view->visualRect(target)) return nullptr;
    const auto display = view->model()->data(target, Qt::DisplayRole), edit = view->model()->data(target, Qt::EditRole);
    if ((!display.isNull() && display.metaType().id() != QMetaType::QString)
        || (!edit.isNull() && edit.metaType().id() != QMetaType::QString)
        || display.toString() != edit.toString() || editor->text() != edit.toString()) return nullptr;
    return editor;
}

// Private navigation only: select one Nr. index and scroll its genuine
// viewport. Application selection/scroll callbacks are observed, never replayed.
template<typename State, typename Capture, typename Checkpoint, typename PostObstruction>
static TablePositionResult dispatchExactTablePosition(QWidget *root, QTableView *view, int row,
    const State &expectedModel, Capture captureModel, Checkpoint checkpoint, bool &mutationStarted, PostObstruction postObstruction) {
    if (const auto *blocked = tableFocusWidgetObstruction(root, view, nullptr, true)) return {false, blocked};
    auto *model = view->model();
    if (row < 0 || row >= model->rowCount() || view->isRowHidden(row) || view->isColumnHidden(0))
        return {false, "The exact target Nr. index is hidden or outside its flat model"};
    const QPersistentModelIndex target(model->index(row, 0));
    if (!target.isValid() || target.parent().isValid() || !(model->flags(target) & Qt::ItemIsEnabled)
        || !(model->flags(target) & Qt::ItemIsSelectable) || (model->flags(target) & Qt::ItemIsUserCheckable))
        return {false, "The exact target Nr. index is not an enabled plain selectable cell"};
    QPointer<QWidget> liveRoot(root), parent(view->parentWidget()), viewport(view->viewport());
    QPointer<QTableView> live(view);
    QPointer<QAbstractItemModel> liveModel(model);
    QPointer<QItemSelectionModel> selection(view->selectionModel());
    const auto identities = [&] {
        return liveRoot && live && parent && viewport && liveModel && selection && target.isValid()
            && live->parentWidget() == parent && live->window() == liveRoot->window() && live->viewport() == viewport
            && live->model() == liveModel && live->selectionModel() == selection && target.model() == liveModel
            && target.row() == row && target.column() == 0 && !target.parent().isValid();
    };
    if (captureModel() != expectedModel || !identities()) return {false, "The complete model or exact target identity changed before positioning"};
    if (const auto *blocked = checkpoint()) return {false, blocked};
    mutationStarted = true;
    selection->setCurrentIndex(target, QItemSelectionModel::ClearAndSelect);
    if (!identities()) return {true, "The exact model, root or index changed during Nr. selection"};
    const auto selected = selection->selectedIndexes();
    if (live->currentIndex() != target || selected.size() != 1 || selected.front() != target)
        return {true, "The exact target Nr. cell did not retain current index and sole selection"};
    if (const auto *blocked = postObstruction(liveRoot, live, target)) return {true, blocked};
    if (captureModel() != expectedModel || !identities()) return {true, "Nr. selection changed the complete raw model"};
    if (const auto *blocked = checkpoint()) return {true, blocked};
    live->scrollTo(target, QAbstractItemView::PositionAtCenter);
    if (!identities()) return {true, "The exact model, root or index changed during target scrolling"};
    if (const auto *blocked = postObstruction(liveRoot, live, target)) return {true, blocked};
    const auto rect = live->visualRect(target);
    if (rect.isEmpty() || !viewport->rect().contains(rect) || live->currentIndex() != target
        || selection->selectedIndexes().size() != 1 || selection->selectedIndexes().front() != target)
        return {true, "The exact sole target Nr. selection is not fully contained in its genuine viewport"};
    if (captureModel() != expectedModel || !identities()) return {true, "Target scrolling changed the complete raw model"};
    if (const auto *blocked = checkpoint()) return {true, blocked};
    return {true, nullptr};
}

template<typename State, typename Capture, typename Checkpoint>
static TablePositionResult dispatchExactTablePosition(QWidget *root, QTableView *view, int row,
    const State &expectedModel, Capture captureModel, Checkpoint checkpoint, bool &mutationStarted) {
    return dispatchExactTablePosition(root, view, row, expectedModel, captureModel, checkpoint, mutationStarted,
        [](QWidget *ownedRoot, QTableView *ownedView, const QModelIndex &) {
            return tableFocusWidgetObstruction(ownedRoot, ownedView);
        });
}
