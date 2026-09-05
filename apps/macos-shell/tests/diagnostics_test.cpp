#include "diagnostics.h"
#include "mpvitem.h"
#include "streamengine.h"

#include <QClipboard>
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
