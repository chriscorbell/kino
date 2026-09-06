package app.kino.tv

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.*

internal data class TvDestination(val route: String, val label: Int, val icon: Int)

internal val TvDestinations =
    listOf(
        TvDestination("home", R.string.home, R.drawable.ic_house),
        TvDestination("search", R.string.search, R.drawable.ic_search),
        TvDestination("library", R.string.library, R.drawable.ic_library),
        TvDestination("addons", R.string.addons, R.drawable.ic_blocks),
        TvDestination("settings", R.string.settings, R.drawable.ic_sliders_horizontal),
    )

internal val LocalNavigationFocus = staticCompositionLocalOf { FocusRequester.Default }

@Composable
internal fun TvNavigation(
    destination: String,
    navigationFocus: Map<String, FocusRequester>,
    contentFocus: FocusRequester,
    signedIn: Boolean,
    onNavigate: (String) -> Unit,
    onAccount: () -> Unit,
    content: @Composable () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val width by animateDpAsState(if (expanded) 208.dp else RailWidth, tween(160), label = "drawer")
    val scrim = animateFloatAsState(if (expanded) .45f else 0f, tween(160), label = "drawer-scrim")
    BackHandler(expanded) { contentFocus.requestFocus() }
    Box(Modifier.fillMaxSize()) {
        CompositionLocalProvider(
            LocalNavigationFocus provides navigationFocus.getValue(destination)
        ) {
            Box(Modifier.fillMaxSize().padding(start = RailWidth)) {
                Box(Modifier.fillMaxHeight().width(1.dp).background(KinoColors.BorderSubtle))
                content()
            }
        }
        Canvas(Modifier.fillMaxSize()) { drawRect(Background.copy(alpha = scrim.value)) }
        Column(
            Modifier.width(width)
                .fillMaxHeight()
                .background(Background)
                .clipToBounds()
                .onFocusChanged { expanded = it.hasFocus }
                .focusGroup()
                .padding(horizontal = 14.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                Modifier.height(36.dp).padding(start = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Image(
                    painterResource(R.drawable.kino_icon),
                    stringResource(R.string.app_name),
                    Modifier.size(24.dp),
                )
                if (expanded)
                    Text(
                        stringResource(R.string.app_name),
                        Modifier.padding(start = 18.dp),
                        fontSize = 22.sp,
                    )
            }
            Spacer(Modifier.height(10.dp))
            TvDestinations.forEachIndexed { index, item ->
                if (index == 3) {
                    Box(
                        Modifier.padding(start = 8.dp, top = 12.dp, bottom = 12.dp)
                            .width(28.dp)
                            .height(1.dp)
                            .background(KinoColors.Border)
                    )
                }
                RailButton(
                    stringResource(item.label),
                    item.icon,
                    expanded,
                    active = destination == item.route,
                    modifier =
                        Modifier.focusRequester(navigationFocus.getValue(item.route))
                            .focusProperties { right = contentFocus },
                    onClick = { onNavigate(item.route) },
                )
            }
            Spacer(Modifier.weight(1f))
            RailButton(
                stringResource(if (signedIn) R.string.account else R.string.sign_in),
                R.drawable.ic_user_round,
                expanded,
                false,
                Modifier.focusProperties { right = contentFocus },
                onAccount,
            )
        }
    }
}

@Composable
private fun RailButton(
    label: String,
    icon: Int,
    expanded: Boolean,
    active: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Button(
        onClick,
        modifier.fillMaxWidth().height(44.dp).semantics { contentDescription = label },
        shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
        scale = ButtonDefaults.scale(focusedScale = 1f),
        colors =
            ButtonDefaults.colors(
                containerColor = if (active) KinoColors.SurfaceActive else Background,
                contentColor = if (active) KinoColors.TextStrong else KinoColors.TextFaint,
                focusedContainerColor = KinoColors.Accent,
                focusedContentColor = KinoColors.OnAccent,
            ),
        contentPadding = PaddingValues(horizontal = 12.dp),
    ) {
        Icon(painterResource(icon), null, Modifier.size(20.dp))
        if (expanded)
            Text(label, Modifier.padding(start = 16.dp).weight(1f), fontSize = 15.sp, maxLines = 1)
    }
}
