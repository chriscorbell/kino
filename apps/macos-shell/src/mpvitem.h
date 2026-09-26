#pragma once

#include <QQuickFramebufferObject>
#include <QTimer>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

#include <mpv/client.h>
#include <mpv/render_gl.h>
#include <functional>
#include <memory>

#include "displaymode.h"
#include "powerguard.h"
#include "sleepobserver.h"

class MpvRenderer;
struct MpvContext;

class MpvItem : public QQuickFramebufferObject {
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(bool active READ active NOTIFY activeChanged)
    // Switch the display to the video's frame rate while it plays. Off unless the viewer asks.
    Q_PROPERTY(bool matchFrameRate READ matchFrameRate WRITE setMatchFrameRate)
public:
    explicit MpvItem(QQuickItem *parent = nullptr);
    ~MpvItem() override;

    bool active() const;
    bool matchFrameRate() const { return matchFrameRate_; }
    void setMatchFrameRate(bool enabled) { matchFrameRate_ = enabled; }
    double playbackSpeed() const;
    QVariantMap subtitleStyle() const;
    /** The Stereo path's integrated loudness and applied gain, for the probe and diagnostics. */
    QVariantMap loudness() const;
    QString version() const;
    Renderer *createRenderer() const override;

    Q_INVOKABLE void addSubtitles(const QString &url, const QString &title, const QString &lang);
    Q_INVOKABLE void load(const QString &url, bool forceStereo, const QVariantMap &headers = {}, const QString &audioLanguage = {});
    Q_INVOKABLE QVariantMap pauseAndSnapshot();
    Q_INVOKABLE void seek(double seconds);
    Q_INVOKABLE void setMuted(bool muted);
    Q_INVOKABLE void setVolume(double percent);
    Q_INVOKABLE void setPaused(bool paused);
    Q_INVOKABLE void setSubtitleDelay(double seconds);
    Q_INVOKABLE void setSubtitlePosition(int position);
    Q_INVOKABLE void setSubtitleScale(double scale);
    Q_INVOKABLE void setSubtitleTrack(int id);
    Q_INVOKABLE void setAudioTrack(int id);
    Q_INVOKABLE void stop();
    Q_INVOKABLE void togglePaused();

signals:
    void activeChanged();
    void playerEvent(const QString &name, const QVariantMap &payload);
    void renderUpdateRequested();

private slots:
    void processEvents();

private:
    friend class MpvRenderer;
    friend class MpvItemTest;

    static void onRenderUpdate(void *context);
    static void onWakeup(void *context);

    void emitError(const QString &code);
    void handleEvent(mpv_event *event);
    bool available() const;
    bool initialize();
    void setActive(bool active);
    void setRenderContextReady(bool ready);
    void updatePowerGuard();

    void matchDisplayTo(double frameRate);

    bool active_ = false;
    bool matchFrameRate_ = false;
    bool frameRateMatched_ = false;
    DisplayModeMatcher displayMode_;
    bool failed_ = false;
    bool hardwareDecoderActive_ = false;
    bool paused_ = true;
    // The current file is an HLG base layer whose filter now sets HLG's light.
    bool hlgLightRestored_ = false;
    // Sleep waits until mpv reports the pause Kino asked for before it.
    bool pausingForSleep_ = false;
    bool renderContextReady_ = false;
    bool suppressMpvLogDetails_ = false;
    bool videoPresent_ = false;
    // The last cache end sent to the interface, so the timeline hears about
    // whole seconds rather than every demuxed packet.
    long long bufferedMs_ = -1;
    std::shared_ptr<MpvContext> context_;
    mpv_handle *handle_ = nullptr;
    PowerGuard powerGuard_;
    SleepObserver sleepObserver_;
    QTimer hardwareDecoderTimer_;
    // The first loadfile waits for the renderer's context. vo_libmpv fails
    // permanently for a file whose video starts before one exists.
    std::function<void()> pendingLoad_;
    QTimer renderContextTimer_;
    // Stereo loudness normalization: libavfilter measures and applies it in
    // mpv's audio chain, and this timer steers the gain from the measurement.
    void steerLoudness();
    QTimer loudnessTimer_;
    bool normalizing_ = false;
    int loudnessTicks_ = 0;
    double loudnessGainDb_ = 0;
    double integratedLufs_ = -70;
};
