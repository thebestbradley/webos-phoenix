#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The quick checks: everything CI checks that needs neither the simulator
# nor the apps built, in about five minutes. Generated docs and art against
# their sources, lockfiles, launch contracts, the web tests' list, the
# Python, PHP and ./phoenix tests, the apps' typecheck and unit tests. CI's
# first job ("checks", .github/workflows/ci.yml) runs this, so a slip shows
# in minutes, not at the end of the long jobs; ./phoenix test --quick runs
# it. (The device-readiness checkers look at the built apps: CI runs them
# in its "apps" job; here, ./phoenix check-device after a build.)
#
#   tools/ci-checks.sh                 every check, then a summary
#   tools/ci-checks.sh ID...           only these (--list names them)
#   tools/ci-checks.sh --fail-fast     stop at the first failure
#   tools/ci-checks.sh --list          the checks, without running them
#
# Every check runs even when one before it failed, and the summary gives
# each one's result and time: one run finds every slip, rather than one per
# push and wait. The cheap checks come first, so their output is there
# within a minute or two; the apps' typecheck and unit tests (most of the
# time) come last. In GitHub Actions a failed check is also an annotation.
#
# Needs: Node.js 22 and apps/node_modules (cd apps && npm ci); Python 3
# with Pillow, NumPy, Radicale and WsgiDAV; PHP 8 with sodium and
# pdo_sqlite; ffmpeg. ./phoenix --tests installs them (on a Mac, the Python
# packages go into .venv: source .venv/bin/activate first).

set -u
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_DIR" || exit 2

MODE=run
FAIL_FAST=0
ONLY=""
while [ $# -gt 0 ]; do
    case "$1" in
        --list) MODE=list ;;
        --fail-fast) FAIL_FAST=1 ;;
        -h|--help) sed -n '5,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*) echo "ci-checks: unknown option $1 (tools/ci-checks.sh --help)" >&2; exit 2 ;;
        *) ONLY="$ONLY $1" ;;
    esac
    shift
done

START=$(date +%s)
KNOWN=""        # every check's id
RAN=0
FAILED=""       # the ids of the checks that failed
SUMMARY=""
STOP=0

# check ID TITLE [--needs PROGRAM[,PROGRAM]] COMMAND...: one check. The
# command runs in a subshell from the repository's root; a program it
# needs that is not installed fails it with that said.
check() {
    id=$1
    title=$2
    shift 2
    KNOWN="$KNOWN $id"
    needs=""
    if [ "${1:-}" = --needs ]; then
        needs=$2
        shift 2
    fi
    case $MODE in
        collect) return 0 ;;
        list) printf '  %-18s %s\n' "$id" "$title"; return 0 ;;
    esac
    if [ -n "$ONLY" ]; then
        case " $ONLY " in *" $id "*) ;; *) return 0 ;; esac
    fi
    [ $STOP = 0 ] || return 0
    RAN=$((RAN + 1))
    printf '\n==> %s: %s\n' "$id" "$title"
    t0=$(date +%s)
    missing=""
    for p in $(echo "$needs" | tr ',' ' '); do
        command -v "$p" >/dev/null 2>&1 || missing="$missing $p"
    done
    if [ -n "$missing" ]; then
        echo "ci-checks: $id needs$missing, which is not installed (./phoenix --tests installs the test tools)"
        status=127
    else
        ( "$@" )
        status=$?
    fi
    secs=$(($(date +%s) - t0))
    if [ $status = 0 ]; then
        result=ok
    else
        result=FAILED
        FAILED="$FAILED $id"
        if [ "${GITHUB_ACTIONS:-}" = true ]; then
            echo "::error title=Check failed::$id: $title (tools/ci-checks.sh $id)"
        fi
        [ $FAIL_FAST = 0 ] || STOP=1
    fi
    printf -- '--- %-6s %4ss  %s\n' "$result" "$secs" "$id"
    SUMMARY="$SUMMARY$(printf '  %-6s %4ss  %-18s %s' "$result" "$secs" "$id" "$title")
"
}

# ---- Checks made of more than one command -------------------------------------------

# Every platform's native packages in the locks, or npm ci fails on Macs
# (tools/check-lockfile.cjs): the apps' and the Enact demos'.
lockfiles() {
    node tools/check-lockfile.cjs &&
        node tools/check-lockfile.cjs apps/enact-notes-limestone/package-lock.json &&
        node tools/check-lockfile.cjs apps/enact-notes-agate/package-lock.json
}

