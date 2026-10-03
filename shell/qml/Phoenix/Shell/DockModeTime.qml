// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2010-2013 Hewlett-Packard Development Company, L.P. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// The built-in Time exhibition (com.palm.app.dockmodetime, "Time"): a port of
// luna-sysmgr's uiComponents/DockModeTime/Clocks.qml from QtQuick 1 to Qt 6,
// which DockModeClock (Src/lunaui/dock/DockModeClock.cpp) showed as dock
// mode's first, permanent exhibition.
//
//   - clock_bg.png behind three clocks that swipe sideways one at a time
//     (a ListView, StrictlyEnforceRange, SnapOneItem, DragOverBounds):
//     analog glass, the flip clock, analog matte.
//   - a dot per clock (indicator/on.png for the one showing, off.png the
//     others), 10 px apart, 340 px under the middle sideways and 400
//     upright.
//   - the clocks run only while the exhibition is in front
//     (mainTimerRunning: DockModeClockWindow::focusEvent).
//
// The original was a 1024x768 canvas, the TouchPad's screen. Here each clock
// is laid out in its pixels (Theme.px) and scaled down to fit a smaller
// screen (a phone): no more than the density, and so that the clock's
// parts (the glass face and its date, the flip clock's rows, the dots) fit
// the screen less the status bar. The TouchPad gets the original's size.
// The dots keep their size (scaled with a phone's clocks they would be
// specks); their place follows the clocks. clock_bg.png is stretched to
// cover the screen however it is held, over black (the original's canvas
// was a white Rectangle wherever the 1024x768 art did not reach).
// Dock mode's own wallpaper (the dockwallpaper preference), when one is
// set, shows instead of clock_bg.png.

import QtQuick
import QtQml.Models

Item {
    id: clocks

    property bool mainTimerRunning: false
    property bool twelveHourClock: true
    property var fixedTime: null
    // Dock mode's wallpaper is behind: no clock_bg.png.
    property bool wallpaperBehind: false
    // Sideways (the original's runtime.orientation; here wider than tall).
    readonly property int isLandscape: width > height ? 1 : 0
    readonly property alias currentIndex: flickable.currentIndex
    readonly property alias count: flickable.count
    function showClock(index) { flickable.currentIndex = index; flickable.positionViewAtIndex(index, ListView.Beginning); }

    // How much of the original's pixels fit: the parts of a clock span
    // 850 x 700 sideways (the flip clock is 792 wide, the dots 344 under the
    // middle) and 720 x 820 upright (the dots 404 under it).
    readonly property real fit: Math.min(1, width / Theme.px(isLandscape ? 850 : 720), height / Theme.px(isLandscape ? 700 : 820))

    Rectangle {
        anchors.fill: parent
        color: "black"
    }
    Image {
        id: bg
        objectName: "clockBackground"
        visible: !clocks.wallpaperBehind
        anchors.fill: parent
        source: Theme.asset("dockmode/time/clock_bg.png")
        // The art is 1024 x 768: cover the screen whichever way it is held.
        fillMode: Image.PreserveAspectCrop
    }

    ObjectModel {
        id: clockList
        Item {
            width: flickable.width; height: flickable.height
            DockModeAnalogClock {
                objectName: "glassClock"
                anchors.centerIn: parent
                width: parent.width / clocks.fit; height: parent.height / clocks.fit
                scale: clocks.fit
                glass: 1
                timerRunning: clocks.mainTimerRunning
                fixedTime: clocks.fixedTime
            }
        }
        Item {
            width: flickable.width; height: flickable.height
            DockModeDigitalClock {
                objectName: "flipClock"
                anchors.centerIn: parent
                width: parent.width / clocks.fit; height: parent.height / clocks.fit
                scale: clocks.fit
                landscape: clocks.isLandscape === 1
                twelveHourClock: clocks.twelveHourClock
                timerRunning: clocks.mainTimerRunning
                fixedTime: clocks.fixedTime
            }
        }
        Item {
            width: flickable.width; height: flickable.height
            DockModeAnalogClock {
                objectName: "matteClock"
                anchors.centerIn: parent
                width: parent.width / clocks.fit; height: parent.height / clocks.fit
                scale: clocks.fit
                glass: 0
                timerRunning: clocks.mainTimerRunning
                fixedTime: clocks.fixedTime
            }
        }
    }

    ListView {
        id: flickable
        objectName: "clockPages"
        anchors.fill: parent
        clip: true
        focus: true
        highlightRangeMode: ListView.StrictlyEnforceRange
        orientation: ListView.Horizontal
        snapMode: ListView.SnapOneItem
        model: clockList
        boundsBehavior: Flickable.DragOverBounds
        // Stay on the clock showing when the screen turns.
        onWidthChanged: positionViewAtIndex(currentIndex, ListView.Beginning)
    }

    Row {
        objectName: "clockDots"
        spacing: Theme.px(10)
        anchors.centerIn: parent
        anchors.verticalCenterOffset: Theme.px(clocks.isLandscape ? 340 : 400) * clocks.fit
        Repeater {
            model: 3
            Image {
                required property int index
                source: Theme.asset("dockmode/time/indicator/" + (flickable.currentIndex === index ? "on" : "off") + ".png")
                width: Theme.artWidth(source)
                height: Theme.artHeight(source)
            }
        }
    }
}
