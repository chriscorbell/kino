#include "nowplaying.h"

// Windows reads media keys and its media flyout from the System Media
// Transport Controls, which Kino does not publish to yet. The state is kept so
// that adding them changes only this file.

NowPlaying::NowPlaying(QObject *parent) : QObject(parent) {
    qInfo("[kino:media] media controls unavailable reason=unsupported");
}

NowPlaying::~NowPlaying() = default;

void NowPlaying::publish() {
    published();
}
