@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.graphics.Color
import android.media.MediaCodecInfo.CodecProfileLevel as MediaCodecInfoLevels
import android.net.Uri
import android.os.Handler
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.*
import androidx.media3.common.text.Cue
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.CodecSpecificDataUtil
import androidx.media3.common.util.Util
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioCapabilities
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.session.MediaSession
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Button
import androidx.tv.material3.Text
import kotlinx.coroutines.*

/**
 * Hardware video only, with HDR10 and HLG tone mapped to SDR by Kino rather than passed to the
 * display.
 *
 * A PQ or HLG source configures its decoder against [HdrVideoOutput]'s surface instead of the
 * player's display surface; that output tone maps each frame and draws it into the display surface
 * itself. The renderer intercepts the player's own `MSG_SET_VIDEO_OUTPUT` for this, so the player
 * keeps managing one display surface while the decoder never sees it during HDR playback. SDR takes
 * the direct path unchanged. Dolby Vision plays only profile 8's base layer; the other profiles stay
 * rejected until each is measured on the device the way HDR10 and HLG were (ADR 0021, ADR 0027),
 * before a decoder is configured or a surface exposed.
 *
 * With [stereo] set, the sink accepts PCM only, so every track is decoded and folded to two
 * channels by [StereoDownmixProcessor] inside Kino rather than passed through or left to the
 * platform mixer, and [LoudnessNormalizer] then evens the level out across sources so a film and a
 * web video do not need different volume settings.
 */
