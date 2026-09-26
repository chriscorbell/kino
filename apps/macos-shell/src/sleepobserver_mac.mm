#include "sleepobserver.h"

#import <AppKit/AppKit.h>

SleepObserver::SleepObserver(std::function<void()> willSleep) {
    NSNotificationCenter *center = [[NSWorkspace sharedWorkspace] notificationCenter];
    id token = [center addObserverForName:NSWorkspaceWillSleepNotification
                                   object:nil
                                    queue:[NSOperationQueue mainQueue]
                               usingBlock:^(NSNotification *) {
                                   willSleep();
                               }];
    // Kino's Objective-C++ builds without ARC; the center returns an
    // autoreleased token that must outlive this call.
    token_ = [token retain];
}

SleepObserver::~SleepObserver() {
    if (!token_) return;
    id token = static_cast<id>(token_);
    [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:token];
    [token release];
}

void SleepObserver::readyToSleep() {}

void postWillSleepForProbe() {
    [[[NSWorkspace sharedWorkspace] notificationCenter]
        postNotificationName:NSWorkspaceWillSleepNotification
                      object:[NSWorkspace sharedWorkspace]];
}
