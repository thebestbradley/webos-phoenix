// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// WallpaperBlur's work, on a thread of its own (WorkerScript): the padded
// wallpaper's pixels blurred as CSS's blur() blurs them, the screen's part
// of them cut out, as they are and under a tone map. See WallpaperBlur.qml.
//
// Message in:  {id, pixels: [r, g, b, a, ...] (W x H, straight alpha),
//               W, H, w, h, m (the screen's part: w x h at m, m),
//               deviation (in pixels), toneMap: {saturate, contrast, brightness}}
// Message out: {id, raw: [...], toned: [...]} (w x h, straight alpha, 0-255)

// The box sizes for a Gaussian of deviation s (Filter Effects 1,
// feGaussianBlur: d = floor(s * 3 * sqrt(2 * pi) / 4 + 0.5); three boxes of d
// centred on the pixel when d is odd, else two of d, their centres half a
// pixel to its left and to its right, and one of d + 1 on it; Skia, which
// draws Chromium's blur(), does the same): [lo, hi] each, the pixels the box
// takes before and after the one it is for.
function boxes(s) {
    var d = Math.floor(s * 3 * Math.sqrt(2 * Math.PI) / 4 + 0.5);
    if (d < 1)
        return [];
    if (d % 2 === 1)
        return [[(d - 1) / 2, (d - 1) / 2], [(d - 1) / 2, (d - 1) / 2], [(d - 1) / 2, (d - 1) / 2]];
    return [[d / 2, d / 2 - 1], [d / 2 - 1, d / 2], [d / 2, d / 2]];
}

// One box blur of the four channels along n pixels from start, step apart
// (in pixels): a into b. Outside the picture is transparent (zero), as past
// a CSS filter's input.
function box(a, b, start, step, n, lo, hi) {
    var d = lo + hi + 1;
    var s0 = 0, s1 = 0, s2 = 0, s3 = 0, i, k;
    for (i = 0; i <= hi && i < n; ++i) {
        k = 4 * (start + i * step);
        s0 += a[k]; s1 += a[k + 1]; s2 += a[k + 2]; s3 += a[k + 3];
    }
    for (i = 0; i < n; ++i) {
        k = 4 * (start + i * step);
        b[k] = s0 / d; b[k + 1] = s1 / d; b[k + 2] = s2 / d; b[k + 3] = s3 / d;
        var add = i + hi + 1, drop = i - lo;
        if (add < n) {
            k = 4 * (start + add * step);
            s0 += a[k]; s1 += a[k + 1]; s2 += a[k + 2]; s3 += a[k + 3];
        }
        if (drop >= 0) {
            k = 4 * (start + drop * step);
            s0 -= a[k]; s1 -= a[k + 1]; s2 -= a[k + 2]; s3 -= a[k + 3];
        }
    }
}

function clamp(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

// CSS's saturate(), contrast() and brightness() on straight sRGB, in that
// order, each clamped (Filter Effects 1; as Chromium applies the shorthand
// functions).
function tone(r, g, b, t) {
    var s = t.saturate;
    if (s !== 1) {
        var r2 = (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b;
        var g2 = (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b;
        var b2 = (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b;
        r = clamp(r2); g = clamp(g2); b = clamp(b2);
    }
    var c = t.contrast;
    if (c !== 1) {
        r = clamp((r - 0.5) * c + 0.5); g = clamp((g - 0.5) * c + 0.5); b = clamp((b - 0.5) * c + 0.5);
    }
    var k = t.brightness;
    if (k !== 1) {
        r = clamp(r * k); g = clamp(g * k); b = clamp(b * k);
    }
    return [r, g, b];
}

WorkerScript.onMessage = function (msg) {
    var W = msg.W, H = msg.H, w = msg.w, h = msg.h, m = msg.m, px = msg.pixels;
    var n = W * H, i;
    // Premultiplied, as a filter blurs.
    var a = new Float32Array(4 * n), b = new Float32Array(4 * n);
    for (i = 0; i < n; ++i) {
        var al = px[4 * i + 3] / 255;
        a[4 * i] = px[4 * i] * al;
        a[4 * i + 1] = px[4 * i + 1] * al;
        a[4 * i + 2] = px[4 * i + 2] * al;
        a[4 * i + 3] = al;
    }
    var bx = boxes(msg.deviation), p, x, y, t;
    for (p = 0; p < bx.length; ++p) {
        for (y = 0; y < H; ++y)
            box(a, b, y * W, 1, W, bx[p][0], bx[p][1]);
        t = a; a = b; b = t;
    }
    for (p = 0; p < bx.length; ++p) {
        for (x = 0; x < W; ++x)
            box(a, b, x, W, H, bx[p][0], bx[p][1]);
        t = a; a = b; b = t;
    }
    var raw = new Array(4 * w * h), toned = new Array(4 * w * h);
    for (y = 0; y < h; ++y) {
        for (x = 0; x < w; ++x) {
            var j = 4 * ((y + m) * W + (x + m)), o = 4 * (y * w + x);
            var alpha = a[j + 3];
            var r = alpha > 0 ? a[j] / alpha : 0, g = alpha > 0 ? a[j + 1] / alpha : 0, bl = alpha > 0 ? a[j + 2] / alpha : 0;
            raw[o] = Math.round(r);
            raw[o + 1] = Math.round(g);
            raw[o + 2] = Math.round(bl);
            raw[o + 3] = Math.round(alpha * 255);
            var tc = tone(r / 255, g / 255, bl / 255, msg.toneMap);
            toned[o] = Math.round(tc[0] * 255);
            toned[o + 1] = Math.round(tc[1] * 255);
            toned[o + 2] = Math.round(tc[2] * 255);
            toned[o + 3] = raw[o + 3];
        }
    }
    WorkerScript.sendMessage({ id: msg.id, raw: raw, toned: toned });
};
