# Phoenix update feed

What `com.palm.update` (System Updates, `services/updates`) reads: one JSON
file per device type ("compatible", as in RAUC's `system.conf`) and channel,
next to the RAUC bundles, in a folder any web server can serve. See
[docs/APP-RUNTIME.md](../../docs/APP-RUNTIME.md#system-updates).

```
data/feed/<compatible>/<channel>.json
data/feed/<compatible>/phoenix-<version>-<build>.raucb
```

The feed is not signed: RAUC checks each bundle's signature on the device,
and the device installs only a bundle newer than what it runs.

**Phoenix's catalog server serves it** (`server/marketplace`: the
Marketplace's catalog at `/v1/`, this feed at `/updates/`, one server), and
publishes releases with its admin API (`POST /api/admin/updates`). Devices
read it there by default (`services/updates/etc/palm/updates.json`).
`src/UpdateFeed.php` writes the feed for both that server and this command.

## On this computer

```sh
UPDATES_FEED=server/marketplace/data/updates \
    php server/updates/bin/updates.php simulator --version 0.2.0 --build 2 --note "What changed"
server/marketplace/bin/serve.sh        # http://127.0.0.1:8088/updates/, where the simulator looks
```

or the same with the admin API:

```sh
curl -X POST -H "Authorization: Bearer $(cat server/marketplace/data/admin.token)" \
    "http://127.0.0.1:8088/api/admin/updates?compatible=phoenix-sim&version=0.2.0&build=2&note=What%20changed"
```

Then Settings > Updates > Check for Updates in the simulator.
`server/updates/bin/serve.sh` (port 8089) still serves `data/feed` alone,
for a feed apart from the catalog.

## Publishing

```sh
php server/updates/bin/updates.php publish phoenix.raucb \
    --compatible phoenix-pinephonepro --version 1.1.0 --build 110 [--channel beta] --note "..."
php server/updates/bin/updates.php withdraw --compatible phoenix-pinephonepro [--channel beta]
php server/updates/bin/updates.php show
```

A release needs a higher build number than any before it on its channel.
When RAUC is installed where you publish, the bundle's own manifest must
agree with the options. `$UPDATES_FEED` puts the feed elsewhere (a web
server's folder). Tests: `php server/updates/tests/run.php`.

Requires PHP 8.
