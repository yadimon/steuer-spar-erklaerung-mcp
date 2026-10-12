#pragma once
#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>
#include <QtCore/QAbstractItemModel>
#include <QtCore/QCryptographicHash>
#include <QtCore/QPointer>
#include <QtCore/QVariant>
#include <QtWidgets/QTableView>

// Model reads need neither accessibility activation nor a cursor interface.
// Window, controller and QObject authority remain the caller's responsibility.
static Json variant(const QVariant &v) {
    if (!v.isValid() || v.isNull()) return nullptr;
    switch (v.metaType().id()) {
    case QMetaType::Bool: return v.toBool();
    case QMetaType::Int: case QMetaType::LongLong: case QMetaType::Short: return v.toLongLong();
    case QMetaType::UInt: case QMetaType::ULongLong: case QMetaType::UShort: return v.toULongLong();
    case QMetaType::Double: case QMetaType::Float: return v.toDouble();
    default: return v.toString().toUtf8().toStdString();
    }
}
static std::string cellsFingerprint(const Json &values) {
    return QCryptographicHash::hash(QByteArray::fromStdString(values.dump()), QCryptographicHash::Sha256).toHex().toStdString();
}
class TableModelReadScope {
    QPointer<QTableView> view_;
    QPointer<QAbstractItemModel> model_;
    QModelIndex rootIndex_;
    QObject lifetime_;
    bool invalidated_ = false;
public:
    explicit TableModelReadScope(QTableView *view) : view_(view) {
        if (!view_ || !view_->model()) throw std::runtime_error("Object has no QAbstractItemModel");
        model_ = view_->model(); rootIndex_ = view_->rootIndex();
        const auto invalidate = [this] { invalidated_ = true; };
        // Connections are local to this synchronous read and automatically
        // disconnected with lifetime_. No provider or application hook is used.
        QObject::connect(model_, &QAbstractItemModel::dataChanged, &lifetime_, invalidate);
        QObject::connect(model_, &QAbstractItemModel::headerDataChanged, &lifetime_, invalidate);
        QObject::connect(model_, &QAbstractItemModel::layoutAboutToBeChanged, &lifetime_, invalidate);
        QObject::connect(model_, &QAbstractItemModel::modelAboutToBeReset, &lifetime_, invalidate);
        QObject::connect(model_, &QAbstractItemModel::rowsAboutToBeInserted, &lifetime_, invalidate);
        QObject::connect(model_, &QAbstractItemModel::rowsAboutToBeRemoved, &lifetime_, invalidate);
        QObject::connect(model_, &QAbstractItemModel::rowsAboutToBeMoved, &lifetime_, invalidate);
        QObject::connect(model_, &QAbstractItemModel::columnsAboutToBeInserted, &lifetime_, invalidate);
        QObject::connect(model_, &QAbstractItemModel::columnsAboutToBeRemoved, &lifetime_, invalidate);
        QObject::connect(model_, &QAbstractItemModel::columnsAboutToBeMoved, &lifetime_, invalidate);
        QObject::connect(model_, &QObject::destroyed, &lifetime_, invalidate);
    }
    void check() const {
        if (!view_ || !model_ || invalidated_ || view_->model() != model_ || view_->rootIndex() != rootIndex_)
            throw std::runtime_error("Selected table model changed during its read");
    }
    const QModelIndex &rootIndex() const { return rootIndex_; }
    template<class Callback> auto read(Callback callback) {
        check();
        auto value = callback(model_.data());
        check();
        return value;
    }
};
static Json cellValue(TableModelReadScope &scope, const QModelIndex &index) {
    const auto data = [&](int role) { return variant(scope.read([&](QAbstractItemModel *model) { return model->data(index, role); })); };
    return {{"display", data(Qt::DisplayRole)}, {"edit", data(Qt::EditRole)}, {"checkState", data(Qt::CheckStateRole)},
        {"flags", scope.read([&](QAbstractItemModel *model) { return static_cast<int>(model->flags(index)); })}};
}
static Json tableModelRead(QTableView *selectedView, const Json &request) {
    const QPointer<QTableView> view = selectedView;
    TableModelReadScope scope(view);
    const auto rootIndex = scope.rootIndex();
    const int rows = scope.read([&](QAbstractItemModel *model) { return model->rowCount(rootIndex); });
    const int columns = scope.read([&](QAbstractItemModel *model) { return model->columnCount(rootIndex); });
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
    for (int c = 0; c < columns; ++c)
        headers.push_back(variant(scope.read([&](QAbstractItemModel *model) { return model->headerData(c, Qt::Horizontal, Qt::DisplayRole); })));
    for (int r = 0; r < readRows; ++r) {
        Json cells = Json::array();
        for (int c = 0; c < columns; ++c) {
            const auto index = scope.read([&](QAbstractItemModel *model) { return model->index(r, c, rootIndex); });
            if (!index.isValid()) throw std::runtime_error("Model returned an invalid cell index");
            cells.push_back(cellValue(scope, index));
        }
        fingerprints.push_back(cellsFingerprint(cells));
        values.push_back(std::move(cells));
    }
    if (scope.read([&](QAbstractItemModel *model) { return model->rowCount(rootIndex); }) != rows
        || scope.read([&](QAbstractItemModel *model) { return model->columnCount(rootIndex); }) != columns)
        throw std::runtime_error("Model dimensions changed during the read");
    const bool canFetchMore = scope.read([&](QAbstractItemModel *model) { return model->canFetchMore(rootIndex); });
    return {{"ok", true}, {"rows", rows}, {"columns", columns}, {"headers", std::move(headers)},
        {"hiddenColumns", std::move(hiddenColumns)}, {"hiddenRows", std::move(hiddenRows)},
        {"values", std::move(values)}, {"rowFingerprints", std::move(fingerprints)},
        {"readRows", readRows}, {"canFetchMore", canFetchMore}, {"complete", readRows == rows && !canFetchMore}};
}
