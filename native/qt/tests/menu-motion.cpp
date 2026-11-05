#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <QtWidgets/QApplication>
#include <QtWidgets/QMenu>
#include <QtWidgets/private/qmenu_p.h>
#include <QtGui/QEnterEvent>
#include <QtGui/QMouseEvent>
#include <QtGui/private/qguiapplication_p.h>
#include <qpa/qwindowsysteminterface.h>
#include <QtCore/QCoreApplication>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

static void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}

// This fixture exercises the Windows-to-Qt event pipeline with injected stale
// cache state. It never moves the physical cursor or switches the input desktop.
class MenuMotion : public QMenu {
public:
    explicit MenuMotion(QWidget *parent) : QMenu(parent) {}
    int enters = 0, moves = 0, movesSinceEnter = 0, presses = 0, releases = 0, triggers = 0;
    int nativeMoves = 0, nativePresses = 0, nativeReleases = 0;
    void resetCounts() {
        enters = moves = movesSinceEnter = presses = releases = triggers = 0;
        nativeMoves = nativePresses = nativeReleases = 0;
    }
protected:
    void enterEvent(QEnterEvent *event) override {
        ++enters; movesSinceEnter = 0; QMenu::enterEvent(event);
    }
    void mouseMoveEvent(QMouseEvent *event) override {
        ++moves; ++movesSinceEnter; QMenu::mouseMoveEvent(event);
    }
    void mousePressEvent(QMouseEvent *event) override {
        ++presses; QMenu::mousePressEvent(event);
    }
    void mouseReleaseEvent(QMouseEvent *event) override {
        ++releases; QMenu::mouseReleaseEvent(event);
    }
    bool nativeEvent(const QByteArray &type, void *message, qintptr *result) override {
        const auto *msg = static_cast<MSG *>(message);
        if (msg->message == WM_MOUSEMOVE) ++nativeMoves;
        if (msg->message == WM_LBUTTONDOWN) ++nativePresses;
        if (msg->message == WM_LBUTTONUP) ++nativeReleases;
        return QMenu::nativeEvent(type, message, result);
    }
};

static void drain() {
    QCoreApplication::sendPostedEvents();
    QCoreApplication::processEvents();
}

static void deliver(MenuMotion &menu, UINT message, const QPoint &logical, WPARAM buttons = 0) {
    const auto hwnd = reinterpret_cast<HWND>(menu.winId());
    require(IsWindow(hwnd), "The owned menu HWND must remain alive");
    const auto ratio = menu.devicePixelRatioF();
    const auto x = static_cast<int>(std::lround(logical.x() * ratio));
    const auto y = static_cast<int>(std::lround(logical.y() * ratio));
    require(x >= 0 && x <= 32767 && y >= 0 && y <= 32767, "Native client point must be representable");
    DWORD_PTR result = 0;
    require(SendMessageTimeoutW(hwnd, message, buttons, MAKELPARAM(x, y), SMTO_ABORTIFHUNG, 100, &result) != 0,
        "Native menu message must be acknowledged");
    // Flush the Qt queue, preserving native message order. Pumping the OS
    // queue here would fabricate WM_MOUSELEAVE from the unrelated physical
    // cursor on the input desktop between these injected client positions.
    QWindowSystemInterface::sendWindowSystemEvents(QEventLoop::AllEvents);
}

