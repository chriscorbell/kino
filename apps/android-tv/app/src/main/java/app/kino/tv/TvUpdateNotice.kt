package app.kino.tv

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.*
import kotlinx.coroutines.delay

/** The line Settings shows beside Check for updates. */
@Composable
internal fun updateSummary(state: UpdateState): String =
    when (state) {
        UpdateState.Idle -> ""
        UpdateState.Checking -> stringResource(R.string.update_checking)
        UpdateState.Current -> stringResource(R.string.update_current)
        UpdateState.NoChannel -> stringResource(R.string.update_no_channel)
        UpdateState.CheckFailed -> stringResource(R.string.update_check_failed)
        is UpdateState.Available -> stringResource(R.string.update_available, state.release.version)
        is UpdateState.Downloading ->
            stringResource(R.string.update_downloading, (state.progress * 100).toInt())
        is UpdateState.NeedsPermission -> stringResource(R.string.update_needs_permission_short)
        is UpdateState.Refused -> stringResource(R.string.update_refused_short)
        is UpdateState.DownloadFailed -> stringResource(R.string.update_download_failed)
        is UpdateState.Installing -> stringResource(R.string.update_installing)
    }

internal fun UpdateState.release(): KinoRelease? =
    when (this) {
        is UpdateState.Available -> release
        is UpdateState.Downloading -> release
        is UpdateState.NeedsPermission -> release
        is UpdateState.Refused -> release
        is UpdateState.DownloadFailed -> release
        is UpdateState.Installing -> release
        else -> null
    }

/**
 * The update notice. It offers the release, then shows the download, the checks, and Android's own
 * confirmation in place, so the viewer follows one dialog from Install to the installer's prompt.
 */
@Composable
internal fun UpdateNotice(updates: TvUpdates, state: UpdateState, onClose: () -> Unit) {
    val release = state.release() ?: return
    val context = LocalContext.current
    val primary = remember { FocusRequester() }
    val close = remember { FocusRequester() }
    // Returning from Android's install-permission screen without an answer that ended the process.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        updates.resume()
        if (state is UpdateState.NeedsPermission && context.packageManager.canRequestPackageInstalls())
            updates.install(release)
    }
    Dialog(onDismissRequest = onClose, properties = WideDialog) {
        Column(
            Modifier.width(640.dp)
                .background(SurfaceColor, RoundedCornerShape(12.dp))
                .padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                stringResource(R.string.update_title, release.version),
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
            )
            val detail =
                when (state) {
                    is UpdateState.Downloading ->
                        stringResource(R.string.update_downloading, (state.progress * 100).toInt())
                    is UpdateState.NeedsPermission ->
                        stringResource(R.string.update_needs_permission)
                    is UpdateState.Refused ->
                        stringResource(
                            when (state.reason) {
                                UpdateRefusal.Checksum -> R.string.update_refused_checksum
                                UpdateRefusal.Package -> R.string.update_refused_package
                                UpdateRefusal.NotNewer -> R.string.update_refused_not_newer
                                UpdateRefusal.Signer -> R.string.update_refused_signer
                            }
                        )
                    is UpdateState.DownloadFailed -> stringResource(R.string.update_download_failed)
                    is UpdateState.Installing ->
                        stringResource(
                            when (state.status) {
                                InstallStatus.Waiting -> R.string.update_verifying
                                InstallStatus.Confirming -> R.string.update_confirming
                                InstallStatus.Cancelled -> R.string.update_cancelled
                                is InstallStatus.Failed -> R.string.update_install_failed
                            }
                        )
                    else -> stringResource(R.string.update_body, BuildConfig.VERSION_NAME)
                }
            Text(detail, fontSize = 15.sp, color = Muted)
            if (state is UpdateState.Downloading)
                Box(Modifier.fillMaxWidth().height(4.dp).background(KinoColors.BorderSubtle)) {
                    Box(
                        Modifier.fillMaxWidth(state.progress.coerceIn(0f, 1f))
                            .fillMaxHeight()
                            .background(KinoColors.TextStrong)
                    )
                }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                when (state) {
                    is UpdateState.NeedsPermission ->
                        Button(
                            {
                                updates.awaitPermission(release)
                                context.startActivity(
                                    Intent(
                                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                            Uri.parse("package:${context.packageName}"),
                                        )
                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                )
                            },
                            Modifier.focusRequester(primary),
                        ) {
                            Text(stringResource(R.string.update_allow))
                        }
                    is UpdateState.Available,
                    is UpdateState.DownloadFailed,
                    is UpdateState.Refused -> {
                        Button({ updates.install(release) }, Modifier.focusRequester(primary)) {
                            Text(
                                stringResource(
                                    if (state is UpdateState.Available) R.string.update_install
                                    else R.string.retry
                                )
                            )
                        }
                    }
                    is UpdateState.Installing ->
                        if (state.status == InstallStatus.Cancelled || state.status is InstallStatus.Failed)
                            Button({ updates.install(release) }, Modifier.focusRequester(primary)) {
                                Text(stringResource(R.string.retry))
                            }
                    else -> {}
                }
                if (state is UpdateState.Available) {
                    OutlinedButton(
                        {
                            updates.remindTomorrow()
                            onClose()
                        },
                        border = kinoOutlinedBorder(),
                    ) {
                        Text(stringResource(R.string.update_remind))
                    }
                    OutlinedButton(
                        {
                            updates.skip(release)
                            onClose()
                        },
                        border = kinoOutlinedBorder(),
                    ) {
                        Text(stringResource(R.string.update_skip))
                    }
                } else
                    OutlinedButton(
                        onClose,
                        Modifier.focusRequester(close),
                        border = kinoOutlinedBorder(),
                    ) {
                        Text(stringResource(R.string.close))
                    }
            }
            // The primary action moves with the state; without one, Close holds focus.
            LaunchedEffect(state::class, (state as? UpdateState.Installing)?.status) {
                withFrameNanos {}
                if (runCatching { primary.requestFocus() }.isFailure)
                    runCatching { close.requestFocus() }
            }
        }
    }
}

/**
 * The daily check and the notice it may raise. The notice waits for playback to end, and a release
 * the viewer skipped or put off until tomorrow does not raise it.
 */
@Composable
internal fun UpdatePrompt(updates: TvUpdates) {
    val state by updates.state.collectAsStateWithLifecycle()
    var open by rememberSaveable { mutableStateOf(false) }
    var dismissed by rememberSaveable { mutableStateOf(false) }
    val resumed = remember { updates.resumed() }
    // At launch once a day has passed, then again whenever the next day comes while Kino stays open.
    LaunchedEffect(Unit) {
        if (resumed != null) updates.check() else updates.checkIfDue()
        while (true) {
            delay(updates.untilDue().coerceAtLeast(60_000L))
            updates.checkIfDue()
        }
    }
    val offered = (state as? UpdateState.Available)?.release
    LaunchedEffect(offered) {
        if (offered == null || dismissed) return@LaunchedEffect
        // The release the viewer chose to install before allowing it opens even if put off.
        if (offered.version == resumed || updates.noticeWanted(offered)) open = true
        if (resumed != null) updates.clearResumed()
    }
    if (open)
        UpdateNotice(updates, state) {
            open = false
            dismissed = true
        }
}
