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

@Composable
internal fun AddonsScreen(state: TvState, core: TvCore) {
    val navigation = LocalNavigationFocus.current
    var installing by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<AddonDescriptor?>(null) }
    val closeInstall = {
        core.cancelAddonPreview()
        installing = false
    }
    val found = state.addonPreview?.descriptor
    // A found manifest gets a dialog of its own, like removal, rather than replacing the
    // address field inside the same one.
    if (installing && found != null)
        ConfirmDialog(
            "${found.manifest.name} ${found.manifest.version}",
            stringResource(R.string.install),
            detail = listOfNotNull(found.manifest.description, state.addonPreview?.transportUrl),
            onConfirm = { if (core.installPreviewedAddon()) installing = false },
            onClose = closeInstall,
        )
    else if (installing)
        InstallAddonDialog(state.addonPreview, onPreview = core::previewAddon, onClose = closeInstall)
    removing?.let { addon ->
        ConfirmDialog(
            stringResource(R.string.remove_addon_title, addon.manifest.name),
            stringResource(R.string.remove_addon),
            onConfirm = {
                core.uninstallAddon(addon)
                removing = null
            },
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
                { installing = true },
                Modifier.padding(horizontal = PageGutter).focusProperties { left = navigation },
                border = kinoOutlinedBorder(),
            ) {
                Icon(painterResource(R.drawable.ic_plus), null, Modifier.size(18.dp))
                Text(stringResource(R.string.install_addon), Modifier.padding(start = 10.dp))
            }
        }
        items(state.addons, key = { it.transportUrl }) { addon ->
            val removable = !addon.flags.protected
            Surface(
                onClick = { if (removable) removing = addon },
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
                        if (removable) stringResource(R.string.remove_addon)
                        else stringResource(R.string.addon_built_in),
                        fontSize = 14.sp,
                        color = KinoColors.TextFaint,
                    )
                }
            }
        }
    }
}

@Composable
private fun InstallAddonDialog(
    preview: AddonPreview?,
    onPreview: (String) -> Boolean,
    onClose: () -> Unit,
) {
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
    val field = remember { FocusRequester() }
    Dialog(onDismissRequest = onClose) {
        Column(
            Modifier.width(620.dp)
                .background(SurfaceColor, RoundedCornerShape(12.dp))
                .padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.install_addon), fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            when {
                preview != null && preview.loading ->
                    Text(stringResource(R.string.addon_loading), color = Muted)
                else -> {
                    var focused by remember { mutableStateOf(false) }
                    BasicTextField(
                        address,
                        Modifier.fillMaxWidth()
                            .focusRequester(field)
                            .onFocusChanged { focused = it.isFocused }
                            .border(
                                2.dp,
                                if (focused) KinoColors.TextStrong else KinoColors.Border,
                                RoundedCornerShape(8.dp),
                            )
                            .background(Background, RoundedCornerShape(8.dp))
                            .padding(16.dp),
                        textStyle =
                            MaterialTheme.typography.bodyLarge.copy(color = KinoColors.Text, fontSize = 17.sp),
                        lineLimits = TextFieldLineLimits.SingleLine,
                        keyboardOptions =
                            KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                        onKeyboardAction = { submit() },
                        cursorBrush = SolidColor(KinoColors.TextStrong),
                        decorator = { inner ->
                            Box {
                                if (address.text.isEmpty())
                                    Text(stringResource(R.string.addon_url_hint), color = Muted, fontSize = 17.sp)
                                inner()
                            }
                        },
                    )
                    val error =
                        when {
                            invalid -> R.string.addon_invalid
                            preview?.failed == true -> R.string.addon_failed
                            else -> null
                        }
                    error?.let { Text(stringResource(it), color = KinoColors.Danger, fontSize = 14.sp) }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(submit) {
                            Text(stringResource(R.string.addon_continue))
                        }
                        OutlinedButton(onClose, border = kinoOutlinedBorder()) {
                            Text(stringResource(R.string.cancel))
                        }
                    }
                    LaunchedEffect(Unit) { field.requestFocus() }
                }
            }
        }
    }
}

@Composable
private fun ConfirmDialog(
    title: String,
    confirm: String,
    detail: List<String> = emptyList(),
    onConfirm: () -> Unit,
    onClose: () -> Unit,
) {
    val action = remember { FocusRequester() }
    Dialog(onDismissRequest = onClose) {
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
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onConfirm, Modifier.focusRequester(action)) { Text(confirm) }
                OutlinedButton(onClose, border = kinoOutlinedBorder()) {
                    Text(stringResource(R.string.cancel))
                }
            }
            LaunchedEffect(Unit) { action.requestFocus() }
        }
    }
}
