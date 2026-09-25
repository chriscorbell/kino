package app.kino.tv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.models.*
import com.stremio.core.runtime.msg.*
import com.stremio.core.types.addon.AddonDescriptor
import com.stremio.core.types.addon.ExtraValue
import com.stremio.core.types.addon.ResourcePath
import com.stremio.core.types.addon.ResourceRequest
import com.stremio.core.types.api.AuthRequest
import com.stremio.core.types.resource.MetaItem
import com.stremio.core.types.resource.MetaItemPreview
import com.stremio.core.types.resource.Stream
import com.stremio.core.types.resource.Video
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
    /** Library state: marked watched, and episodes released since it was last watched. */
    val watched: Boolean = false,
    val newVideos: Int = 0,
)

internal fun Media.entryVideoId() =
    if (resume) videoId ?: id.takeIf { type == "movie" } else id.takeIf { type == "movie" }

data class Shelf(
    val id: String,
    val title: String,
    val items: List<Media>,
    val loading: Boolean,
    val failed: Boolean,
    /** The catalog's own name, its content type, and the add-on that offers it. */
    val name: String = title,
    val type: String = "",
    val addon: String = "",
    /** Opens this catalog in Discover. */
    val request: ResourceRequest? = null,
)

data class Source(val provider: String, val stream: Stream, val request: ResourceRequest) {
    /** A torrent the engine can open: Core's torrent source with a well-formed info hash. */
    val torrent: Stream.Tramvai?
        get() = stream.tramvai?.takeIf { it.infoHash.matches(Regex("[0-9a-fA-F]{40}")) }

