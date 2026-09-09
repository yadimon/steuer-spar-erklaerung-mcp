#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <sddl.h>
#include <shellapi.h>
#include <QtWidgets/QApplication>
#include <QtWidgets/QWidget>
#include <QtWidgets/QAbstractItemView>
#include <QtWidgets/QTreeView>
#include <QtWidgets/QTableView>
#include <QtWidgets/QListView>
#include <QtWidgets/QLineEdit>
#include <QtWidgets/QLabel>
#include <QtWidgets/QAbstractButton>
#include <QtWidgets/QComboBox>
#include <QtWidgets/QAbstractSpinBox>
#include <QtWidgets/QPlainTextEdit>
#include <QtGui/QAction>
#include <QtCore/QPointer>
#include <QtCore/QAbstractItemModel>
#include <QtCore/QElapsedTimer>
#include <QtCore/QThread>
#include <QtCore/QVariant>
#include <QtCore/QMetaMethod>
#include <QtCore/QCryptographicHash>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <memory>
#include <stdexcept>
#include <unordered_map>
#include <vector>
#include "bridge-protocol.h"
#include "bridge-identity.h"
#include <nlohmann/json.hpp>

extern "C" __declspec(dllexport) const char BridgeBuildIdentity[] = SSE_BRIDGE_BUILD_PREFIX SSE_BRIDGE_SOURCE_DIGEST;
static_assert(sizeof(BridgeBuildIdentity) == BRIDGE_BUILD_ID_SIZE);

