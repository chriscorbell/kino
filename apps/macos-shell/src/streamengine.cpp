#include "streamengine.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QFile>
#include <QStandardPaths>
#include <QUrl>
#include <QUuid>
#include <utility>

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
    const QString overridePath = qEnvironmentVariable("KINO_ENGINE_CACHE_DIR");
    if (!overridePath.isEmpty()) {
        return overridePath;
    }
    const QString base = qEnvironmentVariableIsEmpty("KINO_CACHE_DIR")
        ? QStandardPaths::writableLocation(QStandardPaths::CacheLocation)
        : qEnvironmentVariable("KINO_CACHE_DIR");
    return QDir(base).absoluteFilePath(QStringLiteral("streaming-engine"));
}

QString configDirectory() {
    const QString overridePath = qEnvironmentVariable("KINO_ENGINE_CONFIG_DIR");
    if (!overridePath.isEmpty()) return overridePath;
    return QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) +
           QStringLiteral("/streaming-engine");
}

QString uiOrigin() {
    const QString overrideUrl = qEnvironmentVariable("KINO_UI_URL");
    if (overrideUrl.isEmpty()) {
        return QStringLiteral("file://");
    }
    QUrl url = QUrl::fromUserInput(overrideUrl);
    if (url.isLocalFile()) {
        return QStringLiteral("file://");
    }
    if (url.scheme() == "qrc") {
        return QStringLiteral("qrc://");
    }
    if ((url.scheme() == "http" && url.port() == 80) ||
        (url.scheme() == "https" && url.port() == 443)) {
        url.setPort(-1);
    }
    return url.toString(QUrl::RemoveUserInfo | QUrl::RemovePath |
                        QUrl::RemoveQuery | QUrl::RemoveFragment);
}

} // namespace

