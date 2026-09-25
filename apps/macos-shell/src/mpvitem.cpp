/*
 * Derived from Stremio/stremio-shell's GPL-3.0 mpv Qt Quick integration and
 * rewritten for Qt 6 and Kino's playback contract.
 */

#include "mpvitem.h"
#include "platform.h"
#include "tlsroots.h"

#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QQuickOpenGLUtils>
#include <QQuickWindow>
#include <QRegularExpression>
#include <QSet>
#include <QUrl>
#include <QVariantList>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <mutex>

namespace {

void *resolveOpenGlSymbol(void *, const char *name) {
    QOpenGLContext *context = QOpenGLContext::currentContext();
    if (!context) {
        return nullptr;
    }
    return reinterpret_cast<void *>(context->getProcAddress(QByteArray(name)));
}

// Stereo loudness normalization, matched to the TV's LoudnessNormalizer. The
// measurement is libavfilter's ebur128, which is ITU-R BS.1770-4 integrated
// across everything played, so the gain follows the program rather than riding
// each scene. The limiter holds peaks under -1 dBFS with its shortest attack.
constexpr double kTargetLufs = -19.0;
constexpr double kMaxBoostDb = 12.0;
constexpr double kMaxCutDb = -6.0;
constexpr int kLoudnessIntervalMs = 500;
// Eight 400 ms blocks, as on TV, before the measurement is trusted.
constexpr int kLoudnessWarmupTicks = 7;
constexpr double kRiseSeconds = 1.5;
constexpr double kFallSeconds = 1.0;
constexpr const char *kStereoFilters =
    "@kinoloud:ebur128=metadata=1,"
    "@kinogain:volume=volume=0dB:precision=float,"
    "@kinolimit:alimiter=limit=0.8913:attack=0.1:release=150:level=false";

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

// The Dolby Vision profile of the selected video track, or -1 for none.
int64_t selectedDolbyVisionProfile(const mpv_node &root) {
    if (root.format != MPV_FORMAT_NODE_ARRAY || !root.u.list) return -1;
    for (int index = 0; index < root.u.list->num; ++index) {
        const mpv_node &track = root.u.list->values[index];
        if (track.format != MPV_FORMAT_NODE_MAP || !track.u.list) continue;
        bool video = false;
        bool selected = false;
        int64_t profile = -1;
        for (int field = 0; field < track.u.list->num; ++field) {
            const char *name = track.u.list->keys[field];
            const mpv_node &value = track.u.list->values[field];
            if (qstrcmp(name, "type") == 0 && value.format == MPV_FORMAT_STRING)
                video = qstrcmp(value.u.string, "video") == 0;
            else if (qstrcmp(name, "selected") == 0 && value.format == MPV_FORMAT_FLAG)
                selected = value.u.flag != 0;
            else if (qstrcmp(name, "dolby-vision-profile") == 0 && value.format == MPV_FORMAT_INT64)
                profile = value.u.int64;
        }
        if (video && selected) return profile;
    }
    return -1;
}

QVariantList trackPayload(const mpv_node &root, const char *type) {
    QVariantList tracks;
    if (root.format != MPV_FORMAT_NODE_ARRAY || !root.u.list) {
        return tracks;
    }

    for (int index = 0; index < root.u.list->num; ++index) {
        const mpv_node &track = root.u.list->values[index];
        if (track.format != MPV_FORMAT_NODE_MAP || !track.u.list) {
            continue;
        }

        bool matchesType = false;
        QVariantMap entry{{QStringLiteral("external"), false},
                          {QStringLiteral("selected"), false}};
        for (int field = 0; field < track.u.list->num; ++field) {
            const QByteArray name(track.u.list->keys[field]);
            const mpv_node &value = track.u.list->values[field];
            if (name == "type" && value.format == MPV_FORMAT_STRING && value.u.string) {
                matchesType = qstrcmp(value.u.string, type) == 0;
            } else if (name == "id" && value.format == MPV_FORMAT_INT64) {
                entry.insert(QStringLiteral("id"),
                             static_cast<qlonglong>(value.u.int64));
            } else if (value.format == MPV_FORMAT_FLAG &&
                       (name == "selected" || name == "external" ||
                        name == "forced" || name == "hearing-impaired")) {
                const QString key = name == "hearing-impaired"
                    ? QStringLiteral("hearingImpaired") : QString::fromUtf8(name);
                entry.insert(key, value.u.flag != 0);
            } else if (value.format == MPV_FORMAT_STRING && value.u.string &&
                       (name == "title" || name == "lang" || name == "codec")) {
                entry.insert(QString::fromUtf8(name),
                             QString::fromUtf8(value.u.string));
            }
        }

        if (matchesType && entry.contains(QStringLiteral("id"))) {
            tracks.append(entry);
        }
    }
    return tracks;
}

} // namespace

