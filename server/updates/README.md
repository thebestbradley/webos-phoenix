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

## On this computer

```sh
php server/updates/bin/updates.php simulator --version 0.2.0 --build 2 --note "What changed"
server/updates/bin/serve.sh            # http://127.0.0.1:8089/, where the simulator looks
```

Then Settings > Updates > Check for Updates in the simulator.

## Publishing

```sh
php server/updates/bin/updates.php publish phoenix.raucb \
    --compatible phoenix-pinephone --version 1.1.0 --build 110 [--channel beta] --note "..."
php server/updates/bin/updates.php withdraw --compatible phoenix-pinephone [--channel beta]
php server/updates/bin/updates.php show
```

A release needs a higher build number than any before it on its channel.
When RAUC is installed where you publish, the bundle's own manifest must
agree with the options. `$UPDATES_FEED` puts the feed elsewhere (a web
server's folder). Tests: `php server/updates/tests/run.php`.

Requires PHP 8.
