#pragma once
#include <QtWidgets/QCheckBox>
#include <QtWidgets/QTextEdit>
#include <QtCore/QRegularExpression>

static QString actionText(const Json &value) {
    const auto text = value.get<std::string>();
    if (text.size() > 65536) throw std::runtime_error("Native edit text exceeds bound");
    return QString::fromUtf8(text.data(), static_cast<qsizetype>(text.size()));
}

// These mechanisms are private to authenticated, catalogue-bound compound
// transactions. Generic public field and table writes remain unavailable.
static Json replaceAccessibleEdit(QWidget *root, QAccessibleInterface *target, const Json &request) {
    if (!request.contains("expectedValue") || !request.at("expectedValue").is_string()
        || !request.contains("value") || !request.at("value").is_string())
        return noMutationError("INVALID_EDIT", "The exact edit requires old and requested literal values");
    const auto expected = actionText(request.at("expectedValue"));
    const auto value = actionText(request.at("value"));
    auto *widget = qobject_cast<QWidget *>(target->object());
    if (!widget || !belongsTo(widget, root) || widget->thread() != QThread::currentThread()
        || target->state().readOnly || target->state().passwordEdit)
        return noMutationError("ACTION_UNSUPPORTED", "The exact target is not a writable owned Qt edit");
    if (auto *line = qobject_cast<QLineEdit *>(widget)) {
        if (line->isReadOnly() || line->echoMode() != QLineEdit::Normal)
            return noMutationError("readonly", "The exact Qt line edit is read-only or protected");
        if (qobject_cast<QComboBox *>(line->parentWidget()))
            return noMutationError("ACTION_UNSUPPORTED", "Combo values require typed option activation");
        if (line->text() != expected) return noMutationError("stale", "The exact Qt line edit changed before dispatch");
        QPointer<QLineEdit> live(line);
        mutationStarted = true;
        line->selectAll();
        if (!live) return error("stale", "The Qt line edit disappeared during selection");
        if (live->text() != expected || live->isReadOnly() || !live->isEnabled())
            return error("stale", "The Qt line edit changed during selection");
        // insert preserves validation and emits textEdited as user input does.
        // setText only changes presentation for clients listening to textEdited.
        live->insert(value);
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
        if (!commitTarget || !QMetaObject::invokeMethod(commitTarget, "editingFinished", Qt::DirectConnection))
            return error("ACTION_DISPATCH_FAILED", "The Qt edit model commit could not be dispatched");
        if (!live) return error("stale", "The Qt line edit disappeared during model commit");
        return {{"ok", true}, {"value", utf8(live->text())}};
    }
    if (auto *text = qobject_cast<QTextEdit *>(widget)) {
        if (text->isReadOnly()) return noMutationError("readonly", "The exact Qt text edit is read-only");
        if (text->toPlainText() != expected) return noMutationError("stale", "The exact Qt text edit changed before dispatch");
        QPointer<QTextEdit> live(text);
        mutationStarted = true;
        auto cursor = text->textCursor(); cursor.select(QTextCursor::Document); cursor.insertText(value);
        if (!live) return error("stale", "The Qt text edit disappeared during insertion");
        live->setTextCursor(cursor);
        if (!live) return error("stale", "The Qt text edit disappeared during cursor update");
        return {{"ok", true}, {"value", utf8(live->toPlainText())}};
    }
    if (auto *text = qobject_cast<QPlainTextEdit *>(widget)) {
        if (text->isReadOnly()) return noMutationError("readonly", "The exact Qt plain-text edit is read-only");
        if (text->toPlainText() != expected) return noMutationError("stale", "The exact Qt plain-text edit changed before dispatch");
        QPointer<QPlainTextEdit> live(text);
        mutationStarted = true;
        auto cursor = text->textCursor(); cursor.select(QTextCursor::Document); cursor.insertText(value);
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
