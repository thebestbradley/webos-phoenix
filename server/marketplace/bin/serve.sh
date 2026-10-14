#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Phoenix Marketplace on this computer, where the simulator's
# Marketplace looks for it (http://127.0.0.1:8088/v1/): PHP's built-in
# server with SQLite. Sets itself up the first time.
#
# One catalog per user, shared by every checkout and every simulator
# (docs/APP-STORE.md 3.16): its folder is outside the checkouts, on a Mac
# ~/Library/Application Support/Phoenix/catalog, elsewhere
# $XDG_DATA_HOME/phoenix/catalog (~/.local/share/phoenix/catalog), or
# MARKETPLACE_DATA. The first start imports this checkout's old
# server/marketplace/data when the folder has no catalog yet (that folder is
# left as it was).
#
# A development catalog (MARKETPLACE_DEV=1 unless set otherwise): a
# developer's upload (`phoenix-connector publish --local`, `bin/marketplace.php
# upload`) is approved and published at once, as the folder's developer.token's
# local developer; the News Feed example connector is published once, so
# Connections lists a third-party connector from the start, and so are the
# connector packages Phoenix comes with (apps/marketplace/service/etc/palm/
# marketplace/preinstalled.json: the Fediverse), as Phoenix's own, so the
# simulator can install one again after removing it, and Phoenix's own that
# are installed from the catalog (that file's "firstParty": the drives,
# Jabber, Matrix, Delta Chat).
#
# Then it fills itself, in the background: `bin/web-apps.py fill` publishes
# the open-source web apps (catalog/web-apps.json; the network) and the 2.0
# apps of a built phoenix-default-apps checkout, when what it can publish
# changed since the last fill (--no-fill: not this time).
#
#   server/marketplace/bin/serve.sh [port] [--no-fill]
#
# Run by hand it serves until stopped. Started by a simulator
# (PHOENIX_SIM_INSTANCES: the folder the simulators list themselves in,
# shell/sim/siminstances.h), it sets the catalog up, leaves PHP's server
# running under a watch of its own and returns: the server goes on while any
# simulator runs, whichever started it, and stops a few seconds
# (PHOENIX_CATALOG_GRACE, 5) after the last one is gone, quit or crashed.
# While it runs, server.json in the folder says so: {pid (the watch, or the
# server run by hand), port, checkout, started}.

set -e
cd "$(dirname "$0")/.."
SELF="$(pwd)/bin/serve.sh"
CHECKOUT="$(cd ../.. && pwd)"
PORT=8088
FILL=1
WATCH=0
for a in "$@"; do
    case "$a" in
        --no-fill) FILL=0 ;;
        --watch) WATCH=1 ;;
        --*) echo "serve.sh: unknown option $a (serve.sh [port] [--no-fill])" >&2; exit 2 ;;
        *) PORT="$a" ;;
    esac
done
export MARKETPLACE_BASE_URL="${MARKETPLACE_BASE_URL:-http://127.0.0.1:$PORT/v1/}"
export MARKETPLACE_DEV="${MARKETPLACE_DEV:-1}"
if [ -z "$MARKETPLACE_DATA" ]; then
    case "$(uname -s)" in
        Darwin) MARKETPLACE_DATA="$HOME/Library/Application Support/Phoenix/catalog" ;;
        *) MARKETPLACE_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/phoenix/catalog" ;;
    esac
fi
export MARKETPLACE_DATA
DATA="$MARKETPLACE_DATA"
# Several requests at once: copying an app's icon from its site the first
# time (Catalog::iconCopy) waits on that site.
export PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-4}"

# A text as a JSON string's inside.
json_text() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# server.json: this catalog is running, from this folder (pid: who to stop).
write_server_json() {
    printf '{"format":1,"pid":%s,"port":%s,"checkout":"%s","started":"%s"}\n' "$1" "$PORT" \
        "$(json_text "$CHECKOUT")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DATA/server.json.new"
    mv -f "$DATA/server.json.new" "$DATA/server.json"
}

# The fill (bin/web-apps.py fill): what changed since the last fill that worked.
fill() {
    [ "$FILL" = 1 ] || return 0
    if command -v python3 >/dev/null 2>&1; then
        python3 -I bin/web-apps.py fill || true
    else
        echo "fill: the open-source web apps and the 2.0 apps are not published: python3 is needed"
    fi
}

