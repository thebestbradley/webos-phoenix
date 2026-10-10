#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""The system sounds as OSE's audiod plays them: a raw PCM twin beside each.

    tools/sounds-to-pcm.py DIR...            write <file>.pcm for each .mp3 and .wav
    tools/sounds-to-pcm.py --check DIR...    say which sounds lack a twin (exit 1)

audiod-pro's playSound takes a .wav or .pcm file by path
(PlaybackManager::isValidFileExtension, playbackManager.cpp:57-72) and writes
the file's bytes to PulseAudio as they are, in the sample format, rate and
channels the call names (PlaybackThread::play / playThread,
PulseAudioLink.cpp:883-960): it reads no WAV header and decodes nothing. So
every sound, MP3 or WAV, gets a twin, "<file>.pcm": signed 16-bit
little-endian, 44.1 kHz, stereo, no header, which LsmWindowSource.playSound
plays with {format: "PA_SAMPLE_S16LE", sampleRate: 44100, channels: 2}.

WAVs are read with Python's wave module (PCM, any width, rate and channels).
MP3s are decoded by mpg123 (LGPL-2.1; meta-phoenix builds mpg123-native for
this, a build tool that is not in the image), or by ffmpeg where there is no
mpg123 (a developer's computer). meta-phoenix's phoenix-apps runs this over
the image's sound directories.

Sounds added on the device later (a ringtone copied to the media partition)
have no twin: the shell plays the fallback tone instead.
"""

import argparse
import array
import os
import shutil
import subprocess
import sys
import wave

RATE = 44100
CHANNELS = 2


def to_s16(frames, width):
    """Little-endian PCM samples of any width as a list of 16-bit ints."""
    if width == 2:
        a = array.array("h")
        a.frombytes(frames)
        if sys.byteorder != "little":
            a.byteswap()
        return a.tolist()
    if width == 1:   # unsigned 8-bit
        return [(b - 128) << 8 for b in frames]
    out = []
    for i in range(0, len(frames) - width + 1, width):
        v = int.from_bytes(frames[i:i + width], "little", signed=True)
        out.append(v >> (8 * (width - 2)))
    return out


def resample(samples, channels, rate):
    """Linear resampling of interleaved samples to RATE."""
    if rate == RATE:
        return samples
    n = len(samples) // channels
    m = int(n * RATE / rate)
    out = []
    for j in range(m):
        pos = j * rate / RATE
        i = int(pos)
        f = pos - i
        for c in range(channels):
            a = samples[min(i, n - 1) * channels + c]
            b = samples[min(i + 1, n - 1) * channels + c]
            out.append(int(round(a + (b - a) * f)))
    return out


def to_stereo(samples, channels):
    if channels == 2:
        return samples
    if channels == 1:
        out = []
        for s in samples:
            out.append(s)
            out.append(s)
        return out
    # More than two: the first two (front left and right).
    out = []
    for i in range(0, len(samples), channels):
        out.extend(samples[i:i + 2])
    return out


def wav_pcm(path):
    with wave.open(path, "rb") as w:
        if w.getcomptype() != "NONE":
            raise ValueError("compressed WAV (%s)" % w.getcomptype())
        channels, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
        samples = to_s16(w.readframes(w.getnframes()), width)
    samples = to_stereo(resample(samples, channels, rate), channels)
    a = array.array("h", [max(-32768, min(32767, s)) for s in samples])
    if sys.byteorder != "little":
        a.byteswap()
    return a.tobytes()


def mp3_pcm(path):
    mpg123 = os.environ.get("MPG123") or shutil.which("mpg123")
    if mpg123:
        # -s: raw to stdout; -e s16: signed 16-bit; -r and --stereo: the
        # rate and channels (mpg123 resamples, NtoM); -q: quiet.
        cmd = [mpg123, "-q", "-s", "-e", "s16", "-r", str(RATE), "--stereo", path]
    else:
        ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("no MP3 decoder: install mpg123 (or ffmpeg)")
        cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path, "-map", "0:a:0",
               "-f", "s16le", "-acodec", "pcm_s16le", "-ar", str(RATE), "-ac", str(CHANNELS), "-"]
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE).stdout


def sounds(dirs):
    for d in dirs:
        for root, _, files in os.walk(d):
            for fn in sorted(files):
                if fn.lower().endswith((".mp3", ".wav")):
                    yield os.path.join(root, fn)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--check", action="store_true", help="only say which sounds lack a twin")
    args = ap.parse_args()
    missing = []
    n = 0
    for path in sounds(args.dirs):
        twin = path + ".pcm"
        if args.check:
            if not os.path.isfile(twin):
                missing.append(path)
            continue
        data = wav_pcm(path) if path.lower().endswith(".wav") else mp3_pcm(path)
        if len(data) % (2 * CHANNELS):
            data = data[:len(data) - len(data) % (2 * CHANNELS)]
        with open(twin, "wb") as f:
            f.write(data)
        n += 1
    if args.check:
        for m in missing:
            print("no twin: " + m)
        return 1 if missing else 0
    print("sounds-to-pcm: %d sounds" % n, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
