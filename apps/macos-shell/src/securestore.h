#pragma once

#include <QFuture>
#include <QObject>
#include <QString>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

class SecureStore : public QObject {
    Q_OBJECT
    QML_ELEMENT
public:
    using QObject::QObject;

    Q_INVOKABLE QFuture<bool> clearStremioAuth();
    Q_INVOKABLE QFuture<QVariantMap> readStremioAuth();
    Q_INVOKABLE QFuture<bool> writeStremioAuth(const QString &value);
};
