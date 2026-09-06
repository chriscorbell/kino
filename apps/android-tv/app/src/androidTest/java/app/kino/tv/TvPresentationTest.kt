@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.StyleSpan
import androidx.media3.common.Player
import androidx.media3.common.text.Cue
import androidx.media3.ui.CaptionStyleCompat
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

/**
 * The TV presentation shows outlined captions with nothing filled behind them,
 * and offers no playback-rate control.
 */
class TvPresentationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test
    fun styleFillsNothingAndOutlinesGlyphs() {
        assertEquals(Color.TRANSPARENT, outlinedCaptionStyle.backgroundColor)
        assertEquals(Color.TRANSPARENT, outlinedCaptionStyle.windowColor)
        assertEquals(CaptionStyleCompat.EDGE_TYPE_OUTLINE, outlinedCaptionStyle.edgeType)
        assertEquals(Color.BLACK, outlinedCaptionStyle.edgeColor)
        assertEquals(Color.WHITE, outlinedCaptionStyle.foregroundColor)
    }

    @Test
    fun authoredFillsAreRemovedAndTextStylingSurvives() {
        val text = SpannableString("Kino boxed caption")
        text.setSpan(
            BackgroundColorSpan(Color.BLACK),
            0,
            text.length,
            Spanned.SPAN_INCLUSIVE_EXCLUSIVE,
        )
        text.setSpan(
            StyleSpan(android.graphics.Typeface.ITALIC),
            0,
            4,
            Spanned.SPAN_INCLUSIVE_EXCLUSIVE,
        )
        val cue = Cue.Builder().setText(text).setWindowColor(Color.BLACK).build()

        val cleaned = withoutCaptionFills(cue)

        assertFalse("A window colour paints a rectangle", cleaned.windowColorSet)
        val cleanedText = cleaned.text as Spanned
        assertEquals("Kino boxed caption", cleanedText.toString())
        assertEquals(
            0,
            cleanedText.getSpans(0, cleanedText.length, BackgroundColorSpan::class.java).size,
        )
        assertEquals(
            "Italics and other text styling must survive",
            1,
            cleanedText.getSpans(0, cleanedText.length, StyleSpan::class.java).size,
        )
    }

    @Test
    fun plainCuesAreLeftAlone() {
        val cue = Cue.Builder().setText("Kino fixture subtitles").build()
        assertSame(cue, withoutCaptionFills(cue))
    }

    @Test
    fun noPlaybackRateControlIsOffered() {
        withPresentedPlayer { presented ->
            val commands = presented.availableCommands
            // Media3's control view lists its Speed row only for this command.
            assertFalse(
                "The TV presentation must not offer a playback rate",
                commands.contains(Player.COMMAND_SET_SPEED_AND_PITCH),
            )
            // These two gate the settings button's audio-track row, so dropping
            // Speed must not leave that button with nothing behind it.
            assertTrue(commands.contains(Player.COMMAND_GET_TRACKS))
            assertTrue(commands.contains(Player.COMMAND_SET_TRACK_SELECTION_PARAMETERS))
            assertTrue(commands.contains(Player.COMMAND_PLAY_PAUSE))
        }
    }

    @Test
    fun playbackStaysAtNormalRate() {
        withPresentedPlayer { presented ->
            presented.setPlaybackSpeed(2f)
            assertEquals(
                "Playback runs at the normal rate",
                1f,
                presented.playbackParameters.speed,
                0f,
            )
        }
    }

    /** Media3 players are single-threaded; build, assert, and release together. */
    private fun withPresentedPlayer(block: (TvPresentationPlayer) -> Unit) {
        var failure: Throwable? = null
        instrumentation.runOnMainSync {
            val player = createTvPlayer(context, HardwareRenderers(context))
            try {
                block(TvPresentationPlayer(player))
            } catch (thrown: Throwable) {
                failure = thrown
            } finally {
                player.release()
            }
        }
        failure?.let { throw it }
    }
}
