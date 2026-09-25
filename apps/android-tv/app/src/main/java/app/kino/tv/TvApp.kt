@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.*
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay

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
    val preferences = remember { kinoSettings(context) }
    var entered by rememberSaveable { mutableStateOf(preferences.getBoolean("entered", false)) }
    val startup = startupScreen(state, accountProcess, entered)
    val linking = startup == StartupScreen.SignIn
    var destination by rememberSaveable { mutableStateOf("home") }
    var selected by remember(core) { mutableStateOf<Media?>(null) }
    var videoId by remember(core) { mutableStateOf<String?>(null) }
    var playing by remember(core) { mutableStateOf<Source?>(null) }
    var playbackError by remember { mutableStateOf<Int?>(null) }
    var failedSource by remember { mutableStateOf<FailedSource?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    val navigationFocus = remember { TvDestinations.associate { it.route to FocusRequester() } }
    val contentFocus = remember { FocusRequester() }
    val posterFocus = remember { PosterFocusRegistry() }
    val savedScreens = rememberSaveableStateHolder()
    var returnFocusKey by remember { mutableStateOf<String?>(null) }
    var navigationRequest by remember { mutableIntStateOf(0) }
    var resumePending by remember { mutableStateOf(false) }
    val savedDetails = rememberSaveableStateHolder()
    var detailEntry by rememberSaveable { mutableIntStateOf(0) }

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
    // The remembered stream lives in one add-on's response, so playback starts
    // as soon as that add-on answers rather than after the slowest one. The
    // overlay only lifts onto the source list once every add-on has replied
    // without it, or the title itself failed to load.
    LaunchedEffect(resumePending, state.details) {
        if (!resumePending) return@LaunchedEffect
        val details = state.details
        val previous = details.lastUsedStream
        val source =
            details.sources.firstOrNull {
                it.playable &&
                    previous != null &&
                    it.stream.source == previous.source &&
                    it.stream.behaviorHints.proxyHeaders == previous.behaviorHints.proxyHeaders
            }
        when {
            source != null -> {
                resumePending = false
                if (core.startPlayer(source)) playing = source
            }
            details.failed || (!details.loading && !details.sourcesLoading) -> resumePending = false
        }
    }
    val closeDetails = {
        selected = null
        playbackError = null
        resumePending = false
    }
    val backFromDetails = {
        if (selected?.type == "series" && videoId != null) {
            videoId = null
            resumePending = false
            playbackError = null
            core.open(selected!!, null)
        } else closeDetails()
    }
    BackHandler(playing == null && (selected != null || linking || destination != "home")) {
        when {
            linking -> {
                core.cancelLink()
                onCancelAccount()
            }
            selected != null -> backFromDetails()
            else -> destination = "home"
        }
    }
    val open: (Media) -> Unit = { media ->
        savedDetails.removeState(detailEntry)
        detailEntry++
        selected = media
        videoId = media.entryVideoId()
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
                    TorrentStart(
                        playing!!,
                        onFailure = {
                            core.stopPlayer()
                            failedSource = FailedSource(videoId, playing?.stream?.source)
                            playing = null
                            playbackError = R.string.torrent_failed
                        },
                    ) { mediaUrl ->
                        FullscreenPlayer(
                            playing!!,
                            selected!!,
                            core,
                            onExit = { playing = null },
                            onFailure = { error ->
                                failedSource = FailedSource(videoId, playing?.stream?.source)
                                playing = null
                                playbackError = error
                            },
                            onUpNext = { next ->
                                playing = null
                                resumePending = false
                                playbackError = null
                                videoId = next.id
                                core.open(selected!!, next.id)
                            },
                            mediaUrl = mediaUrl,
                        )
                    }
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
                        Box(
                            Modifier.fillMaxSize()
                                .pageTransition(listOf(destination, selected?.id, videoId))
                                .focusRequester(contentFocus)
                                .focusGroup()
                        ) {
                            if (selected != null) {
                                savedDetails.SaveableStateProvider(detailEntry) {
                                    DetailScreen(
                                        selected!!,
                                        videoId,
                                        state.details,
                                        playbackError,
                                        resuming = resumePending,
                                        onBack = backFromDetails,
                                        onEpisode = {
                                            resumePending = false
                                            videoId = it
                                            playbackError = null
                                            core.open(selected!!, it)
                                        },
                                        onRetry = { core.open(selected!!, videoId) },
                                        onLibrary = { core.toggleLibrary(selected!!) },
                                        onSource = { source ->
                                            if (core.startPlayer(source)) playing = source
                                        },
                                        onWatched = core::markWatched,
                                        onEpisodeWatched = core::markVideoWatched,
                                        onSeasonWatched = core::markSeasonWatched,
                                        failedSource = failedSource,
                                    )
                                }
                            } else {
                                savedScreens.SaveableStateProvider(destination) {
                                    when (destination) {
                                        "home" ->
                                            HomeScreen(
                                                state,
                                                open,
                                                core::home,
                                                core::removeFromContinueWatching,
                                                onSeeAll = { request ->
                                                    core.discover(request)
                                                    navigate("discover")
                                                },
                                            )
                                        "search" ->
                                            SearchScreen(query, { query = it }, state.search, open)
                                        "discover" -> {
                                            LaunchedEffect(Unit) { core.openDiscover() }
                                            DiscoverScreen(
                                                state.discover,
                                                open,
                                                core::discover,
                                                core::loadMoreDiscover,
                                            )
                                        }
                                        "library" ->
                                            LibraryScreen(
                                                state.libraryPages,
                                                open,
                                                core::selectLibrary,
                                                core::loadMoreLibrary,
                                            )
                                        "addons" -> AddonsScreen(state, core)
                                        else ->
                                            SettingsScreen(core, state, onSignIn, onSignOut) {
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
            if (playing == null) ResumeOverlay(resumePending) { resumePending = false }
            if (playing == null && state.ready && !linking)
                UpdatePrompt((context.applicationContext as KinoApplication).updates)
        }
    }
}

/** The source that last failed to play, and the title or episode it failed for. */
internal data class FailedSource(val videoId: String?, val stream: Any?)

/**
 * Opens a torrent in the engine before the player starts, and passes any other source straight
 * through. The engine starts on the first torrent a process plays, which can take a few seconds,
 * so the wait is a screen of its own that Back leaves.
 */
@Composable
private fun TorrentStart(
    source: Source,
    onFailure: () -> Unit,
    player: @Composable (String) -> Unit,
) {
    val torrent = source.torrent
    if (torrent == null) {
        player(source.stream.url!!.url)
        return
    }
    val context = LocalContext.current
    var mediaUrl by remember(source) { mutableStateOf<String?>(null) }
    LaunchedEffect(source) {
        mediaUrl =
            try {
                (context.applicationContext as KinoApplication).engine.mediaUrl(torrent)
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                onFailure()
                null
            }
    }
    mediaUrl?.let { player(it) }
        ?: run {
            BackHandler { onFailure() }
            CenterMessage(R.string.torrent_starting)
        }
}

@Composable
private fun WelcomeScreen(onSignIn: () -> Unit, onGuest: () -> Unit) {
    val focus = remember { FocusRequester() }
    Column(Modifier.fillMaxSize().padding(72.dp), verticalArrangement = Arrangement.Center) {
        Image(painterResource(R.drawable.kino_mark), null, Modifier.width(72.dp))
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
