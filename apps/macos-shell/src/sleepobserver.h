#pragma once

#include <functional>

// Calls back on the main thread just before the system sleeps. Playback pauses
// there so audio does not resume by itself when the computer wakes. macOS
// posts a workspace notification, Linux's logind signals PrepareForSleep while
// Kino holds a delay lock, and Windows broadcasts a suspend message.
class SleepObserver {
public:
    explicit SleepObserver(std::function<void()> willSleep);
    ~SleepObserver();
    // Playback has paused, so a sleep Kino is holding back can go ahead. Only
    // Linux holds sleep back; elsewhere the system does not wait.
    void readyToSleep();
    SleepObserver(const SleepObserver &) = delete;
    SleepObserver &operator=(const SleepObserver &) = delete;

private:
    void *token_ = nullptr;
};

// Delivers the system's will-sleep notice inside this process, for the
// playback probe. scripts/check-linux-sleep.mjs sleeps a Linux machine for real.
void postWillSleepForProbe();
