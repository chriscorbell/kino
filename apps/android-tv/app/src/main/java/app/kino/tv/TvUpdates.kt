package app.kino.tv

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import java.io.File
import java.math.BigInteger
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

/*
 * Kino's update path on the TV. It follows the desktop's release rules: one check a day, the same
 * channel choice, and a notice that offers the update without ever installing it silently. Where
 * the desktop hands the release page to a browser, a TV has none, so Kino downloads the APK from
 * the release itself, checks it against the release's SHA256SUMS and the certificate the installed
 * app is signed with, and gives it to Android's package installer, which asks the viewer to confirm.
 */

/** A Kino version, parsed the way the desktop's `releases.ts` parses one. */
internal data class KinoVersion(val numbers: List<BigInteger>, val prerelease: List<String>) {
    companion object {
        private val pattern =
            Regex(
                """^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"""
            )

        fun parse(value: String): KinoVersion? {
            val match = pattern.matchEntire(value) ?: return null
            val prerelease = match.groupValues[4].takeIf { it.isNotEmpty() }?.split('.').orEmpty()
            if (prerelease.any { Regex("^0\\d+$").matches(it) }) return null
            return KinoVersion((1..3).map { match.groupValues[it].toBigInteger() }, prerelease)
        }
    }
}

/** Semantic version order: 1 when [left] is newer, -1 when older, null when either is invalid. */
internal fun compareKinoVersions(left: String, right: String): Int? {
    val a = KinoVersion.parse(left) ?: return null
    val b = KinoVersion.parse(right) ?: return null
    for (index in 0 until 3) {
        val order = a.numbers[index].compareTo(b.numbers[index])
        if (order != 0) return order.coerceIn(-1, 1)
    }
    if (a.prerelease.isEmpty() || b.prerelease.isEmpty())
        return (if (a.prerelease.isEmpty()) 1 else 0) - (if (b.prerelease.isEmpty()) 1 else 0)
    for (index in 0 until maxOf(a.prerelease.size, b.prerelease.size)) {
        val x = a.prerelease.getOrNull(index)
        val y = b.prerelease.getOrNull(index)
        if (x == y) continue
        if (x == null || y == null) return if (x == null) -1 else 1
        val xNumeric = x.all(Char::isDigit)
        val yNumeric = y.all(Char::isDigit)
        if (xNumeric && yNumeric) return x.toBigInteger().compareTo(y.toBigInteger()).coerceIn(-1, 1)
        if (xNumeric != yNumeric) return if (xNumeric) -1 else 1
        return x.compareTo(y).coerceIn(-1, 1)
    }
    return 0
}

/** A published release newer than the installed app, named only by its validated tag. */
internal data class KinoRelease(val version: String, val tag: String) {
    val apkName
        get() = "Kino-TV-$version.apk"
}

internal class ReleaseChannelUnavailable : Exception()

/**
 * The newest release after [current] in the feed's JSON, or null when there is none. A preview
 * build reads the whole list, pre-releases included; a stable build reads the latest release only.
 * Anything malformed fails the check rather than being skipped, as on the desktop.
 */
internal fun newestRelease(current: String, body: String): KinoRelease? {
    val preview = checkNotNull(KinoVersion.parse(current)).prerelease.isNotEmpty()
    val releases =
        if (preview) JSONArray(body).let { list -> (0 until list.length()).map(list::getJSONObject) }
        else listOf(JSONObject(body))
    var newest: KinoRelease? = null
    for (release in releases) {
        val draft = release.get("draft") as? Boolean ?: error("Invalid release flags")
        val prerelease = release.get("prerelease") as? Boolean ?: error("Invalid release flags")
        if (draft || (!preview && prerelease)) continue
        val tag = release.get("tag_name") as? String ?: error("Invalid release tag")
        val version = KinoVersion.parse(tag) ?: error("Invalid release tag")
        if (!preview && version.prerelease.isNotEmpty()) continue
        val name = tag.removePrefix("v")
        if (
            compareKinoVersions(name, current)!! > 0 &&
                (newest == null || compareKinoVersions(name, newest.version)!! > 0)
        )
            newest = KinoRelease(name, tag)
    }
    return newest
}

/**
 * Where releases come from. Download addresses are built from the validated tag and the release
 * workflow's fixed asset names; nothing in a response becomes a URL Kino fetches.
 */
