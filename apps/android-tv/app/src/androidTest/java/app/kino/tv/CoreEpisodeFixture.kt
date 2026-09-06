package app.kino.tv

import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.models.Ctx
import com.stremio.core.runtime.msg.*
import com.stremio.core.types.addon.*
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.atomic.AtomicReference

/** Only the benchmark JNI transport routes this reserved host to the loopback server. */
internal class CoreEpisodeFixture(
    private val activity: PlaybackProbeActivity,
    private val nextSeason: Int = 1,
    private val firstEpisode: Int = 1,
) : AutoCloseable {
    val seriesId = "kino-fixture-series"
    val firstVideoId = "$seriesId-1-$firstEpisode"
    private val nextEpisode = if (nextSeason == 1) firstEpisode + 1 else 1
    val secondVideoId = "$seriesId-$nextSeason-$nextEpisode"
    val media = Media(seriesId, "series", "Kino fixture", null)
    private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    private val failure = AtomicReference<Throwable>()
    private val earlierVideos =
        (1 until firstEpisode).joinToString("") {
            """{"id":"$seriesId-1-$it","title":"Earlier episode $it","season":1,"episode":$it,"released":"2020-01-01T00:00:00.000Z"},"""
        }
    private val addon =
        AddonDescriptor(
            manifest =
                Manifest(
                    id = "app.kino.fixture.upnext",
                    version = "1.0.0",
                    name = "Kino fixture",
                    types = listOf("series"),
                    resources =
                        listOf("meta", "stream").map {
                            ManifestResource(it, listOf("series"), listOf("kino-fixture"))
                        },
                    idPrefixes = listOf("kino-fixture"),
                    catalogs = emptyList(),
                    addonCatalogs = emptyList(),
                    behaviorHints = ManifestBehaviorHints(false, false, false, false),
                ),
            transportUrl = "https://kino-fixture.invalid/manifest.json",
            flags = DescriptorFlags(false, false),
            installed = false,
            installable = true,
            upgradeable = false,
            uninstallable = true,
        )
    private val thread =
        Thread {
                try {
                    while (!server.isClosed) server.accept().use { socket ->
                        socket.soTimeout = 5000
                        val reader = socket.getInputStream().bufferedReader()
                        val path = reader.readLine().split(' ')[1]
                        while (!reader.readLine().isNullOrEmpty()) {}
                        val body =
                            when {
                                path.startsWith("/meta/") ->
                                    """{"meta":{"id":"$seriesId","type":"series","name":"Kino fixture","videos":[$earlierVideos{"id":"$firstVideoId","title":"First episode","season":1,"episode":$firstEpisode,"released":"2020-01-01T00:00:00.000Z"},{"id":"$secondVideoId","title":"Second episode","season":$nextSeason,"episode":$nextEpisode,"released":"2020-01-02T00:00:00.000Z"}]}}"""
                                path.startsWith("/stream/") ->
                                    """{"streams":[{"url":"https://kino-fixture.invalid/video/${path.substringAfterLast('/').removeSuffix(".json")}.mp4"}]}"""
                                else -> "{}"
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

    fun uninstall() {
        dispatch(ActionCtx.Args.UninstallAddon(addon))
        dispatch(ActionCtx.Args.RemoveFromLibrary(seriesId))
    }

    private fun dispatch(args: ActionCtx.Args<*>) =
        Core.dispatch(Action(Action.Type.Ctx(ActionCtx(args))), Field.CTX)

    override fun close() {
        activity.configureCoreFixture(0)
        server.close()
        thread.join(6000)
        check(!thread.isAlive)
        failure.get()?.let { throw AssertionError("Core fixture failed", it) }
    }
}
