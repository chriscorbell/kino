/*
 * Derived from Stremio/stremio-shell's GPL-3.0 mpv Qt Quick integration and
 * rewritten for Qt 6, Apple Silicon, and Kino's playback contract.
 */

#include "mpvitem.h"

#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QQuickOpenGLUtils>
#include <QRegularExpression>
#include <QSet>
#include <QUrl>
#include <QVariantList>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace {

void *resolveOpenGlSymbol(void *, const char *name) {
    QOpenGLContext *context = QOpenGLContext::currentContext();
    if (!context) {
        return nullptr;
    }
    return reinterpret_cast<void *>(context->getProcAddress(QByteArray(name)));
}

QVariantMap millisecondsPayload(double seconds) {
    return {{QStringLiteral("milliseconds"), std::llround(seconds * 1000.0)}};
}

QByteArray stringPropertyValue(const mpv_event_property &property) {
    if (property.format != MPV_FORMAT_STRING || !property.data) {
        return {};
    }
    // libmpv stores the address of the string pointer in property events.
    const char *value = *static_cast<char *const *>(property.data);
    return value ? QByteArray(value) : QByteArray();
}

QVariantList chapterPayload(const mpv_node &root) {
    QVariantList chapters;
    if (root.format != MPV_FORMAT_NODE_ARRAY || !root.u.list) {
        return chapters;
    }

    for (int index = 0; index < root.u.list->num; ++index) {
        const mpv_node &chapter = root.u.list->values[index];
        if (chapter.format != MPV_FORMAT_NODE_MAP || !chapter.u.list) {
            continue;
        }

        bool hasTime = false;
        double time = 0;
        QString title;
        for (int field = 0; field < chapter.u.list->num; ++field) {
            const QByteArray name(chapter.u.list->keys[field]);
            const mpv_node &value = chapter.u.list->values[field];
            if (name == "time" && value.format == MPV_FORMAT_DOUBLE) {
                hasTime = std::isfinite(value.u.double_) && value.u.double_ >= 0;
                time = value.u.double_;
            } else if (name == "title" && value.format == MPV_FORMAT_STRING &&
                       value.u.string) {
                title = QString::fromUtf8(value.u.string);
            }
        }

        if (hasTime) {
            chapters.append(QVariantMap{
                {QStringLiteral("startMs"), std::llround(time * 1000.0)},
                {QStringLiteral("title"), title},
            });
        }
    }
    return chapters;
}

QVariantList subtitleTrackPayload(const mpv_node &root) {
    QVariantList tracks;
    if (root.format != MPV_FORMAT_NODE_ARRAY || !root.u.list) {
        return tracks;
    }

    for (int index = 0; index < root.u.list->num; ++index) {
        const mpv_node &track = root.u.list->values[index];
        if (track.format != MPV_FORMAT_NODE_MAP || !track.u.list) {
            continue;
        }

        bool isSubtitle = false;
        QVariantMap entry{{QStringLiteral("external"), false},
                          {QStringLiteral("selected"), false}};
        for (int field = 0; field < track.u.list->num; ++field) {
            const QByteArray name(track.u.list->keys[field]);
            const mpv_node &value = track.u.list->values[field];
            if (name == "type" && value.format == MPV_FORMAT_STRING && value.u.string) {
                isSubtitle = qstrcmp(value.u.string, "sub") == 0;
            } else if (name == "id" && value.format == MPV_FORMAT_INT64) {
                entry.insert(QStringLiteral("id"),
                             static_cast<qlonglong>(value.u.int64));
            } else if (name == "selected" && value.format == MPV_FORMAT_FLAG) {
                entry.insert(QStringLiteral("selected"), value.u.flag != 0);
            } else if (name == "external" && value.format == MPV_FORMAT_FLAG) {
                entry.insert(QStringLiteral("external"), value.u.flag != 0);
            } else if (value.format == MPV_FORMAT_STRING && value.u.string &&
                       (name == "title" || name == "lang" || name == "codec")) {
                entry.insert(QString::fromUtf8(name),
                             QString::fromUtf8(value.u.string));
            }
        }

        if (isSubtitle && entry.contains(QStringLiteral("id"))) {
            tracks.append(entry);
        }
    }
    return tracks;
}

} // namespace

class MpvRenderer final : public QQuickFramebufferObject::Renderer {
public:
    explicit MpvRenderer(MpvItem *item) : item_(item) {}

