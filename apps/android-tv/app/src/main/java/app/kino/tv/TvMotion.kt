package app.kino.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.graphicsLayer

@Composable
internal fun Modifier.quickFocusScale(): Modifier {
    var focused by remember { mutableStateOf(false) }
    val scale = animateFloatAsState(if (focused) 1.04f else 1f, tween(140), label = "poster-focus")
    return onFocusChanged { focused = it.isFocused }
        .graphicsLayer {
            scaleX = scale.value
            scaleY = scale.value
        }
}

@Composable
internal fun Modifier.pageTransition(page: Any): Modifier {
    val opacity = remember { Animatable(1f) }
    // Only the current page exists, so outgoing content cannot retain remote focus.
    // A new destination cancels the previous fade instead of waiting for it.
    LaunchedEffect(page) {
        opacity.snapTo(0f)
        opacity.animateTo(1f, tween(160))
    }
    return graphicsLayer { alpha = opacity.value }
}
