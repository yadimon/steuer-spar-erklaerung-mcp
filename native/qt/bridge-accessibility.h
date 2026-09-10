#pragma once
#include <QtGui/QWindow>
#include <QtGui/private/qaccessiblebridgeutils_p.h>
#include <QtGui/private/qhighdpiscaling_p.h>
#include <unordered_set>
#include "bridge-accessible-types.h"

static std::string accessibleText(QString value, bool normalize = false) {
    if (value.size() > 16384) throw std::runtime_error("Accessible text exceeds bound");
    if (normalize) value = value.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ').trimmed();
    return value.toUtf8().toStdString();
}
static QWindow *accessibleWindow(QAccessibleInterface *iface) {
    for (int depth = 0; iface && depth < 128; ++depth, iface = iface->parent())
        if (auto *window = iface->window()) return window;
    throw std::runtime_error("No accessible window");
}
// Only an existing Qt native host introduces a UIA fragment root. Never create a window while reading.
static std::uint64_t accessibleHost(QAccessibleInterface *iface) {
    auto *window = iface->window();
    auto *parent = iface->parent();
    if (!window || (parent && parent->window() == window)) return 0;
    if (!window->handle()) throw std::runtime_error("Accessible native host has no platform window");
    const auto hwnd = reinterpret_cast<HWND>(window->winId());
    DWORD pid = 0;
    if (!IsWindow(hwnd) || !GetWindowThreadProcessId(hwnd, &pid) || pid != GetCurrentProcessId())
        throw std::runtime_error("Accessible native host identity changed");
    return reinterpret_cast<std::uint64_t>(hwnd);
}
static Json accessibleNode(QAccessibleInterface *iface, int index, int parent, int depth, std::uint64_t host, bool values) {
    const auto state = iface->state();
    const std::string type = accessibleControlType(iface);
    const auto rect = QHighDpi::toNativePixels(QRectF(iface->rect()), accessibleWindow(iface));
    const bool empty = rect.isEmpty();
    std::string rid = "42." + std::to_string(static_cast<std::int32_t>(host));
    if (!accessibleHost(iface)) rid += ".4." + std::to_string(static_cast<std::int32_t>(QAccessible::uniqueId(iface)));
    Json node = {{"i", index}, {"p", parent}, {"d", depth}, {"type", type},
        {"name", accessibleText(iface->text(QAccessible::Name), true)},
        {"aid", accessibleText(QAccessibleBridgeUtils::accessibleId(iface))}, {"rid", rid},
        {"x", empty ? -1 : static_cast<int>(rect.x())}, {"y", empty ? -1 : static_cast<int>(rect.y())},
        {"w", empty ? 0 : static_cast<int>(rect.width())}, {"h", empty ? 0 : static_cast<int>(rect.height())},
        {"on", !state.disabled}, {"val", nullptr}, {"ro", nullptr}, {"checked", nullptr}, {"selected", nullptr}, {"scroll", nullptr}};
    if (values && !state.passwordEdit && (type == "Edit" || type == "ComboBox" || type == "Spinner")) {
        node["val"] = accessibleText(iface->text(QAccessible::Value)); node["ro"] = bool(state.readOnly);
    }
    if (values && type == "CheckBox" && state.checkable) {
        if (state.checkStateMixed) node["checked"] = "unbestimmt";
        else node["checked"] = bool(state.checked);
    }
    const auto accessibleParent = iface->parent();
    if (values && type == "RadioButton") node["selected"] = bool(state.checked);
    else if (values && type == "TreeItem" && accessibleParent && accessibleParent->selectionInterface()) node["selected"] = bool(state.selected);
    return node;
}
static Json accessibilitySnapshot(QWidget *main, const Json &request) {
    auto *root = main;
    if (request.contains("toolTitle")) {
        const auto title = QString::fromUtf8(request.at("toolTitle").get<std::string>().c_str());
        std::vector<QWidget *> matches;
        for (auto *widget : QApplication::topLevelWidgets())
            if (widget != main && widget->isVisible() && widget->windowTitle() == title) matches.push_back(widget);
        if (matches.empty()) return error("not-found", "The catalogued tool window is not open");
        if (matches.size() != 1) return error("ambiguous", "The catalogued tool window is not unique");
        root = matches.front();
        if (root->thread() != QThread::currentThread() || root->isModal())
            return error("blocked", "The tool window is modal or belongs to another GUI thread");
    }
    const int limit = request.value("maxNodes", 4000);
    const bool values = request.value("withValues", true);
    const Json equality = request.value("equalitySelectors", Json::object());
    if (!equality.is_object() || equality.size() > 3) throw std::runtime_error("Invalid equality selectors");
    Json exactMatches = Json::object();
    std::vector<std::pair<std::string, std::wstring>> selectors;
    for (auto selector = equality.begin(); selector != equality.end(); ++selector) {
        if ((selector.key() != "name" && selector.key() != "aid" && selector.key() != "type") || !selector.value().is_string())
            throw std::runtime_error("Invalid equality selector");
        const auto utf8 = selector.value().get<std::string>();
        if (utf8.size() > 65536) throw std::runtime_error("Equality selector exceeds bound");
        selectors.emplace_back(selector.key(), QString::fromUtf8(utf8.data(), static_cast<qsizetype>(utf8.size())).toStdWString());
        exactMatches[selector.key()] = Json::array();
    }
    if (limit < 1 || limit > 5000) throw std::runtime_error("maxNodes must be 1..5000");
    QElapsedTimer timer; timer.start();
    Json nodes = Json::array();
    struct Work { QAccessibleInterface *iface; int parent; int depth; std::uint64_t host; int next = -1; int index = -1; };
    auto *rootInterface = QAccessible::queryAccessibleInterface(root);
    if (!rootInterface || !rootInterface->isValid()) throw std::runtime_error("Invalid root accessible interface");
    const auto rootHost = accessibleHost(rootInterface);
    if (!rootHost) throw std::runtime_error("Snapshot root has no existing native host");
    RECT windowRect{};
    if (!GetWindowRect(reinterpret_cast<HWND>(rootHost), &windowRect)) throw std::runtime_error("Cannot read root window bounds");
    std::vector<Work> stack{{rootInterface, -1, -1, rootHost}};
    std::unordered_set<QAccessible::Id> seen;
    int visited = 0; std::size_t bytes = 0; bool truncated = false, depthLimited = false;
    while (!stack.empty()) {
        if (timer.elapsed() > 1500) throw std::runtime_error("Snapshot time bound reached");
        auto &work = stack.back(); auto *iface = work.iface;
        if (work.next == -1) {
            if (++visited > 50000) throw std::runtime_error("Snapshot visit bound reached");
            if (!iface || !iface->isValid()) throw std::runtime_error("Invalid accessible interface");
            if (iface->state().invisible) { stack.pop_back(); continue; }
            if (!seen.insert(QAccessible::uniqueId(iface)).second) throw std::runtime_error("Repeated accessible interface");
            if (const auto nativeHost = accessibleHost(iface)) work.host = nativeHost;
            work.next = 0;
            if (work.depth >= 0) {
                if (nodes.size() >= static_cast<std::size_t>(limit)) { truncated = true; break; }
                work.index = static_cast<int>(nodes.size());
                auto node = accessibleNode(iface, work.index, work.parent, work.depth, work.host, values);
                for (const auto &[key, wanted] : selectors) {
                    const auto utf8 = node.at(key).get<std::string>();
                    const auto actual = QString::fromUtf8(utf8.data(), static_cast<qsizetype>(utf8.size())).toStdWString();
                    // Windows PowerShell -eq uses .NET Framework's invariant NLS comparison (including ligatures).
                    const auto comparison = CompareStringEx(LOCALE_NAME_INVARIANT, NORM_IGNORECASE,
                        actual.c_str(), static_cast<int>(actual.size()), wanted.c_str(), static_cast<int>(wanted.size()), nullptr, nullptr, 0);
                    if (!comparison) throw std::runtime_error("Invariant selector comparison failed");
                    if (comparison == CSTR_EQUAL) exactMatches[key].push_back(work.index);
                }
                bytes += node.dump().size();
                if (bytes > 8 * 1024 * 1024) throw std::runtime_error("Accessible output exceeds bound");
                nodes.push_back(std::move(node));
            }
        }
        const auto count = iface->childCount();
        if (count < 0) throw std::runtime_error("Negative accessible child count");
        if (work.next >= count) { stack.pop_back(); continue; }
        if (work.depth >= 16) { depthLimited = true; stack.pop_back(); continue; }
        auto *child = iface->child(work.next++);
        stack.push_back({child, work.index, work.depth + 1, work.host});
    }
    const auto count = nodes.size();
    return {{"ok", true}, {"nodes", std::move(nodes)}, {"hwnd", rootHost}, {"windowEnabled", root->isEnabled()},
        {"foreground", GetForegroundWindow() == reinterpret_cast<HWND>(rootHost)},
        {"exactMatches", std::move(exactMatches)},
        {"windowRect", {{"x", windowRect.left}, {"y", windowRect.top},
            {"w", windowRect.right - windowRect.left}, {"h", windowRect.bottom - windowRect.top}}},
        {"modalBlocked", QApplication::activeModalWidget() != nullptr}, {"scope", "qt-accessibility-content"},
        {"stats", {{"n", count}, {"err", 0}, {"cyc", 0}, {"cycleRid", ""}, {"cycleName", ""},
            {"truncated", truncated || depthLimited}, {"depthLimited", depthLimited}, {"valErr", 0}, {"scrollErr", 0},
            {"source", "qt"}, {"fallbackReason", ""}, {"snapshotMs", timer.nsecsElapsed() / 1e6}}}};
}