class HardwareRenderers(context: Context, private val stereo: Boolean = false) :
    DefaultRenderersFactory(context) {
    var unsupportedReason: Int = R.string.hardware_required
        private set

    /** Whether the current video decoder renders through Kino's HDR tone mapping. */
    @Volatile
    var toneMapping: Boolean = false
        private set

    private var hdrOutput: HdrVideoOutput? = null

    /** Tone-mapped frames the current player has presented, for the playback gates. */
    val toneMappedFramesPresented: Long
        get() = hdrOutput?.presentedFrames ?: 0L

    /**
     * Called on the playback thread with the coded video size when HDR tone mapping starts, so the
     * display surface's buffers can match the video rather than the interface resolution.
     */
    var onToneMappedVideoSize: ((width: Int, height: Int) -> Unit)? = null

    /**
     * The session's subtitle delay; positive shows text later. The text renderers read the clock
     * this much behind the video, so embedded, side-loaded and add-on tracks all move together
     * without re-parsing anything.
     */
    @Volatile var subtitleDelayUs: Long = 0

    override fun buildTextRenderers(
        context: Context,
        output: androidx.media3.exoplayer.text.TextOutput,
        outputLooper: android.os.Looper,
        extensionRendererMode: Int,
        out: ArrayList<Renderer>,
    ) {
        val first = out.size
        super.buildTextRenderers(context, output, outputLooper, extensionRendererMode, out)
        for (index in first until out.size) {
            out[index] =
                // Every position the renderer sees moves by the delay, including where a seek
                // resets it, so its idea of the current cue stays consistent after a seek.
                object : androidx.media3.exoplayer.ForwardingRenderer(out[index]) {
                    override fun render(positionUs: Long, elapsedRealtimeUs: Long) =
                        super.render(positionUs - subtitleDelayUs, elapsedRealtimeUs)

                    override fun resetPosition(positionUs: Long, sampleStreamIsResetToKeyFrame: Boolean) =
                        super.resetPosition(positionUs - subtitleDelayUs, sampleStreamIsResetToKeyFrame)
                }
        }
    }

    override fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioTrackPlaybackParams: Boolean,
    ): AudioSink {
        val builder = DefaultAudioSink.Builder(context).setEnableFloatOutput(enableFloatOutput)
        if (stereo) {
            builder
                .setAudioCapabilities(AudioCapabilities.DEFAULT_AUDIO_CAPABILITIES)
                .setAudioProcessors(arrayOf(StereoDownmixProcessor(), LoudnessNormalizer()))
        }
        return builder.build()
    }

    private fun dolbyVisionProfile(format: Format): Int? =
        if (format.sampleMimeType != MimeTypes.VIDEO_DOLBY_VISION) null
        else CodecSpecificDataUtil.getCodecProfileAndLevel(format)?.first ?: -1

    /**
     * Every Dolby Vision profile except 8. Profile 8 carries a cross-compatible base layer that an
     * HEVC decoder plays on its own, ignoring the enhancement metadata, and whose range the
     * container's colour tags state: 8.1 is HDR10 and 8.4 is HLG, both tone mapped, and 8.2 is
     * SDR. Profile 5 has no compatible base layer, so decoding it as HEVC would show the wrong
     * colours, and 7 and 9 have not been measured.
     */
    private fun rejectedRange(format: Format): Boolean {
        val profile = dolbyVisionProfile(format) ?: return false
        return profile != MediaCodecInfoLevels.DolbyVisionProfileDvheSt || format.colorInfo == null
    }

    /** The HDR transfer Kino tone maps, PQ or HLG, or null for a source that needs none. */
    private fun hdrTransfer(format: Format): Int? =
        format.colorInfo?.colorTransfer?.takeIf {
            it == C.COLOR_TRANSFER_ST2084 || it == C.COLOR_TRANSFER_HLG
        }

    override fun buildVideoRenderers(
        context: Context,
        extensionRendererMode: Int,
        mediaCodecSelector: MediaCodecSelector,
        enableDecoderFallback: Boolean,
        eventHandler: Handler,
        eventListener: VideoRendererEventListener,
        allowedVideoJoiningTimeMs: Long,
        out: ArrayList<Renderer>,
    ) {
        out.add(
            object :
                MediaCodecVideoRenderer(
                    MediaCodecVideoRenderer.Builder(context)
                        .setEventHandler(eventHandler)
                        .setEventListener(eventListener)
                        .setAllowedJoiningTimeMs(allowedVideoJoiningTimeMs)
                        .setEnableDecoderFallback(false)
                ) {
                /** The display surface the player last asked for. */
                private var displayOutput: Any? = null

                override fun handleMessage(messageType: Int, message: Any?) {
                    if (messageType == Renderer.MSG_SET_VIDEO_OUTPUT) {
                        displayOutput = message
                        // During tone mapping the decoder stays on Kino's input surface and the
                        // display surface becomes the tone mapper's target instead.
                        if (toneMapping) {
                            hdrOutput?.setDisplay(message as? android.view.Surface)
                            return
                        }
                    }
                    super.handleMessage(messageType, message)
                }

                override fun getDecoderInfos(
                    selector: MediaCodecSelector,
                    format: Format,
                    requiresSecureDecoder: Boolean,
                ): List<MediaCodecInfo> {
                    if (rejectedRange(format)) {
                        unsupportedReason = R.string.hdr_unsupported
                        return emptyList()
                    }
                    // Dolby Vision profile 8 goes to the HEVC decoders for its base layer. The
                    // Shield's Dolby Vision decoder would hand the display a Dolby Vision signal,
                    // which is exactly the output Kino does not produce.
                    val decoders =
                        if (dolbyVisionProfile(format) != null)
                            MediaCodecUtil.getAlternativeDecoderInfos(
                                selector,
                                format,
                                requiresSecureDecoder,
                                false,
                            )
                        else super.getDecoderInfos(selector, format, requiresSecureDecoder)
                    return decoders.filter { it.hardwareAccelerated && !it.softwareOnly }
                }

                override fun getMediaCodecConfiguration(
                    codecInfo: MediaCodecInfo,
                    format: Format,
                    crypto: android.media.MediaCrypto?,
                    codecOperatingRate: Float,
                ): MediaCodecAdapter.Configuration {
                    Log.i(
                        "KinoPlayer",
                        "Video input mime=${format.sampleMimeType} transfer=${format.colorInfo?.colorTransfer}",
                    )
                    check(codecInfo.hardwareAccelerated && !codecInfo.softwareOnly) {
                        "Hardware decoding required"
                    }
                    if (rejectedRange(format)) {
                        unsupportedReason = R.string.hdr_unsupported
                        throw IllegalStateException("HDR conversion is not validated")
                    }
                    val transfer = hdrTransfer(format)
                    if (transfer != null) startToneMapping(format, transfer)
                    else if (toneMapping) stopToneMapping()
                    return super.getMediaCodecConfiguration(
                        codecInfo,
                        format,
                        crypto,
                        codecOperatingRate,
                    )
                }

                private fun startToneMapping(format: Format, transfer: Int) {
                    val hlg = transfer == C.COLOR_TRANSFER_HLG
                    if (toneMapping && hdrOutput?.hlg == hlg) return
                    // A stream that changes between PQ and HLG needs the other conversion.
                    hdrOutput?.takeIf { it.hlg != hlg }?.let {
                        it.setDisplay(null)
                        it.release()
                        hdrOutput = null
                    }
                    val output =
                        try {
                            hdrOutput
                                ?: HdrVideoOutput(
                                        HdrToneMapper.sourcePeakNits(
                                            format.colorInfo?.hdrStaticInfo
                                        ),
                                        hlg,
                                    )
                                    .also { hdrOutput = it }
                        } catch (error: IllegalStateException) {
                            unsupportedReason = R.string.hdr_unsupported
                            throw error
                        }
                    output.setDisplay(displayOutput as? android.view.Surface)
                    toneMapping = true
                    super.handleMessage(Renderer.MSG_SET_VIDEO_OUTPUT, output.inputSurface)
                    if (format.width > 0 && format.height > 0)
                        onToneMappedVideoSize?.invoke(format.width, format.height)
                }

                private fun stopToneMapping() {
                    // Release the display surface from EGL before a decoder connects to it.
                    hdrOutput?.setDisplay(null)
                    toneMapping = false
                    super.handleMessage(Renderer.MSG_SET_VIDEO_OUTPUT, displayOutput)
                }

                override fun getMediaFormat(
                    format: Format,
                    codecMimeType: String,
                    codecMaxValues: CodecMaxValues,
                    codecOperatingRate: Float,
                    deviceNeedsNoPostProcessWorkaround: Boolean,
                    tunnelingAudioSessionId: Int,
                ): android.media.MediaFormat {
                    val mediaFormat =
                        super.getMediaFormat(
                            format,
                            codecMimeType,
                            codecMaxValues,
                            codecOperatingRate,
                            deviceNeedsNoPostProcessWorkaround,
                            tunnelingAudioSessionId,
                        )
                    // Media3 names the Dolby Vision profile on the codec, which means nothing to
                    // the HEVC decoder playing profile 8's ten-bit base layer.
                    if (
                        codecMimeType == MimeTypes.VIDEO_H265 &&
                            format.sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION
                    )
                        mediaFormat.setInteger(
                            android.media.MediaFormat.KEY_PROFILE,
                            MediaCodecInfoLevels.HEVCProfileMain10,
                        )
                    return mediaFormat
                }

                override fun onOutputFormatChanged(
                    format: Format,
                    mediaFormat: android.media.MediaFormat?,
                ) {
                    val transfer =
                        mediaFormat
                            ?.takeIf {
                                it.containsKey(android.media.MediaFormat.KEY_COLOR_TRANSFER)
                            }
                            ?.getInteger(android.media.MediaFormat.KEY_COLOR_TRANSFER)
                    // A decoder that reports PQ or HLG it was not configured for would put HDR
                    // code values on an SDR display, or through the other conversion.
                    val hdr = transfer == C.COLOR_TRANSFER_ST2084 || transfer == C.COLOR_TRANSFER_HLG
                    if (
                        hdr &&
                            (!toneMapping ||
                                hdrOutput?.hlg != (transfer == C.COLOR_TRANSFER_HLG))
                    ) {
                        unsupportedReason = R.string.hdr_unsupported
                        throw IllegalStateException("HDR conversion is not validated")
                    }
                    super.onOutputFormatChanged(format, mediaFormat)
                }

                override fun onRelease() {
                    super.onRelease()
                    hdrOutput?.release()
                    hdrOutput = null
                    toneMapping = false
                }
            }
        )
    }
}