using Json = nlohmann::json;
using Clock = std::chrono::steady_clock;
static std::atomic<bool> started{false};
static std::mutex startMutex;
static std::atomic<int> activeGuiRequests{0};
static std::atomic<std::uint64_t> generation{0};
static std::uint64_t guiGeneration = 0;
static std::atomic<bool> recoveryRequired{false};
static std::atomic<std::uint64_t> nextMutationReceipt{1};
static BridgeConfig config;
static std::unordered_map<std::uint64_t, QPointer<QObject>> objects;
static std::unordered_map<QObject*, std::uint64_t> ids;
static std::uint64_t nextId = 1;
static QPointer<QWidget> boundRoot;
static bool rootResolved = false;
static constexpr DWORD MAX_FRAME = 16 * 1024 * 1024;
#include "bridge-window-context.h"
struct NativeSession {
    HANDLE pipe = INVALID_HANDLE_VALUE;
    HANDLE owner = nullptr;
    BridgeConfig binding;
    std::atomic<bool> released{false};
    std::atomic<bool> uncertainMutation{false};
    std::atomic<std::uint64_t> pendingReceipt{0};
    ~NativeSession() {
        if (pipe != INVALID_HANDLE_VALUE) CloseHandle(pipe);
        if (owner) CloseHandle(owner);
    }
};
static bool ownerAlive(const std::shared_ptr<NativeSession> &session) {
    return !session->released && WaitForSingleObject(session->owner, 0) == WAIT_TIMEOUT;
}
static bool isMutation(const std::string &op) {
    return op == "table_set_cell" || op == "field_set_value" || op == "select_navigation" || op == "save_disposable";
}
static thread_local const NativeSession *guiSession = nullptr;
static thread_local bool mutationStarted = false;
static std::string utf8(const QString &s) { return s.toUtf8().toStdString(); }
static double elapsed(Clock::time_point t) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t).count();
}
static Json error(const char* code, const std::string &message) {
    return {{"ok", false}, {"code", code}, {"error", message}};
}
static Json noMutationError(const char* code, const std::string &message) {
    auto result = error(code, message); result["mutationAttempted"] = false; return result;
}
static std::uint64_t objectId(QObject *object) {
    auto found = ids.find(object);
    if (found != ids.end()) {
        auto live = objects.find(found->second);
        if (live != objects.end() && live->second.data() == object) return found->second;
        ids.erase(found);
    }
    auto id = nextId++;
    ids[object] = id;
    objects[id] = object;
    return id;
}
static QWidget* rootWidget() {
    const auto currentGeneration = generation.load();
    if (guiGeneration != currentGeneration) {
        // A retired session's numeric QObject references must never become live again.
        objects.clear(); ids.clear(); boundRoot.clear(); rootResolved = false;
        guiGeneration = currentGeneration;
    }
    DWORD owner = 0;
    const auto hwnd = reinterpret_cast<HWND>(config.window);
    if (!IsWindow(hwnd) || !GetWindowThreadProcessId(hwnd, &owner) || owner != GetCurrentProcessId())
        throw std::runtime_error("Bound window no longer belongs to this process");
    auto *root = QWidget::find(static_cast<WId>(config.window));
    if (!root || root->thread() != QThread::currentThread())
        throw std::runtime_error("Bound HWND has no Qt widget on the GUI thread");
    if (rootResolved && boundRoot != root)
        throw std::runtime_error("The once-bound Qt root was destroyed or replaced; attach a new verified session");
    if (!rootResolved) { boundRoot = root; rootResolved = true; }
    return root;
}
static bool belongsTo(QObject *object, QObject *root) {
    for (auto *p = object; p; p = p->parent()) if (p == root) return true;
    return false;
}
static QObject* resolve(const Json &request, QWidget *root) {
    const auto id = request.at("objectId").get<std::uint64_t>();
    auto found = objects.find(id);
    if (found == objects.end() || found->second.isNull() || !belongsTo(found->second, root))
        throw std::runtime_error("Object reference is stale or outside the bound window");
    return found->second.data();
}
static Json variant(const QVariant &v) {
    if (!v.isValid() || v.isNull()) return nullptr;
    switch (v.metaType().id()) {
    case QMetaType::Bool: return v.toBool();
    case QMetaType::Int: case QMetaType::LongLong: case QMetaType::Short: return v.toLongLong();
    case QMetaType::UInt: case QMetaType::ULongLong: case QMetaType::UShort: return v.toULongLong();
    case QMetaType::Double: case QMetaType::Float: return v.toDouble();
    default: return utf8(v.toString());
    }
}
static Json cellValue(QAbstractItemModel *model, const QModelIndex &index) {
    return {{"display", variant(model->data(index, Qt::DisplayRole))},
        {"edit", variant(model->data(index, Qt::EditRole))},
        {"checkState", variant(model->data(index, Qt::CheckStateRole))},
        {"flags", static_cast<int>(model->flags(index))}};
}
static std::string cellsFingerprint(const Json &values) {
    return QCryptographicHash::hash(QByteArray::fromStdString(values.dump()), QCryptographicHash::Sha256).toHex().toStdString();
}
static Json describe(QObject *object, std::uint64_t parent) {
    Json item = {{"id", objectId(object)}, {"parentId", parent},
        {"class", object->metaObject()->className()}, {"name", utf8(object->objectName())}};
    if (auto *widget = qobject_cast<QWidget*>(object)) {
        item["visible"] = widget->isVisible();
        item["enabled"] = widget->isEnabled();
        auto r = widget->geometry();
        item["rect"] = {r.x(), r.y(), r.width(), r.height()};
        if (boundRoot) {
            const auto point = widget->mapTo(boundRoot, QPoint(0, 0));
            item["rootRect"] = {point.x(), point.y(), widget->width(), widget->height()};
        }
    }
    if (auto *edit = qobject_cast<QLineEdit*>(object)) {
        // Do not expose password controls in a generic page dump.
        item["kind"] = "lineEdit";
        item["readOnly"] = edit->isReadOnly();
        item["sensitive"] = edit->echoMode() != QLineEdit::Normal;
        if (edit->echoMode() == QLineEdit::Normal) item["value"] = utf8(edit->text());
    } else if (auto *label = qobject_cast<QLabel*>(object)) {
        item["kind"] = "label"; item["value"] = utf8(label->text());
    } else if (auto *button = qobject_cast<QAbstractButton*>(object)) {
        item["kind"] = "button"; item["value"] = utf8(button->text());
        item["checkable"] = button->isCheckable(); item["checked"] = button->isChecked();
    } else if (auto *combo = qobject_cast<QComboBox*>(object)) {
        item["kind"] = "comboBox"; item["value"] = utf8(combo->currentText());
        item["index"] = combo->currentIndex(); item["count"] = combo->count();
    } else if (auto *spin = qobject_cast<QAbstractSpinBox*>(object)) {
        item["kind"] = "spinBox"; item["value"] = utf8(spin->text());
        item["readOnly"] = spin->isReadOnly();
    } else if (auto *plainEdit = qobject_cast<QPlainTextEdit*>(object)) {
        item["kind"] = "plainTextEdit"; item["value"] = utf8(plainEdit->toPlainText());
        item["readOnly"] = plainEdit->isReadOnly();
    } else if (auto *action = qobject_cast<QAction*>(object)) {
        item["kind"] = "action"; item["value"] = utf8(action->text());
        item["enabled"] = action->isEnabled(); item["visible"] = action->isVisible();
        item["checkable"] = action->isCheckable(); item["checked"] = action->isChecked();
        item["shortcut"] = utf8(action->shortcut().toString());
    }
    if (auto *view = qobject_cast<QAbstractItemView*>(object)) {
        item["kind"] = "itemView";
        item["viewType"] = qobject_cast<QTreeView*>(view) ? "tree" : qobject_cast<QTableView*>(view) ? "table" : qobject_cast<QListView*>(view) ? "list" : "other";
        if (view->model()) {
            item["rows"] = view->model()->rowCount(view->rootIndex());
            item["columns"] = view->model()->columnCount(view->rootIndex());
            item["modelClass"] = view->model()->metaObject()->className();
        }
    }
    return item;
}
static Json execute(const Json &request);
#include "bridge-table-snapshot.h"

