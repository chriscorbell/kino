@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.*

@Composable
internal fun SearchScreen(
    query: String,
    onQuery: (String) -> Unit,
    shelves: List<Shelf>,
    onOpen: (Media) -> Unit,
) {
    var inputFocused by remember { mutableStateOf(false) }
    var keyboardRequested by remember { mutableStateOf(false) }
    // The String overload ignores showKeyboardOnFocus and lets the IME capture remote keys.
    val input = rememberTextFieldState(query)
    val currentOnQuery by rememberUpdatedState(onQuery)
    LaunchedEffect(query) {
        if (input.text.toString() != query) input.setTextAndPlaceCursorAtEnd(query)
    }
    LaunchedEffect(input) { snapshotFlow { input.text.toString() }.collect { currentOnQuery(it) } }
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val navigation = LocalNavigationFocus.current
    val groups =
        remember(query, shelves) { if (query.isBlank()) emptyList() else groupedMedia(shelves) }
    Column(
        Modifier.fillMaxSize().padding(top = 28.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        PageTitle(R.string.search)
        BasicTextField(
            input,
            Modifier.padding(horizontal = PageGutter)
                .fillMaxWidth()
                .onFocusChanged {
                    inputFocused = it.isFocused
                    if (!it.isFocused) keyboardRequested = false
                }
                .onPreviewKeyEvent {
                    if (it.type != KeyEventType.KeyDown) false
                    else
                        when (it.key) {
                            Key.DirectionDown -> {
                                keyboard?.hide()
                                focusManager.moveFocus(FocusDirection.Down)
                            }
                            Key.DirectionLeft ->
                                if (query.isEmpty()) navigation.requestFocus() else false
                            Key.DirectionCenter,
                            Key.Enter -> {
                                keyboardRequested = true
                                keyboard?.show()
                                true
                            }
                            else -> false
                        }
                }
                .border(
                    2.dp,
                    if (inputFocused) KinoColors.TextStrong else KinoColors.Border,
                    RoundedCornerShape(8.dp),
                )
                .background(SurfaceColor, RoundedCornerShape(8.dp))
                .padding(16.dp),
            textStyle =
                MaterialTheme.typography.bodyLarge.copy(color = KinoColors.Text, fontSize = 18.sp),
            lineLimits = TextFieldLineLimits.SingleLine,
            keyboardOptions =
                KeyboardOptions(
                    imeAction = ImeAction.Search,
                    showKeyboardOnFocus = keyboardRequested,
                ),
            onKeyboardAction = {
                keyboard?.hide()
                focusManager.moveFocus(FocusDirection.Down)
            },
            cursorBrush = androidx.compose.ui.graphics.SolidColor(KinoColors.TextStrong),
            decorator = { inner ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(
                        painterResource(R.drawable.ic_search),
                        null,
                        Modifier.size(20.dp),
                        tint = Muted,
                    )
                    Box(Modifier.weight(1f)) {
                        if (query.isEmpty())
                            Text(
                                stringResource(R.string.search_hint),
                                color = Muted,
                                fontSize = 18.sp,
                            )
                        inner()
                    }
                }
            },
        )
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(24.dp),
            contentPadding = PaddingValues(bottom = 40.dp),
        ) {
            items(groups, key = { it.first }) { (label, media) ->
                MediaShelf("search-$label", stringResource(label), media, onOpen)
            }
            if (query.isNotBlank() && groups.isEmpty())
                item {
                    StatusText(
                        if (shelves.isEmpty() || shelves.any { it.loading }) R.string.loading
                        else R.string.search_empty
                    )
                }
        }
    }
}
