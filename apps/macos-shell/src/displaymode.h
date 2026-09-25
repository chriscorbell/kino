#pragma once

#include <QVariantList>
#include <cstdint>
#include <optional>
#include <vector>

class QWindow;

// A display mode, as far as matching a video's frame rate is concerned.
struct RefreshMode {
    int32_t id = 0;
    int width = 0;
    int height = 0;
    double rate = 0;
};

// The mode that shows frameRate without judder: one at the current pixel size whose refresh
// rate is a whole multiple of it, the one nearest the current rate, so a 160 Hz desktop moves to
// 144 Hz for film rather than dropping to 24. Nothing when the current mode already is one, or
// the display has none; 23.976 and 24 differ by a tenth of a percent and are never confused.
std::optional<RefreshMode> chooseRefreshMode(const std::vector<RefreshMode> &modes,
                                             const RefreshMode &current, double frameRate);

// Switches the display a window is on to a matching mode for the rest of the app session, and
// back. CoreGraphics on macOS and the display settings API on Windows also put the mode back if
// Kino exits without restoring it. Linux reports that nothing changed.
class DisplayModeMatcher {
public:
    DisplayModeMatcher() = default;
    ~DisplayModeMatcher();
    DisplayModeMatcher(const DisplayModeMatcher &) = delete;
    DisplayModeMatcher &operator=(const DisplayModeMatcher &) = delete;

    // True when the display changed mode.
    bool match(QWindow *window, double frameRate);
    void restore();
    // The refresh rate of the display the window is on, for the playback probe.
    static double refreshRate(QWindow *window);
    // The refresh rates the window's display offers at its current size.
    static QVariantList offeredRates(QWindow *window);

private:
    uint32_t display_ = 0;
    void *original_ = nullptr;
};
