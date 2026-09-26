#include "singleinstance.h"

#include <QCryptographicHash>
#include <QLocalSocket>
#include <QStandardPaths>

namespace {

constexpr int kTimeoutMs = 1'000;
const QByteArray kActivate = QByteArrayLiteral("activate\n");
const QByteArray kAcknowledged = QByteArrayLiteral("ok\n");

QString defaultName() {
    // The socket name is visible system-wide on Unix, so it carries a hash
    // of the profile path rather than the path.
    const QByteArray path =
        QStandardPaths::writableLocation(QStandardPaths::AppDataLocation).toUtf8();
    return QStringLiteral("kino-") +
           QString::fromLatin1(QCryptographicHash::hash(path, QCryptographicHash::Sha256).toHex().left(16));
}

} // namespace

SingleInstance::SingleInstance(QString name, QObject *parent)
    : QObject(parent), name_(name.isEmpty() ? defaultName() : std::move(name)) {
    connect(&server_, &QLocalServer::newConnection, this, [this]() {
        while (QLocalSocket *client = server_.nextPendingConnection()) {
            qInfo("[kino:shell] second launch connected");
            connect(client, &QLocalSocket::disconnected, client, &QObject::deleteLater);
            connect(client, &QLocalSocket::readyRead, this, [this, client]() {
                if (!client->readAll().contains(kActivate.trimmed())) return;
                emit activationRequested();
                client->write(kAcknowledged);
                client->flush();
            });
        }
    });
}

bool SingleInstance::claim() {
    QLocalSocket other;
    other.connectToServer(name_);
    if (other.waitForConnected(kTimeoutMs)) {
        other.write(kActivate);
        other.waitForBytesWritten(kTimeoutMs);
        // Wait for the first Kino to acknowledge before leaving: Windows drops
        // what a pipe's reader has not read yet when the writer disconnects.
        const bool answered = other.waitForReadyRead(kTimeoutMs);
        other.disconnectFromServer();
        if (answered) qInfo("[kino:shell] another Kino is running; asked it to come forward");
        else qWarning("[kino:shell] another Kino is running but did not answer");
        return false;
    }
    // Nothing answered, so a socket file left by a crashed instance is stale.
    QLocalServer::removeServer(name_);
    server_.setSocketOptions(QLocalServer::UserAccessOption);
    if (!server_.listen(name_)) {
        // Without the socket a second launch cannot find this one, but this
        // one still runs normally.
        qWarning("[kino:shell] single-instance socket unavailable");
    }
    return true;
}
