@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Test

/** The downmix keeps dialogue loud, never wraps, and leaves stereo alone. */
class StereoDownmixTest {
    private fun mix(channels: Int, vararg frames: FloatArray): FloatArray {
        val processor = StereoDownmixProcessor()
        processor.configure(AudioProcessor.AudioFormat(48_000, channels, C.ENCODING_PCM_FLOAT))
        processor.flush()
        val input = ByteBuffer.allocateDirect(frames.size * channels * 4).order(ByteOrder.nativeOrder())
        for (frame in frames) for (sample in frame) input.putFloat(sample)
        input.flip()
        processor.queueInput(input)
        val output = processor.output
        return FloatArray(output.remaining() / 4) { output.float }
    }

    @Test
    fun centreDialogueKeepsItsFullWeightInBothChannels() {
        // Only the centre channel carries signal, at 0.5 full scale.
        val out = mix(6, floatArrayOf(0f, 0f, 0.5f, 0f, 0f, 0f))
        // 0.5 * 0.707: the ITU fold-in, with no extra headroom cut on top.
        assertEquals(0.354f, out[0], 0.005f)
        assertEquals(0.354f, out[1], 0.005f)
    }

    @Test
    fun frontChannelsPassAtUnityAndLfeIsDropped() {
        val out = mix(6, floatArrayOf(0.6f, -0.4f, 0f, 1f, 0f, 0f))
        assertEquals(0.6f, out[0], 0.001f)
        assertEquals(-0.4f, out[1], 0.001f)
    }

    @Test
    fun everyChannelPeakingIsLimitedRatherThanWrapped() {
        val out = mix(6, floatArrayOf(1f, 1f, 1f, 1f, 1f, 1f), floatArrayOf(-1f, -1f, -1f, -1f, -1f, -1f))
        // The curve approaches full scale and may round to it in float, but never beyond.
        for (sample in out) assertTrue("$sample must stay inside full scale", sample >= -1f && sample <= 1f)
        assertTrue("a full-scale peak must still come out loud", out[0] > 0.9f)
        assertTrue(out[2] < -0.9f)
    }

    @Test
    fun sixteenBitInputMatchesTheFloatPath() {
        val processor = StereoDownmixProcessor()
        processor.configure(AudioProcessor.AudioFormat(48_000, 6, C.ENCODING_PCM_16BIT))
        processor.flush()
        val input = ByteBuffer.allocateDirect(6 * 2).order(ByteOrder.nativeOrder())
        for (sample in floatArrayOf(0f, 0f, 0.5f, 0f, 0f, 0f)) input.putShort((sample * 32767).toInt().toShort())
        input.flip()
        processor.queueInput(input)
        val output = processor.output
        assertEquals(0.354f, output.short / 32768f, 0.005f)
        assertEquals(0.354f, output.short / 32768f, 0.005f)
    }

    @Test
    fun stereoAndUnknownLayoutsAreLeftAlone() {
        val processor = StereoDownmixProcessor()
        assertEquals(
            AudioProcessor.AudioFormat.NOT_SET,
            processor.configure(AudioProcessor.AudioFormat(48_000, 2, C.ENCODING_PCM_FLOAT)),
        )
        assertFalse(processor.isActive)
        assertEquals(
            AudioProcessor.AudioFormat.NOT_SET,
            processor.configure(AudioProcessor.AudioFormat(48_000, 9, C.ENCODING_PCM_FLOAT)),
        )
    }
}