struct MpvContext {
    explicit MpvContext(MpvItem *owner) : item(owner), handle(mpv_create()) {}

    ~MpvContext() {
        // The last renderer has already freed its render context, so the core
        // cannot wait for more frames while it shuts down.
        if (handle) mpv_terminate_destroy(handle);
    }

    std::mutex callbackMutex;
    MpvItem *item;
    mpv_handle *handle;
    // Set once on the GUI thread before Qt can create a renderer.
    bool initialized = false;
};

class MpvRenderer final : public QQuickFramebufferObject::Renderer {
public:
    explicit MpvRenderer(std::shared_ptr<MpvContext> context)
        : context_(std::move(context)) {}

    ~MpvRenderer() override {
        // Qt deletes its FBO renderer on the render thread with its GL context
        // current, including when the scene graph is invalidated.
        if (renderContext_) {
            mpv_render_context_set_update_callback(renderContext_, nullptr, nullptr);
            mpv_render_context_free(renderContext_);
            notifyRenderContext(false);
        }
    }

    QOpenGLFramebufferObject *createFramebufferObject(const QSize &size) override {
        if (!renderContext_ && context_->initialized) {
            mpv_opengl_init_params openGlParameters{resolveOpenGlSymbol, nullptr};
            mpv_render_param parameters[] = {
                {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
                {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &openGlParameters},
                {MPV_RENDER_PARAM_INVALID, nullptr},
            };
            const int result = mpv_render_context_create(&renderContext_, context_->handle,
                                                         parameters);
            if (result < 0) {
                std::lock_guard lock(context_->callbackMutex);
                if (auto *item = context_->item) {
                    QMetaObject::invokeMethod(item, [item]() {
                        item->emitError(QStringLiteral("render-context-unavailable"));
                    }, Qt::QueuedConnection);
                }
            } else {
                mpv_render_context_set_update_callback(renderContext_,
                                                       MpvItem::onRenderUpdate, context_.get());
                notifyRenderContext(true);
            }
        }
        return Renderer::createFramebufferObject(size);
    }

    void render() override {
        if (!renderContext_) {
            return;
        }
        mpv_render_context_update(renderContext_);
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
        mpv_render_context_render(renderContext_, parameters);
        QQuickOpenGLUtils::resetOpenGLState();
    }

private:
    // Runs on the render thread. The item lives on the GUI thread, so the
    // change is queued there and dropped if the item is already gone.
    void notifyRenderContext(bool ready) {
        std::lock_guard lock(context_->callbackMutex);
        if (auto *item = context_->item) {
            QMetaObject::invokeMethod(item, [item, ready]() { item->setRenderContextReady(ready); },
                                      Qt::QueuedConnection);
        }
    }

    std::shared_ptr<MpvContext> context_;
    mpv_render_context *renderContext_ = nullptr;
};

MpvItem::MpvItem(QQuickItem *parent)
    : QQuickFramebufferObject(parent), context_(std::make_shared<MpvContext>(this)),
      handle_(context_->handle), sleepObserver_([this]() {
          // Audio would otherwise start again by itself when the Mac wakes.
          if (!active_ || paused_) return;
          qInfo("[kino:mpv] paused for system sleep");
          setPaused(true);
      }) {
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
    loudnessTimer_.setInterval(kLoudnessIntervalMs);
    connect(&loudnessTimer_, &QTimer::timeout, this, &MpvItem::steerLoudness);
    renderContextTimer_.setInterval(5'000);
    renderContextTimer_.setSingleShot(true);
    connect(&renderContextTimer_, &QTimer::timeout, this, [this]() {
        if (pendingLoad_) emitError(QStringLiteral("render-context-unavailable"));
    });
    // A player that cannot start must not take the window down with it. The
    // item stays inert and every load reports player-unavailable instead.
    if (!handle_) {
        qCritical("[kino:mpv] initialization failed stage=create");
        return;
    }
    context_->initialized = initialize();
}

bool MpvItem::available() const {
    return context_->initialized;
}

MpvItem::~MpvItem() {
    {
        // A callback may already be running on an mpv thread. Finish posting
        // its queued call before detaching the receiver; Qt removes pending
        // calls when the item is destroyed.
        std::lock_guard lock(context_->callbackMutex);
        context_->item = nullptr;
    }
    if (available()) mpv_set_wakeup_callback(handle_, nullptr, nullptr);
}

bool MpvItem::active() const {
    return active_;
}

QQuickFramebufferObject::Renderer *MpvItem::createRenderer() const {
    return new MpvRenderer(context_);
}

double MpvItem::playbackSpeed() const {
    double speed = 0;
    if (!available()) return 0;
    if (mpv_get_property(handle_, "speed", MPV_FORMAT_DOUBLE, &speed) < 0) return 0;
    return speed;
}

QVariantMap MpvItem::subtitleStyle() const {
    static const char *const names[] = {
        "sub-ass-override", "sub-ass-style-overrides", "sub-back-color",
        "sub-blur",         "sub-border-style",        "sub-color",
        "sub-outline-color", "sub-outline-size",       "sub-shadow-offset",
    };
    QVariantMap style;
    if (!available()) return style;
    for (const char *name : names) {
        char *value = mpv_get_property_string(handle_, name);
        if (!value) continue;
        style.insert(QString::fromUtf8(name), QString::fromUtf8(value).trimmed());
        mpv_free(value);
    }
    return style;
}

QString MpvItem::version() const {
    if (!available()) return QStringLiteral("Unavailable");
    char *value = mpv_get_property_string(handle_, "mpv-version");
    if (!value) return QStringLiteral("Unavailable");
    const QString version = QString::fromUtf8(value).trimmed();
    mpv_free(value);
    return version;
}

bool MpvItem::initialize() {
    const QByteArray hardwareDecoders = Platform::hardwareDecoders();
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
        {"hwdec", hardwareDecoders.constData()},
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
        // The Stereo downmix keeps unity front and -3 dB centre and surround
        // gains without a static headroom cut; the limiter handles the rare
        // peak instead, as on TV.
        {"audio-normalize-downmix", "no"},
        {"title", "Kino"},
        {"sid", "no"},
        {"sub-auto", "no"},
        // Kino has no playback-rate feature, so nothing changes this and the
        // shell never offers a control for it.
        {"speed", "1.0"},
        // Text subtitles render as outlined glyphs over the video. Pin every
        // field the box could come back from: Kino's own style, a libmpv
        // default, and the authored ASS/SSA styles libass would otherwise
        // honour. "sub-shadow-color" is an alias for "sub-back-color", so a
        // transparent back colour also removes the drop shadow.
        {"sub-border-style", "outline-and-shadow"},
        {"sub-color", "#FFFFFFFF"},
        {"sub-outline-color", "#FF000000"},
        {"sub-outline-size", "3"},
        {"sub-back-color", "#00000000"},
        {"sub-shadow-offset", "0"},
        {"sub-blur", "0"},
        // "scale" keeps authored positions, fonts, italics, and text colours.
        // The style overrides replace only the fields that draw a box:
        // BorderStyle 3 becomes an outline, and the box/shadow colour and the
        // outline colour become transparent black and opaque black. ASS colours
        // are &HAABBGGRR with 00 opaque, so &HFF000000& is fully transparent.
        {"sub-ass-override", "scale"},
        {"sub-ass-style-overrides",
         "BorderStyle=1,Outline=3,Shadow=0,OutlineColour=&H00000000&,BackColour=&HFF000000&"},
    };

    for (const Option &option : options) {
        if (mpv_set_option_string(handle_, option.name, option.value) < 0) {
            qCritical("[kino:mpv] initialization failed stage=option name=%s", option.name);
            return false;
        }
    }
    if (mpv_initialize(handle_) < 0) {
        qCritical("[kino:mpv] initialization failed stage=initialize");
        return false;
    }

    mpv_set_wakeup_callback(handle_, &MpvItem::onWakeup, context_.get());
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
    mpv_observe_property(handle_, 10, "volume", MPV_FORMAT_DOUBLE);
    mpv_observe_property(handle_, 11, "demuxer-cache-time", MPV_FORMAT_DOUBLE);
    mpv_observe_property(handle_, 12, "container-fps", MPV_FORMAT_DOUBLE);
    return true;
}

void MpvItem::load(const QString &url, bool forceStereo, const QVariantMap &headers, const QString &audioLanguage) {
    if (!available()) {
        emitError(QStringLiteral("player-unavailable"));
        return;
    }
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
    // FFmpeg's OpenSSL would otherwise look for roots only where Homebrew
    // keeps them, so HTTPS media on a Mac without Homebrew would never verify.
    const QByteArray roots = TlsRoots::bundlePath().toUtf8();
    if (!roots.isEmpty()) {
        mpv_set_property_string(handle_, "tls-ca-file", roots.constData());
    }
    failed_ = false;
    bufferedMs_ = -1;
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
    // Only the Stereo path is normalized; Auto leaves levels to the equipment.
    normalizing_ = forceStereo;
    loudnessTicks_ = 0;
    loudnessGainDb_ = 0;
    integratedLufs_ = -70;
    QByteArray audioFilters = forceStereo ? QByteArray(kStereoFilters) : QByteArray();
    char *audioFiltersData = audioFilters.data();
    mpv_set_property_async(handle_, 0, "af", MPV_FORMAT_STRING, &audioFiltersData);
    if (forceStereo) loudnessTimer_.start();
    else loudnessTimer_.stop();
    QByteArray subtitleTrack = QByteArrayLiteral("no");
    char *subtitleTrackData = subtitleTrack.data();
    mpv_set_property_async(handle_, 0, "sid", MPV_FORMAT_STRING, &subtitleTrackData);
    double subtitleDelay = 0;
    mpv_set_property_async(handle_, 0, "sub-delay", MPV_FORMAT_DOUBLE, &subtitleDelay);
    int unpaused = 0;
    mpv_set_property_async(handle_, 0, "pause", MPV_FORMAT_FLAG, &unpaused);
    // The captured buffers own every string the command node points at.
    auto issueLoad = [this, encodedUrl = url.toUtf8(), headerFields,
                      preferredLanguage = audioLanguage.trimmed().toUtf8()]() mutable {
        char loadfile[] = "loadfile";
        char replace[] = "replace";
        char headerOption[] = "http-header-fields";
        char audioLanguageOption[] = "alang";
        char audioTrackOption[] = "aid";
        char automaticAudio[] = "auto";
        char *optionNames[] = {headerOption, audioLanguageOption, audioTrackOption};
        mpv_node optionValues[3]{};
        for (auto &value : optionValues) value.format = MPV_FORMAT_STRING;
        optionValues[0].u.string = headerFields.data();
        optionValues[1].u.string = preferredLanguage.data();
        optionValues[2].u.string = automaticAudio;
        // Per-file options apply before track selection and reset a previous
        // file's manual choice without changing the user's language preference.
        mpv_node_list options{3, optionValues, optionNames};
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
        if (mpv_command_node_async(handle_, 0, &command) < 0) {
            emitError(QStringLiteral("source-load-failed"));
            return;
        }
        qInfo("[kino:mpv] source load requested");
    };
    emit playerEvent(QStringLiteral("buffering"), {{QStringLiteral("active"), true}});
    emit playerEvent(QStringLiteral("paused"), {{QStringLiteral("paused"), false}});
    if (renderContextReady_) {
        pendingLoad_ = nullptr;
        issueLoad();
        return;
    }
    // setActive(true) above made the item visible; the scene graph creates the
    // renderer and its context on the next frame and releases this load.
    pendingLoad_ = std::move(issueLoad);
    renderContextTimer_.start();
}

void MpvItem::addSubtitles(const QString &url, const QString &title, const QString &lang) {
    if (!available()) return;
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

QVariantMap MpvItem::pauseAndSnapshot() {
    if (!available()) return {};
    int paused = 1;
    mpv_set_property(handle_, "pause", MPV_FORMAT_FLAG, &paused);
    double time = 0;
    double duration = 0;
    mpv_get_property(handle_, "time-pos", MPV_FORMAT_DOUBLE, &time);
    mpv_get_property(handle_, "duration", MPV_FORMAT_DOUBLE, &duration);
    return {
        {QStringLiteral("time"), std::isfinite(time) ? std::llround(std::max(0.0, time) * 1000) : 0},
        {QStringLiteral("duration"), std::isfinite(duration) ? std::llround(std::max(0.0, duration) * 1000) : 0},
    };
}

void MpvItem::seek(double seconds) {
    if (!available()) return;
    double safeSeconds = std::max(0.0, seconds);
    mpv_set_property_async(handle_, 0, "time-pos", MPV_FORMAT_DOUBLE, &safeSeconds);
}

void MpvItem::setMuted(bool muted) {
    if (!available()) return;
    int value = muted ? 1 : 0;
    mpv_set_property_async(handle_, 0, "mute", MPV_FORMAT_FLAG, &value);
}

void MpvItem::setVolume(double percent) {
    if (!available()) return;
    if (!std::isfinite(percent)) return;
    double value = std::clamp(percent, 0.0, 100.0);
    mpv_set_property_async(handle_, 0, "volume", MPV_FORMAT_DOUBLE, &value);
}

void MpvItem::setPaused(bool paused) {
    if (!available()) return;
    int value = paused ? 1 : 0;
    mpv_set_property_async(handle_, 0, "pause", MPV_FORMAT_FLAG, &value);
}

void MpvItem::setSubtitleDelay(double seconds) {
    if (!available()) return;
    double value = std::clamp(seconds, -60.0, 60.0);
    mpv_set_property_async(handle_, 0, "sub-delay", MPV_FORMAT_DOUBLE, &value);
}

void MpvItem::setSubtitlePosition(int position) {
    if (!available()) return;
    int64_t value = std::clamp(position, 0, 150);
    mpv_set_property_async(handle_, 0, "sub-pos", MPV_FORMAT_INT64, &value);
}

void MpvItem::setSubtitleScale(double scale) {
    if (!available()) return;
    double value = std::clamp(scale, 0.1, 5.0);
    mpv_set_property_async(handle_, 0, "sub-scale", MPV_FORMAT_DOUBLE, &value);
}

void MpvItem::setSubtitleTrack(int id) {
    if (!available()) return;
    if (id > 0) {
        int64_t value = id;
        mpv_set_property_async(handle_, 0, "sid", MPV_FORMAT_INT64, &value);
        return;
    }
    QByteArray disabled = QByteArrayLiteral("no");
    char *disabledData = disabled.data();
    mpv_set_property_async(handle_, 0, "sid", MPV_FORMAT_STRING, &disabledData);
}

void MpvItem::setAudioTrack(int id) {
    if (!available()) return;
    if (id <= 0) return;
    int64_t value = id;
    mpv_set_property_async(handle_, 0, "aid", MPV_FORMAT_INT64, &value);
}

void MpvItem::matchDisplayTo(double frameRate) {
    if (!matchFrameRate_ || frameRateMatched_ || !(frameRate > 1) || !handle_) return;
    frameRateMatched_ = true;
    // The display goes dark for a moment while it changes mode; hold playback over it.
    const bool playing = !paused_;
    if (playing) mpv_set_property_string(handle_, "pause", "yes");
    const bool switched = displayMode_.match(window(), frameRate);
    if (switched)
        emit playerEvent(QStringLiteral("refreshRate"),
                         {{QStringLiteral("hz"), DisplayModeMatcher::refreshRate(window())}});
    if (playing)
        QTimer::singleShot(switched ? 1500 : 0, this, [this]() {
            if (handle_) mpv_set_property_string(handle_, "pause", "no");
        });
}

void MpvItem::stop() {
    pendingLoad_ = nullptr;
    loudnessTimer_.stop();
    // Leaving playback hands the display back its own mode.
    displayMode_.restore();
    frameRateMatched_ = false;
    renderContextTimer_.stop();
    hardwareDecoderTimer_.stop();
    if (available()) {
        const char *command[] = {"stop", nullptr};
        mpv_command_async(handle_, 0, command);
    }
    setActive(false);
}

void MpvItem::togglePaused() {
    if (!available()) return;
    const char *command[] = {"cycle", "pause", nullptr};
    mpv_command_async(handle_, 0, command);
}

void MpvItem::onRenderUpdate(void *context) {
    auto &state = *static_cast<MpvContext *>(context);
    std::lock_guard lock(state.callbackMutex);
    if (state.item) emit state.item->renderUpdateRequested();
}

void MpvItem::onWakeup(void *context) {
    auto &state = *static_cast<MpvContext *>(context);
    std::lock_guard lock(state.callbackMutex);
    if (state.item) {
        QMetaObject::invokeMethod(state.item, &MpvItem::processEvents, Qt::QueuedConnection);
    }
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
            hardwareDecoderActive_ = Platform::isHardwareDecoder(stringPropertyValue(*property));
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
        } else if (name == "demuxer-cache-time" && property->format == MPV_FORMAT_DOUBLE) {
            const double seconds = *static_cast<double *>(property->data);
            if (!std::isfinite(seconds) || seconds < 0) break;
            const long long milliseconds = std::llround(seconds * 1000.0);
            if (bufferedMs_ >= 0 && milliseconds >= bufferedMs_ &&
                milliseconds - bufferedMs_ < 1000) {
                break;
            }
            bufferedMs_ = milliseconds;
            emit playerEvent(QStringLiteral("buffered"),
                             {{QStringLiteral("milliseconds"), milliseconds}});
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
        } else if (name == "volume" && property->format == MPV_FORMAT_DOUBLE) {
            const double percent = *static_cast<double *>(property->data);
            if (std::isfinite(percent)) {
                emit playerEvent(QStringLiteral("volume"),
                                 {{QStringLiteral("percent"), std::clamp(percent, 0.0, 100.0)}});
            }
        } else if (name == "container-fps" && property->format == MPV_FORMAT_DOUBLE) {
            matchDisplayTo(*static_cast<double *>(property->data));
        } else if (name == "chapter-list" && property->format == MPV_FORMAT_NODE) {
            const auto *chapters = static_cast<const mpv_node *>(property->data);
            emit playerEvent(
                QStringLiteral("chapters"),
                {{QStringLiteral("items"), chapterPayload(*chapters)}});
        } else if (name == "track-list" && property->format == MPV_FORMAT_NODE) {
            const auto *tracks = static_cast<const mpv_node *>(property->data);
            // Profile 5 has no base layer mpv can show without Dolby's reshaping, which
            // this renderer does not apply, so its picture would come out tinted. Refuse it,
            // as the contract asks, rather than play the wrong colours.
            if (!failed_ && selectedDolbyVisionProfile(*tracks) == 5) {
                emitError(QStringLiteral("dolby-vision-unsupported"));
                const char *command[] = {"stop", nullptr};
                mpv_command_async(handle_, 0, command);
                break;
            }
            emit playerEvent(
                QStringLiteral("subtitleTracks"),
                {{QStringLiteral("items"), trackPayload(*tracks, "sub")}});
            emit playerEvent(
                QStringLiteral("audioTracks"),
                {{QStringLiteral("items"), trackPayload(*tracks, "audio")}});
        }
        break;
    }
    case MPV_EVENT_END_FILE: {
        const auto *end = static_cast<mpv_event_end_file *>(event->data);
        hardwareDecoderTimer_.stop();
        displayMode_.restore();
        frameRateMatched_ = false;
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
    pendingLoad_ = nullptr;
    renderContextTimer_.stop();
    hardwareDecoderTimer_.stop();
    setActive(false);
    qCritical("[kino:mpv] playback failed code=%s", qPrintable(code));
    emit playerEvent(QStringLiteral("error"), {{QStringLiteral("code"), code}});
}

QVariantMap MpvItem::loudness() const {
    return {
        {QStringLiteral("normalizing"), normalizing_},
        {QStringLiteral("integratedLufs"), integratedLufs_},
        {QStringLiteral("gainDb"), loudnessGainDb_},
    };
}

void MpvItem::steerLoudness() {
    if (!available() || !normalizing_ || !active_ || paused_) return;
    mpv_node metadata{};
    if (mpv_get_property(handle_, "af-metadata/kinoloud", MPV_FORMAT_NODE, &metadata) < 0) return;
    double integrated = std::nan("");
    if (metadata.format == MPV_FORMAT_NODE_MAP && metadata.u.list) {
        for (int index = 0; index < metadata.u.list->num; ++index) {
            const mpv_node &value = metadata.u.list->values[index];
            if (qstrcmp(metadata.u.list->keys[index], "lavfi.r128.I") == 0 &&
                value.format == MPV_FORMAT_STRING) {
                integrated = std::strtod(value.u.string, nullptr);
            }
        }
    }
    mpv_free_node_contents(&metadata);
    // Below the absolute gate nothing has been measured yet, and the first
    // blocks of a program are too few to trust.
    if (!std::isfinite(integrated) || integrated <= -70 || ++loudnessTicks_ < kLoudnessWarmupTicks) {
        return;
    }
    integratedLufs_ = integrated;
    const double desired = std::clamp(kTargetLufs - integrated, kMaxCutDb, kMaxBoostDb);
    const double seconds = desired > loudnessGainDb_ ? kRiseSeconds : kFallSeconds;
    loudnessGainDb_ += (desired - loudnessGainDb_) *
                       (1.0 - std::exp(-(kLoudnessIntervalMs / 1000.0) / seconds));
    const QByteArray gain = QByteArray::number(loudnessGainDb_, 'f', 2) + "dB";
    const char *command[] = {"af-command", "kinogain", "volume", gain.constData(), nullptr};
    mpv_command_async(handle_, 0, command);
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

void MpvItem::setRenderContextReady(bool ready) {
    renderContextReady_ = ready;
    if (!ready || !pendingLoad_) return;
    renderContextTimer_.stop();
    auto issueLoad = std::move(pendingLoad_);
    pendingLoad_ = nullptr;
    issueLoad();
}

void MpvItem::updatePowerGuard() {
    powerGuard_.setActive(active_ && videoPresent_ && !paused_);
}
