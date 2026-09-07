package app.kino.tv

import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES11Ext
import android.opengl.GLES30
import android.util.Log
import android.view.Surface
import androidx.test.platform.app.InstrumentationRegistry
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Checks that [HdrToneMapper] turns real hardware-decoded HDR10 into the SDR the standards call for.
 *
 * The expected values come from `scripts/test-support/tone-map-reference.mjs`, which implements the
 * same pipeline on the host in another language, and travel with the fixture as
 * `hdr-probe-expected.json`. Comparing against a second implementation is the point: a mistake in
 * the transfer function, the knee, or the gamut matrix has to be made twice, identically, to pass.
 *
 * The absolute comparison carries a tolerance because two things legitimately differ. The Tegra
 * driver's own conversion sits up to about 0.011 off the ideal BT.2020 result, measured in
 * `ShieldHdrSamplerTest`, and that error propagates through the curve. GPU `pow` also need not match
 * the host's to the last bit. The structural assertions alongside it carry no tolerance at all, and
 * they are what catch a wrong matrix, a missing EOTF or an inverted curve, all of which miss by an
 * order of magnitude more than this.
 */
class ShieldToneMapTest {
    private lateinit var display: android.opengl.EGLDisplay
    private lateinit var context: android.opengl.EGLContext
    private lateinit var eglSurface: android.opengl.EGLSurface

    @Test
    fun hdrTenBitFramesBecomeTheSdrTheStandardsSpecify() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val expected =
            JSONObject(
                instrumentation.context.assets.open("hdr-probe-expected.json").use {
                    it.readBytes().decodeToString()
                }
            )
        val file = java.io.File(instrumentation.targetContext.cacheDir, "tone-map.mkv")
        instrumentation.context.assets.open("hdr-probe.mkv").use { input ->
            file.outputStream().use { input.copyTo(it) }
        }

        makeContext()
        val toneMapper =
            HdrToneMapper(
                sourcePeakNits = expected.getDouble("sourcePeakNits").toFloat(),
                targetPeakNits = expected.getDouble("targetPeakNits").toFloat(),
            )
        val textureId = createExternalTexture()
        val surfaceTexture = SurfaceTexture(textureId)
        surfaceTexture.setDefaultBufferSize(WIDTH, HEIGHT)
        val frameReady = CountDownLatch(1)
        surfaceTexture.setOnFrameAvailableListener { frameReady.countDown() }
        val surface = Surface(surfaceTexture)