static Json execute(const Json &request) {
    const auto before = Clock::now();
    auto *root = rootWidget();
    const auto op = request.at("op").get<std::string>();
    if (isMutation(op) && recoveryRequired) {
        return {{"ok", false}, {"code", "RECOVERY_REQUIRED"}, {"mutationAttempted", false},
            {"error", "A previous session lost confirmation of a mutation; inspect the current state before further writes"}};
    }
    if (isMutation(op)
        && (!root->isEnabled() || QApplication::activeModalWidget())) {
        auto blocked = error("window-obstructed", "The bound window is disabled or blocked by a modal dialog");
        blocked["mutationAttempted"] = false;
        return blocked;
    }
    Json result;
    if (op == "ping") {
        result = {{"ok", true}, {"pid", GetCurrentProcessId()}, {"hwnd", config.window},
            {"qtVersion", qVersion()}, {"guiThread", true}, {"rootClass", root->metaObject()->className()},
            {"bridgeProtocol", 1}, {"creationTime", std::to_string(config.creationTime)},
            {"sessionGeneration", generation.load()}, {"ownerPid", config.ownerProcessId},
            {"ownerCreationTime", std::to_string(config.ownerCreationTime)}, {"recoveryRequired", recoveryRequired.load()},
            {"mutationAcknowledgmentRequired", guiSession && guiSession->pendingReceipt != 0}};
    } else if (op == "window_context") {
        result = windowContext();
    } else if (op == "objects") {
        for (auto it = ids.begin(); it != ids.end();) {
            const auto object = objects.find(it->second);
            if (object == objects.end() || object->second.isNull() || !belongsTo(object->second, root)) {
                if (object != objects.end()) objects.erase(object);
                it = ids.erase(it);
            } else ++it;
        }
        const int limit = request.value("maxObjects", 20000);
        if (limit < 1 || limit > 50000) throw std::runtime_error("maxObjects must be 1..50000");
        const auto projection = request.value("projection", std::string("full"));
        if (projection != "full" && projection != "values" && projection != "table-context") throw std::runtime_error("Unknown object projection");
        const bool visibleOnly = request.value("visibleOnly", true);
        int visited = 0;
        Json items = Json::array();
        std::vector<std::pair<QObject*, std::uint64_t>> pending{{root, 0}};
        while (!pending.empty()) {
            if (++visited > limit) throw std::runtime_error("Object count exceeds explicit bound");
            const auto [object, parent] = pending.back(); pending.pop_back();
            const auto id = objectId(object);
            auto *widget = qobject_cast<QWidget*>(object);
            const bool valueControl = widget && (qobject_cast<QLineEdit*>(object) || qobject_cast<QLabel*>(object)
                || qobject_cast<QAbstractButton*>(object) || qobject_cast<QComboBox*>(object)
                || qobject_cast<QAbstractSpinBox*>(object) || qobject_cast<QPlainTextEdit*>(object));
            const bool included = valueControl || (projection == "table-context" && qobject_cast<QTableView*>(object));
            if (projection == "full" || (included && (!visibleOnly || widget->isVisible()))) items.push_back(describe(object, parent));
            const auto children = object->children();
            for (auto it = children.crbegin(); it != children.crend(); ++it) pending.emplace_back(*it, id);
        }
        result = {{"ok", true}, {"objects", std::move(items)}, {"complete", true},
            {"projection", projection}, {"visibleOnly", visibleOnly}, {"visitedObjects", visited},
            {"windowEnabled", root->isEnabled()}, {"modalBlocked", QApplication::activeModalWidget() != nullptr}};
    } else if (op == "inspect") {
        auto *object = resolve(request, root);
        result = {{"ok", true}, {"object", describe(object, object->parent() ? objectId(object->parent()) : 0)}, {"methods", Json::array()}};
        const auto *meta = object->metaObject();
        result["classes"] = Json::array();
        for (auto *type = meta; type; type = type->superClass()) result["classes"].push_back(type->className());
        for (int i = 0; i < meta->methodCount(); ++i) {
            const auto method = meta->method(i);
            result["methods"].push_back({{"index", i}, {"signature", method.methodSignature().toStdString()},
                {"type", static_cast<int>(method.methodType())}, {"access", static_cast<int>(method.access())}});
        }
    } else if (op == "tree_read") {
        auto *view = qobject_cast<QTreeView*>(resolve(request, root));
        if (!view || !view->model()) throw std::runtime_error("Object has no QTreeView model");
        auto *model = view->model();
        const int maxItems = request.value("maxItems", 5000);
        if (maxItems < 1 || maxItems > 20000) throw std::runtime_error("maxItems must be 1..20000");
        Json nodes = Json::array(); bool complete = true;
        std::function<void(const QModelIndex&, const std::vector<int>&)> visit;
        visit = [&](const QModelIndex &parent, const std::vector<int> &parentPath) {
            if (parentPath.size() > 32) throw std::runtime_error("Tree depth exceeds 32");
            if (model->canFetchMore(parent)) complete = false;
            const int count = model->rowCount(parent);
            for (int row = 0; row < count; ++row) {
                if (nodes.size() >= static_cast<std::size_t>(maxItems)) throw std::runtime_error("Tree node count exceeds explicit bound");
                auto path = parentPath; path.push_back(row);
                const auto index = model->index(row, 0, parent);
                if (!index.isValid()) throw std::runtime_error("Tree model returned an invalid index");
                nodes.push_back({{"path", path}, {"text", variant(model->data(index, Qt::DisplayRole))},
                    {"flags", static_cast<int>(model->flags(index))}, {"selected", view->currentIndex() == index},
                    {"expanded", view->isExpanded(index)}, {"children", model->rowCount(index)}});
                visit(index, path);
            }
        };
        visit(view->rootIndex(), {});
        result = {{"ok", true}, {"nodes", std::move(nodes)}, {"complete", complete}};
    } else if (op == "table_snapshot") {
        result = tableSnapshot(request, root);
    } else if (op == "table_read") {
        auto *view = qobject_cast<QTableView*>(resolve(request, root));
        if (!view || !view->model()) throw std::runtime_error("Object has no QAbstractItemModel");
        auto *model = view->model();
        const auto rootIndex = view->rootIndex();
        const int rows = model->rowCount(rootIndex), columns = model->columnCount(rootIndex);
        const int maxRows = request.value("maxRows", 10000), maxColumns = request.value("maxColumns", 100);
        const bool allowPartial = request.value("allowPartial", false);
        const int readRows = allowPartial ? std::min(rows, maxRows) : rows;
        if (rows < 0 || columns < 0 || maxRows < 1 || maxRows > 10000 || maxColumns < 1 || maxColumns > 100
            || readRows > maxRows || columns > maxColumns || std::int64_t(readRows) * columns > 100000)
            throw std::runtime_error("Model dimensions exceed explicit read bounds");
        Json headers = Json::array(), values = Json::array(), fingerprints = Json::array();
        Json hiddenColumns = Json::array(), hiddenRows = Json::array();
        for (int c = 0; c < columns; ++c) if (view->isColumnHidden(c)) hiddenColumns.push_back(c);
        for (int r = 0; r < readRows; ++r) if (view->isRowHidden(r)) hiddenRows.push_back(r);
        for (int c = 0; c < columns; ++c) headers.push_back(variant(model->headerData(c, Qt::Horizontal, Qt::DisplayRole)));
        for (int r = 0; r < readRows; ++r) {
            Json cells = Json::array();
            for (int c = 0; c < columns; ++c) {
                const auto index = model->index(r, c, rootIndex);
                if (!index.isValid()) throw std::runtime_error("Model returned an invalid cell index");
                cells.push_back(cellValue(model, index));
            }
            fingerprints.push_back(cellsFingerprint(cells));
            values.push_back(std::move(cells));
        }
        if (model->rowCount(rootIndex) != rows || model->columnCount(rootIndex) != columns)
            throw std::runtime_error("Model dimensions changed during the read");
        result = {{"ok", true}, {"rows", rows}, {"columns", columns}, {"headers", std::move(headers)},
            {"hiddenColumns", std::move(hiddenColumns)}, {"hiddenRows", std::move(hiddenRows)},
            {"values", std::move(values)}, {"rowFingerprints", std::move(fingerprints)},
            {"readRows", readRows}, {"canFetchMore", model->canFetchMore(rootIndex)},
            {"complete", readRows == rows && !model->canFetchMore(rootIndex)}};
    } else {
        return error("UNSUPPORTED_OPERATION", "Operation is not supported by this native read bridge");
    }
    result["modelMs"] = elapsed(before);
    return result;
}

