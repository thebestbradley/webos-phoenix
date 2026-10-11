#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Draws Phoenix's bundled wallpapers (apps/settings/public/wallpapers).

Palm's wallpapers were not in the open-source release (docs/LEGAL.md), so
Phoenix draws its own in their spirit: soft photographic light, bokeh, sky
and water, a flower in macro, the TouchPad's soft swooshes; dark at the top
for the status bar's white text and at the bottom for the launcher's labels
and the quick launch bar. Every picture is drawn here from numbers alone
(gradients, noise, discs, curves, blurs), each from its own seed, so a run
gives the same pictures.

Each wallpaper is one square master, 2048 x 2048 (the TouchPad's 1024 x 1024
square at 2x): the shell fills the screen with it, cropped about the centre
(Wallpaper.qml, PreserveAspectCrop), upright or sideways, as luna-sysmgr
did with the TouchPad's square wallpapers (WindowServerLuna.cpp:89-156).
The composition keeps what matters inside the centre strip a tall phone
shows (about 45% of the width) and inside the middle 69% of the height a
landscape tablet shows. The Settings picker gets a 2:3 thumbnail of the
same centre (thumbs/).

    python3 tools/wallpapers/generate.py              # write them all
    python3 tools/wallpapers/generate.py aurora dawn  # only these
    python3 tools/wallpapers/generate.py --report     # legibility numbers
    python3 tools/wallpapers/generate.py --sheet out.png

