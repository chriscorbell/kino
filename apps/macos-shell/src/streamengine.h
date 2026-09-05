#pragma once

#include <QObject>
#include <QFuture>
#include <QPromise>
#include <QProcess>
#include <QString>
#include <QTimer>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>
#include <memory>

// Supervises the bundled kino-stream-engine helper. The helper is optional:
// when it is absent or fails, `error` explains why and torrent sources stay
// unavailable rather than failing silently mid-playback.
class StreamEngine : public QObject {
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(QString error READ error NOTIFY changed)
    Q_PROPERTY(QString url READ url NOTIFY changed)
public:
    explicit StreamEngine(QObject *parent = nullptr);
    ~StreamEngine() override;

    QString error() const;
    QString url() const;
    QVariantMap diagnosticInfo() const;

    Q_INVOKABLE void start();

    // Diagnostics holds this barrier until deletion completes. Starts requested
    // in the meantime are resumed only after the cache is safe to use again.
    QFuture<bool> stopForCacheClear();
    bool preserveConfiguration(const QString &cacheRoot = {});
    void finishCacheClear();

signals:
    void changed();

private:
    void fail(const QString &reason);
    void readReadyLine();
    void readDiagnostics();
    void consumeDiagnostics(const QByteArray &bytes);
    void completeStop(bool stopped);

    QProcess process_;
    QTimer startupDeadline_;
    QTimer stopDeadline_;
    std::unique_ptr<QPromise<bool>> stopPromise_;
    QString pendingFailure_;
    QString error_;
    QString url_;
    QByteArray diagnosticBuffer_;
    bool droppingDiagnostic_ = false;
    bool clearingCache_ = false;
    bool restartRequested_ = false;
};
