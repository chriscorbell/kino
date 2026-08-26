#pragma once

#include <IOKit/pwr_mgt/IOPMLib.h>

class PowerGuard {
public:
    PowerGuard() = default;
    ~PowerGuard();
    PowerGuard(const PowerGuard &) = delete;
    PowerGuard &operator=(const PowerGuard &) = delete;

    void setActive(bool active);

private:
    IOPMAssertionID assertion_ = kIOPMNullAssertionID;
};
