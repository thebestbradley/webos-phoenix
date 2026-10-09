# Publishing a driver

How a kernel module, firmware or hardware service gets into Phoenix's
driver catalog, so that Settings > Hardware offers it to the devices that
need it. The plan and how the device side works are in
[HARDWARE.md](HARDWARE.md#hardware-support-and-the-hardware-app); the
licensing rules in [LEGAL.md](LEGAL.md#firmware-and-drivers).

## What goes in the catalog, and what does not

| | Where it goes |
| --- | --- |
| An open source driver that is in the Linux kernel | **The image**: add its `CONFIG_…=m` to `meta-phoenix/recipes-kernel/linux/files/phoenix-hardware*.cfg`. Every image carries every module (`kernel-modules`), loaded when the device is there. Nothing to publish |
| An open source driver outside the kernel (RTL8812AU, ...) | **The catalog**, `kind: "module"`, one package per kernel Phoenix ships |
| Firmware whose licence allows redistribution, open source or not | **The catalog**, `kind: "firmware"`. Open source firmware may also go in the image (`PHOENIX_FIRMWARE_IN_IMAGE`) |
| A user-space driver, HAL or daemon (a fingerprint reader's, a printer's, a modem manager plugin) | **The catalog**, `kind: "service"`, after a person reviews it |
| Firmware or drivers that may **not** be redistributed | **Nowhere.** Phoenix does not host or fetch them; see LEGAL.md |

## The manifest

`driver.json`, next to its `.ipk` packages:

```json
{
    "id": "firmware-rtw88",
    "kind": "firmware",
    "title": "Realtek Wi-Fi firmware (rtw88)",
    "summary": "Lets Realtek 802.11ac Wi-Fi adapters connect.",
    "description": "Longer text for the device page (optional).",
    "category": "wifi",
    "match": ["usb:v0BDApC811d*", "pci:v000010ECd0000C821sv*"],
    "firmware": ["rtw88/rtw8821*.bin"],
    "modules": ["rtw88_8821cu", "rtw88_8821ce"],
    "optional": false,
    "after": "reload",
    "license": {
        "id": "LicenseRef-rtlwifi-firmware",
        "name": "Realtek firmware licence",
        "textFile": "LICENCE.rtlwifi_firmware.txt",
        "url": "https://git.kernel.org/pub/scm/linux/kernel/git/firmware/linux-firmware.git/tree/LICENCE.rtlwifi_firmware.txt",
        "free": false,
        "redistributable": true
    },
    "source": "https://git.kernel.org/pub/scm/linux/kernel/git/firmware/linux-firmware.git",
    "homepage": "https://wireless.wiki.kernel.org/en/users/drivers/rtw88",
    "maintainer": { "name": "Your Name", "email": "you@example.com" },
    "packages": ["linux-firmware-rtl8821_20240909-r0_all.ipk", "linux-firmware-rtl-license_20240909-r0_all.ipk"]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Lower case, digits, `.`, `_`, `-`; stays the same across versions. Convention: `firmware-…`, `module-…`, `service-…` |
| `kind` | `firmware`, `module` or `service` |
| `category` | `wifi`, `bluetooth`, `graphics`, `camera`, `audio`, `input`, `sensors`, `storage`, `modem`, `network`, `usb`, `other` (where Settings > Hardware lists the device) |
| `match` | The hardware, as the kernel's modalias globs (`*`, `?`, `[…]`, as in `modules.alias`; `modinfo -F alias <module>` prints a module's): `pci:`, `usb:`, `sdio:`, `of:` (device tree compatible), `acpi:`, `i2c:`, `spi:`, `platform:`, `hid:`, `dmi:` (a machine). A pattern for a whole bus (`usb:*`) is refused |
| `firmware` | Files (or globs) under `/lib/firmware` the driver asks for. A device whose driver asked for one and did not get it (the kernel log) matches too. For `kind: "firmware"`, each must be in a package (compressed with `.xz` or `.zst` or not) |
| `modules` | The kernel modules involved: reloaded after installing (`after: "reload"`) |
| `optional` | An extra for hardware that already works (Settings shows "optional driver available"; First Use does not offer it) |
| `after` | `reload` (unload and load `modules`), `rebind` (unbind and probe the device), `reboot` (it starts with the next restart), `none` |
| `license` | `id` (SPDX, or `LicenseRef-…`), `name`, `url`, `free` (an open source licence: no acceptance needed), `redistributable` (must be `true`). The text: `text`, or `textFile` (next to the manifest), or `textInPackage` (a file in one of the packages, as linux-firmware's licence packages carry them). Required in full when `free` is false: the user reads it before installing |
| `source` | Where the files come from (the upstream repository) |
| `packages` | The `.ipk` files, next to the manifest. Several architectures of the same package may be given; the device picks the most specific one opkg installs there (`/etc/opkg/arch.conf`: the machine's, then the CPU tune's, then `all`) |

## The packages

Ordinary opkg packages (`ar` of `debian-binary`, `control.tar.*`,
`data.tar.*`, compressed with gzip, xz or zstd), as OpenEmbedded's
`do_package_write_ipk` or `opkg-build` make them.

- **Firmware**: files under `lib/firmware/` (and `usr/share/doc/`,
  `usr/share/licenses/`) only, no install scripts. OE's `linux-firmware`
  packages are split per chip already (`linux-firmware-rtl8821`); include the
  licence package they depend on (`linux-firmware-rtl-license`).
- **Modules**: files under `lib/modules/<kernel>/` and `etc/modprobe.d/*.conf`
  or `etc/modules-load.d/*.conf`, for one kernel each (the catalog records it,
  and a device takes only the package for its `uname -r`). The only install
  script allowed without a review is OE's `depmod -a <kernel>`.
- **Services**: anything but system accounts and `/boot`; always reviewed by
  a person (`--reviewed`), as the Marketplace reviews apps with services.

List every package the driver needs in `packages`: the device installs
exactly those files (checked against their signed SHA-256), and opkg fails
(and the install is rolled back) if a dependency is missing.

## Checking and publishing

```sh
php server/drivers/bin/drivers.php add path/to/driver.json   # the automatic checks
php server/drivers/bin/drivers.php show
php server/drivers/bin/drivers.php publish                   # signs a new build
php server/drivers/bin/drivers.php verify server/drivers/data/public/v1
```

**What is checked** (`server/drivers/src/Catalog.php`): the manifest's fields
as above; the licence allows redistribution, and its text is there when it
is not a free licence; each package is a valid `.ipk` with a name, version
and architecture; its files are where its kind allows; no install scripts
but `depmod` (unless `--reviewed`); a module package is for one kernel; the
firmware files named are in the packages. Then a person reviews: that the
patterns are right (not catching other devices), the licence is the
package's, and the source is what it says. **Publishing** writes
`drivers.json` with a build number one higher, expiring in 30 days (publish
at least monthly), and signs it; `data/public/` is static and any web server
or mirror can serve it.

**From an OpenEmbedded build:** `meta-phoenix`'s `phoenix-driver-feed`
recipe collects the firmware packages its manifests name
(`recipes-phoenix/phoenix-driver-feed/files/drivers/*.json`) into
`tmp/deploy/images/<machine>/phoenix-drivers/<id>/`, with a `driver.json`
naming the built files:

```sh
bitbake phoenix-driver-feed
for f in tmp/deploy/images/*/phoenix-drivers/*/driver.json; do
    php server/drivers/bin/drivers.php add "$f"
done
php server/drivers/bin/drivers.php publish
```

## Trying it in the simulator

The simulator reads the sample catalog in `server/drivers/sample` (stand-in
packages, signed with a key only the simulator trusts). Add a manifest to
`server/drivers/sample/manifests/` with `samplePackages` (the files to put in
its packages) instead of `packages`, run
`php server/drivers/bin/drivers.php sample`, add a device it is for to the
simulated hardware (`DEVICES` in `runtime/phoenix-runtime.js`, "Hardware and
drivers"), and open Settings > Hardware. `node tools/test-hardware.cjs` checks
the whole path.

## On a device

`/etc/palm/hardware/catalog.json` names the catalog and pins its key;
`org.webosphoenix.hardware` reads it, lists the hardware (`lib/sysfs.js`:
what `luna-send -n 1 luna://org.webosphoenix.hardware/list '{}'` returns is
the place to start for a new device: its `ids` are what `match` needs), and
installs with opkg. A driver installed by hand (`opkg install`) works too;
the catalog is how users get it without a terminal.
