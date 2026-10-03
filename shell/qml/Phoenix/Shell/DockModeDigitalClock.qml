// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2010-2013 Hewlett-Packard Development Company, L.P. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// The Time exhibition's flip clock: a port of luna-sysmgr's
// uiComponents/DockModeTime/DigitalClock.qml from QtQuick 1 to Qt 6, on its
// own art (images/dockmode/time/digital/<portrait|landscape>/).
//
//   - the time on four flippers (flippers-time.png), hours and minutes,
//     4 px apart in pairs, the dots 22 px either side between them, centred
//     48 px above the middle; the hour has its leading zero ("09"); 12-hour
//     clocks show AM or PM in the first flipper's corner.
//   - the date on eleven small flippers (flippers-date.png) 2 px apart,
//     136 px under the middle: the month's first three letters (upper
//     case, Runtime::getLocalizedMonth), a blank, the day, a blank, the year.
//   - Prelude digits, #e1e1e1, 4 px above each flipper's centre, at point
//     size 158 sideways and 132 upright (the date 52 and 44); the flippers'
//     masks (-mask.png) over them draw the fold.
//   - the art for the way the screen is held: landscape when it is wider.
//
// Laid out in the original's pixels (Theme.px) on the canvas DockModeTime
// scales to the screen.

import QtQuick

Item {
    id: digitalclock

    // constants
    readonly property int timeOffset: -4
    readonly property int dateOffset: -4
    readonly property int timeLandSize: 158
    readonly property int timePortSize: 132
    readonly property int dateLandSize: 52
    readonly property int datePortSize: 44
    property bool timerRunning: false
    property bool twelveHourClock: true
    // Laid out for a screen wider than tall.
    property bool landscape: true
    property var fixedTime: null

    readonly property string orientation: landscape ? "landscape" : "portrait"
    function art(name) { return Theme.asset("dockmode/time/digital/" + orientation + "/" + name + ".png") }
    function pt(size) { return Theme.px(size * 4 / 3) }

    function read() {
        var d = digitalclock.fixedTime ? digitalclock.fixedTime : new Date();
        var h = d.getHours();
        hours = twelveHourClock ? (h > 12 ? h - 12 : h === 0 ? 12 : h) : h;
        minutes = d.getMinutes();
        date = d.getDate();
        year = d.getFullYear();
        month = Qt.locale().monthName(d.getMonth(), Locale.ShortFormat).toUpperCase();
        ampm = h < 12 ? Qt.locale().amText : Qt.locale().pmText;
    }

    property int hours: 0
    property int minutes: 0
    property int date: 1
    property int year: 2000
    property string month: ""
    property string ampm: ""

    Component.onCompleted: read()
    onFixedTimeChanged: read()
    onTwelveHourClockChanged: read()

    Timer {
        interval: 100; running: digitalclock.timerRunning; repeat: true
        onTriggered: digitalclock.read()
    }

    // A flipper with its digit (Text parented to the flipper, as the original).
    component Flipper: Image {
        id: flipper
        property string text
        property bool big: true
        source: digitalclock.art(big ? "flippers-time" : "flippers-date")
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        Text {
            text: flipper.text
            anchors.centerIn: parent
            anchors.verticalCenterOffset: Theme.px(flipper.big ? digitalclock.timeOffset : digitalclock.dateOffset)
            font.family: Theme.fontFamily
            font.pixelSize: digitalclock.pt(flipper.big ? (digitalclock.landscape ? digitalclock.timeLandSize : digitalclock.timePortSize)
                                                         : (digitalclock.landscape ? digitalclock.dateLandSize : digitalclock.datePortSize))
            color: "#e1e1e1"
        }
    }
    component Mask: Image {
        property bool big: true
        source: digitalclock.art(big ? "flippers-time-mask" : "flippers-date-mask")
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
    }
    component Gap: Item { property int size; width: Theme.px(size); height: Theme.px(50) }

    Row {
        objectName: "timeRow"
        spacing: 0
        anchors.centerIn: parent
        anchors.verticalCenterOffset: Theme.px(-48)
        Flipper {
            id: bgHour1
            objectName: "hourTens"
            text: Math.floor(digitalclock.hours / 10)
            Text {
                objectName: "ampm"
                text: digitalclock.twelveHourClock ? digitalclock.ampm : ""
                anchors.centerIn: parent
                anchors.verticalCenterOffset: Theme.px(digitalclock.landscape ? -95 : -80)
                anchors.horizontalCenterOffset: Theme.px(digitalclock.landscape ? -42 : -38)
                font.family: Theme.fontFamily
                font.pixelSize: digitalclock.pt(digitalclock.landscape ? 20 : 15)
                color: "#e1e1e1"
            }
        }
        Gap { size: 4 }
        Flipper { objectName: "hourOnes"; text: digitalclock.hours % 10 }
        Gap { size: 22 }
        Image {
            source: digitalclock.art("dots")
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
        }
        Gap { size: 22 }
        Flipper { objectName: "minuteTens"; text: Math.floor(digitalclock.minutes / 10) }
        Gap { size: 4 }
        Flipper { objectName: "minuteOnes"; text: digitalclock.minutes % 10 }
    }

    Row {
        objectName: "dateRow"
        spacing: Theme.px(2)
        anchors.centerIn: parent
        anchors.verticalCenterOffset: Theme.px(136)
        Flipper { big: false; text: digitalclock.month.substring(0, 1) }
        Flipper { big: false; text: digitalclock.month.substring(1, 2) }
        Flipper { big: false; text: digitalclock.month.substring(2, 3) }
        Flipper { big: false; text: "" }
        Flipper { big: false; text: Math.floor(digitalclock.date / 10) }
        Flipper { big: false; text: digitalclock.date % 10 }
        Flipper { big: false; text: "" }
        Flipper { big: false; text: Math.floor(digitalclock.year / 1000) }
        Flipper { big: false; text: Math.floor(digitalclock.year / 100) % 10 }
        Flipper { big: false; text: Math.floor(digitalclock.year / 10) % 10 }
        Flipper { big: false; text: digitalclock.year % 10 }
    }

    // The masks over the digits: the flippers' fold.
    Row {
        spacing: 0
        anchors.centerIn: parent
        anchors.verticalCenterOffset: Theme.px(-48)
        Mask {}
        Gap { size: 4 }
        Mask {}
        Gap { size: 72 }
        Mask {}
        Gap { size: 4 }
        Mask {}
    }

    Row {
        spacing: Theme.px(2)
        anchors.centerIn: parent
        anchors.verticalCenterOffset: Theme.px(136)
        Repeater {
            model: 11
            Mask { big: false }
        }
    }
}
