@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.StyleSpan
import androidx.media3.common.text.Cue
import androidx.media3.ui.CaptionStyleCompat
import org.junit.Assert.*
import org.junit.Test

/** Captions must reach the screen outlined, with nothing filled behind them. */
class CaptionStyleTest {
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
        text.setSpan(BackgroundColorSpan(Color.BLACK), 0, text.length, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
        text.setSpan(StyleSpan(android.graphics.Typeface.ITALIC), 0, 4, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
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
}
