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
static std::string accessibleRuntimeId(QAccessibleInterface *iface, std::uint64_t host) {
    std::string rid = "42." + std::to_string(static_cast<std::int32_t>(host));
    if (!accessibleHost(iface)) rid += ".4." + std::to_string(static_cast<std::int32_t>(QAccessible::uniqueId(iface)));
    return rid;
}
static Json accessibleNode(QAccessibleInterface *iface, int index, int parent, int depth, std::uint64_t host, bool values) {
    const auto state = iface->state();
    const std::string type = accessibleControlType(iface);
    const auto rect = QHighDpi::toNativePixels(QRectF(iface->rect()), accessibleWindow(iface));
    const bool empty = rect.isEmpty();
    const auto rid = accessibleRuntimeId(iface, host);
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
static bool accessibilityModalBlocked(QWidget *root, const Json &request) {
    auto *active = QApplication::activeModalWidget();
    if (!active || active == root) return false;
    if (request.contains("allowedModalTitle") && request.at("allowedModalTitle").is_string()) {
        const auto allowed = QString::fromUtf8(request.at("allowedModalTitle").get<std::string>().c_str());
        if (active->isVisible() && active->windowTitle() == allowed) return false;
    }
    return true;
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
        if (root->thread() != QThread::currentThread())
            return error("blocked", "The tool window belongs to another GUI thread");
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
    const Json suffixFilter = request.value("aidSuffixes", Json::array());
    if (!suffixFilter.is_array() || suffixFilter.size() > 64)
        throw std::runtime_error("Invalid accessibility ID suffix filter");
    std::vector<std::string> aidSuffixes;
    std::size_t suffixBytes = 0;
    for (const auto &item : suffixFilter) {
        if (!item.is_string()) throw std::runtime_error("Invalid accessibility ID suffix");
        auto suffix = item.get<std::string>();
        suffixBytes += suffix.size();
        if (suffix.empty() || suffix.size() > 4096 || suffixBytes > 65536)
            throw std::runtime_error("Accessibility ID suffix filter exceeds bound");
        aidSuffixes.push_back(std::move(suffix));
    }
    const Json containsFilter = request.value("aidContains", Json::array());
    if (!containsFilter.is_array() || containsFilter.size() > 32)
        throw std::runtime_error("Invalid accessibility ID contains filter");
    std::vector<std::string> aidContains;
    std::size_t containsBytes = 0;
    for (const auto &item : containsFilter) {
        if (!item.is_string()) throw std::runtime_error("Invalid accessibility ID fragment");
        auto fragment = item.get<std::string>();
        containsBytes += fragment.size();
        if (fragment.empty() || fragment.size() > 4096 || containsBytes > 32768)
            throw std::runtime_error("Accessibility ID contains filter exceeds bound");
        aidContains.push_back(std::move(fragment));
    }
    const bool sparse = !aidSuffixes.empty() || !aidContains.empty();
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
        if (timer.elapsed() > 1500) {
            if (sparse) { truncated = true; break; }
            throw std::runtime_error("Snapshot time bound reached");
        }
        auto &work = stack.back(); auto *iface = work.iface;
        if (work.next == -1) {
            if (++visited > 50000) {
                if (sparse) { truncated = true; break; }
                throw std::runtime_error("Snapshot visit bound reached");
            }
            if (!iface || !iface->isValid()) throw std::runtime_error("Invalid accessible interface");
            if (iface->state().invisible) { stack.pop_back(); continue; }
            if (!seen.insert(QAccessible::uniqueId(iface)).second) throw std::runtime_error("Repeated accessible interface");
            if (const auto nativeHost = accessibleHost(iface)) work.host = nativeHost;
            work.next = 0;
            if (work.depth >= 0) {
                bool include = !sparse;
                if (!include) {
                    const auto aid = accessibleText(QAccessibleBridgeUtils::accessibleId(iface));
                    for (const auto &suffix : aidSuffixes) {
                        if (aid.size() >= suffix.size()
                            && aid.compare(aid.size() - suffix.size(), suffix.size(), suffix) == 0) {
                            include = true;
                            break;
                        }
                    }
                    if (!include) for (const auto &fragment : aidContains) {
                        if (aid.find(fragment) != std::string::npos) {
                            include = true;
                            break;
                        }
                    }
                }
                if (include) {
                    if (nodes.size() >= static_cast<std::size_t>(limit)) { truncated = true; break; }
                    const auto index = static_cast<int>(nodes.size());
                    work.index = sparse ? work.parent : index;
                    auto node = accessibleNode(iface, index, sparse ? -1 : work.parent,
                        sparse ? 0 : work.depth, work.host, values);
                    for (const auto &[key, wanted] : selectors) {
                        const auto utf8 = node.at(key).get<std::string>();
                        const auto actual = QString::fromUtf8(utf8.data(), static_cast<qsizetype>(utf8.size())).toStdWString();
                        // Windows PowerShell -eq uses .NET Framework's invariant NLS comparison (including ligatures).
                        const auto comparison = CompareStringEx(LOCALE_NAME_INVARIANT, NORM_IGNORECASE,
                            actual.c_str(), static_cast<int>(actual.size()), wanted.c_str(), static_cast<int>(wanted.size()), nullptr, nullptr, 0);
                        if (!comparison) throw std::runtime_error("Invariant selector comparison failed");
                        if (comparison == CSTR_EQUAL) exactMatches[key].push_back(index);
                    }
                    bytes += node.dump().size();
                    if (bytes > 8 * 1024 * 1024) throw std::runtime_error("Accessible output exceeds bound");
                    nodes.push_back(std::move(node));
                }
            }
        }
        const auto count = iface->childCount();
        if (count < 0) throw std::runtime_error("Negative accessible child count");
        if (work.next >= count) { stack.pop_back(); continue; }
        if (work.depth >= (sparse ? 64 : 16)) { depthLimited = true; stack.pop_back(); continue; }
        auto *child = iface->child(work.next++);
        stack.push_back({child, work.index, work.depth + 1, work.host});
    }
    const auto count = nodes.size();
    return {{"ok", true}, {"nodes", std::move(nodes)}, {"hwnd", rootHost}, {"windowEnabled", root->isEnabled()},
        {"foreground", GetForegroundWindow() == reinterpret_cast<HWND>(rootHost)},
        {"exactMatches", std::move(exactMatches)},
        {"windowRect", {{"x", windowRect.left}, {"y", windowRect.top},
            {"w", windowRect.right - windowRect.left}, {"h", windowRect.bottom - windowRect.top}}},
        {"modalBlocked", accessibilityModalBlocked(root, request)}, {"scope", "qt-accessibility-content"},
        {"stats", {{"n", count}, {"err", 0}, {"cyc", 0}, {"cycleRid", ""}, {"cycleName", ""},
            {"truncated", truncated || depthLimited}, {"depthLimited", depthLimited}, {"valErr", 0}, {"scrollErr", 0},
            {"source", "qt"}, {"fallbackReason", ""}, {"snapshotMs", timer.nsecsElapsed() / 1e6}}}};
}

