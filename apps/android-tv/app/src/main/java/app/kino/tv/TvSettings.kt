@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.media3.common.MediaLibraryInfo
import androidx.media3.common.util.Util
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.tv.material3.*
import coil3.SingletonImageLoader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal enum class TvLanguage(val code: String, val label: Int) {
    English("eng", R.string.language_eng),
    Spanish("spa", R.string.language_spa),
    French("fre", R.string.language_fre),
    German("ger", R.string.language_ger),
    Italian("ita", R.string.language_ita),
    Portuguese("por", R.string.language_por),
    Dutch("dut", R.string.language_dut),
    Polish("pol", R.string.language_pol),
    Russian("rus", R.string.language_rus),
    Turkish("tur", R.string.language_tur),
    Japanese("jpn", R.string.language_jpn),
    Korean("kor", R.string.language_kor),
    Chinese("chi", R.string.language_chi),
    Hindi("hin", R.string.language_hin),
    Arabic("ara", R.string.language_ara);

    companion object {
        fun fromCode(code: String?) =
            entries.firstOrNull {
                Util.normalizeLanguageCode(it.code) == Util.normalizeLanguageCode(code.orEmpty())
            }
    }
}

internal suspend fun artworkCacheSize(context: Context): Long =
    withContext(Dispatchers.IO) { SingletonImageLoader.get(context).diskCache?.size ?: 0L }

internal suspend fun clearArtworkCache(context: Context): Boolean =
    withContext(Dispatchers.IO) {
        val loader = SingletonImageLoader.get(context)
        loader.memoryCache?.clear()
        loader.diskCache?.clear()
        // An open snapshot can prevent removal. Do not claim that it was cleared.
        (loader.diskCache?.size ?: 0L) == 0L && (loader.memoryCache?.size ?: 0L) == 0L
    }

internal fun diagnosticSummary(context: Context): String {
    val unknown = context.getString(R.string.settings_unknown)
    fun version(value: String?) =
        value?.takeIf { it.matches(Regex("[0-9]+(\\.[0-9]+){0,3}")) } ?: unknown
    // Construct only these fields. Never serialize a profile, device description,
    // player snapshot, exception, or log into the copied text.
    return context.getString(
        R.string.diagnostic_summary_text,
        BuildConfig.VERSION_NAME,
        BuildConfig.VERSION_CODE,
        version(Build.VERSION.RELEASE),
        Build.VERSION.SDK_INT,
        "arm64-v8a",
        BuildConfig.CORE_REVISION,
        MediaLibraryInfo.VERSION,
        FfmpegLibrary.getVersion()?.takeIf { it.matches(Regex("Lavc[0-9]+\\.[0-9]+\\.[0-9]+")) }
            ?: unknown,
        context.getString(
            if (stereoOutputPreferred(context)) R.string.audio_output_stereo
            else R.string.audio_output_auto
        ),
    )
}

internal fun copyDiagnosticSummary(context: Context) {
    context
        .getSystemService(ClipboardManager::class.java)
        .setPrimaryClip(
            ClipData.newPlainText(
                context.getString(R.string.diagnostic_summary),
                diagnosticSummary(context),
            )
        )
}