Needs NumPy and Pillow.
"""

import argparse
import math
import os
import sys

import numpy as np
from PIL import Image

N = 2048
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "apps", "settings", "public", "wallpapers")
THUMB = (240, 360)
QUALITY = 84
F = np.float32

# The screens the crops are checked on (width, height in legacy pixels;
# shell/qml/sim.qml devicePresets, upright and turned).
SCREENS = [("Pre", 320, 480), ("Pre sideways", 480, 320), ("Modern phone", 393, 852),
           ("TouchPad", 1024, 768), ("TouchPad upright", 768, 1024), ("Modern tablet", 1180, 820)]


# ---- Colour -----------------------------------------------------------------

def lin(c):
    """sRGB hex or 0-255 triple to linear light."""
    if isinstance(c, str):
        c = [int(c[i:i + 2], 16) for i in (1, 3, 5)]
    c = np.asarray(c, np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(F)


def to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return a + (b - a) * t


# ---- Fields -----------------------------------------------------------------

V, U = np.mgrid[0:N, 0:N].astype(F) / F(N)  # v down, u across, 0..1
U = U + F(0.5 / N)
V = V + F(0.5 / N)


def blur(a, sigma):
    """Gaussian blur (sigma in pixels) of an HxW or HxWxC array, edges mirrored."""
    if sigma < 0.3:
        return a
    if a.ndim == 3:
        return np.stack([blur(a[..., i], sigma) for i in range(a.shape[2])], axis=2)
    # Large blurs on a smaller copy: the same picture, much faster.
    k = 1
    while sigma / (k * 2) >= 6 and a.shape[0] // (k * 2) >= 64:
        k *= 2
    src = a
    if k > 1:
        h, w = a.shape
        src = np.asarray(Image.fromarray(a.astype(F), "F").resize((w // k, h // k), Image.BOX))
    s = sigma / k
    pad = int(3 * s) + 2
    p = np.pad(src, pad, mode="symmetric")
    fy = np.fft.fftfreq(p.shape[0])[:, None]
    fx = np.fft.rfftfreq(p.shape[1])[None, :]
    g = np.exp(-2 * (math.pi * s) ** 2 * (fx * fx + fy * fy))
    out = np.fft.irfft2(np.fft.rfft2(p) * g, s=p.shape)[pad:-pad, pad:-pad].astype(F)
    if k > 1:
        out = np.asarray(Image.fromarray(out, "F").resize((a.shape[1], a.shape[0]), Image.BICUBIC))
    return out


def noise(rng, cells, w=N, h=N, cells_y=None):
    """Smooth value noise, 0..1, `cells` lattice cells across (cells_y down)."""
    cy = cells_y or cells
    g = rng.random((cy + 4, cells + 4)).astype(F)
    im = Image.fromarray(g, "F").resize((w, h), Image.BICUBIC, box=(2, 2, cells + 2, cy + 2))
    return np.asarray(im)


def fbm(rng, cells, octaves=5, gain=0.5, w=N, h=N, cells_y=None):
    total, amp, norm = np.zeros((h, w), F), 1.0, 0.0
    for o in range(octaves):
        c = cells * 2 ** o
        cy = (cells_y or cells) * 2 ** o
        total += F(amp) * noise(rng, min(c, w), w, h, min(cy, h))
        norm += amp
        amp *= gain
    return total / F(norm)


def fbm1(rng, cells, octaves=5, gain=0.5, n=N):
    """1-D fbm along u, 0..1."""
    return fbm(rng, cells, octaves, gain, w=n, h=1, cells_y=1)[0]


def vgradient(stops):
    """Vertical gradient (linear light), stops = [(v, '#rrggbb'), ...]."""
    pos = [p for p, _ in stops]
    cols = np.stack([lin(c) for _, c in stops])
    col = np.stack([np.interp(V[:, 0], pos, cols[:, i]) for i in range(3)], axis=1).astype(F)
    return np.repeat(col[:, None, :], N, axis=1)


def radial(cx, cy, rx, ry=None):
    ry = ry or rx
    return np.sqrt(((U - cx) / rx) ** 2 + ((V - cy) / ry) ** 2)


def glow(img, cx, cy, r, color, strength, ry=None):
    d = radial(cx, cy, r, ry)
    img += lin(color)[None, None, :] * (F(strength) * np.exp(-d * d))[..., None]


# ---- Light ------------------------------------------------------------------

def discs(rng, count, rmin, rmax, colors, gain, where=None, ring=0.25, soft=1.5, sigma=0.0, img=None):
    """Bokeh: out-of-focus lights as soft discs, a little brighter at the rim
    (as a lens draws them), added to img. Radii in pixels. where(u, v) -> 0..1
    is how likely a light is there."""
    layer = np.zeros((N, N, 3), F)
    placed = 0
    while placed < count:
        u, v = rng.random(), rng.random()
        if where is not None and rng.random() > where(u, v):
            continue
        placed += 1
        r = rmin * (rmax / rmin) ** rng.random()
        cx, cy = u * N, v * N
        x0, x1 = int(max(cx - r - 3, 0)), int(min(cx + r + 4, N))
        y0, y1 = int(max(cy - r - 3, 0)), int(min(cy + r + 4, N))
        if x1 <= x0 or y1 <= y0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(F)
        d = np.sqrt((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2)
        shape = np.clip((r - d) / soft + 0.5, 0, 1)
        shape *= 1 - ring + ring * smoothstep(0.55 * r, r, d)
        col = lin(colors[rng.integers(len(colors))]) * F(gain * (0.45 + 0.55 * rng.random()))
        layer[y0:y1, x0:x1] += shape[..., None] * col
    if sigma:
        layer = blur(layer, sigma)
    if img is not None:
        img += layer
    return layer


def splat(xs, ys, ws):
    """Points (0..1) with weights into an N x N density map."""
    h, _, _ = np.histogram2d(ys, xs, bins=N, range=[[0, 1], [0, 1]], weights=ws)
    return h.astype(F)


def stars(rng, count, where=None, gain=1.0):
    """Stars: a few bright, most faint, slightly tinted."""
    xs, ys = rng.random(count), rng.random(count)
    keep = np.ones(count, bool) if where is None else rng.random(count) < where(xs, ys)
    xs, ys = xs[keep], ys[keep]
    b = rng.random(len(xs)) ** 6
    ws = (0.08 + 2.2 * b) * gain
    tint = rng.random(len(xs))
    out = np.zeros((N, N, 3), F)
    for i, c in enumerate(lin("#cfe0ff") * 0.6 + 0.4):
        out[..., i] += splat(xs, ys, ws * (1 + (tint - 0.5) * 0.3 * (1 - i)))
    core = blur(out, 0.8)
    big = b > 0.6
    halo = np.zeros((N, N, 3), F)
    for i in range(3):
        halo[..., i] = splat(xs[big], ys[big], ws[big] * 0.5)
    return core * 3.0 + blur(halo, 3.5)


# ---- Finishing --------------------------------------------------------------

def bands(img, top=0.5, top_to=0.22, bottom=0.45, bottom_from=0.8):
    """Darken towards the top (status bar) and bottom (launcher labels, quick
    launch bar), smoothly, in light."""
    f = 1 - F(top) * smoothstep(top_to, 0.0, V) - F(bottom) * smoothstep(bottom_from, 1.0, V)
    img *= f[..., None]
    return img


def vignette(img, amount=0.25, cx=0.5, cy=0.5):
    d = radial(cx, cy, 0.75)
    img *= (1 - F(amount) * smoothstep(0.45, 1.25, d))[..., None]
    return img


def finish(img, rng, grain=0.8):
    """Linear light to 8-bit sRGB with a little film grain and triangular
    dither, so soft gradients do not band."""
    s = to_srgb(img) * 255.0
    g = (blur(rng.standard_normal((N, N)).astype(F), 0.6) * F(grain * 1.6))[..., None]
    d = (rng.random((N, N, 3)) - rng.random((N, N, 3))).astype(F)
    return np.clip(np.round(s + g + d), 0, 255).astype(np.uint8)


# ---- The wallpapers ---------------------------------------------------------

def northern_lights(rng):
    """Aurora curtains over a starry sky, a low ridge and a line of spruce."""
    img = vgradient([(0, "#01030a"), (0.35, "#04101f"), (0.62, "#082234"), (0.74, "#0e3a3f"), (1, "#0e3a3f")])
    img += stars(rng, 6000, where=lambda x, y: 1 - smoothstep(0.5, 0.76, y), gain=0.65)
    aur = np.zeros((N, N, 3), F)
    green, violet, rose = lin("#3dff9e"), lin("#8e4dff"), lin("#ff5a9e")
    # Each curtain: its lower edge across the sky (v at u), its height, its
    # brightness. The lower edge is the brightest; rays rise from it and fade
    # into violet. Where the curtain folds (the edge steep) it is seen edge
    # on and glows brighter; elsewhere it thins out to nothing.
    u = U[0]
    for base, tilt, bends, kinks, height, gain in [
            (0.52, 0.20, [(0.035, 1.1, 0.4)], [(0.36, 0.05), (0.58, -0.04), (0.8, 0.035)], 0.34, 1.0),
            (0.36, -0.10, [(0.025, 1.6, 2.6)], [(0.25, -0.03), (0.66, 0.03)], 0.20, 0.4),
            (0.63, 0.06, [(0.02, 2.3, 4.0)], [(0.5, 0.025)], 0.10, 0.25)]:
        edge = base + tilt * (u - 0.5) + 0.02 * (fbm1(rng, 6, 4) - 0.5)
        for a, f, ph in bends:
            edge = edge + a * np.sin(2 * math.pi * f * u + ph)
        # Folds: the curtain doubling back on itself, a tight S.
        for u0, a in kinks:
            x = (u - u0) / 0.03
            edge = edge + a * np.tanh(x) * np.exp(-(x / 3) ** 2)
        edge = edge.astype(F)
        slope = np.abs(np.gradient(edge) * N)
        fold = 1 + 1.6 * smoothstep(0.1, 0.8, slope)
        tall = (height * (0.55 + 0.9 * fbm1(rng, 5, 3))).astype(F)
        along = smoothstep(0.3, 0.7, fbm1(rng, 5, 4)) * fold
        t = (edge[None, :] - V) / tall[None, :]  # 0 at the edge, 1 at the top
        # Rays: fine noise across, stretched up the curtain, leaning.
        shift = (t * 0.02 * N).astype(np.int32)
        rays1 = fbm1(rng, 260, 3, 0.65, n=N + 64)
        idx = np.clip(np.arange(N)[None, :] + shift + 32, 0, N + 63)
        rays = smoothstep(0.25, 0.8, rays1[idx]) ** 1.3
        dy = np.minimum(t, 0) * tall[None, :]
        below = np.exp(-(dy / 0.004) ** 2)
        tp = np.maximum(t, 0)
        above = (0.55 * np.exp(-tp * 9) + 0.45 * np.exp(-tp * 1.6)) * (1 - smoothstep(0.7, 1.25, tp))
        shape = np.where(t < 0, below, above * (0.25 + 0.75 * rays) * (1 - 0.4 * np.exp(-tp * 9)) + 0.4 * np.exp(-tp * 9))
        shape = shape * along[None, :] * F(gain)
        c2 = smoothstep(0.3, 0.9, t)[..., None]
        c3 = smoothstep(0.85, 1.2, t)[..., None]
        col = mix(mix(green, violet * 0.8, c2), rose * 0.6, c3 * 0.4)
        aur += shape[..., None].astype(F) * col
    aur = blur(aur, 1.4)
    img += aur * F(0.4) + blur(aur, 24) * F(0.26) + blur(aur, 140) * F(0.26)
    # The land: a far ridge, misty, then the near hills and spruce, black.
    ridge = 0.735 - 0.05 * fbm1(rng, 5, 6, 0.55) - 0.02 * np.exp(-((u - 0.62) / 0.12) ** 2)
    far = (V > ridge[None, :]).astype(F)
    far = blur(far, 1.0)
    img = img * (1 - far[..., None]) + far[..., None] * lin("#0a1820") * (0.9 + 0.3 * (1 - smoothstep(0.73, 0.8, V)))[..., None]
    near_line = 0.80 - 0.025 * fbm1(rng, 4, 5, 0.5)
    # Spruce: narrow spires, their branches in tiers; a row further back,
    # smaller and paler in the haze, then the near row.
    for lift, scale, gap, col in ((0.012, 0.6, 0.35, "#06121a"), (0.0, 1.0, 0.55, "#03080b")):
        trees = (V > (near_line + lift)[None, :]).astype(F) if lift == 0 else np.zeros((N, N), F)
        x = -0.01
        while x < 1.01:
            w = (0.004 + 0.007 * rng.random()) * scale
            h = (0.025 + 0.075 * rng.random() ** 1.5) * scale
            x0, x1 = int((x - w) * N), int((x + w) * N) + 1
            ground = float(near_line[min(max(int(x * N), 0), N - 1)]) - lift + 0.004
            y0, y1 = int((ground - h) * N), int(ground * N) + 2
            if x1 > 0 and x0 < N:
                x0, x1 = max(x0, 0), min(x1, N)
                hy = (ground - V[y0:y1, x0:x1]) / h          # 0 at the foot, 1 at the tip
                tiers = 7 + 5 * rng.random()
                saw = (hy * tiers + rng.random()) % 1.0
                half = w * np.clip(1 - hy, 0, 1) ** 0.9 * (0.55 + 0.45 * saw)
                half = np.where(hy < 0.04, w * 0.6, half)    # the foot, among the undergrowth
                inside = np.abs(U[y0:y1, x0:x1] - x) < half
                trees[y0:y1, x0:x1] = np.maximum(trees[y0:y1, x0:x1], inside * (hy <= 1))
            x += w * (gap + 1.0 * rng.random())
        if lift:
            trees = np.maximum(trees, ((V > (near_line - lift)[None, :]) & (V < near_line[None, :] + 0.01)).astype(F))
        m = blur(trees, 0.9)
        img = img * (1 - m[..., None]) + m[..., None] * lin(col)
    return bands(img, top=0.35, bottom=0.2)


def phoenix(rng):
    """Abstract fire: two wings of flame-light rising from an ember glow."""
    img = vgradient([(0, "#060104"), (0.4, "#120305"), (0.75, "#240706"), (1, "#14040a")])
    glow(img, 0.5, 0.86, 0.32, "#6a1a08", 0.55, 0.18)
    glow(img, 0.5, 0.62, 0.22, "#3a0a06", 0.35)
    xs_all, ys_all, ws_all = [], [], []
    t = np.linspace(0, 1, 2400)
    # Wings: feather lines from the body out and up, curling at the tips.
    for side in (-1, 1):
        for i in range(150):
            k = i / 149
            y0 = 0.50 + 0.16 * k + 0.01 * rng.standard_normal()
            length = 0.36 - 0.22 * k + 0.03 * rng.standard_normal()
            lift = 0.62 - 0.35 * k + 0.08 * rng.standard_normal()
            p0 = np.array([0.5 + side * 0.012, y0])
            p1 = np.array([0.5 + side * length * 0.45, y0 - length * lift * 1.1])
            p2 = np.array([0.5 + side * length, y0 - length * (lift * 0.55 - 0.18 * (1 - k))])
            b = ((1 - t) ** 2)[:, None] * p0 + (2 * (1 - t) * t)[:, None] * p1 + (t ** 2)[:, None] * p2
            wob = 0.004 * np.sin(t * (10 + 6 * rng.random()) + rng.random() * 6)
            xs_all.append(b[:, 0] + side * wob)
            ys_all.append(b[:, 1] + wob)
            ws_all.append((1 - t) ** 0.6 * (0.6 + 0.4 * rng.random()) * (1.1 - 0.5 * k))
    # The body: tongues of flame rising, swaying.
    for i in range(70):
        k = rng.random()
        h = 0.30 + 0.22 * rng.random()
        y = 0.86 - h * t
        x = 0.5 + (0.03 * (1 - t) * (rng.random() - 0.5) * 4
                   + 0.018 * t * np.sin(t * (6 + 5 * rng.random()) + rng.random() * 6.3))
        xs_all.append(x)
        ys_all.append(y)
        ws_all.append(np.sin(np.pi * np.clip(t * 1.05, 0, 1)) ** 0.8 * (0.5 + 0.5 * k) * 1.2)
    xs, ys, ws = np.concatenate(xs_all), np.concatenate(ys_all), np.concatenate(ws_all)
    dens = splat(xs, ys, ws)
    fine = blur(dens, 1.3)
    heat = fine / np.percentile(fine[fine > 0], 99.5) * 0.55
    heat += blur(dens, 14) / blur(dens, 14).max() * 0.45 + blur(dens, 70) / blur(dens, 70).max() * 0.35
    heat = 1 - np.exp(-heat * 1.4)
    # Fire's colours, from the dark through ember red to gold.
    stops = [(0, "#000000"), (0.18, "#4a0805"), (0.4, "#b3260a"), (0.62, "#ef6a12"), (0.82, "#ffb547"), (1, "#ffe6b0")]
    pos = [p for p, _ in stops]
    cols = np.stack([lin(c) for _, c in stops])
    fire = np.stack([np.interp(heat, pos, cols[:, i]) for i in range(3)], axis=2).astype(F)
    img += fire * F(0.9)
    # Embers drifting up.
    discs(rng, 110, 2, 8, ["#ff8a2a", "#ffb04a", "#ff5a1a"], 0.6,
          where=lambda u, v: math.exp(-((u - 0.5) / 0.22) ** 2) * smoothstep(0.85, 0.35, v) * smoothstep(0.1, 0.3, v),
          ring=0.0, soft=1.5, sigma=1.5, img=img)
    discs(rng, 24, 14, 40, ["#ff7a20", "#c8400e"], 0.14, ring=0.2, sigma=9, img=img,
          where=lambda u, v: math.exp(-((u - 0.5) / 0.3) ** 2) * smoothstep(0.9, 0.3, v))
    img = vignette(img, 0.3)
    return bands(img, top=0.45, bottom=0.4)


def _bokeh(rng, sky, colors_far, colors_near, wash):
    img = vgradient(sky)
    for (cx, cy, r, c, s) in wash:
        glow(img, cx, cy, r, c, s)
    discs(rng, 45, 50, 130, colors_far, 0.09, ring=0.1, sigma=22, img=img)
    discs(rng, 28, 45, 110, colors_near, 0.13, ring=0.2, sigma=4, img=img,
          where=lambda u, v: 0.2 + 0.8 * math.exp(-((v - 0.5) / 0.25) ** 2))
    discs(rng, 9, 80, 170, colors_near, 0.10, ring=0.25, sigma=2, img=img,
          where=lambda u, v: math.exp(-((v - 0.5) / 0.22) ** 2))
    img = vignette(img, 0.35)
    return bands(img, top=0.5, bottom=0.45)


def twilight(rng):
    """Blue and violet city lights, far out of focus."""
    return _bokeh(rng, [(0, "#040714"), (0.5, "#0d1838"), (1, "#080a1c")],
                  ["#2a5cff", "#5a3cff", "#1fa0ff"], ["#4f8cff", "#8a6cff", "#3cc8ff", "#c07cff"],
                  [(0.3, 0.45, 0.4, "#1a2a6a", 0.5), (0.75, 0.6, 0.35, "#3a1a6a", 0.4)])


def amber(rng):
    """Warm gold lights, as through a window at dusk."""
    return _bokeh(rng, [(0, "#0b0502"), (0.5, "#2a1306"), (1, "#110703")],
                  ["#ff9a2a", "#ff7a1a", "#ffc04a"], ["#ffb347", "#ffd27a", "#ff8c2a", "#ffe0a0"],
                  [(0.6, 0.45, 0.45, "#6a3510", 0.5), (0.25, 0.65, 0.3, "#5a200a", 0.35)])


def garden(rng):
    """Sun through leaves: greens and soft yellow."""
    return _bokeh(rng, [(0, "#020804"), (0.5, "#0c2410"), (1, "#041006")],
                  ["#3cbf4a", "#8adf3c", "#1f9a5a"], ["#a8f05a", "#e8f27a", "#5ad87a", "#fff2a0"],
                  [(0.65, 0.35, 0.4, "#2f6a18", 0.5), (0.3, 0.7, 0.35, "#164a26", 0.4)])


def sea_and_sky(rng):
    """A calm sea under a soft evening sky, the sun low behind haze."""
    hz = 0.6
    img = vgradient([(0, "#0b1a3a"), (0.3, "#24467a"), (0.5, "#7a86a8"), (hz, "#e8b48a"),
                     (hz + 0.0001, "#5a6a88"), (0.75, "#1e3456"), (1, "#081428")])
    glow(img, 0.52, hz, 0.12, "#ffd9a0", 0.9, 0.05)
    glow(img, 0.52, hz, 0.35, "#ff9a60", 0.35, 0.12)
    # Clouds: long soft streaks lit from below.
    c = fbm(rng, 3, 6, 0.55, cells_y=14)
    streak = smoothstep(0.5, 0.75, c) * smoothstep(hz, 0.15, V) * smoothstep(0.05, 0.3, V)
    lit = mix(lin("#3a4a72"), lin("#ffc8a0"), smoothstep(0.2, hz, V)[..., None])
    sky = V < hz
    img += (streak * F(0.35))[..., None] * lit * sky[..., None]
    # Water: the sky mirrored, broken by ripples, with the sun's path.
    rip = fbm(rng, 4, 6, 0.6, cells_y=90)
    depth = np.clip((V - hz) / (1 - hz), 0, 1)
    path = np.exp(-((U - 0.52) / (0.02 + 0.12 * depth)) ** 2)
    glitter = smoothstep(0.55, 0.85, rip) * path * (1 - depth) ** 0.8
    water = ~sky
    img += (water * (glitter * 1.2 + (rip - 0.5) * 0.08 * (1 - depth)))[..., None] * lin("#ffd8a8")
    img = blur(img, 0.7)
    return bands(img, top=0.35, bottom=0.35)


def dawn(rng):
    """First light over layered hills in mist."""
    img = vgradient([(0, "#100c2a"), (0.25, "#2c2456"), (0.45, "#7a4a7a"), (0.6, "#e08a7a"), (0.72, "#ffc890"), (1, "#ffc890")])
    glow(img, 0.45, 0.69, 0.16, "#fff0c8", 0.55, 0.07)
    c = fbm(rng, 2, 5, 0.5, cells_y=26)
    img += blur((smoothstep(0.6, 0.85, c) * smoothstep(0.62, 0.3, V) * smoothstep(0.1, 0.35, V) * F(0.07)), 4)[..., None] * lin("#ffc0b0")
    for i, (line, rough, col) in enumerate([
            (0.69, 0.05, "#8a5a78"), (0.74, 0.06, "#5a3456"), (0.80, 0.07, "#341c36"), (0.88, 0.08, "#180c1c")]):
        edge = line - rough * fbm1(rng, 3 + i, 5, 0.5)
        m = blur((V > edge[None, :]).astype(F), 1.0)
        layer = lin(col)[None, None, :] * (1 - 0.3 * smoothstep(0, 0.12, V - edge[None, :]))[..., None]
        img = img * (1 - m[..., None]) + m[..., None] * layer
        # Mist in the valley behind the next hill.
        haze = np.exp(-((V - edge[None, :] - 0.03) / 0.03) ** 2) * (0.3 + 0.7 * fbm(rng, 6, 3, 0.5))
        img += (haze * F(0.10 - 0.02 * i))[..., None] * lin("#ffd8c8")
    return bands(img, top=0.45, bottom=0.5, bottom_from=0.7)


def silk(rng):
    """Soft ribbons of light sweeping across, in the TouchPad's manner."""
    img = vgradient([(0, "#030616"), (0.5, "#0a1640"), (1, "#050a22")])
    glow(img, 0.6, 0.5, 0.5, "#1a2f7a", 0.45)
    light = np.zeros((N, N, 3), F)
    # One sweep from the lower left up to the right; ribbons of light follow
    # it, each twisting (narrowing) here and there, a sheen along one edge.
    sweep = 0.74 - 0.42 * smoothstep(-0.1, 1.1, U) - 0.06 * np.sin(math.pi * U)
    for off, a1, ph, w, twist, col, g in [
            (0.00, 0.025, 0.3, 0.075, 0.8, "#5aa8ff", 0.9), (0.035, 0.03, 1.7, 0.04, 1.3, "#b8e4ff", 0.75),
            (-0.05, 0.035, 2.9, 0.10, 0.6, "#3a5cff", 0.55), (0.075, 0.02, 4.1, 0.025, 1.7, "#ffffff", 0.5),
            (-0.10, 0.04, 5.2, 0.06, 1.1, "#8a6cff", 0.45), (0.12, 0.05, 0.9, 0.12, 0.5, "#2a7aff", 0.3)]:
        c = sweep + off + a1 * np.sin(2 * math.pi * 0.8 * U + ph)
        width = w * (0.2 + 0.8 * np.abs(np.cos(math.pi * twist * U + ph)))
        d = (V - c) / width
        prof = np.exp(-d * d) * (0.5 + 0.5 * np.tanh(-d * 2.0)) + 0.4 * np.exp(-((d + 0.8) / 0.22) ** 2)
        light += (prof * F(g))[..., None] * lin(col)
    light = blur(light, 3.0)
    img += light * F(0.42) + blur(light, 60) * F(0.4)
    img = vignette(img, 0.3)
    return bands(img, top=0.5, bottom=0.45)


