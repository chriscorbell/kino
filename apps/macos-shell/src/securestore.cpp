#include "securestore.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>
#include <QStandardPaths>
#include <QtConcurrentRun>

namespace {

// Stremio auth lives in an owner-only file under Kino's app data instead of
// the macOS Keychain: unsigned development builds change code signature every
// rebuild, which makes Keychain re-prompt for access each time (ADR 0016).
QString authFilePath() {
    const QString dataDir =
        QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    return QDir(dataDir).absoluteFilePath(QStringLiteral("stremio-auth-v1"));
}

QVariantMap readAuth() {
    QFile file(authFilePath());
    if (!file.exists()) {
        return {{QStringLiteral("ok"), true}, {QStringLiteral("value"), QString{}}};
    }
    if (!file.open(QIODevice::ReadOnly)) {
        qWarning("[kino:authstore] read failed");
        return {{QStringLiteral("ok"), false}, {QStringLiteral("value"), QString{}}};
    }
    const QString value = QString::fromUtf8(file.readAll());
    return {{QStringLiteral("ok"), true}, {QStringLiteral("value"), value}};
}

bool writeAuth(const QString &value) {
    const QString path = authFilePath();
    if (!QDir().mkpath(QFileInfo(path).absolutePath())) {
        qWarning("[kino:authstore] data directory unavailable");
        return false;
    }
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly)) {
        qWarning("[kino:authstore] write failed");
        return false;
    }
    file.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner);
    file.write(value.toUtf8());
    if (!file.commit()) {
        qWarning("[kino:authstore] write failed");
        return false;
    }
    return true;
}

bool clearAuth() {
    QFile file(authFilePath());
    if (!file.exists()) {
        return true;
    }
    if (!file.remove()) {
        qWarning("[kino:authstore] delete failed");
        return false;
    }
    return true;
}

} // namespace

QFuture<bool> SecureStore::clearStremioAuth() {
    return QtConcurrent::run(clearAuth);
}

QFuture<QVariantMap> SecureStore::readStremioAuth() {
    return QtConcurrent::run(readAuth);
}

QFuture<bool> SecureStore::writeStremioAuth(const QString &value) {
    return QtConcurrent::run([value]() { return writeAuth(value); });
}
