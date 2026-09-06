@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Intent
import android.net.Uri
import android.view.SurfaceView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.datasource.FileDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

/**
 * Surround formats the Shield has no MediaCodec for must still play: through
 * passthrough when the sink accepts them, otherwise decoded to PCM by the FFmpeg
 * renderer. Either way the track is selected, a decoder starts, and audio
 * position advances, which is what a silent video-only session never does.
 */
class ShieldAudioTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test
    fun surroundTracksAreSelectedDecodedAndAdvance() {
        for (fixture in listOf("hevc-sdr-ac3.mkv", "h264-sdr-eac3.mkv", "h264-dts.mkv")) {
            val result = play(fixture)
            assertEquals(
                "$fixture must expose a fully supported audio track: $result",
                C.FORMAT_HANDLED,
                result.support,
            )
            assertTrue("$fixture must select its audio track: $result", result.selected)
            assertNotNull("$fixture must start an audio decoder: $result", result.decoder)
            assertTrue("$fixture must advance audio output: $result", result.advancing)
            assertNull("$fixture must not raise a sink error: $result", result.sinkError)
        }
    }

    /** The Stereo setting refuses passthrough and folds surround to two channels in Kino. */
    @Test
    fun stereoOutputDecodesAndDownmixesSurround() {
        for (fixture in listOf("h264-sdr-eac3.mkv", "h264-dts.mkv")) {
            val result = play(fixture, stereo = true)
            assertTrue("$fixture must select audio under Stereo: $result", result.selected)
            assertNotNull("$fixture must decode under Stereo: $result", result.decoder)
            assertTrue("$fixture must advance under Stereo: $result", result.advancing)
            assertNull(result.sinkError)
        }
    }

    @Test
    fun aSourceWithNoAudioTracksIsReportedAsSuch() {
        val result = play("h264-sdr-aac.mp4")
        assertTrue(result.selected)
        assertEquals(C.FORMAT_HANDLED, result.support)
    }

    private data class Outcome(
        var support: Int = C.FORMAT_UNSUPPORTED_TYPE,
        var selected: Boolean = false,
        var decoder: String? = null,
        var advancing: Boolean = false,
        var sinkError: String? = null,
        var error: Int? = null,
    )

    private fun play(fixture: String, stereo: Boolean = false): Outcome {
        val file = File(context.cacheDir, "audio-$fixture")
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
        var player: ExoPlayer? = null
        try {
            instrumentation.runOnMainSync {
                val surface = SurfaceView(activity)
                activity.setContentView(surface)
                val created = createTvPlayer(activity, HardwareRenderers(activity, stereo))
                player = created
                created.setVideoSurfaceView(surface)
                created.addListener(
                    object : Player.Listener {
                        override fun onTracksChanged(tracks: Tracks) {
                            for (group in tracks.groups) {
                                if (group.type != C.TRACK_TYPE_AUDIO) continue
                                for (index in 0 until group.length) {
                                    result.support = maxOf(result.support, group.getTrackSupport(index))
                                    if (group.isTrackSelected(index)) result.selected = true
                                }
                            }
                        }

                        override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                            result.error = error.errorCode
                            done.countDown()
                        }
                    }
                )
                created.addAnalyticsListener(
                    object : AnalyticsListener {
                        override fun onAudioDecoderInitialized(
                            eventTime: AnalyticsListener.EventTime,
                            decoderName: String,
                            initializedTimestampMs: Long,
                            initializationDurationMs: Long,
                        ) {
                            result.decoder = decoderName
                        }

                        override fun onAudioPositionAdvancing(
                            eventTime: AnalyticsListener.EventTime,
                            playoutStartSystemTimeMs: Long,
                        ) {
                            result.advancing = true
                            done.countDown()
                        }

                        override fun onAudioSinkError(
                            eventTime: AnalyticsListener.EventTime,
                            audioSinkError: Exception,
                        ) {
                            result.sinkError = audioSinkError.javaClass.simpleName
                            done.countDown()
                        }
                    }
                )
                created.setMediaSource(
                    ProgressiveMediaSource.Factory(FileDataSource.Factory())
                        .createMediaSource(MediaItem.fromUri(Uri.fromFile(file)))
                )
                created.prepare()
                created.play()
            }
            done.await(20, TimeUnit.SECONDS)
            return result
        } finally {
            instrumentation.runOnMainSync { player?.release() }
            activity.finish()
            file.delete()
        }
    }
}