internal class UpdateSource(
    val feed: HttpUrl = "https://api.github.com/repos/chriscorbell/kino/releases".toHttpUrl(),
    val downloads: HttpUrl = "https://github.com/chriscorbell/kino/releases/download".toHttpUrl(),
    val client: OkHttpClient = OkHttpClient(),
) {
    fun asset(release: KinoRelease, name: String): HttpUrl =
        downloads.newBuilder().addPathSegment(release.tag).addPathSegment(name).build()
}

internal suspend fun checkForUpdate(current: String, source: UpdateSource): KinoRelease? =
    withContext(Dispatchers.IO) {
        val preview = checkNotNull(KinoVersion.parse(current)).prerelease.isNotEmpty()
        val url =
            if (preview) source.feed.newBuilder().addQueryParameter("per_page", "100").build()
            else source.feed.newBuilder().addPathSegment("latest").build()
        val request =
            Request.Builder()
                .url(url)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2026-03-10")
                .build()
        source.client
            .newBuilder()
            .followRedirects(false)
            .build()
            .newCall(request)
            .execute()
            .use { response ->
                if (response.code == 404) throw ReleaseChannelUnavailable()
                check(response.isSuccessful) { "Release check failed" }
                newestRelease(current, checkNotNull(response.body).string())
            }
    }

/** Why a downloaded update was refused before Android saw it. */
internal enum class UpdateRefusal {
    Checksum,
    Package,
    NotNewer,
    Signer,
}

internal class UpdateRefused(val reason: UpdateRefusal) : Exception(reason.name)

private fun sha256(file: File): String =
    MessageDigest.getInstance("SHA-256")
        .let { digest ->
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            digest.digest()
        }
        .joinToString("") { "%02x".format(it) }

/** The checksum the release's SHA256SUMS lists for [name], in `sha256sum` output format. */
internal fun listedChecksum(sums: String, name: String): String? =
    sums.lineSequence()
        .map { it.trim().split(Regex("\\s+\\*?"), limit = 2) }
        .firstOrNull { it.size == 2 && it[1] == name && it[0].matches(Regex("[0-9a-f]{64}")) }
        ?.get(0)

private fun signers(info: PackageInfo): Set<String> =
    info.signingInfo
        ?.let { if (it.hasMultipleSigners()) it.apkContentsSigners else it.signingCertificateHistory }
        .orEmpty()
        .map { it.toCharsString() }
        .toSet()

/**
 * Accepts [apk] only if it matches the release's checksum and is a newer build of this app signed
 * with the certificate [installed] was signed with. Android would refuse a different signer too,
 * but only after the viewer confirmed, with a message that does not say why.
 */
internal fun verifyUpdate(context: Context, apk: File, checksum: String, installed: PackageInfo) {
    if (sha256(apk) != checksum) throw UpdateRefused(UpdateRefusal.Checksum)
    val archive =
        context.packageManager.getPackageArchiveInfo(
            apk.path,
            PackageManager.GET_SIGNING_CERTIFICATES,
        ) ?: throw UpdateRefused(UpdateRefusal.Package)
    if (archive.packageName != installed.packageName) throw UpdateRefused(UpdateRefusal.Package)
    if (archive.longVersionCode <= installed.longVersionCode)
        throw UpdateRefused(UpdateRefusal.NotNewer)
    val expected = signers(installed)
    if (expected.isEmpty() || signers(archive) != expected) throw UpdateRefused(UpdateRefusal.Signer)
}

internal fun installedPackage(context: Context): PackageInfo =
    context.packageManager.getPackageInfo(
        context.packageName,
        PackageManager.GET_SIGNING_CERTIFICATES,
    )

