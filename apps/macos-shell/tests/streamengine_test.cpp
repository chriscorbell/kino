#include "streamengine.h"

#include <QCoreApplication>
#include <QFile>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>
#include <QThread>

#include <cstdio>
#include <iostream>
#include <signal.h>

namespace {
constexpr auto kReady = "KINO_ENGINE_READY http://127.0.0.1:12345/kino/"
                        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";

int runHelper(const QString &mode) {
    QFile pidFile(qEnvironmentVariable("KINO_ENGINE_FIXTURE_PID"));
    if (pidFile.open(QIODevice::WriteOnly))
        pidFile.write(QByteArray::number(QCoreApplication::applicationPid()));
    pidFile.close();
    if (mode == "exit") return 7;
    if (mode != "silent") {
        std::fputs(kReady, stdout);
        std::fflush(stdout);
    }
    if (mode == "ready-exit") {
        QThread::msleep(30);
        return 7;
    }
    std::cin.get();
    if (mode == "ignore-stop") QThread::msleep(5000);
    return 0;
}
} // namespace

class StreamEngineTest : public QObject {
    Q_OBJECT
private slots:
    void init() {
        QVERIFY(directory_.isValid());
        QFile::remove(directory_.filePath("pid"));
        qputenv("KINO_ENGINE_BINARY", QCoreApplication::applicationFilePath().toUtf8());
        qputenv("KINO_ENGINE_CACHE_DIR", directory_.filePath("cache").toUtf8());
        qputenv("KINO_ENGINE_CONFIG_DIR", directory_.filePath("config").toUtf8());
        qputenv("KINO_ENGINE_STOP_TIMEOUT_MS", "250");
        qputenv("KINO_ENGINE_FIXTURE_PID", directory_.filePath("pid").toUtf8());
        qputenv("KINO_ENGINE_STARTUP_TIMEOUT_MS", "250");
    }

    void cleanup() {
        qunsetenv("KINO_ENGINE_BINARY");
        qunsetenv("KINO_ENGINE_CACHE_DIR");
        qunsetenv("KINO_ENGINE_CONFIG_DIR");
        qunsetenv("KINO_ENGINE_STOP_TIMEOUT_MS");
        qunsetenv("KINO_ENGINE_FIXTURE_PID");
        qunsetenv("KINO_ENGINE_FIXTURE_MODE");
        qunsetenv("KINO_ENGINE_STARTUP_TIMEOUT_MS");
    }

    void readyStaysReady() {
        qputenv("KINO_ENGINE_FIXTURE_MODE", "ready");
        StreamEngine engine;
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.url().isEmpty(), 1500);
        const auto pid = helperPid();
        engine.start();
        QTest::qWait(350);
        QVERIFY(engine.error().isEmpty());
        QVERIFY(!engine.url().isEmpty());
        QCOMPARE(helperPid(), pid);
    }

    void silentStartupTimesOutAndStops() {
        qputenv("KINO_ENGINE_FIXTURE_MODE", "silent");
        StreamEngine engine;
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.error().isEmpty(), 1500);
        QVERIFY(engine.error().contains("ready"));
        QVERIFY(engine.url().isEmpty());
        const auto pid = helperPid();
        QVERIFY(pid > 0);
        QTRY_VERIFY_WITH_TIMEOUT(::kill(pid, 0) == -1, 1500);
    }

    void prematureExitFails() {
        qputenv("KINO_ENGINE_FIXTURE_MODE", "exit");
        StreamEngine engine;
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.error().isEmpty(), 1500);
        QVERIFY(engine.url().isEmpty());
    }

    void readyThenExitFails() {
        qputenv("KINO_ENGINE_FIXTURE_MODE", "ready-exit");
        StreamEngine engine;
        QSignalSpy changed(&engine, &StreamEngine::changed);
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(changed.count() >= 2, 1500);
        QTRY_VERIFY_WITH_TIMEOUT(!engine.error().isEmpty(), 1500);
        QVERIFY(engine.url().isEmpty());
    }

    void stopsBeforeClearingAndQueuesRestart() {
        qputenv("KINO_ENGINE_FIXTURE_MODE", "ready");
        StreamEngine engine;
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.url().isEmpty(), 1500);
        const auto pid = helperPid();
        auto stopped = engine.stopForCacheClear();
        QVERIFY(engine.url().isEmpty());
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(stopped.isFinished(), 1500);
        QVERIFY(stopped.result());
        QVERIFY(::kill(pid, 0) == -1);
        QVERIFY(engine.url().isEmpty());
        QVERIFY(engine.error().isEmpty());
        engine.finishCacheClear();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.url().isEmpty(), 1500);
        QVERIFY(helperPid() != pid);
    }

    void failedShutdownPreventsClearingAndRemainsRestartable() {
        qputenv("KINO_ENGINE_FIXTURE_MODE", "ignore-stop");
        StreamEngine engine;
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.url().isEmpty(), 1500);
        auto stopped = engine.stopForCacheClear();
        QTRY_VERIFY_WITH_TIMEOUT(stopped.isFinished(), 1500);
        QVERIFY(!stopped.result());
        QVERIFY(!engine.error().isEmpty());
        engine.finishCacheClear();
        qputenv("KINO_ENGINE_FIXTURE_MODE", "ready");
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.url().isEmpty(), 1500);
        QVERIFY(engine.error().isEmpty());
    }

    void clearingDuringStartupWaitsForTheChild() {
        qputenv("KINO_ENGINE_FIXTURE_MODE", "ready");
        StreamEngine engine;
        engine.start();
        auto stopped = engine.stopForCacheClear();
        QTRY_VERIFY_WITH_TIMEOUT(stopped.isFinished(), 1500);
        QVERIFY(stopped.result());
        QVERIFY(engine.url().isEmpty());
        QVERIFY(engine.error().isEmpty());
        engine.finishCacheClear();
    }

    void retriesClearErrorsBeforeReady() {
        qputenv("KINO_ENGINE_FIXTURE_MODE", "exit");
        StreamEngine engine;
        engine.start();
        QTRY_VERIFY_WITH_TIMEOUT(!engine.error().isEmpty(), 1500);
        QSignalSpy changed(&engine, &StreamEngine::changed);
        qputenv("KINO_ENGINE_FIXTURE_MODE", "ready");
        engine.start();
        QVERIFY(engine.error().isEmpty());
        QVERIFY(changed.count() > 0);
        QTRY_VERIFY_WITH_TIMEOUT(!engine.url().isEmpty(), 1500);
    }

private:
    pid_t helperPid() {
        QFile file(directory_.filePath("pid"));
        if (!file.open(QIODevice::ReadOnly)) return -1;
        return static_cast<pid_t>(file.readAll().toLongLong());
    }
    QTemporaryDir directory_;
};

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    const auto mode = qEnvironmentVariable("KINO_ENGINE_FIXTURE_MODE");
    if (!mode.isEmpty()) return runHelper(mode);
    StreamEngineTest test;
    return QTest::qExec(&test, argc, argv);
}

#include "streamengine_test.moc"
