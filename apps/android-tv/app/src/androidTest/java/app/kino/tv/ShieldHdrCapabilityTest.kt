package app.kino.tv

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.opengl.EGL14
import android.opengl.GLES20
import android.os.Build
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

/**
 * Records why this device cannot tone-map HDR, so the limitation stays a measured fact rather than
 * a remembered one.
 *
 * Media3's HDR path compiles a fragment shader that samples the decoder's external YUV texture, and
 * that shader opens with `#extension GL_EXT_YUV_target : require`. Without the extension the shader
 * fails to compile and playback stops with error 7001 before a frame reaches the screen. The other
 * route, asking the decoder itself for SDR through [MediaFormat.KEY_COLOR_TRANSFER_REQUEST], needs
 * API 31.
 *
 * These assertions are written so that a device or driver which gains either capability fails the
 * suite. That failure is the signal to revisit ADR 0021 and the playback contract, not a defect.
 */
class ShieldHdrCapabilityTest {
    private val hevc = MimeTypeHevc

    @Test
    fun media3CannotCompileItsHdrShaderOnThisDriver() {
        val extensions = glExtensions()
        Log.i("KinoHdr", "GL_RENDERER=${extensions.renderer} GL_VERSION=${extensions.version}")
        assertTrue(
            "An OpenGL ES 3.x context is required to reason about Media3's HDR path",
            extensions.version.contains("OpenGL ES 3"),
        )
        assertFalse(
            "GL_EXT_YUV_target is now present. Media3's OpenGL tone mapping may work on this " +
                "device: re-run the tone mapping probe and revisit ADR 0021.",
            extensions.names.contains("GL_EXT_YUV_target"),
        )
    }

    @Test
    fun theDecoderCannotBeAskedForSdrOutput() {
        assertTrue(
            "MediaFormat.KEY_COLOR_TRANSFER_REQUEST needs API 31. This device reports " +
                "${Build.VERSION.SDK_INT}, so decoder-side tone mapping may now be available: " +
                "revisit ADR 0021.",
            Build.VERSION.SDK_INT < 31,
        )
    }

    /**
     * The capability every player that does tone-map on Android depends on. Leaving the decoder's
     * output Surface hands back real pixel planes, which a renderer can convert itself. Kino does
     * not use this yet; the test records whether the hardware decoder offers it at all.
     */
    @Test
    fun hardwareHevcDecodersReportWhetherTheyCanReturnTenBitFrames() {
        val decoders =
            MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.filter {
                !it.isEncoder && it.supportedTypes.any { type -> type.equals(hevc, true) }
            }
        assertTrue("This device must expose an HEVC decoder", decoders.isNotEmpty())

        var tenBitCapable = false
        for (decoder in decoders) {
            val capabilities = decoder.getCapabilitiesForType(hevc)
            val formats = capabilities.colorFormats.toList()
            val profiles = capabilities.profileLevels.map { it.profile }.distinct()
            Log.i(
                "KinoHdr",
                "decoder=${decoder.name} hardware=${isHardware(decoder)} " +
                    "colorFormats=${formats.joinToString { "0x%x".format(it) }} " +
                    "main10=${profiles.contains(HevcProfileMain10)}",
            )
            if (isHardware(decoder) && formats.contains(ColorFormatYuvP010)) tenBitCapable = true
        }
        Log.i("KinoHdr", "hardware HEVC decoder offers P010 buffers: $tenBitCapable")
    }

