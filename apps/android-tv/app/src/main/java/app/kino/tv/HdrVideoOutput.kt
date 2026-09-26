package app.kino.tv

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES30
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Carries hardware-decoded HDR10 frames through [HdrToneMapper] to the display.
 *
 * The decoder renders into [inputSurface], a `SurfaceTexture` owned by this class's own GL thread,
 * instead of the player's display surface. Each frame is sampled there, tone mapped, and drawn
 * into the display surface through EGL, carrying the codec's release timestamp as its
 * presentation time so Media3's frame pacing survives the extra hop. Nothing here touches the
 * decoder, so video stays hardware decoded as ADR 0009 requires.
 *
 * Frames are always latched, even with no display attached, because a `SurfaceTexture` that is
 * never updated stops accepting buffers and would stall the decoder.
 */
internal class HdrVideoOutput(sourcePeakNits: Float, val hlg: Boolean = false) {
    private val thread = HandlerThread("KinoHdrOutput").apply { start() }
    private val handler = Handler(thread.looper)
    private val toneMapper = HdrToneMapper(sourcePeakNits = sourcePeakNits, hlg = hlg)
    private val transform = FloatArray(16)
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var config: EGLConfig? = null
    private var idle: EGLSurface = EGL14.EGL_NO_SURFACE
    private var window: EGLSurface = EGL14.EGL_NO_SURFACE
    private var windowTarget: Surface? = null
    private var textureId = 0
    private var surfaceTexture: SurfaceTexture? = null
    private var input: Surface? = null
    private var released = false

    /** The surface the decoder renders into. */
    val inputSurface: Surface

    /** Tone-mapped frames handed to the display so far, for the playback gates. */
    @Volatile
    var presentedFrames = 0L
        private set

    init {
        val ready = CountDownLatch(1)
        var created: Surface? = null
        var failure: Throwable? = null
        handler.post {
            try {
                created = setUp()
            } catch (error: Throwable) {
                failure = error
            } finally {
                ready.countDown()
            }
        }
        val started = ready.await(5, TimeUnit.SECONDS)
        val surface = created
        if (!started || failure != null || surface == null) {
            release()
            throw IllegalStateException("HDR output unavailable", failure)
        }
        inputSurface = surface
        Log.i(TAG, "HDR tone mapping ready peak=${sourcePeakNits.toInt()} hlg=$hlg")
    }

    /**
     * Points the tone-mapped output at [target], or detaches it with null. Returns once the GL
     * thread has let go of the previous surface, so a decoder can connect to it straight after.
     */
    fun setDisplay(target: Surface?) {
        val done = CountDownLatch(1)
        if (!handler.post {
                attach(target)
                done.countDown()
            }
        )
            return
        done.await(2, TimeUnit.SECONDS)
    }

    fun release() {
        if (released) return
        released = true
        handler.post {
            tearDown()
            thread.quitSafely()
        }
    }

    private fun setUp(): Surface {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        check(EGL14.eglInitialize(display, IntArray(1), 0, IntArray(1), 0)) { "EGL unavailable" }
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        EGL14.eglChooseConfig(
            display,
            intArrayOf(
                EGL14.EGL_RED_SIZE,
                8,
                EGL14.EGL_GREEN_SIZE,
                8,
                EGL14.EGL_BLUE_SIZE,
                8,
                EGL14.EGL_ALPHA_SIZE,
                8,
                EGL14.EGL_RENDERABLE_TYPE,
                EGL_OPENGL_ES3_BIT,
                EGL14.EGL_SURFACE_TYPE,
                EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_NONE,
            ),
            0,
            configs,
            0,
            1,
            count,
            0,
        )
        check(count[0] > 0) { "no EGL config for HDR output" }
        config = configs[0]
        context =
            EGL14.eglCreateContext(
                display,
                config,
                EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE),
                0,
            )
        check(context != EGL14.EGL_NO_CONTEXT) { "no GL ES 3 context" }
        idle =
            EGL14.eglCreatePbufferSurface(
                display,
                config,
                intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE),
                0,
            )
        check(EGL14.eglMakeCurrent(display, idle, idle, context)) { "GL context unavailable" }
        val ids = IntArray(1)
        GLES30.glGenTextures(1, ids, 0)
        textureId = ids[0]
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        for (wrap in intArrayOf(GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_TEXTURE_WRAP_T)) {
            GLES30.glTexParameteri(
                GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                wrap,
                GLES30.GL_CLAMP_TO_EDGE,
            )
        }
        toneMapper.prepare()
        val texture = SurfaceTexture(textureId)
        texture.setOnFrameAvailableListener({ drawFrame() }, handler)
        surfaceTexture = texture
        return Surface(texture).also { input = it }
    }

    private fun attach(target: Surface?) {
        if (target === windowTarget && window != EGL14.EGL_NO_SURFACE) return
        if (window != EGL14.EGL_NO_SURFACE) {
            EGL14.eglMakeCurrent(display, idle, idle, context)
            EGL14.eglDestroySurface(display, window)
            window = EGL14.EGL_NO_SURFACE
        }
        windowTarget = target
        if (target == null || !target.isValid) return
        window =
            EGL14.eglCreateWindowSurface(display, config, target, intArrayOf(EGL14.EGL_NONE), 0)
        if (window == EGL14.EGL_NO_SURFACE) {
            Log.e(TAG, "HDR display surface unavailable error=${EGL14.eglGetError()}")
        }
    }

    private fun drawFrame() {
        val texture = surfaceTexture ?: return
        val target = window
        EGL14.eglMakeCurrent(
            display,
            if (target == EGL14.EGL_NO_SURFACE) idle else target,
            if (target == EGL14.EGL_NO_SURFACE) idle else target,
            context,
        )
        texture.updateTexImage()
        if (target == EGL14.EGL_NO_SURFACE) return
        val width = IntArray(1)
        val height = IntArray(1)
        EGL14.eglQuerySurface(display, target, EGL14.EGL_WIDTH, width, 0)
        EGL14.eglQuerySurface(display, target, EGL14.EGL_HEIGHT, height, 0)
        GLES30.glViewport(0, 0, width[0], height[0])
        texture.getTransformMatrix(transform)
        toneMapper.draw(textureId, transform)
        // The codec released this frame for a particular vsync. Handing that time on lets
        // SurfaceFlinger present it then, rather than whenever the draw finishes.
        EGLExt.eglPresentationTimeANDROID(display, target, texture.timestamp)
        if (EGL14.eglSwapBuffers(display, target)) presentedFrames++
        else Log.w(TAG, "HDR frame not presented error=${EGL14.eglGetError()}")
    }

    private fun tearDown() {
        if (display == EGL14.EGL_NO_DISPLAY) return
        EGL14.eglMakeCurrent(display, idle, idle, context)
        input?.release()
        input = null
        surfaceTexture?.release()
        surfaceTexture = null
        toneMapper.release()
        if (textureId != 0) GLES30.glDeleteTextures(1, intArrayOf(textureId), 0)
        if (window != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, window)
        if (idle != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, idle)
        EGL14.eglMakeCurrent(
            display,
            EGL14.EGL_NO_SURFACE,
            EGL14.EGL_NO_SURFACE,
            EGL14.EGL_NO_CONTEXT,
        )
        if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
        EGL14.eglReleaseThread()
        display = EGL14.EGL_NO_DISPLAY
    }

    private companion object {
        const val TAG = "KinoPlayer"
        const val EGL_OPENGL_ES3_BIT = 0x0040
    }
}
