#include "playbackprobe.h"

#include "displaymode.h"
#include "mpvitem.h"
#include "sleepobserver.h"

#include <QCoreApplication>
#include <QGuiApplication>
#include <QScreen>
#include <QJsonDocument>
#include <QJsonObject>
#include <QQuickWindow>
#include <QColor>
#include <QImage>
#include <QVariantList>

#include <algorithm>

#include <cstdio>

#if defined(Q_OS_LINUX)
#include <time.h>
#endif

namespace {

// Enough playback to prove sustained decoding, comfortably past the point
// where the hardware-decoder stall timer would have rejected the source.
constexpr qlonglong kRequiredPlaybackMs = 2'500;
// Long enough for the loudness probe's final passage to settle the gain.
constexpr qlonglong kRequiredStereoPlaybackMs = 15'000;
constexpr int kTimeoutMs = 30'000;
// A real sleep and wake takes the system's own time.
constexpr int kSystemSleepTimeoutMs = 120'000;

// How long the machine has been asleep since boot: the boot clock counts
// suspended time and the monotonic clock does not. Only Linux runs the real
// sleep check.
qint64 asleepMs() {
#if defined(Q_OS_LINUX)
    timespec boot{};
    timespec monotonic{};
    clock_gettime(CLOCK_BOOTTIME, &boot);
    clock_gettime(CLOCK_MONOTONIC, &monotonic);
    return qint64(boot.tv_sec - monotonic.tv_sec) * 1000 + (boot.tv_nsec - monotonic.tv_nsec) / 1'000'000;
#else
    return 0;
#endif
}

} // namespace

PlaybackProbe::PlaybackProbe(MpvItem *player, const QString &mediaPath,
                             const QString &subtitlesPath, QObject *parent)
    : QObject(parent), sleepCheck_(qEnvironmentVariableIsSet("KINO_PLAYBACK_PROBE_SLEEP")),
      systemSleep_(qEnvironmentVariable("KINO_PLAYBACK_PROBE_SLEEP") == QLatin1String("system")),
      stereoCheck_(qEnvironmentVariableIsSet("KINO_PLAYBACK_PROBE_STEREO")),
      frameCheck_(qEnvironmentVariableIsSet("KINO_PLAYBACK_PROBE_FRAME")),
      matchCheck_(qEnvironmentVariableIsSet("KINO_PLAYBACK_PROBE_MATCH")),
      player_(player), mediaPath_(mediaPath), subtitlesPath_(subtitlesPath) {
    timeout_.setInterval(kTimeoutMs);
    timeout_.setSingleShot(true);
    connect(&timeout_, &QTimer::timeout, this, [this]() { finish(QStringLiteral("timeout")); });
    connect(player_, &MpvItem::playerEvent, this, &PlaybackProbe::onPlayerEvent);
}

void PlaybackProbe::start() {
    timeout_.start();
    if (matchCheck_) {
        // On a Mac with several displays the window could open on any of them; the primary one
        // is the same display on every run.
        if (QQuickWindow *window = player_->window()) {
            window->setScreen(QGuiApplication::primaryScreen());
            window->setPosition(QGuiApplication::primaryScreen()->availableGeometry().topLeft() +
                                QPoint(40, 40));
        }
        refreshBefore_ = DisplayModeMatcher::refreshRate(player_->window());
        player_->setMatchFrameRate(true);
    }
    player_->load(mediaPath_, stereoCheck_);
}

void PlaybackProbe::onPlayerEvent(const QString &name, const QVariantMap &payload) {
    if (finished_) {
        return;
    }
    if (name == QLatin1String("error")) {
        finish(QStringLiteral("failed"), payload.value(QStringLiteral("code")).toString());
        return;
    }
    if (name == QLatin1String("time")) {
        timeMs_ = payload.value(QStringLiteral("milliseconds")).toLongLong();
    } else if (name == QLatin1String("hardwareDecoding")) {
        hardwareDecoding_ = payload.value(QStringLiteral("active")).toBool();
    } else if (name == QLatin1String("chapters")) {
        chapterCount_ = payload.value(QStringLiteral("items")).toList().size();
    } else if (name == QLatin1String("subtitleTracks")) {
        subtitleTracks_ = QJsonArray();
        const QVariantList items = payload.value(QStringLiteral("items")).toList();
        for (const QVariant &item : items) {
            const QVariantMap track = item.toMap();
            subtitleTracks_.append(QJsonObject{
                {QStringLiteral("codec"), track.value(QStringLiteral("codec")).toString()},
                {QStringLiteral("external"), track.value(QStringLiteral("external")).toBool()},
                {QStringLiteral("id"), track.value(QStringLiteral("id")).toLongLong()},
                {QStringLiteral("lang"), track.value(QStringLiteral("lang")).toString()},
            });
        }
        // Selecting a track makes libass build the renderer, so the reported
        // caption style reflects a session that actually drew subtitles.
        if (!items.isEmpty() && !subtitleSelected_) {
            subtitleSelected_ = true;
            player_->setSubtitleTrack(items.first().toMap().value(QStringLiteral("id")).toInt());
        }
    } else if (name == QLatin1String("ready")) {
        if (!subtitlesPath_.isEmpty() && !subtitlesAdded_) {
            subtitlesAdded_ = true;
            player_->addSubtitles(subtitlesPath_, QStringLiteral("Probe subtitles"),
                                  QStringLiteral("en"));
        }
    } else if (name == QLatin1String("paused") && sleepPosted_ &&
               payload.value(QStringLiteral("paused")).toBool()) {
        if (systemSleep_) asleepAtPauseMs_ = asleepMs() - asleepBeforeMs_;
        finish(QStringLiteral("paused-for-sleep"));
        return;
    } else if (name == QLatin1String("ended")) {
        finish(QStringLiteral("ended"));
        return;
    }
    evaluate();
}

