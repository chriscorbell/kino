#include "nowplaying.h"

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusObjectPath>
#include <QDBusPendingCall>
#include <QDBusVariant>
#include <QDeadlineTimer>
#include <QProcess>
#include <QSignalSpy>
#include <QTest>

// Reaches Kino's MPRIS player over its own bus connection, the way a desktop's
// media keys and "now playing" panel do, on a private session bus so the test
// neither needs nor disturbs a desktop session.

namespace {

const QString kService = QStringLiteral("org.mpris.MediaPlayer2.kino");
const QString kPath = QStringLiteral("/org/mpris/MediaPlayer2");
const QString kRoot = QStringLiteral("org.mpris.MediaPlayer2");
const QString kPlayer = QStringLiteral("org.mpris.MediaPlayer2.Player");
constexpr qlonglong kMicroseconds = 1'000'000;

} // namespace

class NowPlayingMprisTest : public QObject {
    Q_OBJECT

private slots:
    void initTestCase() {
        bus_.start(QStringLiteral("dbus-daemon"),
                   {QStringLiteral("--session"), QStringLiteral("--nofork"),
                    QStringLiteral("--print-address=1")});
        QVERIFY2(bus_.waitForStarted(), "dbus-daemon runs the private session bus this test needs");
        QTRY_VERIFY_WITH_TIMEOUT(bus_.canReadLine(), 5000);
        qputenv("DBUS_SESSION_BUS_ADDRESS", bus_.readLine().trimmed());
        QVERIFY(QDBusConnection::sessionBus().isConnected());
        QVERIFY(client().isConnected());
    }

    void cleanupTestCase() {
        QDBusConnection::disconnectFromBus(QStringLiteral("desktop"));
        bus_.kill();
        bus_.waitForFinished();
    }

    void anIdlePlayerReportsStopped() {
        NowPlaying nowPlaying;
        QCOMPARE(property(kRoot, QStringLiteral("Identity")).toString(), QStringLiteral("Kino"));
        QCOMPARE(property(kPlayer, QStringLiteral("PlaybackStatus")).toString(), QStringLiteral("Stopped"));
        QCOMPARE(property(kPlayer, QStringLiteral("CanPause")).toBool(), false);
        QVERIFY(metadata().isEmpty());

        QSignalSpy toggled(&nowPlaying, &NowPlaying::toggleRequested);
        QVERIFY(call(QStringLiteral("PlayPause")).type() == QDBusMessage::ReplyMessage);
        QTest::qWait(50);
        QCOMPARE(toggled.count(), 0);
    }

    void playbackIsPublished() {
        NowPlaying nowPlaying;
        QSignalSpy changed(this, &NowPlayingMprisTest::propertiesChanged);
        QVERIFY(client().connect(kService, kPath, QStringLiteral("org.freedesktop.DBus.Properties"),
                                 QStringLiteral("PropertiesChanged"), this,
                                 SIGNAL(propertiesChanged(QString, QVariantMap, QStringList))));
        nowPlaying.setMetadata(QStringLiteral("Film"), QStringLiteral("Season 1"));
        nowPlaying.setDuration(120);
        nowPlaying.setPosition(30);
        nowPlaying.setPaused(false);
        nowPlaying.setActive(true);

        QTRY_VERIFY_WITH_TIMEOUT(!changed.isEmpty(), 5000);
        QCOMPARE(changed.last().at(1).toMap().value(QStringLiteral("PlaybackStatus")).toString(),
                 QStringLiteral("Playing"));
        QCOMPARE(property(kPlayer, QStringLiteral("PlaybackStatus")).toString(), QStringLiteral("Playing"));
        QCOMPARE(property(kPlayer, QStringLiteral("CanPause")).toBool(), true);
        const QVariantMap now = metadata();
        QCOMPARE(now.value(QStringLiteral("xesam:title")).toString(), QStringLiteral("Film"));
        QCOMPARE(now.value(QStringLiteral("xesam:artist")).toStringList(), QStringList{QStringLiteral("Season 1")});
        QCOMPARE(now.value(QStringLiteral("mpris:length")).toLongLong(), 120 * kMicroseconds);
        const qlonglong position = property(kPlayer, QStringLiteral("Position")).toLongLong();
        QVERIFY2(position >= 30 * kMicroseconds && position < 32 * kMicroseconds,
                 qPrintable(QString::number(position)));

        changed.clear();
        nowPlaying.setPaused(true);
        QTRY_VERIFY_WITH_TIMEOUT(!changed.isEmpty(), 5000);
        QCOMPARE(property(kPlayer, QStringLiteral("PlaybackStatus")).toString(), QStringLiteral("Paused"));

        nowPlaying.setActive(false);
        QCOMPARE(property(kPlayer, QStringLiteral("PlaybackStatus")).toString(), QStringLiteral("Stopped"));
        QVERIFY(metadata().isEmpty());
    }

