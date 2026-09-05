#include "mpvitem.h"

#include <QGuiApplication>
#include <QOffscreenSurface>
#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QQuickGraphicsDevice>
#include <QQuickRenderControl>
#include <QQuickRenderTarget>
#include <QQuickWindow>
#include <QSignalSpy>
#include <QSurfaceFormat>
#include <QThread>
#include <functional>
#include <QtTest>

#include <clocale>

extern "C" int kino_render_contexts_created();
extern "C" int kino_render_contexts_freed();
extern "C" int kino_render_cores_destroyed();

// Unlike a window's resource-release hint, invalidate() always frees the
// scene graph. Keep the item alive to check reconstruction on the same core.
class OffscreenScene {
    bool threaded_;
    QThread renderThread_;
    QObject worker_;
    QThread *guiThread_ = QThread::currentThread();

    void onRenderThread(const std::function<void()> &action) {
        if (threaded_) QMetaObject::invokeMethod(&worker_, action, Qt::BlockingQueuedConnection);
        else action();
    }

public:
    explicit OffscreenScene(bool threaded) : threaded_(threaded) {}
    QOffscreenSurface surface;
    QOpenGLContext context;
    QQuickRenderControl control;
    QQuickWindow window{&control};
    std::unique_ptr<QOpenGLFramebufferObject> target;
    MpvItem *player = nullptr;

    bool initialize() {
        surface.setFormat(QSurfaceFormat::defaultFormat());
        surface.create();
        context.setFormat(surface.format());
        if (!context.create() || !context.makeCurrent(&surface)) return false;
        context.doneCurrent();
        if (threaded_) {
            context.moveToThread(&renderThread_);
            worker_.moveToThread(&renderThread_);
            control.prepareThread(&renderThread_);
            renderThread_.start();
        }
        window.resize(320, 180);
        window.setColor(Qt::black);
        window.setGraphicsDevice(QQuickGraphicsDevice::fromOpenGLContext(&context));
        player = new MpvItem(window.contentItem());
        player->setSize(QSizeF(320, 180));
        return initializeRendering();
    }

    bool initializeRendering() {
        bool initialized = false;
        onRenderThread([&]() {
            if (!context.makeCurrent(&surface) || !control.initialize()) return;
            target = std::make_unique<QOpenGLFramebufferObject>(QSize(320, 180));
            window.setRenderTarget(QQuickRenderTarget::fromOpenGLTexture(target->texture(), target->size()));
            initialized = true;
        });
        if (initialized) render();
        return initialized;
    }

    void render() {
        control.polishItems();
        onRenderThread([&]() {
            context.makeCurrent(&surface);
            control.beginFrame();
            control.sync();
            control.render();
            control.endFrame();
        });
    }

    bool hasVideoPixels() {
        QImage frame;
        onRenderThread([&]() {
            context.makeCurrent(&surface);
            frame = target->toImage();
        });
        QSet<QRgb> colors;
        for (int y = 0; y < frame.height(); y += 8) {
            for (int x = 0; x < frame.width(); x += 8) colors.insert(frame.pixel(x, y));
        }
        return colors.size() > 20;
    }

    void invalidate() {
        onRenderThread([&]() {
            context.makeCurrent(&surface);
            control.invalidate();
            window.setRenderTarget({});
            target.reset();
        });
    }

    ~OffscreenScene() {
        if (!player) return;
        invalidate();
        if (threaded_) {
            onRenderThread([&]() {
                context.doneCurrent();
                context.moveToThread(guiThread_);
                control.prepareThread(guiThread_);
                worker_.moveToThread(guiThread_);
            });
            renderThread_.quit();
            renderThread_.wait();
        }
    }
};

class RenderLifetimeTest : public QObject {
    Q_OBJECT

    static MpvItem *createPlayer(QQuickWindow &window) {
        window.resize(320, 180);
        window.setPersistentGraphics(false);
        window.setPersistentSceneGraph(false);
        auto *player = new MpvItem(window.contentItem());
        player->setSize(QSizeF(320, 180));
        window.show();
        return player;
    }

private slots:
    void itemAndWindowDeletion_data() {
        QTest::addColumn<bool>("itemFirst");
        QTest::newRow("item-before-window") << true;
        QTest::newRow("window-owns-item") << false;
    }

