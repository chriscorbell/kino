package app.kino.tv

import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES20
import android.opengl.GLES30
import android.opengl.GLES11Ext
import android.util.Log
import android.view.Surface
import androidx.test.platform.app.InstrumentationRegistry
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

/**
 * Measures what the Tegra driver hands back when a BT.2020 PQ ten-bit frame is sampled through a
 * plain `samplerExternalOES`.
 *
 * This is the question Media3's failure leaves open. Media3 needs `GL_EXT_YUV_target` because it
 * wants raw YUV to convert itself, and this driver does not have it. But OES_EGL_image_external
 * says an external sampler returns RGB "in the same colorspace as the source image", so the frame
 * may still arrive usable, already de-matrixed and still PQ encoded. mpv relies on exactly that.
 * Whether it holds here decides whether Kino can tone-map on this hardware at all.
 *
 * `hdr-probe.mkv` is losslessly encoded from known ten-bit code words, so every value read back has
 * an exact expected counterpart. Band A is a neutral ramp, which isolates the transfer because
 * neutral chroma gives R=G=B under every matrix. Band B carries chroma pairs the candidate matrices
 * disagree about. Bands C and D are ramps one and four codes apart, which separate ten-bit from
 * eight-bit precision.
 *
 * This test reports rather than asserts. It exists to produce a measurement.
 */
class ShieldHdrSamplerTest {
    private lateinit var display: android.opengl.EGLDisplay
    private lateinit var context: android.opengl.EGLContext
    private lateinit var eglSurface: android.opengl.EGLSurface

    @Test
    fun externalSamplerOutputIsMeasuredAgainstKnownCodeWords() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val file = java.io.File(instrumentation.targetContext.cacheDir, "hdr-probe.mkv")
        instrumentation.context.assets.open("hdr-probe.mkv").use { input ->
            file.outputStream().use { input.copyTo(it) }
        }

        makeContext()
        val textureId = createExternalTexture()
        val surfaceTexture = SurfaceTexture(textureId)
        surfaceTexture.setDefaultBufferSize(WIDTH, HEIGHT)
        val frameReady = CountDownLatch(1)
        surfaceTexture.setOnFrameAvailableListener { frameReady.countDown() }
        val surface = Surface(surfaceTexture)

