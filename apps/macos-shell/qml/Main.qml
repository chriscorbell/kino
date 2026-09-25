import QtQuick
import QtQuick.Controls
import QtQuick.Window
import QtWebChannel
import QtWebEngine
import "qrc:/kino/NativeLocale.js" as NativeLocale

ApplicationWindow {
    id: root

    required property var kinoWebProfile
    required property url kinoUiUrl
    readonly property var messages: NativeLocale.messages(Qt.locale().uiLanguages)

    width: 1280
    height: 800
    minimumWidth: 1000
    minimumHeight: 650
    visible: true
    color: "#09090a"
    title: "Kino"
    onClosing: function(close) {
        close.accepted = lifecycle.requestClose()
    }

    CloseCoordinator {
        id: lifecycle
        onCloseApproved: root.close()
    }

    function setFullscreen(enabled) {
        root.visibility = enabled ? Window.FullScreen : Window.Windowed
    }

    // Every page in the main frame receives the WebChannel, secure store
    // included, so only Kino's own interface may load there: files inside the
    // packaged UI directory, or the development server's origin.
    function isInterfaceUrl(url) {
        const target = String(url)
        const home = String(root.kinoUiUrl)
        if (home.startsWith("file:")) {
            return target.startsWith(home.slice(0, home.lastIndexOf("/") + 1))
        }
        const origin = function(value) {
            const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i.exec(value)
            return match ? match[0].toLowerCase() : ""
        }
        return origin(target) !== "" && origin(target) === origin(home)
    }

    // Times of recent interface process losses. Three within a minute stop the
    // automatic reload so a page that crashes on load cannot loop forever.
    property var interfaceLosses: []

    Timer {
        id: interfaceReload
        interval: 500
        onTriggered: webView.reload()
    }

    MpvItem {
        id: player
        anchors.fill: parent
        visible: player.active

        onActiveChanged: nowPlaying.setActive(player.active)
    }

    NowPlaying {
        id: nowPlaying
    }

    StreamEngine {
        id: streamEngine

        onChanged: nativeBridge.streamingEngineChanged(streamEngine.url, streamEngine.error)
    }

    SecureStore {
        id: secureStore
    }

    Diagnostics {
        id: diagnostics
    }

    ExternalNavigation {
        id: externalNavigation
    }

    AddonNetwork {
        id: addonNetwork
    }

    QtObject {
        id: interfaceBridge

        function setScale(percent) {
            if ([100, 125, 150, 175, 200].indexOf(percent) === -1) return false
            webView.zoomFactor = percent / 100
            return true
        }
    }

    QtObject {
        id: nativeBridge

        readonly property string platform: Qt.platform.os === "osx" ? "macos" : Qt.platform.os
        readonly property string shellVersion: Qt.application.version
        readonly property bool fullscreen: root.visibility === Window.FullScreen

        signal playerEvent(string name, var payload)
        signal streamingEngineChanged(string url, string error)

        function openAccountCreation() {
            return Qt.openUrlExternally("https://www.stremio.com/register")
        }

        function startStreamingEngine() {
            if (streamEngine.url) {
                nativeBridge.streamingEngineChanged(streamEngine.url, streamEngine.error)
                return
            }
            streamEngine.start()
        }

        function addSubtitles(url, title, lang) {
            player.addSubtitles(url, title, lang)
        }

        function setMatchFrameRate(enabled) {
            player.matchFrameRate = enabled
        }

        function load(url, forceStereo, headers) {
            player.load(url, forceStereo, headers || {}, "")
        }

        function loadWithAudioLanguage(url, forceStereo, headers, audioLanguage) {
            player.load(url, forceStereo, headers || {}, audioLanguage || "")
        }

        function pauseAndSnapshot() {
            return player.pauseAndSnapshot()
        }

        function seek(seconds) {
            player.seek(seconds)
        }

        function setFullscreen(enabled) {
            root.setFullscreen(enabled)
        }

        function setMuted(muted) {
            player.setMuted(muted)
        }

        function setNowPlayingMetadata(title, subtitle) {
            nowPlaying.setMetadata(title, subtitle)
        }

        function setVolume(percent) {
            player.setVolume(percent)
        }

        function setPaused(paused) {
            player.setPaused(paused)
        }

        function setSubtitleDelay(seconds) {
            player.setSubtitleDelay(seconds)
        }

        function setSubtitlePosition(position) {
            player.setSubtitlePosition(position)
        }

        function setSubtitleScale(scale) {
            player.setSubtitleScale(scale)
        }

        function setSubtitleTrack(id) {
            player.setSubtitleTrack(id)
        }

        function setAudioTrack(id) {
            player.setAudioTrack(id)
        }

        function stop() {
            player.stop()
        }
    }

    Connections {
        target: player

        function onPlayerEvent(name, payload) {
            nativeBridge.playerEvent(name, payload)
            if (name === "time") {
                nowPlaying.setPosition(payload.milliseconds / 1000)
            } else if (name === "duration") {
                nowPlaying.setDuration(payload.milliseconds / 1000)
            } else if (name === "paused") {
                nowPlaying.setPaused(payload.paused)
            }
        }
    }

    Connections {
        target: nowPlaying

        function onPauseRequested() {
            player.setPaused(true)
        }

        function onPlayRequested() {
            player.setPaused(false)
        }

        function onSeekRequested(seconds) {
            player.seek(seconds)
        }

        function onToggleRequested() {
            player.togglePaused()
        }
    }

    WebChannel {
        id: channel

        Component.onCompleted: {
            registerObject("kinoNative", nativeBridge)
            registerObject("kinoInterface", interfaceBridge)
            registerObject("kinoSecureStore", secureStore)
            registerObject("kinoDiagnostics", diagnostics)
            registerObject("kinoLifecycle", lifecycle)
            registerObject("kinoExternalNavigation", externalNavigation)
            registerObject("kinoAddonNetwork", addonNetwork)
        }
    }

    WebEngineView {
        id: webView
        objectName: "webView"

        anchors.fill: parent
        focus: true
        url: root.kinoUiUrl
        backgroundColor: "transparent"
        profile: root.kinoWebProfile
        webChannel: channel

        settings.errorPageEnabled: false
        settings.fullScreenSupportEnabled: true
        settings.localContentCanAccessFileUrls: true
        settings.localContentCanAccessRemoteUrls: true
        settings.playbackRequiresUserGesture: false

        onFullScreenRequested: function(request) {
            root.setFullscreen(request.toggleOn)
            request.accept()
        }

        onRenderProcessTerminated: function(terminationStatus, exitCode) {
            const status = ["normal", "abnormal", "crashed", "killed"][terminationStatus] || "unknown"
            lifecycle.interfaceLost()
            player.stop()
            const now = Date.now()
            root.interfaceLosses = root.interfaceLosses.filter(function(time) {
                return now - time < 60000
            }).concat([now])
            if (root.interfaceLosses.length >= 3) {
                console.error("[kino:shell] interface process ended status=" + status
                              + " reload=abandoned")
                loadFailure.visible = true
                return
            }
            console.warn("[kino:shell] interface process ended status=" + status + " reload=scheduled")
            interfaceReload.start()
        }

        onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceID) {
            diagnostics.logWebMessage(level, message)
        }

        onLoadingChanged: function(request) {
            loadFailure.visible = request.status === WebEngineView.LoadFailedStatus
            if (request.status === WebEngineView.LoadSucceededStatus) {
                console.info("[kino:shell] packaged UI loaded")
            }
        }

        onNavigationRequested: function(request) {
            if (request.isMainFrame && !root.isInterfaceUrl(request.url)) {
                console.warn("[kino:shell] navigation blocked outside the interface")
                request.action = WebEngineNavigationRequest.IgnoreRequest
            }
        }
    }

    Rectangle {
        id: loadFailure

        anchors.fill: parent
        visible: false
        color: "#09090a"

        Column {
            anchors.centerIn: parent
            spacing: 8

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                color: "#f4f4f5"
                font.pixelSize: 18
                font.weight: Font.DemiBold
                text: root.messages.interfaceFailed
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                color: "#8f8f95"
                font.pixelSize: 13
                text: root.messages.checkLog
            }
        }
    }
}
