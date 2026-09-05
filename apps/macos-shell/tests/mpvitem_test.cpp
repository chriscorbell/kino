#include "mpvitem.h"

#include <QSignalSpy>
#include <QtTest>

#include <cstring>

class MpvItemTest : public QObject {
    Q_OBJECT

    static void sendProperty(MpvItem &player, const char *name, mpv_format format,
                             void *data) {
        mpv_event_property property{name, format, data};
        mpv_event event{};
        event.event_id = MPV_EVENT_PROPERTY_CHANGE;
        event.data = &property;
        player.handleEvent(&event);
    }

    static void sendString(MpvItem &player, const char *name, const char *value) {
        // A nonzero low address byte makes the old pointer-as-string read
        // deterministically report true, even for "no" and empty strings.
        alignas(256) char storage[256]{};
        char *data = value ? storage + 1 : nullptr;
        if (value) {
            std::strcpy(data, value);
        }
        sendProperty(player, name, MPV_FORMAT_STRING, &data);
    }

private slots:
    void hardwareDecoderProperties_data() {
        QTest::addColumn<QByteArray>("value");
        QTest::addColumn<bool>("expected");
        QTest::newRow("videotoolbox") << QByteArray("videotoolbox") << true;
        QTest::newRow("software") << QByteArray("no") << false;
        QTest::newRow("empty") << QByteArray("") << false;
        QTest::newRow("unknown-decoder") << QByteArray("unknown") << false;
        QTest::newRow("null-string") << QByteArray() << false;
    }

    void hardwareDecoderProperties() {
        QFETCH(QByteArray, value);
        QFETCH(bool, expected);
        MpvItem player;
        player.setActive(true);
        sendString(player, "video-format", "h264");
        sendString(player, "hwdec-current", "videotoolbox");
        QSignalSpy events(&player, &MpvItem::playerEvent);

        sendString(player, "hwdec-current", value.isNull() ? nullptr : value.constData());

        QCOMPARE(player.hardwareDecoderActive_, expected);
        QCOMPARE(player.hardwareDecoderTimer_.isActive(), !expected);
        QCOMPARE(events.size(), 1);
        QCOMPARE(events.last().at(0).toString(), QStringLiteral("hardwareDecoding"));
        QCOMPARE(events.last().at(1).toMap().value("active").toBool(), expected);
    }

    void missingProperties_data() {
        QTest::addColumn<QByteArray>("name");
        QTest::addColumn<int>("format");
        QTest::addColumn<bool>("hasData");
        for (const char *name : {"hwdec-current", "video-format"}) {
            const QByteArray prefix(name);
            QTest::newRow((prefix + "-unavailable").constData())
                << prefix << int(MPV_FORMAT_NONE) << false;
            QTest::newRow((prefix + "-wrong-format").constData())
                << prefix << int(MPV_FORMAT_FLAG) << true;
            QTest::newRow((prefix + "-null-data").constData())
                << prefix << int(MPV_FORMAT_STRING) << false;
        }
    }

    void missingProperties() {
        QFETCH(QByteArray, name);
        QFETCH(int, format);
        QFETCH(bool, hasData);
        MpvItem player;
        player.setActive(true);
        sendString(player, "video-format", "h264");
        sendString(player, "hwdec-current",
                   name == "hwdec-current" ? "videotoolbox" : "no");
        int flag = 1;

        sendProperty(player, name.constData(), mpv_format(format), hasData ? &flag : nullptr);

        if (name == "hwdec-current") {
            QVERIFY(!player.hardwareDecoderActive_);
            QVERIFY(player.hardwareDecoderTimer_.isActive());
        } else {
            QVERIFY(!player.videoPresent_);
            QVERIFY(!player.hardwareDecoderTimer_.isActive());
        }
    }

    void noVideoCancelsRejection_data() {
        QTest::addColumn<bool>("nullString");
        QTest::newRow("empty") << false;
        QTest::newRow("null-string") << true;
    }

    void noVideoCancelsRejection() {
        QFETCH(bool, nullString);
        MpvItem player;
        player.setActive(true);
        sendString(player, "video-format", "h264");
        sendString(player, "hwdec-current", "no");

        sendString(player, "video-format", nullString ? nullptr : "");

        QVERIFY(!player.videoPresent_);
        QVERIFY(!player.hardwareDecoderTimer_.isActive());
        QSignalSpy events(&player, &MpvItem::playerEvent);
        QVERIFY(QMetaObject::invokeMethod(&player.hardwareDecoderTimer_, "timeout",
                                         Qt::DirectConnection));
        QVERIFY(events.isEmpty());
        QVERIFY(player.active());
    }

    void alignedStrings() {
        MpvItem player;
        alignas(256) char decoder[] = "videotoolbox";
        alignas(256) char format[] = "h264";
        char *decoderData = decoder;
        char *formatData = format;

        sendProperty(player, "hwdec-current", MPV_FORMAT_STRING, &decoderData);
        sendProperty(player, "video-format", MPV_FORMAT_STRING, &formatData);

        QVERIFY(player.hardwareDecoderActive_);
        QVERIFY(player.videoPresent_);
    }

    void softwareVideoIsRejected() {
        MpvItem player;
        player.setActive(true);
        sendString(player, "video-format", "h264");
        sendString(player, "hwdec-current", "no");
        QSignalSpy events(&player, &MpvItem::playerEvent);

        QVERIFY(player.hardwareDecoderTimer_.isActive());
        QVERIFY(QMetaObject::invokeMethod(&player.hardwareDecoderTimer_, "timeout",
                                         Qt::DirectConnection));

        QVERIFY(!player.active());
        QCOMPARE(events.size(), 1);
        QCOMPARE(events.last().at(0).toString(), QStringLiteral("error"));
        QCOMPARE(events.last().at(1).toMap().value("code").toString(),
                 QStringLiteral("hardware-decoding-unavailable"));
    }
};

QTEST_MAIN(MpvItemTest)
#include "mpvitem_test.moc"