# Whether a simulator is running: one listed in the simulators' folder whose
# process is alive and is the program it says it is ("exe", else phoenix-sim:
# simulators of older builds do not say), so a crashed one's entry, its
# process id now another program's, does not count, nor one that crashed
# and whose parent has not collected it yet (a zombie, state Z, which
# kill -0 still finds). The kernel keeps 15 letters of a program's name
# (Linux); a Mac's ps gives its path.
simulator_running() {
    for f in "$PHOENIX_SIM_INSTANCES"/phoenix-sim*.json; do
        [ -f "$f" ] || continue
        pid=$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$f")
        [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || continue
        exe=$(sed -n 's/.*"exe":"\([^"]*\)".*/\1/p' "$f")
        [ -n "$exe" ] || exe=phoenix-sim
        command -v ps >/dev/null 2>&1 || return 0
        st=$(ps -o stat= -p "$pid" 2>/dev/null) || continue
        case "$st" in
            *Z*) continue ;;
        esac
        comm=$(ps -o comm= -p "$pid" 2>/dev/null) || continue
        comm=${comm##*/}
        case "$comm" in
            "$(printf '%.15s' "$exe")"*) return 0 ;;
        esac
    done
    return 1
}

# The watch (serve.sh --watch, started below): PHP's server, kept while a
# simulator runs. Terminal signals are not its: a simulator's Ctrl+C or a
# closed terminal leaves the catalog to the others.
if [ "$WATCH" = 1 ]; then
    trap '' HUP INT
    # Said before it answers: a simulator finding it answering knows it is this folder's.
    write_server_json $$
    php -S "127.0.0.1:$PORT" public/router.php </dev/null &
    PHP=$!
    trap 'kill "$PHP" 2>/dev/null || true; wait "$PHP" 2>/dev/null || true; rm -f "$DATA/server.json"; echo "The catalog stopped (asked to)"; exit 0' TERM
    fill </dev/null &
    GRACE="${PHOENIX_CATALOG_GRACE:-5}"
    idle=0
    while kill -0 "$PHP" 2>/dev/null; do
        sleep 1
        if simulator_running; then
            idle=0
        else
            idle=$((idle + 1))
            if [ "$idle" -ge "$GRACE" ]; then
                echo "No simulator is running any more: the catalog stops"
                kill "$PHP" 2>/dev/null || true
                wait "$PHP" 2>/dev/null || true
                rm -f "$DATA/server.json"
                exit 0
            fi
        fi
    done
    code=0
    wait "$PHP" || code=$?
    rm -f "$DATA/server.json"
    echo "PHP's server stopped (exit code $code)"
    exit "$code"
fi

mkdir -p "$DATA"
# The first start after the catalog moved out of the checkouts: this
# checkout's catalog, its key and everything it published, so devices that
# trusted it go on trusting it.
if [ ! -f "$DATA/signing.key" ] && [ -f data/signing.key ] && [ "$(cd data && pwd -P)" != "$(cd "$DATA" && pwd -P)" ]; then
    cp -Rp data/. "$DATA/"
    rm -f "$DATA/server.json"
    echo "Imported the catalog of $(pwd)/data into $DATA (that folder is left as it was)"
fi
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
    # The local developer's token (developer.token), for publish --local.
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
    # Phoenix's own connectors in the catalog that it does not come with
    # (preinstalled.json "firstParty": the drives, Jabber, Matrix, Delta Chat), once per
    # catalog, as its admin; a catalog seeded before them gets them now.
    if [ -f "$DATA/seed/done" ] && [ ! -f "$DATA/seed/catalog-connectors.done" ] && [ -f "$KIT/lib/tools/cli.js" ]; then
        rm -rf "$DATA/seed/catalog"
        mkdir -p "$DATA/seed/catalog"
        for from in $(php -r 'foreach (json_decode(file_get_contents("../../apps/marketplace/service/etc/palm/marketplace/preinstalled.json"), true)["firstParty"] ?? [] as $p) echo $p["from"], "\n";'); do
            [ -d "../../$from" ] && node "$KIT/bin/phoenix-connector.cjs" pack "../../$from" --out "$DATA/seed/catalog" \
                --namespace org.webosphoenix --namespace com.webosphoenix >/dev/null || true
        done
        for ipk in "$DATA"/seed/catalog/*.ipk; do
            [ -f "$ipk" ] && { php bin/marketplace.php upload --phoenix "$ipk" || true; }
        done
        touch "$DATA/seed/catalog-connectors.done"
    fi
fi
echo "Phoenix Marketplace at http://127.0.0.1:$PORT/ (catalog: /v1/, admin: /admin), from $DATA"
if [ -n "$PHOENIX_SIM_INSTANCES" ]; then
    # Started by a simulator: the server goes on by itself, under its watch,
    # while any simulator runs; this returns.
    sh "$SELF" "$PORT" --watch $( [ "$FILL" = 1 ] || echo --no-fill ) </dev/null &
    exit 0
fi
# By hand: serves until stopped, filling meanwhile.
fill </dev/null &
write_server_json $$
exec php -S "127.0.0.1:$PORT" public/router.php
