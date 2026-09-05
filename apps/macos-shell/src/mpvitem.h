#pragma once

#include <QQuickFramebufferObject>
#include <QTimer>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

#include <mpv/client.h>
#include <mpv/render_gl.h>

#include "powerguard.h"

class MpvRenderer;

class MpvItem : public QQuickFramebufferObject {
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(bool active READ active NOTIFY activeChanged)
public:
    explicit MpvItem(QQuickItem *parent = nullptr);
    ~MpvItem() override;

    bool active() const;
    Renderer *createRenderer() const override;

    Q_INVOKABLE void addSubtitles(const QString &url, const QString &title, const QString &lang);
    Q_INVOKABLE void load(const QString &url, bool forceStereo);
    Q_INVOKABLE void seek(double seconds);
    Q_INVOKABLE void setMuted(bool muted);
    Q_INVOKABLE void setPaused(bool paused);
    Q_INVOKABLE void setSubtitleDelay(double seconds);
    Q_INVOKABLE void setSubtitlePosition(int position);
    Q_INVOKABLE void setSubtitleScale(double scale);
    Q_INVOKABLE void setSubtitleTrack(int id);
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
    void initialize();
    void setActive(bool active);
    void updatePowerGuard();

    bool active_ = false;
    bool failed_ = false;
    bool hardwareDecoderActive_ = false;
    bool paused_ = true;
    bool videoPresent_ = false;
    mpv_handle *handle_ = nullptr;
    mpv_render_context *renderContext_ = nullptr;
    PowerGuard powerGuard_;
    QTimer hardwareDecoderTimer_;
};
