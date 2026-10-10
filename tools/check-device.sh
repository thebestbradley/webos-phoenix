#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Every device-readiness checker, with a summary: what a device image would
# trip on that the simulator hides (docs/PRE-IMAGE-CHECKLIST.md, "Checkers").
#
#   tools/check-device.sh [--all] [--strict] [--parse [MACHINE...]]
#   ./phoenix check-device [...]           the same
#
#   --all      also list the known findings (tools/check-device-allowlist.json)
#   --strict   also fail on allowlist entries nothing matches any more
#   --parse    also run scripts/parse-check.sh (bitbake parse and dry run;
#              clones build-webos and its layers, ~200 MB plus ~300 MB per
#              machine, ~12 min each; not as root)
#
# A finding not in the allowlist fails (exit 1). Each allowlist entry names
# its owner and the checklist row that tracks it. The checkers' own tests:
# python3 tools/test-devicecheck.py.

set -u
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
ARGS=""
PARSE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --all|--strict) ARGS="$ARGS $1" ;;
        --parse) PARSE=1; shift; break ;;
        -h|--help) sed -n '4,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "check-device: unknown option $1" >&2; exit 2 ;;
    esac
    shift
done

failed=""
summary=""
for c in luna simrefs image recipes licences; do
    echo "=== $c"
    # shellcheck disable=SC2086
    out=$(python3 "$REPO_DIR/tools/check-$c.py" $ARGS 2>&1)
    status=$?
    printf '%s\n' "$out"
    line=$(printf '%s\n' "$out" | tail -n 1)
    [ $status -eq 0 ] || failed="$failed $c"
    summary="$summary$(printf '  %-9s %s' "$c" "$([ $status -eq 0 ] && echo ok || echo FAILED)"): ${line#*: }
"
done

if [ -n "$PARSE" ]; then
    echo "=== parse (scripts/parse-check.sh $*)"
    if "$REPO_DIR/scripts/parse-check.sh" "$@"; then
        summary="$summary  parse     ok
"
    else
        failed="$failed parse"
        summary="$summary  parse     FAILED
"
    fi
fi

echo
echo "Device readiness (docs/PRE-IMAGE-CHECKLIST.md):"
printf '%s' "$summary"
if [ -n "$failed" ]; then
    echo "New findings in:$failed. Fix them, or add each to tools/check-device-allowlist.json with its owner and checklist row."
    exit 1
fi
