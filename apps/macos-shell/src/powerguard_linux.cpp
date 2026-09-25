#include "powerguard.h"

#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusObjectPath>
#include <QDBusReply>
#include <QVariantMap>

namespace {

constexpr int kCallTimeoutMs = 2'000;
const QString kReason = QStringLiteral("Kino video playback");

} // namespace

struct PowerGuard::State {
    bool active = false;
    // The desktop portal answers Inhibit with a request object, and closing
    // that request ends the inhibition. It works inside a Flatpak sandbox too.
    QString portalRequest;
    // Without a portal, the older screensaver service hands out a cookie.
    uint screensaverCookie = 0;
};

PowerGuard::PowerGuard() : state_(std::make_unique<State>()) {}

PowerGuard::~PowerGuard() {
    setActive(false);
}

void PowerGuard::setActive(bool active) {
    State &state = *state_;
    if (active == state.active) {
        return;
    }
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (active) {
        if (!bus.isConnected()) {
            qWarning("[kino:power] sleep inhibition unavailable reason=no-session-bus");
            return;
        }
        QDBusMessage portal = QDBusMessage::createMethodCall(
            QStringLiteral("org.freedesktop.portal.Desktop"),
            QStringLiteral("/org/freedesktop/portal/desktop"),
            QStringLiteral("org.freedesktop.portal.Inhibit"), QStringLiteral("Inhibit"));
        // Flag 8 inhibits idle: the session neither blanks nor suspends while
        // nobody touches the keyboard or mouse.
        portal << QString() << 8u << QVariantMap{{QStringLiteral("reason"), kReason}};
        const QDBusReply<QDBusObjectPath> request = bus.call(portal, QDBus::Block, kCallTimeoutMs);
        if (request.isValid()) {
            state.portalRequest = request.value().path();
        } else {
            QDBusMessage screensaver = QDBusMessage::createMethodCall(
                QStringLiteral("org.freedesktop.ScreenSaver"),
                QStringLiteral("/org/freedesktop/ScreenSaver"),
                QStringLiteral("org.freedesktop.ScreenSaver"), QStringLiteral("Inhibit"));
            screensaver << QStringLiteral("Kino") << kReason;
            const QDBusReply<uint> cookie = bus.call(screensaver, QDBus::Block, kCallTimeoutMs);
            if (!cookie.isValid()) {
                qWarning("[kino:power] sleep inhibition unavailable reason=no-inhibitor");
                return;
            }
            state.screensaverCookie = cookie.value();
        }
        state.active = true;
        qInfo("[kino:power] display sleep prevented while video plays");
        return;
    }
    if (!state.portalRequest.isEmpty()) {
        bus.send(QDBusMessage::createMethodCall(
            QStringLiteral("org.freedesktop.portal.Desktop"), state.portalRequest,
            QStringLiteral("org.freedesktop.portal.Request"), QStringLiteral("Close")));
        state.portalRequest.clear();
    } else {
        QDBusMessage release = QDBusMessage::createMethodCall(
            QStringLiteral("org.freedesktop.ScreenSaver"),
            QStringLiteral("/org/freedesktop/ScreenSaver"),
            QStringLiteral("org.freedesktop.ScreenSaver"), QStringLiteral("UnInhibit"));
        release << state.screensaverCookie;
        bus.send(release);
        state.screensaverCookie = 0;
    }
    state.active = false;
    qInfo("[kino:power] display sleep allowed");
}
