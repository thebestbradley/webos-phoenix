#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Synthesize the shell's feedback sounds (shell/assets/sounds/phoenix/).

LunaSysMgr asked audiod for feedback sounds by name
(SoundPlayerPool::playFeedback -> palm://com.palm.audio/systemsounds/
playFeedback): the keyboard's "key", "space", "backspace" and "return"
(SysmgrIMEDataInterface.cpp:199-205) and "appclose" when a card is thrown
away (CardWindowManager.cpp:2893). audiod's sound files were not part of
the Open webOS release, so Phoenix makes its own: short clicks and a soft
whoosh, synthesized here from sine waves and seeded noise. Nothing is
sampled or recorded. The output is dedicated to the public domain (CC0 1.0).

    python3 tools/make-feedback-sounds.py [--out DIR] [--check]

--check regenerates in memory and fails if the files in the tree differ
(needs the same NumPy random stream, PCG64, which NumPy keeps stable).
"""

import argparse
import io
import os
import sys
import wave

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "shell", "assets", "sounds", "phoenix", "feedback")
RATE = 44100


def envelope(n, attack, decay):
    """A fast linear attack, then an exponential decay (time constant decay s)."""
    t = np.arange(n) / RATE
    env = np.exp(-t / decay)
    a = max(1, int(attack * RATE))
    env[:a] *= np.linspace(0.0, 1.0, a)
    return env


def lowpass(x, cutoff):
    """One-pole low-pass filter."""
    k = 1.0 - np.exp(-2.0 * np.pi * cutoff / RATE)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += k * (v - acc)
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def click(freq, length, decay, noise, body, seed, drop=0.0):
    """A key tick: a band of noise (the contact) over a short damped tone (the body)."""
    rng = np.random.default_rng(seed)
    n = int(length * RATE)
    t = np.arange(n) / RATE
    # The tone falls by `drop` (fraction of freq) over its length: a deeper key.
    f = freq * (1.0 - drop * t / length)
    phase = 2 * np.pi * np.cumsum(f) / RATE
    tone = np.sin(phase) * envelope(n, 0.0008, decay)
    hiss = highpass(lowpass(rng.standard_normal(n), freq * 2.5), freq * 0.6)
    hiss *= envelope(n, 0.0003, decay * 0.35)
    return body * tone + noise * hiss / (np.max(np.abs(hiss)) or 1.0)


def whoosh(length, seed):
    """A soft air sweep: noise through a low-pass whose cutoff rises and falls."""
    rng = np.random.default_rng(seed)
    n = int(length * RATE)
    x = rng.standard_normal(n)
    t = np.linspace(0.0, 1.0, n)
    cutoff = 300.0 + 2600.0 * np.sin(np.pi * t) ** 2
    y = np.empty(n)
    acc = 0.0
    for i in range(n):
        k = 1.0 - np.exp(-2.0 * np.pi * cutoff[i] / RATE)
        acc += k * (x[i] - acc)
        y[i] = acc
    y = highpass(y, 180.0)
    shape = np.sin(np.pi * t) ** 1.5
    return y * shape / (np.max(np.abs(y * shape)) or 1.0)


SOUNDS = {
    # name: (make, peak level)
    "key": (lambda: click(2300.0, 0.030, 0.0045, 0.55, 0.8, 1), 0.50),
    "space": (lambda: click(1500.0, 0.040, 0.0065, 0.50, 0.9, 2), 0.50),
    "backspace": (lambda: click(1100.0, 0.035, 0.0055, 0.45, 0.9, 3, drop=0.15), 0.48),
    "return": (lambda: click(800.0, 0.070, 0.0120, 0.35, 1.0, 4, drop=0.25), 0.55),
    "appclose": (lambda: whoosh(0.26, 5), 0.35),
}


def render(name):
    make, peak = SOUNDS[name]
    x = make()
    x = x / (np.max(np.abs(x)) or 1.0) * peak
    # 2 ms fade-out so the file ends on silence.
    f = int(0.002 * RATE)
    x[-f:] *= np.linspace(1.0, 0.0, f)
    pcm = np.round(x * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--check", action="store_true", help="fail if the files in --out differ")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    stale = []
    for name in SOUNDS:
        data = render(name)
        path = os.path.join(args.out, name + ".wav")
        if args.check:
            try:
                with open(path, "rb") as f:
                    if f.read() != data:
                        stale.append(path)
            except FileNotFoundError:
                stale.append(path)
        else:
            with open(path, "wb") as f:
                f.write(data)
            print("wrote %s (%d bytes)" % (os.path.relpath(path, REPO), len(data)))
    if stale:
        print("out of date: " + ", ".join(os.path.relpath(p, REPO) for p in stale), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
