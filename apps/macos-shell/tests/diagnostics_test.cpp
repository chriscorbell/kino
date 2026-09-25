#include "diagnosticbuildinfo.h"
#include "diagnostics.h"
#include "platform.h"
#include "mpvitem.h"
#include "streamengine.h"

#include <QClipboard>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QTemporaryDir>
#include <QGuiApplication>
#include <QSignalSpy>
#include <QtTest>
#include <clocale>
#include <cstdio>

namespace {

// The fake engine: this test binary, started again by the shell with
// KINO_DIAGNOSTICS_HELPER set. It stays until stdin closes, and fails with 7
// if its cache was cleared before then, as it would be if deletion ran first.
int runHelper() {
    std::fputs("KINO_ENGINE_READY http://127.0.0.1:12345/kino/fixture\n", stdout);
    std::fflush(stdout);
    while (std::fgetc(stdin) != EOF) {
    }
    return QFileInfo::exists(qEnvironmentVariable("KINO_CACHE_DIR") + "/.hidden-cache") ? 0 : 7;
}

} // namespace

class DiagnosticsTest : public QObject {
    Q_OBJECT
private slots:
    void initTestCase() {
        std::setlocale(LC_NUMERIC, "C");
        QCoreApplication::setApplicationName("Kino");
        QCoreApplication::setApplicationVersion("0.1.0");
    }

