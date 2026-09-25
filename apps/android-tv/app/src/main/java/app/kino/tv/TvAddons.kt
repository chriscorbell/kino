package app.kino.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.tv.material3.*
import com.stremio.core.types.addon.AddonDescriptor
import java.net.URI

/**
 * The manifest address behind a pasted add-on link: `stremio://` becomes HTTPS, as Stremio's own
 * install links mean it. Anything that is not an HTTPS `manifest.json` without credentials is
 * refused before Core is asked, since Core would refuse it anyway.
 */
internal fun addonManifestUrl(input: String): String? {
    val trimmed = input.trim()
    val address =
        if (trimmed.startsWith("stremio://", ignoreCase = true)) "https://" + trimmed.substring(10)
        else trimmed
    val uri = runCatching { URI(address) }.getOrNull() ?: return null
    if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) return null
    if (uri.rawUserInfo != null || !uri.rawPath.orEmpty().endsWith("/manifest.json")) return null
    return address
}

/**
 * The add-on's own settings page, which Stremio add-ons serve as `configure` beside their
 * manifest. Only add-ons that say they can be configured have one.
 */
internal fun addonConfigurationUrl(addon: AddonDescriptor): String? {
    val hints = addon.manifest.behaviorHints
    if (!hints.configurable && !hints.configurationRequired) return null
    val manifest = addonManifestUrl(addon.transportUrl) ?: return null
    return URI(manifest).resolve("configure").toString()
}

/** What the add-on dialog is asking for: any add-on's address, or a new configuration of one. */
private sealed interface AddonTask {
    data object Install : AddonTask

    /** [replacing] is the installed configuration a new one takes the place of, if any. */
    data class Configure(
        val name: String,
        val configureUrl: String,
        val replacing: AddonDescriptor?,
    ) : AddonTask
}

private class Choice(val label: String, val onSelect: () -> Unit)