@Composable
internal fun SettingsScreen(
    core: TvCore,
    state: TvState,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onAddons: () -> Unit,
) {
    val context = LocalContext.current
    val settings = remember { kinoSettings(context) }
    val scope = rememberCoroutineScope()
    var stereo by remember { mutableStateOf(stereoOutputPreferred(context)) }
    var subtitles by remember { mutableStateOf(settings.getBoolean("subtitles", false)) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        stereo = stereoOutputPreferred(context)
        subtitles = settings.getBoolean("subtitles", false)
    }
    var languageDialog by remember { mutableStateOf<Boolean?>(null) }
    val audioFocus = remember { FocusRequester() }
    val subtitleFocus = remember { FocusRequester() }
    var returnFocus by remember { mutableStateOf<FocusRequester?>(null) }
    var saving by remember { mutableStateOf(false) }
    var saveFailed by remember { mutableStateOf(false) }
    var saveAction by remember { mutableStateOf<(suspend () -> Boolean)?>(null) }
    var cacheBytes by remember { mutableStateOf<Long?>(null) }
    var clearing by remember { mutableStateOf(false) }
    var cacheStatus by remember { mutableStateOf<Int?>(null) }
    var diagnosticStatus by remember { mutableStateOf<Int?>(null) }

    fun save(action: suspend () -> Boolean) {
        if (saving) return
        saveAction = action
        saving = true
        saveFailed = false
        scope.launch {
            try {
                saveFailed = !action()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                saveFailed = true
            } finally {
                saving = false
            }
        }
    }

    LaunchedEffect(Unit) {
        try {
            cacheBytes = artworkCacheSize(context)
        } catch (_: java.io.IOException) {
            /* Shown as unavailable. */
        }
    }
    LaunchedEffect(languageDialog) {
        if (languageDialog == null) {
            returnFocus?.requestFocus()
            returnFocus = null
        }
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 28.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { PageTitle(R.string.settings) }
        item { SettingsHeading(R.string.account) }
        item {
            SettingRow(
                if (state.signedIn) R.string.sign_out else R.string.sign_in,
                stringResource(
                    if (state.signedIn) R.string.account_profile else R.string.guest_profile
                ),
                onClick = if (state.signedIn) onSignOut else onSignIn,
            )
        }
        item { SettingRow(R.string.view_addons, onClick = onAddons) }
        item { SettingsHeading(R.string.playback) }
        item {
            SettingRow(
                R.string.audio_output,
                stringResource(
                    if (stereo) R.string.audio_output_stereo else R.string.audio_output_auto
                ),
                description =
                    stringResource(
                        if (stereo) R.string.audio_output_stereo_body
                        else R.string.audio_output_auto_body
                    ),
            ) {
                val next = !stereo
                save {
                    val stored =
                        withContext(Dispatchers.IO) {
                            settings
                                .edit()
                                .putString("audio_output", if (next) "stereo" else "auto")
                                .commit()
                        }
                    if (stored) stereo = next
                    stored
                }
            }
        }
        item {
            SettingRow(
                R.string.subtitles,
                stringResource(if (subtitles) R.string.settings_on else R.string.settings_off),
                description = stringResource(R.string.subtitles_description),
            ) {
                val next = !subtitles
                save {
                    val stored =
                        withContext(Dispatchers.IO) {
                            settings.edit().putBoolean("subtitles", next).commit()
                        }
                    if (stored) subtitles = next
                    stored
                }
            }
        }
        item { SettingsHeading(R.string.languages, R.string.tv_languages_note) }
        item {
            SettingRow(
                R.string.audio_language,
                languageLabel(state.audioLanguage),
                Modifier.focusRequester(audioFocus),
            ) {
                if (!saving) {
                    returnFocus = audioFocus
                    languageDialog = false
                }
            }
        }
        item {
            SettingRow(
                R.string.subtitle_language,
                languageLabel(state.subtitleLanguage),
                Modifier.focusRequester(subtitleFocus),
            ) {
                if (!saving) {
                    returnFocus = subtitleFocus
                    languageDialog = true
                }
            }
        }
        if (saving) item { SettingsMessage(R.string.settings_saving) }
        if (saveFailed)
            item {
                SettingRow(
                    R.string.retry,
                    description = stringResource(R.string.settings_save_failed),
                ) {
                    saveAction?.let(::save)
                }
            }
        item { SettingsHeading(R.string.storage, R.string.tv_cache_description) }
        item {
            SettingRow(
                if (clearing) R.string.clearing else R.string.clear_cache,
                cacheBytes?.let {
                    stringResource(R.string.format_megabytes, (it + 999_999L) / 1_000_000L)
                } ?: stringResource(R.string.settings_unknown),
            ) {
                if (!clearing) {
                    clearing = true
                    cacheStatus = null
                    scope.launch {
                        try {
                            cacheStatus =
                                if (clearArtworkCache(context)) R.string.cache_cleared
                                else R.string.cache_clear_failed
                            cacheBytes = artworkCacheSize(context)
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (_: Exception) {
                            cacheStatus = R.string.cache_clear_failed
                        } finally {
                            clearing = false
                        }
                    }
                }
            }
        }
        cacheStatus?.let { item { SettingsMessage(it) } }
        item { SettingsHeading(R.string.diagnostics, R.string.diagnostic_summary_description) }
        item {
            SettingRow(R.string.copy_diagnostic_summary) {
                diagnosticStatus =
                    try {
                        copyDiagnosticSummary(context)
                        R.string.diagnostic_summary_copied
                    } catch (_: Exception) {
                        R.string.diagnostic_summary_failed
                    }
            }
        }
        diagnosticStatus?.let { item { SettingsMessage(it) } }
        item {
            Text(
                stringResource(R.string.video_output) + " · " + stringResource(R.string.sdr),
                Modifier.padding(horizontal = PageGutter, vertical = 12.dp),
                color = Muted,
                fontSize = 15.sp,
            )
        }
        item {
            Text(
                stringResource(R.string.version, BuildConfig.VERSION_NAME),
                Modifier.padding(horizontal = PageGutter),
                color = KinoColors.TextFaint,
                fontSize = 13.sp,
            )
        }
    }
    languageDialog?.let { text ->
        LanguageDialog(
            if (text) R.string.subtitle_language else R.string.audio_language,
            if (text) state.subtitleLanguage else state.audioLanguage,
            onDismiss = { languageDialog = null },
        ) { language ->
            languageDialog = null
            save { core.setLanguage(language, text) }
        }
    }
}

@Composable
private fun languageLabel(code: String?): String =
    stringResource(
        TvLanguage.fromCode(code)?.label
            ?: if (code.isNullOrBlank()) R.string.settings_default else R.string.settings_unknown
    )

@Composable
private fun SettingsHeading(label: Int, description: Int? = null) {
    Column(
        Modifier.padding(start = PageGutter, end = PageGutter, top = 18.dp, bottom = 2.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(stringResource(label), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        description?.let { Text(stringResource(it), color = Muted, fontSize = 15.sp) }
    }
}

@Composable
private fun SettingsMessage(label: Int) {
    Text(
        stringResource(label),
        Modifier.padding(horizontal = PageGutter),
        color = Muted,
        fontSize = 15.sp,
    )
}

@Composable
private fun SettingRow(
    label: Int,
    value: String = "",
    modifier: Modifier = Modifier,
    description: String? = null,
    onClick: () -> Unit,
) {
    val navigation = LocalNavigationFocus.current
    val shape = RoundedCornerShape(8.dp)
    Surface(
        onClick = onClick,
        modifier =
            modifier.padding(horizontal = PageGutter).fillMaxWidth().focusProperties {
                left = navigation
            },
        shape = ClickableSurfaceDefaults.shape(shape),
        colors =
            ClickableSurfaceDefaults.colors(
                containerColor = Background,
                focusedContainerColor = SurfaceColor,
            ),
        border =
            ClickableSurfaceDefaults.border(
                focusedBorder = Border(BorderStroke(2.dp, KinoColors.TextStrong), shape = shape)
            ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
    ) {
        Column(
            Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Text(
                    stringResource(label),
                    Modifier.weight(1f),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Medium,
                )
                if (value.isNotEmpty()) Text(value, color = Muted, fontSize = 17.sp)
            }
            description?.let { Text(it, color = Muted, fontSize = 15.sp) }
        }
    }
}

@Composable
private fun LanguageDialog(
    label: Int,
    current: String?,
    onDismiss: () -> Unit,
    onSelect: (TvLanguage) -> Unit,
) {
    val currentLanguage = TvLanguage.fromCode(current)
    val index = TvLanguage.entries.indexOf(currentLanguage).coerceAtLeast(0)
    val list = rememberLazyListState(initialFirstVisibleItemIndex = (index - 2).coerceAtLeast(0))
    val focus = remember { FocusRequester() }
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.width(480.dp)
                .background(SurfaceColor, RoundedCornerShape(12.dp))
                .padding(24.dp)
        ) {
            Text(
                stringResource(label),
                Modifier.padding(bottom = 16.dp),
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
            )
            LazyColumn(
                Modifier.height(320.dp),
                state = list,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                itemsIndexed(TvLanguage.entries, key = { _, language -> language.code }) {
                    position,
                    language ->
                    val chosen = language == currentLanguage
                    Surface(
                        onClick = { onSelect(language) },
                        modifier =
                            Modifier.fillMaxWidth()
                                .then(
                                    if (position == index) Modifier.focusRequester(focus)
                                    else Modifier
                                )
                                .semantics {
                                    role = Role.RadioButton
                                    selected = chosen
                                },
                        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(6.dp)),
                        scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
                    ) {
                        Row(
                            Modifier.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                stringResource(language.label),
                                Modifier.weight(1f),
                                fontSize = 18.sp,
                            )
                            if (chosen)
                                Icon(
                                    painterResource(R.drawable.ic_check),
                                    null,
                                    Modifier.size(20.dp),
                                )
                        }
                    }
                }
            }
        }
        LaunchedEffect(Unit) {
            withFrameNanos {}
            focus.requestFocus()
        }
    }
}
