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
| Firmware whose licence allows redistribution, for common hardware | **The image**: add its OE package to `meta-phoenix/recipes-core/packagegroups/packagegroup-phoenix-firmware.bb` (its licence must be on `PHOENIX_FIRMWARE_LICENSES`) |
| The same firmware for new or rare hardware, or added after a release | **The catalog**, `kind: "firmware"` (and in the next image, if it is common) |
| A newer version of firmware the image has | **The catalog**, `kind: "firmware"`, `optional: true`, `supersedes` the image's package, its files under `lib/firmware/updates/` |
| An open source driver outside the kernel (RTL8812AU, ...) | **The catalog**, `kind: "module"`: a recipe in `meta-phoenix/recipes-kernel/` building it per kernel into `lib/modules/<kernel>/updates/`, and a manifest in `phoenix-driver-feed`. Never for hardware a driver in the kernel already binds |
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
| `supersedes` | For newer firmware: the image's packages it updates (`["linux-firmware-rtl8821"]`). Settings shows the system's version beside the new one and offers "Update"; the image's package stays installed, the update's files go in `lib/firmware/updates/`, which the kernel reads first, so removing the update goes back to the system's |
| `after` | `reload` (unload and load `modules`), `rebind` (unbind and probe the device), `reboot` (it starts with the next restart), `none` |
| `license` | `id` (SPDX, or `LicenseRef-…`), `name`, `url`, `free` (an open source licence: no acceptance needed), `redistributable` (must be `true`). The text: `text`, or `textFile` (next to the manifest), or `textInPackage` (a file in one of the packages, as linux-firmware's licence packages carry them). Required in full when `free` is false: the user reads it before installing |
| `source` | Where the files come from (the upstream repository) |
| `packages` | The `.ipk` files, next to the manifest. Several architectures of the same package may be given; the device picks the most specific one opkg installs there (`/etc/opkg/arch.conf`: the machine's, then the CPU tune's, then `all`) |

## The packages

Ordinary opkg packages (`ar` of `debian-binary`, `control.tar.*`,
`data.tar.*`, compressed with gzip, xz or zstd), as OpenEmbedded's
`do_package_write_ipk` or `opkg-build` make them.

- **Firmware**: files under `lib/firmware/` (newer firmware under
  `lib/firmware/updates/`; and `usr/share/doc/`, `usr/share/licenses/`) only,
  no install scripts. OE's `linux-firmware`
  packages are split per chip already (`linux-firmware-rtl8821`); include the
  licence package they depend on (`linux-firmware-rtl-license`).
- **Modules**: files under `lib/modules/<kernel>/` (out-of-tree ones in
  `updates/`) and `etc/modprobe.d/*.conf`
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
php server/drivers/bin/drivers.php publish                   # signs a new build with a key on this computer
php server/drivers/bin/drivers.php verify server/drivers/data/public/v1
```

(`publish` signs with `data/signing.key`, for your own catalog or tests.
Phoenix's catalog is released with the key off the computer:
[Releasing the catalog](#releasing-the-catalog).)

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
recipe collects the packages its manifests name (the out-of-tree drivers
built for the image's kernel, and firmware for images built without it)
(`recipes-phoenix/phoenix-driver-feed/files/drivers/*.json`) into
`tmp/deploy/images/<machine>/phoenix-drivers/<id>/`, with a `driver.json`
naming the built files:

```sh
bitbake phoenix-driver-feed
for f in tmp/deploy/images/*/phoenix-drivers/*/driver.json; do
    DRIVERS_DATA=server/drivers/catalog php server/drivers/bin/drivers.php add "$f"
done
```

then commit the new `server/drivers/catalog/entries/*.json`, upload the
packages (`server/drivers/catalog/public/v1/packages/`) to the catalog's host,
and make a release.

## Releasing the catalog

The catalog's signing key belongs to the project's owner and **never leaves
their hands**: not on a server, not in GitHub. CI builds each release; the
owner signs it on their own computer; a CI job only the owner can approve
checks the signature against the key in the system image and publishes it.
Every device trusts only that key (and keys it hands over to).

The commands below are for a Mac (Linux is the same without Homebrew). Once:
`brew install php` (it has the Ed25519 functions this uses) and a clone of the
repository.

### 1. Make the key (once)

1. Plug in a USB drive used for nothing else; call it `PHOENIXKEY` (it then
   shows as `/Volumes/PHOENIXKEY`). A USB security key that stores files
   works the same way.
2. Make the key on it:
   ```sh
   php server/drivers/bin/drivers.php keygen /Volumes/PHOENIXKEY/drivers
   ```
   It prints the **public key** (44 characters ending in `=`) and its
   **fingerprint**. The secret key is `/Volumes/PHOENIXKEY/drivers/signing.key`.
3. **Back it up now**: open `signing.key` (`cat /Volumes/PHOENIXKEY/drivers/signing.key | pbcopy`),
   and paste it into a new secure note in your password manager, titled
   "Phoenix driver catalog signing key", with the public key and fingerprint.
   Then clear the clipboard (`pbcopy < /dev/null`). Keep the drive somewhere
   safe; do not copy the file anywhere else.
4. Put the **public** key into the system image: in
   `services/hardware/etc/palm/hardware/catalog.json`, set `"key"` to it (in
   place of `null`), commit and push. Devices built from then on trust it.
5. In GitHub: Settings > Environments > New environment `drivers-release` >
   Required reviewers: yourself. (Optional, to have CI copy the catalog to
   its host: environment secrets `DRIVERS_DEPLOY_HOST`, `DRIVERS_DEPLOY_PATH`,
   `DRIVERS_DEPLOY_SSH_KEY`.)

To restore the key from the password manager onto a new drive: copy the
note's key line, then
`mkdir -p /Volumes/NEWKEY/drivers && pbpaste > /Volumes/NEWKEY/drivers/signing.key && chmod 600 /Volumes/NEWKEY/drivers/signing.key`;
`php server/drivers/bin/drivers.php pubkey --key /Volumes/NEWKEY/drivers`
must print the same public key.

### 2. Make a release

1. Reviewed entries live in `server/drivers/catalog/entries/` (made with
   `drivers.php add`, as above, with `DRIVERS_DATA=server/drivers/catalog`;
   their packages are uploaded to the catalog's host separately). Merge them.
2. GitHub > Actions > **driver catalog** > Run workflow, step **build**. When
   it finishes, its summary shows the build number and the SHA-256; download
   the **drivers-catalog** artifact and unzip it.
3. Sign it, with the key drive plugged in:
   ```sh
   php server/drivers/bin/drivers.php sign ~/Downloads/drivers-catalog/drivers.json --key /Volumes/PHOENIXKEY/drivers
   ```
   It shows the build number, the number of drivers and the SHA-256 (check
   they are the ones from step 2) and prints the signature. Copy it. Unplug
   the drive.
4. Run the workflow again, step **publish**, with the build's run id (the
   number at the end of its page's address) and the signature. Approve the
   run when GitHub asks (you are its required reviewer). It checks the
   signature against the key in `catalog.json` (a wrong key or a changed
   file stops it) and publishes the signed catalog (the
   **drivers-catalog-signed** artifact, and the host if configured).

A catalog expires 30 days after it is built (devices then keep the last one
and show it as expired), so release at least monthly.

### 3. If the key is lost or leaked

- **Changing keys on purpose** (a new drive, a new person): make the new key
  (`keygen` on another drive), then, with the **old** key, sign a hand-over:
  ```sh
  php server/drivers/bin/drivers.php handover <new public key> --key /Volumes/PHOENIXKEY/drivers --out handover
  ```
  Publish `handover/key-handover.json` and `.sig` next to `drivers.json`,
  sign releases with the new key from then on, and put the new public key in
  `catalog.json` for new images. Devices with the old key follow the
  hand-over the first time a catalog does not verify with it, and then
  trust only the new key.
- **Lost** (no drive, no password-manager copy): no hand-over is possible.
  Make a new key, put it in `catalog.json` and ship a **system update**
  (Settings > Updates; its bundles are signed separately, by RAUC's key).
  Until devices have it, they keep their last catalog.
- **Leaked**: make a new key; put it in `catalog.json` **and add the leaked
  key to `"revoked"`** there, and ship a system update. A revoked key is
  never trusted again, even if it signs a hand-over. If the old key could
  still be trusted (it is your own, and only possibly copied), also publish
  a hand-over to the new key, for devices that have not updated yet.

## Other catalogs (Developer Mode)

Anyone can run a driver catalog with this tool (`init`, `add`, `publish`;
its own key). Users add it in Settings > Hardware > Other driver catalogs,
**only with Developer Mode on**: they see its key's fingerprint before
trusting it (publish yours where they can compare it), its drivers are
marked as not Phoenix's, an entry with the same id as a Phoenix one is left
out, and with Developer Mode off the catalog is not used.

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
