#include "logging.h"
#include "closecoordinator.h"
#include "diagnostics.h"
#include "mpvitem.h"
#include "platform.h"
#include "playbackprobe.h"
#include "singleinstance.h"
#include "streamengine.h"
#include "tlsroots.h"

#include <QCoreApplication>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQuickWebEngineProfile>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QSurfaceFormat>
#include <QSysInfo>
#include <QTimer>
#include <QUrl>
#include <QtWebEngineQuick/qtwebenginequickglobal.h>

#include <clocale>
#include <cstdio>
#include <memory>

namespace {

QUrl uiUrl() {
    const QString overrideUrl = qEnvironmentVariable("KINO_UI_URL");
    if (!overrideUrl.isEmpty()) {
        return QUrl::fromUserInput(overrideUrl);
    }
    return QUrl::fromLocalFile(Platform::resourcePath(QStringLiteral("ui/index.html")));
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
#if defined(Q_OS_LINUX)
    // Wayland matches the window to its launcher entry by this name.
    QGuiApplication::setDesktopFileName(QStringLiteral("com.chriscorbell.Kino"));
#endif
    std::setlocale(LC_NUMERIC, "C");
    installLocalLogger();
    TlsRoots::prepare();

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

    // Probes and development interfaces run beside a normal Kino; everything
    // else hands over to the Kino already running for this profile. The launch
    // probe names an instance of its own to check the hand-over.
    const QString instanceName = qEnvironmentVariable("KINO_INSTANCE_NAME");
    SingleInstance instance(instanceName);
    const bool sharesProfile = qEnvironmentVariableIsEmpty("KINO_UI_URL") &&
                               qEnvironmentVariableIsEmpty("KINO_CLOSE_PROBE") &&
                               qEnvironmentVariableIsEmpty("KINO_SCALE_PROBE") &&
                               qEnvironmentVariableIsEmpty("QTWEBENGINE_REMOTE_DEBUGGING");
    if ((sharesProfile || !instanceName.isEmpty()) && !instance.claim()) return 0;

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
    if (!engine.rootObjects().isEmpty()) {
        QObject *root = engine.rootObjects().first();
        if (auto *diagnostics = root->findChild<Diagnostics *>()) {
            diagnostics->setSources(root->findChild<MpvItem *>(), root->findChild<StreamEngine *>());
        }
        if (auto *window = qobject_cast<QQuickWindow *>(root)) {
            QObject::connect(&instance, &SingleInstance::activationRequested, window, [window]() {
                qInfo("[kino:shell] brought forward by a second launch");
                if (window->visibility() == QWindow::Minimized) window->showNormal();
                else window->show();
                window->raise();
                window->requestActivate();
            });
        }
    }


    const QString closeProbe = qEnvironmentVariable("KINO_CLOSE_PROBE");
    if (!closeProbe.isEmpty() && !engine.rootObjects().isEmpty()) {
        auto *window = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
        auto *lifecycle = window ? window->findChild<CloseCoordinator *>() : nullptr;
        if (!lifecycle || (closeProbe != "window" && closeProbe != "quit" &&
                           closeProbe != "interface-lost")) {
            return 1;
        }
        if (qEnvironmentVariableIsSet("KINO_SCALE_PROBE")) window->resize(window->minimumSize());
        // interface-lost kills the web process once the page reports ready,
        // then quits as soon as the shell has noticed, the way a user would
        // after the window goes blank.
        auto interfaceKilled = std::make_shared<bool>(false);
        QObject::connect(lifecycle, &CloseCoordinator::readyChanged, &app,
                         [window, lifecycle, closeProbe, interfaceKilled]() {
            if (closeProbe == "interface-lost") {
                if (lifecycle->ready() && !*interfaceKilled) {
                    auto *view = window->findChild<QObject *>(QStringLiteral("webView"));
                    const qint64 pid = view ? view->property("renderProcessPid").toLongLong() : 0;
                    if (!Platform::killProcess(pid)) {
                        QCoreApplication::exit(1);
                        return;
                    }
                    *interfaceKilled = true;
                } else if (!lifecycle->ready() && *interfaceKilled) {
                    QTimer::singleShot(0, window, []() { QCoreApplication::quit(); });
                }
                return;
            }
            if (!lifecycle->ready()) return;
            QTimer::singleShot(0, window, [window, closeProbe]() {
                if (closeProbe == "quit") QCoreApplication::quit();
                else window->close();
            });
        });
    }

    qInfo("[kino:shell] native shell started platform=%s architecture=%s",
          qPrintable(Platform::name()), qPrintable(QSysInfo::currentCpuArchitecture()));
    return app.exec();
}
