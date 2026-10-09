# Phoenix driver catalog

What `org.webosphoenix.hardware` (Settings > Hardware, `services/hardware`)
reads: a signed index of driver packages (kernel modules, firmware and
services, as `.ipk`), each with the hardware it is for (modalias patterns,
firmware file names), its licence, size and sources. See
[docs/DRIVERS.md](../../docs/DRIVERS.md) for the format, the checks and how
to publish a driver, and [docs/HARDWARE.md](../../docs/HARDWARE.md#hardware-support-and-the-hardware-app)
for the plan.

```
data/signing.key                  the catalog's Ed25519 key (not in git)
data/entries/<id>.json            reviewed drivers
data/public/v1/drivers.json       the index, drivers.json.sig, key.json
data/public/v1/packages/*.ipk     the packages
data/reports.jsonl                opt-in hardware reports (IDs only)
```

Plain PHP 8 with libsodium (and `xz`/`zstd` to read OpenEmbedded's
packages); it uses the Marketplace's `.ipk` reader and signer
(`server/marketplace/src`). Same trust model as the Marketplace's catalogs,
with its own key, which is **pinned in the system image**
(`services/hardware/etc/palm/hardware/catalog.json`): drivers install as root,
so a driver catalog is never trusted on first use.

## Publishing

```sh
php server/drivers/bin/drivers.php init                 # once: the key to pin
php server/drivers/bin/drivers.php add driver.json      # checks it and its .ipk files
php server/drivers/bin/drivers.php publish [--days 30]  # signs a new build
php server/drivers/bin/drivers.php verify server/drivers/data/public/v1
php server/drivers/bin/drivers.php reports              # unsupported hardware, most reported first
server/drivers/bin/serve.sh                             # http://127.0.0.1:8090/v1/
```

`data/public/` is static: any web server or mirror can serve it. Only
`POST /v1/report` (`public/router.php`) needs PHP.

## The simulator's sample catalog

`sample/` is what the simulator's Settings > Hardware uses: four drivers
(Realtek rtw88 firmware, the RTL8812AU module, NVIDIA's GSP firmware, the
BCM43455 firmware) whose packages are small stand-ins, not the real files.
`php server/drivers/bin/drivers.php sample` makes it again from
`sample/manifests`. It is signed with `sample/signing.key`, which is in git
on purpose: it signs nothing else, and only the simulator
(`sample/public/catalog-sim.json`) trusts it.

Tests: `php server/drivers/tests/run.php`.