# The device services (Node.js, not bundled): their syntax. Their own
# tests are among the unit tests (vitest; the DAV service's against Radicale).
services_syntax() {
    for f in apps/files/service/*.js apps/voicememos/service/*.js apps/dav/service/*.js apps/dav/service/lib/*.js \
             apps/settings/service/*.js apps/settings/service/lib/*.js \
             apps/marketplace/service/*.js apps/marketplace/service/lib/*.js \
             services/updates/*.js services/updates/lib/*.js; do
        node --check "$f" || return 1
    done
}

apps_typecheck() { cd apps && npm run typecheck; }
apps_unit_tests() { cd apps && npm test; }

# ---- The checks, cheapest first -------------------------------------------------------

checks() {
    check commands-doc "docs/COMMANDS.md matches tools/commands-doc.py" python3 tools/commands-doc.py --check
    check release-notes "docs/RELEASE-NOTES.md matches the release notes (tools/release-notes-doc.py)" python3 tools/release-notes-doc.py --check
    check debrand "Trademark overlays up to date" python3 tools/debrand-overlays.py --check
    check launch-contracts "App-to-app launches send what their apps read (docs/LAUNCH-CONTRACTS.md)" node tools/check-launch-contracts.cjs
    check web-tests "CI's web test shards run tools/web-tests.txt, each test once" node tools/check-web-tests.cjs
    check lockfiles "The lockfiles have every platform's packages" lockfiles
    check assistant-bird "The Assistant's bird matches its source (art/assistant-bird/bird.json)" python3 tools/gen-assistant-bird.py --check
    check app-icons "App icons match their SVG sources" node tools/render-app-icons.cjs --check
    check original-icons "The originals' 512 px icons are present" python3 tools/upscale-app-icons.py --check
    check hidpi-art "HiDPI art present and true to its 1x art" python3 tools/hidpi-art.py --check
    check keyboard-charcoal "The keyboard's charcoal art matches its source" python3 tools/keyboard-charcoal.py --check
    check feedback-sounds "Feedback sounds and tones match their generator" --needs ffmpeg python3 tools/make-feedback-sounds.py --check
    check sounds-pcm "The system sounds as audiod plays them (raw PCM twins)" python3 tools/test-sounds-pcm.py
    check runtime-device "The runtime on a device (window properties, Back, the launch's caller, copies)" node tools/test-runtime-device.cjs
    check device-firmware "Firmware joined and put into an image (tools/device-firmware.py)" python3 tools/test-device-firmware.py
    check device-profiles "The device profiles: their device.json files, the VM's choice at boot" python3 tools/test-device-profiles.py
    check wam-user-agent "The device's web app user agent (WebAppMgr's conf.sh)" python3 tools/test-wam-user-agent.py
    check make-utm "UTM bundles (scripts/make-utm.sh, tools/check-utm-bundle.py)" python3 tools/test-make-utm.py
    check php-marketplace "Marketplace catalog service (PHP)" --needs php php server/marketplace/tests/run.php
    check php-updates "Update feed publisher (server/updates, PHP)" --needs php php server/updates/tests/run.php
    check phoenix-script "The one command (./phoenix), in its dry runs on a pretend Linux and Mac" sh tools/test-phoenix-script.sh
    check services-syntax "The device services' JavaScript parses (node --check)" services_syntax
    check typecheck "Web apps (React + TypeScript): typecheck" apps_typecheck
    check unit-tests "Web apps: unit tests (vitest)" apps_unit_tests
}

# ---- Running them --------------------------------------------------------------------

if [ $MODE = list ]; then
    checks
    exit 0
fi
# The ids asked for, before anything runs.
MODE=collect
checks
for id in $ONLY; do
    case " $KNOWN " in
        *" $id "*) ;;
        *) echo "ci-checks: no check called $id (tools/ci-checks.sh --list)" >&2; exit 2 ;;
    esac
done
MODE=run
checks

# ---- Summary -----------------------------------------------------------------------------

total=$(($(date +%s) - START))
count=$(echo "$FAILED" | wc -w | tr -d ' ')
printf '\n== Summary: %s checks in %sm %ss\n%s' "$RAN" $((total / 60)) $((total % 60)) "$SUMMARY"
if [ "$count" != 0 ]; then
    [ $STOP = 0 ] || echo "Stopped at the first failure (--fail-fast)."
    echo "$count failed:$FAILED (again, alone: tools/ci-checks.sh ID)"
    exit 1
fi
echo "All passed."
