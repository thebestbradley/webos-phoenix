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
else
    # The curated web apps as this checkout lists them: a catalog set up
    # with an older catalog/curated-pwas.json gets the ones added since
    # (opted-out origins and apps an admin pulled stay out), then the index
    # as this version of the catalog writes it (a new build), with the
    # account types in catalog/accounts.json (a bad entry stops here).
    php bin/marketplace.php seed >/dev/null
    php bin/marketplace.php publish >/dev/null
fi
echo "Phoenix Marketplace at http://127.0.0.1:$PORT/ (catalog: /v1/, admin: /admin)"
# Several requests at once: copying an app's icon from its site the first
# time (Catalog::iconCopy) waits on that site.
export PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-4}"
exec php -S "127.0.0.1:$PORT" public/router.php
