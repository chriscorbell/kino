#include "logging.h"
#include "streamengine.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QThread>
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

// The fake engine: this test binary, started again by the shell with
// KINO_LOGGING_HELPER set, so the fixture runs wherever the shell does.
int runHelper() {
    std::fputs("KINO_ENGINE_LOG WAR", stderr);
    std::fflush(stderr);
    QThread::msleep(30);
    std::fputs("N engine:12 message=warning-detail\n", stderr);
    std::fputs("KINO_ENGINE_LOG ERROR engine:13 message=failure-detail\n", stderr);
    std::fputs("Authorization: Bearer SENTINEL_RAW\n", stderr);
    std::fputs((QByteArray(20000, 'x') + "SENTINEL_LONG\n").constData(), stderr);
    std::fputs("KINO_ENGINE_LOG INFO engine:14 message=last-detail", stderr);
    std::fflush(stderr);
    return 0;
}
} // namespace

int main(int argc, char **argv) {
    if (qEnvironmentVariableIsSet("KINO_LOGGING_HELPER")) return runHelper();
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
        qputenv("KINO_LOGGING_HELPER", "1");
        qputenv("KINO_ENGINE_BINARY", QCoreApplication::applicationFilePath().toUtf8());
        {
            StreamEngine engine;
            QObject::connect(&engine, &StreamEngine::changed, &app, [&]() {
                if (!engine.error().isEmpty()) app.quit();
            });
            QTimer::singleShot(5000, &app, &QCoreApplication::quit);
            engine.start();
            app.exec();
        }
        qunsetenv("KINO_LOGGING_HELPER");
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

        logWebConsoleMessage(QtInfoMsg, "web-info");
        logWebConsoleMessage(QtWarningMsg, "web-warning");
        logWebConsoleMessage(QtCriticalMsg, "web-error");
        logWebConsoleMessage(QtWarningMsg, "DROP_WEB_URL https://example.invalid/private");
        logWebConsoleMessage(QtCriticalMsg, "DROP_WEB_AUTH Authorization: Bearer SENTINEL_WEB");
        logWebConsoleMessage(QtInfoMsg, "DROP_WEB_EMAIL viewer@example.invalid");
        const QByteArray web = read(logs + "/kino.log");
        require(web.contains("[INFO] [kino.web]") && web.contains("web-info"),
                "web info was not recorded");
        require(web.contains("[WARN] [kino.web]") && web.contains("web-warning"),
                "web warning was not recorded");
        require(web.contains("[ERROR] [kino.web]") && web.contains("web-error"),
                "web error was not recorded");
        require(!web.contains("DROP_WEB") && !web.contains("SENTINEL_WEB"),
                "sensitive web messages were not omitted");
        std::fflush(stderr);
        require(!read(stderrPath).contains("DROP_WEB") && !read(stderrPath).contains("SENTINEL_WEB"),
                "sensitive web messages reached stderr");

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
