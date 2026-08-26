#include "powerguard.h"

#include <QtGlobal>

PowerGuard::~PowerGuard() {
    setActive(false);
}

void PowerGuard::setActive(bool active) {
    if (active == (assertion_ != kIOPMNullAssertionID)) {
        return;
    }
    if (active) {
        const IOReturn result = IOPMAssertionCreateWithName(
            kIOPMAssertionTypePreventUserIdleDisplaySleep, kIOPMAssertionLevelOn,
            CFSTR("Kino video playback"), &assertion_);
        if (result != kIOReturnSuccess) {
            assertion_ = kIOPMNullAssertionID;
            qWarning("[kino:power] sleep assertion failed");
            return;
        }
        qInfo("[kino:power] display sleep prevented while video plays");
    } else {
        IOPMAssertionRelease(assertion_);
        assertion_ = kIOPMNullAssertionID;
        qInfo("[kino:power] display sleep allowed");
    }
}