    /**
     * The advertised colour formats are a claim, not a measurement: a codec may list
     * COLOR_FormatYUV420Flexible and still hand back ten-bit planes. This decodes the real HDR10
     * fixture without a Surface and reports the format of the frames that actually come out, which
     * is what an in-app tone mapper would have to work from.
     */
    @Test
    fun tenBitFramesAreMeasuredRatherThanAssumed() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val file = java.io.File(instrumentation.targetContext.cacheDir, "hdr-capability.mkv")
        instrumentation.context.assets.open("hevc-hdr10-eac3.mkv").use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        val extractor = MediaExtractor()
        extractor.setDataSource(file.absolutePath)
        val track =
            (0 until extractor.trackCount).first {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME).orEmpty().startsWith("video/")
            }
        extractor.selectTrack(track)
        val input = extractor.getTrackFormat(track)
        Log.i("KinoHdr", "fixture input format=$input")

        val codec = MediaCodec.createByCodecName("OMX.Nvidia.h265.decode")
        input.setInteger(
            MediaFormat.KEY_COLOR_FORMAT,
            MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible,
        )
        codec.configure(input, null, null, 0)
        codec.start()
        val info = MediaCodec.BufferInfo()
        var reported = false
        val deadline = System.currentTimeMillis() + 10_000
        try {
            while (!reported && System.currentTimeMillis() < deadline) {
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
                when (val outIndex = codec.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED ->
                        Log.i("KinoHdr", "decoder output format=${codec.outputFormat}")
                    in 0..Int.MAX_VALUE -> {
                        val image = codec.getOutputImage(outIndex)
                        if (image != null) {
                            val stride = image.planes[0].rowStride
                            Log.i(
                                "KinoHdr",
                                "decoded frame imageFormat=0x%x width=%d rowStride=%d pixelStride=%d"
                                    .format(image.format, image.width, stride, image.planes[0].pixelStride),
                            )
                            // Ten-bit planes carry two bytes per sample, so the luma row is at
                            // least twice the width. Eight-bit output leaves it at about the width.
                            Log.i(
                                "KinoHdr",
                                "luma bytes per sample ~= %.2f".format(stride.toDouble() / image.width),
                            )
                            image.close()
                            reported = true
                        }
                        codec.releaseOutputBuffer(outIndex, false)
                    }
                }
            }
        } finally {
            codec.stop()
            codec.release()
            extractor.release()
            file.delete()
        }
        assertTrue("The decoder produced no frame to measure", reported)
    }

    private fun isHardware(info: MediaCodecInfo) =
        if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated
        else !info.name.startsWith("OMX.google.") && !info.name.startsWith("c2.android.")

    private data class GlInfo(
        val renderer: String,
        val version: String,
        val names: Set<String>,
    )

    /**
     * Media3 queries extensions from its own render thread. Reading them here needs a context of
     * the same client version, so this makes an offscreen ES 3 surface rather than reusing the
     * instrumentation's.
     */
    private fun glExtensions(): GlInfo {
        val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        EGL14.eglInitialize(display, IntArray(1), 0, IntArray(1), 0)
        val configs = arrayOfNulls<android.opengl.EGLConfig>(1)
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
        val context =
            EGL14.eglCreateContext(
                display,
                configs[0],
                EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE),
                0,
            )
        val surface =
            EGL14.eglCreatePbufferSurface(
                display,
                configs[0],
                intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE),
                0,
            )
        EGL14.eglMakeCurrent(display, surface, surface, context)
        try {
            return GlInfo(
                GLES20.glGetString(GLES20.GL_RENDERER).orEmpty(),
                GLES20.glGetString(GLES20.GL_VERSION).orEmpty(),
                GLES20.glGetString(GLES20.GL_EXTENSIONS).orEmpty().split(' ').toSet(),
            )
        } finally {
            EGL14.eglMakeCurrent(
                display,
                EGL14.EGL_NO_SURFACE,
                EGL14.EGL_NO_SURFACE,
                EGL14.EGL_NO_CONTEXT,
            )
            EGL14.eglDestroySurface(display, surface)
            EGL14.eglDestroyContext(display, context)
            EGL14.eglTerminate(display)
        }
    }

    private companion object {
        const val MimeTypeHevc = "video/hevc"
        const val HevcProfileMain10 = MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10
        // MediaCodecInfo.CodecCapabilities.COLOR_FormatYUVP010, added in API 29.
        const val ColorFormatYuvP010 = 0x36
    }
}
