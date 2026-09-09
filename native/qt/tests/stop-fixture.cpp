#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <QtWidgets/QApplication>
#include <QtWidgets/QMainWindow>
#include <QtWidgets/QToolBar>
#include <QtWidgets/QPushButton>
#include <QtWidgets/QDialog>
#include <QtWidgets/QVBoxLayout>
#include <QtWidgets/QLabel>
#include <QtCore/QTimer>
#include <QtGui/QCloseEvent>
#include <nlohmann/json.hpp>
#include <fstream>
#include <iostream>
#include <thread>
using Json = nlohmann::json;
class StopWindow : public QMainWindow {
public:
    std::string mode, statePath;
    int closes = 0, discardInvokes = 0, saveInvokes = 0;
    bool dialog = false;
    void persist() {
        std::ofstream(statePath) << Json({{"closeEvents", closes}, {"dialog", dialog}, {"discardInvokes", discardInvokes},
            {"saveInvokes", saveInvokes}, {"pid", GetCurrentProcessId()}}).dump();
    }
    void showDialog() {
        auto *window = new QDialog(this); window->setWindowTitle("Synthetic save confirmation");
        auto *layout = new QVBoxLayout(window);
        layout->addWidget(new QLabel(mode == "blocked" ? "Daten per ELSTER versenden" : "Synthetic unsaved changes", window));
        auto *save = new QPushButton("Ja", window);
        QObject::connect(save, &QPushButton::clicked, this, [this] { ++saveInvokes; persist(); });
        layout->addWidget(save);
        for (int index = 0; index < (mode == "duplicate" ? 2 : 1); ++index) {
            auto *discard = new QPushButton("Nein", window); discard->setObjectName(QString("discard%1").arg(index));
            QObject::connect(discard, &QPushButton::clicked, this, [this] { ++discardInvokes; persist(); QCoreApplication::exit(0); });
            layout->addWidget(discard);
        }
        if (mode == "oversize") layout->addWidget(new QLabel(QString(4097, 'x'), window));
        window->setWindowModality(Qt::ApplicationModal); window->resize(400, 180); window->show();
        ShowWindow(reinterpret_cast<HWND>(window->winId()), SW_SHOWNOACTIVATE); dialog = true; persist();
    }
protected:
    void closeEvent(QCloseEvent *event) override {
        ++closes;
        if (mode == "ignore") { event->ignore(); persist(); return; }
        if (mode == "dirty" || mode == "duplicate" || mode == "blocked" || mode == "unexpected" || mode == "oversize") {
            event->ignore(); showDialog(); return;
        }
        persist(); event->accept();
    }
};
int main(int argc, char **argv) {
    if (argc != 5) return 2;
    const std::string name = argv[1], readyPath = argv[2], mode = argv[3], statePath = argv[4];
    if (name.rfind("SSEStopTest_", 0) != 0 || name.size() > 64) return 3;
    const auto prior = OpenDesktopA(name.c_str(), 0, FALSE, DESKTOP_READOBJECTS);
    if (prior) { CloseDesktop(prior); return 5; }
    const auto desktop = CreateDesktopA(name.c_str(), nullptr, nullptr, 0, GENERIC_ALL, nullptr);
    if (!desktop || !SetThreadDesktop(desktop)) return 6;
    const auto input = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS); char inputName[256]{}; DWORD needed = 0;
    if (!input || !GetUserObjectInformationA(input, UOI_NAME, inputName, sizeof(inputName), &needed) || name == inputName) return 7;
    CloseDesktop(input);
    HANDLE controller = CreateMutexW(nullptr, FALSE, L"Local\\SteuerSparErklaerungApi.SseWorkerController");
    if (!controller) return 9;
    QApplication app(argc, argv); StopWindow window; window.mode = mode; window.statePath = statePath;
    // SSE has tiny unnamed owned system overlays; they must not enter title/path conversion.
    WNDCLASSW overlayClass{}; overlayClass.lpfnWndProc = DefWindowProcW;
    overlayClass.hInstance = GetModuleHandleW(nullptr); overlayClass.lpszClassName = L"UAC_SyntheticStop";
    if (!RegisterClassW(&overlayClass)) return 11;
    const auto overlay = CreateWindowExW(WS_EX_NOACTIVATE, overlayClass.lpszClassName, L"", WS_POPUP | WS_VISIBLE,
        0, 0, 20, 20, nullptr, nullptr, overlayClass.hInstance, nullptr);
    if (!overlay) return 12;
    window.setObjectName("SyntheticStopWindow");
    window.setWindowTitle(QString::fromUtf8(mode == "no-main" ? "Synthetic auxiliary" : "SteuerSparErklärung synthetic close fixture"));
    auto *toolbar = new QToolBar(&window); toolbar->setObjectName("MainToolBar");
    auto *save = new QPushButton("Save", toolbar); save->setObjectName("tb_sichern");
    save->setEnabled(mode == "dirty" || mode == "duplicate" || mode == "blocked" || mode == "oversize");
    toolbar->addWidget(save); window.addToolBar(toolbar); window.resize(1000, 700); window.show();
    ShowWindow(reinterpret_cast<HWND>(window.winId()), SW_SHOWNOACTIVATE);
    if (!IsWindowVisible(reinterpret_cast<HWND>(window.winId()))) return 10;
    window.persist();
    if (mode == "modal") window.showDialog();
    FILETIME birth{}, end{}, kernel{}, user{};
    if (!GetProcessTimes(GetCurrentProcess(), &birth, &end, &kernel, &user)) return 8;
    const auto creation = std::to_string((std::uint64_t(birth.dwHighDateTime) << 32) | birth.dwLowDateTime);
    std::ofstream(readyPath) << Json({{"pid", GetCurrentProcessId()}, {"hwnd", static_cast<std::uint64_t>(window.winId())},
        {"creationTime", creation}, {"desktop", name}, {"inputDesktop", inputName}}).dump();
    std::thread([&] {
        std::string line;
        while (std::getline(std::cin, line)) if (line == "quit") {
            QMetaObject::invokeMethod(&app, [] { QCoreApplication::exit(0); }, Qt::QueuedConnection); return;
        }
    }).detach();
    QTimer::singleShot(40000, &app, [] { QCoreApplication::exit(0); });
    const auto result = app.exec(); CloseHandle(controller); return result;
}
