#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <QtWidgets/QApplication>
#include <QtWidgets/QMainWindow>
#include <QtWidgets/QTableView>
#include <QtWidgets/QLineEdit>
#include <QtWidgets/QDialog>
#include <QtWidgets/QVBoxLayout>
#include <QtWidgets/QHBoxLayout>
#include <QtWidgets/QLabel>
#include <QtWidgets/QPushButton>
#include <QtWidgets/QCheckBox>
#include <QtGui/QStandardItemModel>
#include <QtCore/QTimer>
#include <fstream>
#include <iostream>
#include <thread>
#include <nlohmann/json.hpp>

class DialogUITable : public QTableView {
    Q_OBJECT
public:
    explicit DialogUITable(QWidget *parent) : QTableView(parent) {}
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
    auto *check = new QCheckBox(QString::fromUtf8("Synthetic Straße"), panel); check->setChecked(true); layout->addWidget(check);
    auto *field = new QLineEdit(QString::fromUtf8("Native field – пример"), panel);
    field->setObjectName("syntheticField");
    auto *nativeAction = new QPushButton("Synthetic action", panel);
    nativeAction->setObjectName("syntheticAction");
    QObject::connect(nativeAction, &QPushButton::clicked, field, [field] { field->setText("Changed by native action"); });
    auto *secret = new QLineEdit("must-not-be-exposed", panel);
    secret->setObjectName("syntheticSecret"); secret->setEchoMode(QLineEdit::Password);
    auto *table = new DialogUITable(panel); table->setObjectName("syntheticTable");
    auto *model = new QStandardItemModel(500, 7, table);
    for (int column = 0; column < 7; ++column) model->setHeaderData(column, Qt::Horizontal, QString("Column %1").arg(column));
    for (int row = 0; row < 500; ++row) for (int column = 0; column < 7; ++column)
        model->setData(model->index(row, column), QString("row-%1-cell-%2").arg(row).arg(column));
    model->item(0, 0)->setCheckable(true); model->item(0, 0)->setCheckState(Qt::Checked);
    model->item(0, 1)->setCheckable(true); model->item(0, 1)->setCheckState(Qt::Unchecked);
    model->item(0, 3)->setCheckable(true); model->item(0, 3)->setCheckState(Qt::PartiallyChecked);
    table->setModel(model); table->setColumnHidden(5, true); table->setRowHidden(2, true);
    QObject::connect(table, &QTableView::clicked, field, [field](const QModelIndex &) { field->setText("Changed by table action"); });
    layout->addWidget(field); layout->addWidget(nativeAction); layout->addWidget(secret); layout->addWidget(table);
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
    QDialog *tool = nullptr, *duplicateTool = nullptr;
    const auto makeTool = [&] {
        auto *dialog = new QDialog(&window, Qt::Tool);
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
                else if (command == "change-cell") model->setData(model->index(0, 4), "Changed cell");
                else if (command == "delete-field") { delete field; field = nullptr; }
                else if (command == "disable") window.setEnabled(false);
                else if (command == "enable") window.setEnabled(true);
                else if (command == "open-tool") tool = makeTool();
                else if (command == "duplicate-tool") duplicateTool = makeTool();
                else if (command == "close-tools") { delete duplicateTool; duplicateTool = nullptr; delete tool; tool = nullptr; }
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
