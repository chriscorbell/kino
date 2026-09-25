package app.kino.tv

import android.content.Context
import android.text.Html
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal data class LicenseFile(val name: String, val path: String, val source: String)

internal data class LicenseComponent(
    val name: String,
    val version: String,
    val license: String?,
    val scope: String,
    val repository: String?,
    val notes: String?,
    val files: List<LicenseFile>,
) {
    val key
        get() = "$name@$version"
}

/** The index scripts/android-notices.mjs packages at build time, read from the APK's assets. */
internal fun readLicenseIndex(context: Context): List<LicenseComponent> {
    val manifest =
        context.assets.open("licenses/manifest.json").bufferedReader().use {
            JSONObject(it.readText())
        }
    val components = manifest.getJSONArray("components")
    fun JSONObject.text(name: String) = if (isNull(name)) null else getString(name)
    return (0 until components.length()).map { index ->
        val item = components.getJSONObject(index)
        val files = item.getJSONArray("files")
        LicenseComponent(
            name = item.getString("name"),
            version = item.getString("version"),
            license = item.text("license"),
            scope = item.getString("scope"),
            repository = item.text("repository"),
            notes = item.text("notes"),
            files =
                (0 until files.length()).map {
                    val file = files.getJSONObject(it)
                    LicenseFile(file.getString("name"), file.getString("path"), file.getString("source"))
                },
        )
    }
}

/**
 * The texts shown for one component, in the index's order. An HTML original that has a plain text
 * extraction beside it, as Rust's COPYRIGHT-library does, shows the extraction; the original stays
 * in the APK. Any other HTML shows its text content rather than markup.
 */
internal fun readLicenseTexts(context: Context, component: LicenseComponent): List<Pair<String, String>> {
    val extracted = component.files.filterNot { it.path.endsWith(".html") }.map { it.source }.toSet()
    return component.files
        .filterNot { it.path.endsWith(".html") && it.source in extracted }
        .map { file ->
            val text =
                context.assets.open("licenses/${file.path}").bufferedReader().use { it.readText() }
            file.name to
                if (file.path.endsWith(".html"))
                    Html.fromHtml(text, Html.FROM_HTML_MODE_LEGACY).toString()
                else text
        }
}

private val ScopeLabels =
    mapOf(
        "Application" to R.string.licenses_scope_application,
        "Playback and Core" to R.string.licenses_scope_playback,
        "Stremio Core" to R.string.licenses_scope_core,
        "Android libraries" to R.string.licenses_scope_android,
        "Fonts and icons" to R.string.licenses_scope_fonts,
    )

@Composable
private fun scopeLabel(scope: String) = ScopeLabels[scope]?.let { stringResource(it) } ?: scope

/**
 * Every component in the APK with its license, grouped the way the index groups them. The section
 * buttons at the top jump past the long crate and library lists, which a remote would otherwise
 * walk one row at a time.
 */
