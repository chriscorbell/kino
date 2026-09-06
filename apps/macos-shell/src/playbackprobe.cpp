#include "playbackprobe.h"

#include "mpvitem.h"

#include <QCoreApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QQuickWindow>
#include <QVariantList>

#include <cstdio>
#include <memory>

namespace {

// Enough playback to prove sustained decoding, comfortably past the point
// where the hardware-decoder stall timer would have rejected the source.
constexpr qlonglong kRequiredPlaybackMs = 2'500;
constexpr int kTimeoutMs = 30'000;

} // namespace

PlaybackProbe::PlaybackProbe(MpvItem *player, const QString &mediaPath,
                             const QString &subtitlesPath, QObject *parent)
    : QObject(parent), player_(player), mediaPath_(mediaPath), subtitlesPath_(subtitlesPath) {
    timeout_.setInterval(kTimeoutMs);
    timeout_.setSingleShot(true);
    connect(&timeout_, &QTimer::timeout, this, [this]() { finish(QStringLiteral("timeout")); });
    connect(player_, &MpvItem::playerEvent, this, &PlaybackProbe::onPlayerEvent);
}

void PlaybackProbe::start() {
    timeout_.start();
    QQuickWindow *window = player_->window();
    if (!window) {
        player_->load(mediaPath_, false);
        return;
    }
    // mpv's render context is created on the scene graph's first frame; loading
    // before that leaves the player without a video output.
    auto connection = std::make_shared<QMetaObject::Connection>();
    *connection = connect(window, &QQuickWindow::frameSwapped, this,
                          [this, connection]() {
                              QObject::disconnect(*connection);
                              player_->load(mediaPath_, false);
                          });
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
    } else if (name == QLatin1String("ended")) {
        finish(QStringLiteral("ended"));
        return;
    }
    evaluate();
}

void PlaybackProbe::evaluate() {
    if (hardwareDecoding_ && timeMs_ >= kRequiredPlaybackMs) {
        finish(QStringLiteral("played"));
    }
}

void PlaybackProbe::finish(const QString &outcome, const QString &errorCode) {
    if (finished_) {
        return;
    }
    finished_ = true;
    timeout_.stop();
    // Read the caption style from the live player before it stops, so the
    // fixture gate sees what libmpv actually held during playback.
    QJsonObject subtitleStyle;
    const QVariantMap style = player_->subtitleStyle();
    for (auto field = style.cbegin(); field != style.cend(); ++field) {
        subtitleStyle.insert(field.key(), field.value().toString());
    }
    player_->stop();

    QJsonObject result{
        {QStringLiteral("chapters"), chapterCount_},
        {QStringLiteral("outcome"), outcome},
        {QStringLiteral("subtitleStyle"), subtitleStyle},
        {QStringLiteral("subtitleTracks"), subtitleTracks_},
        {QStringLiteral("timeMs"), timeMs_},
    };
    if (!errorCode.isEmpty()) {
        result.insert(QStringLiteral("errorCode"), errorCode);
    }
    const QByteArray line = QJsonDocument(result).toJson(QJsonDocument::Compact);
    std::printf("KINO_PROBE_RESULT %s\n", line.constData());
    std::fflush(stdout);
    QCoreApplication::exit(0);
}
