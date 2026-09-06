@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.os.Handler
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.*
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener
import androidx.media3.session.MediaSession
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay

/** Reject unvalidated HDR before configuring a decoder or exposing a video surface. */
class HardwareRenderers(context: Context) : DefaultRenderersFactory(context) {
    var unsupportedReason: Int = R.string.hardware_required
        private set

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
    return ExoPlayer.Builder(context, renderers)
        .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(http))
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

@Composable
fun FullscreenPlayer(
    source: Source,
    title: String,
    core: TvCore,
    onExit: () -> Unit,
    onFailure: (Int) -> Unit,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val activity = context as ComponentActivity
    val renderers = remember(source) { HardwareRenderers(context) }
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
    var view by remember { mutableStateOf<PlayerView?>(null) }
    val currentExit by rememberUpdatedState(onExit)
    val currentFailure by rememberUpdatedState(onFailure)
    var closed by remember { mutableStateOf(false) }
    var resumeApplied by remember { mutableStateOf(false) }
    fun save() {
        core.progress(player.currentPosition, player.duration, true)
    }
    fun close(error: Int? = null) {
        if (closed) return
        closed = true
        player.pause()
        save()
        player.stop()
        core.stopPlayer()
        if (error == null) currentExit() else currentFailure(error)
    }
    BackHandler { if (view?.isControllerFullyVisible == true) view?.hideController() else close() }
    LaunchedEffect(player) {
        player.setMediaItem(
            MediaItem.Builder()
                .setUri(source.stream.url!!.url)
                .setMediaMetadata(MediaMetadata.Builder().setTitle(title).build())
                .build()
        )
        player.prepare()
        player.playWhenReady = true
        while (!closed) {
            delay(2000)
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
                    if (reason == Player.DISCONTINUITY_REASON_SEEK)
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
                    if (
                        tracks.groups.any { it.type == C.TRACK_TYPE_VIDEO } &&
                            !tracks.isTypeSelected(C.TRACK_TYPE_VIDEO)
                    )
                        close(renderers.unsupportedReason)
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
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
            }
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) close()
        }
        player.addListener(listener)
        player.addAnalyticsListener(analytics)
        lifecycle.addObserver(observer)
        onDispose {
            if (!closed) {
                player.pause()
                save()
                core.stopPlayer()
            }
            lifecycle.removeObserver(observer)
            session.release()
            player.removeListener(listener)
            player.release()
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
    AndroidView(
        factory = {
            PlayerView(it).apply {
                this.player = player
                setShowSubtitleButton(true)
                setShowNextButton(false)
                setShowPreviousButton(false)
                controllerShowTimeoutMs = 3500
                keepScreenOn = false
                requestFocus()
                view = this
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}
