@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.layout.LazyLayoutCacheWindow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.tv.material3.*
import com.stremio.core.models.LibraryWithFilters
import com.stremio.core.types.addon.ResourceRequest

/**
 * Posters in rows, composed a row at a time. Asks for more once the last loaded row is within a
 * screen of view, so a long catalog or library pages in as the remote moves down it.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun PosterGrid(
    items: List<Media>,
    focusPrefix: String,
    onOpen: (Media) -> Unit,
    modifier: Modifier = Modifier,
    footer: @Composable () -> Unit = {},
    onNearEnd: () -> Unit = {},
) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val columns =
            ((maxWidth - PageGutter * 2 + 16.dp) / (PosterWidth + 16.dp)).toInt().coerceAtLeast(1)
        // A vertical focus move brings in a whole row. Composing that row together avoids the
        // grid's repeated per-cell work on the Shield.
        val rows = remember(items, columns) { items.chunked(columns) }
        // A different catalog, genre or sort starts from the top; appended pages keep the place.
        val state =
            key(items.firstOrNull()?.let { "${it.type}:${it.id}" }) {
                rememberLazyListState(
                    cacheWindow =
                        remember { LazyLayoutCacheWindow(aheadFraction = 1f, behindFraction = 1f) }
                )
            }
        val currentNearEnd by rememberUpdatedState(onNearEnd)
        LaunchedEffect(state, rows.size) {
            snapshotFlow {
                    val last = state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
                    rows.isNotEmpty() && last >= rows.size - 3
                }
                .collect { near -> if (near) currentNearEnd() }
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            state = state,
            contentPadding =
                PaddingValues(start = PageGutter, end = PageGutter, top = 8.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            itemsIndexed(rows, key = { _, row -> "${row.first().type}:${row.first().id}" }) {
                _,
                row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    repeat(columns) { column ->
                        Box(Modifier.weight(1f), contentAlignment = Alignment.TopCenter) {
                            row.getOrNull(column)?.let { item ->
                                PosterCard(
                                    item,
                                    false,
                                    "$focusPrefix:${item.type}:${item.id}",
                                    column == 0,
                                ) {
                                    onOpen(item)
                                }
                            }
                        }
                    }
                }
            }
            item(key = "footer") { footer() }
        }
    }
}

/** A row of mutually exclusive choices, the selected one filled. */
@Composable
internal fun <R> ChoiceRow(
    choices: List<TvChoice<R>>,
    label: @Composable (TvChoice<R>) -> String,
    onSelect: (TvChoice<R>) -> Unit,
    modifier: Modifier = Modifier,
) {
    val navigation = LocalNavigationFocus.current
    LazyRow(
        modifier,
        contentPadding = PaddingValues(horizontal = PageGutter),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        itemsIndexed(choices) { index, choice ->
            Button(
                { if (!choice.selected) onSelect(choice) },
                Modifier.focusProperties { if (index == 0) left = navigation },
                shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                scale = ButtonDefaults.scale(focusedScale = 1.03f),
                colors =
                    ButtonDefaults.colors(
                        containerColor =
                            if (choice.selected) KinoColors.SurfaceActive else Background
                    ),
            ) {
                Text(label(choice), fontSize = 15.sp)
            }
        }
    }
}

/**
 * A labelled menu button for a long list of choices, such as genres, opening a dialog that focuses
 * the current choice and returns focus to the button.
 */
