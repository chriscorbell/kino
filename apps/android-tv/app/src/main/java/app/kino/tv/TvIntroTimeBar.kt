@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import androidx.compose.ui.graphics.toArgb
import androidx.media3.ui.DefaultTimeBar

/** Draws the trusted intro range on the same scale as Media3's playback timeline. */
class TvIntroTimeBar
@JvmOverloads
constructor(context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = 0) :
    DefaultTimeBar(context, attrs, defStyleAttr) {
    private val markerPaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = KinoColors.Accent.toArgb() }
    private var marker: TvIntroMarker? = null
    private var durationMs = 0L

    internal fun setIntro(value: TvIntroMarker?, durationMs: Long) {
        if (marker == value && this.durationMs == durationMs) return
        marker = value
        this.durationMs = durationMs
        invalidate()
    }

    internal fun introMarker(): TvIntroMarker? = marker

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val current = marker ?: return
        if (durationMs <= 0 || width <= paddingLeft + paddingRight) return
        val available = width - paddingLeft - paddingRight
        val left = paddingLeft + available * current.startMs.toFloat() / durationMs
        val right = paddingLeft + available * current.endMs.toFloat() / durationMs
        val half = resources.displayMetrics.density * 3f
        canvas.drawRoundRect(
            left,
            height / 2f - half,
            right,
            height / 2f + half,
            half,
            half,
            markerPaint,
        )
    }
}
