#pragma once

#include <QObject>
#include <QProcess>
#include <QString>
#include <QtQml/qqmlregistration.h>

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

    Q_INVOKABLE void start();

signals:
    void changed();

private:
    void fail(const QString &reason);
    void readReadyLine();
    void readDiagnostics();
    void consumeDiagnostics(const QByteArray &bytes);

    QProcess process_;
    QString error_;
    QString url_;
    QByteArray diagnosticBuffer_;
    bool droppingDiagnostic_ = false;
};
