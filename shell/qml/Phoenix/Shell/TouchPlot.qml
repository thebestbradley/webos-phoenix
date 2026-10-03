// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The touch plot (luna-sysmgr Src/base/visual/TouchPlot.cpp;
// com.palm.systemmanager enableTouchPlot; WindowServer.cpp:793-797,
// 1411-1431): over everything, each finger's path since it went down.
//   trails      every point it reported, a 5 px square green where it
//               went down, blue where it moved, yellow where it stayed,
//               red where it came up, joined by white lines
//   crosshairs  white lines across the screen through each finger still down
//   collection  keep the points without drawing them
// Up to 10 fingers (m_max_touches). When the first finger of a new touch
// goes down, the old paths go (updateTouches, :49-87). It only watches:
// the touches go on to what is under them.

import QtQuick

Item {
    id: plot
    objectName: "touchPlot"

    property bool collection: false
    property bool trails: false
    property bool crosshairs: false
    readonly property bool active: collection || trails || crosshairs
    readonly property int maxTouches: 10
    readonly property int plotRectSize: 5
    // Per finger: [{x, y, state: "pressed" | "moved" | "stationary" | "released"}].
    property var history: []
    property int touchesDown: 0

    function enable(options) {
        if (options.collection !== undefined) collection = !!options.collection;
        if (options.trails !== undefined) trails = !!options.trails;
        if (options.crosshairs !== undefined) crosshairs = !!options.crosshairs;
        if (!active) {
            history = [];
            touchesDown = 0;
            canvas.requestPaint();
        }
    }

    // One finger's point (TouchPlot::updateTouches).
    function update(id, x, y, state) {
        var h = history;
        if (state === "pressed") {
            if (touchesDown === 0)
                h = [];
            else if (id < maxTouches)
                h[id] = [];
            if (touchesDown <= maxTouches)
                touchesDown++;
        } else if (state === "released" && touchesDown > 0) {
            touchesDown--;
        }
        if (id < maxTouches) {
            if (!h[id])
                h[id] = [];
            h[id].push({ x: x, y: y, state: state });
        }
        history = h;
        if (trails || crosshairs)
            canvas.requestPaint();
    }

    function _colour(state) {
        return state === "pressed" ? "#00ff00" : state === "moved" ? "#0000ff"
             : state === "stationary" ? "#ffff00" : state === "released" ? "#ff0000" : "#000000";
    }

    visible: active

    Canvas {
        id: canvas
        anchors.fill: parent
        onPaint: {
            var ctx = getContext("2d");
            ctx.clearRect(0, 0, width, height);
            ctx.strokeStyle = "white";
            ctx.lineWidth = 1;
            var r = plot.plotRectSize;
            for (var i = 0; i < plot.history.length; ++i) {
                var pts = plot.history[i];
                if (!pts || pts.length === 0)
                    continue;
                if (plot.trails) {
                    var prev = pts[0];
                    for (var j = 0; j < pts.length; ++j) {
                        var p = pts[j];
                        if (j > 0) {
                            ctx.beginPath();
                            ctx.moveTo(prev.x, prev.y);
                            ctx.lineTo(p.x, p.y);
                            ctx.stroke();
                        }
                        ctx.fillStyle = plot._colour(p.state);
                        ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
                        ctx.strokeRect(p.x - r / 2, p.y - r / 2, r, r);
                        prev = p;
                    }
                }
                var last = pts[pts.length - 1];
                if (plot.crosshairs && last.state !== "released") {
                    ctx.beginPath();
                    ctx.moveTo(0, last.y);
                    ctx.lineTo(width, last.y);
                    ctx.moveTo(last.x, 0);
                    ctx.lineTo(last.x, height);
                    ctx.stroke();
                }
            }
        }
    }

    // Ten passive watchers, one per finger: they take no grab, so the
    // touches reach what is under them.
    Repeater {
        model: plot.maxTouches
        Item {
            required property int index
            anchors.fill: parent
            PointHandler {
                id: finger
                enabled: plot.active
                acceptedDevices: PointerDevice.AllDevices
                grabPermissions: PointerHandler.ApprovesTakeOverByAnything
                property bool down: false
                onActiveChanged: {
                    if (active) {
                        down = true;
                        plot.update(index, point.position.x, point.position.y, "pressed");
                    } else if (down) {
                        down = false;
                        plot.update(index, point.position.x, point.position.y, "released");
                    }
                }
                // Each new position while down (TouchPointMoved).
                onPointChanged: {
                    if (!active || !down)
                        return;
                    var h = plot.history[index];
                    var last = h && h.length ? h[h.length - 1] : null;
                    if (last && (last.x !== point.position.x || last.y !== point.position.y))
                        plot.update(index, point.position.x, point.position.y, "moved");
                }
            }
        }
    }
}
