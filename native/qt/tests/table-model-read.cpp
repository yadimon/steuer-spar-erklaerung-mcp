#include <QtWidgets/QApplication>
#include <QtGui/QAccessible>
#include <QtGui/QStandardItemModel>
#include <iostream>
#include <functional>
#include <nlohmann/json.hpp>
using Json = nlohmann::json;
#include "../bridge-table-model-read.h"

static void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
static void rejects(const std::function<void()> &call, const char *message) {
    bool rejected = false;
    try { call(); } catch (const std::runtime_error &) { rejected = true; }
    require(rejected, message);
}
class ActivationObserver : public QAccessible::ActivationObserver {
public:
    unsigned int changes = 0;
    ActivationObserver() { QAccessible::installActivationObserver(this); }
    ~ActivationObserver() override { QAccessible::removeActivationObserver(this); }
    void accessibilityActiveChanged(bool) override { ++changes; }
};
class ChangingModel : public QStandardItemModel {
public:
    mutable std::function<void()> change;
    mutable unsigned int displayReads = 0, editReads = 0;
    explicit ChangingModel(QObject *parent) : QStandardItemModel(4, 7, parent) {}
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override {
        if (index.row() == 0 && index.column() == 0 && role == Qt::DisplayRole) ++displayReads;
        if (index.row() == 0 && index.column() == 0 && role == Qt::EditRole) ++editReads;
        if (index.row() == 0 && index.column() == 0 && role == Qt::DisplayRole && change) {
            auto once = std::move(change); change = {}; once();
        }
        return QStandardItemModel::data(index, role);
    }
};
class InvalidIndexModel : public QStandardItemModel {
public:
    explicit InvalidIndexModel(QObject *parent) : QStandardItemModel(4, 7, parent) {}
    QModelIndex index(int row, int column, const QModelIndex &parent = QModelIndex()) const override {
        return row == 1 && column == 1 ? QModelIndex() : QStandardItemModel::index(row, column, parent);
    }
};
class FetchableModel : public QStandardItemModel {
public:
    explicit FetchableModel(QObject *parent) : QStandardItemModel(4, 7, parent) {}
    bool canFetchMore(const QModelIndex &) const override { return true; }
};
static QStandardItemModel *makeModel(QTableView *view, unsigned int generation) {
    auto *model = new QStandardItemModel(4, 7, view);
    for (int column = 0; column < 7; ++column) model->setHeaderData(column, Qt::Horizontal, QString("Column %1").arg(column));
    for (int row = 0; row < 4; ++row) for (int column = 0; column < 7; ++column)
        model->setData(model->index(row, column), QString("passive-%1-row-%2-cell-%3").arg(generation).arg(row).arg(column));
    for (int column = 0; column < 3; ++column) {
        model->item(0, column)->setCheckable(true);
        model->item(0, column)->setCheckState(column == 0 ? Qt::Unchecked : column == 1 ? Qt::Checked : Qt::PartiallyChecked);
    }
    model->setData(model->index(3, 6), QString());
    view->setModel(model); view->setColumnHidden(5, true); view->setRowHidden(2, true);
    return model;
}
static void checkRead(const Json &result, unsigned int generation) {
    require(result.at("ok") == true && result.at("complete") == true && result.at("canFetchMore") == false, "Complete model read failed");
    require(result.at("rows") == 4 && result.at("columns") == 7 && result.at("readRows") == 4, "Full model dimensions changed");
    require(result.at("hiddenRows") == Json::array({2}) && result.at("hiddenColumns") == Json::array({5}), "Hidden model coordinates were lost");
    for (int row = 0; row < 4; ++row) {
        for (int column = 0; column < 7; ++column) {
            const auto expected = row == 3 && column == 6 ? std::string()
                : QString("passive-%1-row-%2-cell-%3").arg(generation).arg(row).arg(column).toStdString();
            const auto &cell = result.at("values").at(row).at(column);
            require(cell.at("display") == expected && cell.at("edit") == expected, "A fresh cell role was lost or stale");
            require(cell.at("flags").is_number_integer(), "Model flags are absent");
            const auto check = row == 0 && column < 3 ? Json(column == 0 ? 0 : column == 1 ? 2 : 1) : Json(nullptr);
            require(cell.at("checkState") == check, "Checkbox roles were lost");
        }
        require(result.at("rowFingerprints").at(row) == cellsFingerprint(result.at("values").at(row)), "Row fingerprint does not include the actual full row");
    }
    for (int column = 0; column < 7; ++column)
        require(result.at("headers").at(column) == QString("Column %1").arg(column).toStdString(), "Header role was lost");
}
int main(int argc, char **argv) {
    QApplication app(argc, argv);
    ActivationObserver observer;
    require(!QAccessible::isActive(), "Offscreen precondition: accessibility must start inactive");
    auto *page = new QWidget;
    QPointer<QTableView> view = new QTableView(page);
    unsigned int generation = 1;
    makeModel(view, generation);
    const auto initial = tableModelRead(view, Json::object());
    for (int repeat = 0; repeat < 8; ++repeat) {
        checkRead(tableModelRead(view, Json::object()), generation);
        require(tableModelRead(view, Json::object()) == initial, "Stable reads changed model evidence");
    }
    for (int repeat = 0; repeat < 16; ++repeat) {
        QPointer<QAbstractItemModel> oldModel = view->model();
        makeModel(view, ++generation); delete oldModel.data();
        require(oldModel.isNull(), "Prior model survived its intentional destruction");
        checkRead(tableModelRead(view, Json::object()), generation);
    }
    for (int repeat = 0; repeat < 16; ++repeat) {
        QPointer<QTableView> oldView = view;
        QPointer<QAbstractItemModel> oldModel = view->model();
        delete page;
        require(oldView.isNull() && oldModel.isNull(), "Prior page/model survived its intentional destruction");
        page = new QWidget; view = new QTableView(page);
        makeModel(view, ++generation);
        checkRead(tableModelRead(view, Json::object()), generation);
    }
    const auto partial = tableModelRead(view, {{"maxRows", 2}, {"allowPartial", true}});
    require(partial.at("complete") == false && partial.at("readRows") == 2 && partial.at("rows") == 4, "Partial read falsely became complete");
    rejects([&] { tableModelRead(view, {{"maxRows", 2}}); }, "Unpermitted truncation was accepted");
    rejects([&] { tableModelRead(view, {{"maxColumns", 6}}); }, "Column bound was ignored");
    rejects([&] { tableModelRead(view, {{"maxRows", 0}}); }, "Invalid row bound was ignored");
    rejects([&] { tableModelRead(nullptr, Json::object()); }, "Missing view was accepted");
    view->setModel(nullptr);
    rejects([&] { tableModelRead(view, Json::object()); }, "Missing model was accepted");
    view->setModel(new InvalidIndexModel(view));
    rejects([&] { tableModelRead(view, Json::object()); }, "Invalid model index was accepted");
    view->setModel(new FetchableModel(view));
    require(tableModelRead(view, Json::object()).at("complete") == false, "Fetchable model falsely became complete");
    auto *dimensions = new ChangingModel(view); view->setModel(dimensions);
    dimensions->change = [dimensions] { dimensions->insertRow(4); };
    rejects([&] { tableModelRead(view, Json::object()); }, "Changing model dimensions were accepted");
    auto *replacement = new ChangingModel(view); view->setModel(replacement);
    replacement->change = [&] { makeModel(view, ++generation); };
    rejects([&] { tableModelRead(view, Json::object()); }, "Mid-read replacement model was accepted");
    require(replacement->displayReads == 1 && replacement->editReads == 0, "Replacement did not stop before another old-model role callback");
    auto *changed = new ChangingModel(view); view->setModel(changed);
    changed->change = [changed] { changed->setData(changed->index(1, 0), "Changed during read"); };
    rejects([&] { tableModelRead(view, Json::object()); }, "Mid-read data invalidation was accepted");
    require(changed->editReads == 0, "Data invalidation did not stop before another role callback");
    require(!QAccessible::isActive() && observer.changes == 0, "Passive model reads changed accessibility activation");
    delete page;
    require(!QAccessible::isActive() && observer.changes == 0, "Model/page teardown changed accessibility activation");
    std::cout << "Native passive model isolation: stable reads, replacements and negative guards passed\n";
}
