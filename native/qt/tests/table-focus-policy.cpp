#include <QtWidgets/QApplication>
#include <QtWidgets/QVBoxLayout>
#include <QtWidgets/QPushButton>
#include <QtWidgets/QScrollBar>
#include <QtWidgets/QStyledItemDelegate>
#include <QtGui/QStandardItemModel>
#include <QtGui/QFocusEvent>
#include <QtCore/QItemSelectionModel>
#include <cstdlib>
#include <iostream>
#include <functional>
#include "../bridge-table-focus-policy.h"
#include "../bridge-table-position-policy.h"

static void require(bool condition, const char *message) {
    if (!condition) { std::cerr << message << '\n'; std::exit(1); }
}
class FocusTable : public QTableView {
public:
    bool mutateOnFocus = false;
    int focusEvents = 0;
    std::function<void()> onFocus;
protected:
    void focusInEvent(QFocusEvent *event) override {
        ++focusEvents;
        QTableView::focusInEvent(event);
        if (mutateOnFocus) model()->setData(model()->index(0, 0), QStringLiteral("unexpected"));
        if (onFocus) onFocus();
    }
};

class NumberDelegate : public QStyledItemDelegate {
public:
    mutable int commits = 0;
    QWidget *createEditor(QWidget *parent, const QStyleOptionViewItem &, const QModelIndex &) const override {
        auto *editor = new QLineEdit(parent); editor->setFrame(false); return editor;
    }
    void updateEditorGeometry(QWidget *editor, const QStyleOptionViewItem &option, const QModelIndex &) const override {
        editor->setGeometry(option.rect);
    }
    void setModelData(QWidget *editor, QAbstractItemModel *model, const QModelIndex &index) const override {
        ++commits; QStyledItemDelegate::setModelData(editor, model, index);
    }
};