    QOpenGLFramebufferObject *createFramebufferObject(const QSize &size) override {
        if (!item_->renderContext_) {
            mpv_opengl_init_params openGlParameters{resolveOpenGlSymbol, nullptr};
            mpv_render_param parameters[] = {
                {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
                {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &openGlParameters},
                {MPV_RENDER_PARAM_INVALID, nullptr},
            };
            const int result = mpv_render_context_create(&item_->renderContext_, item_->handle_,
                                                         parameters);
            if (result < 0) {
                QMetaObject::invokeMethod(item_, [item = item_]() {
                    item->emitError(QStringLiteral("render-context-unavailable"));
                });
            } else {
                mpv_render_context_set_update_callback(item_->renderContext_,
                                                       MpvItem::onRenderUpdate, item_);
            }
        }
        return Renderer::createFramebufferObject(size);
    }

    void render() override {
        if (!item_->renderContext_) {
            return;
        }
        mpv_render_context_update(item_->renderContext_);
        QQuickOpenGLUtils::resetOpenGLState();
        QOpenGLFramebufferObject *target = framebufferObject();
        mpv_opengl_fbo frameBuffer{static_cast<int>(target->handle()), target->width(),
                                   target->height(), 0};
        int flipY = 0;
        mpv_render_param parameters[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO, &frameBuffer},
            {MPV_RENDER_PARAM_FLIP_Y, &flipY},
            {MPV_RENDER_PARAM_INVALID, nullptr},
        };
        mpv_render_context_render(item_->renderContext_, parameters);
        QQuickOpenGLUtils::resetOpenGLState();
    }

private:
    MpvItem *item_;
};

