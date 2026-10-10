import QtQuick
import QtWebEngine
import Qt5Compat.GraphicalEffects

Item {
    // The simulator's context property, in the device shell.
    property bool firstUse: simSettings.value("firstUse")
    property url feed: "phoenix://usr/palm/sounds/alert.wav"
}
