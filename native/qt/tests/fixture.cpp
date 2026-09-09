#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <QtWidgets/QApplication>
#include <QtWidgets/QMainWindow>
#include <QtWidgets/QTableView>
#include <QtWidgets/QLineEdit>
#include <QtWidgets/QVBoxLayout>
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
    const auto ownDesktop = desktopName(GetThreadDesktop(GetCurrentThreadId()));
    const auto input = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    if (!input) return 3;
    const auto inputName = desktopName(input); CloseDesktop(input);
    if (ownDesktop != argv[2] || ownDesktop.rfind("SSEQtNativeTest_", 0) != 0 || ownDesktop == inputName) return 4;
    QApplication app(argc, argv);
    QMainWindow window;
    auto *panel = new QWidget(&window);
    auto *layout = new QVBoxLayout(panel);
    auto *field = new QLineEdit(QString::fromUtf8("Native field – пример"), panel);
    field->setObjectName("syntheticField");
    auto *secret = new QLineEdit("must-not-be-exposed", panel);
    secret->setObjectName("syntheticSecret"); secret->setEchoMode(QLineEdit::Password);
    auto *table = new DialogUITable(panel); table->setObjectName("syntheticTable");
    auto *model = new QStandardItemModel(500, 7, table);
    for (int column = 0; column < 7; ++column) model->setHeaderData(column, Qt::Horizontal, QString("Column %1").arg(column));
    for (int row = 0; row < 500; ++row) for (int column = 0; column < 7; ++column)
        model->setData(model->index(row, column), QString("row-%1-cell-%2").arg(row).arg(column));
    table->setModel(model); table->setColumnHidden(5, true); table->setRowHidden(2, true);
    layout->addWidget(field); layout->addWidget(secret); layout->addWidget(table);
    window.setCentralWidget(panel); window.setWindowTitle(QString::fromUtf8("SteuerSparErklärung – synthetic fixture"));
    window.resize(1000, 400); window.show();
    const auto hwnd = static_cast<std::uint64_t>(window.winId());
    ShowWindow(reinterpret_cast<HWND>(hwnd), SW_SHOWNOACTIVATE);
    if (!IsWindowVisible(reinterpret_cast<HWND>(hwnd))) return 5;
    FILETIME created{}, ended{}, kernel{}, user{};
    if (!GetProcessTimes(GetCurrentProcess(), &created, &ended, &kernel, &user)) return 6;
    const auto birth = (std::uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
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
                else { std::cout << "unknown" << std::endl; return; }
                std::cout << command << std::endl;
            }, Qt::QueuedConnection);
        }
        QMetaObject::invokeMethod(&app, &QCoreApplication::quit, Qt::QueuedConnection);
    }).detach();
    return app.exec();
}
#include "fixture.moc"
