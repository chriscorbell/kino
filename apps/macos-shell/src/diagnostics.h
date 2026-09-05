#pragma once

#include <QFuture>
#include <QObject>
#include <QtQml/qqmlregistration.h>

// Device-local diagnostic and storage actions. Logs never leave the device on
// their own; revealing them in Finder is a deliberate user action.
class Diagnostics : public QObject {
    Q_OBJECT
    QML_ELEMENT
public:
    using QObject::QObject;

    Q_INVOKABLE QFuture<qlonglong> cacheBytes();
    Q_INVOKABLE QFuture<bool> clearCache();
    Q_INVOKABLE bool revealLogs();
    Q_INVOKABLE void logWebMessage(int level, const QString &message);
};
