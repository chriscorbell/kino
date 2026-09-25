#pragma once

#include <memory>

// Keeps the display awake while video plays: an IOKit assertion on macOS, the
// desktop portal's idle inhibitor on Linux, and the thread execution state on
// Windows.
class PowerGuard {
public:
    PowerGuard();
    ~PowerGuard();
    PowerGuard(const PowerGuard &) = delete;
    PowerGuard &operator=(const PowerGuard &) = delete;

    void setActive(bool active);

private:
    struct State;
    std::unique_ptr<State> state_;
};
