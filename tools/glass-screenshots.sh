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
#                     front, three notifications waiting under the dock
#                     (cards-dark.jpg)
#   cards-light.png   the same, the light one in front (cards-light.jpg)
#   cards-classic.png cards-dark in 1.0's look
#   banner.png        a notification's banner over a maximized app
#   dashboard.png     the dashboard open over it, three notifications
#   stacks.png        the dashboard with two stacks of texts and a reminder
#   drawer.png        the dashboard pulled to the whole screen, a download
#                     on top
#   systemmenu.png    the system menu over the card view
#   systemmenu-wifi.png  its Wi-Fi drawer open
#   systemmenu-classic.png  the system menu in 1.0's look
#   launcher.png, launcher-classic.png  the launcher in both looks
#   launcher-edit.png the launcher in edit mode
#   launcher-menu.png an icon's menu
#   launcher-group.png  a group open
#
# Each run in a fresh home; the glass pages are installed for the run only.
#
#   tools/glass-screenshots.sh OUT_DIR [phoenix-sim] [qml dir] [repo dir]
#
# Without a display it runs under xvfb-run. PHOENIX_SHOT_DELAY (ms, default
# 40000): how long the apps get to load before each screenshot. SHOTS="a b":
# only those screenshots.

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
    # SHOTS="a b": only those.
    case " ${SHOTS:-$name} " in *" $name "*) ;; *) return 0 ;; esac
    home=$work/home-$name
    mkdir -p "$home"
    set -- "$sim" --qml-dir "$qml" --repo-dir "$repo" --size 1116x2484 --scale 2.5 --phone --no-marketplace \
        --installed-dir "$work/installed" --screenshot "$out/$name.png" --delay "${DELAY:-$delay}" "$@"
    if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null; then
        set -- xvfb-run -a -s "-screen 0 1500x2700x24" "$@"
    fi
    HOME=$home QTWEBENGINE_DISABLE_SANDBOX=1 "$@" >"$work/$name.log" 2>&1 || { tail -20 "$work/$name.log"; exit 1; }
    rm -rf "$home"
    echo "$out/$name.png"
}

shot app-dark --launch org.webosphoenix.glasstest -- --look ember-glass
shot app-light --launch org.webosphoenix.glasstest.light -- --look ember-glass
shot cards-dark --scene cardsnotified --launch org.webosphoenix.glasstest --launch org.webosphoenix.glasstest2 \
    --launch org.webosphoenix.glasstest3 -- --look ember-glass
# (In this launch order the light page's card is the middle one.)
shot cards-light --scene cardsnotified --launch org.webosphoenix.glasstest --launch org.webosphoenix.glasstest3 \
    --launch org.webosphoenix.glasstest2 -- --look ember-glass
shot cards-classic --scene cardsnotified --launch org.webosphoenix.glasstest --launch org.webosphoenix.glasstest2 \
    --launch org.webosphoenix.glasstest3
# The banner shows for 6 s from the start (its slide and 5 s).
DELAY=3500 shot banner --scene banner -- --look ember-glass
DELAY=6000 shot dashboard --scene dashboard -- --look ember-glass
DELAY=6000 shot stacks --scene notifystacks -- --look ember-glass
DELAY=6000 shot drawer --scene drawer -- --look ember-glass
DELAY=6000 shot systemmenu --scene systemmenu -- --look ember-glass
DELAY=8000 shot systemmenu-wifi --scene systemmenuwifi -- --look ember-glass
DELAY=6000 shot systemmenu-classic --scene systemmenu
DELAY=6000 shot launcher --scene launcher -- --look ember-glass
DELAY=6000 shot launcher-classic --scene launcher
DELAY=6000 shot launcher-edit --scene launcheredit -- --look ember-glass
DELAY=7000 shot launcher-menu --scene launchermenu -- --look ember-glass
DELAY=7000 shot launcher-group --scene launchergroupopen -- --look ember-glass
