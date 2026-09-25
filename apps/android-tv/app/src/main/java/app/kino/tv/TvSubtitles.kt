@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.media3.common.MimeTypes
import androidx.media3.common.MediaItem
import androidx.media3.ui.SubtitleView
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Add-on subtitle files, fetched by Kino rather than handed to Media3 as URLs, so the add-on
 * transport policy holds for them as it does for sources: HTTPS only, never redirected to plain
 * HTTP, no credentials in the URL, and a bounded size. The file then plays from the cache as a
 * side-loaded track.
 */
internal object AddonSubtitleFiles {
    private const val MAX_BYTES = 4L shl 20

    /** The HTTP client; a gate substitutes one that reaches its loopback add-on. */
    @Volatile
    var client: OkHttpClient =
        OkHttpClient.Builder()
            .followSslRedirects(false)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build()

    private fun directory(context: Context) = File(context.cacheDir, "subtitles")

    /** Returns the side-loaded configuration for [subtitle], or null when it cannot be fetched. */
    suspend fun fetch(context: Context, subtitle: AddonSubtitle): MediaItem.SubtitleConfiguration? =
        withContext(Dispatchers.IO) {
            fun refuse(reason: String): MediaItem.SubtitleConfiguration? {
                Log.w("KinoPlayer", "Add-on subtitles refused reason=$reason")
                return null
            }
            if (!secureUrl(subtitle.url)) return@withContext refuse("insecure")
            try {
                client.newCall(Request.Builder().url(subtitle.url).build()).execute().use {
                    response ->
                    if (!response.isSuccessful)
                        return@withContext refuse("status-${response.code}")
                    if (!secureUrl(response.request.url.toString()))
                        return@withContext refuse("redirect")
                    val source = response.body?.source() ?: return@withContext refuse("empty")
                    // Read one byte past the limit so an oversized file is recognised.
                    source.request(MAX_BYTES + 1)
                    if (source.buffer.size > MAX_BYTES) return@withContext refuse("size")
                    val bytes = source.buffer.readByteArray()
                    val mime = sniff(bytes) ?: return@withContext refuse("format")
                    Log.i("KinoPlayer", "Add-on subtitles fetched bytes=${bytes.size} format=$mime")
                    val directory = directory(context).apply { mkdirs() }
                    val name =
                        MessageDigest.getInstance("SHA-256")
                            .digest(subtitle.url.toByteArray())
                            .joinToString("") { "%02x".format(it) }
                    val file = File(directory, name).apply { writeBytes(bytes) }
                    MediaItem.SubtitleConfiguration.Builder(Uri.fromFile(file))
                        .setMimeType(mime)
                        .setLanguage(subtitle.language)
                        .setLabel(subtitleLabel(subtitle))
                        .setId(addonTrackId(subtitle))
                        .build()
                }
            } catch (_: Exception) {
                Log.w("KinoPlayer", "Add-on subtitles could not be fetched")
                null
            }
        }

    /** Removes cached files once playback ends; they are only ever needed for one session. */
    fun clear(context: Context) {
        directory(context).listFiles()?.forEach { it.delete() }
    }

    /**
     * Add-ons rarely give a file extension, so the text itself decides the parser: WebVTT and
     * SSA announce themselves, and SubRip is the format nearly every subtitle add-on serves.
     * Anything that does not start like text is refused.
     */
    internal fun sniff(bytes: ByteArray): String? {
        val head =
            String(bytes, 0, minOf(bytes.size, 512), Charsets.UTF_8).removePrefix("\uFEFF").trimStart()
        return when {
            head.isEmpty() -> null
            head.startsWith("WEBVTT") -> MimeTypes.TEXT_VTT
            head.startsWith("[Script Info]", ignoreCase = true) -> MimeTypes.TEXT_SSA
            head.first().isDigit() -> MimeTypes.APPLICATION_SUBRIP
            else -> null
        }
    }
}

internal fun addonTrackId(subtitle: AddonSubtitle) = "kino-addon:${subtitle.id}"

/**
 * The add-on track id a side-loaded format carries. Media3 merges side-loaded sources and prefixes
 * each format's id with its source index, so `kino-addon:…` arrives as `1:kino-addon:…`.
 */
internal fun sideLoadedTrackId(format: androidx.media3.common.Format): String? =
    format.id?.let { Regex("^(?:\\d+:)?(kino-addon:.+)$").matchEntire(it)?.groupValues?.get(1) }

internal fun subtitleLabel(subtitle: AddonSubtitle) =
    listOfNotNull(subtitle.label?.takeIf { it.isNotBlank() }, subtitle.provider)
        .distinct()
        .joinToString(" · ")

/** The subtitle sizes and positions TV Settings and the player offer, as device-local choices. */
internal object SubtitleAppearance {
    val sizes = listOf(75, 100, 125, 150)
    val positions = listOf(0, 8, 16)

    fun size(context: Context) =
        kinoSettings(context).getString("subtitle_size", null)?.toIntOrNull()?.takeIf {
            it in sizes
        } ?: 100

    fun position(context: Context) =
        kinoSettings(context).getString("subtitle_position", null)?.toIntOrNull()?.takeIf {
            it in positions
        } ?: 0

    fun save(context: Context, size: Int, position: Int) {
        kinoSettings(context)
            .edit()
            .putString("subtitle_size", size.toString())
            .putString("subtitle_position", position.toString())
            .apply()
    }

    fun apply(view: SubtitleView?, size: Int, position: Int) {
        view ?: return
        view.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * size / 100f)
        view.setBottomPaddingFraction(SubtitleView.DEFAULT_BOTTOM_PADDING_FRACTION + position / 100f)
    }
}

/**
 * The add-on subtitle language chosen for a movie or show, remembered on this device like its
 * embedded track choices. Add-on files are fetched again each time, so only the language is kept,
 * and the next playback takes the first file the add-ons offer in it.
 */
internal class AddonSubtitleMemory(context: Context, media: Media) {
    private val preferences = kinoSettings(context)
    private val key = "addon-subtitles-v1:" + org.json.JSONArray(listOf(media.type, media.id))
    private val trackKey = "tracks-v1:" + org.json.JSONArray(listOf(media.type, media.id))

    fun language(): String? = preferences.getString(key, null)?.takeIf { it.isNotBlank() }

    fun remember(language: String) = preferences.edit().putString(key, language).apply()

    fun forget() = preferences.edit().putString(key, null).apply()

    /** False once the title's subtitles were explicitly turned off. */
    fun allowsAutomatic(): Boolean =
        try {
            org.json.JSONObject(preferences.getString(trackKey, "{}") ?: "{}")
                .optJSONObject(androidx.media3.common.C.TRACK_TYPE_TEXT.toString())
                ?.optBoolean("off") != true
        } catch (_: Exception) {
            true
        }
}
