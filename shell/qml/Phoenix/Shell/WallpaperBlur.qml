// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The wallpaper blurred once, for Ember Glass's L1, the glass of a card
// (Phoenix 2.0; docs/SYSTEM-UI-2.md, "The shell contract"; Ember Glass UI's
// docs/SHELL-CONTRACT.md, "What the shell gives"): the wallpaper as the
// screen shows it (the Wallpaper item, cover and centred), inside 60 px of
// #140604 (the mock-up's padding, base.css .card::before, so the blur darkens
// towards the screen's edges instead of clamping), blurred with a Gaussian
// of 40 px deviation (glass.l1.blur), with no tone map, at a quarter of the
// screen's CSS pixels ("a quarter of the screen's resolution is enough").
// Made again only when the wallpaper or the screen's size changes, a moment
// after (the adaptive simulator resizes in a stream of sizes).
//
// The blur is CSS's: three box blurs each way, of the sizes the Filter
// Effects spec gives for the deviation (feGaussianBlur; Skia, Chromium's
// renderer, does the same), in script on a thread of its own
// (WallpaperBlurWorker.js), on the pixels Canvas reads: no shader to
// compile, the same on a device without a GPU, and the screen never waits
// for it.
//
// It gives:
//   url       the picture as a PNG (a data: URL): the address every web app
//             gets (CardView.glassWallpaper, Card's window.glass). A data:
//             URL because QML alone cannot make the folder a file would go
//             in (docs/SYSTEM-UI-2.md: a later, native step writes a file)
//   tonedUrl  the same under the shell's own theme's tone map
//             (Theme.eg.glassL1Saturate, Contrast, Brightness: CSS's
//             saturate(), contrast() and brightness(), in that order), for
//             the glass the shell draws itself (the loading card)
// both "" until made, and when the look is not Ember Glass (active).

import QtQuick