@Composable
internal fun AddonsScreen(state: TvState, core: TvCore) {
    val navigation = LocalNavigationFocus.current
    var task by remember { mutableStateOf<AddonTask?>(null) }
    var choosing by remember { mutableStateOf<AddonDescriptor?>(null) }
    var removing by remember { mutableStateOf<AddonDescriptor?>(null) }
    var installFailed by remember { mutableStateOf(false) }
    val closeTask = {
        core.cancelAddonPreview()
        installFailed = false
        task = null
    }
    val found = state.addonPreview?.descriptor
    val current = task
    // A found manifest gets a dialog of its own, like removal, rather than replacing the
    // address field inside the same one.
    if (current != null && found != null) {
        val title = "${found.manifest.name} ${found.manifest.version}"
        val setup =
            addonConfigurationUrl(found)?.takeIf { found.manifest.behaviorHints.configurationRequired }
        if (setup != null)
            ChoiceDialog(
                title,
                detail = listOfNotNull(found.manifest.description, stringResource(R.string.addon_needs_setup)),
                choices =
                    listOf(
                        Choice(stringResource(R.string.configure_addon)) {
                            core.cancelAddonPreview()
                            task = AddonTask.Configure(found.manifest.name, setup, null)
                        }
                    ),
                onClose = closeTask,
            )
        else {
            val replacing =
                (current as? AddonTask.Configure)?.replacing?.takeIf {
                    it.manifest.id == found.manifest.id && it.transportUrl != found.transportUrl
                }
            ChoiceDialog(
                title,
                detail =
                    listOfNotNull(
                        found.manifest.description,
                        state.addonPreview?.transportUrl,
                        replacing?.let { stringResource(R.string.addon_replaces) },
                    ),
                error = if (installFailed) stringResource(R.string.addon_install_failed) else null,
                choices =
                    listOf(
                        Choice(stringResource(R.string.install)) {
                            if (core.installPreviewedAddon(replacing)) {
                                installFailed = false
                                task = null
                            } else installFailed = true
                        }
                    ),
                onClose = closeTask,
            )
        }
    } else if (current != null)
        AddonAddressDialog(current, state.addonPreview, onPreview = core::previewAddon, onClose = closeTask)
    choosing?.let { addon ->
        val configure = addonConfigurationUrl(addon)
        ChoiceDialog(
            addon.manifest.name,
            detail = listOfNotNull(addon.manifest.description),
            choices =
                listOfNotNull(
                    configure?.let {
                        Choice(stringResource(R.string.configure_addon)) {
                            choosing = null
                            task = AddonTask.Configure(addon.manifest.name, it, addon)
                        }
                    },
                    Choice(stringResource(R.string.remove_addon)) {
                            choosing = null
                            removing = addon
                        }
                        .takeIf { !addon.flags.protected },
                ),
            onClose = { choosing = null },
        )
    }
    removing?.let { addon ->
        ChoiceDialog(
            stringResource(R.string.remove_addon_title, addon.manifest.name),
            choices =
                listOf(
                    Choice(stringResource(R.string.remove_addon)) {
                        core.uninstallAddon(addon)
                        removing = null
                    }
                ),
            onClose = { removing = null },
        )
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 28.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { PageTitle(R.string.addons) }
        item {
            OutlinedButton(
                { task = AddonTask.Install },
                Modifier.padding(horizontal = PageGutter).focusProperties { left = navigation },
                border = kinoOutlinedBorder(),
            ) {
                Icon(painterResource(R.drawable.ic_plus), null, Modifier.size(18.dp))
                Text(stringResource(R.string.install_addon), Modifier.padding(start = 10.dp))
            }
        }
        items(state.addons, key = { it.transportUrl }) { addon ->
            val removable = !addon.flags.protected
            val configurable = addonConfigurationUrl(addon) != null
            Surface(
                onClick = {
                    when {
                        configurable -> choosing = addon
                        removable -> removing = addon
                    }
                },
                modifier =
                    Modifier.padding(horizontal = PageGutter)
                        .fillMaxWidth()
                        .focusProperties { left = navigation },
                shape = ClickableSurfaceDefaults.shape(RowShape),
                colors = rowColors(),
                border = rowBorder(),
                scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
            ) {
                Row(
                    Modifier.padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Icon(
                        painterResource(R.drawable.ic_blocks),
                        null,
                        Modifier.size(22.dp),
                        tint = Muted,
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(addon.manifest.name, fontSize = 18.sp, fontWeight = FontWeight.Medium)
                        addon.manifest.description?.takeIf { it.isNotBlank() }?.let {
                            Text(
                                it,
                                fontSize = 13.sp,
                                color = Muted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    Text(
                        stringResource(
                            when {
                                configurable -> R.string.configure_addon
                                removable -> R.string.remove_addon
                                else -> R.string.addon_built_in
                            }
                        ),
                        fontSize = 14.sp,
                        color = KinoColors.TextFaint,
                    )
                }
            }
        }
    }
}

/**
 * Asks for an add-on address. The remote can type one, and while the TV is on a home network a QR
 * code opens a page on a phone that sends one instead, which is far easier for the long addresses
 * a configured add-on has. Configuring also links to the add-on's settings page from there.
 */
@Composable
private fun AddonAddressDialog(
    task: AddonTask,
    preview: AddonPreview?,
    onPreview: (String) -> Boolean,
    onClose: () -> Unit,
) {
    val configure = task as? AddonTask.Configure
    val title =
        if (configure != null) stringResource(R.string.configure_addon_title, configure.name)
        else stringResource(R.string.install_addon)
    val handoff = rememberAddonHandoff(title, configure?.configureUrl) { onPreview(it) }
    // With a phone to send from, typing waits until asked for, since the remote's keyboard would
    // cover the QR code.
    var typing by remember { mutableStateOf(handoff == null) }
    val address = rememberTextFieldState()
    var invalid by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    // Submitting puts the keyboard away, since the field is about to leave the dialog.
    val submit = {
        keyboard?.hide()
        focusManager.clearFocus()
        invalid = !onPreview(address.text.toString())
    }
    val initial = remember { FocusRequester() }
    Dialog(onDismissRequest = onClose, properties = WideDialog) {
        Row(
            Modifier.width(if (handoff != null) 820.dp else 620.dp)
                .background(SurfaceColor, RoundedCornerShape(12.dp))
                .padding(28.dp),
            horizontalArrangement = Arrangement.spacedBy(32.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                val body =
                    when {
                        configure != null && handoff != null -> stringResource(R.string.configure_addon_body)
                        configure != null ->
                            stringResource(R.string.configure_addon_body_typed, configure.configureUrl)
                        handoff != null -> stringResource(R.string.install_addon_body)
                        else -> null
                    }
                body?.let { Text(it, color = Muted, fontSize = 15.sp) }
                val error =
                    when {
                        invalid -> R.string.addon_invalid
                        preview?.failed == true -> R.string.addon_failed
                        else -> null
                    }
                when {
                    preview != null && preview.loading ->
                        Text(stringResource(R.string.addon_loading), color = Muted)
                    !typing -> {
                        error?.let { Text(stringResource(it), color = KinoColors.Danger, fontSize = 14.sp) }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedButton(
                                { typing = true },
                                Modifier.focusRequester(initial),
                                border = kinoOutlinedBorder(),
                            ) {
                                Text(stringResource(R.string.addon_type_address))
                            }
                            OutlinedButton(onClose, border = kinoOutlinedBorder()) {
                                Text(stringResource(R.string.cancel))
                            }
                        }
                    }
                    else -> {
                        var focused by remember { mutableStateOf(false) }
                        BasicTextField(
                            address,
                            Modifier.fillMaxWidth()
                                .focusRequester(initial)
                                .onFocusChanged { focused = it.isFocused }
                                .border(
                                    2.dp,
                                    if (focused) KinoColors.TextStrong else KinoColors.Border,
                                    RoundedCornerShape(8.dp),
                                )
                                .background(Background, RoundedCornerShape(8.dp))
                                .padding(16.dp),
                            textStyle =
                                MaterialTheme.typography.bodyLarge.copy(
                                    color = KinoColors.Text,
                                    fontSize = 17.sp,
                                ),
                            lineLimits = TextFieldLineLimits.SingleLine,
                            keyboardOptions =
                                KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                            onKeyboardAction = { submit() },
                            cursorBrush = SolidColor(KinoColors.TextStrong),
                            decorator = { inner ->
                                Box {
                                    if (address.text.isEmpty())
                                        Text(
                                            stringResource(R.string.addon_url_hint),
                                            color = Muted,
                                            fontSize = 17.sp,
                                        )
                                    inner()
                                }
                            },
                        )
                        error?.let { Text(stringResource(it), color = KinoColors.Danger, fontSize = 14.sp) }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Button(submit) { Text(stringResource(R.string.addon_continue)) }
                            OutlinedButton(onClose, border = kinoOutlinedBorder()) {
                                Text(stringResource(R.string.cancel))
                            }
                        }
                    }
                }
                // Focus follows each change of step: the typing button, then the field it opens,
                // and back to whichever is shown after a failed load.
                val loading = preview?.loading == true
                LaunchedEffect(typing, loading) { if (!loading) initial.requestFocus() }
            }
            handoff?.let {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(R.string.handoff_scan), color = Muted, fontSize = 14.sp)
                    PhoneHandoff(it)
                }
            }
        }
    }
}

@Composable
private fun ChoiceDialog(
    title: String,
    detail: List<String> = emptyList(),
    error: String? = null,
    choices: List<Choice>,
    onClose: () -> Unit,
) {
    val action = remember { FocusRequester() }
    Dialog(onDismissRequest = onClose, properties = WideDialog) {
        Column(
            Modifier.width(460.dp)
                .background(SurfaceColor, RoundedCornerShape(12.dp))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            detail.filter { it.isNotBlank() }.forEach {
                Text(it, fontSize = 14.sp, color = Muted, maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
            error?.let { Text(it, fontSize = 14.sp, color = KinoColors.Danger) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                choices.forEachIndexed { index, choice ->
                    if (index == 0)
                        Button(choice.onSelect, Modifier.focusRequester(action)) { Text(choice.label) }
                    else
                        OutlinedButton(choice.onSelect, border = kinoOutlinedBorder()) {
                            Text(choice.label)
                        }
                }
                OutlinedButton(onClose, border = kinoOutlinedBorder()) {
                    Text(stringResource(R.string.cancel))
                }
            }
            LaunchedEffect(Unit) { action.requestFocus() }
        }
    }
}
