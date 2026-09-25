@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import android.view.View
import androidx.activity.compose.setContent
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.Core
import com.stremio.core.types.resource.Stream
import java.io.File
import java.util.concurrent.atomic.AtomicReference
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Drives add-on subtitles through the real Core, the production player and the remote: the add-on
 * offers an English SubRip file, the subtitle panel lists it, choosing it side-loads the file and
 * shows its cue, and the panel's delay moves that cue in time. Size and position choices persist.
 */
class SubtitleTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app
        get() = context.applicationContext as ShieldTestApplication

    private val remote = TvRemote(instrumentation)

    private fun <T> onMain(block: () -> T): T {
        val result = AtomicReference<T>()
        instrumentation.runOnMainSync { result.set(block()) }
        return result.get()
    }

    private fun waitFor(reason: String, timeoutMs: Long = 15_000, condition: () -> Boolean) =
        waitFor({ reason }, timeoutMs, condition)

    private fun waitFor(reason: () -> String, timeoutMs: Long = 15_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            instrumentation.waitForIdleSync()
            if (onMain(condition)) return
            Thread.sleep(50)
        }
        fail(reason())
    }

    private fun textTracks(player: Player) =
        player.currentTracks.groups
            .filter { it.type == C.TRACK_TYPE_TEXT }
            .flatMap { group ->
                (0 until group.length).map {
                    val format = group.getTrackFormat(it)
                    "${format.id}/${format.sampleMimeType}/${format.language}" +
                        "/selected=${group.isTrackSelected(it)}"
                }
            }

    private fun cueText(player: Player) =
        player.currentCues.cues.joinToString(" ") { it.text?.toString().orEmpty() }

    @Test
    fun addonSubtitlesLoadFromThePanelAndFollowTheDelay() {
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val file = File(context.cacheDir, "subtitle-fixture.mp4")
        instrumentation.context.assets.open("h264-sdr-aac.mp4").use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        val fixture =
            CoreEpisodeFixture(
                activity,
                subtitles = "1\n00:00:01,000 --> 00:00:05,000\nKino fixture subtitle\n",
            )
        val previousClient = AddonSubtitleFiles.client
        // The fixture host resolves only for Core's benchmark transport; route the subtitle file
        // to the same loopback server while keeping the HTTPS request the policy checks.
        AddonSubtitleFiles.client =
            OkHttpClient.Builder()
                .addInterceptor(
                    Interceptor { chain ->
                        val original = chain.request()
                        val loopback =
                            original.url
                                .newBuilder()
                                .scheme("http")
                                .host("127.0.0.1")
                                .port(fixture.port)
                                .build()
                        chain
                            .proceed(original.newBuilder().url(loopback).build())
                            .newBuilder()
                            .request(original)
                            .build()
                    }
                )
                .build()
        val player = AtomicReference<ExoPlayer>()
        try {
            onMain {
                app.core.initialize()
                app.settings.edit().putString("subtitle_size", "100").commit()
                fixture.install()
                app.core.open(fixture.media, fixture.firstVideoId)
            }
            waitFor("Core resolves the fixture's source") {
                app.core.state.value.details.sources.any { it.playable }
            }
            val source = app.core.state.value.details.sources.first { it.playable }
            onMain { assertTrue(app.core.startPlayer(source)) }
            val local =
                source.copy(
                    stream =
                        source.stream.copy(
                            source = Stream.Source.Url(Stream.Url(Uri.fromFile(file).toString()))
                        )
                )
            onMain {
                activity.setContent {
                    KinoTheme {
                        FullscreenPlayer(
                            local,
                            fixture.media,
                            app.core,
                            onExit = {},
                            onFailure = {},
                            onUpNext = {},
                            onPlayer = { player.set(it) },
                        )
                    }
                }
            }
            waitFor("Core returns the add-on's English subtitles") {
                app.core.state.value.subtitles.any { it.language == "eng" }
            }
            waitFor("Playback starts") { player.get()?.playbackState == Player.STATE_READY }
            onMain {
                player.get().pause()
                player.get().seekTo(2_000)
            }

            onMain {
                activity.window.decorView
                    .findViewById<View>(R.id.kino_subtitles)!!
                    .performClick()
            }
            remote.waitFor("English")
            remote.focus("English")
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor({
                "Choosing the add-on file side-loads and selects it: " +
                    onMain { textTracks(player.get()) }
            }) {
                val tracks = player.get().currentTracks
                tracks.groups.any { group ->
                    group.type == C.TRACK_TYPE_TEXT &&
                        (0 until group.length).any {
                            group.isTrackSelected(it) &&
                                sideLoadedTrackId(group.getTrackFormat(it)) ==
                                    "kino-addon:kino-fixture-en"
                        }
                }
            }
            waitFor("The add-on cue shows at two seconds") {
                cueText(player.get()).contains("Kino fixture subtitle")
            }
            assertEquals(
                "Side-loading keeps the playback position",
                2_000.0,
                onMain { player.get().currentPosition }.toDouble(),
                1_500.0,
            )

            // Push the text three seconds later: the cue that starts at one second now starts
            // at four, so two seconds in shows nothing and four and a half shows it again.
            onMain {
                activity.window.decorView
                    .findViewById<View>(R.id.kino_subtitles)!!
                    .performClick()
            }
            remote.waitFor(context.getString(R.string.subtitle_later))
            repeat(12) {
                remote.focus(context.getString(R.string.subtitle_later))
                remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            }
            remote.waitFor("+3.00 s")
            remote.focus("150%")
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.key(KeyEvent.KEYCODE_BACK)
            // Play from the start: at two and a half seconds the delayed cue has not begun, and
            // from four seconds it shows.
            onMain {
                player.get().seekTo(0)
                player.get().play()
            }
            waitFor("Playback reaches two and a half seconds") {
                player.get().currentPosition in 2_400..3_600
            }
            assertTrue(
                "A later delay holds the cue back past its own start",
                !onMain { cueText(player.get()) }.contains("Kino fixture subtitle"),
            )
            waitFor("The delayed cue shows after its shifted start") {
                player.get().currentPosition >= 4_100 &&
                    cueText(player.get()).contains("Kino fixture subtitle")
            }
            // Media3 shows a side-loaded cue after a seek only from its start, delay or not, so
            // the seek check stops at the cue clearing.
            onMain {
                player.get().pause()
                player.get().seekTo(2_000)
            }
            waitFor("Seeking before the shifted start clears the cue") {
                !cueText(player.get()).contains("Kino fixture subtitle")
            }
            assertEquals("150", app.settings.getString("subtitle_size", null))
            assertNotNull(
                "The title remembers the add-on language",
                app.settings.getString(
                    "addon-subtitles-v1:" +
                        org.json.JSONArray(listOf(fixture.media.type, fixture.media.id)),
                    null,
                ),
            )
        } finally {
            AddonSubtitleFiles.client = previousClient
            onMain { activity.setContent {} }
            kotlinx.coroutines.runBlocking { Core.drainWrites(retry = true) }
            waitFor("Disposal finishes saving") {
                app.core.pendingPlaybackSave.status.value == TvPendingPlaybackSave.Status.Idle
            }
            onMain {
                app.core.stopPlayer()
                fixture.uninstall()
                activity.finish()
            }
            kotlinx.coroutines.runBlocking { Core.drainWrites(retry = true) }
            fixture.close()
            file.delete()
            app.settings
                .edit()
                .putString("subtitle_size", null)
                .putString(
                    "addon-subtitles-v1:" +
                        org.json.JSONArray(listOf(fixture.media.type, fixture.media.id)),
                    null,
                )
                .commit()
        }
    }
}