    void itemAndWindowDeletion() {
        QFETCH(bool, itemFirst);
        for (int iteration = 0; iteration < 3; ++iteration) {
            const int created = kino_render_contexts_created();
            const int freed = kino_render_contexts_freed();
            const int destroyed = kino_render_cores_destroyed();
            auto window = std::make_unique<QQuickWindow>();
            auto *player = createPlayer(*window);
            QVERIFY(QTest::qWaitForWindowExposed(window.get()));
            QTRY_COMPARE(kino_render_contexts_created(), created + 1);
            // GUI item destruction must not depend on a context Qt happened
            // to leave current after its previous frame.
            if (auto *context = QOpenGLContext::currentContext()) context->doneCurrent();
            if (itemFirst) delete player;
            window.reset();
            QTRY_COMPARE(kino_render_contexts_freed(), freed + 1);
            QTRY_COMPARE(kino_render_cores_destroyed(), destroyed + 1);
        }
    }

    void sceneGraphInvalidation_data() {
        QTest::addColumn<bool>("threaded");
        QTest::newRow("gui-rendering") << false;
        QTest::newRow("dedicated-render-thread") << true;
    }

    void sceneGraphInvalidation() {
        QFETCH(bool, threaded);
        const int created = kino_render_contexts_created();
        const int freed = kino_render_contexts_freed();
        const int destroyed = kino_render_cores_destroyed();
        {
            OffscreenScene scene(threaded);
            QVERIFY(scene.initialize());
            QCOMPARE(kino_render_contexts_created(), created + 1);
            for (int iteration = 0; iteration < 3; ++iteration) {
                scene.invalidate();
                QCOMPARE(kino_render_contexts_freed(), freed + iteration + 1);
                QCOMPARE(kino_render_cores_destroyed(), destroyed);
                QVERIFY(scene.initializeRendering());
                QCOMPARE(kino_render_contexts_created(), created + iteration + 2);
            }
        }
        QCOMPARE(kino_render_contexts_freed(), freed + 4);
        QCOMPARE(kino_render_cores_destroyed(), destroyed + 1);
    }

    void playbackAcrossInvalidation_data() { sceneGraphInvalidation_data(); }

    void playbackAcrossInvalidation() {
        QFETCH(bool, threaded);
        const QString media = qEnvironmentVariable("KINO_LIFETIME_MEDIA");
        if (media.isEmpty()) QSKIP("Set KINO_LIFETIME_MEDIA to a legal video fixture for playback validation.");
        OffscreenScene scene(threaded);
        QVERIFY(scene.initialize());
        auto *player = scene.player;
        QSignalSpy events(player, &MpvItem::playerEvent);
        auto played = [&events, &scene]() {
            scene.render();
            for (const auto &event : events) {
                if (event.at(0) == QStringLiteral("time") &&
                    event.at(1).toMap().value("milliseconds").toLongLong() >= 500) return scene.hasVideoPixels();
            }
            return false;
        };
        for (int iteration = 0; iteration < 3; ++iteration) {
            events.clear();
            player->load(media, true);
            QTRY_VERIFY_WITH_TIMEOUT(played(), 10'000);
            player->stop();
            const int freed = kino_render_contexts_freed();
            scene.invalidate();
            QCOMPARE(kino_render_contexts_freed(), freed + 1);
            QVERIFY(scene.initializeRendering());
        }
        events.clear();
        player->load(media, true);
        QTRY_VERIFY_WITH_TIMEOUT(played(), 10'000);
        // Delete the item while playback and callbacks are still active, then
        // release the render resources that retained its core.
        delete player;
        scene.invalidate();
    }
};

int main(int argc, char **argv) {
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    QSurfaceFormat format;
    format.setDepthBufferSize(24);
    format.setProfile(QSurfaceFormat::CoreProfile);
    format.setRenderableType(QSurfaceFormat::OpenGL);
    format.setVersion(4, 1);
    QSurfaceFormat::setDefaultFormat(format);
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    QGuiApplication app(argc, argv);
    std::setlocale(LC_NUMERIC, "C");
    RenderLifetimeTest test;
    return QTest::qExec(&test, argc, argv);
}

#include "render_lifetime_test.moc"