Item {
    id: blur

    // The item showing the wallpaper, as large as the screen it covers.
    property Item wallpaper: null
    // The wallpaper's picture changed or finished loading: make it again.
    property var sourceKey: null
    property bool active: Theme.emberGlass
    // CSS pixels per scene pixel's inverse: the scene's pixels per CSS px.
    property real scale: Theme.u
    // The tone map for tonedUrl: {saturate, contrast, brightness}.
    property var toneMap: ({ saturate: Theme.eg.glassL1Saturate, contrast: Theme.eg.glassL1Contrast, brightness: Theme.eg.glassL1Brightness })

    // In CSS px (EmberGlass), the picture's own pixels a quarter of them.
    readonly property real deviation: EmberGlass.glassL1Blur
    readonly property real padding: 60
    readonly property color edgeColor: "#140604"
    readonly property real resolution: 0.25

    property string url: ""
    property string tonedUrl: ""
    // The picture's size in pixels, and the screen's in CSS px it was made for.
    property size pictureSize: Qt.size(0, 0)
    property size screenSize: Qt.size(0, 0)
    // How many times it has been made (tests).
    property int made: 0

    // In the scene (its canvases draw only there), never seen.
    width: 0
    height: 0
    opacity: 0

    readonly property size _screen: wallpaper && scale > 0
        ? Qt.size(Math.round(wallpaper.width / scale), Math.round(wallpaper.height / scale)) : Qt.size(0, 0)
    on_ScreenChanged: later.restart()
    onSourceKeyChanged: later.restart()
    onActiveChanged: later.restart()
    onToneMapChanged: later.restart()
    Component.onCompleted: later.restart()

    Timer {
        id: later
        interval: 250
        onTriggered: blur.make()
    }

    // Make it now (tests; otherwise a moment after a change).
    function make() {
        later.stop();
        // A picture on its way for what was asked before is not wanted now.
        var generation = ++_generation;
        _job = null;
        _pending = null;
        if (!active || !wallpaper || _screen.width <= 0 || _screen.height <= 0) {
            url = "";
            tonedUrl = "";
            pictureSize = Qt.size(0, 0);
            screenSize = Qt.size(0, 0);
            return;
        }
        var w = Math.max(1, Math.round(_screen.width * resolution));
        var h = Math.max(1, Math.round(_screen.height * resolution));
        var screen = _screen;
        // The canvases at their sizes before they draw (a canvas resized
        // and drawn on at once draws on its old, empty picture).
        var g = _geometry(w, h, screen);
        _workSize = Qt.size(g.W, g.H);
        _outSize = Qt.size(w, h);
        var key = sourceKey;
        var ok = wallpaper.grabToImage(function (result) {
            // Something changed meanwhile: that one wins.
            if (generation !== blur._generation || later.running || key !== blur.sourceKey)
                return;
            blur._grab = result;
            blur._job = { url: String(result.url), w: w, h: h, screen: screen };
            work.loadImage(result.url);
            if (work.isImageLoaded(result.url))
                blur._run();
        }, Qt.size(w, h));
        // Not on screen yet (no window, hidden): when something changes.
        if (!ok)
            later.restart();
    }

    property var _grab: null
    property var _job: null
    property int _generation: 0
    property size _workSize: Qt.size(1, 1)
    property size _outSize: Qt.size(1, 1)

    // The geometry for a picture w x h of a screen (CSS px): its pixels per
    // CSS px f, the deviation s and padding pad in its pixels, the margin m
    // around it (the padding and room for the blur to fade to transparent
    // past it, as a CSS filter's does past the element's box), the work
    // area W x H.
    function _geometry(w, h, screen) {
        var f = w / screen.width;
        var s = deviation * f;
        var pad = Math.round(padding * f);
        var m = pad + Math.ceil(3 * s);
        return { f: f, s: s, pad: pad, m: m, W: w + 2 * m, H: h + 2 * m };
    }

    Canvas {
        id: work
        renderStrategy: Canvas.Immediate
        renderTarget: Canvas.Image
        width: blur._workSize.width
        height: blur._workSize.height
        onImageLoaded: if (blur._job && isImageLoaded(blur._job.url)) blur._run()
    }
    Canvas {
        id: out
        renderStrategy: Canvas.Immediate
        renderTarget: Canvas.Image
        width: blur._outSize.width
        height: blur._outSize.height
    }

    // The padded wallpaper's pixels to the worker.
    property int _jobId: 0
    function _run() {
        var job = _job;
        _job = null;
        if (!job)
            return;
        var w = job.w, h = job.h;
        var geo = _geometry(w, h, job.screen);
        var ctx = work.getContext("2d");
        ctx.reset();
        ctx.clearRect(0, 0, geo.W, geo.H);
        ctx.fillStyle = edgeColor;
        ctx.fillRect(geo.m - geo.pad, geo.m - geo.pad, w + 2 * geo.pad, h + 2 * geo.pad);
        ctx.drawImage(job.url, geo.m, geo.m, w, h);
        var src = ctx.getImageData(0, 0, geo.W, geo.H).data;
        work.unloadImage(job.url);
        _grab = null;
        var pixels = new Array(src.length);
        for (var i = 0; i < src.length; ++i)
            pixels[i] = src[i];
        _pending = { id: ++_jobId, w: w, h: h, screen: job.screen };
        worker.sendMessage({ id: _jobId, pixels: pixels, W: geo.W, H: geo.H, w: w, h: h, m: geo.m,
                             deviation: geo.s, toneMap: toneMap });
    }
    property var _pending: null

    WorkerScript {
        id: worker
        source: "WallpaperBlurWorker.js"
        // The blurred pixels back: the PNGs (drawImage on a cleared canvas:
        // Qt's putImageData puts nothing).
        onMessage: (msg) => {
            var job = blur._pending;
            if (!job || msg.id !== job.id)
                return;
            blur._pending = null;
            var octx = out.getContext("2d");
            octx.reset();
            var pngs = [];
            for (var k = 0; k < 2; ++k) {
                var list = k === 0 ? msg.raw : msg.toned;
                var img = octx.createImageData(job.w, job.h);
                for (var i = 0; i < list.length; ++i)
                    img.data[i] = list[i];
                octx.clearRect(0, 0, job.w, job.h);
                octx.drawImage(img, 0, 0);
                pngs.push(out.toDataURL("image/png"));
            }
            blur.pictureSize = Qt.size(job.w, job.h);
            blur.screenSize = job.screen;
            blur.url = pngs[0];
            blur.tonedUrl = pngs[1];
            blur.made++;
        }
    }
}
