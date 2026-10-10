# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# mpg123-native: phoenix-apps decodes the system sounds' MP3s with it at build
# time into the raw PCM OSE's audiod plays (tools/sounds-to-pcm.py). A build
# tool only: nothing of it goes into the image. OE-core's recipe has no
# native variant; the native one needs no sound output (it writes to stdout).

BBCLASSEXTEND = "native"
PACKAGECONFIG:class-native = ""
AUDIOMODS:class-native = "dummy"
