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
#include <QtWidgets/QAccessibleWidget>
#include <QtGui/QStandardItemModel>
#include <QtGui/QAccessible>
#include <QtGui/QIntValidator>
#include <QtCore/QTimer>
#include <QtCore/QThread>
#include <QtCore/QEvent>
#include <QtCore/QPointer>
#include <fstream>
#include <iostream>
#include <thread>
#include <memory>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <array>
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <nlohmann/json.hpp>

class FixtureTraceJournal {
    struct Record {
        const char *phase;
        long long monotonicUs, utcMs;
        DWORD threadId;
        unsigned long delayMs;
        unsigned int callId;
    };
    static constexpr unsigned int capacity = 256, overflowBit = 1u << 16, stopBit = 1u << 17;
    std::array<Record, capacity> records_{};
    const std::chrono::steady_clock::time_point began_ = std::chrono::steady_clock::now();
    unsigned int count_ = 0, nextCall_ = 0, currentCall_ = 0;
    unsigned int firstEditCall_ = 0, committedCall_ = 0;
    bool overflow_ = false, armed_ = false, armUsed_ = false, currentCaptured_ = false;
    std::atomic<unsigned int> published_{0};
    std::condition_variable changed_;
    std::thread exporter_;

    void exportRecords() {
        unsigned int read = 0;
        std::mutex waitMutex;
        std::unique_lock<std::mutex> waitLock(waitMutex);
        for (;;) {
            const auto state = published_.load(std::memory_order_acquire);
            const auto count = state & 0xffffu;
            while (read < count) {
                const auto &entry = records_[read++];
                std::fprintf(stderr, "SSE_FIXTURE_EDIT_PHASE {\"sequence\":%u,\"phase\":\"%s\",\"monotonicUs\":%lld,\"utcMs\":%lld,\"threadId\":%lu,\"delayMs\":%lu,\"callId\":%u}\n",
                    read, entry.phase, entry.monotonicUs, entry.utcMs, static_cast<unsigned long>(entry.threadId),
                    entry.delayMs, entry.callId);
            }
            std::fflush(stderr);
            if (state & stopBit) {
                std::fprintf(stderr, "SSE_FIXTURE_EDIT_JOURNAL {\"exportComplete\":true,\"records\":%u,\"overflow\":%s}\n",
                    read, state & overflowBit ? "true" : "false");
                std::fflush(stderr);
                return;
            }
            // The GUI producer never locks this mutex. A bounded passive wait
            // also covers a notification arriving before the waiter sleeps.
            changed_.wait_for(waitLock, std::chrono::milliseconds(25), [this, state] {
                return published_.load(std::memory_order_acquire) != state;
            });
        }
    }
public:
    struct MetaCallToken {
        unsigned int parent, callId;
        bool captured, parentCaptured;
    };
    FixtureTraceJournal() : exporter_([this] { exportRecords(); }) {}
    nlohmann::json clockProbe() const {
        return {{"monotonicUs", std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now() - began_).count()},
            {"utcMs", std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count()},
            {"threadId", GetCurrentThreadId()}};
    }
    ~FixtureTraceJournal() {
        published_.fetch_or(stopBit, std::memory_order_release);
        changed_.notify_one();
        exporter_.join();
    }
    void mark(const char *phase, unsigned long delayMs = 0) noexcept {
        if (count_ == capacity) {
            if (!overflow_) {
                overflow_ = true;
                published_.fetch_or(overflowBit, std::memory_order_release);
                changed_.notify_one();
            }
            return;
        }
        auto &entry = records_[count_];
        entry = {phase,
            std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - began_).count(),
            std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count(),
            GetCurrentThreadId(), delayMs, currentCall_};
        // Each slot is written once and becomes immutable before publication.
        published_.store(++count_, std::memory_order_release);
        changed_.notify_one();
    }
    bool armFirstEditWindow() noexcept {
        if (armUsed_ || count_ == capacity) return false;
        armUsed_ = true;
        armed_ = true;
        mark("firstEditWindow.arm");
        return true;
    }
    void markEditPhase(const char *phase, unsigned long delayMs) noexcept {
        mark(phase, delayMs);
        if (!armed_ || !currentCaptured_) return;
        if (!firstEditCall_ && std::strcmp(phase, "textEdited.enter") == 0)
            firstEditCall_ = currentCall_;
        if (currentCall_ == firstEditCall_ && std::strcmp(phase, "commit.leave") == 0)
            committedCall_ = currentCall_;
    }
    MetaCallToken enterMetaCall() noexcept {
        const MetaCallToken token{currentCall_, nextCall_ + 1, armed_, currentCaptured_};
        currentCall_ = ++nextCall_;
        currentCaptured_ = token.captured;
        if (token.captured) mark("metaCall.enter");
        return token;
    }
    void leaveMetaCall(const MetaCallToken &token) noexcept {
        // Entry-time authority prevents an arm command from adding an orphan
        // leave, and preserves the parent when a MetaCall is nested.
        if (token.captured) {
            mark("metaCall.leave");
            if (armed_ && token.callId == committedCall_) {
                mark("firstEditWindow.complete");
                armed_ = false;
            }
        }
        currentCall_ = token.parent;
        currentCaptured_ = token.parentCaptured;
    }
};