def midnight(rng):
    """A clear night: the Milky Way across a deep blue sky."""
    img = vgradient([(0, "#01020a"), (0.6, "#050b22"), (1, "#0a1430")])
    band = np.exp(-(((V - 0.5) - 0.55 * (U - 0.5)) / 0.16) ** 2)
    neb = fbm(rng, 6, 7, 0.55)
    dust = smoothstep(0.45, 0.75, fbm(rng, 10, 6, 0.6))
    img += (band * (0.2 + 0.8 * neb) * (1 - 0.6 * dust) * F(0.10))[..., None] * lin("#b8c8ff")
    img += (band * smoothstep(0.55, 0.8, neb) * F(0.05))[..., None] * lin("#ffb8d8")
    img += stars(rng, 14000, where=lambda x, y: 0.35 + 0.65 * np.exp(-(((y - 0.5) - 0.55 * (x - 0.5)) / 0.18) ** 2), gain=0.8)
    glow(img, 0.5, 1.05, 0.5, "#1a3060", 0.4, 0.25)
    return bands(img, top=0.3, bottom=0.3)


def bloom(rng):
    """A flower in macro, seen a little from the side: soft focus but for
    its heart, light coming through the petals, leaves out of focus behind."""
    img = vgradient([(0, "#060c06"), (0.45, "#1e361a"), (1, "#0c180c")])
    glow(img, 0.8, 0.3, 0.45, "#c8d870", 0.12)
    discs(rng, 40, 60, 160, ["#6a9a3a", "#b0c85a", "#3a7a4a", "#e8e090"], 0.16, ring=0.15, sigma=14, img=img)
    cx, cy, tilt = 0.44, 0.60, 0.62
    dx, dy = U - cx, (V - cy) / tilt
    r = np.sqrt(dx * dx + dy * dy)
    th = np.arctan2(dy, dx)
    petals = np.zeros((N, N, 3), F)
    alpha = np.zeros((N, N), F)
    # Two rings of long petals, the outer first; each petal over the ones
    # before casts a soft shadow on them.
    for count, length, width, rot, base, tip in [
            (16, 0.62, 0.075, 0.0, "#b82068", "#ffc6de"),
            (14, 0.42, 0.065, 0.11, "#c82a70", "#ffdcea")]:
        order = rng.permutation(count)
        for k in order:
            ang = rot + 2 * math.pi * k / count + 0.06 * rng.standard_normal()
            L = length * (0.85 + 0.25 * rng.random())
            W = width * (0.85 + 0.3 * rng.random())
            da = th - ang
            along = r * np.cos(da)
            across = r * np.sin(da)
            s_ = np.clip(along / L, 0, 1)
            half = W * np.maximum(np.sin(np.pi * np.clip(s_ * 0.92 + 0.04, 0, 1)), 0) ** 0.75 * smoothstep(0.0, 0.12, s_)
            m = smoothstep(0.004, -0.004, np.abs(across) - half) * (along > 0) * (along < L)
            m = m.astype(F)
            if not m.any():
                continue
            shadow = blur(m, 14)
            petals *= (1 - 0.45 * shadow)[..., None]
            tone = smoothstep(0.05, 0.95, s_) ** 0.8
            crease = 0.82 + 0.18 * smoothstep(0.0, 0.5, np.abs(across) / np.maximum(half, 1e-4))
            lit = 0.75 + 0.35 * smoothstep(0.7, 1.0, np.abs(across) / np.maximum(half, 1e-4)) * s_
            col = mix(lin(base), lin(tip), tone[..., None]) * (crease * lit)[..., None]
            petals = petals * (1 - m[..., None]) + m[..., None] * col
            alpha = np.maximum(alpha, m)
    # The heart: a cushion of tiny florets.
    heart = smoothstep(0.075, 0.06, r).astype(F)
    n = 2500
    hr = 0.065 * np.sqrt(rng.random(n))
    ha = 2 * math.pi * rng.random(n)
    dots = blur(splat(cx + hr * np.cos(ha), cy + hr * np.sin(ha) * tilt, np.ones(n)), 2.5)
    dots = dots / max(dots.max(), 1e-6)
    dome = 0.45 + 0.7 * np.exp(-((U - cx + 0.02) ** 2 + ((V - cy + 0.012) / tilt) ** 2) / 0.035 ** 2)
    hcol = mix(lin("#7a5208"), lin("#ffd848"), (0.35 + 0.65 * dots)[..., None]) * (dome * (1 - 0.45 * smoothstep(0.04, 0.075, r)))[..., None]
    petals = petals * (1 - heart[..., None]) + heart[..., None] * hcol
    alpha = np.maximum(alpha, heart)
    # Depth of field: sharp at the heart, softer with distance from it.
    sharp, mid, soft = blur(petals, 1.0), blur(petals, 6), blur(petals, 16)
    am, as_ = blur(alpha, 6), blur(alpha, 16)
    f1 = smoothstep(0.06, 0.2, r)[..., None]
    f2 = smoothstep(0.2, 0.45, r)[..., None]
    col = mix(mix(sharp, mid, f1), soft, f2)
    al = mix(mix(alpha, am, f1[..., 0]), as_, f2[..., 0])[..., None]
    img = img * (1 - al) + col * F(0.5)
    img = vignette(img, 0.4, 0.45, 0.6)
    return bands(img, top=0.6, top_to=0.3, bottom=0.65, bottom_from=0.68)


