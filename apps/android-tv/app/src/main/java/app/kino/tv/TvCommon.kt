@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.*

@Composable
internal fun PageTitle(title: Int) {
    Text(
        stringResource(title),
        Modifier.padding(horizontal = PageGutter),
        fontSize = 30.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-.6).sp,
    )
}

@Composable
internal fun StatusText(message: Int) {
    Text(
        stringResource(message),
        Modifier.padding(horizontal = PageGutter, vertical = 12.dp),
        color = Muted,
    )
}

@Composable
internal fun RetryRow(onRetry: () -> Unit) {
    Button(onRetry, Modifier.padding(horizontal = PageGutter, vertical = 12.dp)) {
        Text(stringResource(R.string.retry))
    }
}

internal val RowShape = RoundedCornerShape(8.dp)

@Composable
internal fun rowColors() =
    ClickableSurfaceDefaults.colors(
        containerColor = Background,
        focusedContainerColor = SurfaceColor,
    )

@Composable
internal fun rowBorder() =
    ClickableSurfaceDefaults.border(
        focusedBorder =
            Border(
                androidx.compose.foundation.BorderStroke(2.dp, KinoColors.TextStrong),
                shape = RowShape,
            )
    )
