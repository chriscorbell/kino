import QtQuick

Window {
    width: 480
    height: 270
    visible: true
    color: "#09090a"
    title: "Kino playback probe"

    MpvItem {
        objectName: "probePlayer"
        anchors.fill: parent
    }
}
