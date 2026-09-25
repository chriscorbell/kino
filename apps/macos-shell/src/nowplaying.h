#pragma once

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

#include <chrono>

class NowPlaying : public QObject {
    Q_OBJECT
    QML_ELEMENT
public:
    explicit NowPlaying(QObject *parent = nullptr);
    ~NowPlaying() override;

    Q_INVOKABLE void setActive(bool active);
    Q_INVOKABLE void setDuration(double seconds);
    Q_INVOKABLE void setMetadata(const QString &title, const QString &subtitle);
    Q_INVOKABLE void setPaused(bool paused);
    Q_INVOKABLE void setPosition(double seconds);

signals:
    void pauseRequested();
    void playRequested();
    void seekRequested(double seconds);
    void toggleRequested();

private:
    // Hands the state to the system's media controls: MediaPlayer on macOS
    // and MPRIS on Linux. Windows has no media session yet.
    void publish();
    // Records what publish() just handed over, so setPosition republishes
    // only when the real position drifts from the system's projection.
    void published();
    double projectedPosition() const;

    bool active_ = false;
    bool paused_ = true;
    double duration_ = 0;
    double position_ = 0;
    double publishedPosition_ = 0;
    std::chrono::steady_clock::time_point publishedAt_;
    // The platform's media session, where it needs an object of its own.
    QObject *session_ = nullptr;
    QString subtitle_;
    QString title_;
};
