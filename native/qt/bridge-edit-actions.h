#pragma once
#include <QtWidgets/QCheckBox>
#include <QtWidgets/QTextEdit>
#include <QtCore/QRegularExpression>
#include <QtGui/QTextLayout>
#include <cstring>

static QString actionText(const Json &value) {
    const auto text = value.get<std::string>();
    if (text.size() > 65536) throw std::runtime_error("Native edit text exceeds bound");
    return QString::fromUtf8(text.data(), static_cast<qsizetype>(text.size()));
}

struct PreparedEditBinding {
    QPointer<QWidget> main;
    QPointer<QWidget> root;
    QPointer<QWidget> widget;
    const NativeSession *session;
    NativeDispatchFence *fence;
    std::uint64_t generation;
    std::string name;
};
static bool preparedEditContextLive(const PreparedEditBinding &binding) {
    if (!binding.main || !binding.root || !binding.widget || !binding.session || !binding.fence
        || guiSession != binding.session || currentNativeDispatchFence != binding.fence
        || generation.load() != binding.generation || guiGeneration != binding.generation
        || binding.session->released || recoveryRequired
        || WaitForSingleObject(binding.session->owner, 0) != WAIT_TIMEOUT)
        return false;
    const auto &original = binding.session->binding;
    if (original.processId != config.processId || original.creationTime != config.creationTime
        || original.ownerProcessId != config.ownerProcessId || original.ownerCreationTime != config.ownerCreationTime
        || original.window != config.window || std::strcmp(original.nonce, config.nonce) != 0)
        return false;
    return binding.main == boundRoot && binding.root->thread() == QThread::currentThread()
        && binding.widget->thread() == QThread::currentThread() && belongsTo(binding.widget, binding.root);
}
// Reacquire the accessible identity after preparation. No interface pointer
// from before the potentially slow platform/font calls crosses this boundary.
static bool validatePreparedEditBinding(const PreparedEditBinding &binding, const Json &request) {
    if (!preparedEditContextLive(binding) || rootWidget() != binding.main
        || !binding.root->isEnabled() || !binding.root->isVisible()
        || !binding.widget->isEnabled() || !binding.widget->isVisible()
        || accessibilityModalBlocked(binding.root, request)) return false;
    if (request.contains("toolTitle")) {
        const auto title = QString::fromUtf8(request.at("toolTitle").get<std::string>().c_str());
        int matches = 0;
        for (auto *candidate : QApplication::topLevelWidgets()) {
            if (candidate != binding.main && candidate->isVisible() && candidate->windowTitle() == title) {
                if (candidate != binding.root) return false;
                ++matches;
            }
        }
        if (matches != 1) return false;
    } else if (binding.root != binding.main) return false;
    auto *rootInterface = QAccessible::queryAccessibleInterface(binding.root);
    if (!preparedEditContextLive(binding) || !rootInterface || !rootInterface->isValid()) return false;
    if (!preparedEditContextLive(binding)) return false;
    const auto rootHost = accessibleHost(rootInterface);
    if (!preparedEditContextLive(binding) || rootHost == 0
        || request.at("expectedRootHwnd").get<std::uint64_t>() != rootHost) return false;
    auto *fresh = QAccessible::queryAccessibleInterface(binding.widget);
    if (!preparedEditContextLive(binding) || !fresh || !fresh->isValid()) return false;
    if (!preparedEditContextLive(binding)) return false;
    const auto state = fresh->state();
    if (!preparedEditContextLive(binding) || state.disabled || state.invisible || state.readOnly || state.passwordEdit)
        return false;
    const auto aid = accessibleText(QAccessibleBridgeUtils::accessibleId(fresh));
    if (!preparedEditContextLive(binding) || aid != request.at("aid").get<std::string>()) return false;
    const auto name = accessibleText(fresh->text(QAccessible::Name), true);
    if (!preparedEditContextLive(binding) || name != binding.name
        || (!request.value("expectedName", std::string()).empty() && name != request.at("expectedName").get<std::string>()))
        return false;
    std::uint64_t host = 0;
    auto *ancestor = fresh;
    for (int depth = 0; ancestor && depth < 128; ++depth) {
        host = accessibleHost(ancestor);
        if (!preparedEditContextLive(binding)) return false;
        if (host) break;
        ancestor = ancestor->parent();
        if (!preparedEditContextLive(binding)) return false;
    }
    if (!host) return false;
    const auto rid = accessibleRuntimeId(fresh, host);
    if (!preparedEditContextLive(binding) || rid != request.at("rid").get<std::string>()) return false;
    // A provider may reenter application code while returning any of the
    // preceding values. Repeat the cheap root/obstruction proof last.
    return preparedEditContextLive(binding) && rootWidget() == binding.main
        && binding.root->isEnabled() && binding.root->isVisible()
        && binding.widget->isEnabled() && binding.widget->isVisible()
        && !accessibilityModalBlocked(binding.root, request);
}