MpvItem::MpvItem(QQuickItem *parent)
    : QQuickFramebufferObject(parent), handle_(mpv_create()) {
    if (!handle_) {
        throw std::runtime_error("could not create the mpv context");
    }
    connect(this, &MpvItem::renderUpdateRequested, this, qOverload<>(&MpvItem::update),
            Qt::QueuedConnection);
    hardwareDecoderTimer_.setInterval(5'000);
    hardwareDecoderTimer_.setSingleShot(true);
    connect(&hardwareDecoderTimer_, &QTimer::timeout, this, [this]() {
        if (!active_ || !videoPresent_ || hardwareDecoderActive_) {
            return;
        }
        emitError(QStringLiteral("hardware-decoding-unavailable"));
        const char *command[] = {"stop", nullptr};
        mpv_command_async(handle_, 0, command);
    });
    initialize();
}

MpvItem::~MpvItem() {
    if (renderContext_) {
        mpv_render_context_free(renderContext_);
    }
    if (handle_) {
        mpv_terminate_destroy(handle_);
    }
}

bool MpvItem::active() const {
    return active_;
}

QQuickFramebufferObject::Renderer *MpvItem::createRenderer() const {
    return new MpvRenderer(const_cast<MpvItem *>(this));
}

void MpvItem::initialize() {
    const struct Option {
        const char *name;
        const char *value;
    } options[] = {
        {"config", "no"},
        {"terminal", "no"},
        {"input-default-bindings", "no"},
        {"input-vo-keyboard", "no"},
        {"osc", "no"},
        {"vo", "libmpv"},
        {"hwdec", "videotoolbox"},
        {"hwdec-codecs", "all"},
        {"hwdec-software-fallback", "no"},
        {"vd-lavc-check-hw-profile", "yes"},
        {"target-trc", "bt.1886"},
        {"target-prim", "bt.709"},
        {"tone-mapping", "auto"},
        {"hdr-compute-peak", "auto"},
        {"cache", "yes"},
        {"tls-verify", "yes"},
        {"demuxer-readahead-secs", "10"},
        {"audio-fallback-to-null", "yes"},
        {"audio-client-name", "Kino"},
        {"title", "Kino"},
        {"sid", "no"},
        {"sub-auto", "no"},
    };

    for (const Option &option : options) {
        if (mpv_set_option_string(handle_, option.name, option.value) < 0) {
            throw std::runtime_error("mpv rejected a required option");
        }
    }
    if (mpv_initialize(handle_) < 0) {
        throw std::runtime_error("could not initialize mpv");
    }

    mpv_set_wakeup_callback(handle_, &MpvItem::onWakeup, this);
    mpv_request_log_messages(handle_, "warn");
    mpv_observe_property(handle_, 1, "time-pos", MPV_FORMAT_DOUBLE);
    mpv_observe_property(handle_, 2, "duration", MPV_FORMAT_DOUBLE);
    mpv_observe_property(handle_, 3, "pause", MPV_FORMAT_FLAG);
    mpv_observe_property(handle_, 4, "paused-for-cache", MPV_FORMAT_FLAG);
    mpv_observe_property(handle_, 5, "mute", MPV_FORMAT_FLAG);
    mpv_observe_property(handle_, 6, "hwdec-current", MPV_FORMAT_STRING);
    mpv_observe_property(handle_, 7, "video-format", MPV_FORMAT_STRING);
    mpv_observe_property(handle_, 8, "chapter-list", MPV_FORMAT_NODE);
    mpv_observe_property(handle_, 9, "track-list", MPV_FORMAT_NODE);
}

void MpvItem::load(const QString &url, bool forceStereo, const QVariantMap &headers) {
    // mpv can log arbitrary header values. Keep its free-form messages private
    // for the rest of this instance, including late events from an earlier load.
    suppressMpvLogDetails_ = suppressMpvLogDetails_ || !headers.isEmpty();
    static const QRegularExpression headerName(QStringLiteral("^[!#$%&'*+.^_`|~0-9A-Za-z-]+$"));
    static const QRegularExpression control(QStringLiteral("[\\x00-\\x08\\x0a-\\x1f\\x7f]"));
    static const QSet<QString> reserved{
        QStringLiteral("host"), QStringLiteral("range"), QStringLiteral("content-length"),
        QStringLiteral("transfer-encoding"), QStringLiteral("connection")};
    QSet<QString> names;
    QByteArray headerFields;
    bool valid = headers.size() <= 64;
    const QString scheme = QUrl(url).scheme();
    valid = valid && (headers.isEmpty() || scheme == QLatin1String("https") ||
                      scheme == QLatin1String("http"));
    for (auto it = headers.cbegin(); valid && it != headers.cend(); ++it) {
        const QString name = it.key().toLower();
        const QString value = it.value().toString();
        valid = it.value().metaType().id() == QMetaType::QString &&
                headerName.match(it.key()).hasMatch() && !control.match(value).hasMatch() &&
                !reserved.contains(name) && !names.contains(name);
        names.insert(name);
        // loadfile's options map accepts strings. Escape the string-list
        // separators so commas remain literal. mpv leaves other backslashes
        // untouched. HTTP whitespace keeps a trailing backslash from escaping
        // the separator before the next header.
        QByteArray field = (it.key() + QStringLiteral(": ") + value).toUtf8();
        field.replace(",", "\\,");
        if (field.endsWith('\\')) {
            field.append(' ');
        }
        if (!headerFields.isEmpty()) {
            headerFields.append(',');
        }
        headerFields.append(field);
        valid = valid && headerFields.size() <= 64 * 1024;
    }
    if (!valid) {
        emitError(QStringLiteral("invalid-request-headers"));
        return;
    }
    failed_ = false;
    hardwareDecoderActive_ = false;
    hardwareDecoderTimer_.stop();
    paused_ = false;
    videoPresent_ = false;
    setActive(true);
    QByteArray audioChannels = forceStereo ? QByteArrayLiteral("stereo")
                                           : QByteArrayLiteral("auto-safe");
    char *audioChannelsData = audioChannels.data();
    mpv_set_property_async(handle_, 0, "audio-channels", MPV_FORMAT_STRING,
                           &audioChannelsData);
    QByteArray subtitleTrack = QByteArrayLiteral("no");
    char *subtitleTrackData = subtitleTrack.data();
    mpv_set_property_async(handle_, 0, "sid", MPV_FORMAT_STRING, &subtitleTrackData);
    double subtitleDelay = 0;
    mpv_set_property_async(handle_, 0, "sub-delay", MPV_FORMAT_DOUBLE, &subtitleDelay);
    int unpaused = 0;
    mpv_set_property_async(handle_, 0, "pause", MPV_FORMAT_FLAG, &unpaused);
    QByteArray encodedUrl = url.toUtf8();
    char loadfile[] = "loadfile";
    char replace[] = "replace";
    char headerOption[] = "http-header-fields";
    char *optionNames[] = {headerOption};
    mpv_node optionValue{};
    optionValue.format = MPV_FORMAT_STRING;
    optionValue.u.string = headerFields.data();
    mpv_node_list options{1, &optionValue, optionNames};
    mpv_node arguments[5]{};
    for (int index = 0; index < 3; ++index) {
        arguments[index].format = MPV_FORMAT_STRING;
    }
    arguments[0].u.string = loadfile;
    arguments[1].u.string = encodedUrl.data();
    arguments[2].u.string = replace;
    arguments[3].format = MPV_FORMAT_INT64;
    arguments[3].u.int64 = -1;
    arguments[4].format = MPV_FORMAT_NODE_MAP;
    arguments[4].u.list = &options;
    mpv_node_list commandArguments{5, arguments, nullptr};
    mpv_node command{};
    command.format = MPV_FORMAT_NODE_ARRAY;
    command.u.list = &commandArguments;
    const int result = mpv_command_node_async(handle_, 0, &command);
    if (result < 0) {
        emitError(QStringLiteral("source-load-failed"));
        return;
    }
    emit playerEvent(QStringLiteral("buffering"), {{QStringLiteral("active"), true}});
    emit playerEvent(QStringLiteral("paused"), {{QStringLiteral("paused"), false}});
    qInfo("[kino:mpv] source load requested");
}

void MpvItem::addSubtitles(const QString &url, const QString &title, const QString &lang) {
    const QByteArray encodedUrl = url.toUtf8();
    const QByteArray encodedTitle =
        title.trimmed().isEmpty() ? QByteArrayLiteral("External subtitles")
                                  : title.trimmed().toUtf8();
    const QByteArray encodedLang = lang.trimmed().toUtf8();
    const char *command[] = {"sub-add", encodedUrl.constData(), "select",
                             encodedTitle.constData(),
                             encodedLang.isEmpty() ? nullptr : encodedLang.constData(),
                             nullptr};
    if (mpv_command_async(handle_, 0, command) < 0) {
        qWarning("[kino:mpv] external subtitles rejected");
    }
}

void MpvItem::seek(double seconds) {
    double safeSeconds = std::max(0.0, seconds);
    mpv_set_property_async(handle_, 0, "time-pos", MPV_FORMAT_DOUBLE, &safeSeconds);
}

void MpvItem::setMuted(bool muted) {
    int value = muted ? 1 : 0;
    mpv_set_property_async(handle_, 0, "mute", MPV_FORMAT_FLAG, &value);
}

void MpvItem::setPaused(bool paused) {
    int value = paused ? 1 : 0;
    mpv_set_property_async(handle_, 0, "pause", MPV_FORMAT_FLAG, &value);
}

void MpvItem::setSubtitleDelay(double seconds) {
    double value = std::clamp(seconds, -60.0, 60.0);
    mpv_set_property_async(handle_, 0, "sub-delay", MPV_FORMAT_DOUBLE, &value);
}

void MpvItem::setSubtitlePosition(int position) {
    int64_t value = std::clamp(position, 0, 150);
    mpv_set_property_async(handle_, 0, "sub-pos", MPV_FORMAT_INT64, &value);
}

void MpvItem::setSubtitleScale(double scale) {
    double value = std::clamp(scale, 0.1, 5.0);
    mpv_set_property_async(handle_, 0, "sub-scale", MPV_FORMAT_DOUBLE, &value);
}

void MpvItem::setSubtitleTrack(int id) {
    if (id > 0) {
        int64_t value = id;
        mpv_set_property_async(handle_, 0, "sid", MPV_FORMAT_INT64, &value);
        return;
    }
    QByteArray disabled = QByteArrayLiteral("no");
    char *disabledData = disabled.data();
    mpv_set_property_async(handle_, 0, "sid", MPV_FORMAT_STRING, &disabledData);
}

void MpvItem::stop() {
    hardwareDecoderTimer_.stop();
    const char *command[] = {"stop", nullptr};
    mpv_command_async(handle_, 0, command);
    setActive(false);
}

void MpvItem::togglePaused() {
    const char *command[] = {"cycle", "pause", nullptr};
    mpv_command_async(handle_, 0, command);
}

void MpvItem::onRenderUpdate(void *context) {
    emit static_cast<MpvItem *>(context)->renderUpdateRequested();
}

void MpvItem::onWakeup(void *context) {
    QMetaObject::invokeMethod(static_cast<MpvItem *>(context), &MpvItem::processEvents,
                              Qt::QueuedConnection);
}

void MpvItem::processEvents() {
    while (handle_) {
        mpv_event *event = mpv_wait_event(handle_, 0);
        if (event->event_id == MPV_EVENT_NONE) {
            return;
        }
        handleEvent(event);
    }
}

void MpvItem::handleEvent(mpv_event *event) {
    switch (event->event_id) {
    case MPV_EVENT_START_FILE:
        setActive(true);
        emit playerEvent(QStringLiteral("buffering"), {{QStringLiteral("active"), true}});
        break;
    case MPV_EVENT_FILE_LOADED:
        // The media demuxer owns its request headers after opening. Clear the
        // option before an external subtitle can open a separate connection.
        // Auto-loading sidecar subtitles is disabled during initialization.
        mpv_set_property_string(handle_, "http-header-fields", "");
        qInfo("[kino:mpv] source metadata loaded");
        break;
    case MPV_EVENT_PLAYBACK_RESTART:
        emit playerEvent(QStringLiteral("buffering"), {{QStringLiteral("active"), false}});
        emit playerEvent(QStringLiteral("ready"), {});
        break;
    case MPV_EVENT_PROPERTY_CHANGE: {
        auto *property = static_cast<mpv_event_property *>(event->data);
        if (!property || !property->name) {
            break;
        }
        const QByteArray name(property->name);
        if (name == "hwdec-current") {
            hardwareDecoderActive_ = stringPropertyValue(*property) == "videotoolbox";
            emit playerEvent(QStringLiteral("hardwareDecoding"),
                             {{QStringLiteral("active"), hardwareDecoderActive_}});
            if (hardwareDecoderActive_) {
                hardwareDecoderTimer_.stop();
                qInfo("[kino:mpv] hardware decoder active");
            } else if (videoPresent_) {
                hardwareDecoderTimer_.start();
            } else {
                hardwareDecoderTimer_.stop();
            }
        } else if (name == "video-format") {
            videoPresent_ = !stringPropertyValue(*property).isEmpty();
            updatePowerGuard();
            if (videoPresent_ && !hardwareDecoderActive_) {
                hardwareDecoderTimer_.start();
            } else {
                hardwareDecoderTimer_.stop();
            }
        } else if (!property->data) {
            break;
        } else if ((name == "time-pos" || name == "duration") &&
                   property->format == MPV_FORMAT_DOUBLE) {
            const double seconds = *static_cast<double *>(property->data);
            emit playerEvent(name == "time-pos" ? QStringLiteral("time")
                                                : QStringLiteral("duration"),
                             millisecondsPayload(seconds));
        } else if (name == "pause" && property->format == MPV_FORMAT_FLAG) {
            paused_ = *static_cast<int *>(property->data) != 0;
            updatePowerGuard();
            emit playerEvent(QStringLiteral("paused"),
                             {{QStringLiteral("paused"), paused_}});
        } else if (name == "paused-for-cache" && property->format == MPV_FORMAT_FLAG) {
            emit playerEvent(QStringLiteral("buffering"),
                             {{QStringLiteral("active"),
                               *static_cast<int *>(property->data) != 0}});
        } else if (name == "mute" && property->format == MPV_FORMAT_FLAG) {
            emit playerEvent(QStringLiteral("muted"),
                             {{QStringLiteral("muted"),
                               *static_cast<int *>(property->data) != 0}});
        } else if (name == "chapter-list" && property->format == MPV_FORMAT_NODE) {
            const auto *chapters = static_cast<const mpv_node *>(property->data);
            emit playerEvent(
                QStringLiteral("chapters"),
                {{QStringLiteral("items"), chapterPayload(*chapters)}});
        } else if (name == "track-list" && property->format == MPV_FORMAT_NODE) {
            const auto *tracks = static_cast<const mpv_node *>(property->data);
            emit playerEvent(
                QStringLiteral("subtitleTracks"),
                {{QStringLiteral("items"), subtitleTrackPayload(*tracks)}});
        }
        break;
    }
    case MPV_EVENT_END_FILE: {
        const auto *end = static_cast<mpv_event_end_file *>(event->data);
        hardwareDecoderTimer_.stop();
        setActive(false);
        if (end && end->reason == MPV_END_FILE_REASON_ERROR) {
            emitError(QStringLiteral("decoder-or-stream-failed"));
        } else if (end && end->reason == MPV_END_FILE_REASON_EOF && !failed_) {
            emit playerEvent(QStringLiteral("ended"), {});
        }
        break;
    }
    case MPV_EVENT_LOG_MESSAGE: {
        const auto *entry = static_cast<mpv_event_log_message *>(event->data);
        if (entry && suppressMpvLogDetails_) {
            qWarning("[kino:mpv] message omitted for media with request headers");
        } else if (entry) {
            qWarning("[kino:mpv] message module=%s level=%s detail=%s", entry->prefix,
                     entry->level, entry->text);
        }
        break;
    }
    default:
        break;
    }
}

void MpvItem::emitError(const QString &code) {
    failed_ = true;
    hardwareDecoderTimer_.stop();
    setActive(false);
    qCritical("[kino:mpv] playback failed code=%s", qPrintable(code));
    emit playerEvent(QStringLiteral("error"), {{QStringLiteral("code"), code}});
}

void MpvItem::setActive(bool active) {
    if (active_ == active) {
        return;
    }
    active_ = active;
    updatePowerGuard();
    emit activeChanged();
    if (active_) {
        update();
    }
}

void MpvItem::updatePowerGuard() {
    powerGuard_.setActive(active_ && videoPresent_ && !paused_);
}
