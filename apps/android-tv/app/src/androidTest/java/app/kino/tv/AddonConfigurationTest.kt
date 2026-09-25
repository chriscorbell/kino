@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import android.content.Intent
import android.view.KeyEvent
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.types.addon.AddonDescriptor
import com.stremio.core.types.addon.DescriptorFlags
import com.stremio.core.types.addon.Manifest
import com.stremio.core.types.addon.ManifestBehaviorHints
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Add-on configuration on the TV: the settings page beside a manifest, and the phone page the TV
 * serves on the home network. The test plays the phone over the Shield's own network address,
 * sends a new configuration, and confirms it on the TV, which replaces the old one.
 */
class AddonConfigurationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)
    private val core = (context.applicationContext as KinoApplication).core

    private fun descriptor(url: String, configurable: Boolean, required: Boolean = false) =
        AddonDescriptor(
            manifest =
                Manifest(
                    id = "fixture",
                    version = "1.0.0",
                    name = "Fixture",
                    types = emptyList(),
                    resources = emptyList(),
                    idPrefixes = emptyList(),
                    catalogs = emptyList(),
                    addonCatalogs = emptyList(),
                    behaviorHints = ManifestBehaviorHints(false, false, configurable, required),
                ),
            transportUrl = url,
            flags = DescriptorFlags(false, false),
            installed = true,
            installable = false,
            upgradeable = false,
            uninstallable = true,
        )

    @Test
    fun theSettingsPageSitsBesideTheManifest() {
        assertEquals(
            "https://example.invalid/a/b/configure",
            addonConfigurationUrl(descriptor("https://example.invalid/a/b/manifest.json", true)),
        )
        assertEquals(
            "https://example.invalid/configure",
            addonConfigurationUrl(descriptor("https://example.invalid/manifest.json", false, true)),
        )
        assertNull(addonConfigurationUrl(descriptor("https://example.invalid/manifest.json", false)))
        assertNull(addonConfigurationUrl(descriptor("http://example.invalid/manifest.json", true)))
    }

    @Test
    fun aPhoneSendsANewConfigurationThatReplacesTheOld() {
        val activity = start()
        val fixture = AddonFixture(activity)
        val name = AddonFixture.CONFIGURABLE
        val configured = "stremio://kino-fixture.invalid/settings/eyJxdWFsaXR5IjoiNGsifQ/manifest.json"
        try {
            show(activity, fixture)
            // An installed configuration, as an account syncs it or an earlier install left it.
            instrumentation.runOnMainSync { core.previewAddon(fixture.plain) }
            remote.waitUntil("Core finds the fixture add-on") {
                core.state.value.addonPreview?.descriptor != null
            }
            instrumentation.runOnMainSync { assertTrue(core.installPreviewedAddon()) }
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_DOWN, "The add-on's row comes into view") {
                remote.node(name) != null
            }
            remote.focus(name)
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor(context.getString(R.string.remove_addon))
            remote.focusExact(context.getString(R.string.configure_addon))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor(context.getString(R.string.handoff_scan))
            // The dialog window takes its panel's width rather than the platform's narrower one.
            assertTrue("The dialog is ${remote.windowWidthDp()} dp wide", remote.windowWidthDp() >= 820f)
            assertNull(
                "Typing waits to be asked for, so the keyboard leaves the QR code visible",
                remote.node(context.getString(R.string.addon_url_hint)),
            )
            val page = pageAddress()

            val opened = Phone.get(page)
            assertEquals(200, opened.status)
            assertEquals("no-referrer", opened.headers["referrer-policy"])
            assertTrue(
                "The phone page links to the add-on's settings",
                opened.body.contains("href=\"https://kino-fixture.invalid/settings/configure\""),
            )
            val elsewhere = URI(page).resolve("/not-the-token").toString()
            assertEquals("Only the page's own address answers", 404, Phone.get(elsewhere).status)

            val refused = Phone.post(page, "https://kino-fixture.invalid/settings/configure")
            assertTrue(
                "An address that is no add-on is refused on the phone",
                refused.body.contains(html(context.getString(R.string.addon_invalid))),
            )
            assertNull(core.state.value.addonPreview)

            val sent = Phone.post(page, configured)
            assertTrue(sent.body.contains(html(context.getString(R.string.handoff_sent_title))))
            remote.waitFor(context.getString(R.string.addon_replaces))
            remote.focusExact(context.getString(R.string.install))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("The new configuration replaces the old one") {
                val urls = core.state.value.addons.map { it.transportUrl }
                addonManifestUrl(configured) in urls && fixture.plain !in urls
            }
            assertFalse("The page closes with its dialog", Phone.reachable(page))
        } finally {
            finish(activity, fixture)
        }
    }

    @Test
    fun anAddonThatNeedsSettingsIsConfiguredBeforeItInstalls() {
        val activity = start()
        val fixture = AddonFixture(activity)
        try {
            show(activity, fixture)
            remote.focus(context.getString(R.string.install_addon))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor(context.getString(R.string.handoff_scan))
            val install = pageAddress()
            assertFalse(
                "Installing has no settings to link to",
                Phone.get(install).body.contains("/configure\""),
            )
            Phone.post(install, fixture.required)
            remote.waitFor(context.getString(R.string.addon_needs_setup))
            assertNull(remote.node(context.getString(R.string.install)))
            remote.focusExact(context.getString(R.string.configure_addon))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor(
                context.getString(R.string.configure_addon_title, AddonFixture.REQUIRED)
            )
            val settings = Phone.get(pageAddress()).body
            assertTrue(settings.contains("href=\"https://kino-fixture.invalid/required/configure\""))
            assertFalse(
                "Nothing is installed before its settings are chosen",
                core.state.value.addons.any { it.manifest.name == AddonFixture.REQUIRED },
            )
        } finally {
            finish(activity, fixture)
        }
    }

    private fun start() =
        instrumentation.startActivitySync(
            Intent(context, PlaybackProbeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ) as PlaybackProbeActivity

    private fun show(activity: PlaybackProbeActivity, fixture: AddonFixture) {
        instrumentation.runOnMainSync {
            core.initialize()
            fixture.route()
            activity.setContent {
                KinoTheme {
                    val state by core.state.collectAsState()
                    AddonsScreen(state, core)
                }
            }
        }
        remote.waitFor(context.getString(R.string.addon_built_in))
    }

    private fun finish(activity: PlaybackProbeActivity, fixture: AddonFixture) {
        instrumentation.runOnMainSync {
            core.cancelAddonPreview()
            core.state.value.addons
                .filter { it.transportUrl.startsWith("https://kino-fixture.invalid/") }
                .forEach(core::uninstallAddon)
            activity.finish()
        }
        fixture.close()
    }

    /** The phone page's address, as the TV prints it beneath the QR code. */
    private fun pageAddress(): String {
        val shown = remote.node("http://")?.text?.toString()
        assertNotNull("The dialog shows the phone page's address", shown)
        assertTrue(
            "The page is on the home network: $shown",
            shown!!.matches(Regex("""http://(\d+\.){3}\d+:\d+/[\w-]{22}""")),
        )
        return shown
    }

    private fun html(text: String) = text.replace("'", "&#39;")

    /**
     * The phone, speaking plain HTTP over a socket. The app's network policy allows cleartext only
     * to loopback, which is right for the app and does not apply to a raw socket.
     */
    private object Phone {
        class Reply(val status: Int, val headers: Map<String, String>, val body: String)

        fun get(url: String) = request("GET", url, null)

        fun post(url: String, address: String) =
            request("POST", url, "address=" + URLEncoder.encode(address, "UTF-8"))

        fun reachable(url: String): Boolean {
            val uri = URI(url)
            return try {
                Socket().use { it.connect(InetSocketAddress(uri.host, uri.port), 2_000) }
                true
            } catch (_: IOException) {
                false
            }
        }

        private fun request(method: String, url: String, form: String?): Reply {
            val uri = URI(url)
            Socket().use { socket ->
                socket.connect(InetSocketAddress(uri.host, uri.port), 5_000)
                socket.soTimeout = 5_000
                val body = form?.toByteArray() ?: ByteArray(0)
                val head =
                    "$method ${uri.rawPath} HTTP/1.1\r\nHost: ${uri.host}:${uri.port}\r\n" +
                        (if (form != null)
                            "Content-Type: application/x-www-form-urlencoded\r\n" +
                                "Content-Length: ${body.size}\r\n"
                        else "") +
                        "Connection: close\r\n\r\n"
                socket.getOutputStream().apply {
                    write(head.toByteArray())
                    write(body)
                    flush()
                }
                val reply = socket.getInputStream().readBytes().toString(Charsets.UTF_8)
                val (top, content) = reply.split("\r\n\r\n", limit = 2)
                val lines = top.split("\r\n")
                return Reply(
                    lines.first().split(' ')[1].toInt(),
                    lines.drop(1).associate {
                        it.substringBefore(':').trim().lowercase() to it.substringAfter(':').trim()
                    },
                    content,
                )
            }
        }
    }
}

