#include "singleinstance.h"

#include <QDir>
#include <QFile>
#include <QSignalSpy>
#include <QTest>
#include <QUuid>

class SingleInstanceTest : public QObject {
    Q_OBJECT
private slots:
    void aSecondLaunchHandsOverToTheFirst() {
        const QString name = QStringLiteral("kino-test-") + QUuid::createUuid().toString(QUuid::Id128);
        SingleInstance first(name);
        QVERIFY(first.claim());
        QSignalSpy activated(&first, &SingleInstance::activationRequested);
        SingleInstance second(name);
        QVERIFY(!second.claim());
        QTRY_COMPARE_WITH_TIMEOUT(activated.count(), 1, 2000);
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

QTEST_MAIN(SingleInstanceTest)
#include "singleinstance_test.moc"
