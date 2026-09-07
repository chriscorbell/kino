package app.kino.tv

import android.opengl.GLES11Ext
import android.opengl.GLES30

/**
 * Converts hardware-decoded HDR frames to SDR on the GPU.
 *
 * Media3 cannot do this on the Shield. Its HDR shader requires `GL_EXT_YUV_target` so it can sample
 * raw YUV and apply the colour matrix itself, and the Tegra driver does not expose that extension,
 * so playback stops with error 7001 before a frame is drawn. Kino does not need the extension,
 * because it does not need raw YUV. `OES_EGL_image_external` already returns RGB "in the same
 * colorspace as the source image", and measurement on the development Shield confirms the driver
 * honours that: it applies the BT.2020 matrix, expands limited range to full, leaves the transfer
 * function alone, and preserves all ten bits. `ShieldHdrSamplerTest` holds those numbers.
 *
 * So the frame arrives here already de-matrixed, range expanded, and still PQ encoded, which is
 * exactly the input this shader wants. It rolls the highlights off in the PQ domain where BT.2390
 * defines the curve, moves to linear light for the gamut change, and encodes for a BT.1886 display,
 * matching the desktop client's `target-trc`.
 *
 * The intermediate must stay half float. An eight-bit intermediate throws away the ten bits the
 * driver went to the trouble of preserving, which is the trap in reaching this through Media3's own
 * `DefaultVideoFrameProcessor`: its `useHdr` flag is what gates `GL_RGBA16F`, so telling it the
 * input is SDR to reach its SDR sampler also drops it to eight bits.
 *
 * `scripts/test-support/tone-map-reference.mjs` implements the same pipeline a second time on the
 * host, and `ShieldToneMapTest` compares this shader's output against it.
 */
