@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.*
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay

private class PosterFocusRegistry {
    val requesters = mutableMapOf<String, FocusRequester>()
    var lastFocusedKey: String? = null
}

private val LocalPosterFocus = staticCompositionLocalOf { PosterFocusRegistry() }

@Composable
fun KinoApp(
    core: TvCore,
    accountProcess: Boolean,
    onSignIn: () -> Unit,
    onAccountLinked: () -> Unit,
    onCancelAccount: () -> Unit,
    onSignOut: () -> Unit,
) {
    val state by core.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val preferences = remember { context.getSharedPreferences("kino", Context.MODE_PRIVATE) }
    var entered by rememberSaveable { mutableStateOf(preferences.getBoolean("entered", false)) }
    val startup = startupScreen(state, accountProcess, entered)
    val linking = startup == StartupScreen.SignIn
    var destination by rememberSaveable { mutableStateOf("home") }
    var selected by remember { mutableStateOf<Media?>(null) }
    var videoId by remember { mutableStateOf<String?>(null) }
    var playing by remember { mutableStateOf<Source?>(null) }
    var playbackError by remember { mutableStateOf<Int?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    val navigationFocus = remember { TvDestinations.associate { it.route to FocusRequester() } }
    val contentFocus = remember { FocusRequester() }
    val posterFocus = remember { PosterFocusRegistry() }
    val savedScreens = rememberSaveableStateHolder()
    var returnFocusKey by remember { mutableStateOf<String?>(null) }
    var navigationRequest by remember { mutableIntStateOf(0) }
    var resumePending by remember { mutableStateOf(false) }

    LaunchedEffect(core) { core.initialize() }
    LaunchedEffect(state.signedIn) {
        if (state.signedIn) {
            entered = true
            onAccountLinked()
        }
    }
    LaunchedEffect(linking) {
        if (linking) core.beginLink()
        while (linking) {
            delay(4000)
            core.pollLink()
        }
    }
    LaunchedEffect(query, state.ready) {
        if (state.ready && query.isNotBlank()) {
            delay(400)
            core.search(query.trim())
        }
    }
    LaunchedEffect(resumePending, state.details) {
        if (resumePending && !state.details.loading && !state.details.sourcesLoading) {
            resumePending = false
            val previous = state.details.lastUsedStream
            val source =
                state.details.sources.firstOrNull {
                    it.playable &&
                        previous != null &&
                        it.stream.source == previous.source &&
                        it.stream.behaviorHints.proxyHeaders == previous.behaviorHints.proxyHeaders
                }
            if (source != null) {
                core.startPlayer(source)
                playing = source
            }
        }
    }
    val closeDetails = {
        selected = null
        playbackError = null
        resumePending = false
    }
    BackHandler(playing == null && (selected != null || linking || destination != "home")) {
        when {
            linking -> {
                core.cancelLink()
                onCancelAccount()
            }
            selected != null -> closeDetails()
            else -> destination = "home"
        }
    }
    val open: (Media) -> Unit = { media ->
        selected = media
        videoId = media.videoId ?: media.id.takeIf { media.type == "movie" }
        returnFocusKey = posterFocus.lastFocusedKey
        resumePending = media.resume
        playbackError = null
        core.open(media)
    }
    val navigate: (String) -> Unit = { route ->
        closeDetails()
        returnFocusKey = null
        destination = route
        navigationRequest++
    }
    CompositionLocalProvider(LocalPosterFocus provides posterFocus) {
        Box(Modifier.fillMaxSize().background(Background)) {
            when {
                playing != null ->
                    FullscreenPlayer(
                        playing!!,
                        selected?.title.orEmpty(),
                        core,
                        onExit = { playing = null },
                        onFailure = { error ->
                            playing = null
                            playbackError = error
                        },
                    )
                !state.ready ->
                    CenterMessage(
                        if (state.failed) R.string.network_error else R.string.loading,
                        if (state.failed) ({ core.initialize() }) else null,
                    )
                linking -> LinkScreen(state, core::beginLink)
                startup == StartupScreen.Welcome ->
                    WelcomeScreen(
                        onSignIn,
                        onGuest = {
                            entered = true
                            preferences.edit().putBoolean("entered", true).apply()
                        },
                    )
                else ->
                    TvNavigation(
                        destination,
                        navigationFocus,
                        contentFocus,
                        state.signedIn,
                        navigate,
                        onAccount = { if (state.signedIn) navigate("settings") else onSignIn() },
                    ) {
                        Box(Modifier.fillMaxSize().focusRequester(contentFocus).focusGroup()) {
                            if (selected != null) {
                                DetailScreen(
                                    selected!!,
                                    videoId,
                                    state.details,
                                    playbackError,
                                    onBack = closeDetails,
                                    onEpisode = {
                                        resumePending = false
                                        videoId = it
                                        core.open(selected!!, it)
                                    },
                                    onRetry = { core.open(selected!!, videoId) },
                                    onLibrary = { core.toggleLibrary(selected!!) },
                                    onSource = { source ->
                                        core.startPlayer(source)
                                        playing = source
                                    },
                                )
                            } else {
                                savedScreens.SaveableStateProvider(destination) {
                                    when (destination) {
                                        "home" -> HomeScreen(state, open, core::home)
                                        "search" ->
                                            SearchScreen(query, { query = it }, state.search, open)
                                        "library" -> LibraryScreen(state.library, open)
                                        "addons" -> AddonsScreen(state.addons)
                                        else ->
                                            SettingsScreen(state, onSignIn, onSignOut) {
                                                navigate("addons")
                                            }
                                    }
                                }
                                LaunchedEffect(destination, navigationRequest) {
                                    withFrameNanos {}
                                    val restored =
                                        returnFocusKey?.let { key ->
                                            posterFocus.requesters[key]?.requestFocus()
                                        } == true
                                    if (!restored && !contentFocus.requestFocus()) {
                                        navigationFocus.getValue(destination).requestFocus()
                                    }
                                    returnFocusKey = null
                                }
                            }
                        }
                    }
            }
        }
    }
}

@Composable
private fun WelcomeScreen(onSignIn: () -> Unit, onGuest: () -> Unit) {
    val focus = remember { FocusRequester() }
    Column(Modifier.fillMaxSize().padding(72.dp), verticalArrangement = Arrangement.Center) {
        Image(painterResource(R.drawable.kino_icon), null, Modifier.size(64.dp))
        Spacer(Modifier.height(30.dp))
        Text(stringResource(R.string.welcome), fontSize = 42.sp, fontWeight = FontWeight.Bold)
        Text(
            stringResource(R.string.welcome_body),
            Modifier.widthIn(max = 540.dp).padding(top = 16.dp, bottom = 32.dp),
            color = Muted,
            fontSize = 20.sp,
            lineHeight = 28.sp,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Button(onSignIn, Modifier.focusRequester(focus)) {
                Text(stringResource(R.string.sign_in))
            }
            OutlinedButton(
                onGuest,
                shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                border = kinoOutlinedBorder(),
            ) {
                Text(stringResource(R.string.guest))
            }
        }
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}

private fun groupedMedia(shelves: List<Shelf>): List<Pair<Int, List<Media>>> {
    val items = shelves.flatMap { it.items }.distinctBy { "${it.type}:${it.id}" }
    return listOf(R.string.movies to "movie", R.string.series to "series")
        .map { (label, type) -> label to items.filter { it.type == type } }
        .filter { it.second.isNotEmpty() }
}

@Composable
private fun HomeScreen(state: TvState, onOpen: (Media) -> Unit, onRetry: () -> Unit) {
    val groups = remember(state.shelves) { groupedMedia(state.shelves) }
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
            )
            if (state.continueWatching.isEmpty()) StatusText(R.string.continue_empty)
        }
        items(groups, key = { it.first }) { (label, media) ->
            MediaShelf("home-$label", stringResource(label), media.take(12), onOpen)
        }
        if (state.shelves.any { it.loading } && groups.isEmpty()) {
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
                groups.isEmpty()
        ) {
            item { StatusText(R.string.catalogs_empty) }
        }
    }
}

