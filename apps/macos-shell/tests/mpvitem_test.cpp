#include "mpvitem.h"

#include <QSignalSpy>
#include <QtTest>

#include <clocale>
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
    void initTestCase() {
        // Match the application after Qt initializes the system locale.
        std::setlocale(LC_NUMERIC, "C");
    }

    void volumeProperty() {
        MpvItem player;
        QSignalSpy events(&player, &MpvItem::playerEvent);
        double volume = 37.5;
        sendProperty(player, "volume", MPV_FORMAT_DOUBLE, &volume);
        QCOMPARE(events.size(), 1);
        QCOMPARE(events.first().first().toString(), QStringLiteral("volume"));
        QCOMPARE(events.first().at(1).toMap().value("percent").toDouble(), 37.5);
    }

    // The caption style must come from Kino, not from a libmpv default that
    // could change, and it must survive a load, a track switch, and an
    // external subtitle. Every value is read back from the live player.
    static void verifyOutlinedSubtitles(const MpvItem &player, const char *stage) {
        const QVariantMap style = player.subtitleStyle();
        auto value = [&](const char *name) { return style.value(QLatin1String(name)).toString(); };
        QVERIFY2(!style.isEmpty(), stage);
        // Fully transparent alpha. libmpv also draws the shadow in this colour.
        QCOMPARE(value("sub-back-color"), QStringLiteral("#00000000"));
        QCOMPARE(value("sub-shadow-offset"), QStringLiteral("0.000000"));
        QCOMPARE(value("sub-border-style"), QStringLiteral("outline-and-shadow"));
        QCOMPARE(value("sub-color"), QStringLiteral("#FFFFFFFF"));
        QCOMPARE(value("sub-outline-color"), QStringLiteral("#FF000000"));
        QCOMPARE(value("sub-blur"), QStringLiteral("0.000000"));
        QVERIFY2(value("sub-outline-size").toDouble() > 0, stage);
        // Authored ASS/SSA styling keeps its positions, fonts, and italics.
        QCOMPARE(value("sub-ass-override"), QStringLiteral("scale"));
        const QString overrides = value("sub-ass-style-overrides");
        // BorderStyle 3 draws an opaque box; 1 draws the requested outline.
        QVERIFY2(overrides.contains(QStringLiteral("BorderStyle=1")), stage);
        // ASS colours are &HAABBGGRR, so 00 is opaque and FF is transparent.
        QVERIFY2(overrides.contains(QStringLiteral("BackColour=&HFF000000&")), stage);
        QVERIFY2(overrides.contains(QStringLiteral("OutlineColour=&H00000000&")), stage);
        QVERIFY2(overrides.contains(QStringLiteral("Shadow=0")), stage);
    }

    void subtitlesRenderOutlinedWithoutABox() {
        MpvItem player;
        verifyOutlinedSubtitles(player, "after initialization");

        player.load(QStringLiteral("https://media.invalid/fixture.mkv"), false);
        verifyOutlinedSubtitles(player, "after loading a source");

        player.setSubtitleTrack(2);
        player.setSubtitleScale(1.5);
        player.setSubtitlePosition(90);
        verifyOutlinedSubtitles(player, "after switching tracks");

        player.addSubtitles(QStringLiteral("https://media.invalid/fixture.srt"),
                            QStringLiteral("English"), QStringLiteral("en"));
        verifyOutlinedSubtitles(player, "after adding external subtitles");
    }

    void subtitleVariantMetadata_data() {
        QTest::addColumn<bool>("flag");
        QTest::newRow("variant") << true;
        QTest::newRow("ordinary") << false;
    }

    void subtitleVariantMetadata() {
        QFETCH(bool, flag);
        char typeKey[] = "type", idKey[] = "id", titleKey[] = "title";
        char forcedKey[] = "forced", hearingKey[] = "hearing-impaired";
        char subtitleType[] = "sub", title[] = "English SDH";
        char *keys[]{typeKey, idKey, titleKey, forcedKey, hearingKey};
        mpv_node fields[5]{};
        fields[0].format = MPV_FORMAT_STRING;
        fields[0].u.string = subtitleType;
        fields[1].format = MPV_FORMAT_INT64;
        fields[1].u.int64 = 7;
        fields[2].format = MPV_FORMAT_STRING;
        fields[2].u.string = title;
        for (int index : {3, 4}) {
            fields[index].format = MPV_FORMAT_FLAG;
            fields[index].u.flag = flag ? 1 : 0;
        }
        mpv_node_list trackFields{5, fields, keys};
        mpv_node track{};
        track.format = MPV_FORMAT_NODE_MAP;
        track.u.list = &trackFields;
        mpv_node_list tracks{1, &track, nullptr};
        mpv_node root{};
        root.format = MPV_FORMAT_NODE_ARRAY;
        root.u.list = &tracks;

        MpvItem player;
        QSignalSpy events(&player, &MpvItem::playerEvent);
        sendProperty(player, "track-list", MPV_FORMAT_NODE, &root);
        QCOMPARE(events.size(), 2);
        QCOMPARE(events.at(1).first().toString(), QStringLiteral("audioTracks"));
        QVERIFY(events.at(1).at(1).toMap().value("items").toList().isEmpty());
        QCOMPARE(events.first().first().toString(), QStringLiteral("subtitleTracks"));
        const auto items = events.first().at(1).toMap().value("items").toList();
        QCOMPARE(items.size(), 1);
        const auto item = items.first().toMap();
        QCOMPARE(item.value("id").toInt(), 7);
        QCOMPARE(item.value("title").toString(), QStringLiteral("English SDH"));
        QVERIFY(item.contains("forced"));
        QVERIFY(item.contains("hearingImpaired"));
        QCOMPARE(item.value("forced").toBool(), flag);
        QCOMPARE(item.value("hearingImpaired").toBool(), flag);
    }

    void invalidRequestHeaders_data() {
        QTest::addColumn<QVariantMap>("headers");
        QTest::newRow("header-name-injection") << QVariantMap{{"X-Test\r\nInjected", "value"}};
        QTest::newRow("header-value-injection") << QVariantMap{{"X-Test", "value\r\nInjected: value"}};
        QTest::newRow("non-string") << QVariantMap{{"X-Test", 42}};
        QTest::newRow("host-override") << QVariantMap{{"Host", "another.invalid"}};
        QTest::newRow("range-override") << QVariantMap{{"Range", "bytes=0-10"}};
        QTest::newRow("duplicate-name") << QVariantMap{{"X-Test", "one"}, {"x-test", "two"}};
        QTest::newRow("oversized") << QVariantMap{{"X-Test", QString(65537, QLatin1Char('x'))}};
    }

    void invalidRequestHeaders() {
        QFETCH(QVariantMap, headers);
        MpvItem player;
        QSignalSpy events(&player, &MpvItem::playerEvent);
        player.load(QStringLiteral("https://media.invalid/fixture.mp4"), false, headers);
        QVERIFY(!player.active());
        QCOMPARE(events.size(), 1);
        QCOMPARE(events.first().at(0).toString(), QStringLiteral("error"));
        QCOMPARE(events.first().at(1).toMap().value("code").toString(),
                 QStringLiteral("invalid-request-headers"));
    }

    void requestHeaderLogsStayPrivateAfterStop() {
        MpvItem player;
        // A rejected request also protects late free-form logs. The structured
        // error code remains available without including any header contents.
        player.load(QStringLiteral("https://media.invalid/fixture.mp4"), false,
                    {{"X-Private", "synthetic credential\r\n"}});
        player.stop();
        mpv_event_log_message message{"ffmpeg", "warn", "synthetic credential, continuation", MPV_LOG_LEVEL_WARN};
        mpv_event event{};
        event.event_id = MPV_EVENT_LOG_MESSAGE;
        event.data = &message;
        QTest::ignoreMessage(QtWarningMsg, "[kino:mpv] message omitted for media with request headers");
        player.handleEvent(&event);
    }

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
