#include "../src/displaymode.h"

#include <QTest>

// Match refresh rate's choice of mode, on a 5K display that offers what a high-refresh
// external monitor does.
class DisplayModeTest : public QObject {
    Q_OBJECT

private slots:
    void choosesTheMultipleNearestTheCurrentRate();
};

void DisplayModeTest::choosesTheMultipleNearestTheCurrentRate() {
    auto mode = [](int id, double rate) { return RefreshMode{id, 5120, 2880, rate}; };
    const std::vector<RefreshMode> modes{mode(1, 24), mode(2, 25), mode(3, 30),
                                         mode(4, 50), mode(5, 60), mode(6, 100),
                                         mode(7, 120), mode(8, 144), mode(9, 160),
                                         RefreshMode{10, 2560, 1440, 48}};
    // A 160 Hz desktop moves to 144 Hz for film, not down to 24.
    QCOMPARE(chooseRefreshMode(modes, mode(9, 160), 24)->rate, 144.0);
    // At 60 Hz, 24 Hz is nearer than 120.
    QCOMPARE(chooseRefreshMode(modes, mode(5, 60), 24)->rate, 24.0);
    QCOMPARE(chooseRefreshMode(modes, mode(9, 160), 25)->rate, 100.0);
    // 60 Hz already shows 30 fps evenly, so nothing changes.
    QVERIFY(!chooseRefreshMode(modes, mode(5, 60), 30));
    // 23.976 is none of these: 24 and 144 are a tenth of a percent off.
    QVERIFY(!chooseRefreshMode(modes, mode(9, 160), 24000.0 / 1001.0));
    // A different pixel size is never chosen, and an unknown rate asks for nothing.
    QVERIFY(!chooseRefreshMode({RefreshMode{10, 2560, 1440, 48}}, mode(9, 160), 24));
    QVERIFY(!chooseRefreshMode(modes, mode(9, 160), 0));
}

QTEST_APPLESS_MAIN(DisplayModeTest)
#include "displaymode_test.moc"