/** Downloads the release's checksums and APK into the cache, reporting progress as a fraction. */
internal suspend fun downloadUpdate(
    context: Context,
    release: KinoRelease,
    source: UpdateSource,
    onProgress: (Float) -> Unit,
): Pair<File, String> =
    withContext(Dispatchers.IO) {
        val directory = File(context.cacheDir, "updates").apply { deleteRecursively(); mkdirs() }
        val sums =
            source.client.newCall(Request.Builder().url(source.asset(release, "SHA256SUMS")).build())
                .execute()
                .use { response ->
                    check(response.isSuccessful) { "Checksum download failed" }
                    checkNotNull(response.body).string()
                }
        val checksum =
            listedChecksum(sums, release.apkName) ?: throw UpdateRefused(UpdateRefusal.Checksum)
        val apk = File(directory, release.apkName)
        source.client.newCall(Request.Builder().url(source.asset(release, release.apkName)).build())
            .execute()
            .use { response ->
                check(response.isSuccessful) { "Update download failed" }
                val body = checkNotNull(response.body)
                val total = body.contentLength()
                apk.outputStream().use { output ->
                    body.byteStream().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        var copied = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            copied += read
                            if (total > 0) onProgress((copied.toFloat() / total).coerceIn(0f, 1f))
                        }
                    }
                }
            }
        apk to checksum
    }

/** What Android's installer last reported for a session this process started. */
internal sealed interface InstallStatus {
    data object Waiting : InstallStatus

    data object Confirming : InstallStatus

    data object Cancelled : InstallStatus

    data class Failed(val status: Int) : InstallStatus
}

/**
 * Hands [apk] to Android's package installer. The viewer always confirms: on Android 12 and later
 * Kino asks for that explicitly, since an app updating itself could otherwise skip the prompt.
 * Status comes back to a receiver registered in this process, so the guest and account processes
 * each hear about their own sessions.
 */
