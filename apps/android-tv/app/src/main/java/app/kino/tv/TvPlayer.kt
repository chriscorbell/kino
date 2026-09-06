@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.util.Log
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
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioCapabilities
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener
import androidx.media3.session.MediaSession
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Button
import androidx.tv.material3.Text
import kotlinx.coroutines.*

/**
 * Reject unvalidated HDR before configuring a decoder or exposing a video surface. With [stereo]
 * set, the sink accepts PCM only, so every track is decoded and folded to two channels by
 * [StereoDownmixProcessor] inside Kino rather than passed through or left to the platform mixer.
 */
class HardwareRenderers(context: Context, private val stereo: Boolean = false) :
    DefaultRenderersFactory(context) {
    var unsupportedReason: Int = R.string.hardware_required
        private set

    override fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioTrackPlaybackParams: Boolean,
    ): AudioSink {
        val builder = DefaultAudioSink.Builder(context).setEnableFloatOutput(enableFloatOutput)
        if (stereo) {
            builder
                .setAudioCapabilities(AudioCapabilities.DEFAULT_AUDIO_CAPABILITIES)
                .setAudioProcessors(arrayOf(StereoDownmixProcessor()))
        }
        return builder.build()
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
                override fun getDecoderInfos(
                    selector: MediaCodecSelector,
                    format: Format,
                    requiresSecureDecoder: Boolean,
                ): List<MediaCodecInfo> {
                    if (
                        ColorInfo.isTransferHdr(format.colorInfo) ||
                            format.sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION
                    ) {
                        unsupportedReason = R.string.hdr_unsupported
                        return emptyList()
                    }
                    return super.getDecoderInfos(selector, format, requiresSecureDecoder).filter {
                        it.hardwareAccelerated && !it.softwareOnly
                    }
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
                    if (
                        ColorInfo.isTransferHdr(format.colorInfo) ||
                            format.sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION
                    ) {
                        unsupportedReason = R.string.hdr_unsupported
                        throw IllegalStateException("HDR conversion is not validated")
                    }
                    return super.getMediaCodecConfiguration(
                        codecInfo,
                        format,
                        crypto,
                        codecOperatingRate,
                    )
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
                    if (transfer == C.COLOR_TRANSFER_ST2084 || transfer == C.COLOR_TRANSFER_HLG) {
                        unsupportedReason = R.string.hdr_unsupported
                        throw IllegalStateException("HDR conversion is not validated")
                    }
                    super.onOutputFormatChanged(format, mediaFormat)
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

fun createTvPlayer(
    context: Context,
    renderers: HardwareRenderers,
    headers: Map<String, String> = emptyMap(),
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
            DefaultMediaSourceFactory(context)
                .setDataSourceFactory(DefaultDataSource.Factory(context, http))
        )
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
 * The playback surface and its controls.
 *
 * The remote reveals hidden controls through [PlayerView.dispatchKeyEvent], which the view only
 * receives while it holds Android focus. Compose owns focus inside an `AndroidView`, and a
 * `requestFocus()` call made while the view is still detached does nothing, so focus is claimed
 * once the view reaches a window instead.
 */
fun tvPlayerView(context: Context, player: Player): PlayerView =
    PlayerView(context).apply {
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
                if (visibility != View.VISIBLE) post { requestFocus() }
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
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val activity = context as ComponentActivity
    val stereo = remember { stereoOutputPreferred(context) }
    val renderers = remember(source) { HardwareRenderers(context, stereo) }
    val player =
        remember(source) {
            createTvPlayer(
                context,
                renderers,
                source.stream.behaviorHints.proxyHeaders
                    ?.request
                    .orEmpty()
                    .mapNotNull { (key, value) ->
                        if (key != null && value != null) key to value else null
                    }
                    .toMap(),
            )
        }
    val session = remember(player) { MediaSession.Builder(context, player).build() }
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
    var view by remember { mutableStateOf<PlayerView?>(null) }
    val currentExit by rememberUpdatedState(onExit)
    val currentFailure by rememberUpdatedState(onFailure)
    val shutdown = remember(player) { TvPlaybackShutdown(player, core) }
    val scope = remember(player) { CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate) }
    var closed by remember(player) { mutableStateOf(false) }
    var closing by remember(player) { mutableStateOf(false) }
    var saveFailed by remember(player) { mutableStateOf(false) }
    var disposed by remember(player) { mutableStateOf(false) }
    var closeTask by remember(player) { mutableStateOf<Job?>(null) }
    var departure by remember(player) { mutableStateOf<(() -> Unit)?>(null) }
    var resumeApplied by remember(player) { mutableStateOf(false) }
    fun close(error: Int? = null) {
        if (closed || closing) return
        if (departure == null)
            departure = { if (error == null) currentExit() else currentFailure(error) }
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
        player.setMediaItem(
            MediaItem.Builder()
                .setUri(source.stream.url!!.url)
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
    DisposableEffect(player) {
        val listener =
            object : Player.Listener {
                override fun onPositionDiscontinuity(
                    oldPosition: Player.PositionInfo,
                    newPosition: Player.PositionInfo,
                    reason: Int,
                ) {
                    if (
                        !closing &&
                            !closed &&
                            !saveFailed &&
                            reason == Player.DISCONTINUITY_REASON_SEEK
                    )
                        core.seek(newPosition.positionMs, player.duration)
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_READY && !resumeApplied) {
                        if (!player.currentTracks.isTypeSelected(C.TRACK_TYPE_VIDEO)) {
                            close(renderers.unsupportedReason)
                            return
                        }
                        resumeApplied = true
                        val resume = core.resumePosition(source.request.path.id)
                        if (resume > 0 && resume < player.duration) player.seekTo(resume)
                        Log.i("KinoPlayer", "Playback ready")
                    }
                    if (playbackState == Player.STATE_ENDED)
                        close(if (resumeApplied) null else renderers.unsupportedReason)
                }

                override fun onTracksChanged(tracks: Tracks) {
                    logAudioTracks(tracks)
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
                    close(
                        if (error.errorCode in 4000..4999) renderers.unsupportedReason
                        else R.string.playback_error
                    )
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
            lifecycle.removeObserver(observer)
            view?.player = null
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
        AndroidView(
            factory = { tvPlayerView(it, presented).also { created -> view = created } },
            modifier = Modifier.fillMaxSize(),
        )
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