/**
 * Loopback add-ons for the configuration gate: one that can be configured, under any settings
 * path, and one that must be configured before it installs.
 */
internal class AddonFixture(private val activity: PlaybackProbeActivity) : AutoCloseable {
    companion object {
        const val CONFIGURABLE = "Kino configurable fixture"
        const val REQUIRED = "Kino settings fixture"
    }

    val plain = "https://kino-fixture.invalid/settings/manifest.json"
    val required = "https://kino-fixture.invalid/required/manifest.json"
    private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    private val failure = AtomicReference<Throwable>()

    private fun manifest(id: String, name: String, hints: String) =
        """{"id":"$id","version":"1.0.0","name":"$name","description":"A loopback add-on.",""" +
            """"types":["movie"],"resources":["stream"],"idPrefixes":["kino-config"],""" +
            """"catalogs":[],"behaviorHints":{$hints}}"""

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
                                path == "/required/manifest.json" ->
                                    manifest(
                                        "app.kino.fixture.required",
                                        REQUIRED,
                                        """"configurable":true,"configurationRequired":true""",
                                    )
                                path.startsWith("/settings/") && path.endsWith("/manifest.json") ->
                                    manifest("app.kino.fixture.settings", CONFIGURABLE, """"configurable":true""")
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

    fun route() = activity.configureCoreFixture(server.localPort)

    override fun close() {
        activity.configureCoreFixture(0)
        server.close()
        thread.join(6000)
        check(!thread.isAlive)
        failure.get()?.let { throw AssertionError("Add-on fixture failed", it) }
    }
}