static bool accessibilityActionObstructed(QWidget *main, const Json &request) {
    if (!request.contains("toolTitle") || !request.at("toolTitle").is_string())
        return !main->isEnabled() || QApplication::activeModalWidget();
    const auto title = QString::fromUtf8(request.at("toolTitle").get<std::string>().c_str());
    std::vector<QWidget *> matches;
    for (auto *widget : QApplication::topLevelWidgets())
        if (widget != main && widget->isVisible() && widget->windowTitle() == title) matches.push_back(widget);
    return matches.size() == 1 && (!matches.front()->isEnabled() || accessibilityModalBlocked(matches.front(), request));
}

// Private, exact-target mechanism for catalogued compound API transactions.
// It is reachable only over the authenticated native broker and is not itself a public selector API.
static Json accessibilityAction(QWidget *main, const Json &request) {
    const auto operation = request.value("action", std::string());
    const auto wantedRid = request.value("rid", std::string());
    const auto wantedAid = request.value("aid", std::string());
    const auto expectedName = request.value("expectedName", std::string());
    if ((operation != "press" && operation != "activate-table-cell")
        || wantedRid.empty() || wantedRid.size() > 256 || wantedAid.empty()
        || wantedAid.size() > 65536 || expectedName.size() > 65536)
        return noMutationError("INVALID_ACTION_TARGET", "The native action requires an exact bounded target");
    auto *root = main;
    if (request.contains("toolTitle")) {
        if (!request.at("toolTitle").is_string())
            return noMutationError("INVALID_ACTION_TARGET", "The catalogued tool title is invalid");
        const auto title = QString::fromUtf8(request.at("toolTitle").get<std::string>().c_str());
        std::vector<QWidget *> matches;
        for (auto *widget : QApplication::topLevelWidgets())
            if (widget != main && widget->isVisible() && widget->windowTitle() == title) matches.push_back(widget);
        if (matches.empty()) return noMutationError("not-found", "The catalogued tool window is not open");
        if (matches.size() != 1) return noMutationError("ambiguous", "The catalogued tool window is not unique");
        root = matches.front();
    }
    if (root->thread() != QThread::currentThread() || !root->isEnabled() || accessibilityModalBlocked(root, request))
        return noMutationError("window-obstructed", "The exact native action root is unavailable or obstructed");
    auto *rootInterface = QAccessible::queryAccessibleInterface(root);
    if (!rootInterface || !rootInterface->isValid())
        return noMutationError("INVALID_ACTION_TARGET", "The native action root has no valid accessible interface");
    struct Work { QAccessibleInterface *iface; int depth; std::uint64_t host; };
    std::vector<Work> stack{{rootInterface, -1, accessibleHost(rootInterface)}};
    std::unordered_set<QAccessible::Id> seen;
    QAccessibleInterface *target = nullptr;
    int matches = 0, visited = 0;
    QElapsedTimer timer; timer.start();
    while (!stack.empty()) {
        if (timer.elapsed() > 750) return noMutationError("ACTION_LOOKUP_TIMEOUT", "The exact native action lookup exceeded its bound");
        const auto work = stack.back(); stack.pop_back();
        auto *iface = work.iface;
        if (++visited > 50000) return noMutationError("ACTION_LOOKUP_BOUND", "The exact native action lookup exceeded its node bound");
        if (!iface || !iface->isValid()) return noMutationError("INVALID_ACTION_TARGET", "The native action tree changed during lookup");
        if (iface->state().invisible) continue;
        if (!seen.insert(QAccessible::uniqueId(iface)).second)
            return noMutationError("INVALID_ACTION_TARGET", "The native action tree contains a repeated interface");
        auto host = work.host;
        if (const auto nativeHost = accessibleHost(iface)) host = nativeHost;
        if (work.depth >= 0 && accessibleText(QAccessibleBridgeUtils::accessibleId(iface)) == wantedAid
            && accessibleRuntimeId(iface, host) == wantedRid) {
            ++matches; target = iface;
        }
        if (work.depth >= 64) continue;
        const auto count = iface->childCount();
        if (count < 0) return noMutationError("INVALID_ACTION_TARGET", "The native action target has an invalid child count");
        for (int index = count - 1; index >= 0; --index) stack.push_back({iface->child(index), work.depth + 1, host});
    }
    if (matches != 1 || !target || !target->isValid())
        return noMutationError(matches ? "ambiguous" : "not-found", "The exact native action target is not unique and live");
    const auto actualName = accessibleText(target->text(QAccessible::Name), true);
    const auto state = target->state();
    if ((!expectedName.empty() && actualName != expectedName) || state.disabled || state.invisible)
        return noMutationError("stale", "The exact native action target changed before dispatch");
    if (operation == "press") {
        auto *actions = target->actionInterface();
        const auto press = QAccessibleActionInterface::pressAction();
        if (!actions || !actions->actionNames().contains(press))
            return noMutationError("ACTION_UNSUPPORTED", "The exact native target has no accessible press action");
        mutationStarted = true;
        actions->doAction(press);
    } else {
        auto *cell = target->tableCellInterface();
        auto *table = cell ? cell->table() : nullptr;
        auto *view = table ? qobject_cast<QAbstractItemView *>(table->object()) : nullptr;
        if (!cell || !view || !view->model() || !view->selectionModel()
            || view->thread() != QThread::currentThread() || !belongsTo(view, root))
            return noMutationError("ACTION_UNSUPPORTED", "The exact target is not a live Qt item-view cell");
        const auto index = view->model()->index(cell->rowIndex(), cell->columnIndex(), view->rootIndex());
        if (!index.isValid() || view->metaObject()->indexOfSignal("clicked(QModelIndex)") < 0)
            return noMutationError("ACTION_UNSUPPORTED", "The exact Qt item-view cell cannot be activated");
        QItemSelectionModel::SelectionFlags flags = QItemSelectionModel::ClearAndSelect;
        if (view->selectionBehavior() == QAbstractItemView::SelectRows) flags |= QItemSelectionModel::Rows;
        else if (view->selectionBehavior() == QAbstractItemView::SelectColumns) flags |= QItemSelectionModel::Columns;
        mutationStarted = true;
        view->selectionModel()->setCurrentIndex(index, flags);
        const bool invoked = QMetaObject::invokeMethod(view, "clicked", Qt::DirectConnection, Q_ARG(QModelIndex, index));
        if (!invoked) {
            auto failure = error("ACTION_DISPATCH_FAILED", "The exact Qt table-cell click signal could not be dispatched");
            failure["mutationAttempted"] = true;
            return failure;
        }
    }
    return {{"ok", true}, {"action", operation}, {"rid", wantedRid}, {"aid", wantedAid},
        {"name", actualName}, {"lookupMs", timer.nsecsElapsed() / 1e6}};
}
