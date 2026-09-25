package app.kino.tv

import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.models.Ctx
import com.stremio.core.runtime.msg.*
import com.stremio.core.types.addon.*
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.net.URLDecoder
import java.util.Collections
import java.util.concurrent.atomic.AtomicReference

/**
 * A loopback catalog add-on for the browse gates: one movie catalog with a genre filter and `skip`
 * paging, and metadata for each of its titles. The unfiltered catalog holds [total] titles served [pageSize] at a time, so Core offers
 * further pages until an empty one; each genre holds a single page of its own titles.
 *
 * The add-on lives under its own path on the fixture host, so it never collides with the other
 * Core fixtures' add-on.
 */
internal class CoreCatalogFixture(
    private val activity: PlaybackProbeActivity,
    private val total: Int = 250,
    private val pageSize: Int = 100,
) : AutoCloseable {
    // The benchmark transport routes only this host to the loopback server.
    val base = "https://kino-fixture.invalid/browse/manifest.json"
    val catalogRequest =
        ResourceRequest(base, ResourcePath("catalog", "movie", "kino-popular", emptyList()))

    /** Catalog paths the add-on was asked for, in order, with their extras decoded. */
    val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    private val failure = AtomicReference<Throwable>()
    private val addon =
        AddonDescriptor(
            manifest =
                Manifest(
                    id = "app.kino.fixture.catalog",
                    version = "1.0.0",
                    name = "Kino catalog fixture",
                    types = listOf("movie"),
                    resources =
                        listOf(
                            ManifestResource("catalog", listOf("movie"), emptyList()),
                            ManifestResource("meta", listOf("movie"), listOf("kino-catalog")),
                        ),
                    idPrefixes = listOf("kino-catalog"),
                    catalogs =
                        listOf(
                            ManifestCatalog(
                                id = "kino-popular",
                                type = "movie",
                                name = "Kino popular",
                                extra =
                                    ManifestExtra(
                                        ManifestExtra.Extra.Full(
                                            FullManifestExtra(
                                                listOf(
                                                    ExtraProp("genre", false, listOf("Action", "Drama"), 1),
                                                    ExtraProp("skip", false, emptyList(), 1),
                                                )
                                            )
                                        )
                                    ),
                            )
                        ),
                    addonCatalogs = emptyList(),
                    behaviorHints = ManifestBehaviorHints(false, false, false, false),
                ),
            transportUrl = base,
            flags = DescriptorFlags(false, false),
            installed = false,
            installable = true,
            upgradeable = false,
            uninstallable = true,
        )

    private fun metas(prefix: String, from: Int, count: Int) =
        (from until from + count).joinToString(",") {
            """{"id":"kino-catalog-${prefix.lowercase()}-$it","type":"movie","name":"$prefix ${it + 1}"}"""
        }

    private val thread =
        Thread {
                try {
                    while (!server.isClosed) server.accept().use { socket ->
                        socket.soTimeout = 5000
                        val reader = socket.getInputStream().bufferedReader()
                        val path = URLDecoder.decode(reader.readLine().split(' ')[1], "UTF-8")
                        while (!reader.readLine().isNullOrEmpty()) {}
                        val body =
                            when {
                                path.startsWith("/browse/meta/movie/") -> {
                                    val id = path.substringAfterLast('/').removeSuffix(".json")
                                    """{"meta":{"id":"$id","type":"movie","name":"Fixture movie"}}"""
                                }
                                !path.startsWith("/browse/catalog/") -> "{}"
                                else -> {
                                    requests.add(path)
                                    val extra =
                                        path
                                            .removePrefix("/browse")
                                            .removeSuffix(".json")
                                            .split('/')
                                            .getOrNull(4)
                                            .orEmpty()
                                            .split('&')
                                            .mapNotNull {
                                                it.split('=', limit = 2).takeIf { pair -> pair.size == 2 }
                                            }
                                            .associate { (name, value) -> name to value }
                                    val skip = extra["skip"]?.toIntOrNull() ?: 0
                                    val genre = extra["genre"]
                                    val items =
                                        when {
                                            genre != null && skip == 0 -> metas(genre, 0, 20)
                                            genre != null -> ""
                                            skip < total ->
                                                metas("Fixture", skip, minOf(pageSize, total - skip))
                                            else -> ""
                                        }
                                    """{"metas":[$items]}"""
                                }
                            }.toByteArray()
                        socket.getOutputStream().apply {
                            write(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                                    .toByteArray()
                            )
                            write(body)
                            flush()
                        }
                    }
                } catch (error: Throwable) {
                    if (!(error is SocketException && server.isClosed)) failure.set(error)
                }
            }
            .apply { start() }

    /**
     * Main-thread Core boundary; the instrumentation application owns an isolated guest profile.
     */
    fun install() {
        check(Core.getState<Ctx>(Field.CTX).profile.auth == null)
        activity.configureCoreFixture(server.localPort)
        dispatch(ActionCtx.Args.InstallAddon(addon))
    }

    fun uninstall() = dispatch(ActionCtx.Args.UninstallAddon(addon))

    private fun dispatch(args: ActionCtx.Args<*>) =
        Core.dispatch(Action(Action.Type.Ctx(ActionCtx(args))), Field.CTX)

    override fun close() {
        activity.configureCoreFixture(0)
        server.close()
        thread.join(6000)
        check(!thread.isAlive)
        failure.get()?.let { throw AssertionError("Core catalog fixture failed", it) }
    }
}
