package app.kino.tv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.models.*
import com.stremio.core.runtime.msg.*
import com.stremio.core.types.addon.ExtraValue
import com.stremio.core.types.addon.ResourcePath
import com.stremio.core.types.addon.ResourceRequest
import com.stremio.core.types.api.AuthRequest
import com.stremio.core.types.resource.MetaItem
import com.stremio.core.types.resource.MetaItemPreview
import com.stremio.core.types.resource.Stream
import java.net.URI
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import pbandk.wkt.Empty

data class Media(
    val id: String,
    val type: String,
    val title: String,
    val poster: String?,
    val background: String? = null,
    val description: String? = null,
    val year: String? = null,
    val preview: MetaItemPreview? = null,
    val progress: Double? = null,
    val videoId: String? = null,
    val resume: Boolean = false,
)

data class Shelf(
    val id: String,
    val title: String,
    val items: List<Media>,
    val loading: Boolean,
    val failed: Boolean,
)

data class Source(val provider: String, val stream: Stream, val request: ResourceRequest) {
    val playable: Boolean
        get() =
            secureUrl(stream.url?.url) &&
                stream.behaviorHints.proxyHeaders?.request.orEmpty().all { (key, value) ->
                    key != null &&
                        value != null &&
                        key.matches(Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")) &&
                        value.none { it == '\r' || it == '\n' || it == '\u0000' }
                }
}

data class Details(
    val meta: MetaItem? = null,
    val sources: List<Source> = emptyList(),
    val loading: Boolean = true,
    val sourcesLoading: Boolean = true,
    val failed: Boolean = false,
    val sourceErrors: List<String> = emptyList(),
    val metaRequest: ResourceRequest? = null,
    val lastUsedStream: Stream? = null,
)

data class TvState(
    val ready: Boolean = false,
    val failed: Boolean = false,
    val shelves: List<Shelf> = emptyList(),
    val search: List<Shelf> = emptyList(),
    val library: List<Media> = emptyList(),
    val continueWatching: List<Media> = emptyList(),
    val details: Details = Details(),
    val signedIn: Boolean = false,
    val audioLanguage: String? = null,
    val subtitleLanguage: String? = null,
    val addons: List<String> = emptyList(),
    val link: String? = null,
    val qrCode: String? = null,
    val linkFailed: Boolean = false,
)

fun secureUrl(value: String?): Boolean =
    try {
        val uri = URI(value ?: "")
        uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null
    } catch (_: Exception) {
        false
    }

/** The only presentation-facing boundary to the pinned Kotlin/JNI Core. */
class TvCore(context: Context, profile: String = "guest") {
    private val storage = CoreStorage(context, profile)
    private val handler = Handler(Looper.getMainLooper())
    private val mutable = MutableStateFlow(TvState())
    val state = mutable.asStateFlow()
    private var initialized = false
    private var linking = false
    private var authenticating = false
    private var detailSelection: MetaDetails.Selected? = null
    private val update = Runnable { refresh() }
    private val listener =
        Core.EventListener {
            handler.removeCallbacks(update)
            handler.postDelayed(update, 40)
        }

    fun initialize() {
        if (initialized) return
        try {
            Core.addEventListener(listener)
            if (Core.initialize(storage) != null) {
                mutable.value = TvState(failed = true)
                return
            }
            initialized = true
            home()
            loadLibrary()
            load(
                ActionLoad.Args.AddonsWithFilters(
                    AddonsWithFilters.Selected(ResourceRequest("", ResourcePath("", "", "")))
                ),
                Field.ADDONS,
            )
            refresh()
            Log.i("KinoCore", "Core initialized")
        } catch (_: Exception) {
            mutable.value = TvState(failed = true)
            Log.e("KinoCore", "Core initialization failed")
        }
    }

    private fun load(args: ActionLoad.Args<*>, field: Field) =
        Core.dispatch(Action(Action.Type.Load(ActionLoad(args))), field)

    private fun ctx(args: ActionCtx.Args<*>) =
        Core.dispatch(Action(Action.Type.Ctx(ActionCtx(args))), Field.CTX)

    fun home() = load(ActionLoad.Args.CatalogsWithExtra(CatalogsWithExtra.Selected()), Field.BOARD)

    fun search(query: String) =
        load(
            ActionLoad.Args.Search(
                CatalogsWithExtra.Selected(extra = listOf(ExtraValue("search", query)))
            ),
            Field.SEARCH,
        )

