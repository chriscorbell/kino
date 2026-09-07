@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.test.platform.app.InstrumentationRegistry
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Checks that [LoudnessNormalizer] measures loudness the way ITU-R BS.1770-4 says to, and lifts a
 * film-like program to the target without letting a peak through.
 *
 * The expected loudness and gain come from `scripts/test-support/loudness-reference.mjs`, which
 * implements the same measurement on the host in another language and travels with the fixtures as
 * `loudness-expected.json`. Both sides synthesize the probe from the description in that file, so
 * the only thing implemented twice is the part that can be wrong: the filters, the gating, and the
 * gain law. A mistake has to be made identically in Kotlin and in JavaScript to pass.
 */
class LoudnessNormalizerTest {
    private fun expectations() =
        JSONObject(
            InstrumentationRegistry.getInstrumentation()
                .context
                .assets
                .open("loudness-expected.json")
                .use { it.readBytes().decodeToString() }
        )

    /** The probe described in the fixture, synthesized the same way the host reference does. */
    private fun probe(expected: JSONObject): Pair<FloatArray, Int> {
        val description = expected.getJSONObject("probe")
        val sampleRate = description.getInt("sampleRate")
        val frequency = description.getDouble("frequency")
        val segments = description.getJSONArray("segments")
        val samples = ArrayList<Float>()
        var frame = 0
        for (index in 0 until segments.length()) {
            val segment = segments.getJSONObject(index)
            val count = Math.round(segment.getDouble("seconds") * sampleRate).toInt()
            val amplitude = segment.getDouble("amplitude")
            repeat(count) {
                val value = (amplitude * sin(2.0 * PI * frequency * frame / sampleRate)).toFloat()
                samples.add(value)
                samples.add(value)
                frame++
            }
        }
        return samples.toFloatArray() to sampleRate
    }

    private fun run(processor: LoudnessNormalizer, samples: FloatArray, sampleRate: Int): FloatArray {
        processor.configure(AudioProcessor.AudioFormat(sampleRate, 2, C.ENCODING_PCM_FLOAT))
        processor.flush()
        val output = ArrayList<Float>(samples.size)
        // Feed it the way the sink does, in buffers rather than one long block.
        var offset = 0
        while (offset < samples.size) {
            val count = minOf(ChunkSamples, samples.size - offset)
            val input = ByteBuffer.allocateDirect(count * 4).order(ByteOrder.nativeOrder())
            for (i in offset until offset + count) input.putFloat(samples[i])
            input.flip()
            processor.queueInput(input)
            val produced = processor.output
            while (produced.remaining() >= 4) output.add(produced.float)
            offset += count
        }
        return output.toFloatArray()
    }

    @Test
    fun kWeightingMatchesTheTablePrintedInTheStandard() {
        // BS.1770-4 tables 1 and 2, the 48 kHz coefficients, transcribed from the standard.
        val standard =
            listOf(
                listOf(1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585),
                listOf(1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621),
            )
        val computed = kWeightingCoefficients(48_000)
        for ((stage, pair) in standard.zip(computed).withIndex()) {
            for ((index, values) in pair.first.zip(pair.second).withIndex()) {
                assertEquals(
                    "stage $stage coefficient $index",
                    values.first,
                    values.second,
                    1e-12,
                )
            }
        }
        // The host reference derives them the same way and must land in the same place.
        val fromHost = expectations().getJSONArray("kWeightingAt48k")
        for (stage in 0 until fromHost.length()) {
            val values = fromHost.getJSONArray(stage)
            for (index in 0 until values.length()) {
                assertEquals(values.getDouble(index), computed[stage][index], 1e-12)
            }
        }
    }

    @Test
    fun integratedLoudnessAndGainMatchTheHostReference() {
        val expected = expectations()
        val (samples, sampleRate) = probe(expected)
        val processor = LoudnessNormalizer()
        run(processor, samples, sampleRate)

        val measured = processor.measuredLufs
        assertNotNull("the probe is long enough to measure", measured)
        assertEquals(expected.getDouble("integratedLufs"), measured!!, 0.05)
        // The probe ends with eight seconds at the reference level, several times the rise
        // constant, so the applied gain has settled onto what the measurement asks for.
        assertEquals(expected.getDouble("gainDb"), processor.appliedGainDb, 0.2)
    }

