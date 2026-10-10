#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests tools/sounds-to-pcm.py: WAVs of every shape become 16-bit 44.1 kHz
stereo without a header; the shipped sounds (shell/assets/sounds, MP3s too
when mpg123 or ffmpeg is there) all get a twin of the right length.

    python3 tools/test-sounds-pcm.py
"""

import array
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("s2p", os.path.join(HERE, "sounds-to-pcm.py"))
s2p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s2p)

failures = 0


def check(cond, what):
    global failures
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        failures += 1


def write_wav(path, channels, width, rate, samples):
    with wave.open(path, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        if width == 1:
            w.writeframes(bytes(samples))
        else:
            w.writeframes(b"".join(int(s).to_bytes(width, "little", signed=True) for s in samples))


def pcm(path):
    a = array.array("h")
    with open(path, "rb") as f:
        a.frombytes(f.read())
    if sys.byteorder != "little":
        a.byteswap()
    return a.tolist()


with tempfile.TemporaryDirectory() as d:
    write_wav(os.path.join(d, "stereo.wav"), 2, 2, 44100, [1000, -1000, 2000, -2000])
    write_wav(os.path.join(d, "mono.wav"), 1, 2, 44100, [5, 6, 7])
    write_wav(os.path.join(d, "u8.wav"), 1, 1, 44100, [128, 255, 0])
    write_wav(os.path.join(d, "half.wav"), 1, 2, 22050, [0, 100])
    write_wav(os.path.join(d, "s24.wav"), 2, 3, 44100, [0x123456, -0x123456])
    os.makedirs(os.path.join(d, "sub dir"))
    write_wav(os.path.join(d, "sub dir", "x.wav"), 1, 2, 44100, [1])
    rc = subprocess.run([sys.executable, os.path.join(HERE, "sounds-to-pcm.py"), "--check", d]).returncode
    check(rc == 1, "--check: sounds without a twin fail")
    subprocess.run([sys.executable, os.path.join(HERE, "sounds-to-pcm.py"), d], check=True)
    check(pcm(os.path.join(d, "stereo.wav.pcm")) == [1000, -1000, 2000, -2000], "16-bit stereo 44.1 kHz: the samples as they are")
    check(pcm(os.path.join(d, "mono.wav.pcm")) == [5, 5, 6, 6, 7, 7], "mono: each sample on both channels")
    check(pcm(os.path.join(d, "u8.wav.pcm")) == [0, 0, 127 << 8, 127 << 8, -128 << 8, -128 << 8], "8-bit unsigned: to signed 16-bit")
    check(pcm(os.path.join(d, "half.wav.pcm")) == [0, 0, 50, 50, 100, 100, 100, 100], "22.05 kHz: resampled to 44.1 kHz")
    check(pcm(os.path.join(d, "s24.wav.pcm")) == [0x1234, -0x1235], "24-bit: the top 16 bits")
    check(os.path.isfile(os.path.join(d, "sub dir", "x.wav.pcm")), "names with spaces, in subdirectories")
    rc = subprocess.run([sys.executable, os.path.join(HERE, "sounds-to-pcm.py"), "--check", d]).returncode
    check(rc == 0, "--check: all twinned")

    # The sounds the image ships.
    sounds = os.path.join(HERE, "..", "shell", "assets", "sounds")
    shutil.copytree(sounds, os.path.join(d, "shipped"))
    decoder = shutil.which("mpg123") or shutil.which("ffmpeg")
    if not decoder:
        for root, _, files in os.walk(os.path.join(d, "shipped")):
            for fn in files:
                if fn.lower().endswith(".mp3"):
                    os.remove(os.path.join(root, fn))
        print("(no mpg123 or ffmpeg: the MP3s are left out)")
    subprocess.run([sys.executable, os.path.join(HERE, "sounds-to-pcm.py"), os.path.join(d, "shipped")], check=True)
    for root, _, files in os.walk(os.path.join(d, "shipped")):
        for fn in sorted(files):
            p = os.path.join(root, fn)
            if fn.endswith(".wav"):
                with wave.open(p) as w:
                    want = w.getnframes() * 4
                check(os.path.getsize(p + ".pcm") == want, "shipped %s: as many frames" % fn)
            elif fn.endswith(".mp3"):
                check(os.path.getsize(p + ".pcm") > 4410 * 4, "shipped %s: decoded" % fn)

print("%d failed" % failures if failures else "all passed")
sys.exit(1 if failures else 0)
