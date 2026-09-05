#pragma once

#include "mpvitem.h"
#include "streamengine.h"

#include <QFuture>
#include <QObject>
#include <QPointer>
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
    Q_INVOKABLE bool copyDiagnosticSummary();
    Q_INVOKABLE void logWebMessage(int level, const QString &message);

    void setSources(MpvItem *playback, StreamEngine *engine) {
        playback_ = playback;
        engine_ = engine;
    }

private:
    QPointer<MpvItem> playback_;
    QPointer<StreamEngine> engine_;
};
