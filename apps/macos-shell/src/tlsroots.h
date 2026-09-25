#pragma once

#include <QString>

// The bundled FFmpeg and libtorrent link Homebrew's OpenSSL, whose built-in
// certificate directory exists only on a Mac with Homebrew. Kino exports the
// system trust anchors to its own bundle and hands that file to both, so HTTPS
// media and trackers verify against the same roots Safari trusts.
namespace TlsRoots {

// Starts exporting the system roots on a worker thread. Safe to call again.
void prepare();

// The exported bundle's path, waiting for the export if it is still running.
// Empty when no roots could be exported.
QString bundlePath();

} // namespace TlsRoots
