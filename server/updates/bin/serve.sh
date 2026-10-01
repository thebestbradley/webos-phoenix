#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The update feed on this computer, where the simulator looks for it
# (http://127.0.0.1:8089/, /etc/palm/updates.json): PHP's built-in server
# over data/feed (or $UPDATES_FEED).
#
#   server/updates/bin/serve.sh [port]

set -e
cd "$(dirname "$0")/.."
PORT="${1:-8089}"
FEED="${UPDATES_FEED:-data/feed}"
mkdir -p "$FEED"
echo "Phoenix update feed at http://127.0.0.1:$PORT/ ($FEED)"
exec php -S "127.0.0.1:$PORT" -t "$FEED"
