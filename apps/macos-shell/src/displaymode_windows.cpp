#include "displaymode.h"

#include <QGuiApplication>
#include <QScreen>
#include <QWindow>
#include <string>
#include <windows.h>

namespace {

// Windows lists whole hertz and names each NTSC rate by its floor: 23 is
// 23.976 and 59 is 59.94, while 24 and 60 are exact.
double exactRate(DWORD hertz) {
    switch (hertz) {
    case 23: return 24000.0 / 1001.0;
    case 29: return 30000.0 / 1001.0;
    case 47: return 48000.0 / 1001.0;
    case 59: return 60000.0 / 1001.0;
    case 119: return 120000.0 / 1001.0;
    default: return hertz;
    }
}

// Qt names a Windows screen by its GDI device, such as \\.\DISPLAY1.
std::wstring deviceOf(QWindow *window) {
    QScreen *screen = window && window->screen() ? window->screen() : QGuiApplication::primaryScreen();
    return screen ? screen->name().toStdWString() : std::wstring();
}

bool currentMode(const std::wstring &device, DEVMODEW &mode) {
    mode = {};
    mode.dmSize = sizeof(mode);
    return EnumDisplaySettingsW(device.c_str(), ENUM_CURRENT_SETTINGS, &mode) != 0;
}

// Every progressive mode at the current size and colour depth, in the order
// Windows lists them.
std::vector<DEVMODEW> sameSizeModes(const std::wstring &device, const DEVMODEW &current) {
    std::vector<DEVMODEW> modes;
    for (DWORD index = 0;; ++index) {
        DEVMODEW mode{};
        mode.dmSize = sizeof(mode);
        if (!EnumDisplaySettingsW(device.c_str(), index, &mode)) break;
        if (mode.dmPelsWidth != current.dmPelsWidth || mode.dmPelsHeight != current.dmPelsHeight ||
            mode.dmBitsPerPel != current.dmBitsPerPel || (mode.dmDisplayFlags & DM_INTERLACED))
            continue;
        modes.push_back(mode);
    }
    return modes;
}

}  // namespace

DisplayModeMatcher::~DisplayModeMatcher() { restore(); }

bool DisplayModeMatcher::match(QWindow *window, double frameRate) {
    const std::wstring device = deviceOf(window);
    DEVMODEW current;
    if (device.empty() || !currentMode(device, current)) return false;
    const std::vector<DEVMODEW> available = sameSizeModes(device, current);
    std::vector<RefreshMode> modes;
    for (size_t index = 0; index < available.size(); ++index)
        modes.push_back({static_cast<int32_t>(index), static_cast<int>(available[index].dmPelsWidth),
                         static_cast<int>(available[index].dmPelsHeight),
                         exactRate(available[index].dmDisplayFrequency)});
    const RefreshMode now{-1, static_cast<int>(current.dmPelsWidth),
                          static_cast<int>(current.dmPelsHeight),
                          exactRate(current.dmDisplayFrequency)};
    const auto choice = chooseRefreshMode(modes, now, frameRate);
    if (!choice) return false;
    DEVMODEW target = available[static_cast<size_t>(choice->id)];
    target.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_BITSPERPEL | DM_DISPLAYFREQUENCY;
    // CDS_FULLSCREEN makes the change temporary: Windows puts the saved mode
    // back if Kino exits without restoring it.
    if (ChangeDisplaySettingsExW(device.c_str(), &target, nullptr, CDS_FULLSCREEN, nullptr) !=
        DISP_CHANGE_SUCCESSFUL)
        return false;
    if (!original_) original_ = new std::wstring(device);
    return true;
}

void DisplayModeMatcher::restore() {
    if (!original_) return;
    auto *device = static_cast<std::wstring *>(original_);
    // No mode restores the one saved in the registry.
    ChangeDisplaySettingsExW(device->c_str(), nullptr, nullptr, 0, nullptr);
    delete device;
    original_ = nullptr;
}

double DisplayModeMatcher::refreshRate(QWindow *window) {
    DEVMODEW current;
    return currentMode(deviceOf(window), current) ? exactRate(current.dmDisplayFrequency) : 0;
}

QVariantList DisplayModeMatcher::offeredRates(QWindow *window) {
    const std::wstring device = deviceOf(window);
    DEVMODEW current;
    QVariantList rates;
    if (!currentMode(device, current)) return rates;
    for (const DEVMODEW &mode : sameSizeModes(device, current)) {
        const double rate = exactRate(mode.dmDisplayFrequency);
        if (!rates.contains(rate)) rates.append(rate);
    }
    return rates;
}
