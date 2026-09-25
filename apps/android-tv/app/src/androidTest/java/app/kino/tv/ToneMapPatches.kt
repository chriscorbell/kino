package app.kino.tv

import android.util.Log
import kotlin.math.abs
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

/**
 * Compares rendered pixels against the patches `scripts/test-support/hdr-probe-fixture.mjs`
 * computes with the host tone-map reference, shared by the shader test and the playback test.
 *
 * [pixel] returns the rendered R, G and B at a fixture coordinate as display-encoded values in
 * 0..1. The structural assertions after the per-channel comparison carry no tolerance at all and
 * are what catch a wrong matrix, a missing EOTF or an inverted curve.
 */
internal fun verifyToneMappedPatches(
    patches: JSONArray,
    tolerance: Float,
    neutralSpread: Float,
    pixel: (x: Int, y: Int) -> List<Float>,
) {
    var worst = 0.0
    var worstLabel = ""
    val ramp = mutableListOf<Float>()
    for (i in 0 until patches.length()) {
        val patch = patches.getJSONObject(i)
        val band = patch.getString("band")
        val luma = patch.getInt("luma")
        val rendered = pixel(patch.getInt("x"), patch.getInt("y"))
        val want = patch.getJSONArray("expected")
        if (band != "B") {
            val spread = rendered.max() - rendered.min()
            assertTrue(
                "$band luma $luma is not neutral, spread $spread: $rendered",
                spread < neutralSpread,
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
                tolerance,
            )
        }
        if (band == "A") ramp.add(rendered[1])
    }
    Log.i("KinoToneMap", "worst channel error ${"%.4f".format(worst)} at $worstLabel")
    assertEquals("video black must render as black", 0f, ramp.first(), 0.01f)
    assertEquals("the brightest step must clip to white", 1f, ramp.last(), 0.01f)
    for (i in 1 until ramp.size) {
        assertTrue(
            "the ramp must never fall: step $i went ${ramp[i - 1]} -> ${ramp[i]}",
            ramp[i] >= ramp[i - 1] - 0.001f,
        )
    }
}
