@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.SharedPreferences
import androidx.media3.common.*
import androidx.media3.common.util.Util
import org.json.JSONObject

/** Remembers picker changes, never the player's automatic language selection. */
internal class TitleTrackSelection(
    private val player: Player,
    private val preferences: SharedPreferences,
    type: String,
    id: String,
    defaults: TrackSelectionParameters,
) : Player.Listener {
    private val key = "tracks-v1:" + org.json.JSONArray(listOf(type, id)).toString()
    private val restored = mutableSetOf<Int>()
    private val choices =
        try {
            JSONObject(preferences.getString(key, "{}") ?: "{}")
        } catch (_: Exception) {
            JSONObject()
        }

    init {
        player.trackSelectionParameters = defaults
        player.addListener(this)
    }

    private data class Candidate(val group: Tracks.Group, val index: Int) {
        val format: Format
            get() = group.getTrackFormat(index)
    }

    private fun candidates(type: Int): List<Candidate> =
        player.currentTracks.groups
            .filter { it.type == type }
            .flatMap { group ->
                (0 until group.length)
                    .filter { group.isTrackSupported(it) }
                    .map { Candidate(group, it) }
            }

    private fun language(format: Format) =
        format.language?.let { Util.normalizeLanguageCode(it) } ?: ""

    private fun sameKind(candidate: Candidate, choice: JSONObject): Boolean {
        val format = candidate.format
        return language(format) == choice.optString("language") &&
            format.sampleMimeType.orEmpty() == choice.optString("codec") &&
            format.roleFlags == choice.optInt("roles") &&
            (format.selectionFlags and C.SELECTION_FLAG_FORCED) == choice.optInt("forced")
    }

    private fun describe(candidate: Candidate, available: List<Candidate>): JSONObject {
        val format = candidate.format
        val choice =
            JSONObject()
                .put("language", language(format))
                .put("codec", format.sampleMimeType.orEmpty())
                .put("roles", format.roleFlags)
                .put("forced", format.selectionFlags and C.SELECTION_FLAG_FORCED)
                .put("label", format.label.orEmpty())
        val matching = available.filter { sameKind(it, choice) }
        return choice.put("ordinal", matching.indexOf(candidate)).put("count", matching.size)
    }

    private fun match(available: List<Candidate>, choice: JSONObject): Candidate? {
        val ordinal = choice.optInt("ordinal", -1)
        val count = choice.optInt("count", 0)
        if (ordinal < 0 || ordinal >= count) return null
        val matching = available.filter { sameKind(it, choice) }
        val label = choice.optString("label")
        val named = matching.filter { label.isNotEmpty() && it.format.label == label }
        if (named.size == 1) return named.single()
        return if (matching.size == count) matching.getOrNull(ordinal) else null
    }

    override fun onTracksChanged(tracks: Tracks) {
        val builder = player.trackSelectionParameters.buildUpon()
        var changed = false
        for (type in listOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_TEXT)) {
            if (type in restored) continue
            val available = candidates(type)
            val choice = choices.optJSONObject(type.toString())
            if (type == C.TRACK_TYPE_TEXT && choice?.optBoolean("off") == true) {
                restored.add(type)
                builder.setTrackTypeDisabled(type, true)
                changed = true
            } else if (available.isNotEmpty()) {
                restored.add(type)
                val candidate = choice?.let { match(available, it) } ?: continue
                builder
                    .setTrackTypeDisabled(type, false)
                    .setOverrideForType(
                        TrackSelectionOverride(candidate.group.mediaTrackGroup, candidate.index)
                    )
                changed = true
            }
        }
        if (changed) player.trackSelectionParameters = builder.build()
    }

    /** Called only through the presentation wrapper used by Media3's picker. */
    fun select(parameters: TrackSelectionParameters) {
        val previous = player.trackSelectionParameters
        val edit = preferences.edit()
        for (type in listOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_TEXT)) {
            val oldOverride = previous.overrides.values.firstOrNull { it.type == type }
            val override = parameters.overrides.values.firstOrNull { it.type == type }
            val disabled = type in parameters.disabledTrackTypes
            if (oldOverride == override && disabled == (type in previous.disabledTrackTypes))
                continue
            restored.add(type)
            if (type == C.TRACK_TYPE_TEXT) edit.putBoolean("subtitles", !disabled)
            val field = type.toString()
            if (type == C.TRACK_TYPE_TEXT && disabled) {
                choices.put(field, JSONObject().put("off", true))
            } else {
                val available = candidates(type)
                val candidate =
                    available.firstOrNull {
                        it.group.mediaTrackGroup == override?.mediaTrackGroup &&
                            override.trackIndices.singleOrNull() == it.index
                    }
                if (candidate == null) choices.remove(field)
                else choices.put(field, describe(candidate, available))
            }
        }
        edit.putString(key, choices.toString()).apply()
    }

    fun close() = player.removeListener(this)
}
