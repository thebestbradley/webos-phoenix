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
# shell/sim/siminstances.h; PHOENIX_SIM_PID and PHOENIX_SIM_EXE: the
# simulator itself), it sets the catalog up, leaves PHP's server running
# under a watch of its own and returns: the server goes on while any
# simulator runs, whichever started it, and stops a few seconds
# (PHOENIX_CATALOG_GRACE, 5) after the last one is gone, quit or crashed,
# or within a second of a stop from a simulator's menu (server.stopped in
# the folder). A simulator gone before the setup is done (killed, on a Mac,
# where nothing ends this with it) gets no catalog started for it.
# server.json in the folder says which process serves the catalog, once
# its PHP serves it: {pid (the watch, or this run by hand: who to stop),
# port, by (the simulator that started it; 0 by hand), checkout, started}.
# Only that process removes it. Stopping PHP's server stops the worker
# processes it forks too, which on a Mac outlive it.

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

# server.json: PHP's server under process $1 serves this folder's catalog
# (who to stop), started by the simulator PHOENIX_SIM_PID (0: by hand).
write_server_json() {
    printf '{"format":1,"pid":%s,"port":%s,"by":%s,"checkout":"%s","started":"%s"}\n' "$1" "$PORT" "${PHOENIX_SIM_PID:-0}" \
        "$(json_text "$CHECKOUT")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DATA/server.json.$1"
    mv -f "$DATA/server.json.$1" "$DATA/server.json"
}

# The process server.json names, if any.
claimed_by() {
    sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$DATA/server.json" 2>/dev/null || true
}

# server.json goes, if it is this process's: another's, written since (a
# watch started as this one ends), stays.
unclaim() {
    [ "$(claimed_by)" != "$$" ] || rm -f "$DATA/server.json"
}

