#pragma once

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

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
    void publish();

    bool active_ = false;
    bool paused_ = true;
    double duration_ = 0;
    double position_ = 0;
    double publishedPosition_ = 0;
    double publishedUptime_ = 0;
    QString subtitle_;
    QString title_;
};
