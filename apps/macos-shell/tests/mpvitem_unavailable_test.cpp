#include "mpvitem.h"

#include <QGuiApplication>
#include <QOffscreenSurface>
#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QQuickGraphicsDevice>
#include <QQuickRenderControl>
#include <QQuickRenderTarget>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QSignalSpy>
#include <QtTest>

#include <clocale>
#include <memory>

extern "C" int kino_test_render_contexts_requested();

namespace {
QStringList messages;

void capture(QtMsgType, const QMessageLogContext &, const QString &message) {
    messages.append(message);
}
} // namespace

// libmpv failing to start used to throw out of the QML constructor and end the
// process. The shell must keep running and report the player as unavailable.
class MpvItemUnavailableTest : public QObject {
    Q_OBJECT

private slots:
    void initTestCase() {
        std::setlocale(LC_NUMERIC, "C");
        qInstallMessageHandler(capture);
    }

    void failedStartupLeavesAnInertPlayer() {
        const QByteArray stage = qgetenv("KINO_TEST_MPV_FAILURE");
        QVERIFY2(!stage.isEmpty(), "KINO_TEST_MPV_FAILURE names the failing call");

        QOffscreenSurface surface;
        surface.setFormat(QSurfaceFormat::defaultFormat());
        surface.create();
        QOpenGLContext context;
        context.setFormat(surface.format());
        QVERIFY(context.create());
        QQuickRenderControl control;
        QQuickWindow window(&control);
        window.resize(320, 180);
        window.setGraphicsDevice(QQuickGraphicsDevice::fromOpenGLContext(&context));

        auto *player = new MpvItem(window.contentItem());
        player->setSize(QSizeF(320, 180));
        QVERIFY2(messages.contains(QStringLiteral("[kino:mpv] initialization failed stage=%1")
                                       .arg(QString::fromLatin1(stage))),
                 qPrintable(messages.join(QLatin1Char('\n'))));

        QVERIFY(context.makeCurrent(&surface));
        QVERIFY(control.initialize());
        auto target = std::make_unique<QOpenGLFramebufferObject>(QSize(320, 180));
        window.setRenderTarget(
            QQuickRenderTarget::fromOpenGLTexture(target->texture(), target->size()));
        auto render = [&]() {
            control.polishItems();
            control.beginFrame();
            control.sync();
            control.render();
            control.endFrame();
        };
        render();

        QSignalSpy events(player, &MpvItem::playerEvent);
        player->load(QStringLiteral("https://media.invalid/fixture.mkv"), false);
        QCOMPARE(events.size(), 1);
        QCOMPARE(events.first().at(0).toString(), QStringLiteral("error"));
        QCOMPARE(events.first().at(1).toMap().value(QStringLiteral("code")).toString(),
                 QStringLiteral("player-unavailable"));
        QVERIFY(!player->active());

        // Every other control the interface can reach stays harmless.
        player->seek(10);
        player->setPaused(false);
        player->togglePaused();
        player->setVolume(50);
        player->setMuted(true);
        player->setSubtitleTrack(1);
        player->setAudioTrack(1);
        player->setSubtitleDelay(1);
        player->setSubtitlePosition(90);
        player->setSubtitleScale(1.2);
        player->addSubtitles(QStringLiteral("https://media.invalid/en.srt"), {}, {});
        player->stop();
        QVERIFY(player->pauseAndSnapshot().isEmpty());
        QCOMPARE(player->version(), QStringLiteral("Unavailable"));
        QVERIFY(player->subtitleStyle().isEmpty());
        render();
        QCOMPARE(kino_test_render_contexts_requested(), 0);

        delete player;
        render();
        control.invalidate();
        window.setRenderTarget({});
        target.reset();
        context.doneCurrent();
    }
};

int main(int argc, char **argv) {
    // Match the shell: Qt Quick renders through OpenGL so mpv can share it.
    QSurfaceFormat format;
    format.setProfile(QSurfaceFormat::CoreProfile);
    format.setRenderableType(QSurfaceFormat::OpenGL);
    format.setVersion(4, 1);
    QSurfaceFormat::setDefaultFormat(format);
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    QGuiApplication app(argc, argv);
    MpvItemUnavailableTest test;
    return QTest::qExec(&test, argc, argv);
}
#include "mpvitem_unavailable_test.moc"
