#include "mpvitem.h"
#include "platform.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QSignalSpy>
#include <QtTest>

#include <algorithm>
#include <clocale>
#include <cstring>

class MpvItemTest : public QObject {
    Q_OBJECT

    static void sendProperty(MpvItem &player, const char *name, mpv_format format,
                             void *data) {
        mpv_event_property property{name, format, data};
        sendEvent(player, MPV_EVENT_PROPERTY_CHANGE, &property);
    }

    static void sendEvent(MpvItem &player, mpv_event_id id, void *data = nullptr) {
        mpv_event event{};
        event.event_id = id;
        event.data = data;
        player.handleEvent(&event);
    }

    static void sendTime(MpvItem &player, double seconds) {
        sendProperty(player, "time-pos", MPV_FORMAT_DOUBLE, &seconds);
    }

    static QStringList eventNames(const QSignalSpy &events) {
        QStringList names;
        for (const auto &event : events) names.append(event.first().toString());
        return names;
    }

    static QList<qlonglong> sentMilliseconds(const QSignalSpy &events, QLatin1String name) {
        QList<qlonglong> sent;
        for (const auto &event : events)
            if (event.first().toString() == name)
                sent.append(event.at(1).toMap().value("milliseconds").toLongLong());
        return sent;
    }

    static QList<qlonglong> sentTimes(const QSignalSpy &events) {
        return sentMilliseconds(events, QLatin1String("time"));
    }