        try {
            decodeOneFrame(file, surface)
            assertTrue(
                "The decoder produced no frame on the Surface path",
                frameReady.await(10, TimeUnit.SECONDS),
            )
            surfaceTexture.updateTexImage()

            val pixels = renderAndReadBack(textureId)
            report(pixels)
        } finally {
            surface.release()
            surfaceTexture.release()
            releaseContext()
            file.delete()
        }
    }

    /** Decodes to the Surface, which is the path that never touches CodecCapabilities.colorFormats. */
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
        val format = extractor.getTrackFormat(track)
        Log.i(TAG, "probe input format=$format")

        val codec = MediaCodec.createByCodecName("OMX.Nvidia.h265.decode")
        codec.configure(format, surface, null, 0)
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
                        codec.queueInputBuffer(
                            inIndex,
                            0,
                            0,
                            0,
                            MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                        )
                    } else {
                        codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
                val outIndex = codec.dequeueOutputBuffer(info, 10_000)
                if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    Log.i(TAG, "decoder output format=${codec.outputFormat}")
                } else if (outIndex >= 0) {
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

    /**
     * Draws the external texture into a half float target. RGBA16F is the point: an eight bit
     * target would destroy the precision this test is trying to measure.
     */
    private fun renderAndReadBack(textureId: Int): FloatArray {
        val program = buildProgram()
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
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_NEAREST)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_NEAREST)
        GLES30.glGenFramebuffers(1, fbo, 0)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo[0])
        GLES30.glFramebufferTexture2D(
            GLES30.GL_FRAMEBUFFER,
            GLES30.GL_COLOR_ATTACHMENT0,
            GLES30.GL_TEXTURE_2D,
            target[0],
            0,
        )
        val status = GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER)
        assertEquals(
            "A half float framebuffer is required to measure precision",
            GLES30.GL_FRAMEBUFFER_COMPLETE,
            status,
        )

        GLES30.glViewport(0, 0, WIDTH, HEIGHT)
        GLES30.glUseProgram(program)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES30.glUniform1i(GLES30.glGetUniformLocation(program, "uTexture"), 0)
        // Nearest sampling, no filtering: the code words must survive untouched.
        GLES30.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES30.GL_TEXTURE_MIN_FILTER,
            GLES30.GL_NEAREST,
        )
        GLES30.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES30.GL_TEXTURE_MAG_FILTER,
            GLES30.GL_NEAREST,
        )
        GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4)

        val readType = IntArray(1)
        GLES30.glGetIntegerv(GLES30.GL_IMPLEMENTATION_COLOR_READ_TYPE, readType, 0)
        Log.i(TAG, "GL_IMPLEMENTATION_COLOR_READ_TYPE=0x%x (GL_FLOAT=0x%x)".format(readType[0], GLES30.GL_FLOAT))

        val buffer =
            ByteBuffer.allocateDirect(WIDTH * HEIGHT * 4 * 4).order(ByteOrder.nativeOrder())
        GLES30.glReadPixels(0, 0, WIDTH, HEIGHT, GLES30.GL_RGBA, GLES30.GL_FLOAT, buffer)
        val error = GLES30.glGetError()
        assertEquals("glReadPixels failed with 0x%x".format(error), GLES30.GL_NO_ERROR, error)
        buffer.rewind()
        val floats = FloatArray(WIDTH * HEIGHT * 4)
        (buffer.asFloatBuffer() as FloatBuffer).get(floats)
        return floats
    }

    private fun report(pixels: FloatArray) {
        // glReadPixels counts rows from the bottom, and SurfaceTexture's own transform already
        // flips vertically. The two cancel, so a source row addresses the read buffer directly.
        fun at(x: Int, y: Int): Triple<Float, Float, Float> {
            val i = (y * WIDTH + x) * 4
            return Triple(pixels[i], pixels[i + 1], pixels[i + 2])
        }
        fun log(band: String, x: Int, y: Int, expected: String) {
            val (r, g, b) = at(x, y)
            Log.i(
                TAG,
                "%-8s (%3d,%3d) -> R=%.6f G=%.6f B=%.6f   %s".format(band, x, y, r, g, b, expected),
            )
        }

        Log.i(TAG, "--- band A, neutral ramp, chroma 512, luma 64..940 in 16 steps ---")
        for (i in 0 until 16) {
            val luma = 64 + Math.round(i * (940 - 64) / 15.0).toInt()
            log("A[$i]", i * (WIDTH / 16) + 20, 45, "luma code $luma")
        }
        Log.i(TAG, "--- band B, chroma pairs, luma 500 ---")
        val b = listOf(512 to 960, 512 to 64, 960 to 512, 64 to 512, 800 to 300, 300 to 800, 700 to 700, 200 to 200)
        for (i in 0 until 8) {
            log("B[$i]", i * (WIDTH / 8) + 40, 135, "Cb=${b[i].first} Cr=${b[i].second}")
        }
        Log.i(TAG, "--- band C, luma 500..515 one code apart ---")
        for (i in 0 until 16) log("C[$i]", i * (WIDTH / 16) + 20, 225, "luma code ${500 + i}")
        Log.i(TAG, "--- band D, luma 500..560 four codes apart ---")
        for (i in 0 until 16) log("D[$i]", i * (WIDTH / 16) + 20, 315, "luma code ${500 + 4 * i}")

        // Distinct values across each ramp answer the precision question directly.
        fun distinct(y: Int): Int =
            (0 until 16).map { pixels[(y * WIDTH + it * (WIDTH / 16) + 20) * 4] }.distinct().size
        Log.i(TAG, "distinct values: bandA=${distinct(45)} bandC=${distinct(225)} bandD=${distinct(315)}")
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

    private fun buildProgram(): Int {
        val vertex =
            """#version 300 es
            out vec2 vTexCoord;
            void main() {
              vec2 corner = vec2(float((gl_VertexID & 1) << 1), float(gl_VertexID & 2));
              vTexCoord = corner * 0.5;
              gl_Position = vec4(corner - 1.0, 0.0, 1.0);
            }"""
        val fragment =
            """#version 300 es
            #extension GL_OES_EGL_image_external_essl3 : require
            precision highp float;
            uniform samplerExternalOES uTexture;
            in vec2 vTexCoord;
            out vec4 outColor;
            void main() { outColor = texture(uTexture, vTexCoord); }"""
        val program = GLES30.glCreateProgram()
        for ((type, source) in
            listOf(GLES30.GL_VERTEX_SHADER to vertex, GLES30.GL_FRAGMENT_SHADER to fragment)) {
            val shader = GLES30.glCreateShader(type)
            GLES30.glShaderSource(shader, source)
            GLES30.glCompileShader(shader)
            val compiled = IntArray(1)
            GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, compiled, 0)
            assertEquals(
                "shader did not compile: ${GLES30.glGetShaderInfoLog(shader)}",
                GLES30.GL_TRUE,
                compiled[0],
            )
            GLES30.glAttachShader(program, shader)
        }
        GLES30.glLinkProgram(program)
        val linked = IntArray(1)
        GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, linked, 0)
        assertEquals(
            "program did not link: ${GLES30.glGetProgramInfoLog(program)}",
            GLES30.GL_TRUE,
            linked[0],
        )
        return program
    }

    private fun makeContext() {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        EGL14.eglInitialize(display, IntArray(1), 0, IntArray(1), 0)
        val configs = arrayOfNulls<EGLConfig>(1)
        EGL14.eglChooseConfig(
            display,
            intArrayOf(
                EGL14.EGL_RENDERABLE_TYPE,
                0x0040, // EGL_OPENGL_ES3_BIT_KHR
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
        Log.i(TAG, "GL_VERSION=${GLES20.glGetString(GLES20.GL_VERSION)}")
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
        const val TAG = "KinoHdrSampler"
        const val WIDTH = 640
        const val HEIGHT = 360
    }
}
