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

    function setFullscreen(enabled) {
        root.visibility = enabled ? Window.FullScreen : Window.Windowed
    }

    MpvItem {
        id: player
        anchors.fill: parent
        visible: player.active
    }

    SecureStore {
        id: secureStore
    }

    QtObject {
        id: nativeBridge

        readonly property string platform: "macos"
        readonly property string shellVersion: Qt.application.version

        signal playerEvent(string name, var payload)

        function load(url, forceStereo) {
            player.load(url, forceStereo)
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

        function setPaused(paused) {
            player.setPaused(paused)
        }

        function stop() {
            player.stop()
        }
    }

    Connections {
        target: player

        function onPlayerEvent(name, payload) {
            nativeBridge.playerEvent(name, payload)
        }
    }

    WebChannel {
        id: channel

        Component.onCompleted: {
            registerObject("kinoNative", nativeBridge)
            registerObject("kinoSecureStore", secureStore)
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
