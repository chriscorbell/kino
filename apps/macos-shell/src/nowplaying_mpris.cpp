#include "nowplaying.h"

#include <QCoreApplication>
#include <QDBusAbstractAdaptor>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusObjectPath>
#include <QStringList>
#include <QVariantMap>

#include <cmath>
#include <functional>

// Linux desktops read media keys, lock-screen controls and the "now playing"
// panel from MPRIS, the D-Bus interface a player exports on the session bus.

namespace {

const QString kObjectPath = QStringLiteral("/org/mpris/MediaPlayer2");
const QString kPlayerInterface = QStringLiteral("org.mpris.MediaPlayer2.Player");

constexpr qlonglong kMicroseconds = 1'000'000;

// What the player interface reports, copied from NowPlaying at each publish.
struct MprisState {
    bool active = false;
    bool paused = true;
    double duration = 0;
    QString title;
    QString subtitle;
    qulonglong track = 0;
};

class MprisRoot : public QDBusAbstractAdaptor {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.mpris.MediaPlayer2")
    Q_PROPERTY(bool CanQuit READ no)
    Q_PROPERTY(bool CanRaise READ no)
    Q_PROPERTY(bool HasTrackList READ no)
    Q_PROPERTY(QString Identity READ identity)
    Q_PROPERTY(QString DesktopEntry READ desktopEntry)
    Q_PROPERTY(QStringList SupportedUriSchemes READ none)
    Q_PROPERTY(QStringList SupportedMimeTypes READ none)

public:
    explicit MprisRoot(QObject *parent) : QDBusAbstractAdaptor(parent) {}

    bool no() const { return false; }
    QString identity() const { return QStringLiteral("Kino"); }
    QString desktopEntry() const { return QStringLiteral("kino"); }
    QStringList none() const { return {}; }

public slots:
    void Raise() {}
    void Quit() {}
};

class MprisPlayer : public QDBusAbstractAdaptor {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.mpris.MediaPlayer2.Player")
    Q_PROPERTY(QString PlaybackStatus READ playbackStatus)
    Q_PROPERTY(double Rate READ rate)
    Q_PROPERTY(double MinimumRate READ rate)
    Q_PROPERTY(double MaximumRate READ rate)
    Q_PROPERTY(QVariantMap Metadata READ metadata)
    Q_PROPERTY(qlonglong Position READ position)
    Q_PROPERTY(bool CanGoNext READ no)
    Q_PROPERTY(bool CanGoPrevious READ no)
    Q_PROPERTY(bool CanPlay READ active)
    Q_PROPERTY(bool CanPause READ active)
    Q_PROPERTY(bool CanSeek READ active)
    Q_PROPERTY(bool CanControl READ yes)

public:
    MprisPlayer(QObject *parent, NowPlaying *owner, std::function<double()> position)
        : QDBusAbstractAdaptor(parent), owner_(owner), position_(std::move(position)) {}

    MprisState state;

    QString playbackStatus() const {
        if (!state.active) return QStringLiteral("Stopped");
        return state.paused ? QStringLiteral("Paused") : QStringLiteral("Playing");
    }
    double rate() const { return 1.0; }
    bool no() const { return false; }
    bool yes() const { return true; }
    bool active() const { return state.active; }
    qlonglong position() const { return qlonglong(position_() * kMicroseconds); }

    QVariantMap metadata() const {
        if (!state.active) return {};
        QVariantMap metadata{
            {QStringLiteral("mpris:trackid"), QVariant::fromValue(trackPath())},
            {QStringLiteral("mpris:length"), qlonglong(state.duration * kMicroseconds)},
            {QStringLiteral("xesam:title"),
             state.title.isEmpty() ? QStringLiteral("Kino") : state.title},
        };
        if (!state.subtitle.isEmpty())
            metadata.insert(QStringLiteral("xesam:artist"), QStringList{state.subtitle});
        return metadata;
    }

