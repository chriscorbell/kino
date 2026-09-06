@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.Util
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import coil3.SingletonImageLoader
import coil3.asImage
import coil3.memory.MemoryCache
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.Storage
import com.stremio.core.models.Ctx
import com.stremio.core.runtime.msg.*
import com.stremio.core.types.resource.Stream
import java.io.File
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SettingsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app
        get() = context.applicationContext as ShieldTestApplication

    @Test
    fun upNextDefaultsOnAndTheRemoteCanTurnItOffAndOn() = runBlocking {
        onMain { app.core.initialize() }
        assertTrue(Core.drainWrites())
        app.settings.edit().remove("up_next").commit()
        val activity = activity()
        try {
            showSettings(activity)
            focusRow(R.string.up_next)
            assertTrue(focusedText().contains("On"))
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("The Up Next switch must save Off") {
                !app.settings.getBoolean("up_next", true) && focusedText().contains("Off")
            }
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("The Up Next switch must save On") {
                app.settings.getBoolean("up_next", false) && focusedText().contains("On")
            }
        } finally {
            onMain { activity.finish() }
            app.settings.edit().remove("up_next").commit()
        }
    }

    @Test
    fun remoteLanguagePickerRestoresFocusAndSavesEveryLanguageWithoutReplacingOtherSettings() =
        runBlocking {
            onMain { app.core.initialize() }
            assertTrue(Core.drainWrites())
            val original = Core.getState<Ctx>(Field.CTX).profile
            val activity = activity()
            try {
                assertTrue(
                    withContext(Dispatchers.Main) {
                        app.core.setLanguage(TvLanguage.English, false)
                    }
                )
                showSettings(activity)
                focusRow(R.string.audio_language)
                key(KeyEvent.KEYCODE_DPAD_CENTER)
                waitFor("Current language must get dialog focus") {
                    focusedText().contains("English")
                }
                repeat(14) { key(KeyEvent.KEYCODE_DPAD_DOWN) }
                waitFor("Every language must be reachable with the remote") {
                    focusedText().contains("Arabic")
                }
                capture("language-picker")
                key(KeyEvent.KEYCODE_DPAD_CENTER)
                waitFor("Choosing Arabic must return focus to Audio language") {
                    app.core.state.value.audioLanguage == "ara" &&
                        focusedText().contains("Audio language")
                }
                assertTrue(Core.drainWrites())
                key(KeyEvent.KEYCODE_DPAD_CENTER)
                waitFor("Reopening the scrolled picker must focus Arabic") {
                    focusedText().contains("Arabic") && !focusedText().contains("Audio language")
                }
                key(KeyEvent.KEYCODE_BACK)
                waitFor("Back must restore the invoking row") {
                    focusedText().contains("Audio language")
                }
                for (language in TvLanguage.entries) {
                    for (text in listOf(false, true)) {
                        val before = Core.getState<Ctx>(Field.CTX).profile
                        assertTrue(
                            withContext(Dispatchers.Main) { app.core.setLanguage(language, text) }
                        )
                        val after = Core.getState<Ctx>(Field.CTX).profile
                        val expected =
                            if (text) before.settings.copy(subtitlesLanguage = language.code)
                            else before.settings.copy(audioLanguage = language.code)
                        assertEquals(before.copy(settings = expected), after)
                        val stored = (app.storage.get("profile") as Storage.Result.Ok).value!!
                        val saved = JSONObject(stored).getJSONObject("settings")
                        assertEquals(
                            language.code,
                            saved.getString(if (text) "subtitlesLanguage" else "audioLanguage"),
                        )
                    }
                }
            } finally {
                onMain {
                    Core.dispatch(
                        Action(
                            Action.Type.Ctx(
                                ActionCtx(ActionCtx.Args.UpdateSettings(original.settings))
                            )
                        ),
                        Field.CTX,
                    )
                    activity.finish()
                }
                assertTrue(Core.drainWrites(retry = true))
            }
        }

    @Test
    fun failedLanguageWriteOffersRetryAndRetainsTheChosenValue() = runBlocking {
        onMain { app.core.initialize() }
        assertTrue(Core.drainWrites())
        val activity = activity()
        val original = Core.getState<Ctx>(Field.CTX).profile.settings
        try {
            onMain {
                Core.dispatch(
                    Action(
                        Action.Type.Ctx(
                            ActionCtx(
                                ActionCtx.Args.UpdateSettings(original.copy(audioLanguage = "en"))
                            )
                        )
                    ),
                    Field.CTX,
                )
            }
            assertTrue(Core.drainWrites())
            waitFor("Imported two-letter language code must reach Settings") {
                app.core.state.value.audioLanguage == "en"
            }
            showSettings(activity)
            focusRow(R.string.audio_language)
            capture("languages")
            app.storage.beforeWrite = { key, _ ->
                if (key == "profile") Storage.Result.Err("Fixture storage unavailable") else null
            }
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("English must be focused") { focusedText().contains("English") }
            key(KeyEvent.KEYCODE_DPAD_DOWN)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Storage failure must offer Retry") {
                visibleText().contains(context.getString(R.string.settings_save_failed))
            }
            app.storage.beforeWrite = null
            focusRow(R.string.retry)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Retry must clear the save failure") {
                !visibleText().contains(context.getString(R.string.settings_save_failed))
            }
            assertTrue(Core.drainWrites())
            assertEquals(
                "spa",
                JSONObject((app.storage.get("profile") as Storage.Result.Ok).value!!)
                    .getJSONObject("settings")
                    .getString("audioLanguage"),
            )
        } finally {
            app.storage.beforeWrite = null
            onMain {
                Core.dispatch(
                    Action(Action.Type.Ctx(ActionCtx(ActionCtx.Args.UpdateSettings(original)))),
                    Field.CTX,
                )
                activity.finish()
            }
            assertTrue(Core.drainWrites(retry = true))
        }
    }

    @Test
    fun cacheAndClipboardActionsUseRealStorageWithoutIncludingPrivateData() = runBlocking {
        onMain { app.core.initialize() }
        assertTrue(Core.drainWrites())
        val activity = activity()
        val loader = SingletonImageLoader.get(context)
        val disk = loader.diskCache!!
        val sentinel = "KINO_PRIVATE_ACCOUNT_SOURCE_PATH_SENTINEL"
        val settings = app.settings
        val original = (settings as LocalKinoSettings).all
        val profile = Core.getState<Ctx>(Field.CTX).profile
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        val previousClip = onMain { clipboard.primaryClip }
        try {
            assertTrue(disk.directory.name.endsWith("instrumentation"))
            disk.clear()
            fun populateArtwork() {
                val editor = disk.openEditor("settings-artwork")!!
                File(editor.data.toString()).writeBytes(ByteArray(2_000_000) { 42 })
                File(editor.metadata.toString()).writeText(sentinel)
                editor.commit()
                val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
                loader.memoryCache!![MemoryCache.Key("settings-artwork")] =
                    MemoryCache.Value(bitmap.asImage())
            }
            populateArtwork()
            settings
                .edit()
                .putString("fixture-private-data", sentinel)
                .putString("tracks-v1:fixture", sentinel)
                .putString("audio_output", "stereo")
                .commit()
            assertEquals(2_000_000L + sentinel.toByteArray().size, artworkCacheSize(context))
            val held = disk.openSnapshot("settings-artwork")!!
            assertFalse(
                "An open cache snapshot must not be reported as deleted",
                clearArtworkCache(context),
            )
            held.close()
            populateArtwork()
            assertTrue(artworkCacheSize(context) >= 2_000_000L)
            showSettings(activity)
            focusRow(R.string.clear_cache)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Clear cache must report completion") {
                visibleText().contains(context.getString(R.string.cache_cleared))
            }
            assertEquals(0L, artworkCacheSize(context))
            assertEquals(0L, loader.memoryCache!!.size)
            assertNull(disk.openSnapshot("settings-artwork"))
            assertEquals(profile, Core.getState<Ctx>(Field.CTX).profile)
            assertEquals(sentinel, settings.getString("tracks-v1:fixture", null))
            assertTrue(stereoOutputPreferred(context))
            focusRow(R.string.copy_diagnostic_summary)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Copy must report completion") {
                visibleText().contains(context.getString(R.string.diagnostic_summary_copied))
            }
            capture("storage-diagnostics")
            val copied = onMain { clipboard.primaryClip!!.getItemAt(0).text.toString() }
            assertEquals(diagnosticSummary(context), copied)
            assertFalse(copied.contains(sentinel))
            assertFalse(copied.contains(context.filesDir.toString()))
            assertFalse(copied.contains("https://"))
            val lines = copied.lines()
            assertEquals(
                listOf(
                    "Kino",
                    "Android",
                    "ABI",
                    "Stremio Core revision",
                    "Media3",
                    "FFmpeg audio",
                    "Video decoding",
                    "Video output",
                    "Audio output",
                ),
                lines.map { it.substringBefore(':') },
            )
            assertTrue(lines[3].matches(Regex("Stremio Core revision: [a-f0-9]{40}")))
            assertEquals("FFmpeg audio: Lavc60.3.100", lines[5])
            assertEquals("Audio output: Stereo", lines.last())
            settings.edit().putString("audio_output", "auto").commit()
            assertTrue(diagnosticSummary(context).endsWith("Audio output: Auto"))
            val replacement = disk.openEditor("new-artwork")!!
            File(replacement.data.toString()).writeText("fresh artwork")
            replacement.commit()
            assertTrue(artworkCacheSize(context) > 0)
        } finally {
            disk.clear()
            loader.memoryCache?.clear()
            settings
                .edit()
                .clear()
                .apply {
                    for ((key, value) in original) when (value) {
                        is String -> putString(key, value)
                        is Boolean -> putBoolean(key, value)
                    }
                }
                .commit()
            onMain {
                if (previousClip != null) clipboard.setPrimaryClip(previousClip)
                else clipboard.clearPrimaryClip()
                activity.finish()
            }
        }
    }

    @Test
    fun settingsDefaultsReachTheFullscreenPlayersActualTracks() = runBlocking {
        onMain { app.core.initialize() }
        assertTrue(Core.drainWrites())
        val activity = activity()
        val fixture = CoreEpisodeFixture(activity)
        val file = File(context.cacheDir, "settings-tracks.mkv")
        instrumentation.context.assets.open("two-tracks.mkv").use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        val original = Core.getState<Ctx>(Field.CTX).profile.settings
        try {
            app.settings.edit().clear().commit()
            assertFalse(app.settings.getBoolean("subtitles", false))
            assertFalse(stereoOutputPreferred(context))
            assertTrue(
                withContext(Dispatchers.Main) { app.core.setLanguage(TvLanguage.Spanish, false) }
            )
            assertTrue(
                withContext(Dispatchers.Main) { app.core.setLanguage(TvLanguage.Spanish, true) }
            )
            showSettings(activity)
            focusRow(R.string.subtitles)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Subtitles toggle must persist") { app.settings.getBoolean("subtitles", false) }
            onMain {
                fixture.install()
                app.core.open(fixture.media, fixture.firstVideoId)
            }
            waitFor("Core must provide the fixture source") {
                app.core.state.value.details.sources.any { it.playable }
            }
            val selectedSource = app.core.state.value.details.sources.first { it.playable }
            val source =
                selectedSource.let {
                    it.copy(
                        stream =
                            it.stream.copy(
                                source =
                                    Stream.Source.Url(Stream.Url(Uri.fromFile(file).toString()))
                            )
                    )
                }
            for (enabled in listOf(true, false)) {
                onMain { assertTrue(app.core.startPlayer(selectedSource)) }
                app.settings.edit().putBoolean("subtitles", enabled).commit()
                onMain {
                    activity.setContent {
                        KinoTheme {
                            FullscreenPlayer(
                                source,
                                fixture.media,
                                app.core,
                                onExit = {},
                                onFailure = {},
                                onUpNext = {},
                            )
                        }
                    }
                }
                waitFor("Actual tracks must follow audio/subtitle defaults ($enabled)") {
                    val player =
                        findPlayerView(activity.window.decorView)?.player ?: return@waitFor false
                    fun selected(type: Int): String? =
                        player.currentTracks.groups
                            .filter { it.type == type }
                            .firstNotNullOfOrNull { group ->
                                (0 until group.length)
                                    .firstOrNull { group.isTrackSelected(it) }
                                    ?.let {
                                        Util.normalizeLanguageCode(
                                            group.getTrackFormat(it).language.orEmpty()
                                        )
                                    }
                            }
                    player.playbackState == Player.STATE_READY &&
                        selected(C.TRACK_TYPE_AUDIO) == "es" &&
                        selected(C.TRACK_TYPE_TEXT) == if (enabled) "es" else null
                }
                onMain { activity.setContent {} }
                waitFor("Disposal must finish saving before new playback") {
                    findPlayerView(activity.window.decorView) == null &&
                        app.core.pendingPlaybackSave.status.value ==
                            TvPendingPlaybackSave.Status.Idle
                }
            }
        } finally {
            onMain {
                activity.setContent {}
                app.core.stopPlayer()
                fixture.uninstall()
                Core.dispatch(
                    Action(Action.Type.Ctx(ActionCtx(ActionCtx.Args.UpdateSettings(original)))),
                    Field.CTX,
                )
            }
            assertTrue(Core.drainWrites(retry = true))
            fixture.close()
            onMain { activity.finish() }
            file.delete()
            app.settings.edit().clear().commit()
        }
    }

    @Test
    fun guestAndAccountShareSettingsWhileBothProcessesStayAlive() = runBlocking {
        val remoteReady = CompletableDeferred<android.os.Messenger>()
        val responses =
            kotlinx.coroutines.channels.Channel<android.os.Bundle>(
                kotlinx.coroutines.channels.Channel.UNLIMITED
            )
        val replies =
            android.os.Messenger(
                object : android.os.Handler(android.os.Looper.getMainLooper()) {
                    override fun handleMessage(message: android.os.Message) {
                        responses.trySend(message.data)
                    }
                }
            )
        val connection =
            object : android.content.ServiceConnection {
                override fun onServiceConnected(
                    name: android.content.ComponentName,
                    binder: android.os.IBinder,
                ) {
                    remoteReady.complete(android.os.Messenger(binder))
                }

                override fun onServiceDisconnected(name: android.content.ComponentName) {}
            }
        app.sharedSettingsFixture = true
        val shared = app.settings
        shared.edit().clear().commit()
        onMain { app.core.initialize() }
        val activity = activity()
        var cover: SettingsCoverActivity? = null
        var bound = false
        try {
            showSettings(activity)
            focusRow(R.string.audio_output)
            assertTrue(focusedText().contains("Auto"))
            cover =
                instrumentation.startActivitySync(
                    Intent(context, SettingsCoverActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ) as SettingsCoverActivity
            bound =
                context.bindService(
                    Intent(context, SettingsProbeService::class.java),
                    connection,
                    android.content.Context.BIND_AUTO_CREATE,
                )
            assertTrue(bound)
            val remote = withTimeout(5000) { remoteReady.await() }
            suspend fun request(command: Int): android.os.Bundle {
                remote.send(android.os.Message.obtain(null, command).apply { replyTo = replies })
                return withTimeout(5000) { responses.receive() }
            }
            // More than Binder can transfer at once, written in small independent edits.
            // Ordinary reads from the account process must return only their requested key.
            repeat(128) { index ->
                shared.edit().putString("tracks-v1:large-$index", "x".repeat(16_384)).apply()
            }
            val initial = request(1)
            assertNotEquals(android.os.Process.myPid(), initial.getInt("pid"))
            assertEquals("auto", initial.getString("audio"))
            assertFalse(initial.getBoolean("subtitles"))
            request(2)
            assertEquals("stereo", shared.getString("audio_output", null))
            assertTrue(shared.getBoolean("subtitles", false))
            // A later edit from the still-live guest must preserve the account's fields.
            shared.edit().putString("tracks-v1:main", "main choice fixture").apply()
            val after = request(1)
            assertEquals("stereo", after.getString("audio"))
            assertTrue(after.getBoolean("subtitles"))
            assertEquals("main choice fixture", after.getString("main"))
            assertEquals("remote choice fixture", shared.getString("tracks-v1:remote", null))
            onMain { cover!!.finish() }
            cover = null
            waitFor("Resuming guest Settings must show the account process change") {
                focusedText().contains("Audio output") && focusedText().contains("Stereo")
            }
            focusRow(R.string.subtitles)
            assertTrue(focusedText().contains("On"))
        } finally {
            if (bound) context.unbindService(connection)
            shared.edit().clear().commit()
            app.sharedSettingsFixture = false
            onMain {
                cover?.finish()
                activity.finish()
            }
            responses.close()
        }
    }

    @Test
    fun preferencesSurviveProcessRestart() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        val phase = args.getString("settingsPhase")
        org.junit.Assume.assumeTrue(phase == "prepare" || phase == "verify")
        val account = args.getString("settingsProfile") == "account"
        val language = if (account) TvLanguage.French else TvLanguage.Spanish
        val pid = File(context.cacheDir, "settings-restart-${app.fixtureProfile}-pid")
        onMain { app.core.initialize() }
        assertTrue(Core.drainWrites())
        if (phase == "prepare") {
            assertTrue(withContext(Dispatchers.Main) { app.core.setLanguage(language, false) })
            assertTrue(withContext(Dispatchers.Main) { app.core.setLanguage(language, true) })
            app.settings
                .edit()
                .putBoolean("subtitles", !account)
                .putBoolean("up_next", account)
                .putString("audio_output", if (account) "stereo" else "auto")
                .putString("tracks-v1:restart", "remembered track fixture")
                .commit()
            pid.writeText(android.os.Process.myPid().toString())
        } else {
            assertNotEquals(
                "Verification must run in a fresh process",
                pid.readText(),
                android.os.Process.myPid().toString(),
            )
            assertEquals(language.code, app.core.state.value.audioLanguage)
            assertEquals(language.code, app.core.state.value.subtitleLanguage)
            assertEquals(!account, app.settings.getBoolean("subtitles", account))
            assertEquals(account, app.settings.getBoolean("up_next", !account))
            assertEquals(account, stereoOutputPreferred(context))
            assertTrue(clearArtworkCache(context))
            assertEquals(
                "remembered track fixture",
                app.settings.getString("tracks-v1:restart", null),
            )
            val activity = activity()
            try {
                showSettings(activity)
                focusRow(R.string.up_next)
                assertTrue(focusedText().contains(if (account) "On" else "Off"))
                focusRow(R.string.audio_language)
                assertTrue(focusedText().contains(context.getString(language.label)))
                key(KeyEvent.KEYCODE_DPAD_CENTER)
                waitFor("Restored language must be focused in the picker") {
                    focusedText().contains(context.getString(language.label)) &&
                        !focusedText().contains("Audio language")
                }
                key(KeyEvent.KEYCODE_BACK)
            } finally {
                onMain { activity.finish() }
                pid.delete()
            }
        }
    }

    private fun capture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("settingsScreenshots") != "true")
            return
        val screenshot = instrumentation.uiAutomation.takeScreenshot() ?: error("No screenshot")
        File(checkNotNull(context.getExternalFilesDir(null)), "settings-$name.png")
            .outputStream()
            .use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
        screenshot.recycle()
    }

    private fun activity() =
        instrumentation.startActivitySync(
            Intent(context, PlaybackProbeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ) as PlaybackProbeActivity

    private fun showSettings(activity: PlaybackProbeActivity) {
        onMain {
            activity.setContent {
                val state by app.core.state.collectAsState()
                KinoTheme { SettingsScreen(app.core, state, {}, {}, {}) }
            }
        }
        instrumentation.waitForIdleSync()
        key(KeyEvent.KEYCODE_DPAD_DOWN)
    }

    private fun key(code: Int) {
        instrumentation.sendKeyDownUpSync(code)
        instrumentation.waitForIdleSync()
        Thread.sleep(80)
    }

    private fun nodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> =
        listOf(root) +
            (0 until root.childCount).flatMap { root.getChild(it)?.let(::nodes).orEmpty() }

    private fun nodeText(node: AccessibilityNodeInfo) =
        nodes(node).joinToString(" ") {
            listOfNotNull(it.text, it.contentDescription).joinToString(" ")
        }

    private fun visibleText() =
        instrumentation.uiAutomation.rootInActiveWindow?.let(::nodeText).orEmpty()

    private fun focusedText() =
        instrumentation.uiAutomation.rootInActiveWindow
            ?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?.let(::nodeText)
            .orEmpty()

    private fun focusRow(label: Int) {
        val text = context.getString(label)
        repeat(24) {
            if (focusedText().contains(text)) return
            key(KeyEvent.KEYCODE_DPAD_DOWN)
        }
        error("Could not focus $text; current focus: ${focusedText()}")
    }

    private fun findPlayerView(view: View): PlayerView? {
        if (view is PlayerView) return view
        if (view is ViewGroup)
            for (i in 0 until view.childCount) findPlayerView(view.getChildAt(i))?.let {
                return it
            }
        return null
    }

    private fun <T> onMain(block: () -> T): T {
        var result: T? = null
        instrumentation.runOnMainSync { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun waitFor(reason: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < deadline) {
            instrumentation.waitForIdleSync()
            if (onMain(condition)) return
            Thread.sleep(80)
        }
        fail(reason)
    }
}
