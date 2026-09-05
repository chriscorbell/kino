#include "diagnostics.h"
#include "mpvitem.h"
#include "streamengine.h"

#include <QClipboard>
#include <QDir>
#include <QFile>
#include <QTemporaryDir>
#include <QGuiApplication>
#include <QSignalSpy>
#include <QtTest>
#include <clocale>

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
        QVERIFY(QFile::link(root.filePath("outside"), cache + "/link"));
        const auto helper = root.filePath("helper.sh");
        QVERIFY(write(helper, "#!/bin/sh\n"
            "printf 'KINO_ENGINE_READY http://127.0.0.1:12345/kino/fixture\\n'\n"
            "/bin/cat >/dev/null\n"
            // A nonzero exit makes deletion fail if it ran before EOF.
            "[ -f \"$KINO_CACHE_DIR/.hidden-cache\" ] || exit 7\n"));
        QVERIFY(QFile::setPermissions(helper, QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner));
        qputenv("KINO_CACHE_DIR", cache.toUtf8());
        qunsetenv("KINO_ENGINE_CACHE_DIR");
        qputenv("KINO_ENGINE_CONFIG_DIR", config.toUtf8());
        qputenv("KINO_ENGINE_BINARY", helper.toUtf8());
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
        QVERIFY(summary.startsWith("Kino 0.1.0\n"));
        for (const QString &field : {"Platform:", "Qt:", "Qt WebEngine:", "Stremio Core:",
                                     "Player:", "libmpv client API:", "Video output:", "Streaming engine:"}) {
            QVERIFY2(summary.contains(field), qPrintable(field));
        }
        QVERIFY(player.version().startsWith("mpv "));
        QVERIFY(summary.contains("Player: " + player.version()));
        QVERIFY(summary.contains("External override (unavailable; version unknown)"));
        QVERIFY(summary.contains("VideoToolbox"));
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
QTEST_MAIN(DiagnosticsTest)
#include "diagnostics_test.moc"