    @Test
    fun gatingDiscardsSilenceAndPassagesFarBelowTheProgram() {
        val expected = expectations()
        val (samples, sampleRate) = probe(expected)
        val processor = LoudnessNormalizer()
        run(processor, samples, sampleRate)

        // Two of the probe's sixteen seconds are silent and two more sit 15 LU down. Averaging all
        // of it ungated would land several LU below the level the gates are supposed to report.
        val loudSegment = expected.getJSONObject("probe").getJSONArray("segments").getJSONObject(0)
        val referenceAmplitude = loudSegment.getDouble("amplitude")
        val ungated = 10.0 * Math.log10(
            samples.fold(0.0) { sum, value -> sum + value * value } / samples.size
        )
        val reference = 10.0 * Math.log10(referenceAmplitude * referenceAmplitude / 2.0)
        assertTrue(
            "the quiet passages must drag an ungated mean below the reference level",
            ungated < reference - 1.0,
        )
        assertTrue(
            "the gated measurement must sit at the program's own level, not the ungated mean",
            processor.measuredLufs!! > ungated + 1.0,
        )
    }

    @Test
    fun aFullScalePassageIsLimitedRatherThanWrapped() {
        val sampleRate = 48_000
        // Quiet for long enough to ask for a large boost, then full scale arrives.
        val quiet = FloatArray(sampleRate * 8 * 2)
        for (frame in 0 until sampleRate * 8) {
            val value = (0.02 * sin(2.0 * PI * 1000.0 * frame / sampleRate)).toFloat()
            quiet[frame * 2] = value
            quiet[frame * 2 + 1] = value
        }
        val loud = FloatArray(sampleRate * 2 * 2)
        for (frame in 0 until sampleRate * 2) {
            val value = sin(2.0 * PI * 1000.0 * frame / sampleRate).toFloat()
            loud[frame * 2] = value
            loud[frame * 2 + 1] = value
        }
        val processor = LoudnessNormalizer()
        run(processor, quiet, sampleRate)
        assertTrue("a quiet program must ask for boost", processor.appliedGainDb > 6.0)

        val output = run(processor, loud, sampleRate)
        for (sample in output) {
            assertTrue("$sample escaped full scale", sample >= -1f && sample <= 1f)
        }
        // The limiter takes the transition on the sample that asks for it, so the passage opens at
        // the ceiling rather than wrapping or collapsing.
        val opening = output.copyOfRange(0, sampleRate / 5 * 2)
        assertTrue(
            "the arriving peak must be held at the ceiling, not wrapped",
            opening.maxOf { abs(it) } > 0.8f,
        )
        // Then the measurement catches up with a program this loud and the gain walks down to the
        // cut bound. That is the normalizer working, so the tail is quieter by design; it must
        // still be audible rather than crushed away.
        val tail = output.copyOfRange(output.size / 2, output.size)
        assertTrue("the limited passage must stay audible", tail.maxOf { abs(it) } > 0.3f)
        assertTrue("a loud program must end up cut rather than boosted", processor.appliedGainDb < 0.0)
    }

    @Test
    fun otherLayoutsAndEncodingsAreLeftAlone() {
        val processor = LoudnessNormalizer()
        assertEquals(
            AudioProcessor.AudioFormat.NOT_SET,
            processor.configure(AudioProcessor.AudioFormat(48_000, 6, C.ENCODING_PCM_FLOAT)),
        )
        assertFalse(processor.isActive)
        assertThrows(AudioProcessor.UnhandledAudioFormatException::class.java) {
            processor.configure(AudioProcessor.AudioFormat(48_000, 2, C.ENCODING_PCM_24BIT))
        }
    }

    private companion object {
        /** A buffer near what the sink hands the chain, so block boundaries land mid-buffer. */
        const val ChunkSamples = 4096
    }
}
