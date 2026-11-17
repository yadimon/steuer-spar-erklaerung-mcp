// Include the actual private implementation; no test hook is exported by the DLL.
// BridgeStart is never called. The offscreen widgets are never shown, and this
// test does not enter dispatch() or acquire the session-wide controller mutex.
#include "../bridge.cpp"
#include <cstdlib>
#include <iostream>

static void require(bool condition, const char *message) {
    if (!condition) { std::cerr << message << '\n'; std::exit(1); }
}

struct Observation { Json result; Json records; };

static Observation exercise(int limit, const QString &value, const QString &mask = {}) {
    QWidget root;
    QLineEdit edit(&root);
    edit.setInputMask(mask);
    edit.setMaxLength(limit);
    edit.setText(QStringLiteral("12-34"));
    edit.setSelection(0, 1);
    const auto original = edit.text();
    const auto selected = edit.selectedText();
    const auto selectionStart = edit.selectionStart();
    const auto cursor = edit.cursorPosition();
    const auto modified = edit.isModified();
    const auto undoAvailable = edit.isUndoAvailable();
    const auto redoAvailable = edit.isRedoAvailable();
    const auto *focus = QApplication::focusWidget();
    int changes = 0, edits = 0, commits = 0, selections = 0, cursorMoves = 0;
    QString model = original;
    QObject::connect(&edit, &QLineEdit::textChanged, &root, [&](const QString &) { ++changes; });
    QObject::connect(&edit, &QLineEdit::textEdited, &root, [&](const QString &text) { ++edits; model = text; });
    QObject::connect(&edit, &QLineEdit::editingFinished, &root, [&] { ++commits; model = edit.text(); });
    QObject::connect(&edit, &QLineEdit::selectionChanged, &root, [&] { ++selections; });
    QObject::connect(&edit, &QLineEdit::cursorPositionChanged, &root, [&](int, int) { ++cursorMoves; });
    auto *target = QAccessible::queryAccessibleInterface(&edit);
    require(target && target->isValid(), "The test requires a real Qt accessible line edit");
    NativeDispatchFence fence(true);
    require(fence.beginDispatch(), "The test must begin in read-only preparation");
    NativeEditTrace trace;
    Json result;
    {
        NativeGuiContextScope context(guiSession, mutationStarted, currentNativeDispatchFence, nullptr, &fence);
        NativeEditTraceScope tracing(&trace);
        result = replaceAccessibleEdit(&root, target, {{"expectedValue", utf8(original)}, {"value", utf8(value)}});
        require(!mutationStarted && fence.state() == NativeDispatchFence::State::Preparing,
            "The helper must not claim a mutation permit in the unbound console test");
    }
    require(result.at("ok") == false && result.at("mutationAttempted") == false
        && result.at("outcomeUnknown") == false, "Rejection must prove no mutation and a known outcome");
    require(edit.text() == original && edit.selectedText() == selected && edit.selectionStart() == selectionStart
        && edit.cursorPosition() == cursor && edit.isModified() == modified
        && edit.isUndoAvailable() == undoAvailable && edit.isRedoAvailable() == redoAvailable
        && QApplication::focusWidget() == focus && model == original,
        "Rejected text must preserve the actual Qt field, selection, history, focus and model");
    require(changes == 0 && edits == 0 && commits == 0 && selections == 0 && cursorMoves == 0,
        "Rejection must emit no text, cursor, selection or model-commit signals");
    return {std::move(result), trace.snapshot().at("records")};
}

static void rejectsOverlong(int limit, const QString &value, const QString &mask = {}) {
    const auto [result, records] = exercise(limit, value, mask);
    require(result.at("code") == "EDIT_VALIDATION_FAILED", "Overlong text must fail the length precondition");
    require(result.at("error") == "The requested literal exceeds the Qt line edit length limit",
        "The length error must not expose the requested or existing text");
    require(records.size() == 3 && records.at(0).at("phase") == "gui.enter"
        && records.at(1).at("phase") == "edit.enter" && records.at(2).at("phase") == "gui.complete",
        "Overlong text must be rejected before layout preparation, permit, selection and insertion");
}

static void passesLengthCheck(int limit, const QString &value, const QString &mask = {}) {
    const auto [result, records] = exercise(limit, value, mask);
    // No bound native session is supplied. A fitting value must pass the
    // length check and preparation, then fail the existing binding check.
    // This is not evidence of a successful complete native write.
    require(result.at("code") == "stale", "Fitting text must reach the existing binding precondition");
    require(records.at(2).at("phase") == "prepare.before"
        && records.at(records.size() - 2).at("phase") == "prepare.after",
        "The length guard must preserve preparation for fitting text");
}

int main(int argc, char **argv) {
    qputenv("QT_QPA_PLATFORM", "offscreen");
    QApplication app(argc, argv);
    const auto unicodeBoundary = QStringLiteral("ab\U0001F680");
    require(unicodeBoundary.size() == 4 && unicodeBoundary.at(2).isHighSurrogate()
        && unicodeBoundary.at(3).isLowSurrogate(), "The Unicode boundary must contain a real UTF-16 surrogate pair");
    rejectsOverlong(4, QStringLiteral("12345"));
    rejectsOverlong(4, unicodeBoundary + QChar('c'));
    rejectsOverlong(32767, QString(32768, QChar('x')));
    rejectsOverlong(0, QStringLiteral("x"));
    rejectsOverlong(32767, QStringLiteral("12-345"), QStringLiteral("99-99;_"));
    passesLengthCheck(4, QStringLiteral("1234"));
    passesLengthCheck(4, unicodeBoundary);
    passesLengthCheck(0, QString());
    passesLengthCheck(32767, QStringLiteral("12-34"), QStringLiteral("99-99;_"));
    std::cout << "Native edit length preconditions passed without visible windows or controller access\n";
}
