@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.SurfaceView
import android.view.WindowManager
import androidx.media3.common.*
import androidx.media3.common.util.Util
import androidx.media3.datasource.FileDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.*
import org.junit.Test

class TitleTrackSelectionTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val preferences =
        LocalKinoSettings(
            context.getSharedPreferences("track-choice-instrumentation", Context.MODE_PRIVATE)
        )

    @Test
    fun movieAndShowChoicesSurviveNewPlayersAndReplacementSources() {
        preferences.edit().clear().commit()
        try {
            // Sharing the ID also checks that a movie cannot supply a show's choices.
            for (type in listOf("movie", "series")) {
                withPlayer(type, "shared-title") { player ->
                    selected(player, "en", "en")
                    pick(player, C.TRACK_TYPE_AUDIO, "es")
                    pick(player, C.TRACK_TYPE_TEXT, "es")
                    selected(player, "es", "es")
                    assertTrue(preferences.getBoolean("subtitles", false))
                }
                withPlayer(type, "shared-title", "replacement-tracks.mkv", subtitles = false) {
                    player ->
                    selected(player, "es", "es")
                }
                withPlayer(type, "shared-title", "fallback-tracks.mkv", language = "de") { player ->
                    selected(player, "de", "de")
                }
                withPlayer(type, "shared-title") { player ->
                    selected(player, "es", "es")
                    onMain {
                        player.trackSelectionParameters =
                            player.trackSelectionParameters
                                .buildUpon()
                                .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                                .build()
                    }
                    selected(player, "es", null)
                    assertFalse(preferences.getBoolean("subtitles", true))
                }
                withPlayer(type, "shared-title") { player -> selected(player, "es", null) }
            }
            withPlayer("movie", "other-title") { player -> selected(player, "en", "en") }
            assertNull(
                "Automatic language selection must not create a remembered choice",
                preferences.getString("tracks-v1:[\"movie\",\"other-title\"]", null),
            )
            withPlayer("movie", "variants", "variant-tracks.mkv") { player ->
                pick(player, C.TRACK_TYPE_AUDIO, "es")
                pick(player, C.TRACK_TYPE_TEXT, "es")
                selected(player, "es", "es", "Main")
            }
            withPlayer("movie", "variants", "reordered-variants.mkv") { player ->
                selected(player, "es", "es", "Main")
            }
            withPlayer("movie", "variants", "missing-variant.mkv") { player ->
                selected(player, "en", "en")
            }
        } finally {
            preferences.edit().clear().commit()
        }
    }

    @Test
    fun choosingAutoRemovesTheRememberedAudioOverride() {
        preferences.edit().clear().commit()
        try {
            withPlayer("movie", "auto-title") { player ->
                pick(player, C.TRACK_TYPE_AUDIO, "es")
                selected(player, "es", "en")
            }
            withPlayer("movie", "auto-title") { player ->
                selected(player, "es", "en")
                onMain {
                    player.trackSelectionParameters =
                        player.trackSelectionParameters
                            .buildUpon()
                            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                            .build()
                }
                selected(player, "en", "en")
            }
            withPlayer("movie", "auto-title") { player -> selected(player, "en", "en") }
        } finally {
            preferences.edit().clear().commit()
        }
    }

    private fun pick(player: Player, type: Int, language: String) = onMain {
        val group =
            player.currentTracks.groups.first { group ->
                group.type == type &&
                    (0 until group.length).any { normalized(group.getTrackFormat(it)) == language }
            }
        val index =
            (0 until group.length).first { normalized(group.getTrackFormat(it)) == language }
        player.trackSelectionParameters =
            player.trackSelectionParameters
                .buildUpon()
                .setTrackTypeDisabled(type, false)
                .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
                .build()
    }

    private fun normalized(format: Format) = Util.normalizeLanguageCode(format.language.orEmpty())

    private fun selected(player: Player, audio: String, subtitle: String?, label: String? = null) {
        waitUntil("Expected audio=$audio and subtitle=$subtitle from the live player") {
            fun selectedLanguage(type: Int): String? {
                for (group in player.currentTracks.groups.filter { it.type == type }) {
                    for (index in 0 until group.length) if (group.isTrackSelected(index)) {
                        if (label != null && group.getTrackFormat(index).label != label) return null
                        return normalized(group.getTrackFormat(index))
                    }
                }
                return null
            }
            selectedLanguage(C.TRACK_TYPE_AUDIO) == audio &&
                selectedLanguage(C.TRACK_TYPE_TEXT) == subtitle
        }
    }

    private fun withPlayer(
        type: String,
        id: String,
        fixture: String = "two-tracks.mkv",
        language: String = "en",
        subtitles: Boolean = true,
        check: (Player) -> Unit,
    ) {
        val file = File(context.cacheDir, "title-track-fixture.mkv")
        instrumentation.context.assets.open(fixture).use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        var player: ExoPlayer? = null
        var choices: TitleTrackSelection? = null
        var presented: Player? = null
        try {
            onMain {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                val surface = SurfaceView(activity)
                activity.setContentView(surface)
                val created = createTvPlayer(activity, HardwareRenderers(activity))
                player = created
                created.setVideoSurfaceView(surface)
                val remembered =
                    TitleTrackSelection(
                        created,
                        preferences,
                        type,
                        id,
                        created.trackSelectionParameters
                            .buildUpon()
                            .setPreferredAudioLanguage(language)
                            .setPreferredTextLanguage(language)
                            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !subtitles)
                            .build(),
                    )
                choices = remembered
                presented = TvPresentationPlayer(created, remembered::select)
                created.setMediaSource(
                    ProgressiveMediaSource.Factory(FileDataSource.Factory())
                        .createMediaSource(MediaItem.fromUri(Uri.fromFile(file)))
                )
                created.prepare()
                created.play()
            }
            waitUntil("The real hardware player must start the fixture") {
                player!!.playbackState == Player.STATE_READY &&
                    player!!.isPlaying &&
                    player!!.currentTracks.isTypeSelected(C.TRACK_TYPE_VIDEO)
            }
            check(presented!!)
        } finally {
            onMain {
                choices?.close()
                player?.release()
            }
            activity.finish()
            file.delete()
        }
    }

    private fun <T> onMain(read: () -> T): T {
        var value: T? = null
        instrumentation.runOnMainSync { value = read() }
        @Suppress("UNCHECKED_CAST")
        return value as T
    }

    private fun waitUntil(reason: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            if (onMain(condition)) return
            Thread.sleep(50)
        }
        fail(reason)
    }
}
