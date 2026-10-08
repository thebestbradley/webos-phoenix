#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The recordings the voice tests play (services/wakeword/tests/data): speech
# made by espeak-ng (run as a program; its output is not covered by its
# GPL) at 16 kHz mono 16-bit, with half a second of quiet before and a
# second after. Run again to remake them; the tests expect these words.
#
#   tools/gen-voice-fixtures.sh
set -e
out="$(dirname "$0")/../services/wakeword/tests/data"
mkdir -p "$out"
say() {   # file voice words...
    f="$1"; v="$2"; shift 2
    espeak-ng -v "$v" -s 150 --stdout "$*" |
        ffmpeg -loglevel error -y -i - -af "adelay=500,apad=pad_dur=1" -ar 16000 -ac 1 -c:a pcm_s16le -fflags +bitexact -flags:a +bitexact "$out/$f.wav"
}
# Heard: the phrase in three voices, and with a request in one breath.
say hey-phoenix en-us "Hey Phoenix"
say hey-phoenix-f en-us+f2 "Hey Phoenix"
say hey-phoenix-gb en-gb-x-rp+m3 "Hey Phoenix"
say hey-phoenix-timer en-us "Hey Phoenix, set a timer for ten minutes"
# Not heard: things that sound like it, and other talk.
say hey-felix en-us "Hey Felix"
say hey-phoebe en-us+f2 "Hey Phoebe"
say flew-to-phoenix en-us "I flew to Phoenix last week"
say talk en-gb-x-rp "Shall we meet for lunch on Thursday at the usual place"
# Requests and answers after the phrase.
say weather en-us "What's the weather"
say text-sam en-us "Text Sam I'm running late"
say yes en-us "Yes"
say no en-us "No"
