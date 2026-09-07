@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.tan

/**
 * Brings a film mix up to a consistent listening level on the stereo path.
 *
 * A theatrical mix anchors dialogue far below web video so it can keep headroom for peaks a cinema
 * can reproduce. Measured on the Shield, a TrueHD film ran about 12 dB below a speech-led YouTube
 * clip through the same output at the same volume. Streaming services never hit this, because they
 * ship a separately mastered stereo track rather than folding the theatrical mix at playback. Kino
 * gets one program from an add-on and no stereo alternative, so the only place it can even the
 * levels out is here.
 *
 * The measurement is ITU-R BS.1770-4: K-weighting, 400 ms blocks, and the absolute and relative
 * gates, integrated across everything played so far. Integrating over the program rather than a
 * sliding window is what keeps the gain still. A window would ride scene to scene and turn the
 * film's own dynamics into pumping, which is the opposite of the goal.
 *
 * Gain alone cannot close a 12 dB gap, since a film mix already reaches for full scale in its loud
 * scenes, so a peak limiter follows it. Attack is instantaneous because there is no look-ahead in a
 * streaming pipeline; release is slow enough not to breathe.
 */
class LoudnessNormalizer(
    private val targetLufs: Double = TargetLufs,
    private val maxBoostDb: Double = MaxBoostDb,
    private val maxCutDb: Double = MaxCutDb,
) : BaseAudioProcessor() {
    private var floatInput = false
    private var blockFrames = 0
    private var framesInBlock = 0
    private var blockSum = 0.0

    private var weighting = emptyArray<KWeighting>()
    private val binnedPower = DoubleArray(HistogramBins)
    private val binnedCounts = IntArray(HistogramBins)
    private var gatedBlocks = 0

    private var gainDb = 0.0
    private var desiredGainDb = 0.0
    private var limiterGain = 1.0
    private var riseCoefficient = 0.0
    private var fallCoefficient = 0.0
    private var releaseCoefficient = 0.0

    /** The gain currently applied, in dB. Exposed so a gate can read the converged value. */
    val appliedGainDb: Double
        get() = gainDb

    /** The integrated loudness measured so far, or null before enough gated blocks exist. */
    val measuredLufs: Double?
        get() = if (gatedBlocks >= MinimumBlocks) integratedLufs() else null

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        val encoding = inputAudioFormat.encoding
        if (encoding != C.ENCODING_PCM_16BIT && encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        // Only the folded stereo pair is normalized. Anything else reaches the sink untouched.
        if (inputAudioFormat.channelCount != 2) return AudioProcessor.AudioFormat.NOT_SET
        floatInput = encoding == C.ENCODING_PCM_FLOAT
        val rate = inputAudioFormat.sampleRate
        weighting = Array(2) { KWeighting(rate) }
        blockFrames = (rate * BlockSeconds).toInt()
        riseCoefficient = 1.0 - exp(-1.0 / (rate * RiseSeconds))
        fallCoefficient = 1.0 - exp(-1.0 / (rate * FallSeconds))
        releaseCoefficient = 1.0 - exp(-1.0 / (rate * LimiterReleaseSeconds))
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val bytesPerSample = if (floatInput) 4 else 2
        val frames = inputBuffer.remaining() / (2 * bytesPerSample)
        val output = replaceOutputBuffer(frames * 2 * bytesPerSample)
        repeat(frames) {
            val left = if (floatInput) inputBuffer.float else inputBuffer.short / 32768f
            val right = if (floatInput) inputBuffer.float else inputBuffer.short / 32768f

            // Measure the program as it arrives, before any gain of ours is applied.
            val weightedLeft = weighting[0].process(left.toDouble())
            val weightedRight = weighting[1].process(right.toDouble())
            blockSum += weightedLeft * weightedLeft + weightedRight * weightedRight
            if (++framesInBlock >= blockFrames) closeBlock()

            val coefficient = if (desiredGainDb > gainDb) riseCoefficient else fallCoefficient
            gainDb += (desiredGainDb - gainDb) * coefficient
            val gain = 10.0.pow(gainDb / 20.0).toFloat()
            var outLeft = left * gain
            var outRight = right * gain

            // No look-ahead, so the limiter takes any needed reduction on the very sample that
            // asks for it and only recovers slowly.
            val peak = max(abs(outLeft), abs(outRight)).toDouble()
            val needed = if (peak > LimiterCeiling) LimiterCeiling / peak else 1.0
            limiterGain =
                if (needed < limiterGain) needed
                else limiterGain + (needed - limiterGain) * releaseCoefficient
            outLeft *= limiterGain.toFloat()
            outRight *= limiterGain.toFloat()

            if (floatInput) {
                output.putFloat(softClip(outLeft))
                output.putFloat(softClip(outRight))
            } else {
                output.putShort((softClip(outLeft) * 32767f).toInt().toShort())
                output.putShort((softClip(outRight) * 32767f).toInt().toShort())
            }
        }
        output.flip()
    }

    override fun onFlush() {
        // A seek keeps the loudness already measured, since it is a property of the program rather
        // than of the position, but the filters and the limiter start clean.
        for (channel in weighting) channel.reset()
        blockSum = 0.0
        framesInBlock = 0
        limiterGain = 1.0
    }

    override fun onReset() {
        onFlush()
        binnedPower.fill(0.0)
        binnedCounts.fill(0)
        gatedBlocks = 0
        gainDb = 0.0
        desiredGainDb = 0.0
    }

    private fun closeBlock() {
        val power = blockSum / blockFrames
        blockSum = 0.0
        framesInBlock = 0
        if (power <= 0.0) return
        val loudness = LoudnessOffset + 10.0 * log10(power)
        if (loudness <= AbsoluteGateLufs) return
        val bin = binFor(loudness)
        binnedPower[bin] += power
        binnedCounts[bin]++
        gatedBlocks++
        if (gatedBlocks >= MinimumBlocks) {
            desiredGainDb = (targetLufs - integratedLufs()).coerceIn(maxCutDb, maxBoostDb)
        }
    }

    /** BS.1770 gated loudness: the absolute gate on the way in, the relative gate applied here. */
    private fun integratedLufs(): Double {
        var power = 0.0
        var count = 0
        for (bin in 0 until HistogramBins) {
            power += binnedPower[bin]
            count += binnedCounts[bin]
        }
        if (count == 0) return AbsoluteGateLufs
        val relativeGate = LoudnessOffset + 10.0 * log10(power / count) - RelativeGateLu
        var gatedPower = 0.0
        var gatedCount = 0
        for (bin in 0 until HistogramBins) {
            if (binnedCounts[bin] == 0 || loudnessOf(bin) <= relativeGate) continue
            gatedPower += binnedPower[bin]
            gatedCount += binnedCounts[bin]
        }
        if (gatedCount == 0) return LoudnessOffset + 10.0 * log10(power / count)
        return LoudnessOffset + 10.0 * log10(gatedPower / gatedCount)
    }

    private companion object {
        /** Between a film's own level and web video, close enough that the volume knob can stay put. */
        const val TargetLufs = -19.0
        const val MaxBoostDb = 12.0
        const val MaxCutDb = -6.0

        const val BlockSeconds = 0.4
        const val LoudnessOffset = -0.691
        const val AbsoluteGateLufs = -70.0
        const val RelativeGateLu = 10.0
        /** 3.2 seconds of gated audio before the first gain, so an opening line cannot set it. */
        const val MinimumBlocks = 8

        // The limiter below is the fast path, so program gain never has to chase a scene. Both
        // constants are slow enough that the film's own dynamics stay dynamics rather than pumping,
        // with the fall the quicker of the two so an overshoot is given back sooner than it was
        // taken.
        const val RiseSeconds = 1.5
        const val FallSeconds = 1.0
        const val LimiterReleaseSeconds = 0.15
        /** -1 dBFS, leaving room for the reconstruction filter in whatever plays this back. */
        const val LimiterCeiling = 0.8913

        const val HistogramFloor = -70.0
        const val HistogramStep = 0.1
        const val HistogramBins = 800

        fun binFor(loudness: Double) =
            (((loudness - HistogramFloor) / HistogramStep).toInt()).coerceIn(0, HistogramBins - 1)

        fun loudnessOf(bin: Int) = HistogramFloor + (bin + 0.5) * HistogramStep
    }
}

