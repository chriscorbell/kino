#include "tlsroots.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QFuture>
#include <QMutex>
#include <QSaveFile>
#include <QSslCertificate>
#include <QSslConfiguration>
#include <QStandardPaths>
#include <QtConcurrentRun>

namespace {

QMutex exportMutex;
QFuture<QString> exportResult;
bool exportStarted = false;

QString exportRoots() {
    QByteArray bundle;
    const QList<QSslCertificate> roots = QSslConfiguration::systemCaCertificates();
    for (const QSslCertificate &root : roots) {
        bundle.append(root.toPem());
    }
    // Fixtures add their own test authority here; it never replaces the
    // system roots.
    const QString extra = qEnvironmentVariable("KINO_TLS_EXTRA_ROOTS");
    if (!extra.isEmpty()) {
        const auto certificates = QSslCertificate::fromPath(extra, QSsl::Pem);
        for (const QSslCertificate &certificate : certificates) {
            bundle.append(certificate.toPem());
        }
    }
    if (bundle.isEmpty()) {
        qWarning("[kino:tls] no system trust anchors available");
        return {};
    }
    // A bundle carrying a fixture authority stays out of the app's data, so a
    // check never leaves a test root where a later launch could read it.
    const QString directory = extra.isEmpty()
        ? QDir(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation))
              .absoluteFilePath(QStringLiteral("tls"))
        : QDir(QDir::tempPath())
              .absoluteFilePath(QStringLiteral("kino-tls-%1").arg(QCoreApplication::applicationPid()));
    const QString path = QDir(directory).absoluteFilePath(QStringLiteral("system-roots.pem"));
    QFile current(path);
    if (current.open(QIODevice::ReadOnly) && current.readAll() == bundle) {
        return path;
    }
    current.close();
    QSaveFile file(path);
    if (!QDir().mkpath(directory) || !file.open(QIODevice::WriteOnly) ||
        file.write(bundle) != bundle.size() || !file.commit()) {
        qWarning("[kino:tls] trust anchor export failed");
        return {};
    }
    qInfo("[kino:tls] exported trust anchors count=%lld", static_cast<long long>(roots.size()));
    return path;
}

} // namespace

namespace TlsRoots {

void prepare() {
    QMutexLocker lock(&exportMutex);
    if (exportStarted) return;
    exportStarted = true;
    exportResult = QtConcurrent::run(exportRoots);
}

QString bundlePath() {
    prepare();
    QFuture<QString> result;
    {
        QMutexLocker lock(&exportMutex);
        result = exportResult;
    }
    result.waitForFinished();
    return result.result();
}

} // namespace TlsRoots
