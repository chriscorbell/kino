#pragma once

#include <QFuture>
#include <QNetworkAccessManager>
#include <QObject>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

// Browser fetch hides redirect destinations. This GET-only transport checks
// each destination before following it, without logging configured URLs.
class AddonNetwork : public QObject {
    Q_OBJECT
    QML_ELEMENT
public:
    explicit AddonNetwork(QObject *parent = nullptr) : QObject(parent), manager_(this) {}
    Q_INVOKABLE QFuture<QVariantMap> get(const QString &value);

private:
    QNetworkAccessManager manager_;
};