static Json executeWithController(const Json &request) {
    // The same session-wide controller lease as the existing PowerShell worker.
    // It is acquired on the GUI thread that executes and releases the operation.
    static HANDLE controller = CreateMutexW(nullptr, FALSE, L"Local\\SteuerSparErklaerungApi.SseWorkerController");
    static bool executing = false;
    if (!controller) return noMutationError("worker-isolation-lost", "Session controller mutex is unavailable");
    if (executing) return noMutationError("busy", "A previous native operation is still executing");
    const auto wait = WaitForSingleObject(controller, 0);
    if (wait == WAIT_TIMEOUT) {
        auto result = error("busy", "Another API controller owns this Windows session");
        result["mutationAttempted"] = false;
        return result;
    }
    if (wait == WAIT_ABANDONED) {
        // Even a read can consume this one-shot indication of another
        // controller's uncertain mutation. Preserve it for later writers.
        recoveryRequired = true;
        ReleaseMutex(controller);
        auto result = error("worker-isolation-lost", "The previous controller ended without releasing its lease");
        result["mutationAttempted"] = false;
        result["outcomeUnknown"] = true;
        return result;
    }
    if (wait != WAIT_OBJECT_0) return noMutationError("worker-isolation-lost", "Session controller lease could not be acquired");
    executing = true;
    mutationStarted = false;
    Json result;
    try { result = execute(request); }
    catch (const std::exception &e) {
        result = error("NATIVE_OPERATION_FAILED", e.what());
        result["outcomeUnknown"] = mutationStarted;
    }
    result["mutationAttempted"] = mutationStarted;
    executing = false;
    if (!ReleaseMutex(controller)) {
        auto failure = error("worker-isolation-lost", "Session controller lease could not be released");
        failure["outcomeUnknown"] = true;
        failure["mutationAttempted"] = mutationStarted;
        recoveryRequired = true;
        return failure;
    }
    result["controllerBound"] = true;
    return result;
}