class FixtureApplication : public QApplication {
    FixtureTraceJournal &journal_;
public:
    FixtureApplication(int &argc, char **argv, FixtureTraceJournal &journal) : QApplication(argc, argv), journal_(journal) {}
    bool notify(QObject *receiver, QEvent *event) override {
        const bool traced = receiver == this && event && event->type() == QEvent::MetaCall;
        const auto token = traced ? journal_.enterMetaCall() : FixtureTraceJournal::MetaCallToken{};
        struct Leave {
            FixtureTraceJournal &journal;
            bool traced;
            FixtureTraceJournal::MetaCallToken token;
            ~Leave() { if (traced) journal.leaveMetaCall(token); }
        } leave{journal_, traced, token};
        return QApplication::notify(receiver, event);
    }
};

class DialogUITable : public QTableView {
    Q_OBJECT
public:
    explicit DialogUITable(QWidget *parent) : QTableView(parent) {}
};
class FixtureAccessibilityObserver : public QAccessible::ActivationObserver {
public:
    unsigned int changes = 0;
    FixtureAccessibilityObserver() { QAccessible::installActivationObserver(this); }
    ~FixtureAccessibilityObserver() override { QAccessible::removeActivationObserver(this); }
    void accessibilityActiveChanged(bool) override { ++changes; }
};
// Created only by the dedicated cancellation fixture's setup command. The
// original cold Unicode field and the other fixtures retain Qt's normal peer.
class PreparationProbeLineEdit : public QLineEdit {
    Q_OBJECT
    FixtureTraceJournal &journal_;
    bool nameArmed_ = false, nameArmUsed_ = false;
public:
    unsigned int nameReadsStarted = 0, nameReadsCompleted = 0;
    unsigned int selectionChanges = 0, cursorChanges = 0, textEdits = 0, textChanges = 0, commits = 0;
    QString model = QStringLiteral("Uncommitted preparation model"), pending;
    explicit PreparationProbeLineEdit(QWidget *parent, FixtureTraceJournal &journal)
        : QLineEdit(QStringLiteral("Preparation ASCII sentinel"), parent), journal_(journal) {
        setObjectName("syntheticPreparationField"); setAccessibleName("Preparation probe");
        QObject::connect(this, &QLineEdit::selectionChanged, this, [this] { ++selectionChanges; });
        QObject::connect(this, &QLineEdit::cursorPositionChanged, this, [this](int, int) { ++cursorChanges; });
        QObject::connect(this, &QLineEdit::textChanged, this, [this](const QString &) { ++textChanges; });
        QObject::connect(this, &QLineEdit::textEdited, this, [this](const QString &value) { ++textEdits; pending = value; });
        QObject::connect(this, &QLineEdit::editingFinished, this, [this] { ++commits; model = pending; });
    }
    void establishBaseline() {
        setFocus(Qt::OtherFocusReason); setSelection(3, 5);
        selectionChanges = cursorChanges = textEdits = textChanges = commits = 0;
    }
    bool armNameRead() {
        if (nameArmUsed_) return false;
        nameArmed_ = nameArmUsed_ = true; return true;
    }
    void readName() {
        if (!nameArmed_) return;
        nameArmed_ = false; ++nameReadsStarted;
        journal_.mark("preparationName.enter", 2600);
        QThread::msleep(2600);
        ++nameReadsCompleted; journal_.mark("preparationName.leave", 2600);
    }
    nlohmann::json observedState() const {
        const auto text = [](const QString &value) { return value.toUtf8().toStdString(); };
        const auto *focus = QApplication::focusWidget();
        return {{"text", text(QLineEdit::text())}, {"model", text(model)}, {"pending", text(pending)},
            {"cursorPosition", cursorPosition()}, {"selectionStart", selectionStart()}, {"selectionLength", selectedText().size()},
            {"selectedText", text(selectedText())}, {"hasFocus", hasFocus()},
            {"focusObject", focus ? text(focus->objectName()) : std::string()},
            {"focusAddress", std::to_string(reinterpret_cast<std::uintptr_t>(focus))},
            {"nameReadsStarted", nameReadsStarted}, {"nameReadsCompleted", nameReadsCompleted},
            {"signals", {{"selectionChanged", selectionChanges}, {"cursorPositionChanged", cursorChanges},
                {"textEdited", textEdits}, {"textChanged", textChanges}, {"editingFinished", commits}}}};
    }
};
class PreparationProbeAccessible : public QAccessibleWidget {
    PreparationProbeLineEdit *probe_;
public:
    explicit PreparationProbeAccessible(PreparationProbeLineEdit *probe)
        : QAccessibleWidget(probe, QAccessible::EditableText), probe_(probe) {}
    QString text(QAccessible::Text type) const override {
        if (type == QAccessible::Name) probe_->readName();
        if (type == QAccessible::Value) return probe_->QLineEdit::text();
        return QAccessibleWidget::text(type);
    }
    QAccessible::State state() const override {
        auto result = QAccessibleWidget::state();
        result.editable = !probe_->isReadOnly(); result.readOnly = probe_->isReadOnly();
        result.passwordEdit = probe_->echoMode() != QLineEdit::Normal;
        return result;
    }
};
static QAccessibleInterface *preparationProbeFactory(const QString &, QObject *object) {
    if (auto *probe = qobject_cast<PreparationProbeLineEdit *>(object)) return new PreparationProbeAccessible(probe);
    return nullptr;
}
struct PassiveReadCounters {
    unsigned int generation = 0, replacements = 0, modelReads = 0;
    unsigned int slowReadStarted = 0, slowReadCompleted = 0, slowReadArms = 0, stalls = 0, events = 0;
    void event(const char *name) {
        std::cout << nlohmann::json({{"event", name}, {"generation", generation},
            {"sequence", ++events}, {"delayMs", 2600}}).dump() << std::endl;
    }
};
class PassiveTableModel : public QStandardItemModel {
    PassiveReadCounters &counters_;
    mutable bool slowNext_ = false;
public:
    explicit PassiveTableModel(QObject *parent, PassiveReadCounters &counters)
        : QStandardItemModel(4, 7, parent), counters_(counters) {
        for (int column = 0; column < 7; ++column) setHeaderData(column, Qt::Horizontal, QString("Column %1").arg(column));
        for (int row = 0; row < 4; ++row) for (int column = 0; column < 7; ++column)
            setData(index(row, column), QString("passive-%1-row-%2-cell-%3").arg(counters.generation).arg(row).arg(column));
    }
    void armSlowRead() { slowNext_ = true; }
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override {
        if (index.row() == 0 && index.column() == 0 && role == Qt::EditRole) {
            ++counters_.modelReads;
            if (slowNext_) {
                slowNext_ = false;
                ++counters_.slowReadStarted;
                counters_.event("passive-model-read-enter");
                QThread::msleep(2600);
                ++counters_.slowReadCompleted;
                counters_.event("passive-model-read-leave");
            }
        }
        return QStandardItemModel::data(index, role);
    }
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
    FixtureTraceJournal journal;
    FixtureApplication app(argc, argv, journal);
    // A probe is queued on the GUI thread without extending the application's
    // first-edit MetaCall journal, including while its capture window is armed.
    QObject clockProbeReceiver;
    FixtureAccessibilityObserver accessibilityObserver;
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
    const auto traceEditPhase = [&journal](const char *phase, unsigned long delayMs) { journal.markEditPhase(phase, delayMs); };
    QObject::connect(field, &QLineEdit::textEdited, committed, [pendingEdited, editedCount, commitDelayMs, traceEditPhase](const QString &value) {
        traceEditPhase("textEdited.enter", *commitDelayMs);
        *pendingEdited=value; editedCount->setText(QString::number(editedCount->text().toInt()+1));
        traceEditPhase("textEdited.leave", *commitDelayMs);
    });
    QObject::connect(field, &QLineEdit::editingFinished, committed, [pendingEdited, committed, commitDelayMs, traceEditPhase] {
        traceEditPhase("commit.enter", *commitDelayMs);
        traceEditPhase("delay.before", *commitDelayMs);
        QThread::msleep(*commitDelayMs);
        traceEditPhase("delay.after", *commitDelayMs);
        traceEditPhase("modelSet.before", *commitDelayMs);
        committed->setText(*pendingEdited);
        traceEditPhase("modelSet.after", *commitDelayMs);
        traceEditPhase("commit.leave", *commitDelayMs);
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
    QPointer<PreparationProbeLineEdit> preparationProbe;
    PassiveReadCounters passiveCounters;
    QPointer<QWidget> passivePage;
    QPointer<DialogUITable> passiveTable;
    const auto makePassiveTable = [&](QWidget *parent) {
        auto *view = new DialogUITable(parent); view->setObjectName("syntheticPassiveTable");
        view->setModel(new PassiveTableModel(view, passiveCounters));
        view->setColumnHidden(5, true); view->setRowHidden(2, true);
        view->setMinimumHeight(80);
        return view;
    };
    const auto makePassivePage = [&] {
        auto *page = new QWidget(panel); page->setObjectName("syntheticPassivePage");
        auto *pageLayout = new QVBoxLayout(page);
        passiveTable = makePassiveTable(page); pageLayout->addWidget(passiveTable);
        auto *summary = new QWidget(page); summary->setObjectName("syntheticPassiveSummary");
        auto *summaryLayout = new QHBoxLayout(summary);
        summaryLayout->addWidget(new QLabel("Summe", summary));
        auto *total = new QLineEdit("4,00", summary); total->setReadOnly(true);
        total->setObjectName("syntheticPassiveTotal"); summaryLayout->addWidget(total);
        pageLayout->addWidget(summary); layout->addWidget(page); page->show();
        passivePage = page;
    };
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
            if (command == "trace-clock-probe") {
                QMetaObject::invokeMethod(&clockProbeReceiver, [&] {
                    std::cout << journal.clockProbe().dump() << std::endl;
                }, Qt::QueuedConnection);
                continue;
            }
            QMetaObject::invokeMethod(&app, [&, command] {
                if (command == "trace-first-edit-arm") {
                    if (!journal.armFirstEditWindow()) { std::cout << "trace-first-edit-arm-refused" << std::endl; return; }
                }
                else if (command == "change-field") field->setText("Changed by fixture");
                else if (command == "validate-field") { field->setText("10"); field->setValidator(new QIntValidator(10, 99, field)); }
                else if (command == "mask-field") { field->setInputMask("99;_"); field->setText("10"); }
                else if (command == "slow-field-commit") *commitDelayMs = 1600;
                else if (command == "timeout-field-commit") *commitDelayMs = 2600;
                else if (command == "preparation-probe-setup") {
                    if (preparationProbe) { std::cout << "preparation-probe-refused" << std::endl; return; }
                    QAccessible::installFactory(preparationProbeFactory);
                    preparationProbe = new PreparationProbeLineEdit(panel, journal);
                    layout->insertWidget(0, preparationProbe); preparationProbe->show(); preparationProbe->establishBaseline();
                }
                else if (command == "preparation-probe-state") {
                    if (!preparationProbe) { std::cout << "preparation-probe-refused" << std::endl; return; }
                    std::cout << preparationProbe->observedState().dump() << std::endl; return;
                }
                else if (command == "preparation-probe-arm") {
                    if (!preparationProbe || !preparationProbe->armNameRead()) { std::cout << "preparation-probe-refused" << std::endl; return; }
                }
                else if (command == "date-commit-count") { std::cout << date->property("syntheticCommitCount").toInt() << std::endl; return; }
                else if (command == "accessibility-status") rateModel->setText(QAccessible::isActive() ? "active" : "inactive");
                else if (command == "reset-accessibility-status") rateModel->setText("Unactivated");
                else if (command == "passive-accessibility-state") {
                    std::cout << nlohmann::json({{"active", QAccessible::isActive()}, {"activationChanges", accessibilityObserver.changes},
                        {"generation", passiveCounters.generation}, {"replacements", passiveCounters.replacements},
                        {"modelReads", passiveCounters.modelReads}, {"slowReadStarted", passiveCounters.slowReadStarted},
                        {"slowReadCompleted", passiveCounters.slowReadCompleted}}).dump() << std::endl;
                    return;
                }
                else if (command == "passive-table-open") {
                    if (passivePage || passiveCounters.generation >= 64) { std::cout << "passive-command-refused" << std::endl; return; }
                    ++passiveCounters.generation; table->hide(); makePassivePage();
                }
                else if (command == "passive-table-replace-model") {
                    if (!passiveTable || !passiveTable->model() || passiveCounters.generation >= 64) {
                        std::cout << "passive-command-refused" << std::endl; return;
                    }
                    ++passiveCounters.generation; ++passiveCounters.replacements;
                    auto *previous = passiveTable->model();
                    passiveTable->setModel(new PassiveTableModel(passiveTable, passiveCounters)); delete previous;
                    passiveTable->setColumnHidden(5, true); passiveTable->setRowHidden(2, true);
                }
                else if (command == "passive-table-replace-page") {
                    if (!passivePage || passiveCounters.generation >= 64) { std::cout << "passive-command-refused" << std::endl; return; }
                    ++passiveCounters.generation; ++passiveCounters.replacements;
                    delete passivePage.data(); makePassivePage();
                }
                else if (command == "passive-table-remove-model") {
                    if (!passiveTable || !passiveTable->model()) { std::cout << "passive-command-refused" << std::endl; return; }
                    auto *previous = passiveTable->model(); passiveTable->setModel(nullptr); delete previous;
                }
                else if (command == "passive-table-duplicate") {
                    if (!passivePage || passivePage->findChildren<DialogUITable *>().size() != 1) {
                        std::cout << "passive-command-refused" << std::endl; return;
                    }
                    qobject_cast<QVBoxLayout *>(passivePage->layout())->insertWidget(0, makePassiveTable(passivePage));
                }
                else if (command == "passive-table-close") {
                    if (!passivePage) { std::cout << "passive-command-refused" << std::endl; return; }
                    delete passivePage.data(); table->show();
                }
                else if (command == "passive-gui-stall") {
                    if (++passiveCounters.stalls > 8) { std::cout << "passive-command-refused" << std::endl; return; }
                    std::cout << command << std::endl;
                    passiveCounters.event("passive-gui-stall-enter"); QThread::msleep(2600);
                    passiveCounters.event("passive-gui-stall-leave"); return;
                }
                else if (command == "passive-model-slow-read") {
                    auto *passiveModel = passiveTable ? dynamic_cast<PassiveTableModel *>(passiveTable->model()) : nullptr;
                    if (!passiveModel || ++passiveCounters.slowReadArms > 8) { std::cout << "passive-command-refused" << std::endl; return; }
                    passiveModel->armSlowRead();
                }
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