@Composable
internal fun LicensesScreen() {
    val context = LocalContext.current
    val navigation = LocalNavigationFocus.current
    var components by remember { mutableStateOf<List<LicenseComponent>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var opened by remember { mutableStateOf<LicenseComponent?>(null) }
    var lastOpened by remember { mutableStateOf<String?>(null) }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val returnFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        try {
            components = withContext(Dispatchers.IO) { readLicenseIndex(context) }
        } catch (_: Exception) {
            failed = true
        }
    }
    BackHandler(opened != null) { opened = null }

    opened?.let {
        LicenseText(it)
        return
    }
    val all = components
    if (all == null) {
        Column(Modifier.fillMaxSize().padding(top = 28.dp)) {
            PageTitle(R.string.licenses)
            StatusText(if (failed) R.string.licenses_failed else R.string.loading)
        }
        return
    }
    val sections = remember(all) { all.groupBy { it.scope } }
    val firstRows = remember(sections) { sections.keys.associateWith { FocusRequester() } }
    // Title, introduction and section buttons come first; each section is a heading then rows.
    val headings =
        remember(sections) {
            var index = 3
            sections.mapValues { (_, rows) -> index.also { index += rows.size + 1 } }
        }
    // Kino's own row takes focus on arrival; coming back from a text returns it to that row.
    LaunchedEffect(opened) {
        withFrameNanos {}
        if (lastOpened == null) firstRows.values.first().requestFocus()
        else returnFocus.requestFocus()
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        state = list,
        contentPadding = PaddingValues(top = 28.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item { PageTitle(R.string.licenses) }
        item {
            Text(
                stringResource(R.string.licenses_intro),
                Modifier.padding(horizontal = PageGutter),
                color = Muted,
                fontSize = 16.sp,
            )
        }
        item {
            Row(
                Modifier.padding(horizontal = PageGutter, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                sections.forEach { (name, rows) ->
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                list.scrollToItem(headings.getValue(name))
                                withFrameNanos {}
                                firstRows.getValue(name).requestFocus()
                            }
                        },
                        modifier = Modifier.focusProperties { left = navigation },
                        border = kinoOutlinedBorder(),
                    ) {
                        Text("${scopeLabel(name)} · ${rows.size}")
                    }
                }
            }
        }
        sections.forEach { (name, rows) ->
            item(key = "heading:$name") {
                Text(
                    scopeLabel(name),
                    Modifier.padding(start = PageGutter, end = PageGutter, top = 18.dp, bottom = 2.dp),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            items(rows, key = { it.key }) { component ->
                LicenseRow(
                    component,
                    Modifier.then(
                            if (component === rows.first())
                                Modifier.focusRequester(firstRows.getValue(name))
                            else Modifier
                        )
                        .then(
                            if (component.key == lastOpened) Modifier.focusRequester(returnFocus)
                            else Modifier
                        ),
                ) {
                    lastOpened = component.key
                    opened = component
                }
            }
        }
    }
}

@Composable
private fun LicenseRow(component: LicenseComponent, modifier: Modifier, onClick: () -> Unit) {
    val navigation = LocalNavigationFocus.current
    Surface(
        onClick = onClick,
        modifier =
            modifier.padding(horizontal = PageGutter).fillMaxWidth().focusProperties {
                left = navigation
            },
        shape = ClickableSurfaceDefaults.shape(RowShape),
        colors = rowColors(),
        border = rowBorder(),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
    ) {
        Row(
            Modifier.padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Text(
                component.name,
                Modifier.weight(1f),
                fontSize = 17.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(component.version, color = Muted, fontSize = 15.sp, maxLines = 1)
            Text(
                component.license ?: stringResource(R.string.licenses_terms_in_text),
                Modifier.widthIn(max = 360.dp),
                color = Muted,
                fontSize = 15.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * One component's full texts. Text is not focusable on a TV, so the page itself takes focus and
 * moves by most of a screen per press of Up or Down; a held key keeps scrolling without animating,
 * so it does not fall behind the key repeat.
 */
@Composable
private fun LicenseText(component: LicenseComponent) {
    val context = LocalContext.current
    val navigation = LocalNavigationFocus.current
    var texts by remember(component) { mutableStateOf<List<Pair<String, String>>?>(null) }
    var failed by remember(component) { mutableStateOf(false) }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(component) {
        try {
            texts = withContext(Dispatchers.IO) { readLicenseTexts(context, component) }
        } catch (_: Exception) {
            failed = true
        }
    }
    LaunchedEffect(Unit) {
        withFrameNanos {}
        focus.requestFocus()
    }
    // Paragraphs rather than whole files, so a 200 KB text composes only what is on screen.
    val paragraphs =
        remember(texts) {
            texts.orEmpty().flatMap { (name, text) ->
                listOf(name to true) +
                    text.trim().split(Regex("\n[ \t]*\n")).filter { it.isNotBlank() }.map {
                        it.trimEnd() to false
                    }
            }
        }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize()
                .focusRequester(focus)
                .onFocusChanged { focused = it.isFocused }
                .focusProperties { left = navigation }
                .onPreviewKeyEvent { event ->
                    val direction =
                        when (event.key) {
                            Key.DirectionDown -> 1f
                            Key.DirectionUp -> -1f
                            else -> return@onPreviewKeyEvent false
                        }
                    if (event.type == KeyEventType.KeyDown) {
                        val step = list.layoutInfo.viewportSize.height * .7f * direction
                        scope.launch {
                            if (event.nativeKeyEvent.repeatCount > 0) list.scrollBy(step)
                            else list.animateScrollBy(step, tween(220))
                        }
                    }
                    true
                }
                .focusable(),
            state = list,
            contentPadding = PaddingValues(start = PageGutter, end = PageGutter + 24.dp, top = 28.dp, bottom = 80.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "${component.name} ${component.version}",
                        fontSize = 30.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-.6).sp,
                    )
                    Text(
                        listOfNotNull(
                                component.license
                                    ?: stringResource(R.string.licenses_terms_in_text),
                                component.repository,
                            )
                            .joinToString(" · "),
                        color = Muted,
                        fontSize = 16.sp,
                    )
                    component.notes?.let { Text(it, color = Muted, fontSize = 16.sp) }
                }
            }
            when {
                failed -> item { Text(stringResource(R.string.licenses_failed), color = Muted) }
                texts == null -> item { Text(stringResource(R.string.loading), color = Muted) }
                else ->
                    items(paragraphs) { (text, heading) ->
                        if (heading)
                            Text(
                                text,
                                Modifier.padding(top = 18.dp),
                                fontSize = 20.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        else Text(text, fontSize = 16.sp, lineHeight = 24.sp, color = KinoColors.Text)
                    }
            }
        }
        ScrollPosition(list, focused, Modifier.align(Alignment.CenterEnd).padding(end = 14.dp))
    }
}

/** Where the page is in a long text, drawn brighter while the page holds focus. */
@Composable
private fun ScrollPosition(list: LazyListState, focused: Boolean, modifier: Modifier) {
    val color = if (focused) KinoColors.TextStrong else KinoColors.BorderSubtle
    Canvas(modifier.fillMaxHeight(.8f).width(3.dp)) {
        val info = list.layoutInfo
        val total = info.totalItemsCount
        val visible = info.visibleItemsInfo.size
        if (total == 0 || visible >= total) return@Canvas
        drawRoundRect(KinoColors.BorderSubtle, cornerRadius = CornerRadius(size.width / 2))
        val fraction = visible.toFloat() / total
        val start = list.firstVisibleItemIndex.toFloat() / (total - visible).coerceAtLeast(1)
        val height = (size.height * fraction).coerceAtLeast(24.dp.toPx())
        drawRoundRect(
            color,
            topLeft = Offset(0f, (size.height - height) * start.coerceIn(0f, 1f)),
            size = Size(size.width, height),
            cornerRadius = CornerRadius(size.width / 2),
        )
    }
}
