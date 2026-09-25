package app.kino.tv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.RememberObserver
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import io.nayuki.qrcodegen.QrCode
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import kotlin.concurrent.thread

private const val TAG = "KinoHandoff"
// A configured manifest address carries its settings, often a few hundred characters of base64.
private const val MAX_BODY = 16 * 1024
private const val MAX_LINE = 8 * 1024

/**
 * The TV's own address on the home network: a private IPv4 address on a running Ethernet or Wi-Fi
 * interface. A TV with only a public or no address offers no phone handoff, so the page is never
 * reachable from outside the home network.
 */
internal fun homeNetworkAddress(): Inet4Address? =
    runCatching {
            NetworkInterface.getNetworkInterfaces()
                .toList()
                .filter { it.isUp && !it.isLoopback && !it.isVirtual && !it.isPointToPoint }
                // Ethernet first: a Shield on a cable usually also keeps Wi-Fi configured.
                .sortedBy { if (it.name.startsWith("eth")) 0 else 1 }
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { it.isSiteLocalAddress }
        }
        .getOrNull()

/**
 * A page the TV serves on the home network while an add-on dialog is open, so a phone can send an
 * add-on address rather than the viewer typing it with the remote. The address in the QR code
 * carries a random token, the page takes only an address that [addonManifestUrl] accepts, and
 * Kino still shows what it found and asks for confirmation on the TV. Closing the dialog closes
 * the server. ADR 0025 records why.
 */
internal class AddonHandoff(
    private val page: HandoffPage,
    address: InetAddress,
    private val onAddress: (String) -> Unit,
) : AutoCloseable, RememberObserver {
    private val token =
        ByteArray(16)
            .also(SecureRandom()::nextBytes)
            .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP) }
    private val server = ServerSocket(0, 4, address)
    private val main = Handler(Looper.getMainLooper())

    val url = "http://${address.hostAddress}:${server.localPort}/$token"

    private val worker =
        thread(name = "kino-addon-handoff", isDaemon = true) {
            Log.i(TAG, "addon_handoff_started")
            while (!server.isClosed) {
                val socket =
                    try {
                        server.accept()
                    } catch (_: SocketException) {
                        break
                    }
                // One request at a time is plenty for one phone, and a slow client cannot hold
                // the page for longer than the timeout.
                socket.use { runCatching { serve(it) } }
            }
            Log.i(TAG, "addon_handoff_stopped")
        }

    private fun serve(socket: Socket) {
        socket.soTimeout = 5_000
        val input = BufferedInputStream(socket.getInputStream())
        val request = readLine(input)?.split(' ') ?: return
        if (request.size != 3) return respond(socket, 400, "Bad request")
        val (method, target) = request
        var length = 0
        var type = ""
        var headers = 0
        while (true) {
            val line = readLine(input) ?: return
            if (line.isEmpty()) break
            headers += line.length
            if (headers > MAX_BODY) return respond(socket, 431, "Request headers too large")
            val name = line.substringBefore(':').trim().lowercase()
            val value = line.substringAfter(':', "").trim()
            if (name == "content-length") length = value.toIntOrNull() ?: -1
            if (name == "content-type") type = value.substringBefore(';').trim().lowercase()
        }
        if (!sameToken(target.removePrefix("/"))) return respond(socket, 404, "Not found")
        when (method) {
            "GET" -> respondPage(socket, page.form())
            "POST" -> {
                if (length !in 1..MAX_BODY) return respond(socket, 413, "Request too large")
                if (type != "application/x-www-form-urlencoded")
                    return respond(socket, 415, "Unsupported form")
                val body = ByteArray(length)
                var read = 0
                while (read < length) {
                    val count = input.read(body, read, length - read)
                    if (count < 0) return
                    read += count
                }
                val sent =
                    String(body, Charsets.UTF_8)
                        .split('&')
                        .map { it.split('=', limit = 2) }
                        .firstOrNull { it.size == 2 && it[0] == "address" }
                        ?.let { runCatching { URLDecoder.decode(it[1], "UTF-8") }.getOrNull() }
                        .orEmpty()
                val manifest = addonManifestUrl(sent)
                if (manifest == null) {
                    Log.i(TAG, "addon_handoff_refused")
                    respondPage(socket, page.form(sent, invalid = true))
                } else {
                    Log.i(TAG, "addon_handoff_received")
                    main.post { onAddress(manifest) }
                    respondPage(socket, page.sent())
                }
            }
            else -> respond(socket, 405, "Method not allowed")
        }
    }

    private fun sameToken(candidate: String) =
        MessageDigest.isEqual(candidate.toByteArray(), token.toByteArray())

    private fun readLine(input: InputStream): String? {
        val line = ByteArrayOutputStream()
        while (true) {
            val byte = input.read()
            if (byte < 0) return null
            if (byte == '\n'.code) break
            if (byte != '\r'.code) line.write(byte)
            if (line.size() > MAX_LINE) return null
        }
        return line.toString(Charsets.UTF_8.name())
    }

    private fun respondPage(socket: Socket, html: String) = respond(socket, 200, html, "text/html")

    private fun respond(socket: Socket, status: Int, body: String, type: String = "text/plain") {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val reason =
            mapOf(
                200 to "OK",
                400 to "Bad Request",
                404 to "Not Found",
                405 to "Method Not Allowed",
                413 to "Payload Too Large",
                415 to "Unsupported Media Type",
                431 to "Request Header Fields Too Large",
            )[status]
        val head =
            "HTTP/1.1 $status $reason\r\n" +
                "Content-Type: $type; charset=utf-8\r\n" +
                "Content-Length: ${bytes.size}\r\n" +
                // The token is in the page's address, so it must not leave in a Referer header
                // when the viewer follows the link to the add-on's settings.
                "Referrer-Policy: no-referrer\r\n" +
                "Cache-Control: no-store\r\n" +
                "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; " +
                "form-action 'self'; frame-ancestors 'none'\r\n" +
                "X-Content-Type-Options: nosniff\r\n" +
                "Connection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(head.toByteArray(Charsets.US_ASCII))
            write(bytes)
            flush()
        }
    }

    override fun close() {
        runCatching { server.close() }
        main.removeCallbacksAndMessages(null)
    }

    override fun onRemembered() {}

    override fun onForgotten() = close()

    override fun onAbandoned() = close()
}

