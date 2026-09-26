#include "sleepobserver.h"

#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusReply>
#include <QDBusUnixFileDescriptor>
#include <QObject>
#include <QSet>
#include <QTimer>

namespace {

// logind announces sleep with PrepareForSleep(true), but only waits for
// programs that hold a delay lock. Kino holds one while it runs, releases it
// once playback has paused, and takes a new one after waking.
class LogindSleep : public QObject {
    Q_OBJECT
public:
    explicit LogindSleep(std::function<void()> willSleep) : willSleep_(std::move(willSleep)) {
        // mpv pauses on its own thread. Asking it to is not the same as having
        // paused, and the machine must not sleep in between; a player that
        // never answers still lets it go well inside logind's own limit.
        fallback_.setSingleShot(true);
        fallback_.setInterval(2'000);
        connect(&fallback_, &QTimer::timeout, this, &LogindSleep::ready);
        QDBusConnection bus = QDBusConnection::systemBus();
        if (!bus.isConnected()) {
            qWarning("[kino:sleep] sleep notice unavailable reason=no-system-bus");
            return;
        }
        bus.connect(QStringLiteral("org.freedesktop.login1"),
                    QStringLiteral("/org/freedesktop/login1"),
                    QStringLiteral("org.freedesktop.login1.Manager"),
                    QStringLiteral("PrepareForSleep"), this, SLOT(prepareForSleep(bool)));
        takeLock();
    }

    void deliver() { prepareForSleep(true); }

    // Closing the descriptor tells logind this program is ready. Outside a
    // sleep there is nothing to release: the lock is the next sleep's.
    void ready() {
        if (!preparing_) return;
        preparing_ = false;
        fallback_.stop();
        lock_ = QDBusUnixFileDescriptor();
    }

public slots:
    void prepareForSleep(bool starting) {
        if (!starting) {
            ready();
            takeLock();
            return;
        }
        preparing_ = true;
        fallback_.start();
        willSleep_();
    }

private:
    void takeLock() {
        QDBusMessage inhibit = QDBusMessage::createMethodCall(
            QStringLiteral("org.freedesktop.login1"), QStringLiteral("/org/freedesktop/login1"),
            QStringLiteral("org.freedesktop.login1.Manager"), QStringLiteral("Inhibit"));
        inhibit << QStringLiteral("sleep") << QStringLiteral("Kino")
                << QStringLiteral("Pause playback before sleep") << QStringLiteral("delay");
        const QDBusReply<QDBusUnixFileDescriptor> reply =
            QDBusConnection::systemBus().call(inhibit, QDBus::Block, 2'000);
        if (reply.isValid()) {
            lock_ = reply.value();
        } else {
            qWarning("[kino:sleep] sleep delay lock unavailable");
        }
    }

    std::function<void()> willSleep_;
    QDBusUnixFileDescriptor lock_;
    QTimer fallback_;
    bool preparing_ = false;
};

QSet<LogindSleep *> &observers() {
    static QSet<LogindSleep *> live;
    return live;
}

} // namespace

SleepObserver::SleepObserver(std::function<void()> willSleep) {
    auto *observer = new LogindSleep(std::move(willSleep));
    observers().insert(observer);
    token_ = observer;
}

SleepObserver::~SleepObserver() {
    auto *observer = static_cast<LogindSleep *>(token_);
    observers().remove(observer);
    delete observer;
}

void SleepObserver::readyToSleep() { static_cast<LogindSleep *>(token_)->ready(); }

void postWillSleepForProbe() {
    for (LogindSleep *observer : observers()) observer->deliver();
}

#include "sleepobserver_linux.moc"
