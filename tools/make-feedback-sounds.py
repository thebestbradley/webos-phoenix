#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Synthesize the shell's feedback sounds and tones (shell/assets/sounds/phoenix/).

LunaSysMgr asked audiod for feedback sounds by name
(SoundPlayerPool::playFeedback -> palm://com.palm.audio/systemsounds/
playFeedback): the keyboard's "key", "space", "backspace" and "return"
(SysmgrIMEDataInterface.cpp:199-205), "appclose" when a card is thrown
away (CardWindowManager.cpp:2893) and "shutter" for a screen capture. audiod's sound files were not part of
the Open webOS release, so Phoenix makes its own: short clicks and a soft
whoosh, synthesized here from sine waves and seeded noise. Nothing is
sampled or recorded. The output is dedicated to the public domain (CC0 1.0).

Also the sounds the angry card (CardWindowManager.cpp:1525, 1822: "carddrag"
as it is stretched; :2891 "birdappclose" as it flies, both only with the UI
upside down) and the launcher (SystemUiController.cpp:765-767:
"LauncherOpenApp", "LauncherCloseApp") asked audiod for, and two tones
whose files were not released or cannot be shipped (TONES, MP3 through
ffmpeg's LAME encoder): Email's new-mail sound (DashboardManager.js:419,
com.palm.app.email/sounds/emailreceived.mp3) and the Clock's default alarm
(alarm.js:368, /media/internal/ringtones/Flurry.mp3).

    python3 tools/make-feedback-sounds.py [--out DIR] [--check]

--check regenerates in memory and fails if the files in the tree differ
(needs the same NumPy random stream, PCG64, which NumPy keeps stable). The
MP3s are checked by decoding them (ffmpeg) and comparing with the rendered
sound, so another LAME version does not fail the check.
"""

import argparse
import io
import os
import sys
import wave

import shutil
import subprocess

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


def shutter(seed):
    """A camera shutter: two clicks 70 ms apart (the curtain opening and closing)."""
    first = click(3200.0, 0.045, 0.0060, 0.70, 0.6, seed)
    second = click(2400.0, 0.060, 0.0080, 0.60, 0.7, seed + 1, drop=0.1)
    gap = int(0.070 * RATE)
    x = np.zeros(gap + len(second))
    x[:len(first)] += first
    x[gap:] += 0.85 * second
    return x


def chime(notes, step):
    """Soft bell notes one after another: a sine with a quieter octave, a
    5 ms attack and a 0.18 s decay (Phoenix's own; webOS had no assistant)."""
    length = step * (len(notes) - 1) + 0.45
    x = np.zeros(int(length * RATE))
    for i, f in enumerate(notes):
        n = int(0.45 * RATE)
        t = np.arange(n) / RATE
        tone = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)) * envelope(n, 0.005, 0.18)
        at = int(i * step * RATE)
        x[at:at + n] += tone
    return x


def sweep(f0, f1, length, curve=1.0):
    """The phase of a tone gliding from f0 to f1 Hz (curve > 1: slow, then fast)."""
    n = int(length * RATE)
    t = np.linspace(0.0, 1.0, n)
    f = f0 + (f1 - f0) * t ** curve
    return 2 * np.pi * np.cumsum(f) / RATE, t


def stretch(seed):
    """The angry card pulled down: a rubber band's creak, a buzzy tone
    rising from 140 to 330 Hz over 0.4 s, ticking 28 times a second."""
    rng = np.random.default_rng(seed)
    phase, t = sweep(140.0, 330.0, 0.40, 1.4)
    n = len(t)
    saw = 2.0 * ((phase / (2 * np.pi)) % 1.0) - 1.0
    tone = lowpass(saw, 1400.0)
    creak = 0.55 + 0.45 * np.sign(np.sin(2 * np.pi * 28.0 * t * 0.4))
    grit = highpass(lowpass(rng.standard_normal(n), 3000.0), 600.0) * 0.12
    shape = np.minimum(1.0, t * 12.0) * (1.0 - t) ** 0.6
    return (tone * creak + grit) * shape


def fling(seed):
    """The angry card let go: a whistle sliding up from 600 Hz to 2 kHz and
    falling away, with a wobble, over a rush of air (0.6 s)."""
    phase, t = sweep(600.0, 2000.0, 0.60, 0.5)
    n = len(t)
    wobble = 1.0 + 0.04 * np.sin(2 * np.pi * 11.0 * t * 0.6)
    whistle = np.sin(phase * wobble) * np.minimum(1.0, t * 20.0) * (1.0 - t) ** 1.5
    air = np.zeros(n)
    air[:int(0.35 * RATE)] = whoosh(0.35, seed)
    return 0.8 * whistle + 0.45 * air


def swish(length, seed, rising):
    """The launcher coming up (rising) or going (falling): a short breath of
    filtered noise, its brightness sliding up or down."""
    rng = np.random.default_rng(seed)
    n = int(length * RATE)
    x = rng.standard_normal(n)
    t = np.linspace(0.0, 1.0, n)
    cutoff = (500.0 + 3000.0 * t) if rising else (3500.0 - 3000.0 * t)
    y = np.empty(n)
    acc = 0.0
    for i in range(n):
        k = 1.0 - np.exp(-2.0 * np.pi * cutoff[i] / RATE)
        acc += k * (x[i] - acc)
        y[i] = acc
    y = highpass(y, 250.0)
    shape = np.sin(np.pi * t) ** (1.2 if rising else 2.0)
    return y * shape


def bell(f, length, decay, partials=((1.0, 1.0), (2.0, 0.25), (3.01, 0.08))):
    """A soft bell note: a few partials, a 4 ms attack, an exponential decay."""
    n = int(length * RATE)
    t = np.arange(n) / RATE
    x = sum(a * np.sin(2 * np.pi * f * m * t) for m, a in partials)
    return x * envelope(n, 0.004, decay)


