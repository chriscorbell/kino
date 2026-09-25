#include "singleinstance.h"

#include <QCoreApplication>
#include <QDir>
#include <QProcess>
#include <QFile>
#include <QSignalSpy>
#include <QTest>
#include <QUuid>

class SingleInstanceTest : public QObject {
    Q_OBJECT
private slots:
    // The second launch is a process of its own, this test binary started
    // again, as it is in use.
    void aSecondLaunchHandsOverToTheFirst() {
        const QString name = QStringLiteral("kino-test-") + QUuid::createUuid().toString(QUuid::Id128);
        SingleInstance first(name);
        QVERIFY(first.claim());
        QSignalSpy activated(&first, &SingleInstance::activationRequested);
        QProcess second;
        QProcessEnvironment environment = QProcessEnvironment::systemEnvironment();
        environment.insert(QStringLiteral("KINO_SINGLE_INSTANCE_CHILD"), name);
        second.setProcessEnvironment(environment);
        second.start(QCoreApplication::applicationFilePath(), {});
        QTRY_COMPARE_WITH_TIMEOUT(activated.count(), 1, 5000);
        QTRY_VERIFY_WITH_TIMEOUT(second.state() == QProcess::NotRunning, 5000);
        QCOMPARE(second.exitCode(), 0);
    }

    void aSocketLeftByACrashDoesNotBlockTheNextLaunch() {
        const QString name = QStringLiteral("kino-test-") + QUuid::createUuid().toString(QUuid::Id128);
#if !defined(Q_OS_WIN)
        // A crash leaves the socket file behind, with nothing listening on it.
        QFile stale(QDir(QDir::tempPath()).filePath(name));
        QVERIFY(stale.open(QIODevice::WriteOnly));
        stale.close();
#endif
        SingleInstance next(name);
        QVERIFY(next.claim());
    }
};

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    // Started by aSecondLaunchHandsOverToTheFirst: exit 0 when the first
    // instance took the request, as a second Kino would.
    const QString child = qEnvironmentVariable("KINO_SINGLE_INSTANCE_CHILD");
    if (!child.isEmpty()) return SingleInstance(child).claim() ? 1 : 0;
    SingleInstanceTest test;
    return QTest::qExec(&test, argc, argv);
}
#include "singleinstance_test.moc"
