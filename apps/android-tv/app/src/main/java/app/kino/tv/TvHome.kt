@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.tv.material3.*
import com.stremio.core.types.addon.ResourceRequest

internal data class HomeRow(val shelf: Shelf, val detail: String)

/**
 * Each movie and series catalog is its own Home row, named as its add-on names it, with the type
 * unless the name already says it. Two rows that would read the same also name their add-on.
 * Other types, such as YouTube channels, have nothing Kino can open from Home.
 */
@Composable
private fun homeRows(shelves: List<Shelf>): List<HomeRow> {
    val types = mapOf("movie" to stringResource(R.string.movies), "series" to stringResource(R.string.series))
    val shown = shelves.filter { it.type in types && (it.items.isNotEmpty() || (it.loading && !it.failed)) }
    val titles = shown.map { "${it.name}\u0000${it.type}" }
    return shown.mapIndexed { index, shelf ->
        val named = shelf.name.lowercase().contains(shelf.type)
        val collides = titles.count { it == titles[index] } > 1
        HomeRow(
            shelf,
            listOfNotNull(
                    types.getValue(shelf.type).takeUnless { named },
                    shelf.addon.takeIf { collides && it.isNotBlank() },
                )
                .joinToString(" · "),
        )
    }
}

internal fun groupedMedia(shelves: List<Shelf>): List<Pair<Int, List<Media>>> {
    val items = shelves.flatMap { it.items }.distinctBy { "${it.type}:${it.id}" }
    return listOf(R.string.movies to "movie", R.string.series to "series")
        .map { (label, type) -> label to items.filter { it.type == type } }
        .filter { it.second.isNotEmpty() }
}

@Composable
internal fun HomeScreen(
    state: TvState,
    onOpen: (Media) -> Unit,
    onRetry: () -> Unit,
    onRemoveContinue: (Media) -> Unit = {},
    onSeeAll: (ResourceRequest) -> Unit = {},
) {
    val rows = homeRows(state.shelves)
    var options by remember { mutableStateOf<Media?>(null) }
    options?.let { media ->
        Dialog(onDismissRequest = { options = null }) {
            Column(
                Modifier.width(420.dp)
                    .background(SurfaceColor, RoundedCornerShape(12.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(media.title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                val remove = remember { FocusRequester() }
                Button(
                    {
                        options = null
                        onRemoveContinue(media)
                    },
                    Modifier.fillMaxWidth().focusRequester(remove),
                ) {
                    Text(stringResource(R.string.continue_remove))
                }
                LaunchedEffect(Unit) { remove.requestFocus() }
            }
        }
    }
    LazyColumn(
        state = rememberLazyListState(),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 28.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        item(key = "continue") {
            MediaShelf(
                "home-continue",
                stringResource(R.string.continue_watching),
                state.continueWatching.take(10),
                onOpen,
                resume = true,
                onOptions = { options = it },
            )
            if (state.continueWatching.isEmpty()) StatusText(R.string.continue_empty)
        }
        items(rows, key = { it.shelf.id }) { row ->
            MediaShelf(
                "home-${row.shelf.id}",
                row.shelf.name,
                row.shelf.items.take(12),
                onOpen,
                detail = row.detail,
                onSeeAll = row.shelf.request?.let { request -> { onSeeAll(request) } },
                loading = row.shelf.items.isEmpty(),
            )
        }
        if (state.shelves.any { it.loading } && rows.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.movies),
                    Modifier.padding(horizontal = PageGutter),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                LazyRow(
                    contentPadding = PaddingValues(horizontal = PageGutter, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    items(6) {
                        Box(
                            Modifier.width(PosterWidth)
                                .height(PosterHeight)
                                .background(SurfaceColor, RoundedCornerShape(10.dp))
                        )
                    }
                }
            }
        }
        if (state.shelves.any { it.failed }) item { RetryRow(onRetry) }
        if (
            state.shelves.isNotEmpty() &&
                state.shelves.none { it.loading || it.failed } &&
                rows.isEmpty()
        ) {
            item { StatusText(R.string.catalogs_empty) }
        }
    }
}

@Composable
internal fun MediaShelf(
    id: String,
    title: String,
    media: List<Media>,
    onOpen: (Media) -> Unit,
    resume: Boolean = false,
    onOptions: ((Media) -> Unit)? = null,
    detail: String = "",
    onSeeAll: (() -> Unit)? = null,
    loading: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.padding(start = PageGutter), verticalAlignment = Alignment.Bottom) {
            Text(
                title,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-.2).sp,
            )
            if (detail.isNotEmpty())
                Text(
                    detail,
                    Modifier.padding(start = 8.dp, bottom = 2.dp),
                    fontSize = 16.sp,
                    color = KinoColors.TextFaint,
                )
        }
        if (loading)
            LazyRow(
                contentPadding = PaddingValues(horizontal = PageGutter, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(6) {
                    Box(
                        Modifier.width(PosterWidth)
                            .height(PosterHeight)
                            .background(SurfaceColor, RoundedCornerShape(10.dp))
                    )
                }
            }
        else if (media.isNotEmpty())
            LazyRow(
                Modifier.focusRestorer(),
                contentPadding = PaddingValues(horizontal = PageGutter, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                itemsIndexed(media, key = { _, it -> "${it.type}:${it.id}" }) { index, item ->
                    PosterCard(
                        item,
                        resume,
                        "$id:${item.type}:${item.id}",
                        index == 0,
                        onLongClick = onOptions?.let { { it(item) } },
                    ) {
                        onOpen(item)
                    }
                }
                if (onSeeAll != null) item(key = "see-all") { SeeAllCard(title, detail, onSeeAll) }
            }
    }
}

/** The last stop in a Home row, opening the whole catalog in Discover. */
@Composable
private fun SeeAllCard(title: String, detail: String, onClick: () -> Unit) {
    val label = stringResource(R.string.see_all_title, listOf(title, detail).filter { it.isNotEmpty() }.joinToString(" "))
    Card(
        onClick,
        Modifier.width(PosterWidth).height(PosterHeight).semantics { contentDescription = label },
        shape = CardDefaults.shape(RoundedCornerShape(10.dp)),
        colors = CardDefaults.colors(containerColor = SurfaceColor),
        border =
            CardDefaults.border(
                focusedBorder =
                    Border(
                        androidx.compose.foundation.BorderStroke(2.dp, KinoColors.TextStrong),
                        shape = RoundedCornerShape(10.dp),
                    )
            ),
        scale = CardDefaults.scale(focusedScale = 1f, pressedScale = 1f),
    ) {
        Column(
            Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(painterResource(R.drawable.ic_compass), null, Modifier.size(28.dp))
            Text(
                stringResource(R.string.see_all),
                Modifier.padding(top = 10.dp).clearAndSetSemantics {},
                fontSize = 15.sp,
            )
        }
    }
}
