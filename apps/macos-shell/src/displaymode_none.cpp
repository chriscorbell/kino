#include "displaymode.h"

#include <QGuiApplication>
#include <QScreen>
#include <QWindow>

// Linux has no mode switch Kino can use everywhere: Wayland compositors do not
// let clients change the output mode. Matching reports that nothing changed.

namespace {

QScreen *screenOf(QWindow *window) {
    return window && window->screen() ? window->screen() : QGuiApplication::primaryScreen();
}

}  // namespace

DisplayModeMatcher::~DisplayModeMatcher() { restore(); }

bool DisplayModeMatcher::match(QWindow *, double) { return false; }

void DisplayModeMatcher::restore() {}

double DisplayModeMatcher::refreshRate(QWindow *window) {
    QScreen *screen = screenOf(window);
    return screen ? screen->refreshRate() : 0;
}

QVariantList DisplayModeMatcher::offeredRates(QWindow *window) {
    const double rate = refreshRate(window);
    return rate > 0 ? QVariantList{rate} : QVariantList{};
}