static QString lineEditDisplayCopy(QString value) {
    for (auto &character : value) {
        if ((character.unicode() < 0x20 && character.unicode() != 0x09)
            || character == QChar::LineSeparator || character == QChar::ParagraphSeparator)
            character = QChar(0x0020);
    }
    return value;
}

// These mechanisms are private to authenticated, catalogue-bound compound
// transactions. Generic public field and table writes remain unavailable.
static Json replaceAccessibleEdit(QWidget *root, QAccessibleInterface *target, const Json &request) {
    markNativeEdit(NativeEditPhase::EditEnter);
    if (currentNativeDispatchFence
        && currentNativeDispatchFence->provenCancellation() == NativeDispatchFence::Cancellation::Preparing) {
        markNativeEdit(NativeEditPhase::PermitRefused);
        return dispatchCancellationResult(NativeDispatchFence::Cancellation::Preparing, true);
    }
    if (!request.contains("expectedValue") || !request.at("expectedValue").is_string()
        || !request.contains("value") || !request.at("value").is_string())
        return noMutationError("INVALID_EDIT", "The exact edit requires old and requested literal values");
    const auto expected = actionText(request.at("expectedValue"));
    const auto value = actionText(request.at("value"));
    QPointer<QWidget> liveRoot(root);
    QPointer<QObject> object(target->object());
    if (!liveRoot || !object) return noMutationError("stale", "The exact Qt edit disappeared before preparation");
    QPointer<QWidget> widget(qobject_cast<QWidget *>(object.data()));
    const auto state = target->state();
    if (!liveRoot || !widget || !belongsTo(widget, liveRoot) || widget->thread() != QThread::currentThread()
        || state.readOnly || state.passwordEdit)
        return noMutationError("ACTION_UNSUPPORTED", "The exact target is not a writable owned Qt edit");
    const auto observedName = accessibleText(target->text(QAccessible::Name), true);
    if (!liveRoot || !widget) return noMutationError("stale", "The exact Qt edit disappeared before preparation");
    const PreparedEditBinding binding{boundRoot, liveRoot, widget, guiSession, currentNativeDispatchFence,
        generation.load(), observedName};
    if (binding.fence && binding.fence->provenCancellation() == NativeDispatchFence::Cancellation::Preparing) {
        markNativeEdit(NativeEditPhase::PermitRefused);
        return dispatchCancellationResult(NativeDispatchFence::Cancellation::Preparing, true);
    }
    if (auto *line = qobject_cast<QLineEdit *>(widget.data())) {
        if (line->isReadOnly() || line->echoMode() != QLineEdit::Normal)
            return noMutationError("readonly", "The exact Qt line edit is read-only or protected");
        if (qobject_cast<QComboBox *>(line->parentWidget()))
            return noMutationError("ACTION_UNSUPPORTED", "Combo values require typed option activation");
        if (line->text() != expected) return noMutationError("stale", "The exact Qt line edit changed before dispatch");
        QPointer<QLineEdit> live(line);
        const auto font = live->font();
        const auto mask = live->inputMask();
        const auto maxLength = live->maxLength();
        markNativeEdit(NativeEditPhase::PrepareBefore);
        if (mask.isEmpty()) {
            // Prepare shared font/fallback caches with the actual copied font.
            // Auto direction does not mirror a privately forced control direction;
            // the real insert still performs its own complete layout. This local
            // layout neither queries a paint device nor changes the target.
            QTextLayout preparation(lineEditDisplayCopy(value), font);
            QTextOption option;
            option.setTextDirection(Qt::LayoutDirectionAuto);
            option.setFlags(QTextOption::IncludeTrailingSpaces);
            preparation.setTextOption(option);
            preparation.setCacheEnabled(true);
            preparation.beginLayout();
            const auto preparedLine = preparation.createLine();
            preparation.endLayout();
            if (!preparedLine.isValid())
                return noMutationError("ACTION_DISPATCH_FAILED", "The read-only Qt edit layout could not be prepared");
        }
        markNativeEdit(NativeEditPhase::PrepareAfter);
        if (binding.fence && binding.fence->provenCancellation() == NativeDispatchFence::Cancellation::Preparing) {
            markNativeEdit(NativeEditPhase::PermitRefused);
            return dispatchCancellationResult(NativeDispatchFence::Cancellation::Preparing, true);
        }
        if (!validatePreparedEditBinding(binding, request) || !live
            || live->text() != expected || live->isReadOnly() || live->echoMode() != QLineEdit::Normal
            || qobject_cast<QComboBox *>(live->parentWidget()) || !live->font().isCopyOf(font)
            || live->inputMask() != mask || live->maxLength() != maxLength)
            return noMutationError("stale", "The exact Qt line edit binding changed during preparation");
        if (auto denied = requireEditMutationPermit(); !denied.is_null()) return denied;
        markNativeEdit(NativeEditPhase::SelectAllBefore);
        live->selectAll();
        markNativeEdit(NativeEditPhase::SelectAllAfter);
        if (!live) return error("stale", "The Qt line edit disappeared during selection");
        if (live->text() != expected || live->isReadOnly() || !live->isEnabled())
            return error("stale", "The Qt line edit changed during selection");
        // insert preserves validation and emits textEdited as user input does.
        // setText only changes presentation for clients listening to textEdited.
        markNativeEdit(NativeEditPhase::InsertBefore);
        live->insert(value);
        markNativeEdit(NativeEditPhase::InsertAfter);
        if (!live) return error("stale", "The Qt line edit disappeared during insertion");
        if (live->text() != value || !live->hasAcceptableInput())
            return error("EDIT_VALIDATION_FAILED", "The requested literal was not accepted as complete Qt input");
        QPointer<QWidget> commitTarget(live);
        if (auto *spin = qobject_cast<QAbstractSpinBox *>(live->parentWidget())) {
            QPointer<QAbstractSpinBox> liveSpin(spin);
            spin->interpretText();
            if (!liveSpin || !live || live->text() != value || !live->hasAcceptableInput())
                return error("EDIT_VALIDATION_FAILED", "The interpreted Qt input changed before its commit");
            commitTarget = liveSpin;
        }
        markNativeEdit(NativeEditPhase::CommitBefore);
        if (!commitTarget || !QMetaObject::invokeMethod(commitTarget, "editingFinished", Qt::DirectConnection))
            return error("ACTION_DISPATCH_FAILED", "The Qt edit model commit could not be dispatched");
        markNativeEdit(NativeEditPhase::CommitAfter);
        if (!live) return error("stale", "The Qt line edit disappeared during model commit");
        return {{"ok", true}, {"value", utf8(live->text())}};
    }
    if (auto *text = qobject_cast<QTextEdit *>(widget.data())) {
        if (text->isReadOnly()) return noMutationError("readonly", "The exact Qt text edit is read-only");
        if (text->toPlainText() != expected) return noMutationError("stale", "The exact Qt text edit changed before dispatch");
        QPointer<QTextEdit> live(text);
        if (!validatePreparedEditBinding(binding, request) || !live
            || live->isReadOnly() || live->toPlainText() != expected)
            return noMutationError("stale", "The exact Qt text edit binding changed before its mutation permit");
        if (auto denied = requireEditMutationPermit(); !denied.is_null()) return denied;
        auto cursor = live->textCursor(); cursor.select(QTextCursor::Document); cursor.insertText(value);
        if (!live) return error("stale", "The Qt text edit disappeared during insertion");
        live->setTextCursor(cursor);
        if (!live) return error("stale", "The Qt text edit disappeared during cursor update");
        return {{"ok", true}, {"value", utf8(live->toPlainText())}};
    }
    if (auto *text = qobject_cast<QPlainTextEdit *>(widget.data())) {
        if (text->isReadOnly()) return noMutationError("readonly", "The exact Qt plain-text edit is read-only");
        if (text->toPlainText() != expected) return noMutationError("stale", "The exact Qt plain-text edit changed before dispatch");
        QPointer<QPlainTextEdit> live(text);
        if (!validatePreparedEditBinding(binding, request) || !live
            || live->isReadOnly() || live->toPlainText() != expected)
            return noMutationError("stale", "The exact Qt plain-text edit binding changed before its mutation permit");
        if (auto denied = requireEditMutationPermit(); !denied.is_null()) return denied;
        auto cursor = live->textCursor(); cursor.select(QTextCursor::Document); cursor.insertText(value);
        if (!live) return error("stale", "The Qt plain-text edit disappeared during insertion");
        live->setTextCursor(cursor);
        if (!live) return error("stale", "The Qt plain-text edit disappeared during cursor update");
        return {{"ok", true}, {"value", utf8(live->toPlainText())}};
    }
    return noMutationError("ACTION_UNSUPPORTED", "The exact target has no supported Qt edit widget");
}