    void clearsOnlyAfterReleaseAndPreservesPersistentFiles() {
        QTemporaryDir root;
        QVERIFY(root.isValid());
        const auto cache = root.filePath("cache");
        const auto config = root.filePath("config");
        QDir().mkpath(cache + "/streaming-engine/logs");
        auto write = [](const QString &path, const QByteArray &bytes) {
            QFile file(path);
            return file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size();
        };
        QVERIFY(write(cache + "/streaming-engine/settings.json", "{\"seedingEnabled\":false}"));
        QVERIFY(write(cache + "/streaming-engine/logs/old.log", "saved diagnostic"));
        QVERIFY(write(cache + "/.hidden-cache", "disposable"));
        QVERIFY(write(root.filePath("outside"), "keep"));
        // Windows makes a shortcut, which must be named .lnk.
#if defined(Q_OS_WIN)
        QVERIFY(QFile::link(root.filePath("outside"), cache + "/link.lnk"));
#else
        QVERIFY(QFile::link(root.filePath("outside"), cache + "/link"));
#endif
        qputenv("KINO_CACHE_DIR", cache.toUtf8());
        qunsetenv("KINO_ENGINE_CACHE_DIR");
        qputenv("KINO_ENGINE_CONFIG_DIR", config.toUtf8());
        qputenv("KINO_DIAGNOSTICS_HELPER", "1");
        qputenv("KINO_ENGINE_BINARY", QCoreApplication::applicationFilePath().toUtf8());
        StreamEngine engine;
        Diagnostics diagnostics;
        diagnostics.setSources(nullptr, &engine);
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.url().isEmpty(), 1500);
        auto cleared = diagnostics.clearCache();
        auto concurrent = diagnostics.clearCache();
        QTRY_VERIFY_WITH_TIMEOUT(cleared.isFinished(), 1500);
        QVERIFY(cleared.result());
        QVERIFY(concurrent.result());
        QVERIFY(engine.url().isEmpty());
        QVERIFY(engine.error().isEmpty());
        QVERIFY(!QFileInfo::exists(cache + "/.hidden-cache"));
        QVERIFY(!QFileInfo::exists(cache + "/streaming-engine"));
        QVERIFY(QFileInfo::exists(root.filePath("outside")));
        QFile settings(config + "/settings.json");
        QVERIFY(settings.open(QIODevice::ReadOnly));
        QCOMPARE(settings.readAll(), QByteArray("{\"seedingEnabled\":false}"));
        QCOMPARE(QDir(config).entryList({"legacy-logs-*"}, QDir::Dirs).size(), 1);
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.url().isEmpty(), 1500);
        QVERIFY(write(cache + "/.hidden-cache", "retained on failed stop"));
        // Force an unsuccessful graceful exit. The helper must never see the
        // sentinel disappear before it releases its cache handles.
        QVERIFY(QFile::remove(cache + "/.hidden-cache"));
        QVERIFY(write(cache + "/retained", "keep after failed stop"));
        auto failed = diagnostics.clearCache();
        QTRY_VERIFY_WITH_TIMEOUT(failed.isFinished(), 1500);
        QVERIFY(!failed.result());
        QVERIFY(QFileInfo::exists(cache + "/retained"));
        qunsetenv("KINO_CACHE_DIR");
        qunsetenv("KINO_ENGINE_CONFIG_DIR");
        qunsetenv("KINO_ENGINE_BINARY");
        qunsetenv("KINO_DIAGNOSTICS_HELPER");
    }

    void migratesBeforeFirstStartAndRejectsCacheConfigOverlap() {
        QTemporaryDir root;
        QVERIFY(root.isValid());
        const auto cache = root.filePath("cache");
        const auto config = root.filePath("config");
        QDir().mkpath(cache + "/streaming-engine");
        QFile settings(cache + "/streaming-engine/settings.json");
        QVERIFY(settings.open(QIODevice::WriteOnly));
        settings.write("{\"btDownloadSpeedHardLimit\":2048}");
        settings.close();
        qputenv("KINO_CACHE_DIR", cache.toUtf8());
        qputenv("KINO_ENGINE_CONFIG_DIR", (cache + "/config").toUtf8());
        StreamEngine engine;
        Diagnostics diagnostics;
        diagnostics.setSources(nullptr, &engine);
        auto rejected = diagnostics.clearCache();
        QTRY_VERIFY(rejected.isFinished());
        QVERIFY(!rejected.result());
        QVERIFY(settings.exists());
        qputenv("KINO_ENGINE_CONFIG_DIR", config.toUtf8());
        auto cleared = diagnostics.clearCache();
        QTRY_VERIFY(cleared.isFinished());
        QVERIFY(cleared.result());
        QVERIFY(QFileInfo::exists(config + "/settings.json"));
        QVERIFY(!settings.exists());
        qunsetenv("KINO_CACHE_DIR");
        qunsetenv("KINO_ENGINE_CONFIG_DIR");
    }

    void copiesAllowlistedVersions() {
        // The offscreen platform keeps this clipboard inside the test process.
        qputenv("KINO_UI_URL", "https://viewer:SENTINEL@media.invalid/private?token=SENTINEL");
        qputenv("KINO_ENGINE_BINARY", "/missing/SENTINEL");
        MpvItem player;
        StreamEngine engine;
        Diagnostics diagnostics;
        diagnostics.setSources(&player, &engine);
        bool copied = false;
        QVERIFY2(QMetaObject::invokeMethod(&diagnostics, "copyDiagnosticSummary", Q_RETURN_ARG(bool, copied)),
                 "The native diagnostics API must provide Copy Diagnostic Summary");
        QVERIFY(copied);
        const QString summary = QGuiApplication::clipboard()->text();
        QVERIFY(summary.startsWith(QStringLiteral("Kino 0.1.0 (%1 build)\n").arg(KINO_BUILD_KIND)));
        for (const QString &field : {"Platform:", "Qt:", "Qt WebEngine:", "Stremio Core:",
                                     "Player:", "libmpv client API:", "Video output:", "Streaming engine:"}) {
            QVERIFY2(summary.contains(field), qPrintable(field));
        }
        QVERIFY(player.version().startsWith("mpv "));
        QVERIFY(summary.contains("Player: " + player.version()));
        QVERIFY(summary.contains("External override (unavailable; version unknown)"));
        QVERIFY(summary.contains("Video decoder: " + Platform::hardwareDecoderName() + " required"));
        QVERIFY(summary.contains("SDR"));
        QVERIFY(!summary.contains("SENTINEL"));
        QVERIFY(!summary.contains("https://"));
        QVERIFY(!summary.contains("viewer"));
        QVERIFY(!summary.contains("/missing/"));
        qputenv("KINO_ENGINE_BINARY", QCoreApplication::applicationFilePath().toUtf8());
        QVERIFY(QMetaObject::invokeMethod(&diagnostics, "copyDiagnosticSummary", Q_RETURN_ARG(bool, copied)));
        QVERIFY(copied);
        QVERIFY(QGuiApplication::clipboard()->text().contains("External override (available; version unknown)"));
    }
};
int main(int argc, char **argv) {
    if (qEnvironmentVariableIsSet("KINO_DIAGNOSTICS_HELPER")) return runHelper();
    QGuiApplication app(argc, argv);
    DiagnosticsTest test;
    return QTest::qExec(&test, argc, argv);
}
#include "diagnostics_test.moc"
