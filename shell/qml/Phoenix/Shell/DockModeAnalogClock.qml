// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2010-2013 Hewlett-Packard Development Company, L.P. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// The Time exhibition's analog clocks: a port of luna-sysmgr's
// uiComponents/DockModeTime/AnalogClock.qml from QtQuick 1 to Qt 6, on its
// own art (images/dockmode/time/analog/<glass|matte>/).
//
//   - glass (1): base.png with the hour and minute hands, drawn as big as
//     the face and turned about its centre; no second hand; the long date
//     (the locale's) 300 px under the centre.
//   - matte (0): base.png with hour, minute and second hands; the short
//     weekday in the left window and the day of the month in the right one,
//     108 px either side of the centre; the second hand ticks with an
//     OutBack overshoot over 300 ms.
//   - hands turn clockwise to the time (RotationAnimation Clockwise), the
//     clock read every 100 ms while it is showing (timerRunning).
//   - text in Prelude, #e1e1e1, at point size 30 (16 for the glass weekday,
//     which it never shows).
//
// The clock is laid out in the original's pixels (Theme.px) on a canvas
// the dock-mode Time exhibition scales to the screen (DockModeTime.qml).

import QtQuick

Item {
    id: analogclock

    property int glass: 1
    readonly property var type: ["matte", "glass"]
    property bool timerRunning: false
    // The time to show (a fixed time for screenshots), else now.
    property var fixedTime: null

    function pt(size) { return Theme.px(size * 4 / 3) }

    function read() {
        var date = analogclock.fixedTime ? analogclock.fixedTime : new Date();
        hours = date.getHours();
        minutes = date.getMinutes();
        seconds = date.getSeconds();
        // The glass clock's long date; the matte clock's day of the month and
        // short weekday (Runtime::getLocalizedDay, WindowServer.cpp:306-311).
        day = glass ? Qt.formatDate(date, Qt.locale().dateFormat(Locale.LongFormat)) : String(date.getDate());
        weekday = Qt.locale().dayName(date.getDay(), Locale.ShortFormat);
    }

    property int hours: 0
    property int minutes: 0
    property int seconds: 0
    property string day: ""
    property string weekday: ""

    Component.onCompleted: read()
    onFixedTimeChanged: read()
    onGlassChanged: read()

    Timer {
        interval: 100; running: analogclock.timerRunning; repeat: true
        onTriggered: analogclock.read()
    }

    Image {
        id: face
        objectName: "analogFace"
        source: Theme.asset("dockmode/time/analog/" + analogclock.type[analogclock.glass] + "/base.png")
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        anchors.centerIn: parent

        Text {
            id: dayText
            objectName: "analogDate"
            text: analogclock.day
            anchors.centerIn: parent
            anchors.horizontalCenterOffset: analogclock.glass ? 0 : Theme.px(108)
            anchors.verticalCenterOffset: analogclock.glass ? Theme.px(300) : Theme.px(-2)
            font.family: Theme.fontFamily
            font.pixelSize: analogclock.pt(30)
            color: "#e1e1e1"
        }

        Text {
            id: dayofWeekText
            objectName: "analogWeekday"
            text: analogclock.weekday
            visible: !analogclock.glass
            anchors.centerIn: parent
            anchors.horizontalCenterOffset: analogclock.glass ? 0 : Theme.px(-108)
            anchors.verticalCenterOffset: analogclock.glass ? Theme.px(260) : Theme.px(-2)
            font.family: Theme.fontFamily
            font.pixelSize: analogclock.pt(analogclock.glass ? 16 : 30)
            color: "#e1e1e1"
        }

        Image {
            id: hourHand
            objectName: "hourHand"
            source: Theme.asset("dockmode/time/analog/" + analogclock.type[analogclock.glass] + "/hour.png")
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            anchors.centerIn: parent
            smooth: true
            transform: Rotation {
                origin.x: hourHand.width / 2; origin.y: hourHand.height / 2
                angle: (analogclock.hours * 30) + (analogclock.minutes * 0.5)
                Behavior on angle {
                    RotationAnimation { direction: RotationAnimation.Clockwise }
                }
            }
        }

        Image {
            id: minuteHand
            objectName: "minuteHand"
            source: Theme.asset("dockmode/time/analog/" + analogclock.type[analogclock.glass] + "/minute.png")
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            anchors.centerIn: parent
            smooth: true
            transform: Rotation {
                origin.x: minuteHand.width / 2; origin.y: minuteHand.height / 2
                angle: analogclock.minutes * 6
                Behavior on angle {
                    RotationAnimation { direction: RotationAnimation.Clockwise }
                }
            }
        }

        Image {
            id: secondHand
            objectName: "secondHand"
            visible: !analogclock.glass
            source: analogclock.glass ? "" : Theme.asset("dockmode/time/analog/" + analogclock.type[analogclock.glass] + "/second.png")
            width: analogclock.glass ? 0 : Theme.artWidth(source)
            height: analogclock.glass ? 0 : Theme.artHeight(source)
            anchors.centerIn: parent
            smooth: true
            transform: Rotation {
                origin.x: secondHand.width / 2; origin.y: secondHand.height / 2
                angle: analogclock.seconds * 6
                Behavior on angle {
                    RotationAnimation { direction: RotationAnimation.Clockwise; easing.type: Easing.OutBack; duration: 300 }
                }
            }
        }
    }
}
