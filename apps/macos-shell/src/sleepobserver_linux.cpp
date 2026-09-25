#include "sleepobserver.h"

#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusReply>
#include <QDBusUnixFileDescriptor>
#include <QObject>
#include <QSet>

namespace {

// logind announces sleep with PrepareForSleep(true), but only waits for
// programs that hold a delay lock. Kino holds one while it runs, releases it
// once playback has paused, and takes a new one after waking.
class LogindSleep : public QObject {
    Q_OBJECT
public:
    explicit LogindSleep(std::function<void()> willSleep) : willSleep_(std::move(willSleep)) {
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

public slots:
    void prepareForSleep(bool starting) {
        if (!starting) {
            takeLock();
            return;
        }
        willSleep_();
        // Closing the descriptor tells logind this program is ready.
        lock_ = QDBusUnixFileDescriptor();
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

void postWillSleepForProbe() {
    for (LogindSleep *observer : observers()) observer->deliver();
}

#include "sleepobserver_linux.moc"
