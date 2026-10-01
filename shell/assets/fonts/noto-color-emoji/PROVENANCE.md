# Provenance

Noto Color Emoji 2.047 (Emoji 15.1), copyright 2013-2017 Google Inc. and
Arjen Nienhuis, SIL Open Font License 1.1 (`OFL.txt`). Copied unmodified
from the Ubuntu package `fonts-noto-color-emoji` 2.047-0ubuntu0.24.04.1
(upstream <https://github.com/googlefonts/noto-emoji>): `NotoColorEmoji.ttf`
(colour bitmaps, CBDT/CBLC).

It is the colour emoji font after Prelude (or Open Sans) everywhere text is
drawn: the shell loads it, and the web runtime finds it through fontconfig
(installed into `/usr/share/fonts` on a device, added to fontconfig's
directories by phoenix-sim on Linux). The keyboard's emoji list
(`shell/qml/Phoenix/Shell/EmojiData.js`, `tools/gen-emoji-data.py`) is the
same Emoji version. See `docs/LEGAL.md`.