@Composable
internal fun <R> ChoiceMenu(
    title: String,
    choices: List<TvChoice<R>>,
    label: @Composable (TvChoice<R>) -> String,
    onSelect: (TvChoice<R>) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val selected = choices.firstOrNull { it.selected } ?: choices.firstOrNull()
    OutlinedButton(
        { open = true },
        shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
        border = kinoOutlinedBorder(),
    ) {
        Text("$title  ·  ${selected?.let { label(it) }.orEmpty()}", fontSize = 15.sp)
        Icon(
            painterResource(R.drawable.ic_chevron_down),
            null,
            Modifier.padding(start = 10.dp).size(16.dp),
        )
    }
    if (open) {
        Dialog(onDismissRequest = { open = false }) {
            LazyColumn(
                Modifier.width(380.dp)
                    .heightIn(max = 460.dp)
                    .background(SurfaceColor, RoundedCornerShape(12.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                itemsIndexed(choices) { _, choice ->
                    val focus = remember { FocusRequester() }
                    Button(
                        {
                            open = false
                            if (!choice.selected) onSelect(choice)
                        },
                        Modifier.fillMaxWidth().focusRequester(focus),
                    ) {
                        Text(label(choice))
                    }
                    LaunchedEffect(Unit) { if (choice == selected) focus.requestFocus() }
                }
            }
        }
    }
}

@Composable
private fun typeLabel(type: String?): String =
    when (type) {
        null -> stringResource(R.string.all)
        "movie" -> stringResource(R.string.movies)
        "series" -> stringResource(R.string.series)
        else -> type.replaceFirstChar { it.uppercase() }
    }

@Composable
internal fun DiscoverScreen(
    discover: Discover,
    onOpen: (Media) -> Unit,
    onSelect: (ResourceRequest?) -> Unit,
    onMore: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(top = 28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        PageTitle(R.string.discover)
        if (discover.types.isNotEmpty())
            ChoiceRow(discover.types, { typeLabel(it.label) }, { onSelect(it.request) })
        if (discover.catalogs.isNotEmpty())
            ChoiceRow(discover.catalogs, { it.label.orEmpty() }, { onSelect(it.request) })
        if (discover.filters.isNotEmpty())
            Row(
                Modifier.padding(horizontal = PageGutter),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                discover.filters.forEach { filter ->
                    val years =
                        filter.name == "year" ||
                            filter.options.mapNotNull { it.label }.all { it.matches(Regex("\\d{4}")) }
                    val title = stringResource(if (years) R.string.year else R.string.genre)
                    val all = stringResource(if (years) R.string.all_years else R.string.all_genres)
                    ChoiceMenu(title, filter.options, { it.label ?: all }, { onSelect(it.request) })
                }
            }
        when {
            discover.items.isEmpty() && discover.failed ->
                RetryRow { onSelect(discover.catalogs.firstOrNull { it.selected }?.request) }
            discover.items.isEmpty() && discover.loading -> StatusText(R.string.loading)
            discover.items.isEmpty() -> StatusText(R.string.discover_empty)
            else ->
                PosterGrid(
                    discover.items,
                    "discover",
                    onOpen,
                    Modifier.weight(1f),
                    footer = { if (discover.loading) StatusText(R.string.loading_more) },
                    onNearEnd = { if (discover.more && !discover.loading) onMore() },
                )
        }
    }
}

@Composable
private fun sortLabel(sort: String?): String =
    stringResource(
        when (sort) {
            "Name" -> R.string.sort_name
            "NameReverse" -> R.string.sort_name_reverse
            "TimesWatched" -> R.string.sort_times_watched
            "Watched" -> R.string.sort_watched
            "NotWatched" -> R.string.sort_not_watched
            else -> R.string.sort_last_watched
        }
    )

@Composable
internal fun LibraryScreen(
    library: Library,
    onOpen: (Media) -> Unit,
    onSelect: (LibraryWithFilters.LibraryRequest) -> Unit = {},
    onMore: () -> Unit = {},
) {
    // Core lists its types once the library loads; until then the page still offers All.
    val types =
        library.types.ifEmpty {
            listOf(
                TvChoice<LibraryWithFilters.LibraryRequest>(
                    null,
                    true,
                    LibraryWithFilters.LibraryRequest(
                        sort = LibraryWithFilters.Sort.LAST_WATCHED,
                        page = 1,
                    ),
                )
            )
        }
    Column(
        Modifier.fillMaxSize().padding(top = 28.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        PageTitle(R.string.library)
        Row(verticalAlignment = Alignment.CenterVertically) {
            ChoiceRow(types, { typeLabel(it.label) }, { onSelect(it.request) }, Modifier.weight(1f))
            if (library.sorts.isNotEmpty())
                Box(Modifier.padding(end = PageGutter)) {
                    ChoiceMenu(
                        stringResource(R.string.sort),
                        library.sorts,
                        { sortLabel(it.label) },
                        { onSelect(it.request) },
                    )
                }
        }
        if (library.items.isEmpty()) StatusText(R.string.library_empty)
        else
            PosterGrid(
                library.items,
                "library",
                onOpen,
                Modifier.weight(1f),
                onNearEnd = { if (library.more) onMore() },
            )
    }
}
