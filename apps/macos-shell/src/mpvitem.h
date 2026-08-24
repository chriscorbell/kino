#pragma once

#include <QQuickFramebufferObject>
#include <QTimer>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

#include <mpv/client.h>
#include <mpv/render_gl.h>

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

    Q_INVOKABLE void load(const QString &url, bool forceStereo);
    Q_INVOKABLE void seek(double seconds);
    Q_INVOKABLE void setMuted(bool muted);
    Q_INVOKABLE void setPaused(bool paused);
    Q_INVOKABLE void stop();

signals:
    void activeChanged();
    void playerEvent(const QString &name, const QVariantMap &payload);
    void renderUpdateRequested();

private slots:
    void processEvents();

private:
    friend class MpvRenderer;

    static void onRenderUpdate(void *context);
    static void onWakeup(void *context);

    void emitError(const QString &code);
    void handleEvent(mpv_event *event);
    void initialize();
    void setActive(bool active);

    bool active_ = false;
    bool failed_ = false;
    bool hardwareDecoderActive_ = false;
    bool videoPresent_ = false;
    mpv_handle *handle_ = nullptr;
    mpv_render_context *renderContext_ = nullptr;
    QTimer hardwareDecoderTimer_;
};
