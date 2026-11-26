# Dev push: changed files on a test device in minutes

The plan for sending a handful of changed files (the shell's QML,
`phoenix-runtime.js`, web apps, JavaScript services) to a test device in
Developer Mode without building a new image, and restarting only what
changed. Written 25 November 2026 at the owner's request ("plan it with both
the direct push and server channel, follow closely to Palm's workflow and
naming conventions"). **Status: P1 and P2 built** (26 November 2026: the
dev bundle format and its checks, the image's manifest, the bundle maker
and `nova package`; then `novad` / `org.webosphoenix.nova` over a fake
root, pairing, the `nova` device commands, the simulator's overlay and
Settings' Pushed Changes; section 12, "P1 as built" and "P2 as built");
P3 onwards still a plan. 1.0
(this repository) is the core; 2.0 (phoenix-ember-glass-ui) gets it by
merging 1.0.

The doc keeps the owner's name for the feature, "dev push", so it is easy to
find. The tools it plans are named in Palm's style (section 2): the host
command is **`nova`**, after Nova, Palm's codename for webOS that novacom and
novaterm are named for, and the device's end is **`novad`**.

## Contents

1. [Goal](#1-goal)
2. [Palm's workflow and how Phoenix maps to it](#2-palms-workflow-and-how-phoenix-maps-to-it)
3. [What Phoenix has today](#3-what-phoenix-has-today)
4. [The device side: the developer overlay](#4-the-device-side-the-developer-overlay)
5. [Dev bundles](#5-dev-bundles)
6. [The direct push](#6-the-direct-push)
7. [The server channel](#7-the-server-channel)
8. [The bundle maker](#8-the-bundle-maker)
9. [Security](#9-security)
10. [Out of scope](#10-out-of-scope)
11. [Tests](#11-tests)
12. [Phases and who does what](#12-phases-and-who-does-what)
13. [Open questions for the owner](#13-open-questions-for-the-owner)
14. [Docs to update when it is built](#14-docs-to-update-when-it-is-built)
15. [Sources](#15-sources)

---

## 1. Goal

- **Minutes, not hours.** An image build takes hours. A change to a QML
  file, the runtime, a web app or a Node.js service should be on a test
  device and running within a couple of minutes of saving it.
- **Two ways in.** A **direct push** from a computer over USB or the LAN
  (what Palm's `novacom` and Android's `adb push` / `adb sync` do), and a
  **server channel** on Phoenix-Web-Services: a remote developer sends a
  signed dev bundle to a device, and its owner taps Apply.
- **Restart only what changed**: the shell, one service, one app, never a
  reboot for these.
- **Nothing lasting.** The changes sit in a writable overlay over the
  image's files, only in Developer Mode, tied to the image build they were
  made for, revertible with one button ("Revert to Image"), and cleared by
  the next full system update.
- Full images keep shipping as normal A/B updates (RAUC,
  [APP-RUNTIME.md](APP-RUNTIME.md#system-updates)). Dev push never replaces
  them and never reaches a device that is not in Developer Mode.

## 2. Palm's workflow and how Phoenix maps to it

### How Palm developers did it

- **Developer Mode.** Typing `upupdowndownleftrightleftrightbastart` (the
  Konami code) or webOS 1.x's `webos20090606` into Just Type offered the
  Developer Mode Enabler, which launched `com.palm.app.devmodeswitcher`
  (`third_party/luna-applauncher/app/LaunchPointSearch.js:30-36, 137-139,
  194-214`). Switching it on restarted the device and opened USB to
  `novacomd`. Phoenix already reproduces this part
  ([APP-RUNTIME.md](APP-RUNTIME.md#developer-mode)).
- **novacomd and novacom.** `novacomd` ran on the device (an upstart job,
  `files/launch/device/novacomd.conf.in` in the novacomd sources) and on
  the host; `novacom` was the host command. It spoke a multiplexed packet
  protocol over USB (gadgetfs on the device) or TCP (port 6969, with
  6968 the device list, 6970 logs, 6971 control: `include/novacom.h:27-30`).
  Its verbs (`src/novacom/commands_device.c:975-981`):
  `novacom put file:///path < local`, `novacom get file:///path > local`,
  `novacom run file:///usr/bin/... -- args`, `novacom -t open tty://`
  (a root shell; `novaterm` wrapped it), `novacom -l` (list devices),
  and `connect tcp-port` (port forwarding). There was **no
  authentication by default**: `auth_init` leaves `authdone = true` unless
  `/var/novacom/passwd` exists (`src/device/auth.c:42, 86-136`). TCP
  listened on loopback unless `--bind-all-interfaces` (`src/main.c:870-871`),
  so in practice it was USB-only, and physical access was the trust.
- **The SDK on top.** `palm-generate` (a project from a template),
  `palm-package` (an `.ipk`), `palm-install` (install, `-r` remove),
  `palm-launch` (`-c` close, `-i` with the inspector), `palm-log` (`-f`
  follow), `palm-emulator`, `palm-inspector`, every one with `-d <device>`
  (`usb`, `tcp`, a name) and every one over novacom.
- **System files.** The root was read-only by default; developers became
  root with novaterm, `mount -o remount,rw /`, copied files with
  `novacom put`, remounted read-only, and restarted what they changed:
  `stop LunaSysMgr` / `start LunaSysMgr` (an upstart job with `respawn`,
  luna-sysmgr's `LunaSysMgr.upstart:2, 8, 38`) for the UI, and
  `luna-send -n 1 palm://com.palm.applicationManager/rescan '{}'` for apps
  (luna-sysmgr `Src/base/application/ApplicationManagerService.cpp:2985`).
  WebOS Internals' patches (applied by Preware) changed system files the
  same way and had to come out before an OTA; "Emergency Patch Recovery"
  took them all out. **webOS Doctor** reflashed the stock image.
- **After Palm.** LG's `ares-*` tools replaced `palm-*` (`ares-generate`,
  `ares-package`, `ares-install`, `ares-launch`, `ares-inspect`, `ares-log`,
  `ares-shell`, and `ares-push` / `ares-pull` to copy files), over SSH with
  Developer Mode's key. LuneOS's Developer Mode service,
  `org.webosports.service.devmode`, has `setStatus` / `getStatus` with a
  flag file `/var/luna/dev-mode-enabled` and a `usbDebugging` switch that
  starts `android-tools-adbd` (`DevModeAssistants.js:23-28, 31-90` at
  `65588c2d`), so on LuneOS USB debugging is adb. webOS TV homebrew
  (webosbrew) changes its read-only squashfs root with bind mounts and
  overlayfs at runtime, restarting the services it touched by killing them.
- **Today's host tools.** webOS Archive's
  [webos-sdk-redux](https://github.com/webOSArchive/webos-sdk-redux)
  rebuilds `novacomd`, `novacom`, `novaterm` and the `palm-*` SDK for
  current macOS, Windows and Linux, for Palm's devices.

### The names Phoenix uses

Palm named its tools after the codename Nova (novacom, novacomd, novaterm)
and the SDK commands `palm-<verb>`. Phoenix follows that shape, with two
changes, each for a reason:

- The host command is **`nova`**, with Palm's verbs as subcommands
  (`nova put`, `nova install`, `nova launch`, `nova log`...), as `ares-*`
  later grouped them. Not `novacom`: webos-sdk-redux installs a real
  `novacom` that Palm owners still use with their Pre and TouchPad, and a
  second program of that name on the same Mac would break one of them. Not
  `palm-*`: "Palm" is someone else's mark, used by Phoenix only to describe
  compatibility and history ([LEGAL.md](LEGAL.md#name-and-trademarks)).
  `./phoenix nova ...` runs it from a checkout.
- The device end is **`novad`** (a systemd unit, `novad.service`) serving
  the Luna service **`org.webosphoenix.nova`**, the API Settings uses.
  Phoenix's own services are `org.webosphoenix.*`; Palm's names are kept
  where Phoenix implements Palm's API, which here there is none of.

Where Palm had nothing, the names are new and plain, as Palm's own
user-facing names were ("Developer Mode", "Full Erase"): the **developer
overlay** (the device's writable layer), **dev bundles** (what is pushed or
sent), **Pushed Changes** (the list in Settings > Developer Mode) and
**Revert to Image**.

### The table

| Palm (or LG) | What it did | Phoenix | Same or new |
| --- | --- | --- | --- |
| Developer Mode Enabler (Konami code, `webos20090606`) → Developer Mode Switcher | Reveal and turn on Developer Mode | As now: Just Type reveals Settings > Developer Mode, which turns it on with the device passcode ([APP-RUNTIME.md](APP-RUNTIME.md#developer-mode)) | Same |
| `novacomd` (device, USB gadgetfs or TCP 6969, upstart) | The device end of every developer tool | `novad` / `org.webosphoenix.nova`: TLS over TCP, on the LAN or over a USB network link, paired keys (section 6). LG's `novacomd` is in the image but not started (section 3) | New, Palm-style name |
| `novacom -l` | List devices | `nova devices` (paired devices, USB link, mDNS) | Same verb, new transport |
| (pairing: none) | | `nova pair` (a code shown on the device) | New |
| `mount -o remount,rw /` + `novacom put file://...` | Change a system file | `nova push` (a dev bundle of what changed into the developer overlay) | New: an overlay, not a remount |
| `novacom put file://P < f` / `get file://P > f` | Copy one file | `nova put DEVICEPATH FILE` (a one-file dev bundle), `nova get DEVICEPATH` (read only, allowed paths) | Same verbs |
| `stop LunaSysMgr` / `start LunaSysMgr` | Restart the UI | Automatic after a push (the restart map, section 4.5); by hand `nova restart shell` | Same idea, done for you |
| `luna-send -n 1 palm://com.palm.applicationManager/rescan '{}'` | Pick up new or changed apps | Automatic after a push; by hand `nova rescan` | Same call |
| `novacom run file:///usr/bin/luna-send -- ...` | Run a program | `nova luna-send URI JSON` (as the developer role); arbitrary commands only over SSH | Narrower |
| `novacom -t open tty://`, `novaterm` | Root shell | `nova term`: SSH as `user` with the paired key, Developer Mode's SSH ([TERMINAL.md](TERMINAL.md) T4); no root shell | Same verb, safer |
| `palm-package` (`ares-package`) | Make an `.ipk` | `nova package APPDIR` (an app), `nova package --system` (a dev bundle: section 8) | Same verb |
| `palm-install [-r]` | Install / remove an app | `nova install IPK`, `nova install -r ID` (`com.webos.appInstallService`, `developerMode: true`) | Same |
| `palm-launch [-c] [-i]` | Launch, close, inspect | `nova launch ID [JSON]`, `-c` close; `-i` later (WebAppMgr's inspector port) | Same |
| `palm-log [-f]` | App and system log | `nova log [-f] [ID]` (the journal, filtered to the app or service) | Same |
| `palm-generate` | New project | Later: `nova generate` over the SDK's templates ([APP-SDK.md](APP-SDK.md)) | Later |
| `palm-emulator` | Emulator | `./phoenix run` (phoenix-sim); `nova push --device sim` pushes to it too | Same role |
| `palm-inspector` | Web Inspector | Later: `nova inspect ID` | Later |
| webOS Doctor | Back to the stock image | **Revert to Image** (drops the overlay); a full reflash as ever | New name for the light case |
| Preware patches + Emergency Patch Recovery; patches out before an OTA | Community system changes and their undo | The overlay is cleared by a full update automatically (section 4.6) | Community precedent |
| (none) | | **Server channel**: dev bundles through Phoenix-Web-Services, Apply on the device (section 7) | New |

## 3. What Phoenix has today

What the plan builds on, read 25 November 2026 at webos-phoenix `origin/main`
and phoenix-ember-glass-ui `e11c38f1`:

- **Developer Mode.** Settings > Developer Mode
  (`apps/settings/src/pages/DevMode.tsx`) calls OSE's
  `com.webos.service.devmode` `getDevMode` / `setDevMode`; Settings,
  `services/account/accountservice.js:605` and
  `services/hardware/hardwareservice.js:156` read it. **Phoenix's own image
  has no provider for it**: `com.webos.service.devmode` is a C1 gap in
  phoenix-ember-glass-ui `meta-phoenix/conf/image-contract.json`, and
  LuneOS's `org.webosports.service.devmode` comes with
  `packagegroup-luneos-extended` (meta-webos-ports `9abe603b`,
  `meta-luneos/recipes-core/packagegroups/packagegroup-luneos-extended.bb:88`),
  which `webos-phoenix-image.bb` takes out (`IMAGE_FEATURES:remove:luneos =
  "luneos-extended"`). The Modern104 test image had it only because that
  group was installed by name (`image-recorded.json:3, 127`).
  [TERMINAL.md](TERMINAL.md) plans a `phoenix-devmode` recipe (the `user`
  account, sudo, the SSH unit); this plan adds to it.
- **novacomd is in the image, not running.** meta-webos-ports puts
  `VIRTUAL-RUNTIME_novacomd ?= "novacomd"` in `packagegroup-webos-extended`
  (`meta-luneos/recipes-core/packagegroups/packagegroup-webos-extended.bb:21,
  176`), which Phoenix keeps, and the Modern104 image has the package
  (`image-recorded.json:1695`). The recipe
  (`meta-luneos/recipes-webos-owo/novacomd/novacomd.bb`, `SRCREV
  537338a8`) installs no systemd unit: the device build has no launch file
  (`CMakeLists.txt:52-53, 88`; only the old upstart file). Its USB side is
  legacy gadgetfs (`src/device/usb-gadget.c`), which no Phoenix kernel
  fragment turns on.
- **System updates.** `com.palm.update` (`services/updates`) reads signed
  feeds (format 2, channels stable/beta/dev), downloads, `rauc install`,
  `rauc status mark-good` ([PLATFORM-CLIENT.md](PLATFORM-CLIENT.md#system-updates)).
  It compares builds by `/etc/os-release` `BUILD_ID`
  (`services/updates/service.js:14`). **RAUC is not in the image yet**
  (PRE-IMAGE-CHECKLIST U1), **the root is not read-only yet** (S3: planned
  EROFS or squashfs with `/var` and `/home` on a data partition,
  HARDWARE.md "OTA with A/B updates"). The overlay below works on either.
- **The kernel has overlayfs**: `CONFIG_OVERLAY_FS=y`
  (`meta-phoenix/recipes-kernel/linux/files/phoenix-ose.cfg:92-94`,
  "A read-only root later").
- **The image's file layout** comes from `runtime/rootfs.json` through
  `tools/install-rootfs.py` (packaged by `phoenix-apps_git.bb`): apps in
  `/usr/palm/applications`, Node.js services in `/usr/palm/services`, Luna
  files in `/usr/share/luna-service2`, configuration in `/etc/palm`, the
  runtime in `/usr/share/phoenix/runtime`, Just Type and the system alerts
  in `/usr/lib/luna`. The shell is `phoenix-shell_git.bb`: QML and assets
  in `/usr/share/phoenix/qml` and `/usr/share/phoenix/assets`
  (`shell/CMakeLists.txt:336, 342`), which luna-surfacemanager loads
  through `WEBOS_COMPOSITOR_IMPORT_PATH`
  (`meta-phoenix/recipes-phoenix/phoenix-shell/files/product.env:4`); the
  compiled `Phoenix.Native` module in Qt's QML directory.
- **The simulator's precedent**: phoenix-sim's `--extra-rootfs` and
  `tools/serve-rootfs.py --extra-rootfs` lay a folder shaped like the
  device's root over the checkout's, searched first
  (`shell/sim/rootfs.h:53, 150`); `rootfs.json` "overlays" does the same for
  the compat overlay.
- **How things start on a device.** WebAppMgr is `webapp-mgr.service`
  (`meta-phoenix/recipes-phoenix/phoenix-wam-conf/files/phoenix-wam.sh:30`);
  luna-surfacemanager is a systemd unit whose name on the LuneOS image is
  *to check* (DEVICE-AUDIT "Restart UI on a device", OPEN-QUESTIONS Q39);
  Node.js services are started on demand by the hub (`run-js-service`) and
  start again on the next call when stopped; `phoenix-pty` is a long-running
  unit.
- **Phoenix-Web-Services** (Laravel, staging only: `TestPlatformOnly`)
  serves the feeds through `FeedController` (`catalog/v1`, `updates`,
  `drivers/v1`, `revocations/v1`), registers devices
  (`POST v1/devices`, `GET v1/me/devices`), has Passport scopes including
  `developer` (`app/Providers/AppServiceProvider.php:62`), a tester-only
  catalog behind a bearer token (`catalog/v1/tester/`), and a separate
  signer that holds no update or RAUC keys (`signer/README.md`,
  `docs/KEYS.md`). It has no notices feed yet (NOTICES.md: branch
  `cloud/notices-feed`).

## 4. The device side: the developer overlay

### 4.1 Where it lives

```
/var/lib/phoenix/overlay/
  state.json                 which build, what is applied, from whom, when
  <BUILD_ID>/
    upper/<mount>/...        the changed files (overlayfs upperdir)
    work/<mount>/            overlayfs workdir
    bundles/<id>.ipk(.sig)   the last few dev bundles applied, for the record
    journal.json             each apply and revert: files, restarts, result
```

`/var` is the writable data partition in the read-only-root plan (S3) and
writable today. A size cap (256 MB, a setting) keeps a push from filling it.

### 4.2 The mounts

One overlay per directory Phoenix ships into, never `/` and never `/usr`
whole:

| Mount point | What is in it |
| --- | --- |
| `/usr/share/phoenix` | The shell's QML and assets, the runtime, product and release notes, sounds |
| `/usr/palm` | Apps, Node.js services, frameworks, sounds, account templates |
| `/usr/lib/luna` | Just Type and the system alerts' pages |
| `/usr/share/luna-service2` | Roles, permissions and service files of Phoenix's services and apps |
| `/etc/palm` | db8 kinds and permissions, activities, backup registrations |

Each is `mount -t overlay overlay -o lowerdir=<dir>,upperdir=...,workdir=...
<dir>`. Everything else (`/usr/bin`, `/usr/lib` with Qt, Chromium and
the compiled QML modules, `/lib/modules`, `/etc/systemd`, `/etc/rauc`,
`/boot`) is never under an overlay.

Inside those, some paths are put back to the image's copy after the overlay
is mounted, by bind-mounting the lower directory over them, and are refused
by the service in any bundle (section 9.4): the trust anchors
(`/etc/palm/phoenix/` with `servers.json`, `/etc/palm/marketplace/sources.json`,
`/etc/palm/hardware/catalog.json`), `com.palm.update`'s service directory,
and `org.webosphoenix.nova`'s own.

`phoenix-overlay.service` (a root shell script, `Type=oneshot`) mounts them
early: after `/var` is mounted and before the Luna hub, WebAppMgr and
luna-surfacemanager start (`Before=` on their units, which local confirms
on the image), and only when:

1. Developer Mode is on (the provider's flag file, read directly: the bus
   is not up yet);
2. `state.json`'s build equals `/etc/os-release` `BUILD_ID`;
3. the overlay holds something.

Otherwise nothing is mounted and the device runs exactly its image.

### 4.3 Turning it on for the first push

OSE's `setDevMode` restarts the device; so does Phoenix's provider
(section 12, P3). The first push after Developer Mode is on finds no overlay
mounted, so `novad` writes the bundle into `upper/` while nothing is
mounted over it (allowed: overlayfs only forbids changing its layers while
mounted), then mounts it itself and restarts what the bundle touches. Later
pushes go through the mounted overlay.

### 4.4 Applying a bundle

`novad` (root) checks the bundle (section 5.3), then for each file writes
`<dir>/<path>.nova-new` through the **merged** path and renames it into place
(overlayfs copies up and the rename is atomic for readers); a removed file
is an unlink through the merged path (a whiteout). Writing through the
merged mount is ordinary overlayfs use; the upper and work directories are
never touched while mounted. A failure part way reverts the files already
written (from the journal) and reports which file failed.

Apply is **replace by default**: the overlay ends up holding exactly the
bundle's files, so pushing the repository's state twice is the same as
once, and a file put back to the image's version in the repository leaves
the overlay. `nova push --add` adds to what is there instead (for a fix
sent on top of another developer's).

### 4.5 Restart only what changed

`novad` works out what to restart from the paths, itself; a bundle's
`restart` list is only a hint shown to the owner. The map:

| Changed path | Restart | How |
| --- | --- | --- |
| `/usr/share/phoenix/qml/**`, `/usr/share/phoenix/assets/**` | The shell | `systemctl restart` of luna-surfacemanager's unit (Palm: `stop LunaSysMgr; start LunaSysMgr`). Apps' windows come back as after Restart UI (to check on the image whether WebAppMgr must follow) |
| `/usr/share/phoenix/runtime/**`, `/usr/palm/frameworks/**`, `/usr/lib/luna/**` | Every web page | `systemctl restart webapp-mgr.service`: the runtime and frameworks are loaded into every app and system page |
| `/usr/palm/applications/<id>/**` | That app | Close it (`com.webos.applicationManager` `closeByAppId`), rescan when `appinfo.json` changed or the app is new (Palm's `rescan`), launch it again if it was open |
| `/usr/palm/services/<id>/**` | That service | Stop its process; the hub starts it on the next call (as webosbrew does with `pkill`). A service run by its own unit: `systemctl restart` |
| `/usr/share/luna-service2/**` | The hub's tables | `ls-control scan-services` (to check on the image), then the service as above |
| `/etc/palm/db/**`, `/etc/palm/activities/**` | db8 kinds, activities | The configurator for those files; otherwise "Restart the device to finish" |
| `/usr/share/phoenix/product.json`, anything else | Nothing live | "Restart the device to finish" |

Restarts run after all files are in place, the narrowest first, each once.
The device says what it restarted (`nova push` prints it; Pushed Changes
lists it).

### 4.6 Revert, and the build it was made for

- **Revert to Image** (Settings > Developer Mode > Pushed Changes, or
  `nova revert`): `state.json` is marked for clearing and the device
  restarts; at boot `phoenix-overlay` deletes the directory before mounting
  anything. A live revert is not offered: emptying a mounted overlay's
  upper directory is exactly what overlayfs forbids, and a restart is a
  minute.
- **One file back** (`nova revert PATH`): if the image has the file, its
  copy (read from the lower directory, bind-mounted at
  `/run/phoenix/overlay/lower/` for this) is written through the merged
  path; the leftover copy is dropped at the next boot. If the image has no
  such file (a bundle added it), it is removed through the merged path,
  which deletes it from the upper directory and leaves no whiteout, as the
  lower directory never had it. If a bundle deleted an image file, the
  revert takes the whiteout away by writing the image's copy back. Either
  way the restart map runs. Works live; the tests cover all three cases.
- **A full update clears it.** The overlay is kept under its `BUILD_ID`.
  After an A/B switch the new slot's `BUILD_ID` differs, so nothing is
  mounted; `com.palm.update` deletes overlays of other builds when it marks
  the new slot good (`rauc status mark-good`), so a fall back to the old
  slot before that still finds its overlay. Without RAUC (today), reflashing
  an image changes `BUILD_ID` the same way. A bundle made for another build
  is refused (section 5.3).
- **Developer Mode off**: nothing is mounted from the next boot on (the
  provider restarts the device); the overlay stays on disk until Revert to
  Image or the next update, so turning Developer Mode back on brings it back
  (owner question 6). Full Erase deletes `/var`, overlay and all.

### 4.7 Telling the user

While the overlay is mounted: Device Info shows the version as "1.0.0
(build N) + developer changes" and links to Pushed Changes; Developer
Mode's status in the notification area (the dashboard that Developer Mode
will have for SSH, TERMINAL.md) says how many files are changed; the
hardware report and crash archives (`phoenix-diag`) record that the
system is modified and list the overlay's files, so no report about a
modified system is taken for one about the image.

## 5. Dev bundles

### 5.1 Format

A dev bundle is an **`.ipk`**, as everything Palm's tools packaged was, so
it is made and read with the code Phoenix already has
(`apps/marketplace/service/lib/ipk.js`, `phoenix-default-apps`
`tools/lib/ipk.cjs`): an `ar` archive of `debian-binary`, `control.tar.gz`
and `data.tar.gz`.

- `data.tar.gz`: the files at their device paths (`./usr/share/phoenix/qml/...`),
  regular files only, modes 0644 or 0755, no links, no devices, no setuid.
- `control.tar.gz`: `control` (`Package: phoenix-devpush`, `Version:
  <made>`, `Architecture: all`, `Description:` the note) and
  `devpush.json`:

```json
{
  "format": 1,
  "id": "2f1c...e9",
  "made": "2026-11-25T14:03:00Z",
  "build": "20261124093012",
  "product": "1.0",
  "compatible": "phoenix-pinephonepro",
  "device": "any",
  "counter": 1795615380000,
  "mode": "replace",
  "parts": ["apps", "shell"],
  "files": [{"path": "/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml", "sha256": "...", "size": 18231, "mode": "0644"}],
  "removed": ["/usr/palm/applications/org.webosphoenix.settings/old.js"],
  "restart": ["app:org.webosphoenix.settings", "shell"],
  "source": {"repo": "webos-phoenix", "commit": "a1b2c3d", "dirty": true},
  "note": "Card view: fix the throw on a minimized card",
  "by": "ed25519:<base64 public key>"
}
```

  As built in P1 (`docs/platform-api/devpush.schema.json`, `bundleManifest`;
  the reader `apps/shared/platform/src/devpush.js`):
  - `id`: the first 32 hex digits of the SHA-256 of the rest of devpush.json
    (keys sorted), so the same changes make the same bundle.
  - `product`: the product line, product.json's major version (`"1.0"`,
    `"2.0"`): decision 12 checked on its own, not only through `build`.
  - `compatible`: RAUC's compatible, or `null` for any device of that build
    (the build already ties it to one image).
  - `device` and `counter`: section 9.1's no-replay rule. `device` is a
    device id or `"any"` (never `"any"` from a granted key); `counter` must
    be above the last one the device applied for the same grant (or, for a
    paired computer or the platform's key, the same key). nova makes it
    from the time the bundle was made, in milliseconds, so a computer keeps
    no counter of its own and two computers with one key never collide.
  - `parts`: the parts its paths are in, sorted: `apps`
    (`/usr/palm/applications`), `roles` (`/usr/share/luna-service2`),
    `services` (`/usr/palm/services`, `/etc/palm`) and `shell` (the rest:
    `/usr/share/phoenix`, frameworks, `/usr/lib/luna`, sounds); a grant
    names the parts it allows (9.1).
  - `restart`: `hub`, `configurator`, `rescan`, `service:<id>`, `app:<id>`,
    `wam`, `shell`, `reboot`, narrowest first (4.5).
  - The path rules and caps every side reads are one file,
    `apps/shared/platform/src/devpush-paths.json`: the five mounts, the
    refused paths (9.4, plus the image's own `manifest.json`, and
    `com.palm.update`'s and `org.webosphoenix.nova`'s Luna files), the
    parts, the compiled folders (section 10) and the caps.

- Beside it, `<bundle>.ipk.sig`: base64 of the Ed25519 signature of the
  `.ipk`'s bytes and a newline, the detached form every Phoenix feed uses
  (PLATFORM-CLIENT.md, "Signatures and keys"; `@phoenix/platform`
  `signed.js` `verifyDetached`), by the key in `by`.

### 5.2 Size

A typical push is a few QML or JavaScript files (kilobytes). A web app's
`dist/` is a few megabytes. The cap is 64 MB per bundle, which also keeps
the server's storage small.

### 5.3 What the device checks

In order, refusing with a code and a message: Developer Mode on
(`NEEDS_DEVMODE`); the signature verifies and `by` is a trusted key
(`UNTRUSTED`, section 9.1); `build` equals the running `BUILD_ID` and
`compatible` the device's (`WRONG_BUILD`, `WRONG_DEVICE`); every path is
under an overlay mount and none is refused (`REFUSED_PATH`, section 9.4);
each file's size and SHA-256 match `files` (`BAD_BUNDLE`); the overlay stays
under its cap (`NO_SPACE`).

As built (`devpush.js` `verify`, which nova, `org.webosphoenix.nova` and the
simulator share): `TOO_BIG` first (over 64 MB, before anything is read),
then `NEEDS_DEVMODE`; the signature is checked against the device's trusted
keys **before the bundle is unpacked**, so nothing an untrusted sender
wrote is parsed; then `UNTRUSTED` also for an expired or revoked grant and
for a `by` that is not the key that signed; `NOT_A_BUNDLE` (not an `.ipk`,
no `devpush.json`); `WRONG_BUILD`, `WRONG_PRODUCT` (the product line),
`WRONG_DEVICE` (the device type, or a `device` that is not this one, or
`"any"` from a granted key); `OUT_OF_SCOPE` (a grant not covering this
device or product); `REPLAY` (the counter); `REFUSED_PATH`; `OUT_OF_SCOPE`
(a part the grant does not allow); `BAD_BUNDLE` (devpush.json not valid; a
file's size, SHA-256 or mode not as listed, a file not listed or missing, a
link or special file, more than 256 MB unpacked); `NO_SPACE`.

## 6. The direct push

### 6.1 The host command

`tools/nova/` in this repository, Node.js 22 with no packages beyond what
the repository already has, run as `./phoenix nova ...` or installed on the
`PATH` as `nova`. Why Node (confirmed when P1 was built): it is on every
developer's computer already (`./phoenix` installs Node 22 on macOS and
Ubuntu), it has Ed25519, TLS 1.3 with pinned keys and an HTTPS server in
its standard library (what P2's pairing and push need, with no package),
and the device's `org.webosphoenix.nova` is a Node.js service: the bundle
format, its checks and the `.ipk` code are one set of CommonJS files both
ends load (`@phoenix/platform` `devpush.js`, the Marketplace's `lib/ipk.js`).
The bundle maker calls `tools/install-rootfs.py` (Python 3, as the image
build does) for the checkout's file plan, so there is one plan, not a copy
in JavaScript. Every subcommand takes `-d DEVICE` (a paired device's
name, `usb`, `sim`, or an address), as Palm's did; without it, the one
device connected, else the last used.

| Command | Does |
| --- | --- |
| `nova devices` | Paired devices, which are reachable (USB link, mDNS, last address), their build and Developer Mode state |
| `nova pair [ADDRESS]` | Pairs with a device showing a pairing code (section 6.4) |
| `nova unpair DEVICE` | Forgets it, here and on the device |
| `nova push [--add] [--dry-run] [--note TEXT] [PATHS...]` | Builds what changed (section 8), makes a dev bundle for the device's build, sends it, applies it, prints the restarts. With `PATHS`, only those repository paths |
| `nova put DEVICEPATH FILE` / `nova get DEVICEPATH [FILE]` | Palm's verbs: one file in (as a bundle with `--add`), one file out (overlay mounts only) |
| `nova status` | What the overlay holds: files, from which bundles, by whom, when |
| `nova revert [PATH]` | One file back to the image's; without a path, Revert to Image (restarts the device) |
| `nova restart shell\|wam\|app ID\|service ID` | By hand |
| `nova rescan` | Palm's `rescan` |
| `nova package APPDIR` / `nova package --system [-o FILE]` | An app's `.ipk` / a dev bundle to a file (for the server channel). **Built (P1)**, with `nova verify BUNDLE` (the device's checks, on the computer) and `nova key` |
| `nova install IPK`, `nova install -r ID` | Install, remove an app (Developer Mode's installer path) |
| `nova launch ID [JSON]`, `nova launch -c ID` | Launch, close |
| `nova log [-f] [ID]` | The journal, filtered |
| `nova luna-send URI JSON` | One Luna call as the developer role |
| `nova term` | SSH to the device as `user` with the paired key (needs Developer Mode's SSH) |
| `nova send DEVICE-OR-ACCOUNT [--note TEXT]` | Makes a bundle and sends it through the server channel (section 7) |

`nova push --device sim` writes into a running simulator's overlay instead
(section 11), so the same workflow is testable without hardware.

### 6.2 Transport

One protocol on every link: **HTTPS (TLS 1.3) on TCP port 6965**, beside
novacom's 6968-6971 (to check against IANA's registry before it is fixed).
JSON requests, the bundle as the body; `novad` answers with progress lines
as they happen. Over:

- **the LAN** (Wi-Fi or Ethernet): only while Developer Mode's "Push over
  network" switch is on, and only on private addresses;
- **USB**: a USB network link, a CDC NCM gadget made through configfs by
  `phoenix-devmode` while Developer Mode's "USB debugging" is on (LuneOS's
  name for the switch). The device is at a fixed link-local address on it,
  as postmarketOS does for its USB network; `nova` finds it there. Kernel
  configuration for the gadget (`CONFIG_USB_CONFIGFS_NCM`) goes into the
  phone and tablet fragments; the VM has no USB device port, so the VM
  uses the LAN.

Why not novacom's own protocol or adb: novacomd gives a root shell with no
authentication, its USB side needs gadgetfs, and it has no service unit;
adb is LuneOS's USB debugging, but works only over USB unless its wireless
pairing is added, and gives a shell too. One TLS protocol over a network
link, on USB and Wi-Fi alike, needs one authentication, one implementation
and one set of tests, and gives only what dev push needs.

### 6.3 Discovery

`novad` advertises `_nova._tcp` over mDNS while "Push over network" is on
(if the image has an mDNS responder: *to check*, avahi is not in Phoenix's
contract); `nova devices` lists what answers, the USB link's address, and
the paired devices' last addresses. `nova pair 192.168.1.23` always works.

### 6.4 Pairing and authentication

As adb does, never as novacom did:

1. The computer has a key pair, made on first use (`~/.config/nova/key`,
   Ed25519; its public key is also its identity on the server channel).
   The device has its own, made by `novad` on first start, kept in
   `/var/lib/phoenix/nova/` readable by root only.
2. **Pairing** needs the owner at the unlocked device: Settings >
   Developer Mode > **Pair a Computer** shows a six-digit code and the
   device's key fingerprint for two minutes. `nova pair` asks for the code,
   and the two sides run a **password-authenticated key exchange** with it:
   CPace (the CFRG's balanced PAKE, draft-irtf-cfrg-cpace) or SPAKE2
   (RFC 9382), whichever has a vetted permissive-licence implementation for
   both the host CLI and `novad`, with the session's identities bound to
   both keys' fingerprints and the TLS exporter of the connection. Each
   side then proves with the PAKE's shared key that it holds its own key,
   and each stores the other's key. A PAKE is what makes a six-digit code
   safe here: a plain proof keyed with the code (an HMAC of the
   fingerprints) would let anyone on the network who poses as the device
   during pairing take that proof away and try all million codes offline,
   whatever the attempt limit. With a PAKE, a guess is possible only by
   talking to the real device, one guess per run. A run is good only in
   the window it began in: once the owner cancels, the two minutes run
   out, a new Pair a Computer starts or another computer completes
   pairing, a run still waiting for the computer's confirmation is refused
   (`NOT_PAIRING`). Five failed runs end
   the window, so a guess succeeds at most 5 times in a million. **The code is asked over USB too** (the owner, 26 November
   2026): a cable is no proof of who holds it, so there is no Allow-only
   shortcut as adb's RSA prompt has.
3. After pairing, TLS with both keys pinned: the device takes connections
   only from keys in its paired list, the computer only from the device key
   it paired with. No passwords; nothing on the wire a listener can reuse.
4. Settings lists the paired computers with their names, fingerprints and
   last use, and removes them. A key the signed revocation list names
   (9.1) leaves the list and the `user` account's authorized_keys when the
   list arrives; its open connections are closed, and new ones are refused
   at the TLS handshake, as is pairing it again. Turning Developer Mode off stops `novad`
   listening; Full Erase forgets everything.

A paired computer's key is also a trusted bundle key (section 9.1), so a
bundle it made with `nova package --system` can come by the server channel
too.

## 7. The server channel

A remote developer sends a dev bundle to a device; the device's owner sees
it in Settings and taps Apply. The server is only the mailbox: bundles are
signed end to end by the developer's key, and the server never holds a key
that a device trusts for this (Phoenix-Web-Services `docs/KEYS.md`: "The
production application must never hold ... private keys").

### 7.1 Who may send to whom

On the website, the device's owner opens Account > Devices > the device >
**Developer Access** and grants it to a Phoenix account by name (one with
the developer role), with the developer's key fingerprint, which the
developer gives them out of band, choosing the parts it may change and how
long it lasts. That approval only prepares the grant: it takes effect once
the owner signs it with the platform's dev-signing key, and the device,
signed in to the owner's account, then trusts that key for bundles within
the grant ("Trusted Developers" in Developer Mode). The extra layer on
granted keys (scope, expiry, revocation, no replay, rate limit, strong
sign-in, the owner seeing every bundle) is in section 9.1. Either side can
withdraw.

### 7.2 Phoenix-Web-Services endpoints

New, beside the device registration (`v1/devices`), all under
`TestPlatformOnly` like the rest until production:

| Endpoint | Who | Does |
| --- | --- | --- |
| `POST v1/developer/devpush` | Developer (bearer, scope `devpush`) | Multipart: `bundle` (`.ipk`), `signature`, `deviceId`, `note`. Checks the grant, the size (64 MB), the `.ipk`'s `devpush.json` (build and compatible against the device's registered build), the signature against the granted key. Stores it. 201 with an id |
| `GET v1/developer/devpush` | Developer | Their bundles and each one's state (waiting, applied, declined, failed with the device's message, expired) |
| `DELETE v1/developer/devpush/{id}` | Developer | Withdraw one not yet applied |
| `GET v1/devices/{id}/devpush` | The device (bearer, the owner's token, scope `devpush`) | The waiting bundles' metadata: id, sender, key fingerprint, note, files, size, made |
| `GET v1/devices/{id}/devpush/{bundle}` and `.sig` | The device | The bytes |
| `POST v1/devices/{id}/devpush/{bundle}/result` | The device | `applied`, `declined` or `failed` with the error and the restarts; the server deletes the bytes |
| `GET v1/builds/{buildId}/manifest.json` | Developer | The image's file manifest for a build (section 8), uploaded with each test image |

Storage: `storage/app/devpush/<sha256>.ipk` on the server, deleted 14 days
after upload or once the device reports a result. The device's build is
reported at registration and each poll, so the server refuses a bundle for
another build before the owner ever sees it.

### 7.3 How the device hears of one

**Polling, first.** The notices feed ([NOTICES.md](NOTICES.md)) is one
signed broadcast for every device and keeps no per-device state, so it is
the wrong channel. `org.webosphoenix.nova` polls `GET v1/devices/{id}/devpush`
only while Developer Mode is on and the device is signed in: hourly (an
activity, Wi-Fi), once after start, and whenever Pushed Changes is open.
**Later**, the push relay (PLATFORM-CLIENT.md rows 24-25) wakes it to poll
at once, the way NOTICES.md plans for its feed.

A waiting bundle posts a notification: "Developer changes from <name>:
<note>", which opens Settings > Developer Mode > Pushed Changes.

### 7.4 Apply in Settings > Developer Mode

A new group, **Pushed Changes**, at the end of the Developer Mode pane:

- **Waiting**: each bundle with its sender, key fingerprint, note, the
  files it changes (grouped: Shell, Web apps, Services, System pages), and
  what it will restart ("The system UI will restart"). **Apply** asks for the
  device passcode (as turning Developer Mode on does), **Decline** drops it.
- **On this device**: the overlay's state: the build, the number of files
  and their list, each bundle applied, by whom and when, and the restarts
  that need a device restart still to happen ("Restart Now").
- **Revert to Image**: with a confirmation ("Remove every pushed change and
  restart?").
- **Paired Computers** and **Trusted Developers**: the keys, with Remove;
  **Pair a Computer** (section 6.4).

The pane uses `org.webosphoenix.nova` through `@phoenix/luna`; its methods:
`getStatus {subscribe}`, `listWaiting`, `apply {id}`, `decline {id}`,
`revert {path?}`, `pairStart`, `pairCancel`, `listKeys`, `removeKey {key}`,
`setOptions {network, usb}`.

## 8. The bundle maker

`nova push` and `nova package --system` find what differs between the
repository's build and the device's image, and put only that in the bundle.

1. **What the repository would install.** `tools/install-rootfs.py`
   already plans every device path from `runtime/rootfs.json` (its
   `build_plan()`); the shell's QML and assets are `shell/qml/` and
   `shell/assets/` at `/usr/share/phoenix/qml` and `assets`
   (`shell/CMakeLists.txt:336, 342`). The maker runs that plan into a
   staging directory (the apps built first, as `./phoenix` builds them when
   a file in `apps/` changed) and hashes each file.
2. **What the image has.** Each image build writes a manifest of its files:
   `install-rootfs.py --manifest` and the shell recipe's install step write
   `/usr/share/phoenix/manifest.json` (`{build, compatible, files: {path:
   sha256}}`, only the paths dev push may change). `nova` reads it from the
   device (`novad` serves it), or for the server channel from
   `v1/builds/{buildId}/manifest.json`, uploaded with the test image.
3. **The difference**: files whose hash differs or that are new, and image
   files the repository no longer installs (`removed`). Files under
   refused paths are left out with a warning; anything the bundle cannot
   carry (section 10) stops it: "shell/native changed: this needs a new
   image".

2.0 (phoenix-ember-glass-ui) merges this; its own `product.json`,
rootfs additions and QML come through the same plan, so its bundles hold
2.0's files for 2.0's images, and a 1.0 bundle is refused on a 2.0 image by
`build` and `product`.

### 8.1 As built (P1)

- **The manifest** (`docs/platform-api/devpush.schema.json`,
  `imageManifest`): `{format: 1, build, product: {name, version, line},
  compatible, source: {repo, commit, dirty}, files: [{path, size, sha256,
  mode}]}`, the files sorted by path: every file Phoenix ships under the
  five mounts but the refused ones, the shell's QML, assets and client
  permissions included (from `shell/`, as `shell/CMakeLists.txt` installs
  them), with the size and hash of the bytes the image holds (an app page
  with the runtime's `<script>`, `appinfo.json` as WebAppMgr gets it, the
  release notes without "unreleased"). A list, not `{path: sha256}`, so it
  carries size and mode and the schema can check it.
- **Written in two steps**, because `BUILD_ID` exists only when the image
  is put together: `tools/install-rootfs.py DESTDIR --manifest` (phoenix-apps'
  do_install) writes it with build `"unstamped"`, and
  `tools/install-rootfs.py --stamp ROOTFS` (a `ROOTFS_POSTPROCESS_COMMAND`
  of the image, as `phoenix-firmware-policy.bbclass` already writes
  `/usr/share/phoenix/firmware/licences.json`) takes `BUILD_ID` from
  `ROOTFS/etc/os-release` and rehashes each listed file from the image's
  own copy, so what other recipes did after phoenix-apps (the image's
  `servers.json` is refused anyway; `.pcm` twins are not Phoenix's files
  and not listed) shows as it is, and a file gone from the image is
  dropped. Wiring both into meta-phoenix is P3 ("the manifest in the
  image"; the image recipe has no checkout, so the stamp comes as a native
  tool or a bbclass carrying `install-rootfs.py`'s `stamp()`); the maker
  refuses an unstamped manifest.
- **The checkout's side** is the same code: `install-rootfs.py
  --print-manifest` (not strict: what is not built is named, and nova stops
  with "Build first"), and `install-rootfs.py STAGE --only -` lays just the
  changed files into a temporary folder for the bundle, as the image would
  have them. `--repo DIR` runs the plan over another checkout.
- **Compiled parts**: the manifest's `source.commit`; nova runs `git diff`
  from it over the folders `devpush-paths.json` names as compiled
  (`shell/native`, `services/{devices,keyboard,l2cap,pdeath,pty}`), and a
  change there stops the bundle ("shell/native changed: this needs a new
  image") unless `--allow-compiled`. Without a commit this checkout has, it
  says it cannot tell. `meta-phoenix/` is not on the list: a recipe change
  is not always a file change, and the manifest shows the files that did.
- **Refused paths** never reach either manifest; one in an image's
  manifest (an older or hand-made one) is left out with a warning.
- **Deterministic**: the same checkout, manifest, key and `--made` (or
  `SOURCE_DATE_EPOCH`) make the same bytes on a Mac and on Linux (tar
  times 0, gzip's OS byte fixed).
- `nova package --system` options: `--manifest FILE` (P2 reads it from
  the device, P4 from the server), `--device ID`, `--compatible NAME`,
  `--add`, `--note TEXT`, `--only PATH` (device path prefixes), `--counter`,
  `--made`, `--repo`, `--dry-run`, `--allow-compiled`, `--key FILE`, `-o`.

## 9. Security

### 9.1 Who the device trusts for bundles

Two kinds of key (the owner, 26 November 2026: "both, master platform, and
granted developer keys, but we need an additional layer on granted keys to
make it harder to abuse"):

1. **The platform's dev-signing key** ("master"). Its own key in the
   owner's root chain, offline, beside the update and catalog keys but not
   one of them (a leak of one must not sign the others' content). The image
   pins its public half, as it pins the update root (PLATFORM-CLIENT.md).
   A bundle it signs needs no grant; it is still subject to section 9.2
   (Developer Mode) and section 7.4 (the passcode on Apply).
2. **Paired computers' keys** (section 6.4): only for the direct push,
   and for bundles a paired computer sends by the server channel.
3. **Granted developer keys**, with the extra layer:
   - **A grant is a certificate, not a server record.** The owner's
     approval in Account > Devices > Developer Access makes the server
     prepare it, but it takes effect only when the owner signs it with the
     platform's dev-signing key (an offline step, as releases are signed).
     The server cannot mint trust, so a compromised server or account can
     grant nothing.
   - **Scoped:** the device ids it covers, the product and build line
     (1.0 or 2.0), and which parts it may change: `apps` (web apps only),
     `shell` (the shell's QML and the runtime), `services` (JS services),
     and `roles` (Luna role and permission files, off unless named).
   - **Short-lived:** 14 days by default, 90 at most; renewing is a new
     signed grant. A key may hold several grants (a renewal, or grants
     with different scopes): a bundle is accepted if any live grant of the
     key allows it, and the counter and the daily rate are that grant's.
     Adding a grant drops the key's expired, older ones.
   - **Revocable:** a signed revocation list rides the update feed (as
     revoked builds do); the device checks it before every Apply and refuses
     bundles from a revoked key or grant. A revoked key is trusted for
     nothing, a paired computer's included (6.4).
   - **No replay:** each bundle names the device and a counter the device
     keeps per grant (and per key); a bundle with a counter at or below the
     last one applied under its key or any of the key's grants is refused,
     so a bundle one grant took never comes again under another.
   - **Rate-limited on the device:** 10 bundles a day per grant.
   - **Strong sign-in to upload:** Phoenix-Web-Services takes a bundle for
     a device only from the grant's account with a passkey or TOTP
     confirmed in the last 10 minutes (its existing recent-confirmation
     rule).
   - **Seen by the owner:** every bundle from a granted key is a
     notification on the device (who, what parts, how big), Apply asks the
     passcode (decision 8), and both the device and the server keep a log
     the owner can read in Settings and on the website.

Nothing is trusted on first use, and the catalog, update and notice keys
are never accepted for bundles. A bundle signed by any other key is refused
even if it came over a paired link.

### 9.2 Developer Mode is the gate

Developer Mode is the owner's consent, with the device passcode, to
developer access ([APP-RUNTIME.md](APP-RUNTIME.md#developer-mode)). Without
it: `novad` does not listen, the server channel does not poll, nothing is
mounted at boot, and every `org.webosphoenix.nova` method but `getStatus`
answers `NEEDS_DEVMODE`. Production images (`PHOENIX_PRODUCTION = "1"`)
have no SSH server and no root login (`webos-phoenix-image.bb`); dev push
adds no shell: it carries files into five directories and restarts.

### 9.3 Why not novacom's model on the LAN

novacom trusted whoever reached the port (USB-only in practice); webOS
Internals' pages on running novacom over TCP warn that the device is then
open to anyone who can reach it until it restarts. Phoenix devices are on
Wi-Fi in cafés: pairing with the owner at the unlocked device, pinned keys
both ways, and private addresses only.

### 9.4 Never overlayable

- **Outside the five mounts, by construction**: the kernel and its modules,
  the bootloader and boot partition, the initramfs, RAUC (its binary,
  `/etc/rauc` keyring and `system.conf`), systemd units, PAM, sudoers, SSH
  configuration, `novad`'s mount script, Qt, Chromium and WebAppMgr,
  compiled QML modules and every other binary.
- **Inside them, refused and bind-mounted back to the image's copy**: the
  trust anchors (`/etc/palm/phoenix/servers.json` and the rest of
  `/etc/palm/phoenix/`, `/etc/palm/marketplace/sources.json`,
  `/etc/palm/hardware/catalog.json`), `com.palm.update` (so a pushed file
  can never stop the update that clears the overlay) and
  `org.webosphoenix.nova` itself.
- Luna role and permission files may be pushed (a developer's service
  needs them), but the Apply screen lists them as "Changes what services
  may do" (owner question 7).

### 9.5 dm-verity, later

When the root becomes dm-verity (HARDWARE.md plan), the overlay sits above
the verified image: the image stays verifiable, and the device knows and
says it is modified (section 4.7). Measured boot or attestation, if Phoenix
ever has them, report the overlay as a modification.

### 9.6 Legacy novacom, for vintage tools

The owner chose to keep LG's `novacomd` (26 November 2026) so the real
`novacom` from webos-sdk-redux works with Phoenix too. Started as it ships,
it gives an unauthenticated root shell, so Phoenix keeps it behind its own
switch:
- Settings > Developer Mode > **Legacy novacom (USB)**, off by default,
  shown only with Developer Mode on, with a plain warning ("Anyone with a
  cable gets full control of this device").
- **USB only:** never bound to a network interface.
- **A password:** turning it on asks for one and writes
  `/var/novacom/passwd`, the file novacomd's own authentication reads
  (`src/device/auth.c`), so the switch never runs it open.
- **It turns itself off** after an hour and at every restart; nothing
  starts it at boot.
- `novad` and the developer overlay don't depend on it.

## 10. Out of scope

- **Compiled parts**: `shell/native` (`Phoenix.Native`), the keyboard's
  Maliit plugin, `phoenix-pty`, the C++ services, Qt, WebAppMgr and the web
  engine. They need the image or, later, an `.ipk` path: opkg packages of
  those recipes from the build's feed installed into the overlay (an opkg
  root on the overlay), the same answer the Hardware app needs for drivers
  after an A/B update (PRE-IMAGE-CHECKLIST U5). That is its own plan.
- **The kernel, bootloader, device tree, firmware**: images only.
- **Configuration outside `/etc/palm`** (systemd, compositor geometry
  `/etc/phoenix`): images only, for now.
- **A root shell** (`novacom -t open tty://`): SSH as `user` with sudo
  (TERMINAL.md T4) covers it.
- **Production devices**: Developer Mode only, by design.

## 11. Tests

The simulator cannot mount overlays over a real root, so most of this is
tested with a fake root in CI, and the rest on the VM image.

**In CI (cloud):**

- `nova` (vitest): argument parsing, device selection, the pairing
  exchange against an in-process `novad`, TLS with pinned keys (a wrong
  key, a replayed code, five wrong codes; a stand-in device in the middle
  during pairing learns nothing it can test a code against offline, and
  one run gives it one guess).
- The bundle maker: **built as `tools/test-nova-bundle.cjs`** (Node, a quick
  check, `tools/ci-checks.sh nova-bundle`; Node rather than Python because
  the maker and the device's checks are Node): a small checkout made in a
  temporary folder, its image's manifest written, stamped and checked
  against the schema; changed, new and removed files; the restart map's
  rows and the parts; `--add`, `--only`; refused paths; a `shell/native`
  change stopping it; an unstamped manifest, another product line and
  unbuilt apps refused; deterministic bundles (same input, same bytes); the
  64 MB cap. The device's checks (`devpush.js` `verify`) in the same file:
  a good bundle and every refusal (a tampered bundle and a tampered file,
  bad and untrusted signatures, `by`, build, product, device type and
  device, counter replay, forbidden paths and removals, links, setuid
  modes, size and space caps, Developer Mode off, a grant's expiry,
  revocation, device, product and parts); the path rules alike in Python
  and JavaScript; `nova` itself and `./phoenix nova`.
  `tools/test-install-rootfs.py` checks this checkout's manifest.
- `org.webosphoenix.nova` (vitest, as `services/updates` is tested with a
  fake RAUC): a temporary directory as the root and a stand-in for `mount`
  and `systemctl` that records what is called; every refusal of 5.3; apply
  and its rollback on a failed write; replace and add; the restart map,
  each row; revert one file (one the image has, one a bundle added, one
  a bundle deleted) and all; the build tie (another `BUILD_ID`,
  nothing mounted); Developer Mode off; the size cap.
- `phoenix-overlay` (the boot script) against a fake root in a container
  with overlayfs where CI allows it (`unshare -m` as root), else its
  decisions only.
- **The simulator end to end** (`tools/test-nova.cjs`, in
  `tools/web-tests.txt`): phoenix-sim and `serve-rootfs.py` read a simulated
  overlay folder first (their `--extra-rootfs` machinery, kept per
  `--instance`); the runtime answers `org.webosphoenix.nova` for the
  simulator. Pair, push a QML change and a web app change, see the shell
  reload and the app reopen with the new file, Revert to Image. Settings'
  Pushed Changes in Chromium (`tools/test-settings.cjs`).
- Phoenix-Web-Services (PHPUnit): upload with and without a grant, wrong
  build, too big, a bad signature, the device's poll and result, expiry,
  withdrawal, another account's device.

**On the VM image (local):** the mounts at boot and their order before the
hub, WebAppMgr and luna-surfacemanager; luna-surfacemanager's and the
hub's real unit names and `ls-control`; a push over the LAN from a Mac; the
shell and WebAppMgr restarts and how apps come back; Revert to Image; a
reflash with a new `BUILD_ID` leaving nothing mounted; the space cap. **On
a phone (local, later):** the USB NCM link and USB pairing.

## 12. Phases and who does what

Sizes: S a day or less, M a few days, L a week or more. Cloud writes the
code and tests; local builds and checks the VM image and devices and
deploys the server; the owner decides (section 13).

| Phase | What | Size | Who | Needs |
| --- | --- | --- | --- | --- |
| **P0** | The owner's answers to section 13 | — | owner | this plan |
| **P1** | Dev bundle format; the image manifest (`install-rootfs.py --manifest`, the shell's); the bundle maker; `nova package --system`; tests. **Done** 26 November 2026 (below) | M | cloud | P0 names |
| **P2** | `org.webosphoenix.nova` with the fake root (apply, restart map, revert, build tie, Developer Mode gate, keys, TLS, pairing); `nova` host command (`pair`, `push`, `put`, `get`, `status`, `revert`, `restart`, `rescan`, `devices`); the simulator's overlay and `--device sim`; Settings > Developer Mode > Pushed Changes; `tools/test-nova.cjs`. **Done** 26 November 2026 (below) | L | cloud | P1 |
| **P3** | meta-phoenix: `phoenix-devmode` (a `com.webos.service.devmode` provider for Phoenix's image, its flag, the restart; `phoenix-overlay.service`; `novad.service`; the manifest in the image (`install-rootfs.py --manifest` in phoenix-apps' do_install and `manifest.json` in its FILES; `--stamp` as a `ROOTFS_POSTPROCESS_COMMAND`, 8.1); the Legacy novacom switch, section 9.6); kernel configuration for the USB gadget | M | cloud | P2 |
| **P3v** | Build the VM image with P3, verify the list in section 11, report unit names and anything that differs | M | local | P3 |
| **P4** | Phoenix-Web-Services: grants, the `devpush` scope, the endpoints, storage and expiry, manifests per build; the device's polling and notification; `nova send` | M | cloud (code on a branch), codex or local (staging deploy after review) | P2, owner's yes to Q3 and Q9 |
| **P4v** | End to end: a bundle from a second account to the owner's VM through staging, Apply, Revert | S | local | P3v, P4 deployed |
| **P5** | USB NCM link and USB pairing on PinePhone Pro / PineTab2; the push relay waking the poll; `nova launch -i`, `nova generate`, `nova inspect` | M | cloud, local on hardware | P3v |
| **Later** | The `.ipk` path for compiled parts (an opkg root in the overlay), shared with U5 | L | cloud, local | owner |

P1 and P2 need no image, server or decision beyond P0's names, and can
start at once.

### P1 as built (26 November 2026)

| Piece | Where |
| --- | --- |
| The format, the path rules, the device's checks, the restart map | `apps/shared/platform/src/devpush.js`, `devpush-paths.json` (in `@phoenix/platform`, which every Node service on a device already carries) |
| The schema (devpush.json and manifest.json) | `docs/platform-api/devpush.schema.json` |
| The image's manifest | `tools/install-rootfs.py --manifest`, `--stamp`, `--print-manifest`, `--only`, `--repo` |
| `nova` (`package`, `package --system`, `verify`, `key`) | `tools/nova/nova.cjs`, `lib/bundle.cjs`, `lib/keys.cjs`; `./phoenix nova` |
| `.ipk` | The Marketplace's `lib/ipk.js`, now also giving a package's control files and every data entry (links and special files, so they can be refused) and writing extra control files |
| Tests | `tools/test-nova-bundle.cjs` (quick check `nova-bundle`), `tools/test-install-rootfs.py` |

Design changes from the plan above, each said where it is described:
`product`, `device`, `counter` and `parts` in devpush.json (5.1); the
signature checked before unpacking, and `WRONG_PRODUCT`, `REPLAY`,
`OUT_OF_SCOPE` and `TOO_BIG` (5.3); the manifest a list with sizes and
modes, written in two steps (8.1); the maker's test in Node (11).

**What P2 needs from P1**: `org.webosphoenix.nova` loads `devpush.js` from
its own `@phoenix/platform` copy and needs the `.ipk` reader: the
Marketplace's `lib/ipk.js` is not a shared package, so P2 either moves it
into `@phoenix/platform` (the Marketplace and the runtime's in-page copy
keep loading it; check `runtime/phoenix-runtime.js` `loadModule("lib/ipk.js")`)
or carries a copy; the device passes `verify` its trusted keys, the
running `BUILD_ID`, product line, RAUC compatible and device id, and keeps
the last counter per scope (`grant:<id>` or `key:<base64>`). `nova push`
reads `/usr/share/phoenix/manifest.json` from `novad` and calls
`makeSystemBundle`; `nova` keeps its key where P1 made it. The read-only root and RAUC (S3, U1) are not needed: the
overlay works on today's writable root, and the build tie stands in for the
update clearing it until RAUC is there.

### P2 as built (26 November 2026)

| Piece | Where |
| --- | --- |
| `novad`'s core: apply (verify, then each file through the merged path, or into `upper/` before the first mount, then mounted), replace and add, rollback of a failed write, the restart map run by the device, revert one file and Revert to Image, the build tie, the Developer Mode gate, the cap, waiting bundles and Apply with the passcode, the Luna methods | `services/nova/novaservice.js` |
| The overlay's two backends (overlayfs on a device; a folder for the simulator) and the boot-time decisions | `services/nova/lib/overlay.js`, `services/nova/boot.js` |
| Who it trusts: the platform's key, paired computers, signed grants and the signed revocation list | `services/nova/lib/trust.js` |
| Pairing: SPAKE2 | `services/nova/lib/pake.js` |
| The protocol: TLS 1.3 with pinned Ed25519 keys, port 6965 | `services/nova/lib/proto.js`, `lib/keys.js` |
| On a device (Luna registration, the listeners) | `services/nova/service.js`, `lib/system.js`, `sysbus/` |
| The simulator's `novad` | `services/nova/sim.js`; phoenix-sim `shell/sim/simnova.h`, `Rootfs::developerOverlayFile`; `tools/serve-rootfs.py` |
| `nova pair`, `unpair`, `devices`, `push`, `put`, `get`, `status`, `revert`, `restart`, `rescan`, `log`, `luna-send`, `forward`, `term` | `tools/nova/nova.cjs`, `lib/remote.cjs`, `lib/devices.cjs` |
| Settings > Developer Mode: Pushed Changes, Pair a Computer, Paired Computers, Trusted Developers, Developer Connections | `apps/settings/src/pages/DevPush.tsx`; `@phoenix/luna` `nova.ts`; the runtime's `org.webosphoenix.nova` (`runtime/phoenix-runtime.js`, "Dev push") |
| Tests | `services/nova/novaservice.test.ts` (the fake root, stand-ins for `mount`, `mknod`, `systemctl`, `ls-control`, `pkill`: `test/fake-system.cjs`), `services/nova/proto.test.ts` (RFC 9382's vectors, pairing over TLS, someone in the middle), `tools/nova/nova.test.ts` (the command against an in-process `novad`, and `nova push -d sim` over a small checkout), `apps/settings/src/pages/DevPush.test.tsx`, `tools/test-nova.cjs` (Chromium, in `tools/web-tests.txt`) |

**The PAKE.** No vetted, permissively licensed SPAKE2 or CPace package
exists for JavaScript (checked November 2026), so `lib/pake.js` writes RFC
9382's protocol (SPAKE2-P256-SHA256-HKDF-HMAC, M and N from its section 6)
over vetted parts: the group operations (point decoding and validation,
constant-time scalar multiplication) are `@noble/curves` 1.9.7's P-256
(MIT, audited; already in the image for the drives' SSH client),
SHA-256, HKDF, HMAC, scrypt and the random scalars Node's own crypto. The
code is about a hundred lines and passes the RFC's four test vectors
(Appendix B, `test/rfc9382-vectors.json`, read from the RFC's text); it
should still have a second reader before production. The run: A is the
computer, B the device; identities `nova:` and `novad:` with the
fingerprints of the keys each presented in the TLS handshake; the AAD the
connection's exported keying material (label `EXPORTER-nova-pair`, 32
bytes); w = scrypt(code; N 2^15, r 8, p 1; the identities as the salt), 40
bytes reduced mod the order. The device sends pB with its confirmation;
the computer checks it before it sends its own (a false device gets pA and
nothing to test codes against); then each signs the transcript's hash
with its key. A run counts from its first message, five a window. The
tests show a party in the middle failing both runs, and one posing as the
computer able to test only the code it committed to.

**Design changes from the plan above**, each where it applies:
- The transport is TLS 1.3 on 6965, but **framed messages, not HTTP**
  (`lib/proto.js`): pairing's three messages must run over one TLS
  connection (its exporter binds them), which an HTTP client's pool does
  not promise, and `forward` turns the connection into a plain stream.
- **The device id** a bundle names is novad's own, `nova-` and 16 hex
  digits of the SHA-256 of the device's key (which only Full Erase
  changes), not the platform registration's: a direct push needs no
  sign-in. P4's grants name it; the device reports it at registration.
- **A paired computer's own bundle applies at once**; one signed by the
  platform's key, a granted key, or another paired computer's key waits
  in Pushed Changes for the owner's Apply with the passcode (checked by
  `novad`, through `com.palm.systemmanager/matchDevicePasscode`).
- **Grants and revocations** (9.1) are JSON certificates with detached
  signatures by the platform's dev-signing key (`lib/trust.js` documents
  both; `addGrant`, `setRevocations`); the platform's key is pinned in
  `/etc/palm/phoenix/servers.json` `"devpush": {"key"}`. Counters per grant
  or key and the daily rate are kept in `/var/lib/phoenix/nova/` and
  outlive Revert to Image. `verify()` weighs every trust entry of the
  signing key (any live grant that allows the bundle authorizes it; the
  reason given otherwise is the newest grant's). A revocation list removes
  the revoked paired keys and their SSH lines, and `lib/proto.js` closes
  their connections and refuses them at the handshake. A pairing run's
  confirmation is taken only in the window it began in.
- **The Luna methods** are 7.4's plus `restartNow`, `addGrant`,
  `setRevocations`, `restart` and `rescan` (what `nova` needs); every one
  but `getStatus` answers `NEEDS_DEVMODE` with Developer Mode off.
- **Restarts**: `app:<id>` closes the app and opens it again only if it
  was open; `rescan` is Palm's `com.palm.applicationManager/rescan`, and
  where the image has none the change waits for a restart ("Restart the
  device to finish").
- **`.ipk`**: `ipk.js` moved into `@phoenix/platform`; the Marketplace's
  `lib/ipk.js` re-exports it. `devpush.js verify` takes `spaceLeft` as a
  function of the manifest (replace counts only the bundle's files).
- **The simulator**: `nova pair -d sim` and `nova push -d sim` use the
  same protocol and pairing with `services/nova/sim.js`, which phoenix-sim
  starts over its data folder. Its image is the checkout it runs (build
  `sim`, compatible `phoenix-sim`); its overlay is
  `<data>/var/lib/phoenix/overlay/sim/upper`, read first by phoenix-sim and
  serve-rootfs.py while `active` is beside it (".wh." files for removals);
  the shell loads from a tree with the pushed QML and assets in their
  places; every restart is a restart of the simulator (opening the app a
  push changed). Settings reaches it through the runtime and a
  token-guarded HTTP server on 127.0.0.1.
- **nova push PATHS** takes repository paths (`shell/qml`, `apps/settings`,
  `services/updates`, `runtime`) as well as device paths. A push from a
  checkout that is the image's (nothing differs) reverts what the overlay
  holds (replace with nothing).
- Not built in P2: mDNS discovery (`nova devices` probes the paired
  devices and the USB address), `nova install`/`launch`/`send`, the
  journal filter's exact units (G3), `nova forward` of JavaScript services'
  inspector ports.

**What P3 must provide** (meta-phoenix; P2 put each behind an interface):
- `novad.service`: `node /usr/palm/services/org.webosphoenix.nova/service.js`
  as root, long-running; the hub's service file says `Type=static`
  (`sysbus/org.webosphoenix.nova.service`).
- `phoenix-overlay.service`: `node .../boot.js` before the hub,
  WebAppMgr and luna-surfacemanager (it clears after Revert to Image,
  drops what reverts left, mounts with the image's copy bind-mounted at
  `/run/phoenix/overlay/lower/<mount>` and the refused paths bound back).
- Phoenix's Developer Mode provider keeping `/var/luna/dev-mode-enabled`.
- `/etc/phoenix/nova.json`: `usbAddress` (the CDC NCM gadget's address;
  172.16.42.1 assumed), `shellUnit` and `wamUnit` (the real unit names;
  `luna-surfacemanager.service` and `webapp-mgr.service` assumed),
  `authorizedKeys` (the `user` account's, for `nova term`).
- The image's manifest (8.1), a pinned `"devpush": {"key"}` in
  servers.json, `ls-control` and `com.palm.configurator` on the image, a
  rescan for apps (Phoenix's `com.palm.applicationManager` has none on a
  device), and a Luna role for `luna-send -a org.webosphoenix.nova.developer`
  (nova luna-send).
- `com.palm.update` deleting overlays of other builds at mark-good (4.6).

## 13. Decisions (the owner, 26 November 2026)

The owner answered questions 1, 3, 4 and 5; the rest take the
recommendation they had, and the owner can change any of them.

| # | Decision |
| --- | --- |
| 1 | **`nova` / `novad`** (`org.webosphoenix.nova`), "developer overlay", "dev bundle", "Pushed Changes", "Revert to Image" |
| 2 | Dev bundles are `.ipk` files with a signed manifest |
| 3 | **Both:** the platform's dev-signing key ("master"), and developer keys the owner grants, **with an extra layer on granted keys** to make abuse harder (section 9.1) |
| 4 | **A six-digit code for both** the LAN and USB; no Allow-only shortcut on USB (section 6.4) |
| 5 | **Keep LG's `novacomd` for vintage tools**, behind its own switch (section 9.6) |
| 6 | Developer Mode off: the overlay stays inactive on disk until Revert to Image or the next update |
| 7 | Bundles may carry Luna role and permission files, listed separately on the Apply screen; for granted keys only when their grant allows it (section 9.1) |
| 8 | Apply from the server channel asks the device passcode every time |
| 9 | Server limits: 64 MB per bundle, kept 14 days |
| 10 | Overlay cap on the device: 256 MB, a Developer Mode setting |
| 11 | Port 6965 for `novad`, after checking IANA's registry |
| 12 | 2.0 devices take no 1.0 bundles |

## 14. Docs to update when it is built

- `docs/COMMANDS.md`: the `nova` commands, through `tools/commands-doc.py`
  (then `./phoenix test --quick commands-doc`).
- [APP-RUNTIME.md](APP-RUNTIME.md): "Developer Mode" (Pushed Changes, pairing,
  the switches) and "System updates" (the overlay is cleared on mark-good).
- [PLATFORM-CLIENT.md](PLATFORM-CLIENT.md): new touchpoints (the device's
  polls and result), `platform-api/openapi.yaml` and the schemas; the
  `devpush` scope.
- [TERMINAL.md](TERMINAL.md): `phoenix-devmode`'s contents and the security
  table; [AI-AND-MCP.md](AI-AND-MCP.md) if MCP's developer tools use it.
- [PRE-IMAGE-CHECKLIST.md](PRE-IMAGE-CHECKLIST.md): the devmode provider,
  the overlay unit, the USB gadget; S3, U1 and U5 notes.
- [HARDWARE.md](HARDWARE.md): the USB network gadget per device.
- [LEGAL.md](LEGAL.md): novacomd read for reference (Apache-2.0); LuneOS's
  devmode service read only (GPL-2.0, nothing copied).
- `docs/spec/feature-inventory.md` and `docs/spec/GAPS.md`: Developer
  Mode's developer tools; [ROADMAP.md](ROADMAP.md) and
  [STATUS.md](STATUS.md).
- `README.md`'s test table for `tools/test-nova.cjs`; `tools/web-tests.txt`;
  a quick check in `tools/ci-checks.sh` for the bundle maker.
- Phoenix-Web-Services: `docs/DEPLOY.md` (storage, the scope),
  `docs/RUNBOOK.md` (expiry job), its feature audit.

## 15. Sources

- novacomd, the version LuneOS builds: <https://github.com/webOS-ports/novacomd>
  at `537338a8` (`include/novacom.h:27-32`, `src/novacom/commands_device.c:975-981`,
  `src/device/auth.c:42, 86-136`, `src/main.c:870-871`,
  `files/launch/device/novacomd.conf.in`, `CMakeLists.txt:52-53, 88`).
- meta-webos-ports `wrynose` at `9abe603b` (the pin of
  [LUNEOS.md](LUNEOS.md)): <https://github.com/webOS-ports/meta-webos-ports>
  (`meta-luneos/recipes-webos-owo/novacomd/novacomd.bb`,
  `meta-luneos/recipes-core/packagegroups/packagegroup-webos-extended.bb:21, 176`,
  `meta-luneos/recipes-core/packagegroups/packagegroup-luneos-extended.bb:88`,
  `meta-luneos/recipes-luneos/services/org.webosports.service.devmode.bb`,
  `meta-luneos/classes/luneos_image.bbclass:4`).
- LuneOS's Developer Mode service:
  <https://github.com/webOS-ports/org.webosports.service.devmode> at
  `65588c2d` (`DevModeAssistants.js`, `services.json`; GPL-2.0, read only).
- Open webOS luna-sysmgr: <https://github.com/openwebos/luna-sysmgr> at
  `1393f0a` (`LunaSysMgr.upstart`,
  `Src/base/application/ApplicationManagerService.cpp:2985`).
- Open webOS luna-applauncher (in `third_party/`): `app/LaunchPointSearch.js`.
- webOS Archive's webos-sdk-redux: <https://github.com/webOSArchive/webos-sdk-redux>
  ([COMMUNITY-FEATURES.md](COMMUNITY-FEATURES.md)).
- webOS Internals: "Accessing Linux Using Novaterm"
  <https://wiki.webos-internals.org/wiki/Accessing_Linux_Using_Novaterm>,
  "Novacom" <https://wiki.webos-internals.org/wiki/Novacom>, "Make USB
  Partition Writable via SFTP" (remount) <https://wiki.webos-internals.org/wiki/Make_USB_Partition_Writable_via_SFTP>.
- Palm SDK tools described: Mitch Allen, *Palm webOS* (O'Reilly, 2009),
  chapter 2 <https://www.oreilly.com/library/view/palm-webos/9780596802097/ch02s01.html>;
  Steve Lemke, "Debugging webOS", Palm Developer Day 2010
  <https://www.slideshare.net/slideshow/lemke-steve-debugging-palm-dev-day/3875650>.
- webOS OSE's CLI (`ares-push`, `ares-pull`, `ares-shell`):
  <https://www.webosose.org/docs/tools/sdk/cli/cli-user-guide/>.
- webosbrew, filesystem overlays on a read-only webOS root:
  <https://www.webosbrew.org/pages/filesystem-overlays>.
- Phoenix-Web-Services (private): `routes/api.php`,
  `app/Http/Controllers/Api/V1/FeedController.php`,
  `app/Providers/AppServiceProvider.php:62`,
  `app/Domain/Platform/ServerConfiguration.php`, `docs/KEYS.md`,
  `signer/README.md`.
