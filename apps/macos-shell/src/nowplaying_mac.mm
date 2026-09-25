#include "nowplaying.h"

#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>

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
    published();
}
