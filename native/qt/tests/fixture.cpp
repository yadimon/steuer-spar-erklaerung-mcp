#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <QtWidgets/QApplication>
#include <QtWidgets/QMainWindow>
#include <QtWidgets/QTableView>
#include <QtWidgets/QTreeView>
#include <QtWidgets/QLineEdit>
#include <QtWidgets/QDialog>
#include <QtWidgets/QVBoxLayout>
#include <QtWidgets/QHBoxLayout>
#include <QtWidgets/QLabel>
#include <QtWidgets/QPushButton>
#include <QtWidgets/QCheckBox>
#include <QtWidgets/QComboBox>
#include <QtWidgets/QDateEdit>
#include <QtWidgets/QTextEdit>
#include <QtWidgets/QGridLayout>
#include <QtGui/QStandardItemModel>
#include <QtGui/QAccessible>
#include <QtGui/QIntValidator>
#include <QtCore/QTimer>
#include <QtCore/QThread>
#include <fstream>
#include <iostream>
#include <thread>
#include <memory>
#include <nlohmann/json.hpp>

class DialogUITable : public QTableView {
    Q_OBJECT
public:
    explicit DialogUITable(QWidget *parent) : QTableView(parent) {}
};
class SyntheticNavigationTree : public QTreeView {
    Q_OBJECT
public:
    explicit SyntheticNavigationTree(QWidget *parent) : QTreeView(parent) {}
Q_SIGNALS:
    void gotoModelIndex(const QModelIndex &index);
};
static std::string desktopName(HDESK desktop) {
    char name[256]{}; DWORD required = 0;
    if (!GetUserObjectInformationA(desktop, UOI_NAME, name, sizeof(name), &required))
        throw std::runtime_error("Cannot verify fixture desktop");
    return name;
}
int main(int argc, char **argv) {
    if (argc != 3) return 2;
    const auto targetDesktop = OpenDesktopA(argv[2], 0, FALSE, GENERIC_ALL);
    if (!targetDesktop || !SetThreadDesktop(targetDesktop)) return 7;
    const auto ownDesktop = desktopName(GetThreadDesktop(GetCurrentThreadId()));
    const auto input = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    if (!input) return 3;
    const auto inputName = desktopName(input); CloseDesktop(input);
    if (ownDesktop != argv[2] || ownDesktop.rfind("SSEQtNativeTest_", 0) != 0 || ownDesktop == inputName) return 4;
    QApplication app(argc, argv);
    QMainWindow window;
    auto *panel = new QWidget(&window);
    panel->setAttribute(Qt::WA_NativeWindow);
    panel->setObjectName("RedThreadContent");
    auto *layout = new QVBoxLayout(panel);
    auto *frame = new QWidget(panel); frame->setObjectName("ClientFrameSSE");
    auto *header = new QWidget(frame); header->setObjectName("ClientHeader");
    auto *headingLayout = new QVBoxLayout(header); headingLayout->addWidget(new QLabel("Synthetic heading", header));
    auto *frameLayout = new QVBoxLayout(frame); frameLayout->addWidget(header);
    layout->addWidget(frame);
    auto *subpageRow = new QWidget(panel);
    auto *rowLayout = new QHBoxLayout(subpageRow);
    rowLayout->addStretch(); rowLayout->addWidget(new QLabel("Synthetic subpage", subpageRow));
    auto *open = new QPushButton(subpageRow); open->setObjectName("Button"); rowLayout->addWidget(open);
    rowLayout->addStretch(); layout->addWidget(subpageRow);
    auto *check = new QCheckBox(QString::fromUtf8("Synthetic Straße"), panel); check->setObjectName("syntheticCheck"); check->setChecked(true); layout->addWidget(check);
    auto *field = new QLineEdit(QString::fromUtf8("Native field – пример"), panel);
    field->setObjectName("syntheticField");
    auto *nativeAction = new QPushButton("Synthetic action", panel);
    nativeAction->setObjectName("syntheticAction");
    QObject::connect(nativeAction, &QPushButton::clicked, field, [field] { field->setText("Changed by native action"); });
    auto *secret = new QLineEdit("must-not-be-exposed", panel);
    secret->setObjectName("syntheticSecret"); secret->setEchoMode(QLineEdit::Password);
    auto *editPanel = new QWidget(panel); auto *editLayout = new QGridLayout(editPanel);
    const auto modelField = [&](const char *name, const QString &value, int row, int column) {
        auto *modelValue = new QLineEdit(value, editPanel); modelValue->setObjectName(name);
        modelValue->setReadOnly(true); editLayout->addWidget(modelValue, row, column); return modelValue;
    };
    auto *committed = modelField("syntheticCommittedModel", "Uncommitted model", 0, 0);
    auto *editedCount = modelField("syntheticEditedCount", "0", 0, 1);
    auto pendingEdited = std::make_shared<QString>();
    auto commitDelayMs = std::make_shared<unsigned long>(0);
    QObject::connect(field, &QLineEdit::textEdited, committed, [pendingEdited, editedCount](const QString &value) {
        *pendingEdited=value; editedCount->setText(QString::number(editedCount->text().toInt()+1));
    });
    QObject::connect(field, &QLineEdit::editingFinished, committed, [pendingEdited, committed, commitDelayMs] {
        QThread::msleep(*commitDelayMs); committed->setText(*pendingEdited);
    });
    auto *rate = new QComboBox(editPanel); rate->setObjectName("syntheticTaxCombo"); rate->setEditable(true);
    rate->lineEdit()->setObjectName("syntheticRateEdit"); rate->addItems({"", "7 %", "19 %"});
    auto *rateModel = modelField("syntheticRateModel", "Unactivated", 1, 1); editLayout->addWidget(rate, 1, 0);
    QObject::connect(rate, &QComboBox::activated, rateModel, [rate, rateModel](int) { rateModel->setText(rate->currentText()); });
    auto *checkModel = modelField("syntheticCheckModel", "true", 2, 0);
    QObject::connect(check, &QCheckBox::toggled, checkModel, [checkModel](bool value) { checkModel->setText(value?"true":"false"); });
    auto *date = new QDateEdit(QDate(2025, 1, 1), editPanel); date->setObjectName("syntheticDate");
    date->setDisplayFormat("dd.MM.yyyy"); date->setKeyboardTracking(false);
    date->findChild<QLineEdit *>()->setObjectName("syntheticDateEdit"); editLayout->addWidget(date, 2, 1);
    auto *dateModel = modelField("syntheticDateModel", "2025-01-01", 3, 0);
    QObject::connect(date, &QDateEdit::dateChanged, dateModel, [dateModel](const QDate &value) { dateModel->setText(value.toString("yyyy-MM-dd")); });
    QObject::connect(date, &QAbstractSpinBox::editingFinished, date, [date] {
        date->setProperty("syntheticCommitCount", date->property("syntheticCommitCount").toInt() + 1);
    });
    auto *note = new QTextEdit("Initial note", editPanel); note->setObjectName("syntheticNote"); note->setMaximumHeight(50);
    editLayout->addWidget(note, 4, 0, 1, 2);
    auto *noteModel = modelField("syntheticNoteModel", "Initial note", 3, 1);
    QObject::connect(note, &QTextEdit::textChanged, noteModel, [note, noteModel] { noteModel->setText(note->toPlainText()); });
    auto *table = new DialogUITable(panel); table->setObjectName("syntheticTable");
    auto *model = new QStandardItemModel(500, 7, table);
    for (int column = 0; column < 7; ++column) model->setHeaderData(column, Qt::Horizontal, QString("Column %1").arg(column));
    for (int row = 0; row < 500; ++row) for (int column = 0; column < 7; ++column)
        model->setData(model->index(row, column), QString("row-%1-cell-%2").arg(row).arg(column));
    model->item(0, 0)->setCheckable(true); model->item(0, 0)->setCheckState(Qt::Checked);
    model->item(0, 1)->setCheckable(true); model->item(0, 1)->setCheckState(Qt::Unchecked);
    model->item(0, 3)->setCheckable(true); model->item(0, 3)->setCheckState(Qt::PartiallyChecked);
    table->setModel(model); table->setColumnHidden(5, true); table->setRowHidden(2, true);
    auto *tableCheckModel = modelField("syntheticTableCheckModel", "false", 5, 0);
    auto *tableCheckCommits = modelField("syntheticTableCheckCommits", "0", 5, 1);
    QObject::connect(model, &QStandardItemModel::dataChanged, tableCheckModel,
        [model, tableCheckModel, tableCheckCommits](const QModelIndex &, const QModelIndex &, const QList<int> &roles) {
            if (!roles.contains(Qt::CheckStateRole)) return;
            tableCheckModel->setText(model->data(model->index(0, 1), Qt::CheckStateRole).toInt() == Qt::Checked ? "true" : "false");
            tableCheckCommits->setText(QString::number(tableCheckCommits->text().toInt() + 1));
        });
    QObject::connect(table, &QTableView::clicked, field, [field](const QModelIndex &) { field->setText("Changed by table action"); });
    layout->addWidget(field); layout->addWidget(nativeAction); layout->addWidget(secret); layout->addWidget(editPanel); layout->addWidget(table);
    window.setCentralWidget(panel); window.setWindowTitle(QString::fromUtf8("SteuerSparErklärung – synthetic fixture"));
    window.resize(1000, 400); window.show();
    const auto hwnd = static_cast<std::uint64_t>(window.winId());
    ShowWindow(reinterpret_cast<HWND>(hwnd), SW_SHOWNOACTIVATE);
    if (!IsWindowVisible(reinterpret_cast<HWND>(hwnd))) return 5;
    FILETIME created{}, ended{}, kernel{}, user{};
    if (!GetProcessTimes(GetCurrentProcess(), &created, &ended, &kernel, &user)) return 6;
    const auto birth = (std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
    HANDLE controller = nullptr;
    HWND untitled = nullptr;
    QDialog *tool = nullptr, *duplicateTool = nullptr, *navigationTool = nullptr, *optionTool = nullptr;
    const auto makeTool = [&](bool modal = false) {
        auto *dialog = new QDialog(&window, Qt::Tool);
        dialog->setModal(modal);
        dialog->setWindowTitle("BelegManager"); dialog->setAttribute(Qt::WA_ShowWithoutActivating);
        auto *value = new QLineEdit("Synthetic tool value", dialog);
        value->setObjectName("syntheticToolField"); value->setGeometry(10, 10, 250, 30);
        dialog->resize(300, 100); dialog->show(); return dialog;
    };
    std::ofstream(argv[1]) << nlohmann::json({{"pid", GetCurrentProcessId()}, {"hwnd", hwnd},
        {"creationTime", std::to_string(birth)}, {"desktop", ownDesktop}, {"inputDesktop", inputName}, {"visible", true}}).dump();
    std::thread([&] {
        std::string command;
        while (std::getline(std::cin, command)) {
            if (command == "quit") break;
            QMetaObject::invokeMethod(&app, [&, command] {
                if (command == "change-field") field->setText("Changed by fixture");
                else if (command == "validate-field") { field->setText("10"); field->setValidator(new QIntValidator(10, 99, field)); }
                else if (command == "mask-field") { field->setInputMask("99;_"); field->setText("10"); }
                else if (command == "slow-field-commit") *commitDelayMs = 1600;
                else if (command == "date-commit-count") { std::cout << date->property("syntheticCommitCount").toInt() << std::endl; return; }
                else if (command == "accessibility-status") rateModel->setText(QAccessible::isActive() ? "active" : "inactive");
                else if (command == "reset-accessibility-status") rateModel->setText("Unactivated");
                else if (command == "change-cell") model->setData(model->index(0, 4), "Changed cell");
                else if (command == "delete-field") { delete field; field = nullptr; }
                else if (command == "disable") window.setEnabled(false);
                else if (command == "enable") window.setEnabled(true);
                else if (command == "open-tool") tool = makeTool();
                else if (command == "open-modal-tool") tool = makeTool(true);
                else if (command == "duplicate-tool") duplicateTool = makeTool();
                else if (command == "close-tools") { delete duplicateTool; duplicateTool = nullptr; delete tool; tool = nullptr; }
                else if (command == "open-option-tool") {
                    optionTool = new QDialog(&window, Qt::Tool); optionTool->setModal(true);
                    optionTool->setObjectName("syntheticOptions"); optionTool->setWindowTitle("Synthetic options");
                    auto *optionLayout = new QVBoxLayout(optionTool);
                    auto *optionView = new QTableView(optionTool); optionView->setObjectName("optionTable");
                    auto *optionModel = new QStandardItemModel(40, 3, optionView);
                    for (int row = 0; row < 40; ++row) {
                        auto *item = new QStandardItem; item->setCheckable(true); item->setCheckState(row == 39 ? Qt::Checked : Qt::Unchecked);
                        optionModel->setItem(row, 0, item);
                        optionModel->setItem(row, 2, new QStandardItem(QString("option-%1").arg(row)));
                    }
                    optionView->setModel(optionModel); optionView->setColumnHidden(1, true);
                    // Selection and checkbox state are distinct application
                    // paths. A selection callback must not undo a role commit.
                    QObject::connect(optionView->selectionModel(), &QItemSelectionModel::selectionChanged, optionTool,
                        [optionModel](const QItemSelection &selected, const QItemSelection &) {
                            for (const auto &index : selected.indexes()) if (index.column() == 0)
                                optionModel->setData(index, Qt::Checked, Qt::CheckStateRole);
                        });
                    optionLayout->addWidget(optionView);
                    auto *optionSave = new QPushButton("Synthetic save", optionTool); optionSave->setObjectName("optionSave");
                    optionSave->setEnabled(false); optionLayout->addWidget(optionSave);
                    auto *optionCount = new QLabel("0", optionTool); optionCount->setObjectName("optionClickCount"); optionLayout->addWidget(optionCount);
                    QObject::connect(optionView, &QTableView::clicked, optionTool, [optionSave, optionCount](const QModelIndex &) {
                        optionSave->setEnabled(true); optionCount->setText(QString::number(optionCount->text().toInt() + 1));
                    });
                    optionTool->resize(400, 240); optionTool->show();
                }
                else if (command == "empty-option-tool") {
                    if (optionTool) { auto *model = optionTool->findChild<QTableView *>()->model(); model->removeRows(0, model->rowCount()); }
                }
                else if (command == "remove-option-on-click") {
                    auto *view = optionTool->findChild<QTableView *>();
                    QObject::connect(view, &QTableView::clicked, view, [view](const QModelIndex &index) { view->model()->removeRow(index.row()); });
                }
                else if (command == "mixed-option-tool") {
                    if (optionTool) optionTool->findChild<QTableView *>()->model()->setData(
                        optionTool->findChild<QTableView *>()->model()->index(0, 0), Qt::PartiallyChecked, Qt::CheckStateRole);
                }
                else if (command == "close-option-tool") { delete optionTool; optionTool = nullptr; }
                else if (command == "open-navigation-tool") {
                    navigationTool = new QDialog(&window, Qt::Tool);
                    navigationTool->setWindowTitle("Synthetic navigation");
                    navigationTool->setAttribute(Qt::WA_ShowWithoutActivating);
                    auto *navigationLayout = new QVBoxLayout(navigationTool);
                    auto *tree = new SyntheticNavigationTree(navigationTool); tree->setObjectName("NavWidgetSSE");
                    auto *treeModel = new QStandardItemModel(tree);
                    auto *parentItem = new QStandardItem("Parent heading");
                    auto *childItem = new QStandardItem("Nested target"); parentItem->appendRow(childItem);
                    treeModel->appendRow(parentItem); treeModel->appendRow(new QStandardItem("Other root heading"));
                    tree->setModel(treeModel); tree->expandAll(); tree->setHeaderHidden(true);
                    auto *selectedModel = new QLineEdit("No navigation", navigationTool);
                    selectedModel->setObjectName("navigationBusinessModel"); selectedModel->setReadOnly(true);
                    auto *clickCount = new QLineEdit("0", navigationTool);
                    clickCount->setObjectName("navigationClickCount"); clickCount->setReadOnly(true);
                    QObject::connect(tree, &SyntheticNavigationTree::gotoModelIndex, selectedModel,
                        [selectedModel, clickCount](const QModelIndex &index) {
                            selectedModel->setText(index.parent().isValid() ? index.parent().data().toString() + "/" + index.data().toString() : index.data().toString());
                            clickCount->setText(QString::number(clickCount->text().toInt() + 1));
                        });
                    navigationLayout->addWidget(tree); navigationLayout->addWidget(selectedModel); navigationLayout->addWidget(clickCount);
                    navigationTool->resize(400, 240); navigationTool->show();
                }
                else if (command == "replace-navigation-row") {
                    auto *tree = navigationTool ? navigationTool->findChild<SyntheticNavigationTree *>() : nullptr;
                    auto *navigationModel = tree ? qobject_cast<QStandardItemModel *>(tree->model()) : nullptr;
                    if (navigationModel) {
                        auto *parent = navigationModel->item(0);
                        parent->removeRow(0);
                        parent->appendRow(new QStandardItem("Replacement target"));
                        tree->expandAll();
                    }
                }
                else if (command == "close-navigation-tool") { delete navigationTool; navigationTool = nullptr; }
                else if (command == "untitled-window") {
                    untitled = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, L"STATIC", L"", WS_POPUP | WS_VISIBLE,
                        0, 0, 100, 80, reinterpret_cast<HWND>(hwnd), nullptr, GetModuleHandleW(nullptr), nullptr);
                    if (!untitled) std::terminate();
                }
                else if (command == "close-untitled") { DestroyWindow(untitled); untitled = nullptr; }
                else if (command == "lock-controller") {
                    controller = CreateMutexW(nullptr, FALSE, L"Local\\SteuerSparErklaerungApi.SseWorkerController");
                    if (!controller || WaitForSingleObject(controller, 0) != WAIT_OBJECT_0) std::terminate();
                }
                else if (command == "unlock-controller") {
                    if (!controller || !ReleaseMutex(controller)) std::terminate();
                    CloseHandle(controller); controller = nullptr;
                }
                else if (command == "abandon-controller") {
                    controller = CreateMutexW(nullptr, FALSE, L"Local\\SteuerSparErklaerungApi.SseWorkerController");
                    std::thread([&] { if (!controller || WaitForSingleObject(controller, 0) != WAIT_OBJECT_0) std::terminate(); }).join();
                }
                else if (command == "close-controller") { CloseHandle(controller); controller = nullptr; }
                else { std::cout << "unknown" << std::endl; return; }
                std::cout << command << std::endl;
            }, Qt::QueuedConnection);
        }
        QMetaObject::invokeMethod(&app, &QCoreApplication::quit, Qt::QueuedConnection);
    }).detach();
    const int result = app.exec();
    CloseDesktop(targetDesktop);
    return result;
}
#include "fixture.moc"
