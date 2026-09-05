#include "diagnostics.h"
#include "diagnosticbuildinfo.h"
#include "logging.h"

#include <QClipboard>
#include <QDesktopServices>
#include <QDir>
#include <QDirIterator>
#include <QGuiApplication>
#include <QStandardPaths>
#include <QSysInfo>
#include <QUrl>
#include <QtConcurrentRun>
#include <QtWebEngineCore/qtwebenginecoreglobal.h>

namespace {

QString cacheRoot() {
    return QStandardPaths::writableLocation(QStandardPaths::CacheLocation);
}

QString logDirectory() {
    return QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) +
           QStringLiteral("/logs");
}

qlonglong directoryBytes(const QString &path) {
    qlonglong total = 0;
    QDirIterator iterator(path, QDir::Files | QDir::NoSymLinks, QDirIterator::Subdirectories);
    while (iterator.hasNext()) {
        iterator.next();
        total += iterator.fileInfo().size();
    }
    return total;
}

} // namespace

QFuture<qlonglong> Diagnostics::cacheBytes() {
    const QString path = cacheRoot();
    return QtConcurrent::run([path]() { return directoryBytes(path); });
}

QFuture<bool> Diagnostics::clearCache() {
    const QString path = cacheRoot();
    return QtConcurrent::run([path]() {
        QDir directory(path);
        if (!directory.exists()) {
            return true;
        }
        // Clearing disposable cache never touches authentication, profiles,
        // library state, progress, add-ons, or Kino settings.
        bool cleared = true;
        for (const QString &entry : directory.entryList(QDir::NoDotAndDotDot | QDir::AllEntries)) {
            const QString target = directory.absoluteFilePath(entry);
            cleared = (QFileInfo(target).isDir() ? QDir(target).removeRecursively()
                                                 : QFile::remove(target)) &&
                      cleared;
        }
        if (!cleared) {
            qWarning("[kino:diagnostics] cache could not be fully cleared");
        }
        return cleared;
    });
}

bool Diagnostics::revealLogs() {
    const QString path = logDirectory();
    QDir().mkpath(path);
    const bool opened = QDesktopServices::openUrl(QUrl::fromLocalFile(path));
    if (!opened) {
        qWarning("[kino:diagnostics] log folder could not be opened");
    }
    return opened;
}

bool Diagnostics::copyDiagnosticSummary() {
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (!clipboard) return false;
    const auto info = engine_ ? engine_->diagnosticInfo() : QVariantMap{};
    const bool available = info.value("available").toBool();
    const bool external = info.value("external").toBool();
    const QString state = info.value("running").toBool() ? QStringLiteral("running")
        : available ? QStringLiteral("available") : QStringLiteral("unavailable");
    const QString engine = external
        ? QStringLiteral("External override (%1; version unknown)").arg(state)
        : available
            ? QStringLiteral("Kino %1, upstream %2 (%3)")
                  .arg(QStringLiteral(KINO_ENGINE_VERSION), QStringLiteral(KINO_ENGINE_REVISION), state)
            : QStringLiteral("Not bundled");
    const unsigned long api = mpv_client_api_version();
    // Build this from explicit fields. Account/profile objects, URLs, paths,
    // environment contents, and diagnostic logs never enter the summary.
    const QString summary = QStringList{
        QStringLiteral("Kino %1").arg(QCoreApplication::applicationVersion()),
        QStringLiteral("Platform: %1 (%2)").arg(QSysInfo::prettyProductName(), QSysInfo::currentCpuArchitecture()),
        QStringLiteral("Qt: %1").arg(QString::fromLatin1(qVersion())),
        QStringLiteral("Qt WebEngine: %1 (Chromium %2)")
            .arg(QString::fromLatin1(qWebEngineVersion()), QString::fromLatin1(qWebEngineChromiumVersion())),
        QStringLiteral("Stremio Core: %1").arg(QStringLiteral(KINO_CORE_VERSION)),
        QStringLiteral("Player: %1").arg(playback_ ? playback_->version() : QStringLiteral("Unavailable")),
        QStringLiteral("libmpv client API: %1.%2").arg(api >> 16).arg(api & 0xffff),
        QStringLiteral("Video decoder: VideoToolbox required, software fallback disabled"),
        QStringLiteral("Video output: SDR"),
        QStringLiteral("Streaming engine: %1").arg(engine),
    }.join(QLatin1Char('\n')) + QLatin1Char('\n');
    clipboard->setText(summary);
    return clipboard->text() == summary;
}

void Diagnostics::logWebMessage(int level, const QString &message) {
    // WebEngineView.JavaScriptConsoleMessageLevel uses info=0, warning=1, error=2.
    switch (level) {
    case 0:
        logWebConsoleMessage(QtInfoMsg, message);
        break;
    case 1:
        logWebConsoleMessage(QtWarningMsg, message);
        break;
    case 2:
        logWebConsoleMessage(QtCriticalMsg, message);
        break;
    default:
        break;
    }
}
