// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The wave launcher (docs/M6-PLAN.md F4; LunaCE's wave-launcher.json
// "sysUiEnableWaveLauncher", off by default): the Pre's quick launch, back
// as an option. A finger slid up from either side of the gesture area
// raises a glass wave along the bottom of the screen with the dock's apps
// and the launcher button on it; the wave swells under the finger, lifting
// and enlarging the icon there with its name above it; letting go there
// opens that app (the launcher button opens the launcher), letting go off
// the wave puts it away. The Pre's own wave (webOS 1.x's luna-sysmgr) was
// not in the open-source release, so it is drawn here after the community's
// descriptions.
//
// The gesture area drives it: begin(x), track(x, y), finish(x, y) in this
// item's coordinates. items: [{appId, title, icon, largeIcon, color,
// glyph}], the launcher button last ({appId: ""}).

import QtQuick

Item {
    id: wave
    objectName: "waveLauncher"

    property bool open: false
    property var items: []
    // The finger, in this item's coordinates.
    property real fingerX: width / 2
    property real fingerY: height
    // The item under the finger (-1 for none: the finger is off the wave).
    readonly property int selected: open && onWave ? _nearest(fingerX) : -1
    readonly property bool onWave: fingerY >= waveTop - iconSize && fingerY <= height + Theme.px(20)

    signal launchRequested(string appId)
    signal launcherRequested

    // The wave's resting band and how high it swells.
    readonly property int iconSize: Theme.quickLaunchIconSize
    readonly property real baseHeight: iconSize + Theme.px(26)
    readonly property real swell: iconSize * 0.9
    readonly property real spread: Math.max(width / 6, iconSize * 1.6)
    readonly property real waveTop: height - baseHeight - swell
    // Where the wave meets the screen's edge at its bottom.
    readonly property real _shown: open ? 1 : 0

    visible: open || band.opacity > 0

    function begin(x) {
        fingerX = x;
        fingerY = height;
        open = true;
    }
    function track(x, y) {
        fingerX = x;
        fingerY = y;
    }
    // Lets go: the app under the finger, or nothing. Returns whether the
    // finger was on the wave.
    function finish(x, y) {
        track(x, y);
        var i = selected;
        open = false;
        if (i < 0)
            return false;
        var it = items[i];
        if (!it.appId)
            launcherRequested();
        else
            launchRequested(it.appId);
        return true;
    }
    function cancel() { open = false; }

    function _centre(i) {
        var n = Math.max(1, items.length);
        return width * (i + 0.5) / n;
    }
    function _nearest(x) {
        var best = -1, d = 1e9;
        for (var i = 0; i < items.length; ++i) {
            var di = Math.abs(_centre(i) - x);
            if (di < d) { d = di; best = i; }
        }
        return best;
    }
    // How much the wave swells at x (1 under the finger, 0 far from it).
    function lift(x) {
        var t = (x - fingerX) / spread;
        return Math.exp(-t * t);
    }

    // The glass wave: its top edge follows lift(), its body fades down.
    Canvas {
        id: band
        objectName: "waveBand"
        anchors.fill: parent
        opacity: wave.open ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.motion(200) } }
        property real fx: wave.fingerX
        onFxChanged: requestPaint()
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        onPaint: {
            var ctx = getContext("2d");
            ctx.reset();
            var w = width, h = height, step = Math.max(4, Math.round(w / 80));
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (var x = 0; x <= w + step; x += step) {
                var xx = Math.min(x, w);
                ctx.lineTo(xx, h - wave.baseHeight - wave.swell * wave.lift(xx));
            }
            ctx.lineTo(w, h);
            ctx.closePath();
            var g = ctx.createLinearGradient(0, wave.waveTop, 0, h);
            g.addColorStop(0, "rgba(120,150,190,0.55)");
            g.addColorStop(0.35, "rgba(40,52,70,0.82)");
            g.addColorStop(1, "rgba(8,10,14,0.92)");
            ctx.fillStyle = g;
            ctx.fill();
            // The crest's bright edge.
            ctx.beginPath();
            for (x = 0; x <= w + step; x += step) {
                xx = Math.min(x, w);
                var y = h - wave.baseHeight - wave.swell * wave.lift(xx) + 1;
                if (x === 0) ctx.moveTo(xx, y); else ctx.lineTo(xx, y);
            }
            ctx.strokeStyle = "rgba(200,225,255,0.85)";
            ctx.lineWidth = Math.max(1, Theme.px(2));
            ctx.stroke();
        }
    }

    Repeater {
        model: wave.items
        delegate: Item {
            id: slot
            required property var modelData
            required property int index
            readonly property real cx: wave._centre(index)
            readonly property real l: wave.lift(cx)
            readonly property bool chosen: wave.selected === index
            objectName: "waveItem_" + (modelData.appId || "launcher")
            width: wave.iconSize
            height: wave.iconSize
            x: cx - width / 2
            y: wave.height - wave.baseHeight / 2 - height / 2 - wave.swell * l * (wave.open ? 1 : 0)
            scale: 1 + 0.5 * l
            opacity: band.opacity
            z: chosen ? 2 : 1
            Behavior on y { NumberAnimation { duration: Theme.motion(120); easing.type: Easing.OutQuad } }

            AppIcon {
                visible: !!slot.modelData.appId
                anchors.fill: parent
                size: wave.iconSize
                showLabel: false
                interactive: false
                title: slot.modelData.title || ""
                color: slot.modelData.color || "#666666"
                glyph: slot.modelData.glyph || ""
                source: slot.modelData.icon || ""
                largeSource: slot.modelData.largeIcon || ""
            }
            // The launcher button (its normal state, the sprite's top half).
            Item {
                visible: !slot.modelData.appId
                anchors.fill: parent
                clip: true
                Image {
                    width: parent.width
                    height: parent.height * 2
                    y: slot.chosen ? -parent.height : 0
                    source: Theme.asset("launcher3/quicklaunch-button-launcher.png")
                    smooth: true
                }
            }
        }
    }

    // The chosen app's name, just above its lifted icon, on a dark pill so
    // that it reads over any app.
    Rectangle {
        id: titlePill
        readonly property var it: wave.selected >= 0 ? wave.items[wave.selected] : null
        visible: it !== null && band.opacity > 0.5
        width: titleText.implicitWidth + Theme.px(16)
        height: titleText.implicitHeight + Theme.px(6)
        radius: height / 2
        color: "#C0000000"
        x: Math.max(Theme.px(4), Math.min(wave.width - width - Theme.px(4), (it ? wave._centre(wave.selected) : 0) - width / 2))
        // The lifted icon's top: its centre less half its enlarged size.
        y: wave.height - wave.baseHeight / 2 - wave.swell - wave.iconSize * 0.75 - height - Theme.px(6)
        Text {
            id: titleText
            objectName: "waveTitle"
            anchors.centerIn: parent
            text: titlePill.it ? (titlePill.it.appId ? titlePill.it.title : qsTr("Launcher")) : ""
            color: "#FFFFFF"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(15)
            font.bold: true
        }
    }
}
