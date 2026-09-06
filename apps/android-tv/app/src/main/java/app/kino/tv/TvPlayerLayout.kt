@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.ui.graphics.toArgb
import androidx.media3.common.Player
import androidx.media3.ui.PlayerView

/** Actions remain reachable when Media3 hides its controls and consumes the first D-pad press. */
internal class TvPlayerLayout(context: Context, player: Player) : FrameLayout(context) {
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private val offer =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            visibility = GONE
            setPadding(dp(20), dp(16), dp(20), dp(16))
            background =
                GradientDrawable().apply {
                    setColor(KinoColors.Bg.copy(alpha = .94f).toArgb())
                    cornerRadius = dp(12).toFloat()
                }
        }
    val playerView: PlayerView = tvPlayerView(context, player) { offer.hasFocus() }
    private val title =
        TextView(context).apply {
            typeface = resources.getFont(R.font.geist_semibold)
            textSize = 18f
            setTextColor(KinoColors.Text.toArgb())
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
    private val choose =
        Button(context).apply {
            typeface = resources.getFont(R.font.geist_medium)
            textSize = 16f
            isAllCaps = false
            defaultFocusHighlightEnabled = false
            text = context.getString(R.string.choose_source)
            minHeight = dp(48)
            minimumHeight = dp(48)
            setPadding(dp(16), 0, dp(16), 0)
            setOnFocusChangeListener { _, focused ->
                styleButton(focused)
                animate()
                    .scaleX(if (focused) 1.04f else 1f)
                    .scaleY(if (focused) 1.04f else 1f)
                    .setDuration(140)
                    .start()
            }
        }

    init {
        addView(playerView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        offer.addView(
            TextView(context).apply {
                text = context.getString(R.string.up_next)
                textSize = 14f
                typeface = resources.getFont(R.font.geist_medium)
                setTextColor(KinoColors.TextMuted.toArgb())
                isAccessibilityHeading = true
            }
        )
        offer.addView(
            title,
            LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(6)
                bottomMargin = dp(16)
            },
        )
        offer.addView(choose, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, dp(48)))
        addView(
            offer,
            LayoutParams(dp(320), LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.END).apply {
                bottomMargin = dp(148)
                marginEnd = dp(40)
            },
        )
        styleButton(false)
    }

    private fun styleButton(focused: Boolean) {
        choose.setTextColor((if (focused) KinoColors.OnAccent else KinoColors.Text).toArgb())
        choose.background =
            GradientDrawable().apply {
                setColor((if (focused) KinoColors.Accent else KinoColors.SurfaceHover).toArgb())
                cornerRadius = dp(8).toFloat()
                if (!focused) setStroke(dp(1), KinoColors.Border.toArgb())
            }
    }

    fun showUpNext(episodeTitle: String?, onChoose: () -> Unit) {
        choose.setOnClickListener { onChoose() }
        if (episodeTitle == null) {
            val restore = offer.hasFocus()
            offer.animate().cancel()
            offer.visibility = GONE
            if (restore) focusControls()
        } else {
            title.text = episodeTitle
            if (offer.visibility != VISIBLE) {
                offer.alpha = 0f
                offer.visibility = VISIBLE
                offer.animate().alpha(1f).setDuration(150).start()
            }
        }
    }

    private fun focusControls() {
        playerView.showController()
        val play = playerView.findViewById<View>(androidx.media3.ui.R.id.exo_play_pause)
        if (play?.requestFocus() != true) playerView.requestFocus()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (offer.hasFocus() && playerView.dispatchMediaKeyEvent(event)) return true
        if (event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN && offer.hasFocus()) {
            if (event.action == KeyEvent.ACTION_DOWN) focusControls()
            return true
        }
        if (
            event.keyCode == KeyEvent.KEYCODE_DPAD_UP &&
                offer.visibility == VISIBLE &&
                playerView.hasFocus() &&
                playerView.isControllerFullyVisible
        ) {
            if (event.action == KeyEvent.ACTION_DOWN) choose.requestFocus()
            return true
        }
        return super.dispatchKeyEvent(event)
    }
}
