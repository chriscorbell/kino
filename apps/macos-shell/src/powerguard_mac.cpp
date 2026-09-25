#include "powerguard.h"

#include <IOKit/pwr_mgt/IOPMLib.h>
#include <QtGlobal>

struct PowerGuard::State {
    IOPMAssertionID assertion = kIOPMNullAssertionID;
};

PowerGuard::PowerGuard() : state_(std::make_unique<State>()) {}

PowerGuard::~PowerGuard() {
    setActive(false);
}

void PowerGuard::setActive(bool active) {
    IOPMAssertionID &assertion = state_->assertion;
    if (active == (assertion != kIOPMNullAssertionID)) {
        return;
    }
    if (active) {
        const IOReturn result = IOPMAssertionCreateWithName(
            kIOPMAssertionTypePreventUserIdleDisplaySleep, kIOPMAssertionLevelOn,
            CFSTR("Kino video playback"), &assertion);
        if (result != kIOReturnSuccess) {
            assertion = kIOPMNullAssertionID;
            qWarning("[kino:power] sleep assertion failed");
            return;
        }
        qInfo("[kino:power] display sleep prevented while video plays");
    } else {
        IOPMAssertionRelease(assertion);
        assertion = kIOPMNullAssertionID;
        qInfo("[kino:power] display sleep allowed");
    }
}
