// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The frame rate counter (luna-sysmgr WindowServer.cpp:134-218, 844-880,
// 1376-1409; com.palm.systemmanager enableFpsCounter): a 150 x 20 bar at the
// bottom left, "<fps> FPS" on its left and the frames' spread "<ms> ms" on
// its right, black on yellow. Every 100 ms it counts the frames drawn and
// how far their intervals strayed from even (the standard deviation, in
// ms). The original's bar stays yellow: it had red, orange and green for
// under 30, 40 and 50 fps and over, but never switched to them. Its history
// (FpsHistory) can be dumped to the log and resized (dump, reset).

import QtQuick

Item {
    id: counter
    objectName: "fpsCounter"

    property int fps: 0
    property int stdDev: 0
    // [{time, fps, stdDev}], newest last, at most historySize.
    property var history: []
    property int historySize: 1000

    width: Theme.px(150)
    height: Theme.px(20)

    function reset(size) {
        historySize = Math.max(1, size);
        history = [];
    }
    function dump() {
        for (var i = 0; i < history.length; ++i)
            console.info("FPS " + history[i].time + " " + history[i].fps + " " + history[i].stdDev);
    }

    property real _start: Date.now()
    property var _frames: []
    function frame() {
        var now = Date.now();
        if (now - _start > 100) {
            var n = _frames.length;
            if (n > 0) {
                var f = Math.floor(n * 1000 / (now - _start));
                var dev = 0;
                if (f > 0 && n > 1) {
                    var ideal = Math.floor(1000 / f), sum = 0;
                    for (var i = 1; i < n; ++i) {
                        var part = (_frames[i] - _frames[i - 1]) - ideal;
                        sum += part * part;
                    }
                    dev = Math.floor(Math.sqrt(Math.floor(sum / (n - 1))));
                }
                fps = f;
                stdDev = dev;
                var h = history;
                h.push({ time: now, fps: f, stdDev: dev });
                if (h.length > historySize)
                    h.splice(0, h.length - historySize);
                history = h;
            }
            _start = now;
            _frames = [];
        } else {
            _frames.push(now);
        }
    }
    // The frames the window draws (the original counted the scene's paints:
    // with nothing changing, nothing is counted, and the figures stay).
    Connections {
        target: counter.visible ? counter.Window.window : null
        function onFrameSwapped() { counter.frame(); }
    }

    Rectangle {
        anchors.fill: parent
        color: "yellow"
    }
    Text {
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: counter.fps + " FPS"
        color: "black"
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(13)
    }
    Text {
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: counter.stdDev + " ms"
        color: "black"
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(13)
    }
}
