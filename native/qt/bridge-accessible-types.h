#pragma once
#include <QtGui/QAccessible>
#include <qpa/qplatforminputcontextfactory_p.h>

// Public UIA control names for the roles used by the pinned Qt Windows provider.
static const char *accessibleControlType(QAccessibleInterface *iface) {
    static const bool customInputContext = !QPlatformInputContextFactory::requested().isEmpty();
    const auto parent = iface->parent();
    if (parent && parent->role() == QAccessible::Application) return "Window";
    switch (iface->role()) {
    case QAccessible::TitleBar: return "TitleBar";
    case QAccessible::MenuBar: return "MenuBar";
    case QAccessible::ScrollBar: return "ScrollBar";
    case QAccessible::Grip: return "Thumb";
    case QAccessible::AlertMessage: case QAccessible::Window: case QAccessible::Dialog: return "Window";
    case QAccessible::Client: case QAccessible::Grouping: case QAccessible::BlockQuote: return "Group";
    case QAccessible::PopupMenu: return "Menu";
    case QAccessible::MenuItem: return "MenuItem";
    case QAccessible::ToolTip: case QAccessible::HelpBalloon: return "ToolTip";
    case QAccessible::Document: case QAccessible::WebDocument: return "Document";
    case QAccessible::Pane: return "Pane";
    case QAccessible::Separator: return "Separator";
    case QAccessible::ToolBar: return "ToolBar";
    case QAccessible::StatusBar: return "StatusBar";
    case QAccessible::Table: return "Table";
    case QAccessible::ColumnHeader: case QAccessible::RowHeader: return "Header";
    case QAccessible::Column: case QAccessible::Row: return "HeaderItem";
    case QAccessible::Cell: return "DataItem";
    case QAccessible::Link: return "Hyperlink";
    case QAccessible::List: return "List";
    case QAccessible::ListItem: return "ListItem";
    case QAccessible::Tree: return "Tree";
    case QAccessible::TreeItem: return "TreeItem";
    case QAccessible::PageTab: return "TabItem";
    case QAccessible::Graphic: return "Image";
    case QAccessible::StaticText: case QAccessible::Paragraph: case QAccessible::Heading: return "Text";
    case QAccessible::EditableText:
        return QGuiApplication::testAttribute(Qt::AA_DisableNativeVirtualKeyboard)
            || customInputContext ? "Text" : "Edit";
    case QAccessible::Button: case QAccessible::ButtonDropDown: case QAccessible::ButtonMenu:
    case QAccessible::ButtonDropGrid: return "Button";
    case QAccessible::CheckBox: return "CheckBox";
    case QAccessible::RadioButton: return "RadioButton";
    case QAccessible::ComboBox: return "ComboBox";
    case QAccessible::ProgressBar: return "ProgressBar";
    case QAccessible::Slider: return "Slider";
    case QAccessible::SpinBox: return "Spinner";
    case QAccessible::PageTabList: return "Tab";
    default: return "Custom";
    }
}
