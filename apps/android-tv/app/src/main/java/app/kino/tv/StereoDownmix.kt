@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.tanh

/**
 * Kino's stereo downmix, applied inside the player instead of leaving surround
 * PCM to the platform mixer.
 *
 * The platform downmix protects against clipping with a fixed gain cut of
 * about -7.7 dB and puts the centre channel at -3 dB, which is why surround
 * films sound quiet on a stereo set. This mix keeps dialogue at its full
 * weight and applies no static cut; the rare moments when every channel
 * peaks at once go through a soft limiter instead of being pre-attenuated
 * all the time.
 *
 * Front pairs pass at unity, the centre and the surround pairs fold in at
 * -3 dB (0.707, the ITU-R BS.775 values), and the LFE channel is dropped, as
 * the standard mix does; small speakers cannot reproduce it and it muddies
 * the rest.
 */
class StereoDownmixProcessor : BaseAudioProcessor() {
    private var inputChannels = 0
    private var left = FloatArray(0)
    private var right = FloatArray(0)
    private var floatInput = false

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        val encoding = inputAudioFormat.encoding
        if (encoding != C.ENCODING_PCM_16BIT && encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        val weights = weightsFor(inputAudioFormat.channelCount) ?: return AudioProcessor.AudioFormat.NOT_SET
        inputChannels = inputAudioFormat.channelCount
        left = weights.first
        right = weights.second
        floatInput = encoding == C.ENCODING_PCM_FLOAT
        return AudioProcessor.AudioFormat(inputAudioFormat.sampleRate, 2, encoding)
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val bytesPerSample = if (floatInput) 4 else 2
        val frames = inputBuffer.remaining() / (inputChannels * bytesPerSample)
        val output = replaceOutputBuffer(frames * 2 * bytesPerSample)
        repeat(frames) {
            var l = 0f
            var r = 0f
            for (channel in 0 until inputChannels) {
                val sample =
                    if (floatInput) inputBuffer.float
                    else inputBuffer.short / 32768f
                l += sample * left[channel]
                r += sample * right[channel]
            }
            if (floatInput) {
                output.putFloat(limit(l))
                output.putFloat(limit(r))
            } else {
                output.putShort((limit(l) * 32767f).toInt().toShort())
                output.putShort((limit(r) * 32767f).toInt().toShort())
            }
        }
        output.flip()
    }

    private companion object {
        const val SIDE = 0.7071f
        /** Above this the curve bends, so a summed peak lands short of full scale. */
        const val KNEE = 0.8f

        /** Soft limiter: linear to the knee, then a tanh curve that approaches but never exceeds 1. */
        fun limit(sample: Float): Float {
            val magnitude = abs(sample)
            if (magnitude <= KNEE) return sample
            val limited = KNEE + (1f - KNEE) * tanh((magnitude - KNEE) / (1f - KNEE))
            return if (sample < 0) -limited else limited
        }

        /**
         * Per-channel weights into left and right for the channel orders the
         * decoders emit: FL FR FC LFE BL BR SL SR, with the shorter layouts
         * being prefixes and pairs of that order.
         */
        fun weightsFor(channels: Int): Pair<FloatArray, FloatArray>? =
            when (channels) {
                3 -> FloatArray(3).let { l -> FloatArray(3).let { r ->
                    l[0] = 1f; r[1] = 1f; l[2] = SIDE; r[2] = SIDE
                    l to r
                } }
                4 -> FloatArray(4).let { l -> FloatArray(4).let { r ->
                    l[0] = 1f; r[1] = 1f; l[2] = SIDE; r[3] = SIDE
                    l to r
                } }
                5 -> FloatArray(5).let { l -> FloatArray(5).let { r ->
                    l[0] = 1f; r[1] = 1f; l[2] = SIDE; r[2] = SIDE; l[3] = SIDE; r[4] = SIDE
                    l to r
                } }
                6 -> FloatArray(6).let { l -> FloatArray(6).let { r ->
                    l[0] = 1f; r[1] = 1f; l[2] = SIDE; r[2] = SIDE; l[4] = SIDE; r[5] = SIDE
                    l to r
                } }
                7 -> FloatArray(7).let { l -> FloatArray(7).let { r ->
                    l[0] = 1f; r[1] = 1f; l[2] = SIDE; r[2] = SIDE
                    l[4] = SIDE; r[5] = SIDE; l[6] = SIDE; r[6] = SIDE
                    l to r
                } }
                8 -> FloatArray(8).let { l -> FloatArray(8).let { r ->
                    l[0] = 1f; r[1] = 1f; l[2] = SIDE; r[2] = SIDE
                    l[4] = SIDE; r[5] = SIDE; l[6] = SIDE; r[7] = SIDE
                    l to r
                } }
                else -> null
            }
    }
}