int main(int argc, char **argv) {
    QApplication app(argc, argv);
    QWidget root;
    QVBoxLayout layout(&root);
    QPushButton anchor(QStringLiteral("Synthetic focus anchor"), &root);
    FocusTable table;
    QStandardItemModel model(3, 2);
    model.setData(model.index(0, 0), QStringLiteral("original"));
    model.setData(model.index(1, 1), QStringLiteral("second"));
    table.setModel(&model);
    layout.addWidget(&anchor); layout.addWidget(&table);
    root.show(); QApplication::setActiveWindow(&root); anchor.setFocus(); app.processEvents();
    table.setCurrentIndex(model.index(1, 0));
    table.selectionModel()->select(model.index(1, 0), QItemSelectionModel::ClearAndSelect);
    int clicks = 0, changes = 0;
    QObject::connect(&table, &QTableView::clicked, &root, [&](const QModelIndex &) { ++clicks; });
    QObject::connect(&model, &QStandardItemModel::dataChanged, &root,
        [&](const QModelIndex &, const QModelIndex &, const QList<int> &) { ++changes; });
    const auto capture = [&]() {
        QStringList proof;
        for (int row = 0; row < model.rowCount(); ++row) for (int column = 0; column < model.columnCount(); ++column)
            proof << model.data(model.index(row, column)).toString();
        proof << QString::number(table.currentIndex().row()) << QString::number(table.currentIndex().column());
        for (const auto &index : table.selectionModel()->selectedIndexes())
            proof << QString::number(index.row()) + ':' + QString::number(index.column());
        return proof;
    };
    const auto initial = capture(); bool attempted = false;
    const auto checkpoint = []() -> const char * { return nullptr; };
    const auto normal = dispatchExactTableFocus(&root, &table, initial, capture, checkpoint, attempted);
    require(normal.status == TableFocusStatus::Focused && attempted, "Exact table must receive native focus");
    require(table.hasFocus() && QApplication::focusWidget() == &table, "Actual Qt keyboard focus must be proven");
    require(clicks == 0 && changes == 0 && capture() == initial, "Focus must preserve cells/current/selection without clicks");
    attempted = false;
    const auto unchanged = dispatchExactTableFocus(&root, &table, initial, capture, checkpoint, attempted);
    require(unchanged.status == TableFocusStatus::Unchanged && !attempted, "Existing exact focus must not be repeated");
    anchor.setFocus();
    attempted = false;
    auto wrong = initial; wrong[0] = QStringLiteral("stale");
    const auto stale = dispatchExactTableFocus(&root, &table, wrong, capture, checkpoint, attempted);
    require(stale.status == TableFocusStatus::PreconditionFailed && !attempted, "Stale model must fail before focus");
    const auto staleEpoch = []() -> const char * { return "Synthetic foreign input epoch"; };
    attempted = false;
    const auto blockedEpoch = dispatchExactTableFocus(&root, &table, initial, capture, staleEpoch, attempted);
    require(blockedEpoch.status == TableFocusStatus::PreconditionFailed && !attempted && anchor.hasFocus(),
        "The final epoch checkpoint must block focus after the complete model proof");
    QLineEdit editor(table.viewport()); editor.show();
    require(tableFocusWidgetObstruction(&root, &table) != nullptr, "Visible delegate editor must block focus");
    attempted = false;
    const auto blockedEditor = dispatchExactTableFocus(&root, &table, initial, capture, checkpoint, attempted);
    require(blockedEditor.status == TableFocusStatus::PreconditionFailed && !attempted, "Delegate editor must receive no focus action");
    editor.hide();
    QWidget customEditor(table.viewport()); customEditor.show();
    require(tableFocusWidgetObstruction(&root, &table) != nullptr, "A custom QWidget delegate must block focus without an editor whitelist");
    customEditor.hide();
    QLineEdit unrelated(&root); unrelated.show(); unrelated.setFocus();
    require(tableFocusWidgetObstruction(&root, &table) != nullptr, "Focused unrelated editor must block focus-out commits");
    anchor.setFocus(); unrelated.hide();
    QWidget customFocused(&root); customFocused.setFocusPolicy(Qt::StrongFocus); customFocused.show(); customFocused.setFocus();
    require(tableFocusWidgetObstruction(&root, &table) != nullptr, "Unknown focused custom widget must block focus-out commits");
    anchor.setFocus(); customFocused.hide();
    table.setFocusProxy(&anchor);
    require(tableFocusWidgetObstruction(&root, &table) != nullptr, "Focus proxy must not redirect an exact table transaction");
    table.setFocusProxy(nullptr);
    table.setFocusPolicy(Qt::NoFocus);
    require(tableFocusWidgetObstruction(&root, &table) != nullptr, "NoFocus table must be rejected");
    table.setFocusPolicy(Qt::StrongFocus);
    table.setCurrentIndex(QModelIndex());
    attempted = false;
    const auto unboundCurrent = dispatchExactTableFocus(&root, &table, capture(), capture, checkpoint, attempted);
    require(unboundCurrent.status == TableFocusStatus::PreconditionFailed && !attempted,
        "Unbound current index must fail before Qt's implicit first-focus selection");
    table.setCurrentIndex(model.index(1, 0));
    table.selectionModel()->select(model.index(1, 0), QItemSelectionModel::ClearAndSelect);
    table.openPersistentEditor(model.index(0, 0));
    require(tableFocusWidgetObstruction(&root, &table) != nullptr, "Persistent editor must block focus");
    table.closePersistentEditor(model.index(0, 0)); app.processEvents();
    anchor.setFocus(); table.mutateOnFocus = true; attempted = false;
    const auto unexpected = dispatchExactTableFocus(&root, &table, initial, capture, checkpoint, attempted);
    require(unexpected.status == TableFocusStatus::OutcomeUnknown && attempted, "Subclass focus side effects must fail without retry or rollback");
    require(clicks == 0 && changes == 1 && model.data(model.index(0, 0)).toString() == QStringLiteral("unexpected"),
        "An unconfirmed focus side effect must remain observable");
    table.mutateOnFocus = false; anchor.setFocus();
    QStandardItemModel replacement(3, 2);
    table.onFocus = [&]() { table.setModel(&replacement); };
    attempted = false;
    const auto replaced = dispatchExactTableFocus(&root, &table, capture(), capture, checkpoint, attempted);
    require(replaced.status == TableFocusStatus::OutcomeUnknown && attempted,
        "A focus callback replacing the model must fail before reading stale model state");
    table.onFocus = nullptr; table.setModel(&model);
    table.setCurrentIndex(model.index(1, 0));
    table.selectionModel()->select(model.index(1, 0), QItemSelectionModel::ClearAndSelect);
    anchor.setFocus();
    QWidget otherRoot;
    table.onFocus = [&]() { table.setParent(&otherRoot); };
    attempted = false;
    const auto reparented = dispatchExactTableFocus(&root, &table, capture(), capture, checkpoint, attempted);
    require(reparented.status == TableFocusStatus::OutcomeUnknown && attempted,
        "A focus callback reparenting the view must fail before using the old root");
    table.onFocus = nullptr; table.setParent(&root);
    // Pure owned fixture: positioning must select one Nr. index, scroll it
    // into the actual viewport and never dispatch clicked or write model data.
    QWidget positionRoot; QVBoxLayout positionLayout(&positionRoot);
    QPushButton positionAnchor(QStringLiteral("Position anchor"), &positionRoot);
    QTableView positionTable; QStandardItemModel positionModel(80, 3);
    positionModel.setHeaderData(0, Qt::Horizontal, QStringLiteral("Nr."));
    for (int row = 0; row < positionModel.rowCount(); ++row) {
        positionModel.setData(positionModel.index(row, 0), QStringLiteral(""));
        positionModel.item(row, 0)->setFlags(Qt::ItemIsSelectable | Qt::ItemIsEditable | Qt::ItemIsEnabled);
    }
    positionTable.setModel(&positionModel); positionTable.setSelectionBehavior(QAbstractItemView::SelectRows);
    positionLayout.addWidget(&positionAnchor); positionLayout.addWidget(&positionTable);
    positionRoot.resize(420, 200); positionRoot.show(); QApplication::setActiveWindow(&positionRoot);
    positionAnchor.setFocus(); app.processEvents();
    positionTable.setCurrentIndex(QModelIndex()); positionTable.selectionModel()->clearSelection();
    require(!positionTable.currentIndex().isValid() && positionTable.selectionModel()->selectedIndexes().isEmpty()
        && tableFocusWidgetObstruction(&positionRoot, &positionTable) != nullptr,
        "An unselected table must remain blocked for implicit focus-only initialization");
    const auto positionCapture = [&] {
        QStringList data;
        for (int row = 0; row < positionModel.rowCount(); ++row) for (int column = 0; column < positionModel.columnCount(); ++column)
            data << positionModel.data(positionModel.index(row, column)).toString();
        return data;
    };
    const auto originalPositionModel = positionCapture(); int positionClicks = 0;
    QObject::connect(&positionTable, &QTableView::clicked, [&] { ++positionClicks; });
    bool positionedAttempt = false;
    const auto unselectedStale = dispatchExactTablePosition(&positionRoot, &positionTable, 61,
        QStringList{QStringLiteral("stale")}, positionCapture, checkpoint, positionedAttempt);
    require(unselectedStale.error && !positionedAttempt && !positionTable.currentIndex().isValid()
        && positionTable.selectionModel()->selectedIndexes().isEmpty(),
        "Unselected initialization must still reject a stale complete model before acting");
    const auto unselectedEpoch = dispatchExactTablePosition(&positionRoot, &positionTable, 61,
        originalPositionModel, positionCapture, staleEpoch, positionedAttempt);
    require(unselectedEpoch.error && !positionedAttempt && !positionTable.currentIndex().isValid()
        && positionTable.selectionModel()->selectedIndexes().isEmpty(),
        "A foreign input epoch must leave the unselected current index and selection untouched");
    QLineEdit unrelatedPositionEditor(&positionRoot); unrelatedPositionEditor.show(); unrelatedPositionEditor.setFocus();
    const auto unselectedEditor = dispatchExactTablePosition(&positionRoot, &positionTable, 61,
        originalPositionModel, positionCapture, checkpoint, positionedAttempt);
    require(unselectedEditor.error && !positionedAttempt && !positionTable.currentIndex().isValid()
        && positionTable.selectionModel()->selectedIndexes().isEmpty(),
        "An unrelated focused editor must block unselected initialization before any selection");
    unrelatedPositionEditor.hide(); positionAnchor.setFocus();
    QLineEdit unselectedViewportEditor(positionTable.viewport()); unselectedViewportEditor.show();
    const auto unselectedWidget = dispatchExactTablePosition(&positionRoot, &positionTable, 61,
        originalPositionModel, positionCapture, checkpoint, positionedAttempt);
    require(unselectedWidget.error && !positionedAttempt && !positionTable.currentIndex().isValid()
        && positionTable.selectionModel()->selectedIndexes().isEmpty(),
        "A live viewport widget must block unselected initialization before any selection");
    unselectedViewportEditor.hide(); positionAnchor.setFocus();
    const auto positioned = dispatchExactTablePosition(&positionRoot, &positionTable, 61,
        originalPositionModel, positionCapture, checkpoint, positionedAttempt);
    require(!positioned.error && positionedAttempt && positionTable.currentIndex() == positionModel.index(61, 0),
        "Exact distant target must be positioned without a linear key walk");
    require(positionTable.selectionModel()->selectedIndexes().size() == 1
        && positionTable.selectionModel()->selectedIndexes().front() == positionModel.index(61, 0),
        "Row selection behavior must not broaden the private Nr. selection");
    require(positionTable.viewport()->rect().contains(positionTable.visualRect(positionModel.index(61, 0)))
        && positionCapture() == originalPositionModel && positionClicks == 0 && positionAnchor.hasFocus(),
        "Position must preserve values and passive focus without clicks, keys or editor commits");
    positionTable.setCurrentIndex(QModelIndex());
    positionTable.selectionModel()->select(positionModel.index(1, 0), QItemSelectionModel::ClearAndSelect);
    positionedAttempt = false;
    const auto inconsistentPosition = dispatchExactTablePosition(&positionRoot, &positionTable, 62,
        originalPositionModel, positionCapture, checkpoint, positionedAttempt);
    require(inconsistentPosition.error && !positionedAttempt,
        "An invalid current index with a nonempty selection must fail before positioning");
    positionTable.selectionModel()->setCurrentIndex(positionModel.index(61, 0), QItemSelectionModel::ClearAndSelect);
    positionedAttempt = false;
    const auto wrongPosition = dispatchExactTablePosition(&positionRoot, &positionTable, 62,
        QStringList{QStringLiteral("stale")}, positionCapture, checkpoint, positionedAttempt);
    require(wrongPosition.error && !positionedAttempt, "Changed full model must reject before selecting or scrolling");
    const auto foreignPosition = dispatchExactTablePosition(&positionRoot, &positionTable, 62,
        originalPositionModel, positionCapture, staleEpoch, positionedAttempt);
    require(foreignPosition.error && !positionedAttempt, "Foreign epoch must reject before positioning");
    positionTable.setRowHidden(62, true);
    const auto hiddenPosition = dispatchExactTablePosition(&positionRoot, &positionTable, 62,
        originalPositionModel, positionCapture, checkpoint, positionedAttempt);
    require(hiddenPosition.error && !positionedAttempt, "Hidden target must not receive position actions");
    positionTable.setRowHidden(62, false);
    QLineEdit createdEditor(positionTable.viewport()); createdEditor.hide();
    const auto editorConnection = QObject::connect(positionTable.selectionModel(), &QItemSelectionModel::currentChanged,
        [&](const QModelIndex &, const QModelIndex &) { createdEditor.show(); });
    const auto delegatePosition = dispatchExactTablePosition(&positionRoot, &positionTable, 62,
        originalPositionModel, positionCapture, checkpoint, positionedAttempt);
    require(delegatePosition.error && positionedAttempt && createdEditor.isVisible() && positionClicks == 0,
        "A CurrentChanged delegate must remain open and stop positioning without focus-out or replay");
    QObject::disconnect(editorConnection); createdEditor.hide(); positionedAttempt = false;
    const auto updateExactEditor = [&] {
        createdEditor.setGeometry(positionTable.visualRect(positionTable.currentIndex()));
    };
    const auto exactEditorConnection = QObject::connect(positionTable.selectionModel(), &QItemSelectionModel::currentChanged,
        [&](const QModelIndex &, const QModelIndex &) { updateExactEditor(); createdEditor.setText(QString()); createdEditor.show(); createdEditor.setFocus(); });
    const auto scrollEditorConnection = QObject::connect(positionTable.verticalScrollBar(), &QScrollBar::valueChanged,
        [&](int) { updateExactEditor(); });
    const auto exactPost = [&](QWidget *ownedRoot, QTableView *ownedView, const QModelIndex &target) -> const char * {
        auto *proven = tablePositionNumberDelegate(ownedView, target);
        if (!proven) return "Unchanged exact target Nr. delegate proof failed";
        return tableFocusWidgetObstruction(ownedRoot, ownedView, proven);
    };
    const auto exactDelegatePosition = dispatchExactTablePosition(&positionRoot, &positionTable, 21,
        originalPositionModel, positionCapture, checkpoint, positionedAttempt, exactPost);
    require(!exactDelegatePosition.error && positionedAttempt && createdEditor.hasFocus() && createdEditor.isVisible()
        && positionCapture() == originalPositionModel && positionClicks == 0,
        "An exact unchanged target Nr. delegate may remain pending independent closure without native focus-out");
    createdEditor.setText(QStringLiteral("uncommitted"));
    require(tablePositionNumberDelegate(&positionTable, positionTable.currentIndex()) == nullptr
        && createdEditor.isVisible() && createdEditor.hasFocus(), "Changed Nr. delegate must remain open and unclosed");
    createdEditor.setText(QString()); createdEditor.move(0, 0);
    require(tablePositionNumberDelegate(&positionTable, positionTable.currentIndex()) == nullptr,
        "Wrong delegate geometry must not borrow current target authority");
    QObject::disconnect(exactEditorConnection); QObject::disconnect(scrollEditorConnection);
    createdEditor.hide(); positionAnchor.setFocus(); positionedAttempt = false;

    // A real edit() registers the QStyledItemDelegate editor in Qt's index
    // editor map. indexWidget() must expose that same pointer; the prior manual
    // viewport-child fixture could not reproduce this producer postcondition.
    NumberDelegate numberDelegate;
    positionTable.setItemDelegateForColumn(0, &numberDelegate);
    positionTable.setEditTriggers(QAbstractItemView::NoEditTriggers);
    QPointer<QLineEdit> registeredEditor;
    const auto registeredEditorConnection = QObject::connect(positionTable.selectionModel(), &QItemSelectionModel::currentChanged,
        [&](const QModelIndex &current, const QModelIndex &) {
            positionTable.edit(current);
            registeredEditor = qobject_cast<QLineEdit *>(positionTable.indexWidget(current));
        });
    const auto registeredPost = [&](QWidget *ownedRoot, QTableView *ownedView, const QModelIndex &target) -> const char * {
        auto *proven = tablePositionNumberDelegate(ownedView, target);
        if (!proven || ownedView->indexWidget(target) != proven)
            return "The real Nr. delegate did not retain its exact index registration";
        return tableFocusWidgetObstruction(ownedRoot, ownedView, proven);
    };
    const auto registeredPosition = dispatchExactTablePosition(&positionRoot, &positionTable, 33,
        originalPositionModel, positionCapture, checkpoint, positionedAttempt, registeredPost);
    require(!registeredPosition.error && positionedAttempt && registeredEditor && registeredEditor->hasFocus()
        && positionTable.indexWidget(positionModel.index(33, 0)) == registeredEditor.data(),
        "A real unchanged current Nr. editor must survive its duplicate indexWidget inventory check");
    require(registeredEditor->text().isEmpty() && positionModel.data(positionModel.index(33, 0)).metaType().id() == QMetaType::QString
        && static_cast<int>(positionModel.flags(positionModel.index(33, 0))) == 35
        && positionTable.viewport()->rect().contains(positionTable.visualRect(positionModel.index(33, 0)))
        && positionCapture() == originalPositionModel && positionClicks == 0 && numberDelegate.commits == 0,
        "Registered blank-string Nr. positioning must preserve model, flags, viewport and zero commits/clicks");
    require(tableFocusWidgetObstruction(&positionRoot, &positionTable) != nullptr,
        "Ordinary focus-only calls must continue to reject the live registered Nr. editor");
    registeredEditor->setText(QStringLiteral("uncommitted"));
    require(tablePositionNumberDelegate(&positionTable, positionTable.currentIndex()) == nullptr
        && registeredEditor->isVisible() && registeredEditor->hasFocus() && numberDelegate.commits == 0,
        "A changed registered Nr. editor must receive no proven-delegate authority or focus-out");
    registeredEditor->setText(QStringLiteral(""));
    registeredEditor->move(0, 0);
    require(tablePositionNumberDelegate(&positionTable, positionTable.currentIndex()) == nullptr,
        "A registered editor with wrong geometry must not receive Nr. authority");
    registeredEditor->setGeometry(positionTable.visualRect(positionTable.currentIndex()));
    auto *provenRegistered = tablePositionNumberDelegate(&positionTable, positionTable.currentIndex());
    require(provenRegistered == registeredEditor.data(), "The unchanged registered Nr. must be freshly rebound");
    require(tablePositionNumberDelegate(&positionTable, positionModel.index(32, 0)) == nullptr
        && tablePositionNumberDelegate(&positionTable, positionModel.index(33, 1)) == nullptr,
        "The registered Nr. delegate must not bind another row or a non-Nr. column with the same blank value");
    // Aliasing the same pointer at a different index must remain blocked even
    // though its current Nr. geometry and value have been independently proven.
    positionTable.setIndexWidget(positionModel.index(33, 1), provenRegistered);
    provenRegistered->setGeometry(positionTable.visualRect(positionModel.index(33, 0)));
    require(positionTable.indexWidget(positionModel.index(33, 0)) == provenRegistered
        && positionTable.indexWidget(positionModel.index(33, 1)) == provenRegistered
        && positionTable.currentIndex() == positionModel.index(33, 0),
        "The alias fixture must genuinely register one pointer at two model indices");
    require(tableFocusWidgetObstruction(&positionRoot, &positionTable, provenRegistered) != nullptr
        && positionCapture() == originalPositionModel && numberDelegate.commits == 0,
        "A proven Nr. pointer aliased at another column must remain blocked without committing");
    QObject::disconnect(registeredEditorConnection);
    registeredEditor->hide(); positionAnchor.setFocus();
    // Dropping the fixture registrations is cleanup, never a production retry.
    positionTable.setIndexWidget(positionModel.index(33, 0), nullptr);
    positionTable.setIndexWidget(positionModel.index(33, 1), nullptr);
    app.processEvents();
    positionedAttempt = false;
    const auto mutateConnection = QObject::connect(positionTable.selectionModel(), &QItemSelectionModel::currentChanged,
        [&](const QModelIndex &, const QModelIndex &) { positionModel.setData(positionModel.index(0, 1), QStringLiteral("callback")); });
    const auto mutatedPosition = dispatchExactTablePosition(&positionRoot, &positionTable, 63,
        originalPositionModel, positionCapture, checkpoint, positionedAttempt);
    require(mutatedPosition.error && positionedAttempt && positionClicks == 0,
        "Selection callback model changes must stop without repairing or retrying");
    QObject::disconnect(mutateConnection);
    std::cout << "Native Qt table focus and exact positioning policy checks passed\n";
    return 0;
}