/**
 * The K-weighting coefficients for a sample rate, as [shelf, high-pass], each b0 b1 b2 a1 a2.
 *
 * Public so the gate can hold them against the table printed in the standard.
 */
fun kWeightingCoefficients(sampleRate: Int): List<List<Double>> = KWeighting(sampleRate).coefficients()

/**
 * The two BS.1770-4 K-weighting stages: a high shelf for the head effect, then the RLB high-pass.
 *
 * Written as the standard's filter parameters rather than its tabulated coefficients so any sample
 * rate works. At 48 kHz this reproduces the table in the standard to machine precision, which
 * `LoudnessNormalizerTest` asserts.
 */
internal class KWeighting(sampleRate: Int) {
    private val shelf: Biquad
    private val highPass: Biquad

    init {
        val shelfK = tan(PI * ShelfFrequency / sampleRate)
        val vh = 10.0.pow(ShelfGainDb / 20.0)
        val vb = vh.pow(ShelfVbExponent)
        val shelfA0 = 1.0 + shelfK / ShelfQ + shelfK * shelfK
        shelf =
            Biquad(
                (vh + vb * shelfK / ShelfQ + shelfK * shelfK) / shelfA0,
                2.0 * (shelfK * shelfK - vh) / shelfA0,
                (vh - vb * shelfK / ShelfQ + shelfK * shelfK) / shelfA0,
                2.0 * (shelfK * shelfK - 1.0) / shelfA0,
                (1.0 - shelfK / ShelfQ + shelfK * shelfK) / shelfA0,
            )
        val passK = tan(PI * HighPassFrequency / sampleRate)
        val passA0 = 1.0 + passK / HighPassQ + passK * passK
        highPass =
            Biquad(
                1.0,
                -2.0,
                1.0,
                2.0 * (passK * passK - 1.0) / passA0,
                (1.0 - passK / HighPassQ + passK * passK) / passA0,
            )
    }

    fun process(sample: Double) = highPass.process(shelf.process(sample))

    fun reset() {
        shelf.reset()
        highPass.reset()
    }

    /** The filter coefficients, for the gate that compares them against the standard's table. */
    fun coefficients() = listOf(shelf.coefficients(), highPass.coefficients())

    private companion object {
        const val ShelfFrequency = 1681.974450955533
        const val ShelfGainDb = 3.999843853973347
        const val ShelfQ = 0.7071752369554196
        const val ShelfVbExponent = 0.4996667741545416
        const val HighPassFrequency = 38.13547087602444
        const val HighPassQ = 0.5003270373238773
    }
}

internal class Biquad(
    private val b0: Double,
    private val b1: Double,
    private val b2: Double,
    private val a1: Double,
    private val a2: Double,
) {
    private var x1 = 0.0
    private var x2 = 0.0
    private var y1 = 0.0
    private var y2 = 0.0

    fun process(x: Double): Double {
        val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1
        x1 = x
        y2 = y1
        y1 = y
        return y
    }

    fun reset() {
        x1 = 0.0
        x2 = 0.0
        y1 = 0.0
        y2 = 0.0
    }

    fun coefficients() = listOf(b0, b1, b2, a1, a2)
}
