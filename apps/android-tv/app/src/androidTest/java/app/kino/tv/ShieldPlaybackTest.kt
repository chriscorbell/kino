@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.view.SurfaceView
import android.view.WindowManager
import androidx.media3.common.*
import androidx.media3.datasource.FileDataSource
import androidx.media3.exoplayer.*
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.video.*
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

/** Real Shield decoders and surfaces, using generated media with no copyrighted content. */
class ShieldPlaybackTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test
    fun nativeCoreLoadsCatalogAndDetails() {
        val core = (context.applicationContext as KinoApplication).core
        instrumentation.runOnMainSync { core.initialize() }
        val deadline = System.currentTimeMillis() + 30000
        while (
            core.state.value.shelves.none { it.items.isNotEmpty() } &&
                System.currentTimeMillis() < deadline
        ) Thread.sleep(100)
        val media = core.state.value.shelves.flatMap { it.items }.firstOrNull()
        assertNotNull("Core must request catalog ranges and return actual media", media)
        instrumentation.runOnMainSync { core.open(media!!) }
        val detailDeadline = System.currentTimeMillis() + 20000
        while (
            core.state.value.details.meta == null && System.currentTimeMillis() < detailDeadline
        ) Thread.sleep(100)
        assertEquals(media!!.id, core.state.value.details.meta?.id)
        assertTrue(core.state.value.details.sources.all { secureUrl(it.request.base) })
        val stream =
            com.stremio.core.types.resource.Stream(
                source =
                    com.stremio.core.types.resource.Stream.Source.Url(
                        com.stremio.core.types.resource.Stream.Url(
                            "https://example.invalid/kino-fixture.mp4"
                        )
                    ),
                behaviorHints =
                    com.stremio.core.types.resource.StreamBehaviorHints(notWebReady = false),
                deepLinks =
                    com.stremio.core.types.resource.StreamDeepLinks(
                        player = "",
                        externalPlayer =
                            com.stremio.core.types.resource.StreamDeepLinks.ExternalPlayerLink(),
                    ),
            )
        val source =
            Source(
                "Fixture",
                stream,
                com.stremio.core.types.addon.ResourceRequest(
                    "https://example.invalid/manifest.json",
                    com.stremio.core.types.addon.ResourcePath("stream", media.type, media.id),
                ),
            )
        instrumentation.runOnMainSync { core.startPlayer(source) }
        Thread.sleep(300)
        instrumentation.runOnMainSync { core.progress(12000, 30000, false) }
        Thread.sleep(300)
        instrumentation.runOnMainSync {
            core.stopPlayer()
            core.startPlayer(source)
        }
        Thread.sleep(300)
        instrumentation.runOnMainSync {
            assertEquals(
                "Replacement sources must resume saved progress",
                12000,
                core.resumePosition(media.id),
            )
            assertEquals(
                "Continue Watching must use a fraction, not Core's percentage",
                0.4,
                core.state.value.continueWatching.first { it.id == media.id }.progress!!,
                0.0001,
            )
            core.seek(0, 30000)
            core.progress(0, 30000, true)
        }
        Thread.sleep(300)
        instrumentation.runOnMainSync {
            assertEquals(
                "Seeking to the beginning must stay at the beginning",
                0,
                core.resumePosition(media.id),
            )
            core.stopPlayer()
        }
        instrumentation.runOnMainSync { core.beginLink() }
        val linkDeadline = System.currentTimeMillis() + 30000
        while (
            core.state.value.link == null &&
                !core.state.value.linkFailed &&
                System.currentTimeMillis() < linkDeadline
        ) Thread.sleep(100)
        assertTrue(
            "Stremio must return a secure device sign-in link",
            secureUrl(core.state.value.link),
        )
        android.util.Log.i(
            "KinoProbe",
            "Link QR format=${if (core.state.value.qrCode?.startsWith("data:") == true) "data" else "remote"}",
        )
        instrumentation.runOnMainSync { core.cancelLink() }
    }

    @Test
    fun hardwareSdrAndUnsupportedInputs() {
        for (fixture in listOf("h264-sdr-aac.mp4", "hevc-sdr-ac3.mkv")) {
            val result = play(fixture)
            assertTrue("$fixture must render hardware-decoded frames: $result", result.frame)
            assertTrue(
                result.decoder.startsWith("OMX.Nvidia.") || result.decoder.startsWith("c2.nvidia.")
            )
            assertNull(result.error)
        }
        for (fixture in
            listOf(
                "av1-aac.mkv",
                "ffv1-software-only.mkv",
                "hevc-hdr10-eac3.mkv",
                "hevc-hlg-flac.mkv",
            )) {
            val result = play(fixture)
            assertFalse(
                "$fixture must not render unvalidated or software-decoded video: $result",
                result.frame,
            )
            assertTrue(
                "$fixture must report unsupported",
                result.error != null || result.unsupported,
            )
        }
    }

    @Test
    fun measureOpenGlToneMapping() {
        for (fixture in listOf("hevc-hdr10-eac3.mkv", "hevc-hlg-flac.mkv")) {
            val result = play(fixture, toneMap = true)
            android.util.Log.i(
                "KinoProbe",
                "OpenGL $fixture frame=${result.frame} decoder=${result.decoder} error=${result.error}",
            )
            // This records the backend capability. Production HDR remains disabled until color
            // validation.
            assertTrue(
                "Tone mapping must render or report a controlled failure",
                result.frame || result.error != null || result.unsupported,
            )
        }
    }

    private data class Outcome(
        var frame: Boolean = false,
        var decoder: String = "",
        var error: Int? = null,
        var unsupported: Boolean = false,
    )

    private fun play(fixture: String, toneMap: Boolean = false): Outcome {
        val file = File(context.cacheDir, "probe-$fixture")
        instrumentation.context.assets.open(fixture).use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val done = CountDownLatch(1)
        val result = Outcome()
        lateinit var player: ExoPlayer
        var createdPlayer: ExoPlayer? = null
        var graph: PlaybackVideoGraphWrapper? = null
        try {
            instrumentation.runOnMainSync {
                val surface = SurfaceView(activity)
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                activity.setContentView(surface)
                val factory =
                    if (!toneMap) HardwareRenderers(activity)
                    else
                        object : DefaultRenderersFactory(activity) {
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
                                val timing =
                                    object : VideoFrameReleaseControl.FrameTimingEvaluator {
                                        override fun shouldForceReleaseFrame(
                                            earlyUs: Long,
                                            elapsedSinceLastReleaseUs: Long,
                                        ) = earlyUs < -30000 && elapsedSinceLastReleaseUs > 100000

                                        override fun shouldDropFrame(
                                            earlyUs: Long,
                                            elapsedRealtimeUs: Long,
                                            isLastFrame: Boolean,
                                        ) = earlyUs < -30000 && !isLastFrame

                                        override fun shouldIgnoreFrame(
                                            earlyUs: Long,
                                            positionUs: Long,
                                            elapsedRealtimeUs: Long,
                                            isLastFrame: Boolean,
                                            treatDroppedBuffersAsSkipped: Boolean,
                                        ) = false
                                    }
                                graph =
                                    PlaybackVideoGraphWrapper.Builder(
                                            context,
                                            VideoFrameReleaseControl(context, timing, 5000),
                                        )
                                        .build()
                                        .apply {
                                            setTotalVideoInputCount(1)
                                            setRequestOpenGlToneMapping(true)
                                        }
                                val hardware = MediaCodecSelector { mime, secure, tunneling ->
                                    MediaCodecSelector.DEFAULT.getDecoderInfos(
                                            mime,
                                            secure,
                                            tunneling,
                                        )
                                        .filter { it.hardwareAccelerated && !it.softwareOnly }
                                }
                                out.add(
                                    MediaCodecVideoRenderer.Builder(context)
                                        .setMediaCodecSelector(hardware)
                                        .setEventHandler(eventHandler)
                                        .setEventListener(eventListener)
                                        .setVideoSink(graph!!.getSink(0))
                                        .build()
                                )
                            }
                        }
                player =
                    if (factory is HardwareRenderers) createTvPlayer(activity, factory)
                    else ExoPlayer.Builder(activity, factory).build()
                createdPlayer = player
                player.setVideoSurfaceView(surface)
                player.addListener(
                    object : Player.Listener {
                        override fun onPlaybackStateChanged(state: Int) {
                            if (
                                state == Player.STATE_READY &&
                                    !player.currentTracks.isTypeSelected(C.TRACK_TYPE_VIDEO) ||
                                    state == Player.STATE_ENDED && !result.frame
                            ) {
                                result.unsupported = true
                                done.countDown()
                            }
                        }

                        override fun onRenderedFirstFrame() {
                            result.frame = true
                            done.countDown()
                        }

                        override fun onPlayerError(error: PlaybackException) {
                            result.error = error.errorCode
                            done.countDown()
                        }

                        override fun onTracksChanged(tracks: Tracks) {
                            if (
                                tracks.groups.any { it.type == C.TRACK_TYPE_VIDEO } &&
                                    !tracks.isTypeSelected(C.TRACK_TYPE_VIDEO)
                            ) {
                                result.unsupported = true
                                done.countDown()
                            }
                        }
                    }
                )
                player.addAnalyticsListener(
                    object : AnalyticsListener {
                        override fun onVideoDecoderInitialized(
                            eventTime: AnalyticsListener.EventTime,
                            decoderName: String,
                            initializedTimestampMs: Long,
                            initializationDurationMs: Long,
                        ) {
                            result.decoder = decoderName
                        }
                    }
                )
                val media =
                    ProgressiveMediaSource.Factory(FileDataSource.Factory())
                        .createMediaSource(MediaItem.fromUri(Uri.fromFile(file)))
                player.setMediaSource(media)
                player.prepare()
                player.play()
            }
            val completed = done.await(25, TimeUnit.SECONDS)
            var status = ""
            instrumentation.runOnMainSync {
                status =
                    "state=${player.playbackState} position=${player.currentPosition} suppression=${player.playbackSuppressionReason} result=$result"
            }
            assertTrue("$fixture timed out: $status", completed)
            if (result.frame) {
                instrumentation.runOnMainSync { player.seekTo(3000) }
                Thread.sleep(500)
                instrumentation.runOnMainSync {
                    assertTrue("Seek must move the playhead", player.currentPosition >= 3000)
                }
            }
            return result
        } finally {
            instrumentation.runOnMainSync {
                createdPlayer?.release()
                graph?.release()
                activity.finish()
            }
            file.delete()
        }
    }
}
