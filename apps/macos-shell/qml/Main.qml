import QtQuick
import QtQuick.Controls
import QtQuick.Window
import QtWebChannel
import QtWebEngine

ApplicationWindow {
    id: root

    required property var kinoWebProfile
    required property url kinoUiUrl

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

        readonly property string platform: "macos"
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

        function load(url, forceStereo, headers) {
            player.load(url, forceStereo, headers || {})
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
        }
    }

    WebEngineView {
        id: webView

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
            if (request.isMainFrame
                    && String(request.url).split(":")[0] !== String(root.kinoUiUrl).split(":")[0]) {
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
                text: "Kino could not load its interface."
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                color: "#8f8f95"
                font.pixelSize: 13
                text: "Check the local Kino log for details."
            }
        }
    }
}
