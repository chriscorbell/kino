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
    SleepObserver(const SleepObserver &) = delete;
    SleepObserver &operator=(const SleepObserver &) = delete;

private:
    void *token_ = nullptr;
};

// Delivers the system's will-sleep notice inside this process. Only the
// playback probe calls it; nothing can deliver a real sleep to a check.
void postWillSleepForProbe();
