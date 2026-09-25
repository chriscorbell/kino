#include "platform.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>

#if defined(Q_OS_WIN)
#include <windows.h>
#else
#include <csignal>
#include <sys/types.h>
#endif

namespace Platform {

QString name() {
#if defined(Q_OS_MACOS)
    return QStringLiteral("macos");
#elif defined(Q_OS_WIN)
    return QStringLiteral("windows");
#else
    return QStringLiteral("linux");
#endif
}

QByteArray hardwareDecoders() {
#if defined(Q_OS_MACOS)
    return QByteArrayLiteral("videotoolbox");
#elif defined(Q_OS_WIN)
    // The shell renders through OpenGL, which has no zero-copy path for
    // Direct3D 11 frames outside ANGLE. The copy variant still decodes on the
    // GPU and hands mpv the decoded frames.
    return QByteArrayLiteral("d3d11va,d3d11va-copy");
#else
    // VA-API covers AMD and Intel, NVDEC covers NVIDIA. The copy variants
    // decode on the GPU too, for when mpv cannot share frames with Qt's
    // OpenGL context.
    return QByteArrayLiteral("vaapi,nvdec,vaapi-copy,nvdec-copy");
#endif
}

bool isHardwareDecoder(const QString &current) {
    return !current.isEmpty() && hardwareDecoders().split(',').contains(current.toLatin1());
}

QString hardwareDecoderName() {
#if defined(Q_OS_MACOS)
    return QStringLiteral("VideoToolbox");
#elif defined(Q_OS_WIN)
    return QStringLiteral("Direct3D 11");
#else
    return QStringLiteral("VA-API or NVDEC");
#endif
}

QString resourcePath(const QString &relative) {
    const QDir executable(QCoreApplication::applicationDirPath());
#if defined(Q_OS_MACOS)
    return executable.absoluteFilePath(QStringLiteral("../Resources/") + relative);
#else
#if !defined(Q_OS_WIN)
    const QString installed = executable.absoluteFilePath(QStringLiteral("../share/kino"));
    if (QFileInfo(installed).isDir()) return QDir(installed).absoluteFilePath(relative);
#endif
    return executable.absoluteFilePath(relative);
#endif
}

QString helperPath(const QString &name) {
#if defined(Q_OS_WIN)
    const QString file = name + QStringLiteral(".exe");
#else
    const QString &file = name;
#endif
    return QDir(QCoreApplication::applicationDirPath()).absoluteFilePath(file);
}

bool killProcess(qint64 pid) {
    if (pid <= 0) return false;
#if defined(Q_OS_WIN)
    HANDLE process = OpenProcess(PROCESS_TERMINATE, FALSE, static_cast<DWORD>(pid));
    if (!process) return false;
    const bool killed = TerminateProcess(process, 1) != 0;
    CloseHandle(process);
    return killed;
#else
    return ::kill(static_cast<pid_t>(pid), SIGKILL) == 0;
#endif
}

} // namespace Platform
