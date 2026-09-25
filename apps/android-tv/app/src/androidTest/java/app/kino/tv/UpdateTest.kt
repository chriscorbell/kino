package app.kino.tv

import android.content.Intent
import android.os.ParcelFileDescriptor
import android.view.KeyEvent
import androidx.activity.compose.setContent
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The TV update path: the desktop's release rules, a download checked against the release's
 * checksum and the installed app's signer before Android sees it, and Android's installer, which
 * asks before anything is installed.
 */
class UpdateTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)

    private fun sha256(bytes: ByteArray) =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /** GitHub, answered from memory: each request is recorded and served from [files] or 404. */
    private fun github(files: Map<String, ByteArray>, requests: MutableList<String>) =
        OkHttpClient.Builder()
            .addInterceptor { chain ->
                val url = chain.request().url.toString()
                requests += url
                val body = files[url]
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(if (body != null) 200 else 404)
                    .message("")
                    .body((body ?: ByteArray(0)).toResponseBody("application/octet-stream".toMediaType()))
                    .build()
            }
            .build()

    private fun copy(path: String, name: String) =
        File(context.cacheDir, name).apply { writeBytes(File(path).readBytes()) }

    private fun shell(command: String): ByteArray =
        ParcelFileDescriptor.AutoCloseInputStream(
                instrumentation.uiAutomation.executeShellCommand(command)
            )
            .use { it.readBytes() }

    private fun refused(reason: UpdateRefusal, block: () -> Unit) {
        try {
            block()
            fail("Expected the update to be refused for $reason")
        } catch (refusal: UpdateRefused) {
            assertEquals(reason, refusal.reason)
        }
    }

    @Test
    fun versionsOrderAsTheDesktopOrdersThem() {
        for ((newer, older) in
            listOf(
                "0.10.0" to "0.9.0",
                "1.0.0" to "1.0.0-rc.1",
                "1.0.0-beta.10" to "1.0.0-beta.9",
                "1.0.0-beta" to "1.0.0-1",
                "1.0.0-rc.1" to "1.0.0-rc",
            )) {
            assertEquals("$newer after $older", 1, compareKinoVersions(newer, older))
            assertEquals("$older before $newer", -1, compareKinoVersions(older, newer))
        }
        assertEquals(0, compareKinoVersions("v1.0.0+build.1", "1.0.0+build.2"))
        for (bad in listOf("1.0", "01.2.3", "1.0.0-01", "1.0.0-", "<script>", "1.0.0/../other"))
            assertNull(bad, compareKinoVersions(bad, "1.0.0"))
    }

    @Test
    fun theChannelFollowsTheInstalledVersion() {
        val feed =
            """[{"tag_name":"v0.3.0-beta.1","draft":false,"prerelease":true},
                {"tag_name":"v0.2.0","draft":false,"prerelease":false},
                {"tag_name":"v0.4.0","draft":true,"prerelease":false}]"""
        // A preview build follows every published release, previews included; drafts never count.
        assertEquals(KinoRelease("0.3.0-beta.1", "v0.3.0-beta.1"), newestRelease("0.2.0-beta.1", feed))
        // A stable build reads the latest release only.
        val latest = """{"tag_name":"v0.2.0","draft":false,"prerelease":false}"""
        assertEquals(KinoRelease("0.2.0", "v0.2.0"), newestRelease("0.1.0", latest))
        assertNull(newestRelease("0.2.0", latest))
        assertTrue(
            "A malformed tag fails the check",
            runCatching {
                    newestRelease("0.1.0", """{"tag_name":"../x","draft":false,"prerelease":false}""")
                }
                .isFailure,
        )
        assertEquals(
            "https://github.com/chriscorbell/kino/releases/download/v0.2.0/Kino-TV-0.2.0.apk",
            UpdateSource().asset(KinoRelease("0.2.0", "v0.2.0"), "Kino-TV-0.2.0.apk").toString(),
        )
        assertEquals("a".repeat(64), listedChecksum("${"a".repeat(64)}  Kino-TV-1.apk\n", "Kino-TV-1.apk"))
        assertNull(listedChecksum("${"a".repeat(64)}  Kino-TV-1.apk.old\n", "Kino-TV-1.apk"))
    }

    @Test
    fun aDownloadIsCheckedBeforeAndroidSeesIt() = runBlocking {
        val release = KinoRelease("9.0.0", "v9.0.0")
        val apk = File(context.applicationInfo.sourceDir).readBytes()
        val base = "https://github.com/chriscorbell/kino/releases/download/v9.0.0/"
        val requests = mutableListOf<String>()
        val source =
            UpdateSource(
                client =
                    github(
                        mapOf(
                            base + "SHA256SUMS" to
                                "${sha256(apk)}  Kino-TV-9.0.0.apk\n${"b".repeat(64)}  Kino-9.0.0-arm64.dmg\n"
                                    .toByteArray(),
                            base + "Kino-TV-9.0.0.apk" to apk,
                        ),
                        requests,
                    )
            )
        val (file, checksum) = downloadUpdate(context, release, source) {}
        assertEquals(listOf(base + "SHA256SUMS", base + "Kino-TV-9.0.0.apk"), requests)
        assertEquals(sha256(apk), checksum)
        assertArrayEquals(apk, file.readBytes())

        // The installed app, as if it were one build older: the same APK is then a valid update.
        // A parcel copy, since Android caches and shares the PackageInfo it returns.
        val older =
            android.os.Parcel.obtain().run {
                installedPackage(context).writeToParcel(this, 0)
                setDataPosition(0)
                android.content.pm.PackageInfo.CREATOR.createFromParcel(this).also { recycle() }
            }
        older.longVersionCode -= 1
        verifyUpdate(context, file, checksum, older)
        refused(UpdateRefusal.NotNewer) {
            verifyUpdate(context, file, checksum, installedPackage(context))
        }
        refused(UpdateRefusal.Checksum) { verifyUpdate(context, file, "0".repeat(64), older) }
        val instrumentationApk =
            copy(instrumentation.context.applicationInfo.sourceDir, "not-kino.apk")
        refused(UpdateRefusal.Package) {
            verifyUpdate(context, instrumentationApk, sha256(instrumentationApk.readBytes()), older)
        }
        // pnpm android:check re-signs this build with a throwaway key and leaves it here.
        val otherKey = shell("cat /data/local/tmp/kino-other-key.apk")
        assertTrue(
            "The re-signed fixture is missing; run pnpm android:check",
            otherKey.size > 1_000_000,
        )
        val otherKeyApk = File(context.cacheDir, "other-key.apk").apply { writeBytes(otherKey) }
        refused(UpdateRefusal.Signer) {
            verifyUpdate(context, otherKeyApk, sha256(otherKey), older)
        }

        // A release whose checksums do not list the APK is refused before it is downloaded.
        requests.clear()
        val unlisted =
            UpdateSource(
                client = github(mapOf(base + "SHA256SUMS" to "${sha256(apk)}  other.apk\n".toByteArray()), requests)
            )
        val refusal = runCatching { downloadUpdate(context, release, unlisted) {} }.exceptionOrNull()
        assertEquals(UpdateRefusal.Checksum, (refusal as? UpdateRefused)?.reason)
        assertEquals(listOf(base + "SHA256SUMS"), requests)
    }

    @Test
    fun androidAsksBeforeInstallingAndBackCancels() {
        // Android ends the process when this permission changes, so pnpm android:check grants it
        // before the run, as a viewer does on the Allow screen.
        assertTrue(
            "Kino may not install apps; run pnpm android:check",
            context.packageManager.canRequestPackageInstalls(),
        )
        val apk = copy(context.applicationInfo.sourceDir, "same-build.apk")
        val status = MutableStateFlow<InstallStatus>(InstallStatus.Waiting)
        val session = installUpdate(context, apk, status)
        remote.waitUntil("Android asks for confirmation", 20_000) {
            status.value == InstallStatus.Confirming
        }
        remote.waitUntil("The installer's prompt is on screen", 20_000) {
            instrumentation.uiAutomation.rootInActiveWindow
                ?.packageName
                ?.contains("packageinstaller") == true
        }
        // Never select anything here: accepting would reinstall the app under test. The prompt is
        // another app's window, which only a global action reaches.
        assertTrue(
            instrumentation.uiAutomation.performGlobalAction(
                android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK
            )
        )
        remote.waitUntil("The prompt closes", 20_000) {
            instrumentation.uiAutomation.rootInActiveWindow
                ?.packageName
                ?.contains("packageinstaller") != true
        }
        // What Kino does when it is in front again: the dismissed session becomes a cancellation.
        settleDismissedInstall(context, session, status)
        assertEquals(InstallStatus.Cancelled, status.value)
        assertNull(
            "The dismissed session is gone",
            context.packageManager.packageInstaller.getSessionInfo(session),
        )
    }

    @Test
    fun theNoticeOffersTheReleaseAndRemembersSkipping() {
        val settings =
            LocalKinoSettings(context.getSharedPreferences("kino-update-test", android.content.Context.MODE_PRIVATE))
                .also { it.edit().clear().commit() }
        val requests = mutableListOf<String>()
        val feed =
            mapOf(
                "https://api.github.com/repos/chriscorbell/kino/releases/latest" to
                    """{"tag_name":"v0.2.0","draft":false,"prerelease":false}""".toByteArray()
            )
        var clock = 1_000_000_000_000L
        val updates =
            TvUpdates(context, settings, "0.1.0", UpdateSource(client = github(feed, requests)), { clock })
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        try {
            instrumentation.runOnMainSync { activity.setContent { KinoTheme { UpdatePrompt(updates) } } }
            val title = context.getString(R.string.update_title, "0.2.0")
            remote.waitFor(title)
            assertEquals(listOf("https://api.github.com/repos/chriscorbell/kino/releases/latest"), requests)
            remote.focus(context.getString(R.string.update_skip))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Skip closes the notice") { remote.node(title) == null }
            assertFalse(updates.noticeWanted(KinoRelease("0.2.0", "v0.2.0")))
            assertTrue("A newer release is offered again", updates.noticeWanted(KinoRelease("0.3.0", "v0.3.0")))
            updates.remindTomorrow()
            assertFalse(updates.noticeWanted(KinoRelease("0.3.0", "v0.3.0")))
            clock += 24L * 60 * 60 * 1000
            assertTrue(updates.noticeWanted(KinoRelease("0.3.0", "v0.3.0")))
            // The daily limit: a relaunch within the day does not ask GitHub again.
            clock -= 1
            requests.clear()
            instrumentation.runOnMainSync { updates.checkIfDue() }
            instrumentation.waitForIdleSync()
            assertTrue(requests.isEmpty())

            // After the viewer went to allow installs, the next launch checks at once and offers
            // the release they chose, even one they had skipped.
            updates.awaitPermission(KinoRelease("0.2.0", "v0.2.0"))
            instrumentation.runOnMainSync {
                activity.setContent { KinoTheme { androidx.compose.runtime.key(2) { UpdatePrompt(updates) } } }
            }
            remote.waitFor(title)
            assertEquals(listOf("https://api.github.com/repos/chriscorbell/kino/releases/latest"), requests)
            assertNull("The remembered release is offered once", updates.resumed())
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
