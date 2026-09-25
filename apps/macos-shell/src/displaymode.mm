#include "displaymode.h"

#include <QWindow>
#include <cmath>

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>

namespace {

// Whether rate shows frameRate at a whole number of refreshes per frame.
bool isMultiple(double rate, double frameRate) {
    const double ratio = rate / frameRate;
    const double whole = std::round(ratio);
    return whole >= 1 && std::abs(ratio - whole) < 0.0004 * ratio;
}

CGDirectDisplayID displayOf(QWindow *window) {
    if (!window) return CGMainDisplayID();
    NSView *view = reinterpret_cast<NSView *>(window->winId());
    NSScreen *screen = view.window.screen;
    NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
    return number ? number.unsignedIntValue : CGMainDisplayID();
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

DisplayModeMatcher::~DisplayModeMatcher() { restore(); }

bool DisplayModeMatcher::match(QWindow *window, double frameRate) {
    const CGDirectDisplayID display = displayOf(window);
    CGDisplayModeRef current = CGDisplayCopyDisplayMode(display);
    if (!current) return false;
    const RefreshMode now{CGDisplayModeGetIODisplayModeID(current),
                          static_cast<int>(CGDisplayModeGetPixelWidth(current)),
                          static_cast<int>(CGDisplayModeGetPixelHeight(current)),
                          CGDisplayModeGetRefreshRate(current)};
    NSDictionary *options = @{(id)kCGDisplayShowDuplicateLowResolutionModes: @YES};
    CFArrayRef all = CGDisplayCopyAllDisplayModes(display, (__bridge CFDictionaryRef)options);
    std::vector<RefreshMode> modes;
    // Several entries can share a size and rate; the one with the current mode's point size
    // keeps the desktop's scaling.
    std::vector<CGDisplayModeRef> refs;
    for (CFIndex index = 0; all && index < CFArrayGetCount(all); ++index) {
        auto mode = (CGDisplayModeRef)CFArrayGetValueAtIndex(all, index);
        if (CGDisplayModeGetWidth(mode) != CGDisplayModeGetWidth(current) ||
            CGDisplayModeGetHeight(mode) != CGDisplayModeGetHeight(current))
            continue;
        modes.push_back({CGDisplayModeGetIODisplayModeID(mode),
                         static_cast<int>(CGDisplayModeGetPixelWidth(mode)),
                         static_cast<int>(CGDisplayModeGetPixelHeight(mode)),
                         CGDisplayModeGetRefreshRate(mode)});
        refs.push_back(mode);
    }
    const auto choice = chooseRefreshMode(modes, now, frameRate);
    bool switched = false;
    if (choice) {
        CGDisplayModeRef target = nullptr;
        for (size_t index = 0; index < modes.size(); ++index)
            if (modes[index].id == choice->id && modes[index].rate == choice->rate) target = refs[index];
        CGDisplayConfigRef config = nullptr;
        if (target && CGBeginDisplayConfiguration(&config) == kCGErrorSuccess) {
            CGConfigureDisplayWithDisplayMode(config, display, target, nullptr);
            // For this app only: the system restores the mode if Kino exits without doing so.
            if (CGCompleteDisplayConfiguration(config, kCGConfigureForAppOnly) == kCGErrorSuccess) {
                if (!original_) {
                    original_ = CGDisplayModeRetain(current);
                    display_ = display;
                }
                switched = true;
            } else {
                CGCancelDisplayConfiguration(config);
            }
        }
    }
    if (all) CFRelease(all);
    CGDisplayModeRelease(current);
    return switched;
}

void DisplayModeMatcher::restore() {
    if (!original_) return;
    CGDisplayConfigRef config = nullptr;
    if (CGBeginDisplayConfiguration(&config) == kCGErrorSuccess) {
        CGConfigureDisplayWithDisplayMode(config, display_, (CGDisplayModeRef)original_, nullptr);
        if (CGCompleteDisplayConfiguration(config, kCGConfigureForAppOnly) != kCGErrorSuccess)
            CGCancelDisplayConfiguration(config);
    }
    CGDisplayModeRelease((CGDisplayModeRef)original_);
    original_ = nullptr;
    display_ = 0;
}

double DisplayModeMatcher::refreshRate(QWindow *window) {
    CGDisplayModeRef mode = CGDisplayCopyDisplayMode(displayOf(window));
    if (!mode) return 0;
    const double rate = CGDisplayModeGetRefreshRate(mode);
    CGDisplayModeRelease(mode);
    return rate;
}

QVariantList DisplayModeMatcher::offeredRates(QWindow *window) {
    const CGDirectDisplayID display = displayOf(window);
    QVariantList rates;
    CGDisplayModeRef current = CGDisplayCopyDisplayMode(display);
    if (!current) return rates;
    NSDictionary *options = @{(id)kCGDisplayShowDuplicateLowResolutionModes: @YES};
    CFArrayRef all = CGDisplayCopyAllDisplayModes(display, (__bridge CFDictionaryRef)options);
    for (CFIndex index = 0; all && index < CFArrayGetCount(all); ++index) {
        auto mode = (CGDisplayModeRef)CFArrayGetValueAtIndex(all, index);
        if (CGDisplayModeGetPixelWidth(mode) != CGDisplayModeGetPixelWidth(current) ||
            CGDisplayModeGetPixelHeight(mode) != CGDisplayModeGetPixelHeight(current))
            continue;
        const double rate = CGDisplayModeGetRefreshRate(mode);
        if (!rates.contains(rate)) rates.append(rate);
    }
    if (all) CFRelease(all);
    CGDisplayModeRelease(current);
    return rates;
}