def mail():
    """New mail: three quick bell notes up, G5 C6 E6, then a held G6 (1.2 s)."""
    notes = [(783.99, 0.00), (1046.5, 0.09), (1318.5, 0.18), (1568.0, 0.30)]
    x = np.zeros(int(1.2 * RATE))
    for f, at in notes:
        tone = bell(f, 0.9, 0.12 if at < 0.3 else 0.30)
        i = int(at * RATE)
        x[i:i + len(tone)] += tone[:len(x) - i]
    return x


def flurry():
    """The alarm: a flurry of marimba-like notes, a falling and rising
    pentatonic run in C, four bars of 1.6 s with a rest after each run, so
    the alarm can loop it (6.4 s)."""
    run = [1046.5, 880.0, 784.0, 659.3, 587.3, 523.3, 587.3, 659.3, 784.0, 880.0]
    bars = [0.0, 1.6, 3.2, 4.8]
    shifts = [1.0, 1.0, 1.122, 1.0]   # the third bar a whole tone up
    x = np.zeros(int(6.4 * RATE))
    for bar, shift in zip(bars, shifts):
        for i, f in enumerate(run):
            tone = bell(f * shift, 0.5, 0.11, partials=((1.0, 1.0), (4.0, 0.35), (9.2, 0.06)))
            at = int((bar + i * 0.1) * RATE)
            x[at:at + len(tone)] += tone[:len(x) - at]
    return x


SOUNDS = {
    # name: (make, peak level)
    "key": (lambda: click(2300.0, 0.030, 0.0045, 0.55, 0.8, 1), 0.50),
    "space": (lambda: click(1500.0, 0.040, 0.0065, 0.50, 0.9, 2), 0.50),
    "backspace": (lambda: click(1100.0, 0.035, 0.0055, 0.45, 0.9, 3, drop=0.15), 0.48),
    "return": (lambda: click(800.0, 0.070, 0.0120, 0.35, 1.0, 4, drop=0.25), 0.55),
    "appclose": (lambda: whoosh(0.26, 5), 0.35),
    # A screen capture (WindowServer::takeAndSaveScreenShot played "shutter").
    "shutter": (lambda: shutter(6), 0.55),
    # The assistant starts listening (the wake word heard, docs/AI-AND-MCP.md
    # Voice): two notes up, E6 then A6.
    "listen": (lambda: chime([1318.5, 1760.0], 0.085), 0.40),
    # The angry card, with the UI upside down (CardWindowManager.cpp:1280-1283).
    "carddrag": (lambda: stretch(7), 0.40),
    "birdappclose": (lambda: fling(8), 0.45),
    # The launcher shown and hidden (SystemUiController::setLauncherShown).
    "LauncherOpenApp": (lambda: swish(0.18, 9, True), 0.22),
    "LauncherCloseApp": (lambda: swish(0.16, 10, False), 0.20),
}

# Tones shipped as MP3, at the paths their apps name: name -> (make, peak,
# file under the repository).
TONES = {
    "emailreceived": (mail, 0.45, os.path.join(
        "compat", "rootfs", "usr", "palm", "applications", "com.palm.app.email", "sounds", "emailreceived.mp3")),
    "Flurry": (flurry, 0.50, os.path.join("shell", "assets", "sounds", "phoenix", "ringtones", "Flurry.mp3")),
}


def samples(make, peak):
    x = make()
    x = x / (np.max(np.abs(x)) or 1.0) * peak
    # 2 ms fade-out so the file ends on silence.
    f = int(0.002 * RATE)
    x[-f:] *= np.linspace(1.0, 0.0, f)
    return np.round(x * 32767).astype("<i2")


def mp3(pcm):
    """Encode 16-bit mono PCM as MP3 (LAME, 128 kbit/s, no tags)."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg (with libmp3lame) is needed for the MP3 tones")
    return subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1",
                           "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "128k", "-map_metadata", "-1",
                           "-id3v2_version", "0", "-write_id3v1", "0", "-bitexact", "-f", "mp3", "pipe:1"],
                          input=pcm.tobytes(), capture_output=True, check=True).stdout


def decoded(path):
    """An MP3 decoded back to 16-bit mono PCM at RATE."""
    out = subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path,
                          "-f", "s16le", "-ar", str(RATE), "-ac", "1", "pipe:1"], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype="<i2")


def matches(pcm, path):
    """The MP3 at path is this sound: decoded, and past the encoder's delay
    (found by correlation, under 3000 samples), it is within 2.5 % of its
    length and close to it (signal-to-noise over 20 dB)."""
    try:
        got = decoded(path).astype(float)
    except (OSError, subprocess.CalledProcessError):
        return False
    want = pcm.astype(float)
    if abs(len(got) - len(want)) > 0.025 * len(want):
        return False
    w = min(len(want), RATE)
    lag = int(np.argmax([np.dot(got[d:d + w], want[:w]) for d in range(0, 3000) if d + w <= len(got)]))
    got = got[lag:]
    n = min(len(got), len(want))
    noise = np.sum((got[:n] - want[:n]) ** 2)
    return noise == 0 or 10 * np.log10(np.sum(want[:n] ** 2) / noise) > 20.0


def render(name):
    pcm = samples(*SOUNDS[name])
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
    for name, (make, peak, rel) in TONES.items():
        pcm = samples(make, peak)
        path = os.path.join(REPO, rel)
        if args.check:
            if not matches(pcm, path):
                stale.append(path)
        else:
            data = mp3(pcm)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
            print("wrote %s (%d bytes)" % (rel, len(data)))
    if stale:
        print("out of date: " + ", ".join(os.path.relpath(p, REPO) for p in stale), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
