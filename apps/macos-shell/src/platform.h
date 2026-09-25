#pragma once

#include <QByteArray>
#include <QString>

// What differs between the operating systems Kino's shell runs on, other than
// the services that have classes of their own: Now Playing, sleep, the power
// guard, and display modes.
namespace Platform {

// "macos", "linux", or "windows", as the client and the logs name it.
QString name();

// The mpv hwdec list for this system. Every entry is a hardware decoder; the
// playback contract never lets mpv fall back to software.
QByteArray hardwareDecoders();

// Whether mpv's hwdec-current names one of the hardware decoders above.
bool isHardwareDecoder(const QString &current);

// How the diagnostic summary names the hardware decoders above.
QString hardwareDecoderName();

// A file shipped beside the shell: inside the app bundle's Resources on
// macOS, share/kino beside the executable's directory in an installed Linux
// tree, and the executable's own directory otherwise.
QString resourcePath(const QString &relative);

// A helper executable shipped in the shell's own directory.
QString helperPath(const QString &name);

// Ends a process at once. Only the interface-recovery probe uses it, to kill
// the web process the way a crash would.
bool killProcess(qint64 pid);

} // namespace Platform
