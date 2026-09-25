#include "nowplaying.h"

#include <cmath>

// The bookkeeping every system shares. Each platform file supplies the
// constructor, the destructor, and publish(), which hands the state to the
// system's media controls and then calls published().

namespace {

double secondsSince(std::chrono::steady_clock::time_point then) {
    return std::chrono::duration<double>(std::chrono::steady_clock::now() - then).count();
}

} // namespace

void NowPlaying::setActive(bool active) {
    if (active_ == active) {
        return;
    }
    active_ = active;
    if (!active_) {
        duration_ = 0;
        position_ = 0;
        subtitle_.clear();
        title_.clear();
    }
    publish();
}

void NowPlaying::setDuration(double seconds) {
    const bool changed = std::fabs(seconds - duration_) > 0.5;
    duration_ = seconds;
    if (active_ && changed) {
        publish();
    }
}

void NowPlaying::setMetadata(const QString &title, const QString &subtitle) {
    title_ = title;
    subtitle_ = subtitle;
    if (active_) {
        publish();
    }
}

void NowPlaying::setPaused(bool paused) {
    const bool changed = paused_ != paused;
    paused_ = paused;
    if (active_ && changed) {
        publish();
    }
}

void NowPlaying::setPosition(double seconds) {
    position_ = seconds;
    if (!active_) {
        return;
    }
    // The system extrapolates elapsed time from the published rate; republish
    // only when the real position drifts from that projection, such as a seek.
    const double projected =
        publishedPosition_ + (paused_ ? 0.0 : secondsSince(publishedAt_));
    if (std::fabs(seconds - projected) > 2.0) {
        publish();
    }
}

void NowPlaying::published() {
    publishedPosition_ = position_;
    publishedAt_ = std::chrono::steady_clock::now();
}

double NowPlaying::projectedPosition() const {
    return publishedPosition_ + (active_ && !paused_ ? secondsSince(publishedAt_) : 0.0);
}