    fun loadLibrary() {
        val selected =
            LibraryWithFilters.Selected(
                LibraryWithFilters.LibraryRequest(
                    sort = LibraryWithFilters.Sort.LAST_WATCHED,
                    page = 1,
                )
            )
        load(ActionLoad.Args.LibraryWithFilters(selected), Field.LIBRARY)
        load(ActionLoad.Args.LibraryWithFilters(selected), Field.CONTINUE_WATCHING)
    }

    fun open(media: Media, videoId: String? = media.videoId) {
        val selection =
            MetaDetails.Selected(
                metaPath = ResourcePath("meta", media.type, media.id),
                streamPath =
                    (videoId ?: media.id.takeIf { media.type == "movie" })?.let {
                        ResourcePath("stream", media.type, it)
                    },
                guessStreamPath = false,
            )
        val previous = mutable.value.details
        val sameTitle = detailSelection?.metaPath == selection.metaPath
        detailSelection = selection
        mutable.value =
            mutable.value.copy(
                details =
                    Details(
                        meta = previous.meta.takeIf { sameTitle },
                        metaRequest = previous.metaRequest.takeIf { sameTitle },
                        loading = !sameTitle || previous.meta == null,
                        sourcesLoading = selection.streamPath != null,
                    )
            )
        load(ActionLoad.Args.MetaDetails(selection), Field.META_DETAILS)
    }

    fun toggleLibrary(media: Media) {
        if (mutable.value.details.meta?.inLibrary == true)
            ctx(ActionCtx.Args.RemoveFromLibrary(media.id))
        else
            (media.preview
                    ?: mutable.value.details.meta?.let { meta ->
                        MetaItemPreview(
                            id = meta.id,
                            type = meta.type,
                            name = meta.name,
                            posterShape = meta.posterShape,
                            behaviorHints = meta.behaviorHints,
                            deepLinks = meta.deepLinks,
                            inLibrary = meta.inLibrary,
                            watched = meta.watched,
                            inCinema = false,
                            poster = meta.poster,
                            background = meta.background,
                            description = meta.description,
                            releaseInfo = meta.releaseInfo,
                        )
                    })
                ?.let { ctx(ActionCtx.Args.AddToLibrary(it)) }
        loadLibrary()
    }

    fun beginLink() {
        linking = true
        authenticating = false
        load(ActionLoad.Args.Link(Empty()), Field.AUTH_LINK)
    }

    fun pollLink() {
        if (linking && !authenticating)
            Core.dispatch(
                Action(Action.Type.Link(ActionLink(ActionLink.Args.ReadData(Empty())))),
                Field.AUTH_LINK,
            )
    }

    fun cancelLink() {
        linking = false
        Core.dispatch(Action(Action.Type.Unload(Action.ActionUnload())), Field.AUTH_LINK)
    }

    fun startPlayer(source: Source): Boolean {
        if (!source.playable || source.request.path != detailSelection?.streamPath) return false
        load(
            ActionLoad.Args.Player(
                Player.Selected(
                    stream = source.stream,
                    streamRequest = source.request,
                    metaRequest = mutable.value.details.metaRequest,
                    subtitlesPath = source.request.path.copy(resource = "subtitles"),
                )
            ),
            Field.PLAYER,
        )
        return true
    }

    fun resumePosition(videoId: String): Long {
        val libraryItem = Core.getState<Player>(Field.PLAYER).libraryItem
        return libraryItem?.takeIf { it.state.videoId == videoId }?.state?.timeOffset?.toLong()
            ?: 0L
    }

    fun progress(position: Long, duration: Long, paused: Boolean) {
        if (duration <= 0) return
        Core.dispatch(
            Action(
                Action.Type.Player(
                    ActionPlayer(
                        ActionPlayer.Args.TimeChanged(
                            ActionPlayer.PlayerItemState(
                                position.coerceAtLeast(0),
                                duration,
                                "kino-android-tv",
                            )
                        )
                    )
                )
            ),
            Field.PLAYER,
        )
        Core.dispatch(
            Action(Action.Type.Player(ActionPlayer(ActionPlayer.Args.PausedChanged(paused)))),
            Field.PLAYER,
        )
    }

    fun seek(position: Long, duration: Long) {
        if (duration <= 0) return
        Core.dispatch(
            Action(
                Action.Type.Player(
                    ActionPlayer(
                        ActionPlayer.Args.SeekAction(
                            ActionPlayer.PlayerItemState(
                                position.coerceAtLeast(0),
                                duration,
                                "kino-android-tv",
                            )
                        )
                    )
                )
            ),
            Field.PLAYER,
        )
    }

    fun stopPlayer() {
        Core.dispatch(Action(Action.Type.Unload(Action.ActionUnload())), Field.PLAYER)
        loadLibrary()
    }

