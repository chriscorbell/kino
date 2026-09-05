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
    connect(&process_, &QProcess::readyReadStandardError, this,
            &StreamEngine::readDiagnostics);
    connect(&process_, &QProcess::errorOccurred, this, [this](QProcess::ProcessError) {
        fail(QStringLiteral("The streaming engine could not be started."));
    });
    connect(&process_, &QProcess::finished, this,
            [this](int exitCode, QProcess::ExitStatus) {
                readDiagnostics();
                consumeDiagnostics("\n");
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
    process_.setProcessChannelMode(QProcess::SeparateChannels);
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
    if (error_ == reason) {
        return;
    }
    url_.clear();
    error_ = reason;
    qWarning("[kino:engine] %s", qPrintable(reason));
    emit changed();
}
