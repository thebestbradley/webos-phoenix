# Before the first device image

Everything we know would make the first Phoenix device image fail to build,
fail to boot, or need a rebuild, found by reading the recipes against
meta-webosose's layers and OSE's sources, and by the checkers below, which
keep looking in CI. The aim: build the image a few times, not a hundred.

This list covers the image, the platform under the shell and the device as
a whole. What the simulator does in one process that a device does across
the bus (every simulated Luna service, every place the shell draws into a
page, WebAppMgr's injection, sheets) is
[DEVICE-AUDIT.md](DEVICE-AUDIT.md)'s; rows here point there instead of
repeating it. The on-screen keyboard (Maliit, GAPS V5) and the app SDK
have their own owners too.

Status, as in [GAPS](spec/GAPS.md):

| | Meaning |
| --- | --- |
| ✅ | Done, or checked: nothing to do before the image |
| 🟡 | Written or decided, not yet tried on an image or a device |
| ⬜ | To do |
| 🚫 | Needs hardware, or an owner decision ([OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)) |

Audited 10 October 2026 against `build-webos` `ae3601d` (OSE 2.28.0,
scarthgap, Qt 6.8.1) and meta-webosose `d7ed46c`.

## Summary

| Area | ✅ | 🟡 | ⬜ | 🚫 | Rows |
| --- | --- | --- | --- | --- | --- |
| B. The image build | 7 | 4 | 4 | 0 | 15 |
| C. Luna calls and permissions (checker rows) | 0 | 1 | 5 | 0 | 6 |
| F. First boot | 2 | 4 | 3 | 0 | 9 |
| D. Display | 0 | 3 | 2 | 1 | 6 |
| I. Input | 0 | 2 | 2 | 1 | 5 |
| A. Audio | 0 | 1 | 2 | 0 | 3 |
| N. Networking | 1 | 1 | 1 | 1 | 4 |
| S. Storage | 0 | 1 | 2 | 0 | 3 |
| U. Updates | 0 | 1 | 3 | 1 | 5 |
| R. Recovery and factory reset | 0 | 0 | 2 | 1 | 3 |
| G. Debugging a device | 1 | 2 | 1 | 0 | 4 |
| P. Performance on a Pi 4 | 0 | 0 | 3 | 0 | 3 |
| X. Security | 1 | 1 | 2 | 1 | 5 |
| L. Licences | 1 | 2 | 1 | 0 | 4 |
| Q. What the platform needs on the device (PLATFORM.md 12) | 0 | 0 | 6 | 1 | 7 |
| H. Per device | 0 | 1 | 2 | 1 | 4 |
| **Total** | **13** | **24** | **41** | **8** | **86** |

**The few that would stop the first image outright**, all fixed here:
phoenix-apps' `FILES` left 580 installed files unpackaged (do_package's
installed-vs-shipped error, B4); the apps were never built for the image and
install-rootfs.py left them out silently (B3); two packages installed Open
Sans (B5); no app had luna-service2 role or permission files, so luna-hub
would have refused every app's every call (C4, F7). **The ones that would
make it boot to a broken system**, open: the original apps' and Phoenix's
legacy service names that OSE does not have (C1-C3, the device audit's), the
apps' missing ACG groups (C4), OSE's own home, status bar and notification
apps beside Phoenix's (F3), no device.json for either machine (H1), and the
default image being a pre-release one with root and no password (X1).

## Checkers

Static checks that run in CI (`.github/workflows/ci.yml`, "Device readiness
checkers", after the apps' build) and locally:

```sh
./phoenix check-device            # all of them, with a summary (tools/check-device.sh)
./phoenix check-device --all      # also the known findings, with owner and row
./phoenix check-device --parse    # and scripts/parse-check.sh (bitbake parse and dry run)
python3 tools/test-devicecheck.py # the checkers' own tests (fixtures in tools/fixtures/devicecheck)
```

| Checker | Finds | Findings (10 Oct 2026): fixed / known |
| --- | --- | --- |
| `tools/check-luna.py` | every `luna://` and `palm://` call in code that runs on a device (the image's apps and their overlays, the frameworks, `@phoenix/luna` charged to the apps that import each part, Phoenix's Node and native services, the device shell, the runtime's device half) against its provider (OSE's services from their own sysbus files, `tools/devicecheck/ose-services.json`; Phoenix's services with sysbus files in the image) and the caller's ACG groups (appinfo `requiredPermissions`, `compat/app-permissions.json`, `.perm.json`, the shell's perm files): unknown service, unknown method, missing permission, no permissions, role outbound, undefined group. `--suggest` prints the groups each app's calls need | 28 fixed (perm files, the Hardware service's api file, the original apps' groups); then, with the device audit's services (`services/appmanager`, `devices`' `com.palm.power`, `shellhost`, `accessories`, `dropshare`), their 61 callers' groups granted, `getAppBasePath` served, and the checker taught signals a service sends, base URIs and luna-service2's `*` client groups / 158 known |
| `tools/check-simrefs.py` | loopback addresses, `phoenix://`, simulator-only services and phoenix-sim's QML context properties in device code; placeholder, hard-coded and plain-HTTP servers in the update, catalog and driver configuration | 1 fixed (DropShare's loopback fallback) / 12 known |
| `tools/check-image.py` | what install-rootfs.py installs against phoenix-apps' `FILES`; paths two packages install; read-only device paths code names that nothing installs; Node services' `require()`s that do not resolve in the image; QML modules the device shell imports that OSE does not build or phoenix-shell does not RDEPEND on | 8 fixed (7 unpackaged paths, 1 conflict) / 2 known |
| `tools/check-recipes.py` | `LICENSE` / `LIC_FILES_CHKSUM` (and each checksum against the file in this repository), unpinned sources (AUTOREV, downloads without sha256sum), `file://` sources that are not there, network in task bodies, the Exec programs services need in RDEPENDS, systemd units (ordered after `ls-hubd`, Requires, WantedBy, named by a recipe), luna-service2 `.service` files (each name of a `;` list) against their role files and install paths | 1 fixed (mojoservicelauncher) / 5 known |
| `tools/check-licences.py` | every picture, sound, font and model the image ships traced to a PROVENANCE.md, notice, licence or `hidpi-art.json`; submodules' licences; recipes' licences; the GPL/LGPL components in LEGAL.md's Source offer | 17 fixed (LEGAL.md's Source offer), 1 (Voice Memos' samples) / 1 known |

Known findings are in `tools/check-device-allowlist.json`, each with its
owner and its row below; a finding that is not there fails CI, and an entry
nothing matches any more is reported as stale (`--strict` fails on it), so
the list only shrinks. To add a provider OSE has but the generated list
lacks, or a service the runtime answers inside the page on a device, edit
`tools/devicecheck/ose-extra.json`; regenerate `ose-services.json` with
`tools/devicecheck/gen_ose_services.py` when `setup-build.sh`'s pin moves.

What they cannot see: calls whose service name is built at run time, what
a page's iframe or a downloaded app calls, behaviour (a method that exists
but answers differently: the device audit's), anything only a build or a
boot shows (the rest of this list).

## B. The image build

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| B1 | The image has never been built | ⬜ | platform | Needs an x86-64 Linux host (Ubuntu 22.04 or 24.04; macOS cannot: BUILDING-MAC.md), about 250 GB free (OSE's own figure is 200 GB, plus the firmware, the assistant's models and two machines' sstate), 16 GB RAM or more, and 6-10 hours for the first `bitbake webos-phoenix-image` on 8 cores (OSE's Chromium alone is 3-5 h); later builds from sstate take minutes. Not as root; on Ubuntu 24.04 lift AppArmor's userns restriction (HARDWARE.md, Build). `scripts/setup-build.sh` then `bitbake webos-phoenix-image`, with `PHOENIX_SRCREV` and `PHOENIX_APPS_DIST` set (B3, B6) |
| B2 | Parse and dry run for `qemux86-64` and `raspberrypi4-64` | 🟡 | platform | `scripts/parse-check.sh` in CI (`.github/workflows/parse.yml`) on every PR. Not run in this audit's container (under 1 GB of disk free); CI runs it on these changes (the new `phoenix-diag` recipe, phoenix-apps' `SRC_URI` and `RDEPENDS`, the image's `IMAGE_FEATURES:remove`). It cannot see a wrong checksum, a missing `file://` or a compile error: `check-recipes.py` now covers the first two |
| B3 | The web apps reach the recipe built | 🟡 | platform | **Was broken:** phoenix-apps runs `install-rootfs.py` with no build step, so every React, Enact and Flutter app (40) was silently missing and the Fediverse service's `@phoenix/connector-kit` stopped do_install. BitBake allows no npm in do_compile. Now: CI packs the built apps (`tools/pack-apps-dist.sh`, artifact `apps-dist`), local.conf names it (`PHOENIX_APPS_DIST`), and install-rootfs.py stops with "the app is not built" rather than leave one out. Later: a release asset per tag, fetched with a checksum, or OE's npmsw fetcher (Q67) |
| B4 | phoenix-apps packages everything it installs | ✅ | packaging | **Was broken:** `/etc/palm/{backup,hardware,marketplace}`, `/etc/palm/updates.json`, `/etc/palm/sysservice-backupkeys.json`, `/usr/lib/luna` (Just Type's and the system alerts' 570 files) and `/usr/palm/command-resource-handlers.json` were in no package: do_package's installed-vs-shipped QA error. `FILES` now takes `/usr/palm`, `/usr/lib/luna`, `/etc/palm` whole; `check-image.py` keeps it so |
| B5 | No path from two packages | ✅ | packaging | **Was broken:** phoenix-shell (CMake) and phoenix-apps (rootfs.json's mount) both installed `/usr/share/fonts/open-sans`. install-rootfs.py leaves it to phoenix-shell (`SHELL_OWNS`); `check-image.py` checks every CMake install against the plan |
| B6 | Sources pinned | ⬜ | platform | The five recipes that build this repository default to `AUTOREV` (`PHOENIX_SRCREV ?= "${AUTOREV}"`): the parse asks GitHub, and each build takes whatever `main` has. Fine for development; a release must set `PHOENIX_SRCREV` to the tagged commit (and the parse check does). Every download is pinned by sha256 (`check-recipes.py`) |
| B7 | Licence checksums | ✅ | packaging | Every `LIC_FILES_CHKSUM` that names a file of this repository matches it, and the common licences' md5s are OE's (`check-recipes.py`) |
| B8 | Runtime dependencies | ✅ | packaging | phoenix-apps' services run under `run-js-service`: it now RDEPENDS on `mojoservicelauncher` (webos-image brought it only through a `VIRTUAL-RUNTIME` some machines empty). `check-recipes.py` maps each service's Exec to its package |
| B9 | Qt modules on the image | 🟡 | shell / keyboard agent | The device shell imports QtQuick, QtQml.Models, QtQuick.Shapes (qtdeclarative), Qt5Compat.GraphicalEffects (qt5compat: in RDEPENDS) and luna-surfacemanager's WebOS* modules: all built by OSE (`check-image.py`). OSE's qtbase drops Widgets and D-Bus for the target (Phoenix.Native needs neither). **Qt Multimedia:** meta-webos skips meta-qt6's and builds its own 6.0 fork; phoenix-shell does not DEPEND on it, so Phoenix.Native builds without `PHOENIX_HAVE_MULTIMEDIA`: dictation has no microphone on the device (the keyboard agent's V5) |
| B10 | Node services resolve in the image | ✅ | packaging | Every `require()` of every service resolves to a Node built-in, OSE's `webos-service`, a file the service carries or a shared package install-rootfs.py copies in (`check-image.py`) |
| B11 | Each app's ACG files | ✅ | packaging | **Was broken:** OSE writes `roles.d/<id>.app.json` and `client-permissions.d/<id>.app.json` for its own apps from appinfo.json (`webos_app_generate_security_files.bbclass`); phoenix-apps does not inherit it, so no Phoenix or original app had them and luna-hub would refuse them. install-rootfs.py now writes them the same way (tested in `test-devicecheck.py`) |
| B12 | Activities registered | ✅ | packaging | **Was broken:** the Clock's and Calendar's activities (alarm updates, reminders) were installed inside their app folders, where nobody reads them; OSE's configurator registers `/etc/palm/activities/applications/<id>/` (`ActivityConfigurator.cpp:36`), where install-rootfs.py now puts them |
| B13 | The image's size | ⬜ | platform | Firmware 570 MB uncompressed (216 MB with `PHOENIX_FIRMWARE_COMPRESS = "xz"`), the assistant about 270 MB plus the 639 MB built-in model, Chromium, Qt: expect 3-4 GB of rootfs. webos-image adds only 512 MB of free space (`IMAGE_ROOTFS_EXTRA_SPACE`); a 16 GB SD card for the Pi; measure after B1 and set the partition sizes with U1's layout |
| B14 | The OSE layers' future | ⬜ | owner decision | OSE has been quiet since March 2025 (HARDWARE.md (a)); scarthgap is supported to April 2028. Not a blocker for the first image |
| B15 | The repository's symlink in the build | 🟡 | platform | `setup-build.sh` links this checkout into build-webos and registers `meta-phoenix` at priority 60; the recipes fetch from GitHub, not the link, so local changes need a push (or `EXTERNALSRC`) before they reach an image. Documented for whoever builds first |

## C. Luna calls and permissions

What `check-luna.py` finds, by kind; each finding is in the allowlist with
its owner. Counts are on 10 October 2026.

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| C1 | Services OSE does not have under the names called (36) | ⬜ | device audit | Legacy names the runtime does not alias yet, or that Node services and the shell call directly (no alias there): `com.palm.activitymanager` (54 calls, OSE: `com.webos.service.activitymanager`), `com.palm.connectionmanager` from the updates service, `com.palm.audio`, `com.palm.storage`, `com.palm.telephony`, ...; and two wrong names in Phoenix's code: the shell asks `com.webos.service.devmode/getDevMode`, OSE's is `com.palm.service.devmode` (Lsm, `LsmSystemStatus.qml:241`), and `com.webos.service.vpn` has no provider. DEVICE-AUDIT.md section 2 has the plan for each. `com.palm.power` (`services/devices`), `com.palm.applicationManager` (`services/appmanager`) and `com.palm.downloadmanager` (the runtime's alias) now resolve |
| C2 | The original apps' account transports and app services (18) | ⬜ | device audit, Synergy | `com.palm.eas`, `imap`, `pop`, `smtp`, the Facebook, Google, Yahoo and LinkedIn contacts, calendar, photos and videos services, `com.palm.service.accounts`, `contacts`, `contacts.linker`: the Open webOS transports, not on OSE (DEVICE-AUDIT.md: `compat/app-services`, mojomail) |
| C3 | Phoenix services only the simulator has (10) | 🟡 | device audit | `org.webosphoenix.dictation`, `.share`, `.filepicker`, `.service.mediafiles`, `.service.location`, `.service.reset`, `.simulator`, `org.webosports.service.torch`, `.messaging`: device services are being written (DEVICE-AUDIT.md); as each lands with its sysbus files the finding goes stale. Landed: `.ongoing` and `.system` (`services/shellhost`), `.usb`, `.tethering`, `.gamepads`, `.battery` (`services/accessories`), `.dropshare`, `.service.xmpp` (the Jabber connector package, `apps/connectors/xmpp`), each caller with the groups their api files ask for |
| C4 | Apps without the ACG groups their calls need (58) | ⬜ | each app's owner; device shell | 14 Phoenix apps declare no `requiredPermissions` (Settings needs 29 groups, First Use 17), and others lack some (Weather, Photos, Agenda: the system service's; Music, Podcasts: audio focus). `tools/check-luna.py --suggest` prints each app's list. The original apps now get theirs from `compat/app-permissions.json` (Q68), the device audit's services' groups included (`phoenix.appmanager.*`, `devices.power.*`, `download.*`; the system UI's Luna Restart is `phoenix.system.restart`, oem only); Print Manager declares its one group; Music and Podcasts `phoenix.system.media`. The shell's remaining one: `audio.previlagequery` for `getPlaybackStatus` was added; luna-surfacemanager's own perm file still applies |
| C5 | Methods the provider does not have (14) | ⬜ | device audit; keyboard agent | SAM has no `open` or `listAllHandlersForMime` (`@phoenix/luna`'s calls of `com.webos.applicationManager`; `services/appmanager` serves them, and dock mode, `searchApps` and `getAppBasePath`, under the legacy name); OSE's activitymanager has no `getDetails` (its `getActivityInfo`) and luna-downloadmgr no `filesysStatusCheck` (luna-systemui's calls; not ours to add); `com.palm.systemmanager` lacks the debug overlays, `takeScreenShot`, `getBootStatus`, `publishToSystemUI` on the device; audiod has no `playFeedback`; mediaindexer no `phoenix/thumbnail`; luna-sysservice no ringtone list; the transcriber no `listen` (dictation, V5). The Hardware service's five missing api entries were fixed |
| C6 | Groups nobody defines (22) | ⬜ | each app's or service's owner | `media.operation`, `torch.operation`, `settings.read`, `applications`, `vpn.management`, `telephony.query`, `accounts.operation`, `messaging.operation`, ...: either the service that would define them is not on the image (C1-C3) or the name is wrong (OSE's are `settings.query`, `audio.operation`, `networkconnection.query`); fix with the provider |

## F. First boot

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| F1 | Phoenix's systemd units | ✅ | packaging | `phoenix-devices` and `phoenix-pty` are After= and Requires= `ls-hubd.service`, WantedBy `multi-user.target`, enabled by their recipes; the Node services are started by the hub on first call (Type=dynamic) and their `.service` files name the role and the path install-rootfs.py uses (`check-recipes.py`) |
| F2 | luna-surfacemanager runs Phoenix's QML | 🟡 | device shell | `product.env` (phoenix-shell) sets `WEBOS_COMPOSITOR_IMPORT_PATH=/usr/share/phoenix/qml`, which `surface-manager.sh` sources (`base/startup/surface-manager.sh.in:59`) and `weboscompositorconfig.cpp:98` reads; `shell/qml/WebOSCompositor` overrides ViewsRoot. No other package installs a `product.env` for the two machines (meta-webosose, meta-webos-raspberrypi checked). The geometry comes from configd (`com.webos.surfacemanager.compositorGeometry`) or 1920x1080 |
| F3 | OSE's own UI apps beside Phoenix's | ⬜ | owner decision (Q69) | webos-image installs `com.webos.app.home` (which SAM keeps alive, `sam-conf.json.in` keepAliveApps), `com.webos.app.statusbar`, `.notification`, `.volume`, `.settings`, `.mediagallery`, `.camera`, the Enact browser, `.videocall`, `.imageviewer`, `.mediaviewer`: duplicates of Phoenix's, using memory, possibly showing as cards. Set their `VIRTUAL-RUNTIME_*` to "" (packagegroup-webos-extended, -systemapps) in the distro or local.conf, and SAM's keepAliveApps |
| F4 | The boot animation's hand-over from bootd | 🟡 | device shell | Waits for `com.webos.bootManager/getBootStatus` boot-done, at least 4 s, at most 90 s (Q19) |
| F5 | First Use on a device | ⬜ | device shell, First Use | Nothing launches `org.webosphoenix.firstuse` on a device's first boot yet (the simulator's `simFirstUse`); its Wi-Fi step needs the keyboard (V5) or a list to tap; it needs 17 ACG groups and declares no `requiredPermissions` (C4) |
| F6 | Locale, time zone, time | ⬜ | platform | OSE's defaults are en-US and UTC from luna-sysservice's and settingsservice's defaults; First Use sets them, but its calls need the groups (C4). The Pi has no RTC: time comes from NTP once online (the vendor NTP zone is Q in PLATFORM.md 12) |
| F7 | db8 kinds and permissions | 🟡 | packaging | install-rootfs.py puts each app's `configuration/db/kinds` and `permissions` in `/etc/palm/db/`, which OSE's configurator registers at boot (`BusClient.cpp:47`). Apps' kinds written by code at first launch (the React apps' `putKind`) need `database.operation` (C4) |
| F8 | Activities registered | ✅ | packaging | B12 |
| F9 | Optional configuration with defaults | 🟡 | each service's owner | `/etc/phoenix/transcriber.json` (Voice Memos' transcriber: model and threads) is read when present; no recipe installs one, so the defaults apply. Known finding of `check-image.py` |

## D. Display

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| D1 | Wayland and the compositor's platform | 🟡 | platform | luna-surfacemanager is a Qt Wayland compositor on `eglfs_webos` (KMS); the apps' Chromium (WebAppMgr) and Maliit are its clients. Configured per machine by meta-webos; nothing Phoenix changes |
| D2 | Scale and density per device | ⬜ | platform, per device | The shell sizes itself from the screen (phone or tablet by size) and `WEBOS_COMPOSITOR_GEOMETRY`'s scale; the Pi's 7" panel is 800x480 (smaller than the Pre 3's layout expects in landscape): set the geometry with configd per machine and check the launcher's columns and the gesture bar there (H1) |
| D3 | Fonts | 🟡 | packaging | Open Sans (Prelude's stand-in) and Noto Color Emoji with its fontconfig file are installed by phoenix-shell; OSE's `webos-fonts` brings LG's; the web apps find Open Sans through fontconfig. Check `fc-list` on the image |
| D4 | GPU vs software rendering | ⬜ | platform | qemux86-64: virtio-gpu with virgl needs `-device virtio-vga-gl -display sdl,gl=on`; without GL, Qt and Chromium fall back to software and the card animations will crawl. Pi 4: V3D (Mesa) through meta-raspberrypi's `vc4-kms-v3d` overlay; check `/sys/class/drm` (phoenix-diag) |
| D5 | Rotation | 🟡 | device shell | Written against phoenix-devices' accelerometer (GAPS R1); the Pi's panel has no sensor, so it stays put |
| D6 | The Pi's official 7" display (DSI) | 🚫 | hardware | Needs the `vc4-kms-dsi-7inch` overlay in `config.txt` (meta-raspberrypi `RPI_EXTRA_CONFIG`), and it is upside down in most cases (`lcd_rotate=2` no longer works with KMS: a rotation in the compositor's geometry instead). Try on the device |

## I. Input

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| I1 | Touch | 🟡 | platform | Qt's evdev/libinput touch through luna-surfacemanager; the official display's touch (`rpi-ft5406`, edt-ft5x06) comes with the overlay; calibration matches the panel unless the panel is rotated (then the touch must turn with it: `WEBOS_COMPOSITOR_GEOMETRY`'s rotation does both) |
| I2 | Hardware buttons | 🟡 | phoenix-devices | Power, volume and Home from evdev (`phoenix-devices`, `com.palm.keys`), the shell's Home key (`Key_Home`, device.json `hardwareHomeButton`); a Pi has none, so the gesture bar does it all |
| I3 | The on-screen keyboard | ⬜ | keyboard agent | Maliit plugin (GAPS V5); until it lands, typing on a device needs a USB keyboard (First Use's Wi-Fi password, F5) |
| I4 | Gestures on the device's touchscreen | ⬜ | device shell | The gesture area and the edges were tuned with a mouse in the simulator; try the flick thresholds on the Pi panel's 800x480 |
| I5 | Mouse and keyboard on x86 | 🚫 | hardware | `WEBOS_CURSOR_HIDE=1` in product.env hides the cursor: right for touch, wrong for a laptop or qemu without touch; a per-machine setting |

## A. Audio

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| A1 | System sounds | 🟡 | packaging | audiod plays raw PCM only: phoenix-apps makes `.pcm` twins of every sound with mpg123-native at build time (`sounds-to-pcm.py`); added sounds have none (Q22) |
| A2 | Routing (speaker, headphones, HDMI) | ⬜ | platform | audiod-pro with PulseAudio; the Pi's 3.5 mm jack and HDMI are both ALSA cards: which is default comes from OSE's PulseAudio config for the machine; check with phoenix-diag's `aplay -l` and set it in the machine's configuration |
| A3 | The microphone (dictation, wake word, Voice Memos) | ⬜ | keyboard agent | No Qt Multimedia on the device (B9); the Pi has no microphone (USB) |

## N. Networking

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| N1 | connman and the Wi-Fi service | ✅ | platform | OSE's `webos-connman-adapter` (`com.webos.service.wifi`, `connectionmanager`) is on the image; the shell's perm file grants `wifi.query`/`wifi.management`/`networkconnection.query` |
| N2 | Wi-Fi in First Use without a keyboard | ⬜ | keyboard agent, First Use | F5, I3 |
| N3 | Firmware for Wi-Fi and Bluetooth | 🟡 | platform | `packagegroup-phoenix-firmware` and the Pi's `linux-firmware-rpidistro-bcm43455` (HARDWARE.md, Firmware in the image) |
| N4 | Servers on the device itself | 🚫 | owner decision (Q29); intended | Intended and fine: llama-server on 127.0.0.1 (the Assistant's model runner, `localmodels.cpp`, `node-device.js`), the "OpenAI-compatible" provider's `localhost:11434` default (a server the user runs), the VPN's `0.0.0.0` route, DropShare's server on every network (`0.0.0.0`; with no LAN address it refuses a session rather than offer the phone's loopback). Open: the OAuth loopback redirect (`services/oauth`, Q29). Known findings of `check-simrefs.py` |

## S. Storage

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| S1 | The media partition | ⬜ | platform | Phoenix installs ringtones and sample media into `/media/internal` (phoenix-apps). If the image mounts a separate media partition there (OSE images have none by default; a RAUC layout would, U1), the mount hides them: install the seed under `/usr/share/phoenix/media-seed` and copy on first boot instead |
| S2 | User data and permissions | ⬜ | platform | Services run as root (Node services under the hub) or the device user (phoenix-pty, uid 1000 `user`, group `media`); `/media/internal` must be writable by both (the group `media`); db8's data in `/var/db` |
| S3 | Read-only root | 🟡 | platform | The plan is EROFS/squashfs with `/var` and `/home` on the data partition (HARDWARE.md, OTA); code that writes outside them fails then: `check-image.py` checks that nothing reads paths nothing installs; writes are the device audit's |

## U. Updates

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| U1 | RAUC on the image | ⬜ | platform | **No RAUC recipe, keyring, `system.conf` or partition layout in meta-phoenix yet** (PLATFORM.md 12). The `com.palm.update` service calls `rauc` and answers that it is missing; add meta-rauc (scarthgap) to the layers, a `rauc-conf` bbappend per machine with the slots, and the wic layout with two root slots |
| U2 | Slots per target | ⬜ | platform | Pi 4: the firmware's `tryboot` or U-Boot (RAUC documents both); qemux86-64: GRUB or systemd-boot EFI |
| U3 | The keyring | ⬜ | platform, owner decision | The signing key's public half in the image; LGPL-3.0 (Qt) and GPL-3.0 (bash) need the owner able to install modified versions (LEGAL.md, Source offer): Developer Mode accepting the owner's key, or unsigned bundles in Developer Mode |
| U4 | The first OTA and rollback | 🟡 | updates service | `services/updates` reads the feed (`/etc/palm/updates.json`), downloads, `rauc install`, marks good after a good start; the feed URL is a placeholder (Q1) and `rauc-mark-good` after the boot is not wired (HARDWARE.md, OTA) |
| U5 | Firmware and driver updates | 🚫 | owner decision | The Hardware app installs opkg packages from the driver feed into the root, which an A/B update replaces: they must be reinstalled after each update, or go to a data overlay |

## R. Recovery and factory reset

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| R1 | Factory reset | ⬜ | device audit, platform | Settings' Erase calls `org.webosphoenix.service.reset` (the simulator's) and Security's erase calls `com.palm.storage/erase/Wipe`: neither exists on OSE (C1, C3, Q20). A device needs a reset service that wipes the data partition and reboots |
| R2 | Recovery boot | ⬜ | platform | With RAUC: the other slot. Without it, the Pi's SD card is the recovery. A recovery image (fastboot devices) later |
| R3 | A boot that never finishes | 🚫 | hardware | bootd's boot-done never comes: the animation ends after 90 s (Q19) and the shell comes up; ssh (Developer Mode) and phoenix-diag are the way in |

## G. Debugging a device

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| G1 | Getting in | 🟡 | platform | A default (pre-release) OSE image has Dropbear SSH and root without a password (X1): convenient for the first images, not for anything handed out. A production image needs Developer Mode to turn ssh on (`com.palm.service.devmode` is on the image) |
| G2 | One archive of everything: `phoenix-diag` | ✅ | packaging | `phoenix-diag` (meta-phoenix, in the image) writes `/media/internal/phoenix-diag/phoenix-diag-<host>-<time>.tar.gz`: the journal of the last boots and per unit (luna-hub, luna-surfacemanager with the shell's QML console, WebAppMgr and the apps' consoles, SAM, bootd, db8, Phoenix's services), dmesg, failed units, `systemd-analyze` blame and critical chain, coredumps, memory, storage, processes, packages, DRM, input, backlight, sound, USB and PCI devices, `phoenix-devices --probe`, the Pi's temperature and throttling, network state (no Wi-Fi secrets), `rauc status`, the bus's installed roles and permissions, and a few Luna answers. Run it as root over ssh |
| G3 | Logs by hand | 🟡 | everyone | `journalctl -b -u surface-manager-daemon` (the shell's `console.log`), `-u webapp-mgr` (pages' consoles), `-u ls-hubd` (refused calls show as "Permission denied" with the group: C4), `ls-monitor` for live bus traffic; `PmLogCtl` sets levels. WAM's remote inspector: `--remote-debugging-port` in webapp-mgr.sh (Developer Mode) |
| G4 | A crash reporter | ⬜ | platform | systemd-coredump keeps cores (phoenix-diag lists them); nothing sends them. Opt-in upload with the hardware report (HARDWARE.md) later |

## P. Performance on a Pi 4

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| P1 | Memory with every keep-alive app | ⬜ | platform | Measure with phoenix-diag's `ps`/`free` after boot: OSE's home app (F3), WebAppMgr's processes (one per running web app, about 60-120 MB each), the Assistant's model runner when used (llama-server: the model's size), Node services (30-50 MB each, started on first call, several keep themselves alive). OSE recommends 4 GB |
| P2 | WebAppMgr's process count | ⬜ | platform | Each card is a renderer; the original apps that run without a window (Email's, Calendar's background pages, `noWindow`) count too. Set WAM's process model and the shell's card limit from the measurements (MemoryMonitor's thresholds) |
| P3 | The boot story's cost | ⬜ | device shell | The start-up animation (11.5 s, particles and shaders) on V3D at 1080p: measure the frame rate (`QSG_RENDER_TIMING`); Reduce motion's version is the fallback (Q10, Q13) |

## X. Security

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| X1 | No root without a password, ssh off by default | 🚫 | owner decision (Q66) | OSE's default `WEBOS_DISTRO_PRERELEASE = "devel"` adds `debug-tweaks` and Dropbear at boot to every image. `PHOENIX_PRODUCTION = "1"` (webos-phoenix-image) now removes both; which is the default for images we hand out is the owner's call |
| X2 | ACG on | ✅ | packaging | luna-hub enforces API groups on OSE; every app now has role and permission files (B11) and the checker keeps calls and groups in step (C4-C6) |
| X3 | Services that run as root | ⬜ | platform | phoenix-devices (needs `/dev/input` and sysfs: udev rules for a `phoenix-devices` user would let it drop root, HARDWARE.md), the Node services run by the hub (as root, as OSE's own do), the Assistant's model runner under them. phoenix-pty runs as `user`. Tighten with dynamic users after the first boot works |
| X4 | Plain-HTTP servers | ⬜ | owner decision (Q65) | The Marketplace's PreCentral homebrew feed is `http://weboslives.eu` (off by default): anyone on the path can change the packages offered; and the App Museum's host is hard-coded in `appmuseum.js` (Q65) |
| X5 | The update and catalog keys | 🟡 | platform | Pinned production keys in `sources.json`, `catalog.json` and the RAUC keyring (U3, Q1-Q2) |

## L. Licences

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| L1 | Every shipped picture, sound, font and model traces to a licence | 🟡 | Settings | `check-licences.py`: PROVENANCE.md files, hidpi-art.json, the app icons' SVG sources, Open webOS's submodules; built apps' assets back to their sources, npm packages' to the apps' notices. Voice Memos' demo memos got their PROVENANCE.md (eSpeak NG, CC0). Left: Settings' `icons/exhibition-time.png` (and @2x, @3x), the Time exhibition's icon, whose origin nothing records (not the Clock's icon) |
| L2 | The GPL/LGPL source offer | 🟡 | platform | LEGAL.md, "Source offer": the components and the duty; a release build adds OE's archiver and publishes `deploy/sources` with `license.manifest`. Compare the first build's `license.manifest` with the list |
| L3 | Recipes' licences | ✅ | licences | Apache-2.0 and permissive, GPL-2.0 kernel modules only (`check-licences.py`). Waiting on the owner: `deltachat-rpc-server` (MPL-2.0, Delta Chat's core; not installed unless `PHOENIX_DELTACHAT = "1"`, OPEN-QUESTIONS Q80) |
| L4 | Firmware licences | ⬜ | platform | `phoenix-firmware-policy` checks them at image time (LEGAL.md, Firmware); only a build runs it |

## Q. What the platform needs on the device ([PLATFORM.md](PLATFORM.md) 12)

| Row | Item | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| Q1 | Real URLs and pinned keys | ⬜ | platform | `services/updates/etc/palm/updates.json` (`http://127.0.0.1:8088/updates/`), the Marketplace's `sources.json` (`http://127.0.0.1:8088/v1/`, key trusted on first use), `services/hardware/etc/palm/hardware/catalog.json`: before the first image (known findings of `check-simrefs.py`) |
| Q2 | Third-party catalogs | 🚫 | owner decision (Q65) | App Museum's host in code, PreCentral over HTTP (X4) |
| Q3 | The `dev` update channel and `rollout` | ⬜ | updates service | `updatesservice.js:81`, Settings > Updates; before the first image (Q56) |
| Q4 | RAUC keyring | ⬜ | platform | U1, U3 |
| Q5 | Connectivity probe and NTP vendor zone | ⬜ | platform | meta-phoenix configuration (connman's online check URL, timesyncd's servers) |
| Q6 | Device Info links to the release's source | ⬜ | Settings | With the source offer (L2) |
| Q7 | Catalog key delegation, revocations, the account service | ⬜ | platform | Before 1.0 (Q45, PLATFORM.md 12) |

## H. Per device

| Row | Device | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| H1 | `/etc/phoenix/device.json` for each machine | ⬜ | platform | Read by Phoenix.Native's DeviceConfig and phoenix-devices; no recipe installs one for `qemux86-64` or `raspberrypi4-64`, so every key takes its default (HARDWARE.md, Device configuration). Add a `phoenix-device-config` recipe with a file per machine (`device.json:<machine>`): the Pi has no Home button, backlight `rpi_backlight` on the 7" panel, no sensors |
| H2 | qemux86-64 | 🟡 | platform | The first image to boot: no touch (I5), virgl for GL (D4), no Wi-Fi, no battery (the status bar's battery must say so) |
| H3 | Raspberry Pi 4 (4 GB+), official 7" display | 🚫 | hardware | D6, I1, A2; no RTC (F6), no battery, no sensors, no microphone |
| H4 | Other devices in HARDWARE.md's tiers | ⬜ | platform | Each needs its BSP layer, adaptation package and device.json (HARDWARE.md, tiers (b) to (g)); not before the first image |