    private fun shelves(field: Field): List<Shelf> {
        val catalogs = Core.getState<CatalogsWithExtra>(field).catalogs
        if (catalogs.any { it.pages.firstOrNull()?.content == null }) {
            Core.dispatch(
                Action(
                    Action.Type.CatalogsWithExtra(
                        ActionCatalogsWithExtra(
                            ActionCatalogsWithExtra.Args.LoadRange(
                                com.stremio.core.runtime.msg.Range(0, catalogs.size)
                            )
                        )
                    )
                ),
                field,
            )
        }
        return catalogs.mapNotNull { catalog ->
            val first = catalog.pages.firstOrNull() ?: return@mapNotNull null
            if (first.addonId == "org.stremio.local") return@mapNotNull null
            Shelf(
                "${first.request.base}/${first.catalogType}/${first.catalogId}",
                first.title,
                catalog.pages
                    .flatMap { it.ready?.metaItems.orEmpty() }
                    .distinctBy { "${it.type}:${it.id}" }
                    .map { it.media() },
                catalog.pages.any { it.content == null || it.loading != null },
                catalog.pages.any { it.error != null },
            )
        }
    }

    private fun library(field: Field): List<Media> =
        Core.getState<LibraryWithFilters>(field).catalog.map {
            Media(
                it.id,
                it.type,
                it.name,
                it.poster,
                // Core exposes a percentage; the presentation uses a fraction of the poster width.
                progress = it.progress / 100.0,
                videoId = it.state.videoId,
                resume = field == Field.CONTINUE_WATCHING,
            )
        }

    private fun refresh() {
        if (!initialized) return
        try {
            val profile = Core.getState<Ctx>(Field.CTX).profile
            val detail = Core.getState<MetaDetails>(Field.META_DETAILS)
            val selection = detailSelection
            val current = selection != null && detail.selected == selection
            val metaResource = detail.metaItem?.takeIf { it.request.path == selection?.metaPath }
            val resources =
                detail.streams.filter {
                    current &&
                        selection?.streamPath != null &&
                        it.request.path == selection.streamPath &&
                        secureUrl(it.request.base)
                }
            val auth = Core.getState<AuthLink>(Field.AUTH_LINK)
            val signedIn = profile.auth != null
            if (linking && !authenticating && auth.data?.ready != null) {
                authenticating = true
                ctx(
                    ActionCtx.Args.Authenticate(
                        AuthRequest(
                            AuthRequest.Type.LoginWithToken(
                                AuthRequest.LoginWithToken(auth.data!!.ready!!.authKey)
                            )
                        )
                    )
                )
            }
            if (signedIn && !mutable.value.signedIn) {
                linking = false
                home()
                loadLibrary()
            }
            mutable.value =
                TvState(
                    ready = true,
                    shelves = shelves(Field.BOARD),
                    search = shelves(Field.SEARCH),
                    library = library(Field.LIBRARY),
                    continueWatching = library(Field.CONTINUE_WATCHING),
                    signedIn = signedIn,
                    audioLanguage = profile.settings.audioLanguage,
                    subtitleLanguage = profile.settings.subtitlesLanguage,
                    addons =
                        Core.getState<AddonsWithFilters>(Field.ADDONS)
                            .catalog
                            ?.ready
                            ?.items
                            .orEmpty()
                            .filter { it.manifest.id != "org.stremio.local" }
                            .map { it.manifest.name },
                    details =
                        Details(
                            meta = metaResource?.ready ?: mutable.value.details.meta,
                            metaRequest =
                                metaResource?.request ?: mutable.value.details.metaRequest,
                            lastUsedStream =
                                detail.lastUsedStream?.ready?.stream.takeIf { current },
                            sources =
                                resources.flatMap { resource ->
                                    resource.ready?.streams.orEmpty().map {
                                        Source(resource.title, it, resource.request)
                                    }
                                },
                            loading = metaResource == null || metaResource.loading != null,
                            sourcesLoading =
                                selection?.streamPath != null &&
                                    (!current || resources.any { it.loading != null }),
                            failed = metaResource?.error != null,
                            sourceErrors = resources.filter { it.error != null }.map { it.title },
                        ),
                    link = auth.code?.ready?.link,
                    qrCode = auth.code?.ready?.qrcode,
                    linkFailed = auth.code?.error != null,
                )
        } catch (_: Exception) {
            Log.e("KinoCore", "Core state could not be read")
        }
    }
}

fun MetaItemPreview.media() =
    Media(id, type, name, poster, background, description, releaseInfo, this)
