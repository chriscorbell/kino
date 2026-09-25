import QtQuick

Window {
    width: 480
    height: 270
    visible: true
    color: "#09090a"
    title: "Kino playback probe"

    // Mirrors Main.qml: the player item stays hidden until playback starts, so
    // the probe loads under the same render-context timing as the app.
    MpvItem {
        id: player
        objectName: "probePlayer"
        anchors.fill: parent
        visible: player.active
    }
}