internal fun installUpdate(context: Context, apk: File, status: MutableStateFlow<InstallStatus>): Int {
    val app = context.applicationContext
    val action = "${app.packageName}.INSTALL_STATUS.${android.os.Process.myPid()}"
    val receiver =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (val code = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
                    PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                        status.value = InstallStatus.Confirming
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)?.let {
                            app.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        }
                    }
                    PackageInstaller.STATUS_FAILURE_ABORTED -> {
                        status.value = InstallStatus.Cancelled
                        app.unregisterReceiver(this)
                    }
                    else -> {
                        status.value = InstallStatus.Failed(code)
                        app.unregisterReceiver(this)
                    }
                }
            }
        }
    ContextCompat.registerReceiver(
        app,
        receiver,
        IntentFilter(action),
        ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    val installer = app.packageManager.packageInstaller
    val params =
        PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(app.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        }
    val id = installer.createSession(params)
    installer.openSession(id).use { session ->
        apk.inputStream().use { input ->
            session.openWrite("kino.apk", 0, apk.length()).use { output ->
                input.copyTo(output)
                session.fsync(output)
            }
        }
        status.value = InstallStatus.Waiting
        val intent = Intent(action).setPackage(app.packageName)
        val pending =
            PendingIntent.getBroadcast(
                app,
                id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
        session.commit(pending.intentSender)
    }
    return id
}

/**
 * Android 11 reports nothing when the viewer backs out of the installer's prompt; the session just
 * waits. When Kino is in front again with a session that is not installing, the prompt was
 * dismissed, so the session is abandoned and reported as cancelled. A session Android is still
 * installing is left alone.
 */
internal fun settleDismissedInstall(context: Context, id: Int, status: MutableStateFlow<InstallStatus>) {
    if (status.value != InstallStatus.Confirming) return
    val installer = context.packageManager.packageInstaller
    val session = installer.getSessionInfo(id) ?: return
    if (session.isActive) return
    runCatching { installer.abandonSession(id) }
    status.value = InstallStatus.Cancelled
}

/** Where the update path stands, for the notice and for Settings. */
internal sealed interface UpdateState {
    data object Idle : UpdateState

    data object Checking : UpdateState

    data object Current : UpdateState

    data object NoChannel : UpdateState

    data object CheckFailed : UpdateState

    data class Available(val release: KinoRelease) : UpdateState

    data class Downloading(val release: KinoRelease, val progress: Float) : UpdateState

    data class NeedsPermission(val release: KinoRelease) : UpdateState

    data class Refused(val release: KinoRelease, val reason: UpdateRefusal) : UpdateState

    data class DownloadFailed(val release: KinoRelease) : UpdateState

    data class Installing(val release: KinoRelease, val status: InstallStatus) : UpdateState
}

/**
 * One per process. The daily limit, a snoozed notice and a skipped version are device settings,
 * shared by the guest and account processes through [KinoSettingsStore]; each process checks and
 * installs on its own.
 */
internal class TvUpdates(
    private val context: Context,
    private val settings: KinoSettingsStore,
    private val current: String = BuildConfig.VERSION_NAME,
    private val source: UpdateSource = UpdateSource(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutable = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = mutable.asStateFlow()
    private val installStatus = MutableStateFlow<InstallStatus>(InstallStatus.Waiting)
    private var work: Job? = null
    private var session: Int? = null

    /** Kino is in front again; a prompt the viewer backed out of becomes a cancelled install. */
    fun resume() {
        session?.let { settleDismissedInstall(context, it, installStatus) }
    }

    private fun time(key: String) = settings.getString(key, null)?.toLongOrNull() ?: 0L

    /** The daily check: once a day has passed since the last attempt, failed or not. */
    fun checkIfDue() {
        if (untilDue() == 0L) check()
    }

    /** How long until the next daily check is due. */
    fun untilDue(): Long = (time(LAST_ATTEMPT) + DAY - now()).coerceIn(0L, DAY)

    fun check() {
        if (work?.isActive == true) return
        work =
            scope.launch {
                mutable.value = UpdateState.Checking
                settings.edit().putString(LAST_ATTEMPT, now().toString()).apply()
                mutable.value =
                    try {
                        checkForUpdate(current, source)?.let { UpdateState.Available(it) }
                            ?: UpdateState.Current
                    } catch (_: ReleaseChannelUnavailable) {
                        UpdateState.NoChannel
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                        UpdateState.CheckFailed
                    }
            }
    }

    /** Whether the notice may appear for [release]: not skipped, and not put off until tomorrow. */
    fun noticeWanted(release: KinoRelease) =
        settings.getString(SKIPPED, null) != release.version && now() >= time(REMIND_AFTER)

    fun remindTomorrow() {
        settings.edit().putString(REMIND_AFTER, (now() + DAY).toString()).apply()
    }

    fun skip(release: KinoRelease) {
        settings.edit().putString(SKIPPED, release.version).apply()
    }

    fun install(release: KinoRelease) {
        if (work?.isActive == true) return
        work = scope.launch { download(release) }
    }

    /**
     * Android ends Kino's process when the viewer allows it to install apps, so the notice cannot
     * wait on screen for the answer. The release is remembered instead, and the next launch checks
     * at once and offers it again.
     */
    fun awaitPermission(release: KinoRelease) {
        settings.edit().putString(RESUME, release.version).commit()
    }

    /** The release a launch should offer straight away, after the viewer went to allow installs. */
    fun resumed(): String? = settings.getString(RESUME, null)

    fun clearResumed() {
        settings.edit().remove(RESUME).apply()
    }

    private suspend fun download(release: KinoRelease) {
        if (!context.packageManager.canRequestPackageInstalls()) {
            mutable.value = UpdateState.NeedsPermission(release)
            return
        }
        mutable.value = UpdateState.Downloading(release, 0f)
        val apk =
            try {
                val (file, checksum) =
                    downloadUpdate(context, release, source) {
                        mutable.value = UpdateState.Downloading(release, it)
                    }
                withContext(Dispatchers.IO) {
                    try {
                        verifyUpdate(context, file, checksum, installedPackage(context))
                    } catch (refused: UpdateRefused) {
                        file.delete()
                        throw refused
                    }
                }
                file
            } catch (refused: UpdateRefused) {
                mutable.value = UpdateState.Refused(release, refused.reason)
                return
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                mutable.value = UpdateState.DownloadFailed(release)
                return
            }
        installStatus.value = InstallStatus.Waiting
        session = withContext(Dispatchers.IO) { installUpdate(context, apk, installStatus) }
        // A successful install replaces this process, so only a cancelled or failed one returns.
        installStatus
            .onEach { mutable.value = UpdateState.Installing(release, it) }
            .first { it == InstallStatus.Cancelled || it is InstallStatus.Failed }
        apk.delete()
    }

    private companion object {
        const val DAY = 24L * 60 * 60 * 1000
        const val LAST_ATTEMPT = "update_last_attempt"
        const val REMIND_AFTER = "update_remind_after"
        const val SKIPPED = "update_skipped"
        const val RESUME = "update_resume"
    }
}