def linen(rng):
    """A dark woven texture, quiet behind the icons."""
    base = vgradient([(0, "#1c1d22"), (0.5, "#2c2e34"), (1, "#18191d")])
    warp = fbm(rng, 900, 2, 0.5, cells_y=8)
    weft = fbm(rng, 8, 2, 0.5, cells_y=900)
    slub = fbm(rng, 60, 3, 0.5, cells_y=4) * fbm(rng, 4, 3, 0.5, cells_y=60)
    t = (0.5 * warp + 0.5 * weft - 0.5) * 0.6 + (slub - 0.25) * 0.4
    img = base * (1 + 0.55 * t)[..., None]
    glow(img, 0.35, 0.3, 0.6, "#3a3e4a", 0.18)
    img = vignette(img, 0.45)
    return bands(img, top=0.3, bottom=0.3)


def cells(rng, k, wu, wv):
    """F2 - F1 of a Worley (cellular) field at the points (wu, wv): small
    along the cells' edges. One seed in each square of a k x k grid, so no
    two fall together; the seeds tile, so the edges do too."""
    gy, gx = np.mgrid[0:k, 0:k]
    pts = ((np.stack([gx.ravel(), gy.ravel()], 1) + 0.1 + 0.8 * rng.random((k * k, 2))) / k).astype(F)
    # The seeds and their copies across each side (those near enough to it).
    near = [pts + F([ox, oy]) for ox in (-1, 0, 1) for oy in (-1, 0, 1)]
    near = np.concatenate(near)
    near = near[(near[:, 0] > -0.35) & (near[:, 0] < 1.35) & (near[:, 1] > -0.35) & (near[:, 1] < 1.35)]
    # At half size, then enlarged: the edges are blurred afterwards anyway.
    hu, hv = wu[::2, ::2], wv[::2, ::2]
    f1 = np.full(hu.shape, 9.0, F)
    f2 = np.full(hu.shape, 9.0, F)
    for px, py in near:
        d = (hu - px) ** 2 + (hv - py) ** 2
        f2 = np.minimum(f2, np.maximum(f1, d))
        f1 = np.minimum(f1, d)
    e = (np.sqrt(f2) - np.sqrt(f1)).astype(F)
    return np.asarray(Image.fromarray(e, "F").resize((wu.shape[1], wu.shape[0]), Image.BICUBIC))