StreamEngine::StreamEngine(QObject *parent) : QObject(parent) {
    stopDeadline_.setSingleShot(true);
    bool stopConfigured = false;
    const int stopTimeout = qEnvironmentVariableIntValue("KINO_ENGINE_STOP_TIMEOUT_MS", &stopConfigured);
    stopDeadline_.setInterval(stopConfigured && stopTimeout > 0 ? qMin(stopTimeout, 5'000) : 5'000);
    connect(&stopDeadline_, &QTimer::timeout, this, [this]() {
        pendingFailure_ = QStringLiteral("The streaming engine did not stop cleanly. Cache was not cleared.");
        process_.kill();
    });
    startupDeadline_.setSingleShot(true);
    bool configured = false;
    const int timeout = qEnvironmentVariableIntValue("KINO_ENGINE_STARTUP_TIMEOUT_MS", &configured);
    startupDeadline_.setInterval(configured && timeout > 0 ? qMin(timeout, 30'000) : 30'000);
    connect(&startupDeadline_, &QTimer::timeout, this, [this]() {
        if (!url_.isEmpty() || process_.state() == QProcess::NotRunning) return;
        pendingFailure_ = QStringLiteral("The streaming engine did not become ready in time.");
        // Report only after finished, so an immediate retry can start a new child.
        process_.kill();
    });
    connect(&process_, &QProcess::readyReadStandardOutput, this,
            &StreamEngine::readReadyLine);
    connect(&process_, &QProcess::readyReadStandardError, this,
            &StreamEngine::readDiagnostics);
    connect(&process_, &QProcess::errorOccurred, this, [this](QProcess::ProcessError error) {
        // Crashes also emit finished, where startup and post-ready exits differ.
        if (error == QProcess::Crashed) return;
        const QString reason = error == QProcess::FailedToStart
            ? QStringLiteral("The streaming engine could not be started.")
            : QStringLiteral("The streaming engine connection failed.");
        startupDeadline_.stop();
        if (process_.state() == QProcess::NotRunning) {
            fail(reason);
            completeStop(false);
        } else {
            pendingFailure_ = reason;
            process_.kill();
        }
    });
    connect(&process_, &QProcess::finished, this,
            [this](int exitCode, QProcess::ExitStatus exitStatus) {
                startupDeadline_.stop();
                readReadyLine();
                readDiagnostics();
                consumeDiagnostics("\n");
                if (stopPromise_) {
                    const bool stopped = pendingFailure_.isEmpty() && exitCode == 0 &&
                                         exitStatus == QProcess::NormalExit;
                    if (!stopped) fail(QStringLiteral("The streaming engine did not stop cleanly. Cache was not cleared."));
                    completeStop(stopped);
                    return;
                }
                if (!pendingFailure_.isEmpty()) {
                    fail(pendingFailure_);
                } else if (url_.isEmpty()) {
                    fail(QStringLiteral("The streaming engine stopped during startup."));
                } else {
                    qWarning("[kino:engine] engine exited code=%d", exitCode);
                    fail(QStringLiteral("The streaming engine stopped unexpectedly."));
                }
            });
}

StreamEngine::~StreamEngine() {
    startupDeadline_.stop();
    stopDeadline_.stop();
    disconnect(&process_, nullptr, this, nullptr);
    if (process_.state() == QProcess::NotRunning) {
        return;
    }
    // Closing stdin asks the helper to shut down cleanly; kill if it lingers.
    process_.closeWriteChannel();
    if (!process_.waitForFinished(3'000)) {
        process_.kill();
        process_.waitForFinished(1'000);
    }
    readDiagnostics();
    consumeDiagnostics("\n");
}

QString StreamEngine::error() const {
    return error_;
}

QString StreamEngine::url() const {
    return url_;
}

void StreamEngine::start() {
    if (clearingCache_) {
        restartRequested_ = true;
        return;
    }
    if (process_.state() != QProcess::NotRunning || !url_.isEmpty()) {
        return;
    }
    error_.clear();
    pendingFailure_.clear();
    diagnosticBuffer_.clear();
    droppingDiagnostic_ = false;
    const QString path = helperPath();
    if (!QFileInfo::exists(path)) {
        fail(QStringLiteral("This build does not include the streaming engine."));
        return;
    }
    const QString cacheDir = cacheDirectory();
    if (!preserveConfiguration()) {
        fail(QStringLiteral("The streaming engine settings could not be preserved."));
        return;
    }
    if (!QDir().mkpath(cacheDir)) {
        fail(QStringLiteral("The streaming engine cache directory is unavailable."));
        return;
    }

    QProcessEnvironment environment = QProcessEnvironment::systemEnvironment();
    environment.insert(QStringLiteral("KINO_ENGINE_CACHE_DIR"), cacheDir);
    environment.insert(QStringLiteral("KINO_ENGINE_CONFIG_DIR"), configDirectory());
    environment.insert(QStringLiteral("KINO_ENGINE_UI_ORIGIN"), uiOrigin());
    process_.setProcessEnvironment(environment);
    process_.setProcessChannelMode(QProcess::SeparateChannels);
    startupDeadline_.start();
    process_.start(path, {});
    qInfo("[kino:engine] streaming engine starting");
    if (error_.isEmpty()) emit changed();
}

void StreamEngine::readReadyLine() {
    if (!pendingFailure_.isEmpty() || clearingCache_) return;
    while (process_.canReadLine()) {
        const QByteArray line = process_.readLine().trimmed();
        if (!line.startsWith(kReadyPrefix)) {
            continue;
        }
        url_ = QString::fromUtf8(line.mid(static_cast<int>(qstrlen(kReadyPrefix))));
        error_.clear();
        startupDeadline_.stop();
        qInfo("[kino:engine] streaming engine ready");
        emit changed();
    }
}

QFuture<bool> StreamEngine::stopForCacheClear() {
    if (stopPromise_) return stopPromise_->future();
    clearingCache_ = true;
    startupDeadline_.stop();
    url_.clear();
    error_.clear();
    emit changed();
    stopPromise_ = std::make_unique<QPromise<bool>>();
    stopPromise_->start();
    const auto future = stopPromise_->future();
    if (process_.state() == QProcess::NotRunning) {
        completeStop(true);
    } else {
        stopDeadline_.start();
        // EOF releases the HTTP server, torrent session, and open file handles.
        // Never delete files until the child has actually exited successfully.
        process_.closeWriteChannel();
    }
    return future;
}

void StreamEngine::completeStop(bool stopped) {
    stopDeadline_.stop();
    if (!stopPromise_) return;
    auto promise = std::move(stopPromise_);
    promise->addResult(stopped);
    promise->finish();
}

void StreamEngine::finishCacheClear() {
    clearingCache_ = false;
    const bool restart = std::exchange(restartRequested_, false);
    if (restart) start();
}

bool StreamEngine::preserveConfiguration(const QString &cacheRoot) {
    const QString cache = QDir(cacheDirectory()).absolutePath();
    const QString config = QDir(configDirectory()).absolutePath();
    // Reject misconfigured overrides that would put persistent settings back
    // inside a directory about to be purged.
    for (const QString &root : {cache, cacheRoot}) {
        if (!root.isEmpty()) {
            const QString path = QDir(root).absolutePath();
            if (config == path || config.startsWith(path + '/')) return false;
        }
    }
    if (!QDir().mkpath(config)) return false;
    const QString previous = cache + QStringLiteral("/settings.json");
    const QString destination = config + QStringLiteral("/settings.json");
    if (QFileInfo::exists(previous) && !QFileInfo::exists(destination) &&
        !QFile::copy(previous, destination)) return false;
    const QString previousLogs = cache + QStringLiteral("/logs");
    if (QFileInfo::exists(previousLogs)) {
        const QString savedLogs = config + QStringLiteral("/legacy-logs-") +
                                  QUuid::createUuid().toString(QUuid::WithoutBraces);
        if (!QDir().rename(previousLogs, savedLogs)) return false;
    }
    return true;
}

void StreamEngine::readDiagnostics() {
    consumeDiagnostics(process_.readAllStandardError());
}

void StreamEngine::consumeDiagnostics(const QByteArray &bytes) {
    // A pipe read can split any record. Bound the pending record, then pass
    // complete sanitized helper events through the same logger as the shell.
    for (char byte : bytes) {
        if (byte != '\n') {
            if (diagnosticBuffer_.size() < 16 * 1024 && !droppingDiagnostic_) {
                diagnosticBuffer_.append(byte);
            } else {
                diagnosticBuffer_.clear();
                droppingDiagnostic_ = true;
            }
            continue;
        }
        const QByteArray line = std::move(diagnosticBuffer_);
        diagnosticBuffer_.clear();
        if (droppingDiagnostic_) {
            qWarning("[kino:engine] oversized helper diagnostic omitted");
        } else if (!line.isEmpty()) {
            const QByteArray prefix("KINO_ENGINE_LOG ");
            if (!line.startsWith(prefix)) {
                qWarning("[kino:engine] unstructured helper diagnostic omitted");
            } else {
                const QByteArray event = line.mid(prefix.size());
                const qsizetype separator = event.indexOf(' ');
                const QByteArray level = event.left(separator);
                const QByteArray detail = event.mid(separator + 1);
                if (level == "ERROR") {
                    qCritical("[kino:engine] %s", detail.constData());
                } else if (level == "WARN") {
                    qWarning("[kino:engine] %s", detail.constData());
                } else if (level == "INFO") {
                    qInfo("[kino:engine] %s", detail.constData());
                } else {
                    qWarning("[kino:engine] invalid helper diagnostic omitted");
                }
            }
        }
        droppingDiagnostic_ = false;
    }
}

void StreamEngine::fail(const QString &reason) {
    startupDeadline_.stop();
    if (error_ == reason) {
        return;
    }
    url_.clear();
    error_ = reason;
    qWarning("[kino:engine] %s", qPrintable(reason));
    emit changed();
}

QVariantMap StreamEngine::diagnosticInfo() const {
    const QFileInfo helper(helperPath());
    return {
        {QStringLiteral("available"), helper.isFile() && helper.isExecutable()},
        {QStringLiteral("external"), !qEnvironmentVariableIsEmpty("KINO_ENGINE_BINARY")},
        {QStringLiteral("running"), process_.state() != QProcess::NotRunning},
    };
}