@Composable
private fun MediaShelf(
    id: String,
    title: String,
    media: List<Media>,
    onOpen: (Media) -> Unit,
    resume: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            title,
            Modifier.padding(start = PageGutter),
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-.2).sp,
        )
        if (media.isNotEmpty())
            LazyRow(
                Modifier.focusRestorer(),
                contentPadding = PaddingValues(horizontal = PageGutter, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                itemsIndexed(media, key = { _, it -> "${it.type}:${it.id}" }) { index, item ->
                    PosterCard(item, resume, "$id:${item.type}:${item.id}", index == 0) {
                        onOpen(item)
                    }
                }
            }
    }
}

@Composable
private fun PosterCard(
    media: Media,
    resume: Boolean,
    focusKey: String,
    firstInRow: Boolean,
    onClick: () -> Unit,
) {
    val registry = LocalPosterFocus.current
    val navigation = LocalNavigationFocus.current
    val focus = remember(focusKey) { FocusRequester() }
    val accessibilityLabel =
        if (resume) stringResource(R.string.resume_title, media.title) else media.title
    var artworkFailed by remember(media.poster) { mutableStateOf(false) }
    DisposableEffect(focusKey) {
        registry.requesters[focusKey] = focus
        onDispose { registry.requesters.remove(focusKey) }
    }
    Column(Modifier.width(PosterWidth), horizontalAlignment = Alignment.CenterHorizontally) {
        Card(
            onClick,
            Modifier.width(PosterWidth)
                .height(PosterHeight)
                .focusRequester(focus)
                .focusProperties { if (firstInRow) left = navigation }
                .onFocusChanged { if (it.isFocused) registry.lastFocusedKey = focusKey }
                .semantics { contentDescription = accessibilityLabel },
            shape = CardDefaults.shape(RoundedCornerShape(10.dp)),
            border =
                CardDefaults.border(
                    focusedBorder =
                        Border(
                            androidx.compose.foundation.BorderStroke(2.dp, KinoColors.TextStrong),
                            shape = RoundedCornerShape(10.dp),
                        )
                ),
            scale = CardDefaults.scale(focusedScale = 1.04f),
        ) {
            Box(Modifier.fillMaxSize().background(SurfaceColor)) {
                if (media.poster == null || artworkFailed)
                    Text(
                        media.title.take(1),
                        Modifier.align(Alignment.Center),
                        fontSize = 42.sp,
                        color = KinoColors.TextFaint,
                    )
                AsyncImage(
                    media.poster?.takeIf(::secureUrl),
                    null,
                    Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                    onError = { artworkFailed = true },
                )
                if (resume) {
                    Box(
                        Modifier.align(Alignment.Center)
                            .size(36.dp)
                            .clip(RoundedCornerShape(50))
                            .background(Color.Black.copy(alpha = .55f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Image(painterResource(R.drawable.play), null, Modifier.size(24.dp))
                    }
                    Box(
                        Modifier.align(Alignment.BottomStart)
                            .fillMaxWidth()
                            .height(3.dp)
                            .background(Color.White.copy(alpha = .2f))
                    ) {
                        Box(
                            Modifier.fillMaxWidth(
                                    (media.progress ?: 0.0).toFloat().coerceIn(0f, 1f)
                                )
                                .fillMaxHeight()
                                .background(KinoColors.TextStrong)
                        )
                    }
                }
            }
        }
        Text(
            media.title,
            Modifier.padding(top = 10.dp).fillMaxWidth(),
            fontSize = 14.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        if (!resume)
            Text(
                media.year?.take(4)?.takeIf { it.all(Char::isDigit) }
                    ?: stringResource(
                        if (media.type == "movie") R.string.movie else R.string.series
                    ),
                Modifier.padding(top = 3.dp),
                fontSize = 12.sp,
                lineHeight = 16.sp,
                color = KinoColors.TextFaint,
            )
    }
}

@Composable
private fun DetailScreen(
    media: Media,
    videoId: String?,
    details: Details,
    error: Int?,
    onBack: () -> Unit,
    onEpisode: (String) -> Unit,
    onRetry: () -> Unit,
    onLibrary: () -> Unit,
    onSource: (Source) -> Unit,
) {
    val meta = details.meta
    val focus = remember { FocusRequester() }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            Box(Modifier.fillMaxWidth().heightIn(min = 270.dp)) {
                AsyncImage(
                    (meta?.background ?: media.background)?.takeIf(::secureUrl),
                    null,
                    Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop,
                )
                Box(
                    Modifier.matchParentSize()
                        .background(
                            Brush.horizontalGradient(
                                listOf(Background, Background.copy(alpha = .35f))
                            )
                        )
                )
                Box(
                    Modifier.matchParentSize()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Background)))
                )
                Button(
                    onBack,
                    Modifier.padding(start = PageGutter, top = 24.dp).focusRequester(focus),
                    shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                    colors = ButtonDefaults.colors(containerColor = Background.copy(alpha = .65f)),
                ) {
                    Icon(painterResource(R.drawable.ic_arrow_left), null, Modifier.size(18.dp))
                    Text(
                        stringResource(R.string.back),
                        Modifier.padding(start = 8.dp),
                        fontSize = 14.sp,
                    )
                }
                Column(
                    Modifier.align(Alignment.BottomStart)
                        .padding(start = PageGutter, end = PageGutter, top = 90.dp, bottom = 12.dp)
                ) {
                    Text(
                        meta?.name ?: media.title,
                        fontSize = 36.sp,
                        lineHeight = 42.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-.8).sp,
                    )
                    Text(
                        listOfNotNull(
                                meta?.releaseInfo ?: media.year,
                                meta?.runtime,
                                stringResource(
                                    if (media.type == "movie") R.string.movie else R.string.series
                                ),
                            )
                            .joinToString(" · "),
                        Modifier.padding(vertical = 10.dp),
                        fontSize = 15.sp,
                        color = Muted,
                    )
                    Text(
                        meta?.description ?: media.description.orEmpty(),
                        Modifier.widthIn(max = 650.dp),
                        fontSize = 16.sp,
                        lineHeight = 22.sp,
                        color = Muted,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            LaunchedEffect(Unit) { focus.requestFocus() }
        }
        if (media.preview != null || meta != null)
            item {
                OutlinedButton(
                    onLibrary,
                    Modifier.padding(start = PageGutter),
                    shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                    border = kinoOutlinedBorder(),
                ) {
                    Icon(
                        painterResource(
                            if (meta?.inLibrary == true) R.drawable.ic_check else R.drawable.ic_plus
                        ),
                        null,
                        Modifier.size(18.dp),
                    )
                    Text(
                        stringResource(
                            if (meta?.inLibrary == true) R.string.remove_library
                            else R.string.add_library
                        ),
                        Modifier.padding(start = 10.dp),
                        fontSize = 15.sp,
                    )
                }
            }
        if (details.loading) item { StatusText(R.string.loading) }
        if (details.failed) item { RetryRow(onRetry) }
        if (media.type != "movie" && meta != null) {
            item {
                Text(
                    stringResource(R.string.episodes),
                    Modifier.padding(start = PageGutter),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = PageGutter, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(meta.videos.filter { !it.upcoming }, key = { it.id }) { episode ->
                        Button(
                            { onEpisode(episode.id) },
                            shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                            colors =
                                ButtonDefaults.colors(
                                    containerColor =
                                        if (videoId == episode.id) KinoColors.SurfaceActive
                                        else SurfaceColor
                                ),
                        ) {
                            Column(Modifier.widthIn(max = 180.dp)) {
                                episode.seriesInfo?.let {
                                    Text(
                                        stringResource(
                                            R.string.season_episode,
                                            it.season.toInt(),
                                            it.episode.toInt(),
                                        ),
                                        fontSize = 12.sp,
                                    )
                                }
                                Text(episode.title, fontSize = 15.sp, lineHeight = 20.sp)
                            }
                        }
                    }
                }
            }
        }
        if (videoId != null) {
            item {
                Text(
                    stringResource(R.string.sources),
                    Modifier.padding(start = PageGutter),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            error?.let {
                item {
                    Text(
                        stringResource(it),
                        Modifier.padding(horizontal = PageGutter),
                        color = KinoColors.Danger,
                    )
                }
            }
            if (details.sourcesLoading) item { StatusText(R.string.loading) }
            if (details.sourceErrors.isNotEmpty()) item { RetryRow(onRetry) }
            if (!details.sourcesLoading && details.sources.isEmpty())
                item { StatusText(R.string.empty_sources) }
            items(details.sources) { source ->
                SourceRow(source, details.meta?.runtime, onSelect = { onSource(source) })
            }
        }
    }
}

@Composable
private fun SearchScreen(
    query: String,
    onQuery: (String) -> Unit,
    shelves: List<Shelf>,
    onOpen: (Media) -> Unit,
) {
    var inputFocused by remember { mutableStateOf(false) }
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
            query,
            onQuery,
            Modifier.padding(horizontal = PageGutter)
                .fillMaxWidth()
                .onFocusChanged { inputFocused = it.isFocused }
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
            singleLine = true,
            keyboardOptions =
                KeyboardOptions(imeAction = ImeAction.Search, showKeyboardOnFocus = false),
            keyboardActions =
                KeyboardActions(
                    onSearch = {
                        keyboard?.hide()
                        focusManager.moveFocus(FocusDirection.Down)
                    }
                ),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(KinoColors.TextStrong),
            decorationBox = { inner ->
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

@Composable
private fun PageTitle(title: Int) {
    Text(
        stringResource(title),
        Modifier.padding(horizontal = PageGutter),
        fontSize = 30.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-.6).sp,
    )
}

@Composable
private fun LibraryScreen(media: List<Media>, onOpen: (Media) -> Unit) {
    var selectedType by rememberSaveable { mutableStateOf<String?>(null) }
    val navigation = LocalNavigationFocus.current
    val filtered =
        remember(media, selectedType) {
            media.filter { selectedType == null || it.type == selectedType }
        }
    Column(
        Modifier.fillMaxSize().padding(top = 28.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        PageTitle(R.string.library)
        Row(
            Modifier.padding(horizontal = PageGutter),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            listOf(null to R.string.all, "movie" to R.string.movies, "series" to R.string.series)
                .forEachIndexed { index, (type, label) ->
                    Button(
                        { selectedType = type },
                        Modifier.focusProperties { if (index == 0) left = navigation },
                        shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                        scale = ButtonDefaults.scale(focusedScale = 1.03f),
                        colors =
                            ButtonDefaults.colors(
                                containerColor =
                                    if (type == selectedType) KinoColors.SurfaceActive
                                    else Background
                            ),
                    ) {
                        Text(stringResource(label), fontSize = 15.sp)
                    }
                }
        }
        if (filtered.isEmpty()) StatusText(R.string.library_empty)
        else
            BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
                val columns =
                    ((maxWidth - PageGutter * 2 + 16.dp) / (PosterWidth + 16.dp))
                        .toInt()
                        .coerceAtLeast(1)
                LazyVerticalGrid(
                    GridCells.Fixed(columns),
                    Modifier.fillMaxSize(),
                    contentPadding =
                        PaddingValues(
                            start = PageGutter,
                            end = PageGutter,
                            top = 8.dp,
                            bottom = 40.dp,
                        ),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    itemsIndexed(filtered, key = { _, it -> "${it.type}:${it.id}" }) { index, item
                        ->
                        Box(contentAlignment = Alignment.TopCenter) {
                            PosterCard(
                                item,
                                false,
                                "library:${item.type}:${item.id}",
                                index % columns == 0,
                            ) {
                                onOpen(item)
                            }
                        }
                    }
                }
            }
    }
}

@Composable
private fun AddonsScreen(addons: List<String>) {
    val navigation = LocalNavigationFocus.current
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 28.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { PageTitle(R.string.addons) }
        items(addons) { name ->
            var focused by remember { mutableStateOf(false) }
            Column(Modifier.padding(horizontal = PageGutter)) {
                Row(
                    Modifier.fillMaxWidth()
                        .onFocusChanged { focused = it.isFocused }
                        .focusProperties { left = navigation }
                        .focusable()
                        .background(
                            if (focused) SurfaceColor else Background,
                            RoundedCornerShape(8.dp),
                        )
                        .border(
                            2.dp,
                            if (focused) KinoColors.TextStrong else Color.Transparent,
                            RoundedCornerShape(8.dp),
                        )
                        .padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Icon(
                        painterResource(R.drawable.ic_blocks),
                        null,
                        Modifier.size(22.dp),
                        tint = Muted,
                    )
                    Text(name, fontSize = 18.sp, fontWeight = FontWeight.Medium)
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(KinoColors.BorderSubtle))
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    state: TvState,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onAddons: () -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 28.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(30.dp),
    ) {
        item { PageTitle(R.string.settings) }
        item {
            Column(
                Modifier.padding(horizontal = PageGutter),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    stringResource(R.string.account),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    stringResource(
                        if (state.signedIn) R.string.account_profile else R.string.guest_profile
                    ),
                    color = Muted,
                    fontSize = 16.sp,
                )
                OutlinedButton(
                    if (state.signedIn) onSignOut else onSignIn,
                    shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                    border = kinoOutlinedBorder(),
                ) {
                    Text(
                        stringResource(if (state.signedIn) R.string.sign_out else R.string.sign_in),
                        fontSize = 15.sp,
                    )
                }
            }
        }
        item {
            Column(
                Modifier.padding(horizontal = PageGutter),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    stringResource(R.string.addons),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                OutlinedButton(
                    onAddons,
                    shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                    border = kinoOutlinedBorder(),
                ) {
                    Text(stringResource(R.string.view_addons), fontSize = 15.sp)
                }
            }
        }
        item {
            Column(
                Modifier.padding(horizontal = PageGutter),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    stringResource(R.string.video_output),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(stringResource(R.string.sdr), color = Muted, fontSize = 16.sp)
            }
        }
        item {
            Text(
                stringResource(R.string.version, BuildConfig.VERSION_NAME),
                Modifier.padding(horizontal = PageGutter),
                color = KinoColors.TextFaint,
                fontSize = 13.sp,
            )
        }
    }
}

@Composable
private fun LinkScreen(state: TvState, onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxSize().padding(64.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(48.dp),
    ) {
        state.qrCode?.let {
            AsyncImage(
                it,
                stringResource(R.string.sign_in),
                Modifier.size(240.dp).background(Color.White),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Text(stringResource(R.string.sign_in), fontSize = 36.sp, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.sign_in_body), color = Muted, fontSize = 20.sp)
            state.link?.let { Text(it, fontSize = 20.sp) }
            if (state.linkFailed) RetryRow(onRetry)
            else Text(stringResource(R.string.sign_in_waiting), color = Muted)
        }
    }
}

@Composable
private fun CenterMessage(message: Int, retry: (() -> Unit)? = null) {
    Column(
        Modifier.fillMaxSize().padding(48.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(stringResource(message), fontSize = 20.sp, color = Muted)
        retry?.let { RetryRow(it) }
    }
}

@Composable
private fun StatusText(message: Int) {
    Text(
        stringResource(message),
        Modifier.padding(horizontal = PageGutter, vertical = 12.dp),
        color = Muted,
    )
}

@Composable
private fun RetryRow(onRetry: () -> Unit) {
    Button(onRetry, Modifier.padding(horizontal = PageGutter, vertical = 12.dp)) {
        Text(stringResource(R.string.retry))
    }
}

private val RowShape = RoundedCornerShape(8.dp)

@Composable
private fun rowColors() =
    ClickableSurfaceDefaults.colors(containerColor = Background, focusedContainerColor = SurfaceColor)

@Composable
private fun rowBorder() =
    ClickableSurfaceDefaults.border(
        focusedBorder =
            Border(
                androidx.compose.foundation.BorderStroke(2.dp, KinoColors.TextStrong),
                shape = RowShape,
            )
    )

/**
 * One source as a structured row: the same fields, in the same order, as the
 * desktop client, with the spacing a remote needs. Selecting the row plays.
 * The Details control beside it opens the complete add-on text and the rarer
 * fields in place, and never starts playback.
 */
@Composable
private fun SourceRow(source: Source, runtime: String?, onSelect: () -> Unit) {
    val unnamed = stringResource(R.string.source_unnamed)
    val fields = remember(source) { sourceFields(source.stream, unnamed) }
    var expanded by remember(source) { mutableStateOf(false) }
    val lead = listOfNotNull(fields.resolution, fields.releaseType).joinToString(" ")
    val traits =
        listOfNotNull(fields.videoRange, fields.videoCodec, fields.audio) +
            fields.languages +
            listOfNotNull(fields.releaseGroup)
    val size = sizeLabel(fields.size)
    val bitrate = bitrateLabel(fields, runtime)
    Column(Modifier.padding(horizontal = PageGutter)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(
                onClick = { if (source.playable) onSelect() },
                modifier = Modifier.weight(1f),
                shape = ClickableSurfaceDefaults.shape(RowShape),
                colors = rowColors(),
                border = rowBorder(),
                scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
            ) {
                Row(
                    Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (fields.structured) {
                            Text(
                                lead.ifEmpty { fields.fallbackTitle },
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 18.sp,
                            )
                            if (traits.isNotEmpty())
                                Text(traits.joinToString("   "), fontSize = 15.sp, color = Muted)
                        } else {
                            Text(
                                fields.fallbackTitle,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 18.sp,
                            )
                        }
                        Text(source.provider, fontSize = 13.sp, color = KinoColors.TextFaint)
                        if (!source.playable)
                            Text(
                                stringResource(
                                    if (source.stream.tramvai != null) R.string.torrent_pending
                                    else R.string.source_unsupported
                                ),
                                fontSize = 13.sp,
                                color = Muted,
                            )
                    }
                    // Figures sit in their own column so rows line up for comparison.
                    Column(horizontalAlignment = Alignment.End) {
                        size?.let { Text(it, fontSize = 16.sp) }
                        bitrate?.let { Text(it, fontSize = 13.sp, color = Muted) }
                    }
                }
            }
            Surface(
                onClick = { expanded = !expanded },
                shape = ClickableSurfaceDefaults.shape(RowShape),
                colors = rowColors(),
                border = rowBorder(),
                scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
            ) {
                // A fixed width keeps the figures column still when the label changes.
                Text(
                    stringResource(if (expanded) R.string.source_hide_details else R.string.source_details),
                    Modifier.width(132.dp).padding(horizontal = 12.dp, vertical = 16.dp),
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center,
                )
            }
        }
        if (expanded) {
            Column(
                Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                fields.original.filename?.let { DetailField(R.string.source_filename, it) }
                fields.original.description?.let { DetailField(R.string.source_addon_text, it) }
                DetailField(R.string.source_addon, source.provider)
                fields.releaseGroup?.let { DetailField(R.string.source_release_group, it) }
                if (fields.languages.isNotEmpty())
                    DetailField(R.string.source_languages, fields.languages.joinToString(", "))
                size?.let { DetailField(R.string.source_size, it) }
                bitrate?.let {
                    DetailField(
                        R.string.source_bitrate,
                        if (fields.statedMegabits == null)
                            "$it  " + stringResource(R.string.source_bitrate_estimated)
                        else it,
                    )
                }
                fields.peers?.let { DetailField(R.string.source_peers, it.toString()) }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(KinoColors.BorderSubtle))
    }
}

@Composable
private fun DetailField(label: Int, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(stringResource(label), fontSize = 12.sp, color = KinoColors.TextFaint)
        Text(value, fontSize = 15.sp, color = Muted)
    }
}

@Composable
private fun sizeLabel(size: SourceSize?): String? =
    when (size) {
        null -> null
        is SourceSize.Text -> size.text
        is SourceSize.Bytes -> {
            val gibibytes = size.bytes / (1L shl 30).toDouble()
            // One decimal at every size, so "54.3 GB" and "6.9 GB" line up.
            if (gibibytes >= 1) stringResource(R.string.format_gigabytes, "%.1f".format(gibibytes))
            else stringResource(R.string.format_megabytes, (size.bytes / (1L shl 20)).toInt())
        }
    }

@Composable
private fun bitrateLabel(fields: SourceFields, runtime: String?): String? {
    fun digits(value: Double) = if (value >= 10) "%.0f".format(value) else "%.1f".format(value)
    fields.statedMegabits?.let {
        return stringResource(R.string.format_megabits, digits(it))
    }
    val estimate = estimatedMegabits(fields.size, runtimeMinutes(runtime)) ?: return null
    return stringResource(R.string.format_estimated_megabits, digits(estimate))
}

