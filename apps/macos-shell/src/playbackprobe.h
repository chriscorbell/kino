#pragma once

#include <QJsonArray>
#include <QJsonObject>
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
    void captureFrame();
    void evaluate();
    void finish(const QString &outcome, const QString &errorCode = QString());

    bool finished_ = false;
    // KINO_PLAYBACK_PROBE_SLEEP: after a second of playback, deliver a system
    // will-sleep notification and expect the player to pause.
    bool sleepCheck_ = false;
    // KINO_PLAYBACK_PROBE_SLEEP=system: announce that playback is under way and
    // wait for the system's own notice, from a real sleep the runner starts.
    bool systemSleep_ = false;
    // Time the machine had spent asleep when the probe began waiting.
    qint64 asleepBeforeMs_ = 0;
    qint64 asleepAtPauseMs_ = -1;
    // The Stereo path plays long enough for the loudness gain to settle.
    bool stereoCheck_ = false;
    // The HDR gate pauses on a frame of the probe fixture and samples its patches.
    bool frameCheck_ = false;
    // KINO_PLAYBACK_PROBE_MATCH: play with Match frame rate on and record the display's refresh
    // rate before, during and after.
    bool matchCheck_ = false;
    double refreshBefore_ = 0;
    double refreshDuring_ = 0;
    bool framePaused_ = false;
    QJsonObject frame_;
    bool sleepPosted_ = false;
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