def shallows(rng):
    """Sunlight on the sand under clear shallow water: the caustics' net."""
    img = vgradient([(0, "#03202a"), (0.45, "#0b4e58"), (1, "#062a34")])
    sand = fbm(rng, 12, 4, 0.5)
    img *= (0.85 + 0.3 * sand)[..., None]
    glow(img, 0.62, 0.32, 0.45, "#2a8a8a", 0.25)
    # The net: cell edges, bent by a slow warp, as ripples focus the light.
    light = np.zeros((N, N), F)
    for k, gain, width in ((6, 1.0, 0.006), (9, 0.45, 0.004)):
        wu = U + 0.05 * (fbm(rng, 3, 2, 0.5) - 0.5) + 0.03 * (fbm(rng, 8, 2, 0.5) - 0.5)
        wv = V + 0.05 * (fbm(rng, 3, 2, 0.5) - 0.5) + 0.03 * (fbm(rng, 8, 2, 0.5) - 0.5)
        e = cells(rng, k, wu, wv)
        light += F(gain) * np.exp(-e / F(width)) * (0.4 + 0.9 * fbm(rng, 6, 3, 0.5))
    light = blur(light, 2.2)
    fade = 1 - 0.55 * smoothstep(0.35, 1.0, V)
    img += (light * F(0.11) * fade)[..., None] * lin("#b8fff0")
    img += blur(light * F(0.10) * fade, 18)[..., None] * lin("#3ac8c8")
    # Soft shafts from the surface, slanting.
    shaft = fbm(rng, 14, 2, 0.5, cells_y=1)
    idx = np.clip((np.arange(N)[None, :] - (V * 0.25 * N).astype(np.int32)), 0, N - 1)
    shaft = smoothstep(0.55, 0.8, shaft[0][idx]) * smoothstep(0.0, 0.3, V) * smoothstep(0.85, 0.25, V)
    img += blur(shaft * F(0.05), 24)[..., None] * lin("#c0fff8")
    img = vignette(img, 0.3)
    return bands(img, top=0.45, bottom=0.4)