    val playable: Boolean
        get() =
            torrent != null ||
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

/** One choice in a Discover or Library selector, with the Core request that selects it. */
data class TvChoice<R>(val label: String?, val selected: Boolean, val request: R)

data class DiscoverFilter(val name: String, val options: List<TvChoice<ResourceRequest>>)

/** A Discover catalog: its selectors, the items loaded so far, and whether more pages exist. */
data class Discover(
    val types: List<TvChoice<ResourceRequest>> = emptyList(),
    val catalogs: List<TvChoice<ResourceRequest>> = emptyList(),
    val filters: List<DiscoverFilter> = emptyList(),
    val items: List<Media> = emptyList(),
    val loading: Boolean = true,
    val failed: Boolean = false,
    val more: Boolean = false,
)

/** The loaded pages of the library for one type and sort, and whether more exist. */
data class Library(
    val items: List<Media> = emptyList(),
    val types: List<TvChoice<LibraryWithFilters.LibraryRequest>> = emptyList(),
    val sorts: List<TvChoice<LibraryWithFilters.LibraryRequest>> = emptyList(),
    val more: Boolean = false,
)

/** A subtitle file an add-on offers for the current source. */
data class AddonPreview(
    val transportUrl: String,
    val descriptor: AddonDescriptor? = null,
    val loading: Boolean = true,
    val failed: Boolean = false,
)

data class AddonSubtitle(
    val id: String,
    val language: String,
    val url: String,
    val provider: String,
    val label: String?,
)

data class TvState(
    val ready: Boolean = false,
    val failed: Boolean = false,
    val shelves: List<Shelf> = emptyList(),
    val search: List<Shelf> = emptyList(),
    val library: List<Media> = emptyList(),
    val libraryPages: Library = Library(),
    val discover: Discover = Discover(),
    val continueWatching: List<Media> = emptyList(),
    val details: Details = Details(),
    val signedIn: Boolean = false,
    val audioLanguage: String? = null,
    val subtitleLanguage: String? = null,
    /** Installed add-ons in Core's order, with the flags that decide whether one can be removed. */
    val addons: List<AddonDescriptor> = emptyList(),
    /** The add-on a pasted address resolved to, awaiting confirmation. */
    val addonPreview: AddonPreview? = null,
    val link: String? = null,
    val qrCode: String? = null,
    val linkFailed: Boolean = false,
    val nextVideo: Video? = null,
    val subtitles: List<AddonSubtitle> = emptyList(),
    /** Sign-out has asked Stremio to end the session and waits for its answer. */
    val signingOut: Boolean = false,
)

fun secureUrl(value: String?): Boolean =
    try {
        val uri = URI(value ?: "")
        uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null
    } catch (_: Exception) {
        false
    }

/** The only presentation-facing boundary to the pinned Kotlin/JNI Core. */
class TvCore(
    context: Context,
    profile: String = "guest",
    private val storage: com.stremio.core.Storage = CoreStorage(context, profile),
) {
    private val handler = Handler(Looper.getMainLooper())
    private val mutable = MutableStateFlow(TvState())
    val state = mutable.asStateFlow()
    internal var playerGeneration = 0L
        private set

    internal val pendingPlaybackSave = TvPendingPlaybackSave()

    private var initialized = false
    private var linking = false
    private var authenticating = false
    private var detailSelection: MetaDetails.Selected? = null
    private var playerSelection: Player.Selected? = null
    private var discoverRequested = false

    /**
     * Fields Core reported changed since the last refresh. Only these are decoded again: reading
     * every model on every event decoded the whole library each time playback reported progress.
     */
    private val dirty = mutableSetOf<Field>()
    private val update = Runnable { refresh() }
    private val listener =
        Core.EventListener { event ->
            event.coreEvent?.let { core ->
                when {
                    core.sessionDeleted != null ->
                        handler.post { finishLogout(SessionEnd.Deleted) }
                    core.error?.source?.sessionDeleted != null ->
                        handler.post { finishLogout(SessionEnd.Refused) }
                }
            }
            val changed = event.newState?.fields ?: listOf(Field.CTX)
            synchronized(dirty) { dirty.addAll(changed) }
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

    internal suspend fun setLanguage(language: TvLanguage, subtitles: Boolean): Boolean {
        // UpdateSettings replaces every field. Read immediately before dispatch
        // so changing one language retains the rest of the local Core profile.
        val latest = Core.getState<Ctx>(Field.CTX).profile.settings
        ctx(
            ActionCtx.Args.UpdateSettings(
                if (subtitles) latest.copy(subtitlesLanguage = language.code)
                else latest.copy(audioLanguage = language.code)
            )
        )
        refresh()
        return Core.drainWrites(retry = true)
    }

    fun home() = load(ActionLoad.Args.CatalogsWithExtra(CatalogsWithExtra.Selected()), Field.BOARD)

    fun search(query: String) =
        load(
            ActionLoad.Args.Search(
                CatalogsWithExtra.Selected(extra = listOf(ExtraValue("search", query)))
            ),
            Field.SEARCH,
        )

    private var libraryRequest =
        LibraryWithFilters.LibraryRequest(sort = LibraryWithFilters.Sort.LAST_WATCHED, page = 1)

    fun loadLibrary() {
        load(
            ActionLoad.Args.LibraryWithFilters(
                LibraryWithFilters.Selected(libraryRequest.copy(page = 1))
            ),
            Field.LIBRARY,
        )
        load(
            ActionLoad.Args.LibraryWithFilters(
                LibraryWithFilters.Selected(
                    LibraryWithFilters.LibraryRequest(
                        sort = LibraryWithFilters.Sort.LAST_WATCHED,
                        page = 1,
                    )
                )
            ),
            Field.CONTINUE_WATCHING,
        )
    }

    /** Shows the library for another type or sort, from its first page. */
    fun selectLibrary(request: LibraryWithFilters.LibraryRequest) {
        libraryRequest = request.copy(page = 1)
        load(
            ActionLoad.Args.LibraryWithFilters(LibraryWithFilters.Selected(libraryRequest)),
            Field.LIBRARY,
        )
    }

    fun loadMoreLibrary() {
        if (!mutable.value.libraryPages.more) return
        Core.dispatch(
            Action(
                Action.Type.LibraryWithFilters(
                    ActionLibraryWithFilters(ActionLibraryWithFilters.Args.LoadNextPage(Empty()))
                )
            ),
            Field.LIBRARY,
        )
    }

    /**
     * Opens Discover on [request], or on the first home catalog when none is chosen yet. Core
     * needs a concrete catalog to start from; its selectors then offer every other one.
     */
    fun discover(request: ResourceRequest? = null) {
        val target =
            request
                ?: Core.getState<CatalogsWithExtra>(Field.BOARD)
                    .catalogs
                    .firstNotNullOfOrNull { catalog ->
                        catalog.pages.firstOrNull()?.request?.takeIf {
                            catalog.pages.first().addonId != "org.stremio.local"
                        }
                    }
                ?: return
        discoverRequested = true
        load(
            ActionLoad.Args.CatalogWithFilters(CatalogWithFilters.Selected(target)),
            Field.DISCOVER,
        )
    }

    /** Opens Discover on the first Board catalog, unless a catalog was already chosen. */
    fun openDiscover() {
        if (!discoverRequested) discover()
    }

    fun loadMoreDiscover() {
        if (!mutable.value.discover.more) return
        Core.dispatch(
            Action(
                Action.Type.CatalogWithFilters(
                    ActionCatalogWithFilters(ActionCatalogWithFilters.Args.LoadNextPage(Empty()))
                )
            ),
            Field.DISCOVER,
        )
    }

    fun open(media: Media, videoId: String? = media.entryVideoId()) {
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

    /** Core rewinds the item's progress, which takes it out of Continue Watching. */
    fun removeFromContinueWatching(media: Media) =
        ctx(ActionCtx.Args.RewindLibraryItem(media.id))

    private fun metaDetails(args: ActionMetaDetails.Args<*>) =
        Core.dispatch(
            Action(Action.Type.MetaDetails(ActionMetaDetails(args))),
            Field.META_DETAILS,
        )

    /**
     * Marks the open title. Core records it on the title's library item, which it creates for a
     * title outside the library, so these work from any details page without adding the title.
     */
    fun markWatched(watched: Boolean) = metaDetails(ActionMetaDetails.Args.MarkAsWatched(watched))

    fun markVideoWatched(video: Video, watched: Boolean) =
        metaDetails(
            ActionMetaDetails.Args.MarkVideoAsWatched(ActionMetaDetails.VideoState(video, watched))
        )

    fun markSeasonWatched(season: Int, watched: Boolean) =
        metaDetails(
            ActionMetaDetails.Args.MarkSeasonAsWatched(
                ActionMetaDetails.MarkSeasonAsWatchedArgs(season, watched)
            )
        )

    enum class SessionEnd {
        /** Stremio confirmed the session is gone. */
        Deleted,
        /** Stremio answered with an error, such as a session it no longer knows. */
        Refused,
        /** No answer in time, as on a TV that is offline. */
        TimedOut,
    }

    private val LogoutTimeoutMs = 10_000L
    private var logoutDone: ((SessionEnd) -> Unit)? = null
    private val logoutTimeout = Runnable { finishLogout(SessionEnd.TimedOut) }

    /**
     * Ends the Stremio session rather than only forgetting it: Core asks the API to delete the
     * session, then resets its own profile. [onDone] runs once Stremio answered or ten seconds
     * passed, so a TV without a connection still signs out locally.
     */
    fun logout(onDone: (SessionEnd) -> Unit) {
        if (logoutDone != null) return
        val signedIn = initialized && Core.getState<Ctx>(Field.CTX).profile.auth != null
        logoutDone = onDone
        mutable.value = mutable.value.copy(signingOut = true)
        ctx(ActionCtx.Args.Logout(Empty()))
        if (signedIn) handler.postDelayed(logoutTimeout, LogoutTimeoutMs)
        else finishLogout(SessionEnd.Deleted)
    }

    private fun finishLogout(end: SessionEnd) {
        handler.removeCallbacks(logoutTimeout)
        val done = logoutDone ?: return
        logoutDone = null
        Log.i("KinoCore", "Sign-out finished session=${end.name.lowercase()}")
        done(end)
    }

    private var previewUrl: String? = null

    /**
     * Asks Core to fetch the manifest behind [input], an HTTPS manifest address or a
     * `stremio://` link, under the same request policy as every other add-on request.
     * Returns false for an address that could never be an add-on.
     */
    fun previewAddon(input: String): Boolean {
        val url = addonManifestUrl(input) ?: return false
        previewUrl = url
        mutable.value = mutable.value.copy(addonPreview = AddonPreview(url))
        load(ActionLoad.Args.AddonDetails(AddonDetails.Selected(url)), Field.ADDON_DETAILS)
        return true
    }

    fun cancelAddonPreview() {
        previewUrl = null
        mutable.value = mutable.value.copy(addonPreview = null)
    }

    /**
     * Installs the previewed add-on; Core rejects a manifest it cannot use. A new configuration of
     * an installed add-on replaces it: the old one is removed only once Core holds the new one, and
     * only when both are the same add-on, so a failed install never loses the working
     * configuration.
     */
    fun installPreviewedAddon(replacing: AddonDescriptor? = null): Boolean {
        val descriptor = mutable.value.addonPreview?.descriptor ?: return false
        ctx(ActionCtx.Args.InstallAddon(descriptor))
        // Core applies an install synchronously, and the installed add-ons model follows it.
        val installed =
            Core.getState<AddonsWithFilters>(Field.ADDONS).catalog?.ready?.items.orEmpty()
        if (installed.none { it.transportUrl == descriptor.transportUrl }) return false
        cancelAddonPreview()
        installed
            .firstOrNull { it.transportUrl == replacing?.transportUrl }
            ?.takeIf {
                it.transportUrl != descriptor.transportUrl &&
                    it.manifest.id == descriptor.manifest.id &&
                    !it.flags.protected
            }
            ?.let { ctx(ActionCtx.Args.UninstallAddon(it)) }
        return true
    }

    /** Protected add-ons, such as Cinemeta, stay installed. */
    fun uninstallAddon(addon: AddonDescriptor) {
        if (addon.flags.protected) return
        ctx(ActionCtx.Args.UninstallAddon(addon))
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
        if (
            pendingPlaybackSave.status.value != TvPendingPlaybackSave.Status.Idle ||
                !source.playable ||
                source.request.path != detailSelection?.streamPath
        )
            return false
        playerGeneration++
        val selected =
            Player.Selected(
                stream = source.stream,
                streamRequest = source.request,
                metaRequest = mutable.value.details.metaRequest,
                subtitlesPath = source.request.path.copy(resource = "subtitles"),
            )
        playerSelection = selected
        mutable.value = mutable.value.copy(nextVideo = null, subtitles = emptyList())
        load(ActionLoad.Args.Player(selected), Field.PLAYER)
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

    /**
     * Reports the playing file's parameters, which is what makes Core ask the add-ons for its
     * subtitles. Only metadata the source supplied is forwarded: a URL or torrent hash is not a
     * video hash, and unknown values still let add-ons match by media ID.
     */
    fun videoParams(stream: Stream) {
        val hints = stream.behaviorHints
        Core.dispatch(
            Action(
                Action.Type.Player(
                    ActionPlayer(
                        ActionPlayer.Args.VideoParamsChanged(
                            Player.VideoParams(
                                hash = hints.videoHash?.takeIf { it.matches(Regex("[a-fA-F0-9]{16}")) },
                                size = hints.videoSize?.takeIf { it > 0 },
                                filename = hints.filename?.takeIf { it.isNotBlank() },
                            )
                        )
                    )
                )
            ),
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
        playerGeneration++
        playerSelection = null
        mutable.value = mutable.value.copy(nextVideo = null, subtitles = emptyList())
        Core.dispatch(Action(Action.Type.Unload(Action.ActionUnload())), Field.PLAYER)
        loadLibrary()
        // Browse models deferred during playback are read now, before anything can start another
        // player and defer them again.
        handler.removeCallbacks(update)
        refresh()
    }

    private fun shelves(field: Field): List<Shelf> {
        // Loaded at startup; names the add-on behind a row when two rows read the same.
        val addonNames =
            Core.getState<AddonsWithFilters>(Field.ADDONS).catalog?.ready?.items.orEmpty().associate {
                it.transportUrl to it.manifest.name
            }
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
                name = first.catalogName?.takeIf { it.isNotBlank() } ?: first.title,
                type = first.catalogType.orEmpty(),
                addon = addonNames[first.request.base] ?: first.addonId.orEmpty(),
                request = first.request,
            )
        }
    }

    private fun libraryItems(model: LibraryWithFilters, resume: Boolean): List<Media> =
        model.catalog.map {
            Media(
                it.id,
                it.type,
                it.name,
                it.poster,
                // Core exposes a percentage; the presentation uses a fraction of the poster width.
                progress = it.progress / 100.0,
                videoId = it.state.videoId,
                resume = resume,
                watched = it.watched,
                newVideos = it.notifications.coerceIn(0, Int.MAX_VALUE.toLong()).toInt(),
            )
        }

    private fun libraryPages(model: LibraryWithFilters) =
        Library(
            items = libraryItems(model, resume = false),
            types = model.selectable.types.map { TvChoice(it.type, it.selected, it.request) },
            sorts =
                model.selectable.sorts.map { TvChoice(it.sort.name, it.selected, it.request) },
            more = model.selectable.nextPage != null,
        )

    private fun discover(model: CatalogWithFilters): Discover {
        val pages = model.catalog.pages
        return Discover(
            types = model.selectable.types.map { TvChoice(it.type, it.selected, it.request) },
            catalogs = model.selectable.catalogs.map { TvChoice(it.name, it.selected, it.request) },
            filters =
                model.selectable.extra
                    .filter { it.options.isNotEmpty() }
                    .map { extra ->
                        DiscoverFilter(
                            extra.name,
                            extra.options.map { TvChoice(it.value, it.selected, it.request) },
                        )
                    },
            items =
                pages
                    .flatMap { it.ready?.metaItems.orEmpty() }
                    .distinctBy { "${it.type}:${it.id}" }
                    .map { it.media() },
            loading = pages.isEmpty() || pages.any { it.content == null || it.loading != null },
            failed = pages.isNotEmpty() && pages.all { it.error != null },
            more = model.selectable.nextPage != null,
        )
    }

    /** Browse models change while playback reports progress; nothing shows them until it ends. */
    private val deferredDuringPlayback =
        setOf(Field.BOARD, Field.SEARCH, Field.LIBRARY, Field.CONTINUE_WATCHING, Field.DISCOVER)

    private fun refresh() {
        if (!initialized) return
        val first = !mutable.value.ready
        val changed =
            synchronized(dirty) {
                val ready =
                    if (playerSelection == null) dirty.toSet()
                    else dirty.filterNot { it in deferredDuringPlayback }.toSet()
                dirty.removeAll(ready)
                ready
            }
        fun reads(field: Field) = first || field in changed
        try {
            val previous = mutable.value
            val profile = Core.getState<Ctx>(Field.CTX).profile
            val selection = detailSelection
            val detailState =
                if (reads(Field.META_DETAILS)) {
                    val detail = Core.getState<MetaDetails>(Field.META_DETAILS)
                    val current = selection != null && detail.selected == selection
                    val metaResource =
                        detail.metaItem?.takeIf { it.request.path == selection?.metaPath }
                    val resources =
                        detail.streams.filter {
                            current &&
                                selection?.streamPath != null &&
                                it.request.path == selection.streamPath &&
                                secureUrl(it.request.base)
                        }
                    Details(
                        meta = metaResource?.ready ?: previous.details.meta,
                        metaRequest = metaResource?.request ?: previous.details.metaRequest,
                        lastUsedStream = detail.lastUsedStream?.ready?.stream.takeIf { current },
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
                    )
                } else previous.details
            val auth =
                if (reads(Field.AUTH_LINK)) Core.getState<AuthLink>(Field.AUTH_LINK) else null
            // Read once at the Core event boundary, not on the playback position ticker.
            val player =
                if (reads(Field.PLAYER)) playerSelection?.let { Core.getState<Player>(Field.PLAYER) }
                else null
            val subtitles =
                if (!reads(Field.PLAYER)) previous.subtitles
                else
                    player
                        ?.subtitles
                        .orEmpty()
                        .filter {
                            it.request.path == playerSelection?.subtitlesPath &&
                                secureUrl(it.request.base)
                        }
                        .flatMap { resource ->
                            resource.ready?.subtitles.orEmpty().map {
                                AddonSubtitle(it.id, it.lang, it.url, resource.title, it.name)
                            }
                        }
                        .filter { secureUrl(it.url) }
            val nextVideo =
                if (!reads(Field.PLAYER)) previous.nextVideo
                else
                    player
                        ?.takeIf {
                            // Core rebuilds stream deep links for each model. Match the
                            // actual source and requests, not those derived navigation links.
                            val selected = it.selected
                            selected != null &&
                                selected.streamRequest == playerSelection?.streamRequest &&
                                selected.metaRequest == playerSelection?.metaRequest &&
                                selected.stream.source == playerSelection?.stream?.source &&
                                selected.stream.behaviorHints.proxyHeaders ==
                                    playerSelection?.stream?.behaviorHints?.proxyHeaders
                        }
                        ?.nextVideo
                        ?.takeIf {
                            playerSelection?.streamRequest?.path?.type == "series" &&
                                it.id != playerSelection?.streamRequest?.path?.id &&
                                !it.upcoming
                        }
            val signedIn = profile.auth != null
            if (linking && !authenticating && auth?.data?.ready != null) {
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
            if (signedIn && !previous.signedIn && previous.ready) {
                linking = false
                home()
                loadLibrary()
            }
            val library =
                if (reads(Field.LIBRARY))
                    libraryPages(Core.getState<LibraryWithFilters>(Field.LIBRARY))
                else previous.libraryPages
            mutable.value =
                previous.copy(
                    ready = true,
                    failed = false,
                    shelves = if (reads(Field.BOARD)) shelves(Field.BOARD) else previous.shelves,
                    search = if (reads(Field.SEARCH)) shelves(Field.SEARCH) else previous.search,
                    library = library.items,
                    libraryPages = library,
                    continueWatching =
                        if (reads(Field.CONTINUE_WATCHING))
                            libraryItems(
                                Core.getState<LibraryWithFilters>(Field.CONTINUE_WATCHING),
                                resume = true,
                            )
                        else previous.continueWatching,
                    discover =
                        if (discoverRequested && reads(Field.DISCOVER))
                            discover(Core.getState<CatalogWithFilters>(Field.DISCOVER))
                        else previous.discover,
                    signedIn = signedIn,
                    audioLanguage = profile.settings.audioLanguage,
                    subtitleLanguage = profile.settings.subtitlesLanguage,
                    addons =
                        if (reads(Field.ADDONS))
                            Core.getState<AddonsWithFilters>(Field.ADDONS)
                                .catalog
                                ?.ready
                                ?.items
                                .orEmpty()
                                .filter { it.manifest.id != "org.stremio.local" }
                        else previous.addons,
                    addonPreview =
                        if (!reads(Field.ADDON_DETAILS)) previous.addonPreview
                        else
                            previewUrl?.let { url ->
                                val remote =
                                    Core.getState<AddonDetails>(Field.ADDON_DETAILS)
                                        .remoteAddon
                                        ?.takeIf { it.transportUrl == url }
                                AddonPreview(
                                    url,
                                    remote?.ready,
                                    loading = remote == null || remote.loading != null,
                                    failed = remote?.error != null,
                                )
                            },
                    details = detailState,
                    link = if (auth != null) auth.code?.ready?.link else previous.link,
                    qrCode = if (auth != null) auth.code?.ready?.qrcode else previous.qrCode,
                    linkFailed = if (auth != null) auth.code?.error != null else previous.linkFailed,
                    nextVideo = nextVideo,
                    subtitles = subtitles,
                )
        } catch (_: Exception) {
            Log.e("KinoCore", "Core state could not be read")
        }
    }

}

fun MetaItemPreview.media() =
    Media(id, type, name, poster, background, description, releaseInfo, this)
