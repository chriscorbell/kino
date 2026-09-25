#include "displaymode.h"

#include <cmath>

namespace {

// Whether rate shows frameRate at a whole number of refreshes per frame.
bool isMultiple(double rate, double frameRate) {
    const double ratio = rate / frameRate;
    const double whole = std::round(ratio);
    return whole >= 1 && std::abs(ratio - whole) < 0.0004 * ratio;
}

}  // namespace

std::optional<RefreshMode> chooseRefreshMode(const std::vector<RefreshMode> &modes,
                                             const RefreshMode &current, double frameRate) {
    if (!(frameRate > 1) || !std::isfinite(frameRate)) return std::nullopt;
    if (current.rate > 0 && isMultiple(current.rate, frameRate)) return std::nullopt;
    std::optional<RefreshMode> best;
    for (const RefreshMode &mode : modes) {
        if (mode.width != current.width || mode.height != current.height) continue;
        if (!isMultiple(mode.rate, frameRate)) continue;
        const double distance = std::abs(mode.rate - current.rate);
        if (!best || distance < std::abs(best->rate - current.rate) ||
            (distance == std::abs(best->rate - current.rate) && mode.rate > best->rate))
            best = mode;
    }
    return best;
}