    QDBusObjectPath trackPath() const {
        return QDBusObjectPath(QStringLiteral("/app/kino/track/%1").arg(state.track));
    }

public slots:
    void Next() {}
    void Previous() {}
    void Play() {
        if (state.active) emit owner_->playRequested();
    }
    void Pause() {
        if (state.active) emit owner_->pauseRequested();
    }
    void PlayPause() {
        if (state.active) emit owner_->toggleRequested();
    }
    // MPRIS's Stop has no counterpart in Kino's player; pausing keeps the
    // viewer's place.
    void Stop() { Pause(); }
    void Seek(qlonglong offset) {
        if (state.active) emit owner_->seekRequested(position_() + double(offset) / kMicroseconds);
    }
    void SetPosition(const QDBusObjectPath &track, qlonglong position) {
        if (state.active && track == trackPath() && position >= 0)
            emit owner_->seekRequested(double(position) / kMicroseconds);
    }
    void OpenUri(const QString &) {}

signals:
    void Seeked(qlonglong position);

private:
    NowPlaying *owner_;
    std::function<double()> position_;
};

MprisPlayer *playerOf(QObject *session) {
    return session ? session->findChild<MprisPlayer *>() : nullptr;
}

} // namespace

NowPlaying::NowPlaying(QObject *parent) : QObject(parent) {
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (!bus.isConnected()) {
        qInfo("[kino:media] media controls unavailable reason=no-session-bus");
        return;
    }
    auto *session = new QObject(this);
    new MprisRoot(session);
    new MprisPlayer(session, this, [this]() { return projectedPosition(); });
    // A second Kino takes a name of its own, as the specification asks.
    const QString name = QStringLiteral("org.mpris.MediaPlayer2.kino");
    if (!bus.registerObject(kObjectPath, session, QDBusConnection::ExportAdaptors) ||
        (!bus.registerService(name) &&
         !bus.registerService(name + QStringLiteral(".instance%1").arg(QCoreApplication::applicationPid())))) {
        qWarning("[kino:media] media controls unavailable reason=registration");
        bus.unregisterObject(kObjectPath);
        delete session;
        return;
    }
    session_ = session;
    qInfo("[kino:media] media controls registered");
}

NowPlaying::~NowPlaying() {
    if (!session_) return;
    QDBusConnection bus = QDBusConnection::sessionBus();
    bus.unregisterObject(kObjectPath);
    bus.unregisterService(QStringLiteral("org.mpris.MediaPlayer2.kino"));
    bus.unregisterService(QStringLiteral("org.mpris.MediaPlayer2.kino.instance%1")
                              .arg(QCoreApplication::applicationPid()));
}

void NowPlaying::publish() {
    MprisPlayer *player = playerOf(session_);
    if (!player) {
        published();
        return;
    }
    const double before = projectedPosition();
    MprisState &state = player->state;
    const bool newTrack = active_ && (!state.active || state.title != title_ ||
                                      state.subtitle != subtitle_);
    if (newTrack) ++state.track;
    state.active = active_;
    state.paused = paused_;
    state.duration = duration_;
    state.title = title_;
    state.subtitle = subtitle_;
    published();

    QDBusMessage changed = QDBusMessage::createSignal(
        kObjectPath, QStringLiteral("org.freedesktop.DBus.Properties"),
        QStringLiteral("PropertiesChanged"));
    changed << kPlayerInterface
            << QVariantMap{
                   {QStringLiteral("PlaybackStatus"), player->playbackStatus()},
                   {QStringLiteral("Metadata"), player->metadata()},
                   {QStringLiteral("CanPlay"), active_},
                   {QStringLiteral("CanPause"), active_},
                   {QStringLiteral("CanSeek"), active_},
               }
            << QStringList();
    QDBusConnection::sessionBus().send(changed);
    // Position is not announced through PropertiesChanged; clients follow the
    // rate and hear about jumps through Seeked.
    if (active_ && !newTrack && std::abs(position_ - before) > 2.0)
        emit player->Seeked(qlonglong(position_ * kMicroseconds));
}

#include "nowplaying_mpris.moc"
