#include "streamengine.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QStandardPaths>

namespace {

constexpr auto kReadyPrefix = "KINO_ENGINE_READY ";

QString helperPath() {
    const QString overridePath = qEnvironmentVariable("KINO_ENGINE_BINARY");
    if (!overridePath.isEmpty()) {
        return overridePath;
    }
    return QDir(QCoreApplication::applicationDirPath())
        .absoluteFilePath(QStringLiteral("kino-stream-engine"));
}

QString cacheDirectory() {
    const QString base =
        QStandardPaths::writableLocation(QStandardPaths::CacheLocation);
    return QDir(base).absoluteFilePath(QStringLiteral("streaming-engine"));
}

} // namespace

StreamEngine::StreamEngine(QObject *parent) : QObject(parent) {
    connect(&process_, &QProcess::readyReadStandardOutput, this,
            &StreamEngine::readReadyLine);
    connect(&process_, &QProcess::errorOccurred, this, [this](QProcess::ProcessError) {
        fail(QStringLiteral("The streaming engine could not be started."));
    });
    connect(&process_, &QProcess::finished, this,
            [this](int exitCode, QProcess::ExitStatus) {
                if (url_.isEmpty()) {
                    fail(QStringLiteral("The streaming engine stopped during startup."));
                } else {
                    qWarning("[kino:engine] engine exited code=%d", exitCode);
                    url_.clear();
                    emit changed();
                }
            });
}

StreamEngine::~StreamEngine() {
    if (process_.state() == QProcess::NotRunning) {
        return;
    }
    // Closing stdin asks the helper to shut down cleanly; kill if it lingers.
    process_.closeWriteChannel();
    if (!process_.waitForFinished(3'000)) {
        process_.kill();
        process_.waitForFinished(1'000);
    }
}

QString StreamEngine::error() const {
    return error_;
}

QString StreamEngine::url() const {
    return url_;
}

void StreamEngine::start() {
    if (process_.state() != QProcess::NotRunning || !url_.isEmpty()) {
        return;
    }
    const QString path = helperPath();
    if (!QFileInfo::exists(path)) {
        fail(QStringLiteral("This build does not include the streaming engine."));
        return;
    }
    const QString cacheDir = cacheDirectory();
    if (!QDir().mkpath(cacheDir)) {
        fail(QStringLiteral("The streaming engine cache directory is unavailable."));
        return;
    }

    error_.clear();
    QProcessEnvironment environment = QProcessEnvironment::systemEnvironment();
    environment.insert(QStringLiteral("KINO_ENGINE_CACHE_DIR"), cacheDir);
    process_.setProcessEnvironment(environment);
    process_.setProcessChannelMode(QProcess::ForwardedErrorChannel);
    process_.start(path, {});
    qInfo("[kino:engine] streaming engine starting");
}

void StreamEngine::readReadyLine() {
    while (process_.canReadLine()) {
        const QByteArray line = process_.readLine().trimmed();
        if (!line.startsWith(kReadyPrefix)) {
            continue;
        }
        url_ = QString::fromUtf8(line.mid(static_cast<int>(qstrlen(kReadyPrefix))));
        error_.clear();
        qInfo("[kino:engine] streaming engine ready");
        emit changed();
    }
}

void StreamEngine::fail(const QString &reason) {
    if (error_ == reason) {
        return;
    }
    url_.clear();
    error_ = reason;
    qWarning("[kino:engine] %s", qPrintable(reason));
    emit changed();
}