# name, title in the picker, drawing, seed
WALLPAPERS = [
    ("northern-lights", "Northern Lights", northern_lights, 1101),
    ("phoenix", "Phoenix", phoenix, 1102),
    ("twilight", "Twilight", twilight, 1103),
    ("amber", "Amber", amber, 1104),
    ("garden", "Garden", garden, 1105),
    ("sea-and-sky", "Sea and Sky", sea_and_sky, 1106),
    ("dawn", "Dawn", dawn, 1107),
    ("silk", "Silk", silk, 1108),
    ("midnight", "Midnight", midnight, 1109),
    ("bloom", "Bloom", bloom, 1110),
    ("shallows", "Shallows", shallows, 1111),
    ("linen", "Linen", linen, 1112),
]


def render(name):
    for n, _, fn, seed in WALLPAPERS:
        if n == name:
            rng = np.random.default_rng(seed)
            return finish(fn(rng).astype(F), rng)
    raise KeyError(name)


def crop(im, w, h):
    """The part of the square a w x h screen shows (PreserveAspectCrop)."""
    s = im.size[0]
    if w / h < 1:
        cw = round(s * w / h)
        return im.crop(((s - cw) // 2, 0, (s - cw) // 2 + cw, s))
    ch = round(s * h / w)
    return im.crop((0, (s - ch) // 2, s, (s - ch) // 2 + ch))


def luminance(a):
    c = a.astype(np.float64) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def contrast_white(y):
    return 1.05 / (y + 0.05)


def report(im):
    """White text's contrast over the status bar band (top 28 legacy px),
    the launcher's labels and quick launch bar (bottom 110 px), and the
    lock screen's clock (a band at 18-36% down), on each screen."""
    rows = []
    for label, w, h in SCREENS:
        c = np.asarray(crop(im, w, h).resize((w, h), Image.BOX))
        top = luminance(c[:28])
        bottom = luminance(c[-110:])
        clock = luminance(c[int(h * 0.18):int(h * 0.36)])
        rows.append((label, contrast_white(np.percentile(top, 90)), contrast_white(np.percentile(bottom, 90)),
                     contrast_white(np.percentile(clock, 90))))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="only these wallpapers")
    ap.add_argument("--report", action="store_true", help="print white text's contrast over each (90th percentile)")
    ap.add_argument("--sheet", help="also write a contact sheet of the thumbnails to this PNG")
    ap.add_argument("--out", default=OUT, help="output directory (default: the Settings app's public/wallpapers)")
    args = ap.parse_args()
    names = args.names or [n for n, *_ in WALLPAPERS]
    os.makedirs(os.path.join(args.out, "thumbs"), exist_ok=True)
    thumbs = []
    worst = 99.0
    for name in names:
        im = Image.fromarray(render(name), "RGB")
        path = os.path.join(args.out, name + ".jpg")
        im.save(path, quality=QUALITY, optimize=True, progressive=True, subsampling="4:2:0")
        th = crop(im, 2, 3).resize(THUMB, Image.LANCZOS)
        th.save(os.path.join(args.out, "thumbs", name + ".jpg"), quality=84, optimize=True, progressive=True)
        thumbs.append(th)
        print(f"wrote {os.path.relpath(path, ROOT)} {os.path.getsize(path) // 1024} KB", flush=True)
        if args.report:
            for label, top, bottom, clock in report(im):
                worst = min(worst, top, bottom)
                print(f"    {label:17s} status bar {top:5.2f}:1   launcher {bottom:5.2f}:1   clock {clock:5.2f}:1")
    if args.sheet and thumbs:
        cols = 6
        rows = (len(thumbs) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (THUMB[0] + 8) + 8, rows * (THUMB[1] + 8) + 8), (40, 40, 40))
        for i, th in enumerate(thumbs):
            sheet.paste(th, (8 + (i % cols) * (THUMB[0] + 8), 8 + (i // cols) * (THUMB[1] + 8)))
        sheet.save(args.sheet)
    if args.report:
        print(f"lowest top/bottom contrast: {worst:.2f}:1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