        try {
            decodeOneFrame(file, surface)
            assertTrue("The decoder produced no frame", frameReady.await(10, TimeUnit.SECONDS))
            surfaceTexture.updateTexImage()

            toneMapper.prepare()
            val pixels = renderToneMapped(toneMapper, textureId)
            verify(pixels, expected.getJSONArray("patches"))
        } finally {
            toneMapper.release()
            surface.release()
            surfaceTexture.release()
            releaseContext()
            file.delete()
        }
    }

    private fun verify(pixels: FloatArray, patches: org.json.JSONArray) {
        fun at(x: Int, y: Int): Triple<Float, Float, Float> {
            val i = (y * WIDTH + x) * 4
            return Triple(pixels[i], pixels[i + 1], pixels[i + 2])
        }
        fun Triple<Float, Float, Float>.toList() = listOf(first, second, third)

        var worst = 0.0
        var worstLabel = ""
        val ramp = mutableListOf<Float>()
        for (i in 0 until patches.length()) {
            val patch = patches.getJSONObject(i)
            val band = patch.getString("band")
            val luma = patch.getInt("luma")
            val rendered = at(patch.getInt("x"), patch.getInt("y")).toList()
            val want = patch.getJSONArray("expected")

            // Neutral in, neutral out. Both bounds here are the driver's, not the shader's. It
            // centres chroma on about 510 rather than 512, a constant two code offset measured in
            // ShieldHdrSamplerTest, and pushing that offset through the reference pipeline predicts
            // at most 0.0176 of per-channel error and 0.0244 of spread. The constants below are
            // those numbers with half again for GPU pow. Correcting the offset in the shader would
            // bake a driver quirk into Kino and become an equal and opposite error the day a driver
            // fixes it. A wrong gamut matrix tints an order of magnitude harder and still fails.
            if (band != "B") {
                val spread = rendered.max() - rendered.min()
                assertTrue(
                    "$band luma $luma is not neutral, spread $spread: $rendered",
                    spread < NEUTRAL_SPREAD,
                )
            }

            for (channel in 0..2) {
                val error = abs(rendered[channel] - want.getDouble(channel).toFloat()).toDouble()
                if (error > worst) {
                    worst = error
                    worstLabel = "$band luma $luma channel ${"RGB"[channel]}"
                }
                assertEquals(
                    "$band luma $luma channel ${"RGB"[channel]}: expected " +
                        "${want.getDouble(channel)}, rendered ${rendered[channel]}",
                    want.getDouble(channel).toFloat(),
                    rendered[channel],
                    TOLERANCE,
                )
            }
            if (band == "A") ramp.add(rendered[1])
        }
        Log.i(TAG, "worst channel error ${"%.4f".format(worst)} at $worstLabel")

        // Structural properties, which need no tolerance and fail loudly on a broken curve.
        assertEquals("video black must render as black", 0f, ramp.first(), 0.01f)
        assertEquals("the brightest step must clip to white", 1f, ramp.last(), 0.01f)
        for (i in 1 until ramp.size) {
            assertTrue(
                "the ramp must never fall: step $i went ${ramp[i - 1]} -> ${ramp[i]}",
                ramp[i] >= ramp[i - 1] - 0.001f,
            )
        }
    }

    private fun renderToneMapped(toneMapper: HdrToneMapper, textureId: Int): FloatArray {
        val fbo = IntArray(1)
        val target = IntArray(1)
        GLES30.glGenTextures(1, target, 0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, target[0])
        GLES30.glTexImage2D(
            GLES30.GL_TEXTURE_2D,
            0,
            GLES30.GL_RGBA16F,
            WIDTH,
            HEIGHT,
            0,
            GLES30.GL_RGBA,
            GLES30.GL_HALF_FLOAT,
            null,
        )
        GLES30.glGenFramebuffers(1, fbo, 0)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo[0])
        GLES30.glFramebufferTexture2D(
            GLES30.GL_FRAMEBUFFER,
            GLES30.GL_COLOR_ATTACHMENT0,
            GLES30.GL_TEXTURE_2D,
            target[0],
            0,
        )
        assertEquals(
            "half float framebuffer incomplete",
            GLES30.GL_FRAMEBUFFER_COMPLETE,
            GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER),
        )
        GLES30.glViewport(0, 0, WIDTH, HEIGHT)
        toneMapper.draw(textureId)

        val buffer = ByteBuffer.allocateDirect(WIDTH * HEIGHT * 16).order(ByteOrder.nativeOrder())
        GLES30.glReadPixels(0, 0, WIDTH, HEIGHT, GLES30.GL_RGBA, GLES30.GL_FLOAT, buffer)
        assertEquals("glReadPixels failed", GLES30.GL_NO_ERROR, GLES30.glGetError())
        buffer.rewind()
        val floats = FloatArray(WIDTH * HEIGHT * 4)
        buffer.asFloatBuffer().get(floats)
        return floats
    }

    private fun decodeOneFrame(file: java.io.File, surface: Surface) {
        val extractor = MediaExtractor()
        extractor.setDataSource(file.absolutePath)
        val track =
            (0 until extractor.trackCount).first {
                extractor
                    .getTrackFormat(it)
                    .getString(MediaFormat.KEY_MIME)
                    .orEmpty()
                    .startsWith("video/")
            }
        extractor.selectTrack(track)
        val codec = MediaCodec.createByCodecName("OMX.Nvidia.h265.decode")
        codec.configure(extractor.getTrackFormat(track), surface, null, 0)
        codec.start()
        val info = MediaCodec.BufferInfo()
        var rendered = false
        val deadline = System.currentTimeMillis() + 10_000
        try {
            while (!rendered && System.currentTimeMillis() < deadline) {
                val inIndex = codec.dequeueInputBuffer(10_000)
                if (inIndex >= 0) {
                    val buffer = codec.getInputBuffer(inIndex)!!
                    val size = extractor.readSampleData(buffer, 0)
                    if (size < 0) {
                        codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                    } else {
                        codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
                val outIndex = codec.dequeueOutputBuffer(info, 10_000)
                if (outIndex >= 0) {
                    codec.releaseOutputBuffer(outIndex, true)
                    rendered = true
                }
            }
        } finally {
            codec.stop()
            codec.release()
            extractor.release()
        }
    }

    private fun createExternalTexture(): Int {
        val ids = IntArray(1)
        GLES30.glGenTextures(1, ids, 0)
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, ids[0])
        GLES30.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES30.GL_TEXTURE_WRAP_S,
            GLES30.GL_CLAMP_TO_EDGE,
        )
        GLES30.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES30.GL_TEXTURE_WRAP_T,
            GLES30.GL_CLAMP_TO_EDGE,
        )
        return ids[0]
    }

    private fun makeContext() {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        EGL14.eglInitialize(display, IntArray(1), 0, IntArray(1), 0)
        val configs = arrayOfNulls<EGLConfig>(1)
        EGL14.eglChooseConfig(
            display,
            intArrayOf(
                EGL14.EGL_RENDERABLE_TYPE,
                0x0040,
                EGL14.EGL_SURFACE_TYPE,
                EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_NONE,
            ),
            0,
            configs,
            0,
            1,
            IntArray(1),
            0,
        )
        context =
            EGL14.eglCreateContext(
                display,
                configs[0],
                EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE),
                0,
            )
        eglSurface =
            EGL14.eglCreatePbufferSurface(
                display,
                configs[0],
                intArrayOf(EGL14.EGL_WIDTH, WIDTH, EGL14.EGL_HEIGHT, HEIGHT, EGL14.EGL_NONE),
                0,
            )
        EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)
    }

    private fun releaseContext() {
        EGL14.eglMakeCurrent(
            display,
            EGL14.EGL_NO_SURFACE,
            EGL14.EGL_NO_SURFACE,
            EGL14.EGL_NO_CONTEXT,
        )
        EGL14.eglDestroySurface(display, eglSurface)
        EGL14.eglDestroyContext(display, context)
        EGL14.eglTerminate(display)
    }

    private companion object {
        const val TAG = "KinoToneMap"
        const val WIDTH = 640
        const val HEIGHT = 360
        // The device measures 0.0250 at worst. About 0.015 of that is the driver's own two
        // deviations pushed through the pipeline; the rest is GPU transcendental precision, which
        // the PQ EOTF punishes because it raises a value to 0.0127 and then to 6.277. A real
        // pipeline error misses by an order of magnitude more: dropping the gamut conversion moves
        // the coloured patches by more than 0.2.
        const val TOLERANCE = 0.035f
        const val NEUTRAL_SPREAD = 0.037f
    }
}
