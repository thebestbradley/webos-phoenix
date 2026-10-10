#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Phoenix Marketplace on this computer, where the simulator's
# Marketplace looks for it (http://127.0.0.1:8088/v1/): PHP's built-in
# server with SQLite. Sets itself up the first time.
#
# A development catalog (MARKETPLACE_DEV=1 unless set otherwise): a
# developer's upload (`phoenix-connector publish --local`, `bin/marketplace.php
# upload`) is approved and published at once, as data/developer.token's
# local developer; the News Feed example connector is published once, so
# Connections lists a third-party connector from the start, and so are the
# connector packages Phoenix comes with (apps/marketplace/service/etc/palm/
# marketplace/preinstalled.json: the Fediverse), as Phoenix's own, so the
# simulator can install one again after removing it.
#
#   server/marketplace/bin/serve.sh [port]

set -e
cd "$(dirname "$0")/.."
PORT="${1:-8088}"
export MARKETPLACE_BASE_URL="${MARKETPLACE_BASE_URL:-http://127.0.0.1:$PORT/v1/}"
export MARKETPLACE_DEV="${MARKETPLACE_DEV:-1}"
DATA="${MARKETPLACE_DATA:-data}"
if [ ! -f "$DATA/signing.key" ]; then
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
if [ "$MARKETPLACE_DEV" = 1 ]; then
    # The local developer's token (data/developer.token), for publish --local.
    php bin/marketplace.php developer >/dev/null
    # The example connector (apps/shared/connector-kit/examples/feeds) and
    # Phoenix's own pre-installed ones, once per catalog: packed with the
    # connector kit (the build builds it), then uploaded (the example as the
    # local developer, Phoenix's as its admin). Without the kit, the next
    # start tries again.
    KIT=../../apps/shared/connector-kit
    if [ ! -f "$DATA/seed/done" ]; then
        if command -v node >/dev/null 2>&1 && [ -f "$KIT/lib/tools/cli.js" ]; then
            rm -rf "$DATA/seed"
            mkdir -p "$DATA/seed/example" "$DATA/seed/phoenix"
            if node "$KIT/bin/phoenix-connector.cjs" pack "$KIT/examples/feeds" --out "$DATA/seed/example" >/dev/null; then
                for ipk in "$DATA"/seed/example/*.ipk; do
                    php bin/marketplace.php upload "$ipk" || true
                done
                for from in $(php -r 'foreach (json_decode(file_get_contents("../../apps/marketplace/service/etc/palm/marketplace/preinstalled.json"), true)["packages"] as $p) echo $p["from"], "\n";'); do
                    node "$KIT/bin/phoenix-connector.cjs" pack "../../$from" --out "$DATA/seed/phoenix" \
                        --namespace org.webosphoenix --namespace com.webosphoenix >/dev/null || true
                done
                for ipk in "$DATA"/seed/phoenix/*.ipk; do
                    [ -f "$ipk" ] && { php bin/marketplace.php upload --phoenix "$ipk" || true; }
                done
                touch "$DATA/seed/done"
            fi
        else
            echo "The example connector is not published yet: the connector kit is not built (cd apps && npm run build -w @phoenix/connector-kit)"
        fi
    fi
fi
echo "Phoenix Marketplace at http://127.0.0.1:$PORT/ (catalog: /v1/, admin: /admin)"
# Several requests at once: copying an app's icon from its site the first
# time (Catalog::iconCopy) waits on that site.
export PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-4}"
exec php -S "127.0.0.1:$PORT" public/router.php
