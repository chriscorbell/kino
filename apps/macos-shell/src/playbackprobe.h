#pragma once

#include <QJsonArray>
#include <QObject>
#include <QString>
#include <QTimer>
#include <QVariantMap>

class MpvItem;

// Drives one media file through the production MpvItem and prints a single
// machine-readable verdict line for the playback fixture runner.
class PlaybackProbe : public QObject {
    Q_OBJECT
public:
    PlaybackProbe(MpvItem *player, const QString &mediaPath, const QString &subtitlesPath,
                  QObject *parent = nullptr);

    void start();

private slots:
    void onPlayerEvent(const QString &name, const QVariantMap &payload);

private:
    void evaluate();
    void finish(const QString &outcome, const QString &errorCode = QString());

    bool finished_ = false;
    bool hardwareDecoding_ = false;
    bool subtitlesAdded_ = false;
    bool subtitleSelected_ = false;
    qlonglong chapterCount_ = 0;
    qlonglong timeMs_ = 0;
    MpvItem *player_;
    QJsonArray subtitleTracks_;
    QString mediaPath_;
    QString subtitlesPath_;
    QTimer timeout_;
};
