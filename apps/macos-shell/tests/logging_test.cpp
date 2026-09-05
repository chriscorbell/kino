#include "logging.h"
#include "streamengine.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTimer>
#include <QUuid>

#include <cstdio>
#include <stdexcept>

namespace {
void require(bool condition, const char *message) {
    if (!condition) {
        throw std::runtime_error(message);
    }
}

QByteArray read(const QString &path) {
    QFile file(path);
    require(file.open(QIODevice::ReadOnly), "could not read test log");
    return file.readAll();
}
} // namespace

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    QStandardPaths::setTestModeEnabled(true);
    app.setApplicationName("KinoLoggingTest-" + QUuid::createUuid().toString(QUuid::WithoutBraces));
    const QString cachePath = QStandardPaths::writableLocation(QStandardPaths::CacheLocation);
    QTemporaryDir directory;
    try {
        require(directory.isValid(), "could not create temporary directory");
        const QString stderrPath = directory.filePath("stderr.txt");
        require(std::freopen(qPrintable(stderrPath), "w", stderr) != nullptr,
                "could not capture stderr");
        const QString logs = directory.filePath("logs");
        installLocalLogger(logs);

        // Exercise the actual QProcess pipe forwarding, including split writes,
        // levels, a trailing partial record, and unstructured sensitive output.
        QFile helper(directory.filePath("helper.sh"));
        require(helper.open(QIODevice::WriteOnly), "could not create helper fixture");
        helper.write("#!/bin/sh\n"
                     "printf 'KINO_ENGINE_LOG WAR' >&2\n"
                     "/bin/sleep 0.03\n"
                     "printf 'N engine:12 message=warning-detail\\n' >&2\n"
                     "printf 'KINO_ENGINE_LOG ERROR engine:13 message=failure-detail\\n' >&2\n"
                     "printf 'Authorization: Bearer SENTINEL_RAW\\n' >&2\n"
                     "printf '");
        helper.write(QByteArray(20000, 'x'));
        helper.write("SENTINEL_LONG\\n' >&2\n"
                     "printf 'KINO_ENGINE_LOG INFO engine:14 message=last-detail' >&2\n");
        helper.close();
        require(helper.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner |
                                      QFileDevice::ExeOwner), "could not make helper executable");
        qputenv("KINO_ENGINE_BINARY", helper.fileName().toUtf8());
        {
            StreamEngine engine;
            QObject::connect(&engine, &StreamEngine::changed, &app, [&]() {
                if (!engine.error().isEmpty()) app.quit();
            });
            QTimer::singleShot(5000, &app, &QCoreApplication::quit);
            engine.start();
            app.exec();
        }
        const QByteArray forwarded = read(logs + "/kino.log");
        require(forwarded.contains("[WARN]") && forwarded.contains("warning-detail"),
                "split warning did not reach the log");
        require(forwarded.contains("[ERROR]") && forwarded.contains("failure-detail"),
                "error did not reach the log");
        require(forwarded.contains("last-detail"), "last partial diagnostic was lost");
        require(!forwarded.contains("SENTINEL"), "raw stderr leaked into the log");
        require(forwarded.contains("oversized helper diagnostic omitted"),
                "oversized pipe record was not bounded");

        qWarning("source=https://example.invalid/SENTINEL_URL token=SENTINEL_TOKEN");
        std::fflush(stderr);
        require(!read(logs + "/kino.log").contains("SENTINEL"), "credential leaked into file");
        require(!read(stderrPath).contains("SENTINEL"), "credential leaked into stderr");

        // One record larger than the file limit must be bounded before write.
        qInfo("%s", QByteArray(11 * 1024 * 1024, 'x').constData());
        require(QFileInfo(logs + "/kino.log").size() <= 10 * 1024 * 1024,
                "one record exceeded the log file limit");
        const QByteArray message(64 * 1024, 'z');
        for (int index = 0; index < 1000; ++index) qInfo("%s", message.constData());
        const QFileInfoList files = QDir(logs).entryInfoList(QDir::Files);
        require(files.size() == 5, "rotation must retain exactly five files");
        for (const QFileInfo &file : files) {
            require(file.size() <= 10 * 1024 * 1024, "rotated log exceeded 10 MB");
        }
        QDir(cachePath).removeRecursively();
        std::puts("Engine forwarding, redaction, record bounds, and five-file rotation passed.");
        return 0;
    } catch (const std::exception &error) {
        QDir(cachePath).removeRecursively();
        std::printf("Diagnostic logging check failed: %s\n", error.what());
        return 1;
    }
}