/**
 * White glyphs with a black outline and nothing filled behind them. Media3 otherwise takes the
 * device caption style, whose default paints a black rectangle behind every line.
 */
val outlinedCaptionStyle =
    CaptionStyleCompat(
        Color.WHITE,
        Color.TRANSPARENT,
        Color.TRANSPARENT,
        CaptionStyleCompat.EDGE_TYPE_OUTLINE,
        Color.BLACK,
        null,
    )

/**
 * Removes the fills a cue asks for itself. Media3's SSA parser turns an authored `BorderStyle: 3`
 * into a background span, and WebVTT cues can set a window colour; both draw the rectangle the
 * caption style already refuses. Italics, bold, text colour, alignment, and line breaks are left
 * alone.
 */
fun withoutCaptionFills(cue: Cue): Cue {
    val text = cue.text
    val fills =
        (text as? Spanned)?.getSpans(0, text.length, BackgroundColorSpan::class.java)
            ?: emptyArray()
    if (!cue.windowColorSet && fills.isEmpty()) return cue
    val builder = cue.buildUpon().clearWindowColor()
    if (fills.isNotEmpty()) {
        val stripped = SpannableString(text)
        for (fill in fills) stripped.removeSpan(fill)
        builder.setText(stripped)
    }
    return builder.build()
}

/**
 * The player as the TV presentation exposes it: captions stripped of their fills by
 * [withoutCaptionFills], and no playback-rate control. Media3's control view lists its Speed row
 * whenever the player advertises COMMAND_SET_SPEED_AND_PITCH, and dropping it also refuses the rate
 * changes that row would have made. The settings button stays, because its audio-track row is gated
 * on COMMAND_GET_TRACKS and COMMAND_SET_TRACK_SELECTION_PARAMETERS instead.
 */
class TvPresentationPlayer(
    player: Player,
    private val onTrackSelection: (TrackSelectionParameters) -> Unit = {},
) : ForwardingSimpleBasePlayer(player) {
    override fun handleSetTrackSelectionParameters(
        parameters: TrackSelectionParameters
    ): com.google.common.util.concurrent.ListenableFuture<*> {
        onTrackSelection(parameters)
        return super.handleSetTrackSelectionParameters(parameters)
    }

    override fun getState(): SimpleBasePlayer.State {
        val state = super.getState()
        val builder =
            state
                .buildUpon()
                .setAvailableCommands(
                    Player.Commands.Builder()
                        .addAll(state.availableCommands)
                        .remove(Player.COMMAND_SET_SPEED_AND_PITCH)
                        .build()
                )
        val group = state.currentCues
        if (group.cues.isNotEmpty()) {
            builder.setCurrentCues(
                CueGroup(group.cues.map(::withoutCaptionFills), group.presentationTimeUs)
            )
        }
        return builder.build()
    }
}

/**
 * Media3's default buffer stops at about 128 MB of video, about 17 seconds of a 60 Mbps remux, so
 * a Wi-Fi stall any longer rebuffers it. The manifest asks for Android's large heap, where Media3
 * holds its buffer, and Kino lets the buffer take up to half of it, capped at 384 MB. Media3's
 * 50-second limit still applies, so lighter sources buffer no further than before.
 */
internal fun kinoLoadControl(maxMemory: Long = Runtime.getRuntime().maxMemory()): DefaultLoadControl =
    DefaultLoadControl.Builder()
        .setTargetBufferBytes(
            (maxMemory / 2)
                .coerceIn(DefaultLoadControl.DEFAULT_VIDEO_BUFFER_SIZE.toLong(), 384L shl 20)
                .toInt()
        )
        .build()

fun createTvPlayer(
    context: Context,
    renderers: HardwareRenderers,
    headers: Map<String, String> = emptyMap(),
    extractorsFactory: ExtractorsFactory? = null,
    loadControl: LoadControl = kinoLoadControl(),
): ExoPlayer {
    // ExoPlayer's default throwable logging includes request URLs. Emit only stable event names.
    androidx.media3.common.util.Log.setLogger(
        object : androidx.media3.common.util.Log.Logger {
            override fun d(tag: String, message: String, throwable: Throwable?) = Unit

            override fun i(tag: String, message: String, throwable: Throwable?) = Unit

            override fun w(tag: String, message: String, throwable: Throwable?) {
                Log.w("KinoPlayer", "Media3 warning")
            }

            override fun e(tag: String, message: String, throwable: Throwable?) {
                Log.e("KinoPlayer", "Media3 error")
            }
        }
    )
    val http =
        DefaultHttpDataSource.Factory()
            .setUserAgent("Kino/${BuildConfig.VERSION_NAME}")
            .setAllowCrossProtocolRedirects(false)
            .setDefaultRequestProperties(headers)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(20000)
    // Platform renderers come first, so passthrough and MediaCodec decoders win
    // when the sink or device offers them. The FFmpeg audio renderer follows as
    // the fallback for AC-3, E-AC-3, DTS, and TrueHD tracks the Shield cannot
    // decode itself once passthrough is unavailable. Video stays hardware-only.
    renderers.setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
    return ExoPlayer.Builder(context, renderers)
        .setMediaSourceFactory(
            (extractorsFactory?.let { DefaultMediaSourceFactory(context, it) }
                    ?: DefaultMediaSourceFactory(context))
                .setDataSourceFactory(DefaultDataSource.Factory(context, http))
                .setLoadErrorHandlingPolicy(KinoLoadErrorPolicy())
        )
        // Holds the Wi-Fi and CPU awake while playing, so a Shield on Wi-Fi does not drop the
        // stream when its radio would otherwise sleep.
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .setLoadControl(loadControl)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(),
            true,
        )
        .setHandleAudioBecomingNoisy(true)
        .build()
}

