#include "logging.h"
#include "closecoordinator.h"
#include "mpvitem.h"
#include "playbackprobe.h"
#include "streamengine.h"

#include <QCoreApplication>
#include <QDir>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQuickWebEngineProfile>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QSurfaceFormat>
#include <QTimer>
#include <QUrl>
#include <QtWebEngineQuick/qtwebenginequickglobal.h>

#include <clocale>
#include <cstdio>

namespace {

QUrl uiUrl() {
    const QString overrideUrl = qEnvironmentVariable("KINO_UI_URL");
    if (!overrideUrl.isEmpty()) {
        return QUrl::fromUserInput(overrideUrl);
    }
    const QDir executableDirectory(QCoreApplication::applicationDirPath());
    return QUrl::fromLocalFile(executableDirectory.absoluteFilePath(
        QStringLiteral("../Resources/ui/index.html")));
}

} // namespace

int main(int argc, char *argv[]) {
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    QSurfaceFormat surfaceFormat;
    surfaceFormat.setDepthBufferSize(24);
    surfaceFormat.setProfile(QSurfaceFormat::CoreProfile);
    surfaceFormat.setRenderableType(QSurfaceFormat::OpenGL);
    surfaceFormat.setVersion(4, 1);
    QSurfaceFormat::setDefaultFormat(surfaceFormat);
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    QtWebEngineQuick::initialize();

    QGuiApplication app(argc, argv);
    QCoreApplication::setApplicationName(QStringLiteral("Kino"));
    QCoreApplication::setApplicationVersion(QStringLiteral(KINO_VERSION));
    std::setlocale(LC_NUMERIC, "C");
    installLocalLogger();

    if (!qEnvironmentVariableIsEmpty("KINO_ENGINE_PROBE")) {
        auto *streamEngine = new StreamEngine(&app);
        QObject::connect(streamEngine, &StreamEngine::changed, &app, [streamEngine]() {
            if (streamEngine->url().isEmpty() && streamEngine->error().isEmpty()) {
                return;
            }
            std::printf("KINO_ENGINE_PROBE_RESULT %s\n",
                        qPrintable(streamEngine->url().isEmpty()
                                       ? QStringLiteral("error: %1").arg(streamEngine->error())
                                       : QUrl(streamEngine->url()).toString(
                                             QUrl::RemovePath | QUrl::RemoveQuery |
                                             QUrl::RemoveFragment | QUrl::RemoveUserInfo)));
            std::fflush(stdout);
            QCoreApplication::exit(streamEngine->url().isEmpty() ? 1 : 0);
        });
        QTimer::singleShot(30'000, &app, []() {
            std::printf("KINO_ENGINE_PROBE_RESULT error: timed out\n");
            std::fflush(stdout);
            QCoreApplication::exit(1);
        });
        streamEngine->start();
        return app.exec();
    }

    const QString probeMediaPath = qEnvironmentVariable("KINO_PLAYBACK_PROBE");
    if (!probeMediaPath.isEmpty()) {
        QQmlApplicationEngine probeEngine;
        QObject::connect(&probeEngine, &QQmlApplicationEngine::objectCreationFailed, &app,
                         []() { QCoreApplication::exit(1); }, Qt::QueuedConnection);
        probeEngine.loadFromModule("KinoShell", "Probe");
        auto *player = probeEngine.rootObjects().isEmpty()
                           ? nullptr
                           : probeEngine.rootObjects().first()->findChild<MpvItem *>(
                                 QStringLiteral("probePlayer"));
        if (!player) {
            qCritical("[kino:probe] probe scene has no player");
            return 1;
        }
        PlaybackProbe probe(player, probeMediaPath,
                            qEnvironmentVariable("KINO_PLAYBACK_PROBE_SUBS"), &app);
        probe.start();
        qInfo("[kino:probe] playback probe started");
        return app.exec();
    }

    QQmlApplicationEngine engine;
    auto *webProfile = new QQuickWebEngineProfile(QStringLiteral("kino"), &engine);
    webProfile->setHttpCacheType(QQuickWebEngineProfile::NoCache);
    webProfile->setPersistentCookiesPolicy(QQuickWebEngineProfile::ForcePersistentCookies);
    engine.setInitialProperties({
        {QStringLiteral("kinoWebProfile"), QVariant::fromValue(webProfile)},
        {QStringLiteral("kinoUiUrl"), uiUrl()},
    });
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app,
                     []() { QCoreApplication::exit(1); }, Qt::QueuedConnection);
    engine.loadFromModule("KinoShell", "Main");

    const QString closeProbe = qEnvironmentVariable("KINO_CLOSE_PROBE");
    if (!closeProbe.isEmpty() && !engine.rootObjects().isEmpty()) {
        auto *window = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
        auto *lifecycle = window ? window->findChild<CloseCoordinator *>() : nullptr;
        if (!lifecycle || (closeProbe != "window" && closeProbe != "quit")) return 1;
        QObject::connect(lifecycle, &CloseCoordinator::readyChanged, &app,
                         [window, lifecycle, closeProbe]() {
            if (!lifecycle->ready()) return;
            QTimer::singleShot(0, window, [window, closeProbe]() {
                if (closeProbe == "quit") QCoreApplication::quit();
                else window->close();
            });
        });
    }

    qInfo("[kino:shell] native shell started architecture=arm64");
    return app.exec();
}
