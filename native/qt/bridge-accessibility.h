#pragma once
#include <QtGui/QWindow>
#include <QtGui/private/qaccessiblebridgeutils_p.h>
#include <QtGui/private/qhighdpiscaling_p.h>
#include <QtGui/private/qguiapplication_p.h>
#include <QtGui/qpa/qplatformintegration.h>
#include <QtGui/qpa/qplatformaccessibility.h>
#include <unordered_set>
#include "bridge-accessible-types.h"

// A direct accessibility client must activate the platform before caching model
// interfaces. Qt otherwise omits the table-model events that invalidate them.
static void activateAccessibilityClient() {
    if (!qApp || qApp->thread() != QThread::currentThread())
        throw std::runtime_error("Accessibility activation requires the GUI thread");
    auto *integration = QGuiApplicationPrivate::platformIntegration();
    auto *accessibility = integration ? integration->accessibility() : nullptr;
    if (!accessibility) throw std::runtime_error("No platform accessibility service");
    if (!accessibility->isActive()) accessibility->setActive(true);
    if (!QAccessible::isActive()) throw std::runtime_error("Platform accessibility did not activate");
}

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
static Json accessibleNode(QAccessibleInterface *iface, int index, int parent, int depth, std::uint64_t host, bool values,
    bool cellStates = false) {
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
    // A checkable table cell answers the same toggle state the UIA toggle pattern exposes for it.
    if (values && state.checkable && (type == "CheckBox" || (cellStates && type == "DataItem"))) {
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
        if (active->isVisible() && active->windowTitle() == allowed
            && (!request.contains("allowedModalHwnd")
                || request.at("allowedModalHwnd").get<std::uint64_t>() == static_cast<std::uint64_t>(active->winId()))) return false;
    }
    return true;
}
// A viewport tree cannot prove a receipt list: hidden columns and offscreen
// rows still belong to the same model. Read them without changing the view.
static Json receiptTableProof(QWidget *root, const Json &request, QElapsedTimer &timer) {
    if (!request.contains("toolTitle") || !request.at("tableProof").is_object()
        || request.at("tableProof").size() != 1 || !request.at("tableProof").contains("aidSuffix")
        || !request.at("tableProof").at("aidSuffix").is_string())
        throw std::runtime_error("A receipt table proof requires an exact tool window and table suffix");
    const auto suffix = request.at("tableProof").at("aidSuffix").get<std::string>();
    if (suffix.empty() || suffix.size() > 4096) throw std::runtime_error("Invalid receipt table suffix");
    QPointer<QWidget> rootGuard(root);
    std::vector<QPointer<QTableView>> matches;
    std::vector<QObject *> pending{root}; int visited = 0;
    while (!pending.empty()) {
        if (++visited > 50000 || timer.elapsed() > 1500) throw std::runtime_error("Receipt table lookup exceeds snapshot bound");
        auto *object = pending.back(); pending.pop_back();
        if (auto *view = qobject_cast<QTableView *>(object)) {
            if (view->isVisible() && view->isEnabled() && view->thread() == QThread::currentThread()) {
                auto *iface = QAccessible::queryAccessibleInterface(view);
                if (!iface || !iface->isValid()) throw std::runtime_error("Invalid receipt table interface");
                const auto aid = accessibleText(QAccessibleBridgeUtils::accessibleId(iface));
                if (aid.size() >= suffix.size() && aid.compare(aid.size() - suffix.size(), suffix.size(), suffix) == 0)
                    matches.push_back(view);
            }
        }
        for (auto *child : object->children()) pending.push_back(child);
    }
    if (matches.empty()) return nullptr; // The receipt manager's home screen has no list.
    if (matches.size() != 1) throw std::runtime_error("Receipt table is not unique");
    QPointer<QTableView> view = matches.front();
    auto *iface = QAccessible::queryAccessibleInterface(view);
    auto *table = iface ? iface->tableInterface() : nullptr;
    QPointer<QAbstractItemModel> model(view->model());
    if (!table || !model || !belongsTo(view, root) || model->thread() != QThread::currentThread())
        throw std::runtime_error("Receipt table has no owned GUI-thread model");
    TableModelReadScope scope(view);
    const auto modelRoot = view->rootIndex();
    const int rows = scope.read([&](QAbstractItemModel *) { return table->rowCount(); });
    const int columns = scope.read([&](QAbstractItemModel *) { return table->columnCount(); });
    if (rows < 0 || columns < 0 || rows != scope.read([&](QAbstractItemModel *m) { return m->rowCount(modelRoot); })
        || columns != scope.read([&](QAbstractItemModel *m) { return m->columnCount(modelRoot); }))
        throw std::runtime_error("Receipt table and model dimensions differ");
    std::uint64_t host = 0;
    for (auto *parent = iface; parent && !host; parent = parent->parent()) host = accessibleHost(parent);
    if (!host) throw std::runtime_error("Receipt table has no existing native host");
    const bool fetch = scope.read([&](QAbstractItemModel *m) { return m->canFetchMore(modelRoot); });
    Json proof = {{"tableAid", accessibleText(QAccessibleBridgeUtils::accessibleId(iface))},
        {"tableRid", accessibleRuntimeId(iface, host)}, {"rowCount", rows}, {"columnCount", columns},
        {"complete", false}, {"canFetchMore", fetch}, {"incompleteReason", nullptr},
        {"headers", Json::array()}, {"hiddenColumns", Json::array()}, {"hiddenRows", Json::array()}, {"rows", Json::array()}};
    const auto timeBound = [&] {
        proof["complete"] = false; proof["incompleteReason"] = "read-time-bound";
        proof["rows"] = Json::array();
        return proof;
    };
    if (fetch || rows > 1000 || columns < 1 || columns > 64 || static_cast<long long>(rows) * columns > 20000) {
        proof["incompleteReason"] = fetch ? "model-can-fetch-more" : "model-dimensions-exceed-bound";
        return proof;
    }
    const auto unchanged = [&] {
        scope.check();
        return rootGuard && view && model && view->model() == model && view->rootIndex() == modelRoot
            && view->isVisible() && view->isEnabled() && belongsTo(view, rootGuard)
            && scope.read([&](QAbstractItemModel *) { return table->rowCount(); }) == rows
            && scope.read([&](QAbstractItemModel *) { return table->columnCount(); }) == columns
            && scope.read([&](QAbstractItemModel *m) { return m->rowCount(modelRoot); }) == rows
            && scope.read([&](QAbstractItemModel *m) { return m->columnCount(modelRoot); }) == columns
            && !scope.read([&](QAbstractItemModel *m) { return m->canFetchMore(modelRoot); });
    };
    for (int column = 0; column < columns; ++column) {
        if (timer.elapsed() > 1500) return timeBound();
        proof["headers"].push_back(accessibleText(scope.read([&](QAbstractItemModel *m) {
            return m->headerData(column, Qt::Horizontal, Qt::DisplayRole).toString(); }), true));
        if (!unchanged()) throw std::runtime_error("Receipt model changed while reading headers");
        if (view->isColumnHidden(column)) proof["hiddenColumns"].push_back(column);
    }
    std::unordered_set<std::string> identities;
    std::size_t bytes = 0;
    for (int row = 0; row < rows; ++row) {
        if (!unchanged()) throw std::runtime_error("Receipt model changed before reading a row");
        if (view->isRowHidden(row)) proof["hiddenRows"].push_back(row);
        Json names = Json::array(), rids = Json::array();
        for (int column = 0; column < columns; ++column) {
            if (timer.elapsed() > 1500) return timeBound();
            auto *cell = scope.read([&](QAbstractItemModel *) { return table->cellAt(row, column); });
            auto *position = cell && cell->isValid() ? cell->tableCellInterface() : nullptr;
            if (!position || scope.read([&](QAbstractItemModel *) { return position->rowIndex(); }) != row
                || scope.read([&](QAbstractItemModel *) { return position->columnIndex(); }) != column
                || scope.read([&](QAbstractItemModel *) { return position->rowExtent(); }) != 1
                || scope.read([&](QAbstractItemModel *) { return position->columnExtent(); }) != 1
                || scope.read([&](QAbstractItemModel *) { return position->table(); }) != iface)
                throw std::runtime_error("Receipt cell has no exact grid position");
            names.push_back(accessibleText(scope.read([&](QAbstractItemModel *) { return cell->text(QAccessible::Name); }), true));
            const auto rid = accessibleRuntimeId(cell, host);
            if (!identities.insert(rid).second) throw std::runtime_error("Repeated receipt cell identity");
            rids.push_back(rid);
        }
        Json item = {{"row", row}, {"names", std::move(names)}, {"rids", std::move(rids)}};
        bytes += item.dump().size();
        if (bytes > 8 * 1024 * 1024) throw std::runtime_error("Receipt model output exceeds bound");
        proof["rows"].push_back(std::move(item));
    }
    if (!unchanged()) throw std::runtime_error("Receipt model changed before completing the proof");
    if (timer.elapsed() > 1500) return timeBound();
    proof["complete"] = true;
    return proof;
}
static Json accessibilitySnapshot(QWidget *main, const Json &request) {
    activateAccessibilityClient();
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
    const bool cellStates = request.value("withCellStates", false);
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
                        sparse ? 0 : work.depth, work.host, values, cellStates);
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
        const int childIndex = work.next++;
        auto *child = iface->child(childIndex);
        if (!child || !child->isValid()) {
            const auto parentAid = accessibleText(QAccessibleBridgeUtils::accessibleId(iface));
            const auto parentType = accessibleControlType(iface);
            auto incomplete = error("NATIVE_ACCESSIBILITY_INCOMPLETE", std::string("Accessible ") + parentType + " '" + parentAid
                + "' reports an invalid child " + std::to_string(childIndex) + "/" + std::to_string(count));
            incomplete["readIncomplete"] = true;
            incomplete["parentAid"] = parentAid;
            incomplete["parentType"] = parentType;
            incomplete["childIndex"] = childIndex;
            incomplete["childCount"] = count;
            return incomplete;
        }
        stack.push_back({child, work.index, work.depth + 1, work.host});
    }
    const auto count = nodes.size();
    // The root itself is never a node; its identity lets a caller list the window the way UIA names it.
    Json result = {{"ok", true}, {"nodes", std::move(nodes)}, {"hwnd", rootHost}, {"windowEnabled", root->isEnabled()},
        {"root", {{"aid", accessibleText(QAccessibleBridgeUtils::accessibleId(rootInterface))},
            {"name", accessibleText(rootInterface->text(QAccessible::Name))}}},
        {"foreground", GetForegroundWindow() == reinterpret_cast<HWND>(rootHost)},
        {"exactMatches", std::move(exactMatches)},
        {"windowRect", {{"x", windowRect.left}, {"y", windowRect.top},
            {"w", windowRect.right - windowRect.left}, {"h", windowRect.bottom - windowRect.top}}},
        {"modalBlocked", accessibilityModalBlocked(root, request)},
        {"activeModalHwnd", QApplication::activeModalWidget()
            ? static_cast<std::uint64_t>(QApplication::activeModalWidget()->winId()) : 0},
        {"scope", "qt-accessibility-content"},
        {"stats", {{"n", count}, {"err", 0}, {"cyc", 0}, {"cycleRid", ""}, {"cycleName", ""},
            {"truncated", truncated || depthLimited}, {"depthLimited", depthLimited}, {"valErr", 0}, {"scrollErr", 0},
            {"source", "qt"}, {"fallbackReason", ""}, {"snapshotMs", timer.nsecsElapsed() / 1e6}}}};
    if (request.contains("tableProof")) {
        result["tableProof"] = truncated || depthLimited ? Json(nullptr) : receiptTableProof(root, request, timer);
        if (result.dump().size() > 8 * 1024 * 1024) throw std::runtime_error("Snapshot and receipt proof exceed output bound");
        result["stats"]["snapshotMs"] = timer.nsecsElapsed() / 1e6;
    }
    return result;
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

