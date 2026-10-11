#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Screenshots of the shell in Ember Glass (docs/SYSTEM-UI-2.md) on the
# Fairphone 6's screen (1116 x 2484 at 2.5: the mock-ups' 446 x 994 CSS px),
# to set beside the renders in docs/design-2.0/img/ember-glass/:
#
#   app-dark.png      a glass page (tools/fixtures/glass-app) maximized, dark
#   app-light.png     the same, light
#   cards-dark.png    three glass pages' cards in the card view, a dark one in
#                     front (cards-dark.jpg)
#   cards-light.png   the same, the light one in front (cards-light.jpg)
#   cards-classic.png cards-dark in 1.0's look
#
# Each run in a fresh home; the glass pages are installed for the run only.
#
#   tools/glass-screenshots.sh OUT_DIR [phoenix-sim] [qml dir] [repo dir]
#
# Without a display it runs under xvfb-run. PHOENIX_SHOT_DELAY (ms, default
# 40000): how long the apps get to load before each screenshot.

set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
out=${1:?OUT_DIR}
sim=${2:-$here/build/phoenix-sim}
qml=${3:-$here/shell/qml}
repo=${4:-$here}
delay=${PHOENIX_SHOT_DELAY:-40000}
mkdir -p "$out"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
apps=$work/installed/usr/palm/applications
mkdir -p "$apps"
ln -s "$here/tools/fixtures/glass-app" "$apps/org.webosphoenix.glasstest"
# Two more glass pages: the same page, another title (and theme).
page() {
    mkdir -p "$apps/$1"
    ln -s "$here/tools/fixtures/glass-app/index.html" "$apps/$1/index.html"
    printf '{ "id": "%s", "version": "1.0.0", "vendor": "webOS Phoenix", "type": "web", "title": "%s", "main": "index.html?%s" }\n' \
        "$1" "$2" "$3" > "$apps/$1/appinfo.json"
}
page org.webosphoenix.glasstest2 "Glass light" "theme=light&title=Messages"
page org.webosphoenix.glasstest3 "Glass three" "title=Music"

shot() {
    name=$1; shift
    home=$work/home-$name
    mkdir -p "$home"
    set -- "$sim" --qml-dir "$qml" --repo-dir "$repo" --size 1116x2484 --scale 2.5 --phone --no-marketplace \
        --installed-dir "$work/installed" --screenshot "$out/$name.png" --delay "$delay" "$@"
    if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null; then
        set -- xvfb-run -a -s "-screen 0 1500x2700x24" "$@"
    fi
    HOME=$home QTWEBENGINE_DISABLE_SANDBOX=1 "$@" >"$work/$name.log" 2>&1 || { tail -20 "$work/$name.log"; exit 1; }
    rm -rf "$home"
    echo "$out/$name.png"
}

shot app-dark --launch org.webosphoenix.glasstest -- --look ember-glass
shot app-light --launch org.webosphoenix.glasstest.light -- --look ember-glass
shot cards-dark --scene cards --launch org.webosphoenix.glasstest --launch org.webosphoenix.glasstest2 \
    --launch org.webosphoenix.glasstest3 -- --look ember-glass
# (In this launch order the light page's card is the middle one.)
shot cards-light --scene cards --launch org.webosphoenix.glasstest --launch org.webosphoenix.glasstest3 \
    --launch org.webosphoenix.glasstest2 -- --look ember-glass
shot cards-classic --scene cards --launch org.webosphoenix.glasstest --launch org.webosphoenix.glasstest2 \
    --launch org.webosphoenix.glasstest3
