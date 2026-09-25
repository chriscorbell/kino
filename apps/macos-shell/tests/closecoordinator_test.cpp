#include "closecoordinator.h"

#include <QCoreApplication>
#include <QEvent>
#include <QSignalSpy>
#include <QtTest>

class CloseCoordinatorTest : public QObject {
    Q_OBJECT
private slots:
    void closeBeforeUiStarts() {
        CloseCoordinator lifecycle;
        QVERIFY(lifecycle.requestClose());
    }

    void waitsForMatchingSaveAcknowledgement() {
        CloseCoordinator lifecycle;
        QSignalSpy requested(&lifecycle, &CloseCoordinator::closeRequested);
        QSignalSpy approved(&lifecycle, &CloseCoordinator::closeApproved);
        lifecycle.setReady(true);
        QVERIFY(!lifecycle.requestClose());
        QVERIFY(!lifecycle.requestClose());
        QCOMPARE(requested.size(), 1);
        const int id = requested.first().first().toInt();
        lifecycle.acknowledgeClose(id + 1, true);
        QCOMPARE(approved.size(), 0);
        lifecycle.acknowledgeClose(id, true);
        QCOMPARE(approved.size(), 1);
        QVERIFY(lifecycle.requestClose());
    }

    void failedSaveKeepsWindowOpenAndAllowsRetry() {
        CloseCoordinator lifecycle;
        QSignalSpy requested(&lifecycle, &CloseCoordinator::closeRequested);
        QSignalSpy approved(&lifecycle, &CloseCoordinator::closeApproved);
        lifecycle.setReady(true);
        QVERIFY(!lifecycle.requestClose());
        const int firstId = requested.first().first().toInt();
        QTest::ignoreMessage(QtWarningMsg, "[kino:shutdown] progress save failed; window kept open");
        lifecycle.acknowledgeClose(firstId, false);
        QCOMPARE(approved.size(), 0);
        QVERIFY(!lifecycle.requestClose());
        QCOMPARE(requested.size(), 2);
        lifecycle.acknowledgeClose(firstId, true);
        QCOMPARE(approved.size(), 0);
        lifecycle.acknowledgeClose(requested.last().first().toInt(), true);
        QCOMPARE(approved.size(), 1);
    }

    void lostInterfaceReleasesAPendingClose() {
        CloseCoordinator lifecycle;
        QSignalSpy approved(&lifecycle, &CloseCoordinator::closeApproved);
        lifecycle.setReady(true);
        QVERIFY(!lifecycle.requestClose());
        lifecycle.interfaceLost();
        QCOMPARE(approved.size(), 1);
        QVERIFY(!lifecycle.ready());
        QVERIFY(lifecycle.requestClose());
    }

    void lostInterfaceStopsHoldingLaterCloses() {
        CloseCoordinator lifecycle;
        QSignalSpy requested(&lifecycle, &CloseCoordinator::closeRequested);
        QSignalSpy approved(&lifecycle, &CloseCoordinator::closeApproved);
        lifecycle.setReady(true);
        lifecycle.interfaceLost();
        QCOMPARE(approved.size(), 0);
        QVERIFY(lifecycle.requestClose());
        QCOMPARE(requested.size(), 0);
        // The reloaded interface reports ready again and saves resume.
        lifecycle.setReady(true);
        QVERIFY(!lifecycle.requestClose());
        QCOMPARE(requested.size(), 1);
    }

    void unansweredSaveLetsTheNextCloseProceed() {
        qputenv("KINO_CLOSE_TIMEOUT_MS", "50");
        CloseCoordinator lifecycle;
        qunsetenv("KINO_CLOSE_TIMEOUT_MS");
        QSignalSpy requested(&lifecycle, &CloseCoordinator::closeRequested);
        lifecycle.setReady(true);
        QTest::ignoreMessage(QtWarningMsg, "[kino:shutdown] save acknowledgement timed out; window kept open");
        QVERIFY(!lifecycle.requestClose());
        QTest::qWait(150);
        QTest::ignoreMessage(QtWarningMsg, "[kino:shutdown] closing after an unanswered save request");
        QVERIFY(lifecycle.requestClose());
        QCOMPARE(requested.size(), 1);
    }

    void applicationQuitUsesTheSameSaveRequest() {
        CloseCoordinator lifecycle;
        QSignalSpy requested(&lifecycle, &CloseCoordinator::closeRequested);
        lifecycle.setReady(true);
        QEvent quit(QEvent::Quit);
        QVERIFY(QCoreApplication::sendEvent(QCoreApplication::instance(), &quit));
        QCOMPARE(requested.size(), 1);
        QVERIFY(!lifecycle.requestClose());
        QCOMPARE(requested.size(), 1);
    }
};

QTEST_GUILESS_MAIN(CloseCoordinatorTest)
#include "closecoordinator_test.moc"