/**
 * The phone page's text, read from the TV's resources so it follows the TV's language, and its
 * colors, taken from the same design tokens as the TV app.
 */
internal class HandoffPage(
    private val context: Context,
    private val title: String,
    private val configureUrl: String?,
) {
    private fun text(id: Int, vararg args: Any) = html(context.getString(id, *args))

    private fun hex(color: Color) = "#%06x".format(color.toArgb() and 0xFFFFFF)

    private fun document(body: String) =
        """<!doctype html><html lang="en"><head><meta charset="utf-8">""" +
            """<meta name="viewport" content="width=device-width, initial-scale=1">""" +
            """<meta name="color-scheme" content="dark"><title>${html(title)}</title><style>""" +
            ":root{color-scheme:dark}*{box-sizing:border-box}" +
            "body{margin:0;background:${hex(KinoColors.Bg)};color:${hex(KinoColors.Text)};" +
            "font:17px/1.5 system-ui,-apple-system,Roboto,sans-serif;-webkit-text-size-adjust:100%}" +
            "main{max-width:30rem;margin:0 auto;padding:40px 20px 56px}" +
            ".brand{margin:0 0 28px;color:${hex(KinoColors.TextMuted)};font-size:14px;" +
            "letter-spacing:.08em;text-transform:uppercase}" +
            "h1{margin:0 0 12px;font-size:26px;line-height:1.25;letter-spacing:-.01em}" +
            "p{margin:0 0 16px;color:${hex(KinoColors.TextMuted)}}" +
            "ol{margin:24px 0 0;padding:0;list-style:none;counter-reset:step}" +
            "li{counter-increment:step;margin:0 0 28px;padding-left:40px;position:relative}" +
            "li:before{content:counter(step);position:absolute;left:0;top:0;width:26px;height:26px;" +
            "border:1px solid ${hex(KinoColors.Border)};border-radius:999px;text-align:center;" +
            "font-size:14px;line-height:24px;color:${hex(KinoColors.TextMuted)}}" +
            "li p{color:${hex(KinoColors.Text)}}" +
            "a.button,button{display:block;width:100%;min-height:48px;padding:12px 16px;" +
            "border-radius:8px;font-family:inherit;font-size:16px;font-weight:600;line-height:1.5;" +
            "text-align:center;text-decoration:none;" +
            "cursor:pointer;transition:opacity 150ms cubic-bezier(.16,1,.3,1)}" +
            "a.button{border:1px solid ${hex(KinoColors.Border)};color:${hex(KinoColors.Text)}}" +
            "button{border:0;background:${hex(KinoColors.Accent)};color:${hex(KinoColors.OnAccent)};" +
            "margin-top:12px}button:active,a.button:active{opacity:.8}" +
            "textarea{display:block;width:100%;min-height:112px;padding:12px 14px;resize:vertical;" +
            "border:1px solid ${hex(KinoColors.Border)};border-radius:8px;" +
            "background:${hex(KinoColors.Surface)};color:${hex(KinoColors.Text)};" +
            "font:15px/1.45 ui-monospace,Menlo,monospace;word-break:break-all}" +
            "textarea:focus{outline:2px solid ${hex(KinoColors.TextStrong)};outline-offset:1px}" +
            ".error{color:${hex(KinoColors.Danger)};margin:10px 0 0}" +
            "</style></head><body><main><p class=\"brand\">Kino</p>$body</main></body></html>"

    fun form(value: String = "", invalid: Boolean = false): String {
        val field =
            """<form method="post"><textarea name="address" required autocapitalize="off" """ +
                """autocorrect="off" spellcheck="false" aria-label="${text(R.string.handoff_address_label)}" """ +
                """placeholder="https://…/manifest.json">${html(value)}</textarea>""" +
                (if (invalid) """<p class="error" role="alert">${text(R.string.addon_invalid)}</p>""" else "") +
                """<button type="submit">${text(R.string.handoff_send)}</button></form>"""
        val steps =
            if (configureUrl == null)
                "<p>${text(R.string.handoff_paste)}</p>$field"
            else
                "<ol><li><p>${text(R.string.handoff_configure_step)}</p>" +
                    """<a class="button" href="${html(configureUrl)}" target="_blank" """ +
                    """rel="noreferrer noopener">${text(R.string.handoff_open_settings)}</a></li>""" +
                    "<li><p>${text(R.string.handoff_paste_configured)}</p>$field</li></ol>"
        return document("<h1>${html(title)}</h1>$steps")
    }

    fun sent() =
        document(
            "<h1>${text(R.string.handoff_sent_title)}</h1><p>${text(R.string.handoff_sent_body)}</p>"
        )

    private fun html(value: String) =
        value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#39;")
}