#include "bridge-accessible-options.h"
// Private, exact-target mechanism for catalogued compound API transactions.
// It is reachable only over the authenticated native broker and is not itself a public selector API.
#include "bridge-edit-actions.h"
#include "bridge-table-edit-actions.h"
#include "bridge-navigation-actions.h"
static Json accessibilityAction(QWidget *main, const Json &request) {
    markNativeEdit(NativeEditPhase::ActionEnter);
    activateAccessibilityClient();
    const auto operation = request.value("action", std::string());
    const auto wantedRid = request.value("rid", std::string());
    const auto wantedAid = request.value("aid", std::string());
    const auto expectedName = request.value("expectedName", std::string());
    const bool editOperation = operation == "replace-edit-text" || operation == "select-combo-value"
        || operation == "toggle-check-box" || operation == "set-table-check-state";
    if ((operation != "press" && operation != "activate-table-cell" && operation != "activate-navigation-item" && operation != "replace-edit-text"
            && operation != "select-combo-value" && operation != "toggle-check-box" && operation != "set-table-check-state")
        || wantedRid.empty() || wantedRid.size() > 256 || wantedAid.empty()
        || wantedAid.size() > 65536 || expectedName.size() > 65536)
        return noMutationError("INVALID_ACTION_TARGET", "The native action requires an exact bounded target");
    if (((editOperation || operation == "activate-navigation-item") && !request.contains("expectedRootHwnd"))
        || (request.contains("expectedRootHwnd") && !request.at("expectedRootHwnd").is_number_integer()))
        return noMutationError("INVALID_ACTION_TARGET", "Persistent Qt edits require the exact observed root window");
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
    const auto rootHost = accessibleHost(rootInterface);
    if (request.contains("expectedRootHwnd") && (!rootHost || request.at("expectedRootHwnd").get<std::uint64_t>() != rootHost))
        return noMutationError("stale-window", "The exact native action root window changed before dispatch");
    struct Work { QAccessibleInterface *iface; int depth; std::uint64_t host; };
    std::vector<Work> stack{{rootInterface, -1, rootHost}};
    std::unordered_set<QAccessible::Id> seen;
    QAccessibleInterface *target = nullptr;
    int matches = 0, visited = 0;
    markNativeEdit(NativeEditPhase::LookupBefore);
    QElapsedTimer timer; timer.start();
    while (!stack.empty()) {
        if (timer.elapsed() > 500) return noMutationError("ACTION_LOOKUP_TIMEOUT", "The exact native action lookup exceeded its bound");
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
        for (int index = count - 1; index >= 0; --index) {
            // Creating every accessible table-cell child can itself dominate
            // the GUI lease. Bound that work before any mutation can begin.
            if (timer.elapsed() > 500)
                return noMutationError("ACTION_LOOKUP_TIMEOUT", "The exact native action lookup exceeded its bound");
            stack.push_back({iface->child(index), work.depth + 1, host});
        }
    }
    markNativeEdit(NativeEditPhase::LookupAfter);
    if (matches != 1 || !target || !target->isValid())
        return noMutationError(matches ? "ambiguous" : "not-found", "The exact native action target is not unique and live");
    const auto actualName = accessibleText(target->text(QAccessible::Name), true);
    const auto state = target->state();
    if ((!expectedName.empty() && actualName != expectedName) || state.disabled || state.invisible)
        return noMutationError("stale", "The exact native action target changed before dispatch");
    if (editOperation) {
        auto result = operation == "replace-edit-text" ? replaceAccessibleEdit(root, target, request)
            : operation == "select-combo-value" ? selectAccessibleCombo(root, target, request)
            : operation == "toggle-check-box" ? toggleAccessibleCheckBox(root, target, request)
            : setAccessibleTableCheckState(root, target, request);
        result["action"] = operation; result["rid"] = wantedRid; result["aid"] = wantedAid;
        // Legacy lookupMs includes the action and synchronous commit. The
        // private nativeEditTrace separates those phases without changing it.
        result["name"] = actualName; result["lookupMs"] = timer.nsecsElapsed() / 1e6;
        return result;
    } else if (operation == "activate-navigation-item") {
        auto result = activateAccessibleNavigationItem(root, target);
        result["action"] = operation; result["rid"] = wantedRid; result["aid"] = wantedAid;
        result["name"] = actualName; result["lookupMs"] = timer.nsecsElapsed() / 1e6;
        return result;
    } else if (operation == "press") {
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