struct Pending {
    // The request is cancelled before dispatch if the GUI thread misses its deadline.
    enum State { Queued, Running, Done, Cancelled };
    std::atomic<State> state{Queued};
    std::mutex mutex;
    std::condition_variable changed;
    Json result;
};
static Json dispatch(const Json &request, const std::shared_ptr<NativeSession> &session) {
    auto *app = QCoreApplication::instance();
    if (!app || QCoreApplication::closingDown()) return noMutationError("NO_QT_APPLICATION", "Qt application is unavailable");
    if (!ownerAlive(session)) return {{"ok", false}, {"code", "SESSION_OWNER_GONE"}, {"mutationAttempted", false}};
    auto pending = std::make_shared<Pending>();
    const auto begin = Clock::now();
    ++activeGuiRequests;
    const bool queued = QMetaObject::invokeMethod(app, [pending, request, session] {
        struct Finished { ~Finished() { guiSession = nullptr; --activeGuiRequests; } } finished;
        auto expected = Pending::Queued;
        if (!pending->state.compare_exchange_strong(expected, Pending::Running)) return;
        guiSession = session.get();
        Json result;
        try {
            if (!ownerAlive(session)) result = {{"ok", false}, {"code", "SESSION_OWNER_GONE"}, {"mutationAttempted", false}};
            else result = executeWithController(request);
        }
        catch (const std::exception &e) {
            result = error("NATIVE_OPERATION_FAILED", e.what());
            result["mutationAttempted"] = isMutation(request.value("op", std::string()));
            result["outcomeUnknown"] = true;
            if (result["mutationAttempted"] == true) recoveryRequired = true;
        }
        { std::lock_guard<std::mutex> lock(pending->mutex); pending->result = std::move(result); pending->state = Pending::Done; }
        pending->changed.notify_one();
    }, Qt::QueuedConnection);
    if (!queued) { --activeGuiRequests; return noMutationError("GUI_DISPATCH_FAILED", "Could not queue the Qt operation"); }
    std::unique_lock<std::mutex> lock(pending->mutex);
    const auto operation = request.value("op", std::string());
    const auto deadlineMs = 1500;
    if (!pending->changed.wait_for(lock, std::chrono::milliseconds(deadlineMs), [&] { return pending->state == Pending::Done; })) {
        auto expected = Pending::Queued;
        const bool cancelled = pending->state.compare_exchange_strong(expected, Pending::Cancelled);
        auto result = error(cancelled ? "GUI_QUEUE_TIMEOUT" : "GUI_OPERATION_TIMEOUT", cancelled ? "Operation cancelled before GUI dispatch" : "Operation is still executing on the GUI thread; verify its outcome before retry");
        result["outcomeUnknown"] = !cancelled;
        result["mutationAttempted"] = !cancelled && isMutation(operation);
        return result;
    }
    pending->result["dispatchMs"] = elapsed(begin);
    return std::move(pending->result);
}

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE h = INVALID_HANDLE_VALUE) : value(h) {}
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    Handle(const Handle&) = delete;
};
static bool transfer(HANDLE pipe, void *buffer, DWORD size, bool write, DWORD timeout = 2500, HANDLE owner = nullptr) {
    auto *cursor = static_cast<char*>(buffer);
    while (size) {
        if (owner && WaitForSingleObject(owner, 0) != WAIT_TIMEOUT) return false;
        Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        OVERLAPPED overlapped{}; overlapped.hEvent = event.value;
        DWORD done = 0;
        BOOL ok = write ? WriteFile(pipe, cursor, size, &done, &overlapped) : ReadFile(pipe, cursor, size, &done, &overlapped);
        if (!ok && GetLastError() == ERROR_IO_PENDING) {
            HANDLE waits[]{event.value, owner};
            const auto waited = owner ? WaitForMultipleObjects(2, waits, FALSE, timeout) : WaitForSingleObject(event.value, timeout);
            if (waited != WAIT_OBJECT_0) {
                CancelIoEx(pipe, &overlapped); GetOverlappedResult(pipe, &overlapped, &done, TRUE); return false;
            }
            ok = GetOverlappedResult(pipe, &overlapped, &done, FALSE);
        }
        if (!ok || done == 0) return false;
        cursor += done; size -= done;
    }
    return true;
}
static PSECURITY_DESCRIPTOR privateSecurity() {
    HANDLE tokenRaw = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tokenRaw)) return nullptr;
    Handle token(tokenRaw);
    DWORD bytes = 0; GetTokenInformation(token.value, TokenUser, nullptr, 0, &bytes);
    std::vector<char> buffer(bytes);
    if (!GetTokenInformation(token.value, TokenUser, buffer.data(), bytes, &bytes)) return nullptr;
    LPWSTR sid = nullptr;
    if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(buffer.data())->User.Sid, &sid)) return nullptr;
    const auto descriptor = std::wstring(L"D:P(A;;GA;;;SY)(A;;GA;;;") + sid + L")";
    LocalFree(sid);
    PSECURITY_DESCRIPTOR security = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(descriptor.c_str(), SDDL_REVISION_1, &security, nullptr)) return nullptr;
    return security;
}
#include "bridge-session-server.h"
BOOL WINAPI DllMain(HINSTANCE, DWORD, LPVOID) { return TRUE; }
