#include "powerguard.h"

#include <QtGlobal>
#include <windows.h>

struct PowerGuard::State {
    bool active = false;
};

PowerGuard::PowerGuard() : state_(std::make_unique<State>()) {}

PowerGuard::~PowerGuard() {
    setActive(false);
}

void PowerGuard::setActive(bool active) {
    if (active == state_->active) {
        return;
    }
    // The execution state belongs to the calling thread, and the player item
    // always calls from the GUI thread.
    const EXECUTION_STATE flags =
        active ? ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED : ES_CONTINUOUS;
    if (SetThreadExecutionState(flags) == 0) {
        qWarning("[kino:power] sleep inhibition unavailable");
        return;
    }
    state_->active = active;
    qInfo(active ? "[kino:power] display sleep prevented while video plays"
                 : "[kino:power] display sleep allowed");
}
