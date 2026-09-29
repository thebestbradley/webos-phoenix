# LuneOS and webOS Phoenix

*For a shorter overview of the whole webOS family (webOS Community Edition,
LuneOS, OSE, Phoenix) see [WEBOS-FAMILY.md](WEBOS-FAMILY.md).*

LuneOS is the community operating system of the
[WebOS Ports](https://github.com/webOS-ports) project, and the closest
relative Phoenix has. This page compares the two, component by component,
and recommends what Phoenix should reuse, learn from, collaborate on or
ignore.

**How this was researched.** On 28 September 2026 we cloned the LuneOS
repositories read-only (`git clone --depth 1`) and read the code, and we
read their GitHub release pages and press coverage. Paths such as
`meta-luneos/recipes-luneos/...` are inside the cloned repository named
in the same row or paragraph. The commits we read:

| Repository | Branch | Commit | Last commit |
| --- | --- | --- | --- |
| [meta-webos-ports](https://github.com/webOS-ports/meta-webos-ports) | `wrynose` | `9abe603b` | 28 Sep 2026 |
| [luna-next-cardshell](https://github.com/webOS-ports/luna-next-cardshell) | `master` | `e92cd17` | 28 Sep 2026 |
| [luneos-components](https://github.com/webOS-ports/luneos-components) | `master` | `e7c905a` | 28 Sep 2026 |
| [luna-surfacemanager](https://github.com/webOS-ports/luna-surfacemanager) (fork of OSE's) | `webOS-ports/webOS-OSE` | `a02b75c` | 28 Sep 2026 |
| [webos-telephonyd](https://github.com/webOS-ports/webos-telephonyd) | `webOS-ports/webOS-OSE` | `cc8f15f` | 4 Sep 2026 |
| [nyx-modules](https://github.com/webOS-ports/nyx-modules) (fork of OSE's) | `webOS-ports/webOS-OSE` | `4f37fd6` | 28 Sep 2026 |
| [nyx-modules-hybris](https://github.com/webOS-ports/nyx-modules-hybris) | `master` | `d01ea62` | 27 Sep 2026 |
| [webos-keyboard](https://github.com/webOS-ports/webos-keyboard) | `master` | `7ab98aa` | 28 Sep 2026 |
| [luna-appmanager](https://github.com/webOS-ports/luna-appmanager) | `master` | `8ac0f73` | 13 Sep 2026 |
| [meta-smartphone](https://github.com/shr-distribution/meta-smartphone) | `wrynose` | `a8b6138` | 28 Sep 2026 |
| [meta-pine64-luneos](https://github.com/webOS-ports/meta-pine64-luneos) | `wrynose` | `e2f72c3` | 1 Sep 2026 |
| [webos-ports-setup](https://github.com/webOS-ports/webos-ports-setup) | default | `78480b4` | 28 Sep 2026 |
| [luneos-porting-mcp](https://github.com/webOS-ports/luneos-porting-mcp) | `main` | `e3310f6` | 25 Sep 2026 |
| [luna-next](https://github.com/webOS-ports/luna-next) | `master` | `62fac9f` | 24 Nov 2021 (retired) |

The project website and wiki, [webos-ports.org](https://webos-ports.org/),
returned HTTP 503 or reset the connection every time we tried on 28 September
2026, so nothing here is taken from the wiki. Where a fact comes only from
search-engine snippets or press, it says so.

## Summary

- **LuneOS is already built the way Phoenix plans to be built.** Since the
  Eiskaffee release (February 2024) it runs LG's webOS OSE components
  (luna-surfacemanager, SAM, WAM, db8, activitymanager, notificationmgr,
  luna-service2), and its card shell is a QML module named `WebOSCompositor`
  whose `ViewsRoot` replaces OSE's TV views. This is exactly Phoenix's
  `PhoenixViewsRoot` mechanism ([ARCHITECTURE.md](ARCHITECTURE.md)).
- **It is far ahead of us on the platform and on devices**, and it is very
  active right now: Yocto 6.0 wrynose, Qt 6.12, its own forward port of LG's
  web runtime to **Chromium 151** (OSE stopped at 120), and Halium and GKI
  ports to the Pixel 3a, 4a 5G, 6a, 7, Pixel Tablet, BlackBerry KEY2 and
  others, with testing images from September 2026.
- **It is behind us on faithfulness to the original UI.** Its card shell is
  a reimplementation that borrows the look of webOS; Phoenix is a
  measurement-by-measurement port of luna-sysmgr with a desktop simulator
  and tests.
- **Most of its device services are Apache-2.0 and can be reused as is**
  (telephony daemon, nyx modules, battery, display, haptics and auth
  managers, the LSM patches, the Chromium 151 port). Its shell, its
  components library and several apps are GPL-3.0 and cannot be copied into
  Phoenix.
- **Recommendation:** stop planning a separate device platform. Build
  Phoenix's device images on LuneOS's layer stack (`meta-webos-ports` plus
  `meta-smartphone`), make the Phoenix shell a second `WebOSCompositor`
  option on LuneOS, and contribute Apache-2.0 service work upstream to them.
  See [Recommendation](#9-recommendation).

## 1. What LuneOS is today

### History and releases

- WebOS Ports started porting Open webOS to other devices after HP released
  it in 2012; the distribution was renamed LuneOS with its first release,
  "Affogato", on 1 September 2014. Releases are named after coffee drinks
  ([Wikipedia](https://en.wikipedia.org/wiki/LuneOS)).
- The last **stable** release is
  [**Eiskaffee**](https://github.com/webOS-ports/luneos-releases/releases/tag/Eiskaffee),
  published 13 February 2024 and announced on 15 February
  ([pivotCE](https://pivotce.com/2024/02/15/luneos-february-stable-release-eiskaffee/),
  [Liliputing](https://liliputing.com/open-source-webos-port-luneos-eiskaffee-is-the-first-stable-release-in-five-years/)).
  It was the first stable release in five years (the previous one,
  "Eggnog Latte", was October 2019). Its notes: Qt 5 to Qt 6 (6.5.2), the
  luna-next compositor replaced by LG's luna-surfacemanager, LuneOS's own
  WebAppManager replaced by LG's WAM with Chromium 94, a rebase on webOS OSE
  2.23.0 with Enhanced ACG, and Pine64 devices added. Known issues were
  high power use and no audio in web apps.
- Since then there has been no stable release (as of 28 September 2026).
  **Testing builds** are published on
  [luneos-testing](https://github.com/webOS-ports/luneos-testing/releases):
  20240220 (OSE 2.25 components, Chromium 108, Qt 6.6.2), 20240228, then a gap
  until `pixel_20260904` (Pixel 6a and 7) and `20260911-LuneOS-Testing-Builds`,
  whose assets are dated 11 to 24 September 2026 and cover `athena`
  (BlackBerry KEY2), `bluejay` (Pixel 6a), `bramble` (Pixel 4a 5G), `sargo`
  (Pixel 3a), `tangorpro` (Pixel Tablet), `tissot` (Xiaomi Mi A1, Halium),
  the PinePhone, and an i.MX 8M Plus board called `comet` (*unverified*
  which device that is; its machine is not in `meta-smartphone`).
- Wikipedia still describes LuneOS as Qt 5.15-based; that is out of date.

### Activity

Activity is bursty and now very high, but concentrated in one person.

- `meta-webos-ports` commits per month (from its history): 30 to 85 a month
  through the first half of 2024, then 0 to 32 a month through 2025, almost
  nothing from August 2025 to July 2026 (2 in January, 1 in March, 1 in
  April), then **138 in August and 229 in September 2026**. Of the commits
  since September 2025, 347 of about 370 are by Herman van Hazendonk
  ("Herrie"), the rest by Martin Jansa, Christophe Chapuis ("Tofe") and the
  build bot.
- `luna-next-cardshell` has had 407 pull requests (406 closed); more than
  100 commits landed in August and September 2026, nearly all by Herrie,
  merged by Tofe, with smaller contributions from Alan Morford and
  codepoet80 (webOS Archive).
- The OSE fork of luna-surfacemanager carries about 73 LuneOS commits on top
  of LG's code, all dated September 2026 (*likely a recent rebase; the
  original dates are not visible in a shallow clone*).
- The GitHub organization lists 299 repositories
  ([webOS-ports](https://github.com/webOS-ports)).

The burst lines up with the wrynose bring-up (August 2026) and the new
Halium/GKI ports. It also means the project's bus factor is low.

### Base: Open webOS lineage plus webOS OSE

LuneOS is a mix. From `meta-webos-ports` at `9abe603b`:

| Origin | Components | Where |
| --- | --- | --- |
| **webOS OSE**, forked to `webOS-ports/*` repositories and rebased | luna-surfacemanager (compositor), SAM, WAM, db8, activitymanager, notificationmgr, luna-sysservice, settingsservice, configd, sleepd, audiod, qml-webos-framework, qml-webos-components, qml-webos-bridge, qtwayland-webos, nyx-modules, maliit-framework-webos, and about 100 more | `meta-luneos/recipes-webos-ose/`, `SRC_URI = "${WEBOS_PORTS_GIT_REPO_COMPLETE}"` (`meta-luneui/classes/webos_ports_repo.bbclass`) |
| **webOS OSE**, taken unchanged from `webosose/*` | com.webos.app.home (disabled: "LuneOS doesn't have a homeapp"), com.webos.app.statusbar, notification, volume, camera, mediagallery, com.webos.service.power2, webos-connman-adapter, and others | same directory, `SRC_URI = "${WEBOSOSE_GIT_REPO_COMPLETE}"` |
| **Open webOS** (Palm/HP, 2012) | core-apps (Enyo 1 Calendar, Email, Clock, Accounts...), Enyo 1.0, foundation and loadable frameworks, app-services, luna-applauncher (Just Type), luna-universalsearchmgr, luna-systemui, mojomail IMAP/POP/SMTP, novacomd, storaged, certmgrd | `meta-luneos/recipes-webos-owo/` ("owo" = Open webOS) |
| **Mojo 1.0**, extracted from a webOS 3.0.5 image | the Mojo framework, `LICENSE = "CLOSED"` | `recipes-webos-owo/frameworks/mojo-framework.bb` |
| **LuneOS's own** | luna-next-cardshell, luneos-components, luna-appmanager (legacy `com.palm.applicationManager`), luna-displaymanager, luna-authmanager, luna-haptics, com.webos.service.battery, webos-telephonyd, webos-keyboard, apps | `meta-luneos/recipes-luneos/` |
| **Sailfish / Mer / Droidian** | oFono with binder plugins, voicecall, sensorfw, libgbinder, nfcd, biomd, droidmedia, gst-droid | `meta-luneos/recipes-connectivity/`, `recipes-support/`, `recipes-multimedia/` |

The OSE base is **OSE 2.28**: commit `ec1b17a4` "OSE 2.28 rebase"
(15 June 2025), after 2.26 in June 2024 and 2.25 in January 2024. Since then
LuneOS has moved ahead of OSE on its own: wrynose, Qt 6.12
(`d2411a78`, `5dbf1a61`, August 2026) and Chromium 151.

**The web runtime.** `meta-luneos/recipes-webos-ose/chromium/webruntime_151.bb`
builds Chromium **151.0.7922.108** from
[`webos-ports/chromium151`](https://github.com/webos-ports/chromium151). The
comment in `webruntime-repo_151.inc` explains that LG never published a 151
tree, so LuneOS assembled one: pristine Chromium, then LG's "neva" webOS
port forward-ported from 120 to 151, then OpenEmbedded fixes from
meta-browser, then LuneOS's own patches, each kept as a separate layer. The
120 and 108 recipes are retired. This is a large piece of work Phoenix would
otherwise have to do itself, because OSE's last release ships Chromium 120
([HARDWARE.md](HARDWARE.md#a-webos-ose-targets)).

### Build system

- Yocto/OpenEmbedded. `webos-ports-setup/conf/layers.txt` pins bitbake 2.18,
  oe-core, meta-openembedded and meta-smartphone on **wrynose** (Yocto 6.0),
  **meta-qt6 6.12**, plus meta-pine64-luneos, meta-rpi-luneos,
  meta-raspberrypi, meta-arm and meta-rockchip. (The `meta-luneos/README`
  still says meta-qt6 6.5; it is stale.)
- `meta-webos-ports` has four layers: `meta-luneos` (the distro),
  `meta-luneui` (the webOS UI basics: luna-service2, nyx-lib, pmloglib,
  luna-sysmgr-common), `meta-luneos-backports-6.1` and
  `meta-luneos-holdbacks-5.3`.
- The distro is `luneos` (`meta-luneos/conf/distro/luneos.conf`), codename
  "Espressino", `WEBOS_DISTRO_API_VERSION = "3.5.0"`. Images are
  `luneos-dev-image` and `luneos-dev-package` (flashable zip for Halium).
- It does **not** use OSE's `build-webos`. OSE's recipes are copied into
  `meta-luneos/recipes-webos-ose/` and maintained there.

### Device support

Device layers live in
[`meta-smartphone`](https://github.com/shr-distribution/meta-smartphone)
(`wrynose`, `a8b6138`), `meta-pine64-luneos` and `meta-rpi-luneos`.
Machines at the commits we read:

| Kind | Machines |
| --- | --- |
| Generic Halium GSI rootfs | `halium-arm64` ("One LuneOS rootfs for every arm64 Treble device", `meta-android/conf/machine/halium-arm64.conf`), `halium-arm` |
| Google | `sargo` (Pixel 3a), `bramble` (4a 5G), `sunfish` (4a), `bluejay` (6a, Tensor, GKI kernel), `panther` (7), `tangorpro` (Pixel Tablet) |
| Others on Halium | `athena` (BlackBerry KEY2, SDM660, QWERTY), `radon` (FuriLabs FLX1s), `q25` (Zinwa Q25, BlackBerry Classic restomod, MediaTek), `mp01` (Minimal Phone, E Ink QWERTY), `mindphone` (GreenTouch, MT6739, T9 keypad), Xiaomi `tissot-halium`, `mido-halium`, `rosy`, `sagit`, `surya`, `oxygen`, Motorola `athene`, OnePlus `onyx`, Huawei `angler` |
| Legacy (Android 9 era) | HP TouchPad (`tenderloin`, `tenderloin-halium`), Nexus 4 (`mako`), Nexus 5 (`hammerhead`, `hammerhead-halium`), `mido`, `tissot` |
| Mainline | PinePhone, PinePhone Pro, PineTab2 (`meta-pine64-luneos`), Raspberry Pi (`meta-rpi-luneos`), `qemux86-64` (VirtualBox) |

Every Halium machine gets the same stack through the `halium` override
(`packagegroup-luneos-extended.bb`: LXC container, android-system, libhybris,
pulseaudio-modules-droid, ofono-binder-plugin, nyx-modules-hybris, qbootctl).
Per-device state is written up in `luneos-porting-mcp/knowledge/device-*.md`
(for example the Pixel 3a notes from 12 and 25 September 2026: an RTC that
cannot be written, idle-power triage). We could not read the wiki's device
status tables, so which features work on which device is *unverified* beyond
those notes and the release pages.

The machine list is longer than what is actually tested: the September 2026
testing images cover about eight devices.

## 2. UI

### Luna Next, then luna-surfacemanager

- [**luna-next**](https://github.com/webOS-ports/luna-next) was LuneOS's own
  compositor: C++ with Qt 5 and QtWaylandCompositor, GPL-3.0 (`COPYING`), a
  "complete replacement for LunaSysMgr/WebAppMgr" (its README). Last commit
  24 November 2021. It is retired: Eiskaffee replaced it with LG's
  luna-surfacemanager, and `meta-luneos` no longer builds it.
- Today the compositor is OSE's **luna-surfacemanager** (Qt 6, Wayland),
  built from LuneOS's fork (`meta-luneos/recipes-webos-ose/luna-surfacemanager/luna-surfacemanager.bb`,
  `PV = "2.0.0-424"`). The fork's September 2026 commits are mostly things
  a phone needs and a TV does not: panel power on and off
  (`setDisplayState`), advertising `xdg_wm_base` and `wp_viewporter`, xdg
  popups and subsurfaces, key repeat, handing keys back from the input
  method, not taking the keyboard from an app for a shell overlay, waiting
  for the display at startup, rotated screens, ignoring DRM writeback
  connectors (MediaTek). They are Apache-2.0 like the rest of LSM.
- The shell is
  [**luna-next-cardshell**](https://github.com/webOS-ports/luna-next-cardshell):
  138 QML files. Its `qmldir` declares `module WebOSCompositor` with
  `ViewsRoot 1.0 qml/LuneOSViewRoot.qml`, and the recipe installs it into
  `${OE_QMAKE_PATH_QML}/WebOSCompositor` and deletes LSM's own dummy
  `WebOSCompositor` import (`luna-surfacemanager.bb:87-88`). That is the same
  override Phoenix uses, done by replacing the files rather than by
  `WEBOS_COMPOSITOR_IMPORT_PATH`.
- The shell's C++ helpers are in
  [**luneos-components**](https://github.com/webOS-ports/luneos-components):
  `LunaNext.Common` (units, settings, LEDs), `LunaNext.Shell` (gesture
  handler, device keys, volume keys, screenshots, the notification manager),
  `LuneOS.Service` (luna-service2 calls and a db8 model), `LuneOS.Bluetooth`,
  `LuneOS.Telephony`, `LuneOS.Camera`, `QtQuick.Controls.LuneOS` (a Qt Quick
  Controls 2 style for apps) and Nemo/oFono bindings.

### Feature by feature

| Area | LuneOS cardshell | Phoenix (`shell/qml/Phoenix/Shell`) |
| --- | --- | --- |
| Approach | A reimplementation "inspired by" webOS, scaled in grid units (`Units.gu`, 361 uses). Recent commits cite LunaSysMgr for behaviour (sounds, the notification LED, Touch to Share glow, orientation names) in 14 files | A port of luna-sysmgr: every measurement in `Theme.qml` is in legacy pixels with a citation, and [spec/GAPS.md](spec/GAPS.md) audits each behaviour against the original source |
| Card view | `CardView/`: card groups built from `compositor.surfaceModel` (`CardGroupModel.qml`): a child window joins its parent's group (`parentWinId`), swipe to close, splash while loading | `CardView.qml`, `CardLayout.js` (a port of `CardGroup.cpp`): fanned open stacks, 7 px collapsed piles, reorder and move between stacks, angry card, loading card, the 300 ms OutQuart maximize |
| Launcher | `LaunchBar/`: quick launch bar, a tabbed full launcher with drag to reorder (`LauncherTabs.js`, `FullLauncher.qml`) | `Launcher.qml`, `QuickLaunch.qml`, `LauncherLayout.js`: original art and metrics, edit mode, drag to and from the dock |
| Just Type | `JustTypeLauncher.qml` plus the original `luna-applauncher` and `luna-universalsearchmgr` (`packagegroup-webos-extended.bb:57`) | The original luna-applauncher in the web runtime (`JustType.qml`) |
| Notifications | `Notifications/`: banners, dashboard area (phone and tablet variants), popup alert windows, notification LED in the app's colour, volume and kill-switch alerts, power menu | `Notifications.qml`, `DashboardItem.qml`, `NotificationPolicy.js`: phone banner motion, dashboards as app windows, popup alerts queued by the original policy |
| Status bar and menu | `StatusBar/`: indicators for signal, WAN, Wi-Fi, Bluetooth, battery, rotation lock, mute, flight mode, SIM slots, hardware privacy switches, screen recording; a system menu and a newer "device menu"; notch and rounded-corner layout | `StatusBar.qml`, `SystemMenu.qml`: the original indicator order, spacing, battery thresholds and menu (a port of `uiComponents/SystemMenu`) |
| Gestures | `Utils/ScreenGestureArea.qml`, `WindowManager/LunaGestureArea.qml`; back is sent to the app as **Escape** through `compositor.defaultSeat.sendKeyEvent` (`CardView/CardView.qml:297-301`, `Connectors/HardwareKeys.qml:254-275`) | `GestureArea.qml`: up, back, tap, swipe down; back is sent as the webOS Back key (evdev 412) through `Phoenix.Native.KeyInjector` |
| Lock screen | `LockScreen/`: padlock, PIN, password and **pattern** lock, via `com.palm.display/control/*` and `com.palm.systemmanager/matchDevicePasscode` (LuneOS's `luna-authmanager` handles device lock; *which process serves that method is unverified*) | `LockScreen.qml`, `UnlockPanel.qml`: the original padlock drag, PIN and password panel, incoming call on the lock screen |
| Keyboard | [webos-keyboard](https://github.com/webOS-ports/webos-keyboard): a **Maliit** plugin based on the Ubuntu Touch keyboard, with word prediction (presage) and, in September 2026, hardware keyboard support | `VirtualKeyboard.qml`: a port of Open webOS's `keyboard-efigs` phone and tablet keyboards, drawn in the shell |
| Extras | Dock (exhibition) mode, E Ink refresh modes, NFC, tweaks, boot and shutdown screens, rotation | Rotation and full screen in the simulator; no dock mode yet (GAPS R5) |
| Development | QML runs on a desktop via `mainDesktop.qml` and `run-desktop.sh`; no test suite beyond three files in `tests/` | A desktop simulator, screenshot mode, behaviour tests and CI |

Screenshots of Eiskaffee:
[Liliputing gallery](https://liliputing.com/open-source-webos-port-luneos-eiskaffee-is-the-first-stable-release-in-five-years/)
(for example [1](https://liliputing.com/wp-content/uploads/2024/02/luneos_01-780x439.jpg),
[2](https://liliputing.com/wp-content/uploads/2024/02/luneos_04-780x439.jpg)),
and the [pivotCE announcement image](https://i0.wp.com/pivotce.com/files/2021/02/Eiskaffee.jpg).
We found no screenshots of the September 2026 builds.

**In short:** the two shells solve the same problem in the same slot of
the same compositor. LuneOS's covers more *device* ground (SIM PIN,
multi-SIM, NFC, fingerprint and face unlock, E Ink, privacy switches, notches,
hardware keyboards) and runs on real phones today. Phoenix's covers more of
the *original experience* in detail, is tested, and has not run on a device
yet ([ROADMAP.md](ROADMAP.md), M1).

## 3. Apps

| | LuneOS | Phoenix |
| --- | --- | --- |
| Open webOS core apps (Enyo 1) | Shipped (`core-apps.bb`) on WAM/Chromium, minus Contacts, Memos and Calculator which LuneOS replaces; bundled at build time with `enyo-compress` (Calendar cold start 6.31 s to 5.77 s on the MindPhone) | The same apps as unmodified submodules (`third_party/core-apps`), run by `runtime/phoenix-runtime.js`; fixes go in overlays ([APP-RUNTIME.md](APP-RUNTIME.md)) |
| Mojo apps | Mojo 1.0 extracted from a webOS 3.0.5 image and adapted to Chromium (`mojo-framework.bb`, `LICENSE = "CLOSED"`) | Not supported |
| Enyo 2 apps | Contacts, Photos, Maps (`org.webosports.app.*`) | None |
| QML apps | Settings (`settings-qml`), Camera, Torch, Terminal, Messwerk (sensor reader, from Sailfish) | None (the shell only) |
| OSE Enact apps | camera, mediagallery, statusbar, notification, volume, enactbrowser (kept for its pdf.js) | None |
| Browser | [Atlas](https://github.com/webOS-ports/org.webosports.app.atlas) (Enyo 1 on Chromium's browser shell; the same tree targets legacy webOS with a WPE WebKit engine) | The original Isis browser |
| Phone and messaging | `org.webosports.app.phone` (GPL-3.0, QML with oFono), `org.webosports.app.messaging` (Apache-2.0) | New React apps against the legacy `com.palm.telephony` API, with call-state additions ([APP-RUNTIME.md](APP-RUNTIME.md#phone-and-messaging)) |
| Other | Memos, Tasks, Calculator, File manager, PDF (pdf.js), First Use, Backup, Preware | Settings, Camera, Photos, Music, Files, Tasks, Voice Memos (React, in the Enyo 1.0 look) |

Both projects bet on the same idea: the original apps keep working because
the legacy `com.palm.*` services and db8 kinds keep working. LuneOS does it
on a device with real services; Phoenix does it with a runtime shim that
also runs in a browser. Phoenix's runtime renames legacy services to OSE
names (`com.palm.applicationManager` to `com.webos.applicationManager`);
LuneOS instead runs `luna-appmanager`, which still registers
`com.palm.applicationManager` and `com.palm.appinstaller`
(`luna-appmanager/files/sysbus/luna-appmanager.service.in`), next to OSE's
SAM.

## 4. Hardware stack

Everything below is from `meta-luneos` at `9abe603b` unless noted. The
right-hand column compares with [HARDWARE.md](HARDWARE.md).

| Area | LuneOS | Licence | For Phoenix |
| --- | --- | --- | --- |
| Telephony | oFono (`VIRTUAL-RUNTIME_ofono`), `ofono-binder-plugin` on Halium, Nemo `voicecall`; [webos-telephonyd](https://github.com/webOS-ports/webos-telephonyd) serves `com.palm.telephony` over oFono (`drivers/ofono/`): dial, answer, ignore, hangup (ignore and hangup added 4 September 2026), power, network, SIM, multi-SIM, SMS from db8, airplane mode | telephonyd Apache-2.0 (file headers, recipe); oFono and plugins GPL-2.0 | HARDWARE.md already plans to port telephonyd. **Use it as is** and add the call-state methods Phoenix needs there, upstream |
| eSIM | `lpac` plus `luneos-esim-adapter` | | Reuse |
| Modem on mainline | Qualcomm helpers (`rmtfs`, `qrtr`) for Nexus 5 and TouchPad; `meta-qualcomm-modems` layer | | Reuse for SDM845-class phones; oFono vs ModemManager question stays open |
| Audio | OSE `audiod` on PulseAudio, `pulseaudio-modules-droid` on Halium; the shell now talks to audiod (cardshell, 15 August 2026) | Apache-2.0 / LGPL | Same plan as HARDWARE.md |
| Camera | `com.webos.service.camera` with a droid HAL plugin (gst-droid, droidmedia) and a V4L2 plugin; libcamera packaged | Apache-2.0 (service) | Reuse; answers HARDWARE.md's open camera question for Halium |
| Sensors | sensorfw with the Qt Sensors sensorfw plugin | LGPL-2.1+ | Matches HARDWARE.md's Halium plan |
| Power and battery | `com.webos.service.battery` (battery and charger daemon), `sleepd`, `libsuspend`, `luneos-remote-wakelock`, `luneos-power-report`, `luna-displaymanager` (display states, ambient light, suspend blocking) | Apache-2.0 | **Reuse**: fills the "no battery status" and suspend-policy gaps in HARDWARE.md |
| nyx | Fork of OSE `nyx-modules` with ambient light, haptics, keys, LED controller, torch, touch panel; `nyx-modules-hybris` (device info, GPS, haptics, torch) | Apache-2.0 (10 of 11 hybris sources carry the Apache header; *one file has a GNU header, unverified which licence it is*) | **Reuse**, as HARDWARE.md suggests |
| Torch | [`org.webosports.service.torch`](https://github.com/webOS-ports/org.webosports.service.torch) (torchd: `getStatus`, `set`, `toggle`) on nyx's `led_torch` module (kernel LED class, qcom switch node, MediaTek `/dev/flashlight`; hybris: the camera service) | Apache-2.0 (SPDX headers; the service has no `LICENSE` file) | **Reused** unchanged: Phoenix's Flashlight and QR Scanner call its API (`meta-phoenix/recipes-bsp/torchd` stub; simulated in the runtime). LuneOS's Torch app is GPL-3.0 and not used |
| Haptics | `luna-haptics` | Apache-2.0 | Reuse instead of a feedbackd bridge on Halium |
| Keyboard | webos-keyboard (Maliit, LGPL-3.0 plus BSD, CC-BY and Apache files) | LGPL-3.0 | Learn only; Phoenix has its own keyboard |
| Fingerprint, face, NFC | `biomd` plus `webos-fingerprint-adapter`, `luneos-faced`, `nfcd` plus `webos-nfc-adapter` | | Later |
| Printing, VPN | `luneos-print-adapter` (CUPS, `com.palm.printmgr`), `luneos-vpn-adapter` | | Later; covers HARDWARE.md's VPN row |
| Graphics | Mesa on mainline; libhybris and hwcomposer on Halium; `luna-surfacemanager` waits for the GPU before starting | | Same plan |

## 5. Services

- **Accounts and Synergy.** LuneOS ships the Open webOS account framework
  (`app-services`, `mojoservice-frameworks`), the email transports
  (`mojomail-imap`, `-pop`, `-smtp`), instant messaging through libpurple
  (`imlibpurpleservice`, `imaccountvalidator`, `messaging-accounts`, and a
  Signal plugin via `purple-presage`), and a CardDAV/CalDAV connector
  ([`org.webosports.cdav`](https://github.com/webOS-ports/org.webosports.service.contacts.carddav),
  Node.js, **GPL-3.0**, `org.webosports.cdav.bb`). Phoenix's own CardDAV and
  CalDAV service (`apps/dav`, [SYNERGY.md](SYNERGY.md)) is original
  Apache-2.0 code; note that [APP-GAPS.md](APP-GAPS.md) says to "start from"
  LuneOS's connector, which its licence does not allow for code.
- **App store.** LuneOS ships **Preware** (`org.webosports.app.preware`,
  GPL-2.0+) with its package service `org.webosports.service.ipkg`, and OSE's
  `appinstalld2`. Which feeds Preware points at on LuneOS today is
  *unverified*. The webOS Archive's
  [App Museum II](https://appcatalog.webosarchive.org/) is the other
  catalogue legacy users know.
- **Android apps.** **Waydroid** is packaged and added to images for
  `halium-arm`, `halium-arm64`, `mido-halium`, `pinephone` and
  `pinephonepro` (`packagegroup-luneos-extended.bb:298-311`), with
  `waydroid-sensors`. We found no Anbox or Android Translation Layer recipes.
  Phoenix has no Android plan yet.
- **Browser.** Atlas, on the Chromium 151 runtime, with Web Speech through
  speech-dispatcher.
- **Other.** OTA via `webos-system-update` and `org.webosports.service.update`
  (GPL-3.0) (*mechanism unverified*; Phoenix plans RAUC), backup
  (`luna-backupagent`, `com.palm.app.backup`), developer mode, MTP
  (`umtprd`), Node-RED.

## 6. Licensing

Phoenix is Apache-2.0 ([LEGAL.md](LEGAL.md)). Apache-2.0 code can be copied
in with attribution. GPL and LGPL code cannot be copied into Phoenix's own
files; GPL programs can still ship **beside** Phoenix in the same image as
separate packages (that is mere aggregation), and LGPL libraries can be
linked.

| Component | Licence (source) | Copy code into Phoenix? | Ship alongside? |
| --- | --- | --- | --- |
| OSE forks (luna-surfacemanager, SAM, WAM, nyx-modules, audiod, ...) | Apache-2.0 (`LICENSE`) | Yes | Yes |
| Chromium 151 webruntime | BSD-style (Chromium) plus LG's Apache-2.0 | Yes, as a package | Yes |
| webos-telephonyd, luna-appmanager, luna-displaymanager, luna-authmanager, luna-haptics, com.webos.service.battery, nyx-modules-hybris, com.palm.keymanager, messaging service and app, Atlas, Calculator, Contacts, Memos, Maps, Tasks, Settings (QML), PDF | Apache-2.0 (recipes; headers checked for telephonyd, appmanager, nyx) | Yes | Yes |
| `meta-webos-ports` recipes | MIT for recipes (`meta-luneos/COPYING.MIT`) | Yes | |
| luna-next-cardshell | GPL-3.0 (`COPYING`; 291 GPL headers), except files taken from Open webOS, which stay Apache-2.0 (for example `StatusBar/SystemMenu/Drawer.qml`, © LG), and `qml/images/background.png`, which is CC BY-SA **NonCommercial** | No (only the Apache files, which we already have from luna-sysmgr) | Yes |
| luneos-components | `COPYING` is GPL-3.0 (its md5 matches GPL-3.0) while the recipe says `LGPL-2.1-only`; per-file headers are mixed (94 GPL, 77 LGPL, 3 Apache) | No | Yes, but the recipe's licence field looks wrong and should be reported |
| luna-next (retired) | GPL-3.0 | No | |
| webos-keyboard | LGPL-3.0, with BSD, CC-BY and Apache files | No | Yes |
| Phone, Camera, Photos, First Use, Torch app, update service, cdav, media-permission service | GPL-3.0 | No | Yes |
| Preware, ipkg service, licenses service | GPL-2.0+ | No | Yes |
| oFono, voicecall, plugins | GPL-2.0 | No | Yes |
| Mojo framework | `CLOSED` (extracted from HP firmware; never open-sourced) | No | **No**: we should not redistribute it |
| luneos-porting-mcp | Apache-2.0 (`package.json`) | Yes | |

The practical rule is unchanged from [LEGAL.md](LEGAL.md): read the shell
and GPL apps for reference, do not copy them. What is new is how much of
the **device layer** is Apache-2.0 and therefore reusable.

## 7. Community and collaboration

**People.** Herman van Hazendonk (Herrie, GitHub `Herrie82`) does most of
the work today; Christophe Chapuis (Tofe) reviews and merges; Martin Jansa
(JaMa, a long-time OpenEmbedded contributor) keeps the layers building;
Simon Busch (morphis) founded much of it and is still named as maintainer
in `luneos.conf`. Alan Morford and codepoet80 (webOS Archive) contribute to
the shell.

**Channels** (from search snippets of the wiki's Community page, which we
could not load; *unverified today*): IRC `#webos-ports` on Libera, a
Telegram group, email `webos.ports@gmail.com`, Twitter/X `@webosports`, and
the webOS Archive Discord. Issues go to
[luneos-testing](https://github.com/webOS-ports/luneos-testing). GitHub is
where the work is visible: pull requests are small and merged daily.

**Is collaboration plausible?** Yes, more than we assumed:

1. **Phoenix shell on LuneOS.** Both shells are a `WebOSCompositor`
   `ViewsRoot` for luna-surfacemanager. LuneOS ships every QML module
   Phoenix imports (`WebOSCoreCompositor`, `WebOSCompositorBase` from LSM;
   `WebOSServices` from qml-webos-bridge; `WebOS.Global` from
   qml-webos-framework). A `phoenix-shell` package that installs
   `/usr/share/phoenix/qml` and sets `WEBOS_COMPOSITOR_IMPORT_PATH` should
   load on a LuneOS image as it would on OSE (*untested*). LuneOS's recipe
   deletes LSM's stock `WebOSCompositor` import, so the two shells would
   need to be alternatives (`VIRTUAL-RUNTIME` style), not installed together.
2. **LuneOS devices under Phoenix.** Rather than porting devices to OSE's
   `build-webos` (scarthgap, no commits since March 2025), Phoenix can build
   on LuneOS's wrynose stack and get the Halium and Pine64 machines, the
   device services and Chromium 151 at once.
3. **Upstreaming.** Phoenix's service work (call state for telephonyd, the
   legacy API fixes found by running the original apps in
   `phoenix-runtime.js`, the db8 behaviours we simulated) fits LuneOS's
   Apache-2.0 repositories directly.
4. **What they might take from us.** The measurement work in
   [spec/legacy-ui-spec.md](spec/legacy-ui-spec.md) and [spec/GAPS.md](spec/GAPS.md)
   is documentation, usable by anyone. Our shell code is Apache-2.0, which
   LuneOS can include in its GPL-3.0 shell (the reverse is not possible).

Risks: the project depends on very few people; its website was down when we
checked; it has not made a stable release in over two and a half years; and
its shell's direction ("new device menu", tweaks, notches) is a modern
webOS-like UI rather than a faithful one, so the two shells will stay
different products.

## 8. Comparison

| Area | LuneOS | webOS Phoenix | Reuse / learn / ignore |
| --- | --- | --- | --- |
| Goal | A usable community webOS on current phones | The original webOS phone and tablet UI, exact, then modernized | Distinct |
| Base | Open webOS apps plus OSE 2.28 components, rebased and extended | Unchanged OSE 2.28 plus a `meta-phoenix` layer | **Reuse**: their rebased OSE |
| Build | Own distro, Yocto wrynose, meta-qt6 6.12 | OSE `build-webos`, scarthgap, Qt 6.8 | **Reuse** their layer stack for devices |
| Web runtime | Chromium 151 (their forward port of LG's neva) | OSE Chromium 120 | **Reuse** |
| Compositor | OSE luna-surfacemanager with ~73 phone patches | OSE luna-surfacemanager, unpatched | **Reuse** the patches (Apache-2.0) |
| Shell | luna-next-cardshell, GPL-3.0, reimplementation | Phoenix.Shell, Apache-2.0, port of luna-sysmgr with tests | Learn (device features); do not copy |
| Shell development | On device, `mainDesktop.qml` for desktop | Desktop simulator, screenshots, CI | Distinct; ours is an asset to share |
| Back gesture | Escape via `QWaylandSeat.sendKeyEvent` in QML | webOS Back key via a C++ `KeyInjector` | Learn: compare which apps accept which |
| Keyboard | Maliit, Ubuntu-based, prediction, hardware keyboards | Port of `keyboard-efigs` in the shell | Learn (hardware keyboard, prediction) |
| Legacy apps | Enyo 1 core apps and Mojo 1 on WAM | Enyo 1 core apps via `phoenix-runtime.js` (simulator and device) | Learn (enyo-compress, their app fixes); ignore Mojo |
| New apps | Enyo 2, QML and Enact apps | React apps in the Enyo 1.0 look | Distinct |
| Telephony | oFono, webos-telephonyd, voicecall | Apps written against `com.palm.telephony`, no service yet | **Reuse** telephonyd, add call state upstream |
| Sensors, power, battery, display, haptics | sensorfw, battery daemon, displaymanager, haptics, sleepd, nyx forks | Planned | **Reuse** |
| Camera | OSE camera service with droid and V4L2 HALs | Planned | **Reuse** |
| Devices | ~30 machine configs, ~8 in September 2026 test images | None yet (plan in HARDWARE.md) | **Reuse** |
| Accounts / Synergy | Open webOS framework, mojomail, libpurple IM, GPL-3.0 CardDAV | Open webOS framework, original Apache-2.0 CardDAV/CalDAV | Distinct; learn from their IM work |
| App store | Preware (GPL-2.0+), appinstalld2 | None yet | Ship Preware alongside, or learn |
| Android apps | Waydroid on Halium and Pine64 | None | Reuse later |
| OTA | `webos-system-update` (*unverified*) | RAUC planned | Distinct for now |
| Licence | Mixed; shell GPL-3.0, services mostly Apache-2.0 | Apache-2.0 | See section 6 |
| Releases | Stable Feb 2024; testing Sep 2026 | None yet | |

## 9. Recommendation

### Where we duplicate them, and where we are distinct

We **duplicate** LuneOS in everything below the shell: the device layers,
the legacy services, telephony, sensors, power, camera, the web runtime,
the build. [HARDWARE.md](HARDWARE.md) plans to build most of this again on
OSE's `build-webos`; LuneOS has already built it, on a newer Yocto, Qt and
Chromium, and most of it is Apache-2.0.

We are **distinct** in the shell and the apps: an exact port of the original
UI with its measurements, a simulator and a test suite, a runtime that runs
the original apps in a browser, and new Apache-2.0 apps. None of that exists
in LuneOS, and LuneOS is not trying to build it.

So Phoenix should be a shell and app suite that runs on LuneOS's platform,
not a second platform.

### The owner's position (28 September 2026)

Phoenix stays an **independent project**: its plans (the assistant, the
catalog, Android apps, a Phoenix cloud) may not match LuneOS's, so we do not
join or depend on their roadmap. Outreach (step 1 below) is on hold.

That does not rule out using their **build layers**. Yocto layers are
consumed like libraries: a Phoenix build lists them at pinned commits, and
Phoenix's own layer adds and overrides what it needs. That needs no
agreement from LuneOS and gives them no say over Phoenix. The layers, and
what each would give us:

| Layer | Licence file | What it contains | Use it? |
| --- | --- | --- | --- |
| `meta-smartphone` (shr-distribution) | MIT in `meta-android` and `meta-mainline`; **none** in the vendor layers (`meta-google`, `meta-xiaomi`, `meta-oneplus`, `meta-furilabs`, `meta-hp`, ...) or `meta-qualcomm-modems` | Per-vendor device layers, `meta-android` (Halium: the LXC Android container, libhybris, the generic `halium-arm64` machine), `meta-mainline`, `meta-qualcomm-modems`. Kernels, boot images, firmware packaging | **Yes.** This is the hardest part to redo: years of per-phone kernel and boot work. It is distro-neutral (it predates LuneOS) |
| `meta-webos-ports/meta-luneos` | MIT (`COPYING.MIT`) for the recipes; the software they build varies (section 6) | The LuneOS distro: device services (telephonyd, battery, displaymanager, haptics, nyx forks, camera), the Chromium 151 web runtime, and the LuneOS apps and cardshell | **Pick recipes, not the distro.** Phoenix's own `phoenix` distro config and image choose the services and leave out cardshell, the LuneOS apps and Mojo |
| `meta-webos-ports/meta-luneui` | None | luna-service2, nyx-lib, pmloglib, luna-sysmgr-common: the webOS basics | Yes, or take the same recipes from OSE's `meta-webosose` (Apache-2.0) |
| `meta-luneos-backports-6.1`, `meta-luneos-holdbacks-5.3` | None | Newer or older versions of a few packages that the current Yocto release needs | Only as the recipes above require |
| `meta-pine64-luneos` | Apache-2.0 (`LICENSE-2.0.txt`) | PinePhone, PinePhone Pro, PineTab2 | When those devices are targets |
| `meta-rpi-luneos` | *not checked* | Raspberry Pi | When the Pi is a target |
| `meta-qt6` 6.12, oe-core, meta-openembedded (wrynose) | MIT | Not LuneOS's; the same upstream layers any build uses | Yes, at the versions they pin, so the device layers build |

**Permission.** Three different things, with different answers:

1. **Building with the layers as they are**, fetched from their git
   repositories at pinned commits and changed only through Phoenix's own
   layer (`.bbappend` files and our own recipes, which are our code): no
   permission needed. We do not copy or redistribute their recipe files;
   our build just reads them, as every Yocto user does.
2. **Copying or modifying their recipe files inside Phoenix's repository:**
   fine for the layers with a licence file (MIT or Apache-2.0, keep the
   notice). For the layers with none, the default is "all rights
   reserved", so ask for a licence file first. That is a one-line issue on
   each repository (asking them to add `COPYING.MIT`, as their other layers
   have), not a partnership, and it matches OpenEmbedded's convention that
   layers are MIT.
3. **Distributing the images we build:** the recipe licences do not matter
   here; the licences of the software in the image do. Yocto records them
   per package. GPL packages (kernels, oFono, libhybris parts) need their
   source offered with the image (Yocto's archiver class does this). And
   some device recipes are **proprietary**: vendor firmware
   (`firmware-xiaomi-*`, `firmware-hp-tenderloin`, `firmware-lg-hammerhead`,
   `LICENSE = "Proprietary"`) and the Halium `android-system-image`
   (`Apache-2.0 & Proprietary`). Those images should not be published as
   downloads without checking each blob's redistribution terms; the usual
   answer is to extract the blobs from the user's own device at install
   time, or to publish only images without them.

The cost of this route: when LuneOS changes a recipe we use, we follow or
override it; and if LuneOS stops, the device layers we depend on become
ours to maintain (step 8). The alternative, device support written from
scratch on OSE's `build-webos`, costs that from day one.

### Next steps

1. **Talk to them first** *(on hold: see the owner's position above).* Open an issue or discussion on
   [luneos-testing](https://github.com/webOS-ports/luneos-testing) (or reach
   Herrie and Tofe on GitHub and `#webos-ports`) saying what Phoenix is and
   proposing: Phoenix as an alternative `WebOSCompositor` shell package in
   `meta-webos-ports`, and Phoenix service work sent upstream.
2. **Answer HARDWARE.md's biggest open question now: build devices on
   LuneOS's stack.** Add a `meta-phoenix` configuration that sits on
   `webos-ports-setup`'s layer list (wrynose, meta-qt6 6.12,
   `meta-webos-ports`, `meta-smartphone`), with a `phoenix` image that is
   `luneos-dev-image` with Phoenix's shell and apps instead of the cardshell.
   Keep the OSE `build-webos` path for `qemux86-64` and the Pi only as long
   as it costs little. First targets: `qemux86-64` and `sargo` (Pixel 3a),
   both in LuneOS's current testing images and both already Phoenix's
   reference candidates.
3. **Reuse, with attribution, instead of writing:** webos-telephonyd (add
   `callStatusQuery` and the other call-state methods in APP-RUNTIME.md
   there, not in a Phoenix copy), `com.webos.service.battery`,
   luna-displaymanager, luna-haptics, luna-authmanager (the lock screen's
   PIN check), the nyx module forks, the camera service with its droid HAL,
   the luna-surfacemanager patches, and the Chromium 151 runtime. Update
   HARDWARE.md's hardware abstraction table to point at these.
4. **Learn from the shell without copying it:** how cardshell uses
   `compositor.surfaceModel` and `WindowModel` to build card groups, how it
   delivers back (Escape through `defaultSeat.sendKeyEvent`) and keeps the
   keyboard with the app, and its handling of SIM PIN, multi-SIM, notches,
   hardware keyboards and display power. Our `LsmWindowSource` and
   `LsmSystemStatus` should call the same services cardshell calls
   (`com.palm.display/control/*`, `com.webos.service.battery`,
   `com.palm.telephony`, `com.webos.service.audio/master/*`).
5. **Fix our own docs:** [APP-GAPS.md](APP-GAPS.md) should not say to start
   from LuneOS's GPL-3.0 CardDAV connector (Phoenix already has its own), and
   [ARCHITECTURE.md](ARCHITECTURE.md)'s "QML cannot inject key events into a
   client surface" should be qualified: `QWaylandSeat.sendKeyEvent` is
   callable from QML, which is what LuneOS uses.
6. **Report upstream what we found:** the `luneos-components` licence field
   (`LGPL-2.1-only` in the recipe, GPL-3.0 in `COPYING`) and the stale
   meta-qt6 version in `meta-luneos/README`.
7. **Do not ship** the Mojo framework (`LICENSE = "CLOSED"`) or cardshell's
   CC BY-SA-NC wallpaper in anything Phoenix distributes.
8. **Revisit in three months:** whether LuneOS has made a stable release,
   whether the activity burst has held, and whether a second maintainer has
   appeared. If LuneOS goes quiet again, Phoenix would be carrying its layers
   alone, and that should be a conscious decision.