    // What the live player holds, not what Kino last asked for.
    static bool mpvPaused(MpvItem &player) {
        int paused = -1;
        if (mpv_get_property(player.handle_, "pause", MPV_FORMAT_FLAG, &paused) < 0) return false;
        return paused == 1;
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

    void bufferedProperty() {
        MpvItem player;
        QSignalSpy events(&player, &MpvItem::playerEvent);
        auto buffered = [&](double seconds) {
            sendProperty(player, "demuxer-cache-time", MPV_FORMAT_DOUBLE, &seconds);
        };
        buffered(12.5);
        buffered(12.9);
        buffered(14.0);
        buffered(3.0);
        QCOMPARE(eventNames(events), QStringList(3, QStringLiteral("buffered")));
        // Sub-second growth is folded into the next whole second; a seek back reports at once.
        QCOMPARE(sentMilliseconds(events, QLatin1String("buffered")),
                 (QList<qlonglong>{12500, 14000, 3000}));
    }

    void timeReachesTheInterfaceFourTimesASecond() {
        MpvItem player;
        QSignalSpy events(&player, &MpvItem::playerEvent);
        // mpv reports the position once per frame: three seconds of 24 fps video.
        for (int frame = 0; frame <= 72; ++frame) sendTime(player, frame / 24.0);
        QList<qlonglong> expected;
        for (qlonglong milliseconds = 0; milliseconds <= 3000; milliseconds += 250)
            expected.append(milliseconds);
        QCOMPARE(sentTimes(events), expected);
    }

    void seekPauseAndEndSendTimeAtOnce() {
        MpvItem player;
        QSignalSpy events(&player, &MpvItem::playerEvent);
        sendTime(player, 10.0);
        sendTime(player, 10.1);
        player.setPaused(true);
        int paused = 1;
        sendProperty(player, "pause", MPV_FORMAT_FLAG, &paused);
        // The pause reports the position it stopped at before it reports the pause.
        QCOMPARE(eventNames(events), (QStringList{"time", "time", "paused"}));
        QCOMPARE(sentTimes(events), (QList<qlonglong>{10000, 10100}));

        events.clear();
        sendEvent(player, MPV_EVENT_SEEK);
        sendTime(player, 10.15);
        sendTime(player, 10.2);
        sendEvent(player, MPV_EVENT_PLAYBACK_RESTART);
        QCOMPARE(sentTimes(events), (QList<qlonglong>{10150, 10200}));

        events.clear();
        sendTime(player, 10.3);
        mpv_event_end_file end{};
        end.reason = MPV_END_FILE_REASON_EOF;
        sendEvent(player, MPV_EVENT_END_FILE, &end);
        QCOMPARE(eventNames(events), (QStringList{"time", "ended"}));
        QCOMPARE(sentTimes(events), (QList<qlonglong>{10300}));
    }

    void displaySwitchKeepsALaterPause_data() {
        QTest::addColumn<QString>("during");
        QTest::addColumn<bool>("pausedAfter");
        QTest::newRow("nothing") << QString() << false;
        QTest::newRow("viewer-pause") << QStringLiteral("viewer") << true;
        QTest::newRow("exit") << QStringLiteral("exit") << true;
        QTest::newRow("system-sleep") << QStringLiteral("sleep") << true;
    }

    void displaySwitchKeepsALaterPause() {
        QFETCH(QString, during);
        QFETCH(bool, pausedAfter);
        MpvItem player;
        player.setActive(true);
        player.setMatchFrameRate(true);
        int playing = 0;
        sendProperty(player, "pause", MPV_FORMAT_FLAG, &playing);
        // No display mode is a whole multiple of a megahertz, so the hold runs and nothing
        // switches the display the test runs on.
        player.matchDisplayTo(1e6);
        QVERIFY(mpvPaused(player));
        if (during == QLatin1String("viewer")) player.setPaused(true);
        if (during == QLatin1String("exit")) player.pauseAndSnapshot();
        if (during == QLatin1String("sleep")) player.pauseForSleep();
        QTest::qWait(100);
        QCOMPARE(mpvPaused(player), pausedAfter);
    }

    // Every pause reaches mpv through writePause, which knows why it pauses and what a display
    // switch's hold may undo. A second writer could resume playback the viewer paused.
    void pauseHasOneWriter() {
        QFile file(QStringLiteral(KINO_MPVITEM_SOURCE));
        // Text mode reads a Windows checkout's CRLF line endings as LF.
        QVERIFY(file.open(QIODevice::ReadOnly | QIODevice::Text));
        const QString source = QString::fromUtf8(file.readAll());
        const qsizetype start = source.indexOf(QLatin1String("void MpvItem::writePause("));
        QVERIFY(start >= 0);
        const qsizetype end = source.indexOf(QLatin1String("\n}\n"), start);
        QVERIFY(end > start);
        const QString outside = source.left(start) + source.mid(end);
        static const QRegularExpression pauseLiteral(QStringLiteral(R"(^.*"[^"\n]*\bpause\b[^"\n]*".*$)"),
                                                     QRegularExpression::MultilineOption);
        int reads = 0;
        for (const auto &match : pauseLiteral.globalMatch(outside)) {
            const QString line = match.captured().trimmed();
            QVERIFY2(line.startsWith(QLatin1String("mpv_observe_property(")) ||
                         line.contains(QLatin1String("name == \"pause\"")),
                     qPrintable(QStringLiteral("mpvitem.cpp names mpv's pause outside writePause: %1. "
                                               "Write it through writePause with a PauseReason.")
                                    .arg(line)));
            ++reads;
        }
        QCOMPARE(reads, 2);
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

    // The TV's ParityTest reads the same cases, so both clients refuse the same header sets.
    void requestHeaders_data() {
        QTest::addColumn<QVariantMap>("headers");
        QTest::addColumn<bool>("refused");
        QFile file(QStringLiteral(KINO_PROXY_HEADER_CASES));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const auto cases = QJsonDocument::fromJson(file.readAll()).object().value("cases").toArray();
        QVERIFY(!cases.isEmpty());
        for (const auto &entry : cases) {
            const auto item = entry.toObject();
            auto headers = item.value("headers").toObject().toVariantMap();
            const auto fill = item.value("fill").toObject();
            const auto value = fill.value("value").toString().repeated(fill.value("repeat").toInt());
            for (int index = 1; index <= fill.value("count").toInt(); ++index) {
                headers.insert(QStringLiteral("X-Fill-%1").arg(index), value);
            }
            QTest::newRow(qPrintable(item.value("name").toString()))
                << headers << item.value("refused").toBool();
        }
        // Core holds header values as strings, so only the desktop bridge can pass anything else.
        QTest::newRow("non-string") << QVariantMap{{"X-Test", 42}} << true;
    }

    void requestHeaders() {
        QFETCH(QVariantMap, headers);
        QFETCH(bool, refused);
        MpvItem player;
        QSignalSpy events(&player, &MpvItem::playerEvent);
        player.load(QStringLiteral("https://media.invalid/fixture.mp4"), false, headers);
        QCOMPARE(player.active(), !refused);
        const bool refusal = std::any_of(events.cbegin(), events.cend(), [](const QList<QVariant> &event) {
            return event.at(0).toString() == QStringLiteral("error") &&
                   event.at(1).toMap().value("code").toString() ==
                       QStringLiteral("invalid-request-headers");
        });
        QCOMPARE(refusal, refused);
        if (refused) {
            QCOMPARE(events.size(), 1);
        }
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
        // Each system accepts its own decoders only: VideoToolbox is not a
        // hardware decoder Kino uses on Linux, nor VA-API on a Mac.
        for (const QByteArray &decoder : Platform::hardwareDecoders().split(','))
            QTest::newRow(decoder.constData()) << decoder << true;
        for (const char *other : {"videotoolbox", "vaapi", "d3d11va"})
            if (!Platform::hardwareDecoders().split(',').contains(other))
                QTest::newRow(other) << QByteArray(other) << false;
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
        sendString(player, "hwdec-current", Platform::hardwareDecoders().split(',').first());
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
        const QByteArray decoder = Platform::hardwareDecoders().split(',').first();
        sendString(player, "hwdec-current",
                   name == "hwdec-current" ? decoder.constData() : "no");
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
        alignas(256) char decoder[32] = {};
        const QByteArray name = Platform::hardwareDecoders().split(',').first();
        std::memcpy(decoder, name.constData(), size_t(name.size()));
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