class HdrToneMapper(
    private val sourcePeakNits: Float = DEFAULT_SOURCE_PEAK_NITS,
    private val targetPeakNits: Float = SDR_REFERENCE_WHITE_NITS,
) {
    private var program = 0
    private var textureUniform = 0
    private var maxSourcePqUniform = 0
    private var maxLumUniform = 0
    private var kneeStartUniform = 0
    private var linearScaleUniform = 0

    /** Compiles the program. A GL ES 3 context must be current. */
    fun prepare() {
        if (program != 0) return
        program = GlPrograms.link(VERTEX_SHADER, FRAGMENT_SHADER)
        textureUniform = GLES30.glGetUniformLocation(program, "uTexture")
        maxSourcePqUniform = GLES30.glGetUniformLocation(program, "uMaxSourcePq")
        maxLumUniform = GLES30.glGetUniformLocation(program, "uMaxLum")
        kneeStartUniform = GLES30.glGetUniformLocation(program, "uKneeStart")
        linearScaleUniform = GLES30.glGetUniformLocation(program, "uLinearScale")
    }

    /**
     * Draws [externalTextureId] over the whole of the bound framebuffer.
     *
     * The knee parameters are computed here rather than per pixel; they depend only on the source
     * and target peaks, which do not change within a stream.
     */
    fun draw(externalTextureId: Int) {
        check(program != 0) { "prepare() must run on the GL thread first" }
        val maxSourcePq = linearToPq(sourcePeakNits / 10_000f)
        val maxTargetPq = linearToPq(targetPeakNits / 10_000f)
        val maxLum = maxTargetPq / maxSourcePq

        GLES30.glUseProgram(program)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, externalTextureId)
        GLES30.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES30.GL_TEXTURE_MIN_FILTER,
            GLES30.GL_LINEAR,
        )
        GLES30.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES30.GL_TEXTURE_MAG_FILTER,
            GLES30.GL_LINEAR,
        )
        GLES30.glUniform1i(textureUniform, 0)
        GLES30.glUniform1f(maxSourcePqUniform, maxSourcePq)
        GLES30.glUniform1f(maxLumUniform, maxLum)
        GLES30.glUniform1f(kneeStartUniform, 1.5f * maxLum - 0.5f)
        GLES30.glUniform1f(linearScaleUniform, 10_000f / targetPeakNits)
        GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4)
    }

    fun release() {
        if (program != 0) GLES30.glDeleteProgram(program)
        program = 0
    }

    companion object {
        /**
         * Most HDR10 is graded to 1000 cd/m^2, and a stream that does not say otherwise is assumed
         * to be. Reading the real value from the mastering display metadata is a later refinement;
         * grading it too high only makes highlights conservative, never wrong in hue.
         */
        const val DEFAULT_SOURCE_PEAK_NITS = 1000f

        /** ITU-R BT.2408 puts HDR reference white at 203 cd/m^2, which is SDR diffuse white. */
        const val SDR_REFERENCE_WHITE_NITS = 203f

        // SMPTE ST 2084 table 4, as the ratios the standard states.
        private const val M1 = 2610f / 16384f
        private const val M2 = 2523f / 4096f * 128f
        private const val C1 = 3424f / 4096f
        private const val C2 = 2413f / 4096f * 32f
        private const val C3 = 2392f / 4096f * 32f

        private fun linearToPq(linear: Float): Float {
            val p = Math.pow(linear.coerceAtLeast(0f).toDouble(), M1.toDouble())
            return Math.pow((C1 + C2 * p) / (1 + C3 * p), M2.toDouble()).toFloat()
        }

        // gl_VertexID builds the quad, so there is no vertex buffer to bind or leak.
        private val VERTEX_SHADER =
            """#version 300 es
            out vec2 vTexCoord;
            void main() {
              vec2 corner = vec2(float((gl_VertexID & 1) << 1), float(gl_VertexID & 2));
              vTexCoord = corner * 0.5;
              gl_Position = vec4(corner - 1.0, 0.0, 1.0);
            }"""

        private val FRAGMENT_SHADER =
            """#version 300 es
            #extension GL_OES_EGL_image_external_essl3 : require
            precision highp float;

            uniform samplerExternalOES uTexture;
            uniform float uMaxSourcePq;
            uniform float uMaxLum;
            uniform float uKneeStart;
            uniform float uLinearScale;

            in vec2 vTexCoord;
            out vec4 outColor;

            const float M1 = 2610.0 / 16384.0;
            const float M2 = 2523.0 / 4096.0 * 128.0;
            const float C1 = 3424.0 / 4096.0;
            const float C2 = 2413.0 / 4096.0 * 32.0;
            const float C3 = 2392.0 / 4096.0 * 32.0;

            // SMPTE ST 2084 EOTF. Returns luminance normalised so 1.0 is 10000 cd/m^2.
            float pqToLinear(float signal) {
              float p = pow(max(signal, 0.0), 1.0 / M2);
              return pow(max(p - C1, 0.0) / (C2 - C3 * p), 1.0 / M1);
            }

            // ITU-R BT.2390 section 5.4.1. Everything below the knee passes through, so
            // shadows keep their detail and only highlights are compressed.
            float rollOff(float signal) {
              float e = signal / uMaxSourcePq;
              if (e > uKneeStart) {
                float t = (e - uKneeStart) / (1.0 - uKneeStart);
                float t2 = t * t;
                float t3 = t2 * t;
                e = (2.0 * t3 - 3.0 * t2 + 1.0) * uKneeStart
                  + (t3 - 2.0 * t2 + t) * (1.0 - uKneeStart)
                  + (-2.0 * t3 + 3.0 * t2) * uMaxLum;
              }
              return e * uMaxSourcePq;
            }

            void main() {
              // Already BT.2020 R'G'B', full range, still PQ encoded. See the class comment.
              vec3 pq = texture(uTexture, vTexCoord).rgb;
              pq = vec3(rollOff(pq.r), rollOff(pq.g), rollOff(pq.b));

              vec3 linear = vec3(pqToLinear(pq.r), pqToLinear(pq.g), pqToLinear(pq.b));
              linear *= uLinearScale;

              // ITU-R BT.2087 BT.2020 to BT.709, applied to linear light.
              vec3 rgb = vec3(
                dot(linear, vec3( 1.660491, -0.587641, -0.072850)),
                dot(linear, vec3(-0.124551,  1.132900, -0.008349)),
                dot(linear, vec3(-0.018151, -0.100579,  1.118730)));

              // Clip after the matrix. Out of gamut colour has nowhere to go, and the
              // playback contract prefers losing saturation to inventing it.
              rgb = clamp(rgb, 0.0, 1.0);

              // BT.1886 inverse EOTF, the same display the desktop client targets.
              outColor = vec4(pow(rgb, vec3(1.0 / 2.4)), 1.0);
            }"""
    }
}

/** Shader compilation with the error text attached, which GL otherwise discards. */
internal object GlPrograms {
    fun link(vertexSource: String, fragmentSource: String): Int {
        val program = GLES30.glCreateProgram()
        for ((type, source) in
            listOf(
                GLES30.GL_VERTEX_SHADER to vertexSource,
                GLES30.GL_FRAGMENT_SHADER to fragmentSource,
            )) {
            val shader = GLES30.glCreateShader(type)
            GLES30.glShaderSource(shader, source)
            GLES30.glCompileShader(shader)
            val compiled = IntArray(1)
            GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, compiled, 0)
            check(compiled[0] == GLES30.GL_TRUE) {
                "shader did not compile: ${GLES30.glGetShaderInfoLog(shader)}"
            }
            GLES30.glAttachShader(program, shader)
            GLES30.glDeleteShader(shader)
        }
        GLES30.glLinkProgram(program)
        val linked = IntArray(1)
        GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, linked, 0)
        check(linked[0] == GLES30.GL_TRUE) {
            "program did not link: ${GLES30.glGetProgramInfoLog(program)}"
        }
        return program
    }
}