static void runCases(QApplication &app) {
    require(QGuiApplication::platformName() == QStringLiteral("windows"), "A real Windows Qt platform is required");
    // A logically visible animated popup need not yet be the native hit-test target.
    // This synchronous fixture tests message delivery after the popup is shown.
    QApplication::setEffectEnabled(Qt::UI_AnimateMenu, false);
    QApplication::setEffectEnabled(Qt::UI_FadeMenu, false);
    require(!QApplication::isEffectEnabled(Qt::UI_AnimateMenu) && !QApplication::isEffectEnabled(Qt::UI_FadeMenu),
        "Menu effects must be disabled for deterministic native hit testing");
    QWidget owner; owner.resize(640, 480); owner.move(80, 80); owner.show();
    MenuMotion menu(&owner); menu.setMinimumWidth(240);
    auto *action = menu.addAction(QStringLiteral("Synthetic menu command"));
    QObject::connect(action, &QAction::triggered, &menu, [&] { ++menu.triggers; });
    const QPoint anchor(180, 180);
    menu.popup(anchor); drain();
    const auto item = menu.actionGeometry(action);
    const auto geometry = menu.geometry();
    require(item.width() >= 100 && item.height() >= 8, "The leaf action needs a stable interior");
    const auto centre = item.center();
    const auto globalCentre = menu.mapToGlobal(centre);
    menu.hide(); drain();

    const auto open = [&] {
        QGuiApplicationPrivate::lastCursorPosition = QPointF(globalCentre);
        require(QGuiApplicationPrivate::lastCursorPosition == QPointF(globalCentre), "Injected stale cursor cache must be established");
        menu.popup(anchor); drain();
        require(menu.isVisible() && menu.geometry() == geometry && menu.actionGeometry(action) == item,
            "Every menu opening must retain the exact action geometry");
        require(QMenuPrivate::get(&menu)->mousePopupPos == QPointF(globalCentre),
            "The menu must capture the injected prior click position");
        require(QGuiApplicationPrivate::lastCursorPosition == QPointF(globalCentre),
            "No setup movement may replace the injected stale cursor cache");
        menu.resetCounts();
    };

    for (int cycle = 0; cycle < 3; ++cycle) {
        open();
        deliver(menu, WM_MOUSEMOVE, centre);
        require(menu.movesSinceEnter <= 6 && QMenuPrivate::get(&menu)->motions <= 6,
            "Baseline must retain the low-motion stale-cache precondition");
        deliver(menu, WM_LBUTTONDOWN, centre, MK_LBUTTON);
        deliver(menu, WM_LBUTTONUP, centre);
        require(!menu.isVisible() && menu.triggers == 0 && menu.presses == 1,
            "A single stale-position click must reproduce the lost action");
        std::cout << "baseline cycle=" << cycle << " enters=" << menu.enters << " moves=" << menu.moves
                  << " presses=" << menu.presses << " releases=" << menu.releases << " triggers=" << menu.triggers << '\n';

        open();
        constexpr std::array<int, 10> offsets{-5, 4, -4, 3, -3, 2, -2, 1, -1, 0};
        for (const auto offset : offsets) {
            const auto point = centre + QPoint(offset * 2, 0);
            require(item.adjusted(1, 1, -1, -1).contains(point), "Hover must remain inside the exact leaf action");
            deliver(menu, WM_MOUSEMOVE, point);
        }
        std::cout << "hover cycle=" << cycle << " enters=" << menu.enters << " moves=" << menu.moves
                  << " sinceEnter=" << menu.movesSinceEnter << " nativeMoves=" << menu.nativeMoves << '\n';
        require(menu.movesSinceEnter >= 8 && menu.nativeMoves >= 10 && QMenuPrivate::get(&menu)->motions > 6,
            "Ten native moves must deliver at least eight moves after the final enter");
        require(menu.isVisible() && menu.activeAction() == action && menu.triggers == 0,
            "Hover must only select the same leaf action without triggering it");
        deliver(menu, WM_LBUTTONDOWN, centre, MK_LBUTTON);
        deliver(menu, WM_LBUTTONUP, centre);
        require(!menu.isVisible() && menu.presses == 1 && menu.releases == 1 && menu.triggers == 1 &&
                menu.nativePresses == 1 && menu.nativeReleases == 1,
            "The prepared menu must trigger exactly once from one native down/up pair");
        std::cout << "prepared cycle=" << cycle << " enters=" << menu.enters << " moves=" << menu.moves
                  << " presses=" << menu.presses << " releases=" << menu.releases << " triggers=" << menu.triggers << '\n';
    }
    owner.hide(); drain();
    Q_UNUSED(app);
}

int main(int argc, char **argv) {
    const auto name = std::wstring(L"SSEMenuMotionTest_") + std::to_wstring(GetCurrentProcessId());
    const auto desktop = CreateDesktopW(name.c_str(), nullptr, nullptr, 0, GENERIC_ALL, nullptr);
    if (!desktop) return 2;
    int result = 0;
    // The owned GUI thread exits before CloseDesktop, releasing even platform
    // helper windows that Qt keeps until thread teardown.
    std::thread gui([&] {
        if (!SetThreadDesktop(desktop)) { result = 2; return; }
        const auto input = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
        wchar_t inputName[256]{}; DWORD needed = 0;
        const bool isolated = input && GetUserObjectInformationW(input, UOI_NAME, inputName, sizeof(inputName), &needed) && name != inputName;
        if (input) CloseDesktop(input);
        if (!isolated) { result = 3; return; }
        try {
            QApplication app(argc, argv);
            app.setQuitOnLastWindowClosed(false);
            runCases(app);
            std::cout << "Native menu motion: stale-cache baseline and bounded hover passed on an inactive desktop.\n";
        } catch (const std::exception &error) {
            std::cerr << error.what() << '\n'; result = 1;
        }
    });
    gui.join();
    if (!CloseDesktop(desktop)) result = 4;
    return result;
}
