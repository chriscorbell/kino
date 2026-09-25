#include "nowplaying.h"

#include <QGuiApplication>
#include <QMetaObject>
#include <QPointer>
#include <QWindow>

#include <windows.h>
#include <systemmediatransportcontrolsinterop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.h>

// Windows reads media keys, the volume flyout's media panel and the lock
// screen from the System Media Transport Controls. A desktop app reaches them
// for its window through ISystemMediaTransportControlsInterop.

using winrt::Windows::Media::MediaPlaybackStatus;
using winrt::Windows::Media::MediaPlaybackType;
using winrt::Windows::Media::PlaybackPositionChangeRequestedEventArgs;
using winrt::Windows::Media::SystemMediaTransportControls;
using winrt::Windows::Media::SystemMediaTransportControlsButton;
using winrt::Windows::Media::SystemMediaTransportControlsButtonPressedEventArgs;
using winrt::Windows::Media::SystemMediaTransportControlsTimelineProperties;

namespace {

winrt::Windows::Foundation::TimeSpan span(double seconds) {
    return std::chrono::duration_cast<winrt::Windows::Foundation::TimeSpan>(
        std::chrono::duration<double>(seconds));
}

// Holds the controls for the app's window. It lives as the NowPlaying's
// session object, so its lifetime ends with it.
class SmtcSession : public QObject {
public:
    SmtcSession(NowPlaying *owner, HWND window) : QObject(owner) {
        auto interop = winrt::get_activation_factory<SystemMediaTransportControls,
                                                     ISystemMediaTransportControlsInterop>();
        winrt::check_hresult(interop->GetForWindow(
            window, winrt::guid_of<SystemMediaTransportControls>(), winrt::put_abi(controls)));
        controls.IsPlayEnabled(true);
        controls.IsPauseEnabled(true);
        controls.IsStopEnabled(false);
        controls.IsNextEnabled(false);
        controls.IsPreviousEnabled(false);
        // Windows raises both events on a thread of its own. The signals are
        // queued onto the Qt thread the owner lives on.
        QPointer<NowPlaying> target(owner);
        buttonToken = controls.ButtonPressed(
            [target](const SystemMediaTransportControls &,
                     const SystemMediaTransportControlsButtonPressedEventArgs &args) {
                const auto button = args.Button();
                if (!target) return;
                QMetaObject::invokeMethod(target.data(), [target, button]() {
                    if (!target) return;
                    if (button == SystemMediaTransportControlsButton::Play) emit target->playRequested();
                    else if (button == SystemMediaTransportControlsButton::Pause) emit target->pauseRequested();
                }, Qt::QueuedConnection);
            });
        seekToken = controls.PlaybackPositionChangeRequested(
            [target](const SystemMediaTransportControls &,
                     const PlaybackPositionChangeRequestedEventArgs &args) {
                const double seconds =
                    std::chrono::duration<double>(args.RequestedPlaybackPosition()).count();
                if (!target) return;
                QMetaObject::invokeMethod(target.data(), [target, seconds]() {
                    if (target) emit target->seekRequested(seconds);
                }, Qt::QueuedConnection);
            });
    }

    ~SmtcSession() override {
        controls.ButtonPressed(buttonToken);
        controls.PlaybackPositionChangeRequested(seekToken);
        controls.IsEnabled(false);
    }

    SystemMediaTransportControls controls{nullptr};
    winrt::event_token buttonToken;
    winrt::event_token seekToken;
};

} // namespace

NowPlaying::NowPlaying(QObject *parent) : QObject(parent) {}

NowPlaying::~NowPlaying() = default;

void NowPlaying::publish() {
    auto *session = static_cast<SmtcSession *>(session_);
    if (!session && active_) {
        // The window has a native handle only once it is shown, which is
        // long before anything plays, so the controls attach on first use.
        const auto windows = QGuiApplication::topLevelWindows();
        QWindow *window = windows.isEmpty() ? nullptr : windows.first();
        if (window) {
            try {
                session = new SmtcSession(this, reinterpret_cast<HWND>(window->winId()));
                session_ = session;
                qInfo("[kino:media] media controls registered");
            } catch (const winrt::hresult_error &) {
                qWarning("[kino:media] media controls unavailable reason=registration");
            }
        }
    }
    if (!session) {
        published();
        return;
    }
    try {
        SystemMediaTransportControls &controls = session->controls;
        controls.IsEnabled(active_);
        if (!active_) {
            controls.PlaybackStatus(MediaPlaybackStatus::Stopped);
            controls.DisplayUpdater().ClearAll();
            controls.DisplayUpdater().Update();
            published();
            return;
        }
        controls.PlaybackStatus(paused_ ? MediaPlaybackStatus::Paused : MediaPlaybackStatus::Playing);
        auto display = controls.DisplayUpdater();
        display.Type(MediaPlaybackType::Video);
        display.VideoProperties().Title(
            winrt::hstring(title_.isEmpty() ? L"Kino" : title_.toStdWString()));
        display.VideoProperties().Subtitle(winrt::hstring(subtitle_.toStdWString()));
        display.Update();
        SystemMediaTransportControlsTimelineProperties timeline;
        timeline.StartTime(span(0));
        timeline.EndTime(span(duration_));
        timeline.MinSeekTime(span(0));
        timeline.MaxSeekTime(span(duration_));
        timeline.Position(span(position_));
        controls.UpdateTimelineProperties(timeline);
    } catch (const winrt::hresult_error &) {
        qWarning("[kino:media] media controls update failed");
    }
    published();
}