/**
 * Serves the phone page for as long as the calling dialog is composed. Null when the TV has no
 * home network address, in which case the dialog offers typing alone.
 */
@Composable
internal fun rememberAddonHandoff(
    title: String,
    configureUrl: String?,
    onAddress: (String) -> Unit,
): AddonHandoff? {
    val context = LocalContext.current
    val deliver by rememberUpdatedState(onAddress)
    // Started during composition, so the dialog knows on its first frame whether to offer the
    // phone; Compose closes it when the dialog leaves, or if that first frame is abandoned.
    return remember(title, configureUrl) {
        homeNetworkAddress()?.let { address ->
            runCatching {
                    AddonHandoff(HandoffPage(context, title, configureUrl), address) { deliver(it) }
                }
                .onFailure { Log.w(TAG, "addon_handoff_unavailable") }
                .getOrNull()
        }
    }
}

/** A QR code drawn module by module, dark on white with the standard four-module quiet zone. */
@Composable
internal fun QrCodeImage(text: String, size: Dp, description: String, modifier: Modifier = Modifier) {
    val code = remember(text) { QrCode.encodeText(text, QrCode.Ecc.MEDIUM) }
    Canvas(
        modifier
            .size(size)
            .background(Color.White, RoundedCornerShape(8.dp))
            .semantics { contentDescription = description }
    ) {
        val modules = code.size + 8
        val cell = this.size.minDimension / modules
        for (y in 0 until code.size) for (x in 0 until code.size) {
            if (code.getModule(x, y))
                drawRect(
                    Color.Black,
                    Offset((x + 4) * cell, (y + 4) * cell),
                    // A hair of overlap keeps anti-aliasing from drawing seams between modules.
                    Size(cell + 0.5f, cell + 0.5f),
                )
        }
    }
}

/** The QR code and the page address beneath it, for a viewer without a camera app handy. */
@Composable
internal fun PhoneHandoff(handoff: AddonHandoff, modifier: Modifier = Modifier) {
    Column(modifier.width(220.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        QrCodeImage(handoff.url, 220.dp, stringResource(R.string.handoff_qr))
        Text(handoff.url, fontSize = 13.sp, color = Muted, modifier = Modifier.padding(horizontal = 2.dp))
    }
}