    void controlsReachThePlayer() {
        NowPlaying nowPlaying;
        nowPlaying.setDuration(120);
        nowPlaying.setPosition(30);
        nowPlaying.setActive(true);
        QSignalSpy toggled(&nowPlaying, &NowPlaying::toggleRequested);
        QSignalSpy played(&nowPlaying, &NowPlaying::playRequested);
        QSignalSpy paused(&nowPlaying, &NowPlaying::pauseRequested);
        QSignalSpy sought(&nowPlaying, &NowPlaying::seekRequested);

        call(QStringLiteral("PlayPause"));
        QCOMPARE(toggled.count(), 1);
        call(QStringLiteral("Play"));
        QCOMPARE(played.count(), 1);
        call(QStringLiteral("Pause"));
        QCOMPARE(paused.count(), 1);
        // Kino's player has no stop that forgets the viewer's place.
        call(QStringLiteral("Stop"));
        QCOMPARE(paused.count(), 2);

        call(QStringLiteral("Seek"), {qlonglong(10 * kMicroseconds)});
        QCOMPARE(sought.count(), 1);
        QCOMPARE(qRound(sought.last().at(0).toDouble()), 40);
    }

    // SetPosition names the track it was meant for, so a request that crosses
    // a change of title is dropped rather than applied to the next one.
    void setPositionNeedsTheCurrentTrack() {
        NowPlaying nowPlaying;
        nowPlaying.setMetadata(QStringLiteral("Film"), QString());
        nowPlaying.setDuration(120);
        nowPlaying.setActive(true);
        QSignalSpy sought(&nowPlaying, &NowPlaying::seekRequested);
        const auto track = metadata().value(QStringLiteral("mpris:trackid")).value<QDBusObjectPath>();
        QVERIFY(!track.path().isEmpty());

        call(QStringLiteral("SetPosition"), {QVariant::fromValue(track), qlonglong(60 * kMicroseconds)});
        QCOMPARE(sought.count(), 1);
        QCOMPARE(sought.last().at(0).toDouble(), 60.0);

        nowPlaying.setMetadata(QStringLiteral("Next film"), QString());
        call(QStringLiteral("SetPosition"), {QVariant::fromValue(track), qlonglong(90 * kMicroseconds)});
        QCOMPARE(sought.count(), 1);
    }

signals:
    void propertiesChanged(const QString &interface, const QVariantMap &changed, const QStringList &invalidated);

private:
    // A second connection stands in for the desktop: calls from it cross the
    // bus exactly as a media key's do.
    static QDBusConnection client() {
        return QDBusConnection::connectToBus(QDBusConnection::SessionBus, QStringLiteral("desktop"));
    }

    // The player answers on this thread, so a blocking call would wait on
    // itself; the event loop runs until the reply arrives instead.
    static QDBusMessage send(const QDBusMessage &message) {
        QDBusPendingCall pending = client().asyncCall(message);
        const QDeadlineTimer deadline(5000);
        while (!pending.isFinished() && !deadline.hasExpired()) QTest::qWait(5);
        return pending.reply();
    }

    static QDBusMessage call(const QString &method, const QVariantList &arguments = {}) {
        QDBusMessage message = QDBusMessage::createMethodCall(kService, kPath, kPlayer, method);
        message.setArguments(arguments);
        const QDBusMessage reply = send(message);
        QTest::qWait(20);
        return reply;
    }

    static QVariant property(const QString &interface, const QString &name) {
        QDBusMessage message = QDBusMessage::createMethodCall(
            kService, kPath, QStringLiteral("org.freedesktop.DBus.Properties"), QStringLiteral("Get"));
        message << interface << name;
        const QDBusMessage reply = send(message);
        if (reply.type() != QDBusMessage::ReplyMessage || reply.arguments().isEmpty()) return {};
        return reply.arguments().constFirst().value<QDBusVariant>().variant();
    }

    static QVariantMap metadata() {
        const QVariant value = property(kPlayer, QStringLiteral("Metadata"));
        if (!value.canConvert<QDBusArgument>()) return {};
        return qdbus_cast<QVariantMap>(value.value<QDBusArgument>());
    }

    QProcess bus_;
};

QTEST_GUILESS_MAIN(NowPlayingMprisTest)
#include "nowplaying_mpris_test.moc"
