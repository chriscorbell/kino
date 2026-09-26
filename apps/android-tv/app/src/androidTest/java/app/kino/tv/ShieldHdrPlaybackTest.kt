@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Intent
import android.graphics.PixelFormat
import android.hardware.HardwareBuffer
import android.media.ImageReader
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.SurfaceView
import android.view.WindowManager
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Plays the HDR10 probe through the production player and renderer and reads back what reaches the
 * display surface.
 *
 * [ShieldToneMapTest] proves the shader in isolation. This proves the playback path around it: the
 * renderer must steer a PQ source into Kino's tone mapping rather than the display, keep the decoder
 * in hardware, and present frames whose pixels match the host reference in
 * `scripts/test-support/tone-map-reference.mjs`. An `ImageReader` stands in for the display so the
 * presented frames can be read; nothing else in the path is replaced.
 */
class ShieldHdrPlaybackTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test
    fun hdrTenPlaysThroughKinoToneMappingWithReferencePixels() {
        val result = playIntoReader("hdr-probe.mkv", expectFrames = true)
        assertReferencePixels(result)
    }

    /** The same code words under HLG must come out as the host's HLG reference predicts. */
    @Test
    fun hlgPlaysThroughKinoToneMappingWithReferencePixels() {
        val result = playIntoReader("hlg-probe.mkv", expectFrames = true)
        assertReferencePixels(result, "hlg-probe-expected.json")
    }

    /**
     * Profile 8.1's base layer is plain HDR10, so the HEVC decoder must produce exactly the HDR10
     * probe's pixels from it; the enhancement metadata changes nothing Kino renders.
     */
    @Test
    fun dolbyVisionProfileEightPlaysItsBaseLayerThroughToneMapping() {
        val result = playIntoReader("dv-p8-probe.mkv", expectFrames = true)
        assertTrue(
            "Profile 8 must decode on an HEVC decoder, not the Dolby Vision one: ${result.decoder}",
            !result.decoder.contains("dovi", ignoreCase = true) &&
                !result.decoder.contains("dolby", ignoreCase = true),
        )
        assertReferencePixels(result)
    }

    /** Profile 8.4's base layer is plain HLG and must come out as the HLG probe does. */
    @Test
    fun dolbyVisionProfileEightFourPlaysItsHlgBaseLayerThroughToneMapping() {
        val result = playIntoReader("dv-p84-probe.mkv", expectFrames = true)
        assertTrue(
            "Profile 8 must decode on an HEVC decoder, not the Dolby Vision one: ${result.decoder}",
            !result.decoder.contains("dovi", ignoreCase = true) &&
                !result.decoder.contains("dolby", ignoreCase = true),
        )
        assertReferencePixels(result, "hlg-probe-expected.json")
    }

    /** Profile 5 has no compatible base layer; decoding it as HEVC would show the wrong colours. */
    @Test
    fun dolbyVisionProfileFiveIsRefused() {
        val result = playIntoReader("dv-p5-probe.mkv", expectFrames = false)
        assertTrue(
            "Profile 5 must be refused, not played: $result",
            result.failure != null || result.unsupported,
        )
        assertEquals("Profile 5 must present nothing", 0, result.frames)
    }

    private data class ReaderResult(
        val pixels: IntArray?,
        val frames: Int,
        val decoder: String,
        val toneMapping: Boolean,
        val failure: Int?,
        val unsupported: Boolean,
    )

    private fun assertReferencePixels(
        result: ReaderResult,
        expectedAsset: String = "hdr-probe-expected.json",
    ) {
        val expected =
            JSONObject(
                instrumentation.context.assets.open(expectedAsset).use {
                    it.readBytes().decodeToString()
                }
            )
        assertNull("Playback must not fail", result.failure)
        assertTrue("Frames must reach the display surface: $result", result.frames >= FRAMES)
        assertTrue("The source must go through Kino's tone mapping", result.toneMapping)
        assertTrue(
            "Video must stay hardware decoded: ${result.decoder}",
            result.decoder.startsWith("OMX.Nvidia.") || result.decoder.startsWith("c2.nvidia."),
        )
        val frame = checkNotNull(result.pixels)
        // Eight-bit output adds half a code of quantisation to the shader test's tolerances.
        verifyToneMappedPatches(
            expected.getJSONArray("patches"),
            TOLERANCE + QUANTISATION,
            NEUTRAL_SPREAD + 2 * QUANTISATION,
        ) { x, y ->
            val rgb = frame[y * WIDTH + x]
            listOf((rgb shr 16 and 0xff) / 255f, (rgb shr 8 and 0xff) / 255f, (rgb and 0xff) / 255f)
        }
    }

    /**
     * Plays a probe through the production player and renderer into an `ImageReader` standing in
     * for the display, and returns the last presented frame.
     */
    private fun playIntoReader(asset: String, expectFrames: Boolean): ReaderResult {
        val file = File(context.cacheDir, "reader-$asset")
        instrumentation.context.assets.open(asset).use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        val readerThread = HandlerThread("KinoHdrReader").apply { start() }
        val reader =
            ImageReader.newInstance(
                WIDTH,
                HEIGHT,
                PixelFormat.RGBA_8888,
                3,
                HardwareBuffer.USAGE_CPU_READ_OFTEN or HardwareBuffer.USAGE_GPU_COLOR_OUTPUT,
            )
        val frames = CountDownLatch(FRAMES)
        var frameCount = 0
        var pixels: IntArray? = null
        reader.setOnImageAvailableListener(
            { source ->
                source.acquireLatestImage()?.use { image ->
                    val plane = image.planes[0]
                    val buffer = plane.buffer
                    val row = plane.rowStride
                    val step = plane.pixelStride
                    val copy = IntArray(WIDTH * HEIGHT)
                    for (y in 0 until HEIGHT) {
                        for (x in 0 until WIDTH) {
                            val offset = y * row + x * step
                            // RGBA_8888: one byte per channel in memory order.
                            copy[y * WIDTH + x] =
                                (buffer.get(offset).toInt() and 0xff shl 16) or
                                    (buffer.get(offset + 1).toInt() and 0xff shl 8) or
                                    (buffer.get(offset + 2).toInt() and 0xff)
                        }
                    }
                    pixels = copy
                    frameCount++
                    frames.countDown()
                }
            },
            Handler(readerThread.looper),
        )
        val renderers = HardwareRenderers(context)
        lateinit var player: ExoPlayer
        var decoder = ""
        var failure: Int? = null
        var unsupported = false
        val refused = CountDownLatch(1)
        instrumentation.runOnMainSync {
            player = createTvPlayer(context, renderers)
            player.setVideoSurface(reader.surface)
            player.volume = 0f
            player.addListener(
                object : Player.Listener {
                    override fun onPlayerError(error: PlaybackException) {
                        failure = error.errorCode
                        refused.countDown()
                    }

                    override fun onTracksChanged(tracks: Tracks) {
                        if (
                            tracks.groups.any { it.type == C.TRACK_TYPE_VIDEO } &&
                                !tracks.isTypeSelected(C.TRACK_TYPE_VIDEO)
                        ) {
                            unsupported = true
                            refused.countDown()
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
                        decoder = decoderName
                    }
                }
            )
            player.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
            player.prepare()
            player.play()
        }
        try {
            if (expectFrames) frames.await(20, TimeUnit.SECONDS)
            else {
                refused.await(10, TimeUnit.SECONDS)
                // Give a wrongly accepted stream time to present, so the check can see it.
                Thread.sleep(1_000)
            }
            return ReaderResult(
                pixels,
                frameCount,
                decoder,
                renderers.toneMapping,
                failure,
                unsupported,
            )
        } finally {
            instrumentation.runOnMainSync { player.release() }
            // Closing the reader invalidates the image a frame callback may still be copying,
            // which crashed the test process; stop its thread first.
            reader.setOnImageAvailableListener(null, null)
            readerThread.quitSafely()
            readerThread.join(5_000)
            reader.close()
            file.delete()
        }
    }

    @Test
    fun hdrTenAt2160pKeepsPaceOnTheDisplay() {
        val file = File(context.cacheDir, "hdr-2160p.mkv")
        instrumentation.context.assets.open("hevc-hdr10-2160p.mkv").use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val renderers = HardwareRenderers(activity)
        lateinit var player: ExoPlayer
        var dropped = 0
        var failure: Int? = null
        instrumentation.runOnMainSync {
            val surface = SurfaceView(activity)
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            activity.setContentView(surface)
            // The same buffer sizing FullscreenPlayer applies, so the GPU draws every pixel of
            // the 2160p frame the way it does in production.
            renderers.onToneMappedVideoSize = { width, height ->
                surface.post { surface.holder.setFixedSize(width, height) }
            }
            player = createTvPlayer(activity, renderers)
            player.setVideoSurfaceView(surface)
            player.addListener(
                object : Player.Listener {
                    override fun onPlayerError(error: PlaybackException) {
                        failure = error.errorCode
                    }
                }
            )
            player.addAnalyticsListener(
                object : AnalyticsListener {
                    override fun onDroppedVideoFrames(
                        eventTime: AnalyticsListener.EventTime,
                        droppedFrames: Int,
                        elapsedMs: Long,
                    ) {
                        dropped += droppedFrames
                    }
                }
            )
            player.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
            player.prepare()
            player.play()
        }
        try {
            fun position(): Long {
                var value = 0L
                instrumentation.runOnMainSync { value = player.currentPosition }
                return value
            }
            val deadline = System.currentTimeMillis() + 20_000
            while (position() < 1_000 && failure == null && System.currentTimeMillis() < deadline)
                Thread.sleep(50)
            assertNull("2160p HDR10 playback must not fail", failure)
            assertTrue("2160p HDR10 playback must start", position() >= 1_000)
            assertTrue("2160p HDR10 must go through Kino's tone mapping", renderers.toneMapping)
            // Measure a steady window after startup, so decoder warm-up is not counted.
            val droppedBefore = dropped
            val framesBefore = renderers.toneMappedFramesPresented
            val positionBefore = position()
            Thread.sleep(6_000)
            val framesAfter = renderers.toneMappedFramesPresented
            val positionAfter = position()
            val mediaFrames = (positionAfter - positionBefore) * FRAME_RATE / 1_000.0
            val presented = framesAfter - framesBefore
            Log.i(
                "KinoToneMap",
                "2160p presented=$presented expected=${"%.1f".format(mediaFrames)} " +
                    "dropped=${dropped - droppedBefore}",
            )
            assertNull("2160p HDR10 playback must not fail", failure)
            assertTrue(
                "Tone mapping must present nearly every frame: $presented of $mediaFrames",
                presented >= mediaFrames * 0.95,
            )
            assertTrue(
                "The decoder must not drop frames behind tone mapping: ${dropped - droppedBefore}",
                dropped - droppedBefore <= 2,
            )
        } finally {
            instrumentation.runOnMainSync {
                player.release()
                activity.finish()
            }
            file.delete()
        }
    }

    private companion object {
        const val FRAME_RATE = 24
        const val WIDTH = 640
        const val HEIGHT = 360
        const val FRAMES = 12
        // The same bounds ShieldToneMapTest derives from the driver's measured offsets.
        const val TOLERANCE = 0.035f
        const val NEUTRAL_SPREAD = 0.037f
        const val QUANTISATION = 0.5f / 255f
    }
}