void PlaybackProbe::evaluate() {
    if (sleepCheck_) {
        if (hardwareDecoding_ && timeMs_ >= 1'000 && !sleepPosted_) {
            sleepPosted_ = true;
            if (systemSleep_) {
                // The runner reads this, starts the sleep, and wakes the
                // machine; the pause must land before the machine sleeps.
                timeout_.start(kSystemSleepTimeoutMs);
                asleepBeforeMs_ = asleepMs();
                std::printf("KINO_PROBE_AWAITING_SLEEP\n");
                std::fflush(stdout);
            } else {
                postWillSleepForProbe();
            }
        }
        return;
    }
    if (frameCheck_) {
        // Pause on a decoded frame, well inside the one-second probe clip, give the
        // renderer a moment to present it, then read it.
        if (hardwareDecoding_ && timeMs_ >= 300 && !framePaused_) {
            framePaused_ = true;
            player_->setPaused(true);
            QTimer::singleShot(600, this, &PlaybackProbe::captureFrame);
        }
        return;
    }
    if (hardwareDecoding_ &&
        timeMs_ >= (stereoCheck_ ? kRequiredStereoPlaybackMs : kRequiredPlaybackMs)) {
        finish(QStringLiteral("played"));
    }
}

void PlaybackProbe::captureFrame() {
    if (finished_) return;
    QQuickWindow *window = player_->window();
    const QImage image = window ? window->grabWindow() : QImage();
    if (image.isNull()) {
        finish(QStringLiteral("frame-unavailable"));
        return;
    }
    // The probe fixture is 640x360 and the player fits it to the window.
    const double scale = std::min(image.width() / 640.0, image.height() / 360.0);
    const double left = (image.width() - 640.0 * scale) / 2;
    const double top = (image.height() - 360.0 * scale) / 2;
    auto sample = [&](int x, int y) {
        double red = 0, green = 0, blue = 0;
        int count = 0;
        const int cx = qRound(left + x * scale), cy = qRound(top + y * scale);
        for (int dy = -2; dy <= 2; ++dy) {
            for (int dx = -2; dx <= 2; ++dx) {
                const QColor color = image.pixelColor(cx + dx, cy + dy);
                red += color.redF();
                green += color.greenF();
                blue += color.blueF();
                ++count;
            }
        }
        return QJsonArray{red / count, green / count, blue / count};
    };
    // Band A: the neutral ramp. Band B: the in-gamut coloured patches.
    QJsonArray neutral;
    for (int index = 0; index < 16; ++index) neutral.append(sample(index * 40 + 20, 45));
    QJsonArray coloured;
    for (int index = 4; index < 8; ++index) coloured.append(sample(index * 80 + 40, 135));
    frame_ = QJsonObject{{QStringLiteral("neutral"), neutral}, {QStringLiteral("coloured"), coloured}};
    finish(QStringLiteral("played"));
}

void PlaybackProbe::finish(const QString &outcome, const QString &errorCode) {
    if (finished_) {
        return;
    }
    finished_ = true;
    timeout_.stop();
    // Read the caption style from the live player before it stops, so the
    // fixture gate sees what libmpv actually held during playback.
    const double playbackSpeed = player_->playbackSpeed();
    if (matchCheck_) refreshDuring_ = DisplayModeMatcher::refreshRate(player_->window());
    const QVariantMap loudness = player_->loudness();
    QJsonObject subtitleStyle;
    const QVariantMap style = player_->subtitleStyle();
    for (auto field = style.cbegin(); field != style.cend(); ++field) {
        subtitleStyle.insert(field.key(), field.value().toString());
    }
    player_->stop();

    QJsonObject refresh;
    if (matchCheck_) {
        // Every rate the display offers at its current size, so the gate can tell a display
        // that has no match from a player that did not ask for it.
        refresh = QJsonObject{{QStringLiteral("before"), refreshBefore_},
                              {QStringLiteral("during"), refreshDuring_},
                              {QStringLiteral("after"), DisplayModeMatcher::refreshRate(player_->window())},
                              {QStringLiteral("offered"), QJsonArray::fromVariantList(DisplayModeMatcher::offeredRates(player_->window()))}};
    }
    QJsonObject result{
        {QStringLiteral("refresh"), refresh},
        {QStringLiteral("chapters"), chapterCount_},
        {QStringLiteral("loudness"), QJsonObject::fromVariantMap(loudness)},
        {QStringLiteral("frame"), frame_},
        {QStringLiteral("outcome"), outcome},
        {QStringLiteral("speed"), playbackSpeed},
        {QStringLiteral("subtitleStyle"), subtitleStyle},
        {QStringLiteral("subtitleTracks"), subtitleTracks_},
        {QStringLiteral("timeMs"), timeMs_},
    };
    if (!errorCode.isEmpty()) {
        result.insert(QStringLiteral("errorCode"), errorCode);
    }
    if (systemSleep_) {
        // Zero when the pause landed before the machine slept.
        result.insert(QStringLiteral("asleepBeforePauseMs"), asleepAtPauseMs_);
    }
    const QByteArray line = QJsonDocument(result).toJson(QJsonDocument::Compact);
    std::printf("KINO_PROBE_RESULT %s\n", line.constData());
    std::fflush(stdout);
    QCoreApplication::exit(0);
}