/**
 * Retries what can pass: a dropped connection, a timeout, a server error. The default policy's
 * backoff grows by a second per attempt up to five, so six attempts ride out about fifteen seconds
 * of trouble. A refusal or a missing file will not change on a retry, so it fails at once and the
 * viewer can choose another source.
 */
internal class KinoLoadErrorPolicy : DefaultLoadErrorHandlingPolicy(6) {
    override fun getRetryDelayMsFor(
        loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo
    ): Long {
        val status =
            (loadErrorInfo.exception as? HttpDataSource.InvalidResponseCodeException)?.responseCode
        if (status != null && status in 400..499 && status != 408 && status != 429)
            return C.TIME_UNSET
        return super.getRetryDelayMsFor(loadErrorInfo)
    }
}

/** What the details page says about a source that failed, by what went wrong. */
internal fun playbackFailureReason(error: PlaybackException, unsupported: Int): Int {
    var cause: Throwable? = error.cause
    while (cause != null && cause !is HttpDataSource.InvalidResponseCodeException)
        cause = cause.cause
    val status = (cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
    return when {
        status == 401 || status == 403 -> R.string.playback_refused
        status == 404 || status == 410 -> R.string.playback_gone
        status != null && status >= 500 -> R.string.playback_server_failed
        error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
            error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
            R.string.playback_network
        error.errorCode in 3000..3999 -> R.string.playback_damaged
        error.errorCode in 4000..4999 -> unsupported
        error.errorCode in 5000..5999 -> R.string.playback_audio_output
        else -> R.string.playback_error
    }
}

/**
 * The playback surface and its controls.
 *
 * The remote reveals hidden controls through [PlayerView.dispatchKeyEvent], which the view only
 * receives while it holds Android focus. Compose owns focus inside an `AndroidView`, and a
 * `requestFocus()` call made while the view is still detached does nothing, so focus is claimed
 * once the view reaches a window instead.
 */
fun tvPlayerView(
    context: Context,
    player: Player,
    retainExternalFocus: () -> Boolean = { false },
): PlayerView =
    (LayoutInflater.from(context).inflate(R.layout.kino_player_view, null, false) as PlayerView)
        .apply {
            this.player = player
            subtitleView?.apply {
                // Keep italics and the other authored text styling; only the fills
                // are dropped, by the style and by the presentation.
                setApplyEmbeddedStyles(true)
                setStyle(outlinedCaptionStyle)
            }
            setShowSubtitleButton(true)
            setShowNextButton(false)
            setShowPreviousButton(false)
            controllerShowTimeoutMs = 3500
            keepScreenOn = false
            isFocusable = true
            addOnAttachStateChangeListener(
                object : View.OnAttachStateChangeListener {
                    override fun onViewAttachedToWindow(attached: View) {
                        // Focus is only grantable once the view has a window, and
                        // the first layout pass has to land before it can take it.
                        attached.post { attached.requestFocus() }
                    }

                    override fun onViewDetachedFromWindow(detached: View) = Unit
                }
            )
            // Hiding the controls takes their focused button away with them, and
            // Compose reclaims focus from the surrounding hierarchy. Taking it back
            // on every hide is what keeps the next remote press revealing them.
            setControllerVisibilityListener(
                PlayerView.ControllerVisibilityListener { visibility ->
                    if (visibility != View.VISIBLE)
                        post { if (!retainExternalFocus()) requestFocus() }
                }
            )
        }

@Composable
fun FullscreenPlayer(
    source: Source,
    media: Media,
    core: TvCore,
    onExit: () -> Unit,
    onFailure: (Int) -> Unit,
    onUpNext: (com.stremio.core.types.resource.Video) -> Unit,
    introEndpoint: String = IntroCommunityClient.DEFAULT_ENDPOINT,
    /** Hands gates the live player, to read the cues and tracks its views do not expose. */
    onPlayer: (ExoPlayer) -> Unit = {},
    /**
     * What Media3 opens: the source's own URL, or for a torrent the engine's URL for its file.
     * Core keeps the original stream, so no engine address reaches its storage.
     */
    mediaUrl: String = source.stream.url!!.url,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val activity = context as ComponentActivity
    val sourceHeaders =
        remember(source) {
            source.stream.behaviorHints.proxyHeaders
                ?.request
                .orEmpty()
                .mapNotNull { (key, value) ->
                    if (key != null && value != null) key to value else null
                }
                .toMap()
        }
    var position by remember(source) { mutableLongStateOf(0L) }
    var duration by remember(source) { mutableLongStateOf(C.TIME_UNSET) }
    var ended by remember(source) { mutableStateOf(false) }
    var embeddedDiscovery by
        remember(source) {
            val contentType = Util.inferContentType(Uri.parse(mediaUrl))
            mutableStateOf<IntroDiscovery>(
                if (
                    contentType == C.CONTENT_TYPE_HLS ||
                        contentType == C.CONTENT_TYPE_DASH ||
                        contentType == C.CONTENT_TYPE_SS
                )
                    IntroDiscovery.Absent
                else IntroDiscovery.Unknown
            )
        }
    var chapterPayload by remember(source) { mutableStateOf<ByteArray?>(null) }
    var chapterPayloadReceived by remember(source) { mutableStateOf(false) }
    var chapterOffset by remember(source) { mutableLongStateOf(-1L) }
    val introSession =
        remember(source) {
            IntroDiscoverySession(
                onSelected = { matroska ->
                    if (!matroska) embeddedDiscovery = IntroDiscovery.Absent
                },
                onChapters = { payload ->
                    chapterPayload = payload
                    chapterPayloadReceived = true
                },
                onChapterOffset = { chapterOffset = it },
            )
        }
    val introExtractors = remember(source) { IntroExtractorsFactory(introSession) }
    val stereo = remember(source) { stereoOutputPreferred(context) }
    val renderers = remember(source) { HardwareRenderers(context, stereo) }
    var view by remember(renderers) { mutableStateOf<PlayerView?>(null) }
    DisposableEffect(renderers) {
        val main = Handler(android.os.Looper.getMainLooper())
        // Tone-mapped frames are drawn into the display surface by Kino, so its buffers would
        // otherwise follow the interface resolution. Matching the video keeps a 2160p source at
        // 2160p on a 4K display, as the direct SDR path does.
        renderers.onToneMappedVideoSize = { width, height ->
            main.post {
                (view?.videoSurfaceView as? android.view.SurfaceView)
                    ?.holder
                    ?.setFixedSize(width, height)
            }
        }
        onDispose { renderers.onToneMappedVideoSize = null }
    }
    val player =
        remember(source) { createTvPlayer(context, renderers, sourceHeaders, introExtractors) }
    val session = remember(player) { MediaSession.Builder(context, player).build() }
    val upNext = remember(player) { kinoSettings(context).getBoolean("up_next", true) }
    val skipIntro = remember(player) { kinoSettings(context).getBoolean("skip_intro", true) }
    val automaticIntro =
        remember(player) { kinoSettings(context).getBoolean("automatic_intro", false) }
    val coreState by core.state.collectAsState()
    val communityIdentity =
        introIdentity(media, source.request.path.id, coreState.details.meta, duration)
    var introMarker by remember(player) { mutableStateOf<TvIntroMarker?>(null) }
    var automaticConsumed by remember(player) { mutableStateOf(false) }
    var automaticSuppressed by remember(player) { mutableStateOf(false) }
    fun updateEnding() {
        position = player.currentPosition
        duration = player.duration
        ended = player.playbackState == Player.STATE_ENDED
    }
    LaunchedEffect(chapterPayloadReceived, chapterPayload, duration) {
        if (chapterPayloadReceived && duration > 0) {
            embeddedDiscovery =
                chapterPayload?.let { MatroskaChapters.parse(it, duration) }
                    ?: IntroDiscovery.Unknown
        }
    }
    LaunchedEffect(chapterOffset, duration, skipIntro) {
        if (
            skipIntro &&
                chapterOffset >= 0 &&
                duration > 0 &&
                embeddedDiscovery !is IntroDiscovery.Found
        ) {
            val payload =
                readIndexedChapters(
                    context,
                    Uri.parse(mediaUrl),
                    sourceHeaders,
                    chapterOffset,
                )
            if (embeddedDiscovery !is IntroDiscovery.Found) {
                embeddedDiscovery =
                    payload?.let { MatroskaChapters.parse(it, duration) } ?: IntroDiscovery.Unknown
            }
        }
    }
    LaunchedEffect(embeddedDiscovery, communityIdentity, skipIntro, introEndpoint) {
        introMarker =
            when (val embedded = embeddedDiscovery) {
                is IntroDiscovery.Found -> embedded.marker
                IntroDiscovery.Unknown -> null
                IntroDiscovery.Absent -> {
                    if (!skipIntro) null
                    else communityIdentity?.let { IntroCommunityClient(introEndpoint).lookup(it) }
                }
            }
    }
    val trackSelection =
        remember(player, media.type, media.id) {
            val settings = kinoSettings(context)
            val languages = core.state.value
            TitleTrackSelection(
                player,
                settings,
                media.type,
                media.id,
                player.trackSelectionParameters
                    .buildUpon()
                    .setPreferredAudioLanguage(languages.audioLanguage)
                    .setPreferredTextLanguage(languages.subtitleLanguage)
                    .setTrackTypeDisabled(
                        C.TRACK_TYPE_TEXT,
                        !settings.getBoolean("subtitles", false),
                    )
                    .build(),
            )
        }
    val presented =
        remember(player, trackSelection) { TvPresentationPlayer(player, trackSelection::select) }
    var playerLayout by remember(player) { mutableStateOf<TvPlayerLayout?>(null) }
    val currentExit by rememberUpdatedState(onExit)
    val currentFailure by rememberUpdatedState(onFailure)
    val currentUpNext by rememberUpdatedState(onUpNext)
    val shutdown = remember(player) { TvPlaybackShutdown(player, core) }
    val scope = remember(player) { CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate) }
    var closed by remember(player) { mutableStateOf(false) }
    var closing by remember(player) { mutableStateOf(false) }
    var saveFailed by remember(player) { mutableStateOf(false) }
    var disposed by remember(player) { mutableStateOf(false) }
    var closeTask by remember(player) { mutableStateOf<Job?>(null) }
    var departure by remember(player) { mutableStateOf<(() -> Unit)?>(null) }
    var resumeApplied by remember(player) { mutableStateOf(false) }
    var tracks by remember(player) { mutableStateOf(player.currentTracks) }
    var subtitlePanel by remember(player) { mutableStateOf(false) }
    var subtitleDelayMs by remember(player) { mutableLongStateOf(0L) }
    var subtitleSize by remember(player) { mutableIntStateOf(SubtitleAppearance.size(context)) }
    var subtitlePosition by
        remember(player) { mutableIntStateOf(SubtitleAppearance.position(context)) }
    var sideLoaded by
        remember(player) { mutableStateOf(listOf<MediaItem.SubtitleConfiguration>()) }
    var pendingAddon by remember(player) { mutableStateOf<String?>(null) }
    var addonLoading by remember(player) { mutableStateOf(false) }
    var addonFailed by remember(player) { mutableStateOf(false) }
    val addonMemory = remember(media.type, media.id) { AddonSubtitleMemory(context, media) }
    var addonAutoApplied by remember(player) { mutableStateOf(false) }
    LaunchedEffect(subtitleDelayMs) { renderers.subtitleDelayUs = subtitleDelayMs * 1_000 }
    LaunchedEffect(view, subtitleSize, subtitlePosition) {
        SubtitleAppearance.apply(view?.subtitleView, subtitleSize, subtitlePosition)
    }
    val selectedSubtitle: SubtitleChoice =
        tracks.groups
            .filter { it.type == C.TRACK_TYPE_TEXT && it.isSelected }
            .firstNotNullOfOrNull { group ->
                (0 until group.length)
                    .firstOrNull { group.isTrackSelected(it) }
                    ?.let { index ->
                        val id = sideLoadedTrackId(group.getTrackFormat(index))
                        coreState.subtitles
                            .firstOrNull { addonTrackId(it) == id }
                            ?.let { SubtitleChoice.Addon(it) }
                            ?: SubtitleChoice.Track(group, index)
                    }
            } ?: SubtitleChoice.Off
    fun selectTrack(target: Player, group: Tracks.Group, index: Int) {
        target.trackSelectionParameters =
            target.trackSelectionParameters
                .buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
                .build()
    }
    // Side-loading a file means replacing the media item, which Media3 re-prepares; the position
    // and play state carry across so the change reads as a brief rebuffer, not a restart.
    fun loadAddon(subtitle: AddonSubtitle) {
        // A manual choice supersedes the automatic one, which must not load a second file.
        addonAutoApplied = true
        val loaded =
            tracks.groups.firstNotNullOfOrNull { group ->
                (0 until group.length)
                    .firstOrNull { sideLoadedTrackId(group.getTrackFormat(it)) == addonTrackId(subtitle) }
                    ?.let { group to it }
            }
        if (loaded != null) {
            selectTrack(player, loaded.first, loaded.second)
            return
        }
        if (pendingAddon == addonTrackId(subtitle) || addonLoading) return
        addonLoading = true
        addonFailed = false
        Log.i("KinoPlayer", "Add-on subtitles requested")
        scope.launch {
            val configuration = AddonSubtitleFiles.fetch(context, subtitle)
            addonLoading = false
            val current = player.currentMediaItem
            if (configuration == null || current == null) {
                addonFailed = true
                return@launch
            }
            sideLoaded = sideLoaded + configuration
            pendingAddon = configuration.id
            // replaceMediaItem would keep the existing source, since a progressive source counts
            // an item with the same URI as unchanged and drops the new subtitle configurations.
            // Setting the item again rebuilds the source with them, at the same position.
            player.setMediaItem(
                current.buildUpon().setSubtitleConfigurations(sideLoaded).build(),
                player.currentPosition,
            )
        }
    }
    fun updateTracks(current: Tracks) {
        tracks = current
        val pending = pendingAddon ?: return
        current.groups.forEach { group ->
            (0 until group.length)
                .firstOrNull { sideLoadedTrackId(group.getTrackFormat(it)) == pending }
                ?.let {
                    pendingAddon = null
                    selectTrack(player, group, it)
                    if (subtitlePanel) {
                        subtitlePanel = false
                        playerLayout?.restoreControlsFocus()
                    }
                    return
                }
        }
    }
    // A remembered add-on language, or the Settings language when subtitles are on and the media
    // has no track in it, loads the first matching add-on file once the add-ons have answered.
    LaunchedEffect(coreState.subtitles, tracks, resumeApplied) {
        if (addonAutoApplied || !resumeApplied || coreState.subtitles.isEmpty()) return@LaunchedEffect
        if (selectedSubtitle != SubtitleChoice.Off) return@LaunchedEffect
        val language =
            addonMemory.language()
                ?: coreState.subtitleLanguage.takeIf {
                    kinoSettings(context).getBoolean("subtitles", false) &&
                        addonMemory.allowsAutomatic()
                }
                ?: return@LaunchedEffect
        val match =
            coreState.subtitles.firstOrNull {
                Util.normalizeLanguageCode(it.language) == Util.normalizeLanguageCode(language)
            } ?: return@LaunchedEffect
        addonAutoApplied = true
        loadAddon(match)
    }
    fun close(error: Int? = null, destination: (() -> Unit)? = null) {
        if (closed || closing) return
        if (departure == null)
            departure =
                destination ?: { if (error == null) currentExit() else currentFailure(error) }
        closing = true
        view?.useController = false
        closeTask =
            scope.launch {
                val saved = shutdown.finish(retry = saveFailed)
                closing = false
                saveFailed = !saved
                if (saved) {
                    closed = true
                    if (!disposed) departure?.invoke()
                }
            }
    }
    BackHandler {
        if (closing) return@BackHandler
        if (!saveFailed && view?.isControllerFullyVisible == true) view?.hideController()
        else close()
    }
    LaunchedEffect(player) {
        onPlayer(player)
        player.setMediaItem(
            MediaItem.Builder()
                .setUri(mediaUrl)
                .setMediaMetadata(MediaMetadata.Builder().setTitle(media.title).build())
                .build()
        )
        player.prepare()
        player.playWhenReady = true
        while (!closed && !closing && !saveFailed) {
            delay(2000)
            if (!closed && !closing && !saveFailed)
                core.progress(player.currentPosition, player.duration, !player.isPlaying)
        }
    }
    LaunchedEffect(player, closing, closed, saveFailed) {
        while (!closing && !closed && !saveFailed) {
            updateEnding()
            delay(100)
        }
    }
    LaunchedEffect(
        introMarker,
        position,
        automaticIntro,
        skipIntro,
        automaticConsumed,
        automaticSuppressed,
    ) {
        val marker = introMarker
        if (
            marker != null &&
                skipIntro &&
                automaticIntro &&
                !automaticConsumed &&
                !automaticSuppressed &&
                position in marker.startMs until marker.endMs
        ) {
            automaticConsumed = true
            player.seekTo(marker.endMs)
            playerLayout?.showIntroNotice {
                automaticSuppressed = true
                player.seekTo(marker.startMs)
                updateEnding()
            }
        }
    }
    val frameRate =
        remember(player) {
            FrameRateMatcher(activity, player).takeIf {
                kinoSettings(context).getBoolean("match_frame_rate", false)
            }
        }
    DisposableEffect(player) {
        val listener =
            object : Player.Listener {
                override fun onPositionDiscontinuity(
                    oldPosition: Player.PositionInfo,
                    newPosition: Player.PositionInfo,
                    reason: Int,
                ) {
                    updateEnding()
                    if (
                        !closing &&
                            !closed &&
                            !saveFailed &&
                            reason == Player.DISCONTINUITY_REASON_SEEK
                    )
                        core.seek(newPosition.positionMs, player.duration)
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    updateEnding()
                    if (playbackState == Player.STATE_READY && !resumeApplied) {
                        if (!player.currentTracks.isTypeSelected(C.TRACK_TYPE_VIDEO)) {
                            close(renderers.unsupportedReason)
                            return
                        }
                        resumeApplied = true
                        core.videoParams(source.stream)
                        val resume = core.resumePosition(source.request.path.id)
                        if (resume > 0 && resume < player.duration) player.seekTo(resume)
                        Log.i("KinoPlayer", "Playback ready")
                    }
                    if (playbackState == Player.STATE_ENDED) {
                        if (!resumeApplied) close(renderers.unsupportedReason)
                        else if (!upNext || media.type != "series" || coreState.nextVideo == null)
                            close()
                    }
                }

                override fun onTimelineChanged(timeline: Timeline, reason: Int) = updateEnding()

                override fun onTracksChanged(tracks: Tracks) {
                    logAudioTracks(tracks)
                    updateTracks(tracks)
                    frameRate?.onTracks(tracks)
                    if (
                        tracks.groups.any { it.type == C.TRACK_TYPE_VIDEO } &&
                            !tracks.isTypeSelected(C.TRACK_TYPE_VIDEO)
                    )
                        close(renderers.unsupportedReason)
                    // A source with audio that nothing can play is a failure to
                    // report, not a silent video-only session.
                    else if (
                        tracks.groups.any { it.type == C.TRACK_TYPE_AUDIO } &&
                            !tracks.isTypeSelected(C.TRACK_TYPE_AUDIO)
                    )
                        close(R.string.audio_unsupported)
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (isPlaying && (closing || closed || saveFailed)) {
                        player.pause()
                        return
                    }
                    if (isPlaying)
                        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }

                override fun onPlayerError(error: PlaybackException) {
                    Log.e("KinoPlayer", "Playback failed code=${error.errorCode}")
                    close(playbackFailureReason(error, renderers.unsupportedReason))
                }
            }
        val analytics =
            object : AnalyticsListener {
                override fun onVideoDecoderInitialized(
                    eventTime: AnalyticsListener.EventTime,
                    decoderName: String,
                    initializedTimestampMs: Long,
                    initializationDurationMs: Long,
                ) {
                    Log.i("KinoPlayer", "Hardware decoder=$decoderName")
                }

                override fun onAudioDecoderInitialized(
                    eventTime: AnalyticsListener.EventTime,
                    decoderName: String,
                    initializedTimestampMs: Long,
                    initializationDurationMs: Long,
                ) {
                    Log.i("KinoPlayer", "Audio decoder=$decoderName")
                }

                override fun onAudioSinkError(
                    eventTime: AnalyticsListener.EventTime,
                    audioSinkError: Exception,
                ) {
                    Log.w("KinoPlayer", "Audio sink error=${audioSinkError.javaClass.simpleName}")
                }

                override fun onAudioCodecError(
                    eventTime: AnalyticsListener.EventTime,
                    audioCodecError: Exception,
                ) {
                    Log.w("KinoPlayer", "Audio codec error=${audioCodecError.javaClass.simpleName}")
                }

                override fun onAudioUnderrun(
                    eventTime: AnalyticsListener.EventTime,
                    bufferSize: Int,
                    bufferSizeMs: Long,
                    elapsedSinceLastFeedMs: Long,
                ) {
                    Log.w("KinoPlayer", "Audio underrun buffer=${bufferSizeMs}ms")
                }
            }
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) close()
        }
        player.addListener(listener)
        player.addAnalyticsListener(analytics)
        lifecycle.addObserver(observer)
        onDispose {
            disposed = true
            player.pause()
            frameRate?.release()
            lifecycle.removeObserver(observer)
            view?.player = null
            introSession.release()
            AddonSubtitleFiles.clear(context)
            session.release()
            trackSelection.close()
            player.removeListener(listener)
            player.removeAnalyticsListener(analytics)
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (shutdown.complete) {
                player.release()
                scope.cancel()
            } else {
                core.pendingPlaybackSave.retain(shutdown, closeTask) {
                    player.release()
                    scope.cancel()
                }
            }
        }
    }
    Box(Modifier.fillMaxSize()) {
        val next =
            coreState.nextVideo.takeIf {
                upNext &&
                    media.type == "series" &&
                    !closing &&
                    !closed &&
                    !saveFailed &&
                    (ended ||
                        (duration > 0 && position >= duration - minOf(120_000L, duration / 10)))
            }
        val nextTitle =
            next?.let {
                it.title?.takeIf(String::isNotBlank)
                    ?: it.seriesInfo?.let { series ->
                        stringResource(R.string.season_episode, series.season, series.episode)
                    }
                    ?: stringResource(R.string.episode)
            }
        key(player) {
            AndroidView(
                factory = {
                    TvPlayerLayout(it, presented).also { created ->
                        playerLayout = created
                        view = created.playerView
                        created.onSubtitles {
                            addonFailed = false
                            subtitlePanel = true
                        }
                    }
                },
                update = { layout ->
                    val marker = introMarker.takeIf { skipIntro }
                    layout.showIntro(
                        marker,
                        duration,
                        marker != null && position in marker.startMs until marker.endMs,
                    ) {
                        automaticConsumed = true
                        player.seekTo(marker?.endMs ?: return@showIntro)
                    }
                    layout.showUpNext(nextTitle) {
                        if (next != null) close(destination = { currentUpNext(next) })
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
        if (subtitlePanel && !closing) {
            val closePanel: () -> Unit = {
                subtitlePanel = false
                playerLayout?.restoreControlsFocus()
            }
            SubtitlePanel(
                tracks = tracks,
                addonSubtitles = coreState.subtitles,
                selected = selectedSubtitle,
                delayMs = subtitleDelayMs,
                size = subtitleSize,
                position = subtitlePosition,
                loading = addonLoading || pendingAddon != null,
                failed = addonFailed,
                onChoose = { choice ->
                    when (choice) {
                        SubtitleChoice.Off -> {
                            addonMemory.forget()
                            presented.trackSelectionParameters =
                                presented.trackSelectionParameters
                                    .buildUpon()
                                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                                    .build()
                            closePanel()
                        }
                        is SubtitleChoice.Track -> {
                            addonMemory.forget()
                            // Through the presentation player, so the title remembers it.
                            selectTrack(presented, choice.group, choice.index)
                            closePanel()
                        }
                        is SubtitleChoice.Addon -> {
                            addonMemory.remember(choice.subtitle.language)
                            loadAddon(choice.subtitle)
                            if (pendingAddon == null && !addonLoading) closePanel()
                        }
                    }
                },
                onDelay = { subtitleDelayMs = it.coerceIn(-30_000L, 30_000L) },
                onSize = {
                    subtitleSize = it
                    SubtitleAppearance.save(context, subtitleSize, subtitlePosition)
                },
                onPosition = {
                    subtitlePosition = it
                    SubtitleAppearance.save(context, subtitleSize, subtitlePosition)
                },
                onDismiss = closePanel,
            )
        }
        if (closing) {
            Box(
                Modifier.fillMaxSize().background(Background.copy(alpha = .8f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(R.string.saving_progress), fontSize = 18.sp)
            }
        }
        if (saveFailed && !closing) {
            Dialog(onDismissRequest = {}) {
                val retryFocus = remember { FocusRequester() }
                Column(
                    Modifier.width(420.dp)
                        .background(Background, RoundedCornerShape(12.dp))
                        .padding(28.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    Text(stringResource(R.string.progress_save_failed), fontSize = 18.sp)
                    Button({ close() }, Modifier.focusRequester(retryFocus)) {
                        Text(stringResource(R.string.retry))
                    }
                }
                LaunchedEffect(Unit) { retryFocus.requestFocus() }
            }
        }
    }
}

/**
 * Sanitized audio diagnostics: format, layout, and the renderer's support verdict for each audio
 * track. No titles, URLs, or identifiers. A source that advances video with no supported audio must
 * be visible in the log rather than passing as a silent success.
 */
private fun logAudioTracks(tracks: Tracks) {
    val groups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
    if (groups.isEmpty()) {
        Log.w("KinoPlayer", "Audio tracks=0")
        return
    }
    for (group in groups) {
        for (index in 0 until group.length) {
            val format = group.getTrackFormat(index)
            Log.i(
                "KinoPlayer",
                "Audio track mime=${format.sampleMimeType} channels=${format.channelCount} " +
                    "rate=${format.sampleRate} codecs=${format.codecs} " +
                    "support=${group.getTrackSupport(index)} selected=${group.isTrackSelected(index)}",
            )
        }
    }
    if (!tracks.isTypeSelected(C.TRACK_TYPE_AUDIO)) Log.w("KinoPlayer", "Audio selected=none")
}

private fun introIdentity(
    media: Media,
    videoId: String,
    meta: com.stremio.core.types.resource.MetaItem?,
    durationMs: Long,
): IntroIdentity? {
    if (durationMs <= 0) return null
    val imdb = media.id.takeIf { it.matches(Regex("tt[0-9]{7,8}")) }
    val tmdb = Regex("tmdb:([0-9]+)").matchEntire(media.id)?.groupValues?.get(1)?.toLongOrNull()
    if ((imdb == null) == (tmdb == null)) return null
    val series =
        if (media.type == "series") {
            meta?.videos?.firstOrNull { it.id == videoId }?.seriesInfo ?: return null
        } else null
    if (
        series != null &&
            (series.season !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong() ||
                series.episode !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong())
    )
        return null
    return IntroIdentity(
        durationMs = durationMs,
        imdbId = imdb,
        tmdbId = tmdb,
        season = series?.season?.toInt(),
        episode = series?.episode?.toInt(),
    )
}

/** The device-local Kino audio output setting: "stereo" or the default "auto". */
fun stereoOutputPreferred(context: Context): Boolean =
    kinoSettings(context).getString("audio_output", "auto") == "stereo"

@Composable
internal fun PendingPlaybackSaveDialog(core: TvCore) {
    val status by core.pendingPlaybackSave.status.collectAsState()
    if (status == TvPendingPlaybackSave.Status.Idle) return
    Dialog(onDismissRequest = {}) {
        val retryFocus = remember { FocusRequester() }
        Column(
            Modifier.width(420.dp).background(Background, RoundedCornerShape(12.dp)).padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(
                stringResource(
                    if (status == TvPendingPlaybackSave.Status.Saving) R.string.saving_progress
                    else R.string.progress_save_failed
                ),
                fontSize = 18.sp,
            )
            if (status == TvPendingPlaybackSave.Status.Failed) {
                Button({ core.pendingPlaybackSave.retry() }, Modifier.focusRequester(retryFocus)) {
                    Text(stringResource(R.string.retry))
                }
                LaunchedEffect(Unit) { retryFocus.requestFocus() }
            }
        }
    }
}
