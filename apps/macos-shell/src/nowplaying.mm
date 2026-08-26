#include "nowplaying.h"

#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>

#include <cmath>

namespace {

double systemUptimeSeconds() {
    return [[NSProcessInfo processInfo] systemUptime];
}

} // namespace

NowPlaying::NowPlaying(QObject *parent) : QObject(parent) {
    MPRemoteCommandCenter *commands = [MPRemoteCommandCenter sharedCommandCenter];
    [commands.playCommand addTargetWithHandler:^(MPRemoteCommandEvent *) {
        if (!active_) {
            return MPRemoteCommandHandlerStatusNoActionableNowPlayingItem;
        }
        emit playRequested();
        return MPRemoteCommandHandlerStatusSuccess;
    }];
    [commands.pauseCommand addTargetWithHandler:^(MPRemoteCommandEvent *) {
        if (!active_) {
            return MPRemoteCommandHandlerStatusNoActionableNowPlayingItem;
        }
        emit pauseRequested();
        return MPRemoteCommandHandlerStatusSuccess;
    }];
    [commands.togglePlayPauseCommand addTargetWithHandler:^(MPRemoteCommandEvent *) {
        if (!active_) {
            return MPRemoteCommandHandlerStatusNoActionableNowPlayingItem;
        }
        emit toggleRequested();
        return MPRemoteCommandHandlerStatusSuccess;
    }];
    [commands.changePlaybackPositionCommand addTargetWithHandler:^(MPRemoteCommandEvent *event) {
        if (!active_) {
            return MPRemoteCommandHandlerStatusNoActionableNowPlayingItem;
        }
        auto *positionEvent = static_cast<MPChangePlaybackPositionCommandEvent *>(event);
        emit seekRequested(positionEvent.positionTime);
        return MPRemoteCommandHandlerStatusSuccess;
    }];
}

NowPlaying::~NowPlaying() {
    MPRemoteCommandCenter *commands = [MPRemoteCommandCenter sharedCommandCenter];
    [commands.playCommand removeTarget:nil];
    [commands.pauseCommand removeTarget:nil];
    [commands.togglePlayPauseCommand removeTarget:nil];
    [commands.changePlaybackPositionCommand removeTarget:nil];
    active_ = false;
    publish();
}

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
        publishedPosition_ + (paused_ ? 0.0 : systemUptimeSeconds() - publishedUptime_);
    if (std::fabs(seconds - projected) > 2.0) {
        publish();
    }
}

void NowPlaying::publish() {
    MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
    if (!active_) {
        center.nowPlayingInfo = nil;
        center.playbackState = MPNowPlayingPlaybackStateStopped;
        return;
    }
    NSMutableDictionary *info = [NSMutableDictionary dictionary];
    info[MPMediaItemPropertyTitle] =
        title_.isEmpty() ? @"Kino" : title_.toNSString();
    if (!subtitle_.isEmpty()) {
        info[MPMediaItemPropertyArtist] = subtitle_.toNSString();
    }
    info[MPNowPlayingInfoPropertyMediaType] = @(MPNowPlayingInfoMediaTypeVideo);
    info[MPMediaItemPropertyPlaybackDuration] = @(duration_);
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(position_);
    info[MPNowPlayingInfoPropertyPlaybackRate] = @(paused_ ? 0.0 : 1.0);
    center.nowPlayingInfo = info;
    center.playbackState =
        paused_ ? MPNowPlayingPlaybackStatePaused : MPNowPlayingPlaybackStatePlaying;
    publishedPosition_ = position_;
    publishedUptime_ = systemUptimeSeconds();
}
