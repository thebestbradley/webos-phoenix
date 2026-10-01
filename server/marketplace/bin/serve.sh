#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Phoenix Marketplace on this computer, where the simulator's
# Marketplace looks for it (http://127.0.0.1:8088/v1/): PHP's built-in
# server with SQLite. Sets itself up the first time.
#
#   server/marketplace/bin/serve.sh [port]

set -e
cd "$(dirname "$0")/.."
PORT="${1:-8088}"
export MARKETPLACE_BASE_URL="${MARKETPLACE_BASE_URL:-http://127.0.0.1:$PORT/v1/}"
if [ ! -f "${MARKETPLACE_DATA:-data}/signing.key" ]; then
    php bin/marketplace.php init
fi
echo "Phoenix Marketplace at http://127.0.0.1:$PORT/ (catalog: /v1/, admin: /admin)"
exec php -S "127.0.0.1:$PORT" public/router.php