# Whether the server answering at 127.0.0.1:$PORT is the PHP this process
# started: it says which (public/router.php, /_phoenix/serving, from
# PHOENIX_CATALOG_SERVING in its environment). Asked of PHP: no other
# program is needed.
serves_here() {
    php -r '$s = @fsockopen("127.0.0.1", (int) $argv[1], $errno, $error, 1);
        if (!$s) exit(1);
        stream_set_timeout($s, 2);
        fwrite($s, "GET /_phoenix/serving HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
        $reply = (string) stream_get_contents($s);
        $body = substr($reply, (int) strpos($reply, "\r\n\r\n") + 4);
        exit(str_contains($reply, "\r\n\r\n") && trim($body) === $argv[2] ? 0 : 1);' "$PORT" "$1" 2>/dev/null
}

# PHP's server is started in the background ($PHP, PHOENIX_CATALOG_SERVING
# being $$); this claims the catalog for it (server.json, process $$) once
# it serves it: what answers at the port says it is that PHP. A PHP that
# cannot listen there (another program has the port: an older simulator's
# catalog, or the one another simulator started at the same time) ends at
# once, and so does this, having claimed nothing: what answers is never
# taken for this folder's catalog on the word of a server that is not
# serving it.
claim_when_serving() {
    tries=0
    until serves_here $$; do
        if ! kill -0 "$PHP" 2>/dev/null || [ "$tries" -ge 100 ]; then
            if kill -0 "$PHP" 2>/dev/null; then
                stop_php
            fi
            code=0
            wait "$PHP" 2>/dev/null || code=$?
            echo "PHP's server is not serving 127.0.0.1:$PORT (exit code $code): the catalog is not started"
            exit 1
        fi
        tries=$((tries + 1))
        sleep 0.1
    done
    write_server_json $$
}

# Stops PHP's server ($PHP) and the worker processes it forked
# (PHP_CLI_SERVER_WORKERS, below). PHP ends its workers with it only where
# there is a parent-death signal, Linux and FreeBSD (php-src
# sapi/cli/php_cli_server.c, php_cli_server_worker_install_pdeathsig); on a
# Mac they would go on serving the port, the catalog running on with
# nothing left to stop it. Paused first: it forks none while they are
# looked for.
stop_php() {
    kill -STOP "$PHP" 2>/dev/null || return 0
    workers=$(ps -A -o pid= -o ppid= 2>/dev/null | while read -r pid parent; do [ "$parent" != "$PHP" ] || echo "$pid"; done)
    kill $workers "$PHP" 2>/dev/null || true
    kill -CONT "$PHP" 2>/dev/null || true
    wait "$PHP" 2>/dev/null || true
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

# Whether process PID is alive and is the program EXE: not a crashed one's
# process id now another program's, nor one that crashed and whose parent
# has not collected it yet (a zombie, state Z, which kill -0 still finds).
# The kernel keeps 15 letters of a program's name (Linux); a Mac's ps gives
# its path. Without ps, alive is enough.
alive_as() {
    [ -n "$1" ] && kill -0 "$1" 2>/dev/null || return 1
    command -v ps >/dev/null 2>&1 || return 0
    st=$(ps -o stat= -p "$1" 2>/dev/null) || return 1
    case "$st" in
        *Z*) return 1 ;;
    esac
    comm=$(ps -o comm= -p "$1" 2>/dev/null) || return 1
    comm=${comm##*/}
    case "$comm" in
        "$(printf '%.15s' "$2")"*) return 0 ;;
    esac
    return 1
}

# Whether a simulator is running: the one that started this catalog
# (PHOENIX_SIM_PID, PHOENIX_SIM_EXE: counted while it starts, before it lists
# itself, and when it is a run that does not list itself, a screenshot's), or
# one listed in the simulators' folder ("exe", else phoenix-sim: simulators
# of older builds do not say).
simulator_running() {
    alive_as "$PHOENIX_SIM_PID" "${PHOENIX_SIM_EXE:-phoenix-sim}" && return 0
    for f in "$PHOENIX_SIM_INSTANCES"/phoenix-sim*.json; do
        [ -f "$f" ] || continue
        pid=$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$f")
        exe=$(sed -n 's/.*"exe":"\([^"]*\)".*/\1/p' "$f")
        alive_as "$pid" "${exe:-phoenix-sim}" && return 0
    done
    return 1
}

# The watch (serve.sh --watch, started below): PHP's server, kept while a
# simulator runs. Terminal signals are not its: a simulator's Ctrl+C or a
# closed terminal leaves the catalog to the others.
if [ "$WATCH" = 1 ]; then
    trap '' HUP INT
    PHOENIX_CATALOG_SERVING=$$ php -S "127.0.0.1:$PORT" public/router.php </dev/null &
    PHP=$!
    trap 'stop_php; unclaim; echo "Catalog watch $$: stopped (asked to)"; exit 0' TERM
    claim_when_serving
    echo "Catalog watch $$: serving 127.0.0.1:$PORT (PHP's server: process $PHP)"
    fill </dev/null &
    GRACE="${PHOENIX_CATALOG_GRACE:-5}"
    idle=0
    while kill -0 "$PHP" 2>/dev/null; do
        sleep 1
        # Stopped from a simulator's menu (shell/sim/simmarketplace.cpp,
        # stop): for every simulator, whichever watch serves it (one the
        # simulator could not reach, whose server.json another removed,
        # stops all the same).
        if [ -f "$DATA/server.stopped" ]; then
            stop_php
            unclaim
            echo "Catalog watch $$: stopped from a simulator's menu"
            exit 0
        fi
        # Its claim, should another have taken it meanwhile.
        [ "$(claimed_by)" = "$$" ] || write_server_json $$
        if simulator_running; then
            idle=0
        else
            idle=$((idle + 1))
            if [ "$idle" -ge "$GRACE" ]; then
                stop_php
                unclaim
                echo "No simulator is running any more: the catalog stops"
                exit 0
            fi
        fi
    done
    code=0
    wait "$PHP" || code=$?
    unclaim
    echo "PHP's server stopped (exit code $code)"
    exit "$code"
fi

mkdir -p "$DATA"
# One setup at a time per catalog: two simulators starting it together
# would set one database up twice at once (two signing keys; the curated
# apps looked for, then inserted, by both: "UNIQUE constraint failed" for
# one, which then fails). The second waits for the first, then finds it set
# up. A lock whose setup was killed before it could remove it is taken over.
SETUP_LOCK="$DATA/setup.lock"
waiting=0
while ! mkdir "$SETUP_LOCK" 2>/dev/null; do
    owner=$(cat "$SETUP_LOCK/pid" 2>/dev/null || true)
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
        rm -rf "$SETUP_LOCK"
        continue
    fi
    [ "$waiting" = 1 ] || echo "Waiting for the setup that runs (process ${owner:-?}) to finish"
    waiting=1
    sleep 0.1
done
echo $$ > "$SETUP_LOCK/pid"
trap 'rm -rf "$SETUP_LOCK"' EXIT
trap 'exit 143' HUP INT TERM
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
# Set up: the next setup may run.
rm -rf "$SETUP_LOCK"
trap - EXIT HUP INT TERM
if [ -n "$PHOENIX_SIM_INSTANCES" ]; then
    # Started by a simulator: the server goes on by itself, under its watch,
    # while any simulator runs; this returns. Not for a simulator gone
    # meanwhile (killed while this set the catalog up: Linux's parent-death
    # signal ends this with it, nothing does on a Mac), nor once the catalog
    # was stopped from a simulator's menu meanwhile.
    if [ -n "$PHOENIX_SIM_PID" ] && ! alive_as "$PHOENIX_SIM_PID" "${PHOENIX_SIM_EXE:-phoenix-sim}"; then
        echo "The simulator that started this (process $PHOENIX_SIM_PID) is gone: the catalog is not started"
        exit 0
    fi
    if [ -f "$DATA/server.stopped" ]; then
        echo "The catalog was stopped from a simulator's menu meanwhile: it is not started"
        exit 0
    fi
    sh "$SELF" "$PORT" --watch $( [ "$FILL" = 1 ] || echo --no-fill ) </dev/null &
    exit 0
fi
# By hand: serves until stopped (Ctrl+C, or a simulator's menu), filling
# meanwhile.
fill </dev/null &
PHOENIX_CATALOG_SERVING=$$ php -S "127.0.0.1:$PORT" public/router.php </dev/null &
PHP=$!
trap 'stop_php; unclaim; exit 0' INT TERM HUP
claim_when_serving
code=0
wait "$PHP" || code=$?
unclaim
exit "$code"
