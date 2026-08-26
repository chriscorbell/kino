#include "diagnostics.h"

#include <QDesktopServices>
#include <QDir>
#include <QDirIterator>
#include <QStandardPaths>
#include <QUrl>
#include <QtConcurrentRun>

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