static Json selectAccessibleCombo(QWidget *root, QAccessibleInterface *target, const Json &request) {
    if (!request.contains("expectedValue") || !request.at("expectedValue").is_string()
        || !request.contains("value") || !request.at("value").is_string())
        return noMutationError("INVALID_EDIT", "The exact combo requires old and requested typed values");
    const auto expected = actionText(request.at("expectedValue"));
    const auto rate = actionText(request.at("value"));
    if (rate != "0" && rate != "7" && rate != "19")
        return noMutationError("INVALID_EDIT", "The exact tax combo requires rate 0, 7 or 19");
    auto *line = qobject_cast<QLineEdit *>(target->object());
    auto *combo = line ? qobject_cast<QComboBox *>(line->parentWidget()) : nullptr;
    if (!combo || !belongsTo(combo, root) || combo->thread() != QThread::currentThread()
        || !combo->isEnabled() || !combo->isEditable() || combo->lineEdit() != line || line->isReadOnly())
        return noMutationError("ACTION_UNSUPPORTED", "The exact target is not a writable owned Qt combo editor");
    if (line->text() != expected) return noMutationError("stale", "The exact tax combo changed before dispatch");
    if (combo->count() < 1 || combo->count() > 32)
        return noMutationError("ACTION_LOOKUP_BOUND", "The exact tax combo exceeds its option bound");
    const QRegularExpression pattern(QStringLiteral("^\\s*(0|7|19)\\s*%?\\s*$"));
    int index = -1, matches = 0;
    for (int option = 0; option < combo->count(); ++option) {
        const auto label = combo->itemText(option);
        const auto parsed = pattern.match(label);
        if ((rate == "0" && label.trimmed().isEmpty()) || (parsed.hasMatch() && parsed.captured(1) == rate)) {
            index = option; ++matches;
        }
    }
    // A zero rate is represented by an unset editable combo in the product.
    if (matches != 1 && !(rate == "0" && matches == 0))
        return noMutationError("ambiguous", "The exact tax combo option is absent or ambiguous");
    QPointer<QComboBox> live(combo);
    mutationStarted = true;
    combo->setCurrentIndex(index);
    if (!live || live->currentIndex() != index || !live->isEnabled())
        return error("stale", "The Qt combo changed during option selection");
    if (!live || !QMetaObject::invokeMethod(live, "activated", Qt::DirectConnection, Q_ARG(int, index)))
        return error("ACTION_DISPATCH_FAILED", "The typed Qt combo activation could not be dispatched");
    if (!live || !live->lineEdit()) return error("stale", "The Qt combo disappeared during activation");
    return {{"ok", true}, {"value", utf8(live->lineEdit()->text())}, {"optionIndex", index}};
}

static Json toggleAccessibleCheckBox(QWidget *root, QAccessibleInterface *target, const Json &request) {
    if (!request.contains("expectedChecked") || !request.at("expectedChecked").is_boolean()
        || !request.contains("checked") || !request.at("checked").is_boolean())
        return noMutationError("INVALID_EDIT", "The exact checkbox requires old and requested boolean values");
    auto *check = qobject_cast<QCheckBox *>(target->object());
    if (!check || !belongsTo(check, root) || check->thread() != QThread::currentThread()
        || !check->isEnabled() || check->isTristate())
        return noMutationError("ACTION_UNSUPPORTED", "The exact target is not a binary owned Qt checkbox");
    const auto wanted = request.at("checked").get<bool>();
    if (check->isChecked() != request.at("expectedChecked").get<bool>())
        return noMutationError("stale", "The exact Qt checkbox changed before dispatch");
    if (check->isChecked() == wanted) return {{"ok", true}, {"checked", wanted}};
    QPointer<QCheckBox> live(check);
    mutationStarted = true;
    check->click();
    if (!live) return error("stale", "The Qt checkbox disappeared during click");
    return {{"ok", true}, {"checked", live->isChecked()}};
}
