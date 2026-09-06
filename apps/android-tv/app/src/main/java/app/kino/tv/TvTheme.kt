package app.kino.tv

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Border
import androidx.tv.material3.LocalContentColor
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.OutlinedButtonDefaults
import androidx.tv.material3.Typography
import androidx.tv.material3.darkColorScheme

internal val Background = KinoColors.Bg
internal val SurfaceColor = KinoColors.Surface
internal val Muted = KinoColors.TextMuted

// TV dimensions keep the desktop's 2:3 posters with captions readable from the couch.
internal val PosterWidth = 112.dp
internal val PosterHeight = 168.dp
internal val PageGutter = 32.dp
internal val RailWidth = 72.dp

@Composable
internal fun kinoOutlinedBorder() =
    OutlinedButtonDefaults.border(
        border = Border(BorderStroke(1.dp, KinoColors.Border), shape = RoundedCornerShape(8.dp)),
        focusedBorder = Border.None,
        pressedBorder = Border.None,
    )

private val Geist =
    FontFamily(
        Font(R.font.geist_regular, FontWeight.Normal),
        Font(R.font.geist_medium, FontWeight.Medium),
        Font(R.font.geist_semibold, FontWeight.SemiBold),
        Font(R.font.geist_bold, FontWeight.Bold),
    )

@Composable
fun KinoTheme(content: @Composable () -> Unit) {
    val base = Typography()
    MaterialTheme(
        colorScheme =
            darkColorScheme(
                primary = KinoColors.Accent,
                onPrimary = KinoColors.OnAccent,
                background = Background,
                onBackground = KinoColors.Text,
                surface = SurfaceColor,
                onSurface = KinoColors.Text,
                surfaceVariant = KinoColors.SurfaceHover,
                onSurfaceVariant = KinoColors.TextMuted,
                inverseSurface = KinoColors.Accent,
                inverseOnSurface = KinoColors.OnAccent,
                border = KinoColors.Border,
                borderVariant = KinoColors.BorderSubtle,
            ),
        typography =
            Typography(
                displayLarge = base.displayLarge.copy(fontFamily = Geist),
                displayMedium = base.displayMedium.copy(fontFamily = Geist),
                displaySmall = base.displaySmall.copy(fontFamily = Geist),
                headlineLarge = base.headlineLarge.copy(fontFamily = Geist),
                headlineMedium = base.headlineMedium.copy(fontFamily = Geist),
                headlineSmall = base.headlineSmall.copy(fontFamily = Geist),
                titleLarge = base.titleLarge.copy(fontFamily = Geist),
                titleMedium = base.titleMedium.copy(fontFamily = Geist),
                titleSmall = base.titleSmall.copy(fontFamily = Geist),
                bodyLarge = base.bodyLarge.copy(fontFamily = Geist),
                bodyMedium = base.bodyMedium.copy(fontFamily = Geist),
                bodySmall = base.bodySmall.copy(fontFamily = Geist),
                labelLarge = base.labelLarge.copy(fontFamily = Geist),
                labelMedium = base.labelMedium.copy(fontFamily = Geist),
                labelSmall = base.labelSmall.copy(fontFamily = Geist),
            ),
    ) {
        CompositionLocalProvider(LocalContentColor provides KinoColors.Text, content = content)
    }
}
