# Device audit: what only works because the simulator is one process

In `phoenix-sim` everything is one process: the shell (QML), every app's
page (QtWebEngine), the runtime's simulated Luna services
(`runtime/phoenix-runtime.js`) and the host (`SimWindowSource.qml`,
`SimSystemStatus.qml`), which the pages reach with
`PalmSystem.host.postToHost(type, payload)`. On a device (webOS OSE) these
are separate processes:

- **luna-surfacemanager** (LSM) runs Phoenix's shell (`shell/qml/Phoenix/Lsm`,
  `shell/qml/WebOSCompositor`);
- **WebAppMgr** (WAM) runs each app in its own Chromium page, with
  WAM's `PalmSystem`/`webOSSystem` and its `PalmServiceBridge`;
- the **Luna bus** (luna-service2) joins them, with ACG: roles, API groups,
  client permissions, manifests (`/usr/share/luna-service2`).

So anything a page did by calling into the host, or a service the runtime
answered in the page, needs a device path: a real service on the bus, a
message on the bus to the shell, or OSE's own service. This file lists each
one and where it stands. It was written from the runtime's `register(...)`
calls, every `postToHost` type, `SimWindowSource`/`SimSystemStatus`, what the
shell draws over pages, and every app and Node service (October 2026).

Status:

- ✅ done: OSE's own service answers, or Phoenix's device path is the same
  code as the simulator's and needs nothing more;
- 🟡 written, not run: the device path is written and tested here with fakes
  (`tools/test-runtime-device.cjs`, `shell/tests-device`, vitest over a fake
  bus, `devices-test` over `ls2stub`), not yet run on a device;
- ⬜ to do: no device path yet;
- 🚫 needs hardware or an owner decision.

## Counts

| Status | Items |
| --- | --- |
| ✅ done (OSE's own, or nothing to do) | 23 |
| 🟡 written, not run | 54 |
| ⬜ to do | 21 |
| 🚫 hardware or decision | 7 |
| **Total** | **105** |

Rows of the tables below (a row naming several OSE services counts each).
The 23 bus services of section 5 are 🟡 besides these.

## How a page reaches the shell on a device

`services/shellhost` (`org.webosphoenix.shellhost`, Node, one process with
`org.webosphoenix.ongoing` and `org.webosphoenix.system`) is the line between
the pages and the shell. On a device the runtime's `host.postToHost(type,
payload)` calls `shellhost/post`; the bus gives the service the caller's app
id, so a page cannot speak for another app. The shell (only
`com.webos.surfacemanager`, ACG group `phoenix.shellhost.shell`, trust oem)
subscribes to `listen` and hears every post with its app id;
`LsmWindowSource.pageMessage` acts on it. The shell answers a page with
`send {appId, type, payload}`, which reaches that app's `events`
subscription, read by `runtime.onShellEvent`. Posts made before the shell
listens are kept (200, 2 minutes). Why a relay and not a service in the
shell: qml-webos-bridge's `Service.pushSubscription` sends to every
subscriber, not one app.

Files: `services/shellhost/shellhost.js`, `service.js`, `sysbus/`,
`shellhost.test.ts`; `runtime/phoenix-runtime.js` `installDeviceShell`;
`shell/qml/Phoenix/Lsm/LsmWindowSource.qml` `_listenToPages`, `pageMessage`,
`sendToApp`.

## 1. The pages' messages to the host (`postToHost` types)

| Item | What it does | Simulator path | Device path today | Status | Files |
| --- | --- | --- | --- | --- | --- |
| `banner`, `removeBanner`, `clearBanners` | `PalmSystem.addBannerMessage` and friends | `SimWindowSource` → `Shell.showBanner` | WAM's `addBannerMessage` is a no-op (`PalmSystemBlink::HandleBrowserControlMessage` drops it), so the runtime overrides it and posts through shellhost; `LsmWindowSource` signals `bannerRequested`/`bannerRemoved`/`bannersCleared`, icon resolved to the app's folder | 🟡 | runtime `installDeviceShell`; `LsmWindowSource.qml`; `tst_lsm` pagesMessagesReachTheShell |
| `notification` | dashboards from the runtime's notification calls | `SimWindowSource` | through shellhost to `LsmWindowSource.notify` (OSE's notificationmgr for the shell's own) | 🟡 | same |
| `ongoing` | Phoenix's ongoing items (downloads, transfers) | `org.webosphoenix.ongoing` in the page | `org.webosphoenix.ongoing` served by `services/shellhost`, the caller's id from the bus; the shell's `setOngoing` | 🟡 | `services/shellhost`; commit e30a5aa |
| `sound` | `PalmSystem.playSoundNotification` | `SimWindowSource.playSound` | runtime override → shellhost → `soundRequested` → `playSound` (audiod's PCM twins) | 🟡 | runtime; `LsmWindowSource.qml` |
| `activeCallBanner` | the phone's call banner | `SimWindowSource` | through shellhost (`activeCallBanner` property) | 🟡 | same |
| `sceneTransition` | Mojo's `PalmSystem.prepareSceneTransition` / `runSceneTransition` | the shell snapshots the card | runtime posts, the shell answers `sceneTransitionPrepared`; the page runs `makeSceneTransition(250)` | 🟡 | runtime `makeSceneTransition`; `LsmWindowSource.sceneTransitionPrepared` |
| `takeScreenshot` | Screenshot app, power+home | `SimWindowSource` grabs the window | `screenshotRequested` → `PhoenixViewsRoot` grabs LSM's view; `saveScreenshot` writes it with the file manager's service and posts a notification | 🟡 | `PhoenixViewsRoot.qml`; `LsmWindowSource.saveScreenshot`; `tst_lsm` screenCapturesAreFiled |
| `debugOverlay`, `progressAnimation` | developer overlay; LunaSysMgr's progress animation | `Shell` | signals to `PhoenixViewsRoot` | 🟡 | same |
| `shutdown`, `reboot` | the power menu | `SimSystemStatus` ends the sim | the shell's power menu calls `com.palm.power/shutdown/machineOff` / `machineReboot` (phoenix-devices); the service tells the shell (black overlay, shutdown sound) and runs `systemctl poweroff/reboot` 4.5 s later | 🟡 | `services/devices/service.cpp`; `devices_test.cpp` testPower; `tst_lsm` shutdownFromPowerd |
| `mediaKey` | an app's play/pause/next | `SimWindowSource` | `org.webosphoenix.system/mediaKey` → the shell → `com.palm.display/phoenix/report {mediaKey}` → phoenix-devices posts `/media` key down and up | 🟡 | `services/shellhost`; `services/devices`; `tst_lsm` mediaKeyIsPressedByPhoenixDevices |
| `dictation`, `assistant` | the keyboard's mic, the Assistant overlay | `SimWindowSource` with the local models | shellhost → `LsmWindowSource` dictation/assistant handlers (`org.webosphoenix.dictation` is `available()` on a device) | 🟡 | runtime `dictationServices`; commit e318dcf |
| `editMenu`, `editAction` | the long-press edit popup | `Shell`'s `EditPopup` over the page | the runtime posts `editMenu` from `contextmenu`/hold; `SurfaceHost.openEditPopup` shows it scaled to the page; the command goes back as `editAction` | 🟡 | `SurfaceHost.qml`; runtime `installEditing`; `tst_lsm` editPopupAndEventsGoToThePage |
| `justTypeDismiss` | Just Type's page closing | `Shell` | Just Type's page (com.palm.launcher) is a surface in the shell's Just Type; `justTypeDismissed` | 🟡 | `LsmWindowSource.justType*`; `tst_lsm` justTypeIsThePagesSurface; commit 757fc7f |
| `launch`, `open`, `activate` | launch an app / open a target / bring a card forward | `SimWindowSource.launch` | pages call SAM or `com.palm.applicationManager` (services/appmanager) themselves; a posted `launch`/`open`/`activate` goes to `LsmWindowSource` | 🟡 | `services/appmanager`; `LsmWindowSource.pageMessage` |
| `windowOrientation`, `fullScreen`, `windowProperties` | orientation, full screen, status bar colour, screen timeout | `SimWindowSource` | WAM's no-ops overridden; set as window properties (`phoenix*`) that `LsmCards.js` reads | 🟡 | runtime `installDevice`; `tst_lsmcards` |
| `stageReady` | Mojo's stage is ready | `SimWindowSource` shows the card | WAM's own `stageReady` | ✅ | WAM |
| `systemStatus` | the page asks the host for status | `SimSystemStatus` | the shell reads the real services (`LsmSystemStatus`) | ✅ | `LsmSystemStatus.qml` |
| `preferences` | preference changes for the shell | `SimSystemStatus` | the shell subscribes to `com.webos.service.systemservice` | ✅ | `LsmSystemStatus.qml` |
| `vibrate` | haptics | `SimWindowSource` | `com.palm.vibrate` in phoenix-devices | 🟡 | `services/devices` |
| `displayState`, `displayHolds` | screen on/off, holds | `SimSystemStatus` | `com.palm.display` in phoenix-devices | 🟡 | `services/devices` |
| `pty` | the Terminal's shell | runtime `org.webosphoenix.pty` → `phoenix-sim`'s PTY | `services/pty` on the bus | 🟡 | `services/pty` |
| `appManagerOp`, `installApp`, `removeApp`, `installStatus` | the Marketplace's installs | `SimWindowSource` | OSE's appinstalld2 and `org.webosphoenix.service.packages` | 🟡 | `apps/marketplace/service` |
| `launcherLayout`, `launchPointIcon` | backup's restored launcher layout; Calendar's date icon | `Shell` | not yet: the device shell takes its launch points from SAM; neither message is acted on | ⬜ | runtime `/updateLaunchPointIcon`, `com.palm.sysMgrDataBackup` |
| `keepAlive` | headless apps stay loaded (luna.conf `[KeepAlive]`) | `SimWindowSource` | not yet: WAM's appinfo `keepAlive` would do it at install time | ⬜ | runtime `PalmSystem.keepAlive` |
| `launchModal`, `dismissModal` | `com.palm.systemmanager/launchModalApp` | `CardView.addModal` | not in `services/systemmanager` yet | ⬜ | runtime `launchModalApp` |
| `webView`, `browserData` | the browser's page views; Clear Cookies/Cache | `phoenix-sim`'s page views (`simBrowser`) | none: WAM has no `<webview>` (Q38) | ⬜ | runtime `com.palm.browserServer` |
| `popupalert` | `window.open` dashboards and popup alerts | `SimWindowSource` child windows | none: WAM makes no child windows (Q37) | ⬜ | `SimWindowSource.qml` |
| `restartUi` | Restart the UI from the power menu | `SimWindowSource` reloads | `org.webosphoenix.system/restartUi` answers "not available" (Q39) | ⬜ | `services/shellhost` |
| `erase`, `enterMSM` | Settings' erase; USB mass storage | `SimStorage.qml` | no `com.palm.storage` on OSE (storaged is LuneOS's) | ⬜ | runtime `com.palm.storage`; Q61 |
| `inputFocus` | the keyboard follows the focused field | `Shell` keyboard | V5 (Maliit), owned by the keyboard work | 🚫 | HARDWARE.md, keyboard section |
| `touchToShare` | Touch to Share | `SimWindowSource` | needs an NFC/BT pairing radio | 🚫 | GAPS |
| `simulator`, `lunaReply` | the simulator's own controls and replies | `SimWindowSource` | nothing on a device | ✅ | — |

## 2. The runtime's simulated services

| Item | What it does | Simulator path | Device path today | Status | Files |
| --- | --- | --- | --- | --- | --- |
| com.palm.db, com.palm.tempdb | db8 | runtime in-page db8 | OSE's db8 (`/etc/palm/db/kinds` installed by install-rootfs) | ✅ | install-rootfs |
| com.webos.notification | OSE toasts | runtime → banner | OSE's notificationmgr; the shell takes its toasts (`acceptToasts: false` on the stock view) and shows them as banners | 🟡 | `PhoenixViewsRoot.qml`; `LsmWindowSource.toast` |
| com.palm.systemservice / com.webos.service.systemservice | preferences, time | runtime | luna-sysservice (alias) | ✅ | runtime `serviceAliases` |
| com.palm.connectionmanager / com.webos.service.connectionmanager | connectivity | runtime | webos-connman-adapter (alias) | ✅ | same |
| com.webos.service.wifi, bluetooth2, settingsservice, audio, audiofocusmanager, tts, mediaindexer, camera2, devmode, appInstallService, downloadmanager, activitymanager, filecache | OSE services | runtime stand-ins | OSE's own | ✅ (13) | meta-webos |
| com.palm.activitymanager, com.palm.downloadmanager | legacy names | runtime | aliased to OSE's com.webos.service.* | 🟡 | runtime `serviceAliases`; commit 09e7b1b |
| com.palm.applicationManager (legacy) | launch, open by type and URL, handlers, listApps, launch points, dock mode | runtime | `services/appmanager` over SAM (OSE's SAM has no open, handlers or dock mode, and launch is oem-only) | 🟡 | `services/appmanager`; `appmanager.test.ts` |
| com.palm.power | battery and charger, activities, shutdown, timeouts | runtime | phoenix-devices (`/com/palm/power`, `/shutdown`, signals `batteryStatus`/`USBDockStatus`); `/timeout` in the page as activitymanager activities | 🟡 | `services/devices`; runtime `powerTimeoutStart`; commit 00653a9 |
| com.palm.display, com.palm.keys, com.palm.vibrate, com.palm.ambientLightSensor | LunaSysMgr's device services | runtime | phoenix-devices | 🟡 | `services/devices` |
| com.palm.systemmanager | lock, passcode, policies | runtime | `services/systemmanager` | 🟡 | HARDWARE.md |
| com.palm.update | system updates | runtime | `services/updates` | 🟡 | `services/updates` |
| org.webosphoenix.clipboard | clipboard history | runtime | `services/clipboard` | 🟡 | E2 |
| org.webosphoenix.filemanager | files | runtime | `apps/files/service` (the shell may now write: perm for `com.webos.surfacemanager`) | 🟡 | `apps/files/service/sysbus` |
| org.webosphoenix.service.mediafiles | Camera's photos, Screenshot's edits | runtime keeps them in the page | page-local service over the file manager's `write`/`remove` and mediaindexer's `requestMediaScan` | 🟡 | runtime; commit 89dcda3 |
| org.webosphoenix.share, org.webosphoenix.filepicker | share sheet, file picker | runtime in the page | the same, in the page; targets from SAM `listApps`; data written through the file manager | 🟡 | runtime `shareSheet` |
| org.webosphoenix.dictation, org.webosphoenix.transcriber, org.webosphoenix.tts | speech | runtime + host models | the shell's local models; `apps/voicememos/service`; `services/tts` | 🟡 | commit e318dcf |
| org.webosphoenix.ongoing, org.webosphoenix.system | ongoing items; now playing, media keys, restart | runtime | `services/shellhost` | 🟡 (restartUi ⬜) | `services/shellhost` |
| org.webosphoenix.dropshare | DropShare (send to a computer over HTTP) | `phoenix-sim`'s `simdropshare.cpp` | `services/dropshare`, a Node HTTP server, files into `/media/internal/Downloads` | 🟡 | `services/dropshare`; commit 7f4e36a |
| org.webosphoenix.gamepads, usb, tethering, battery | E4 accessories | runtime + `SimSystemStatus` | `services/accessories` over PDM, connman adapter, `/sys/class/power_supply` | 🟡 | `services/accessories`; commit 3927550 |
| org.webosphoenix.pty | the Terminal | `phoenix-sim` | `services/pty` | 🟡 | `services/pty` |
| com.palm.service.accounts, contacts, contacts.linker, calendar.reminders | Open webOS's app services | runtime | the originals under OSE's mojoservicelauncher, with OSE bus files (`compat/app-services`) | 🟡 | install-rootfs `plan_app_services`; commit 7c12e58 |
| com.palm.audio | system sounds, ringer switch | runtime | `systemsounds` through audiod; the ringer switch has no source on OSE | 🟡 / ⬜ ringer | runtime |
| org.webosports.service.torch | flashlight | runtime | LuneOS's torchd (Apache-2.0); not packaged yet | ⬜ | runtime |
| com.palm.universalsearch | Just Type's search list | runtime | luna-universalsearchmgr (Open webOS, LuneOS packages it), not packaged (Q61) | ⬜ | runtime |
| com.palm.certificatemanager | certificates | runtime | certmgrd (LuneOS), not packaged | ⬜ | runtime |
| com.palm.storage | erase, mass storage | runtime + `SimStorage` | storaged (LuneOS), not packaged | ⬜ | runtime; `services/systemmanager` calls `erase/Wipe` |
| com.palm.image, com.palm.image2 | image conversion | runtime | none on OSE | ⬜ | runtime |
| com.palm.location, com.webos.service.location, org.webosphoenix.service.location | location | runtime | OSE has no location service | ⬜ | runtime |
| com.palm.imap, com.palm.pop, com.palm.smtp | mail | runtime | mojomail (C++), not built | ⬜ | runtime |
| com.webos.service.vpn | VPN | runtime | LuneOS's VPN adapter, no recipe | ⬜ | runtime |
| com.palm.browserServer | browser cookies and cache | runtime → host | none (Q38) | ⬜ | runtime |
| com.palm.sysMgrDataBackup | LunaSysMgr's backup of the launcher | runtime | the device shell's own files; not yet | ⬜ | runtime |
| com.palm.accountservices, com.palm.deviceprofile | HP profile, device profile | runtime | nothing (HP's servers are gone); answered in the page | ✅ | runtime |
| com.palm.appinstaller | Mojo-era installer | runtime | maps to appinstalld2 in the page | 🟡 | runtime |
| com.palm.pmvoicecommand | voice dial | Phoenix Voice Dial | the app | ✅ | apps/voicedial |
| com.palm.stservice | Touch to Share | runtime | needs the radio | 🚫 | runtime |
| com.palm.telephony, com.palm.wan, org.webosports.service.messaging | phone, data, SMS | runtime | needs a modem (oFono) | 🚫 (3) | runtime |
| org.webosphoenix.service.reset, org.webosphoenix.simulator | the simulator's reset and controls | runtime | not on a device | ✅ | runtime |

## 3. The page features WAM lacks or drops

WAM's injection defines `setWindowOrientation`, `enableFullScreenMode`,
`addBannerMessage`, `removeBannerMessage`, `clearBannerMessages`, `paste` and
`simulateMouseClick`, but its `HandleBrowserControlMessage` ignores them, so
filling in only missing methods never applied: the runtime overrides them.

| Item | What it does | Simulator path | Device path today | Status | Files |
| --- | --- | --- | --- | --- | --- |
| WAM's no-op methods | the list above | sim `PalmSystem` | overridden in `installDevice`/`installDeviceShell` | 🟡 | runtime `override()` |
| Paste | `PalmSystem.paste()` | the shell pastes the clipboard | `execCommand("paste")`, then the clipboard history's last clip, then `insertText` | 🟡 | runtime `pagePaste` |
| Edit menu and popup | Enyo's EditMenu, Mojo's editItem, long press | sim | `installEditing` + `editMenu` (above) | 🟡 | runtime |
| Links leaving the app | `http(s)` and other targets open the right app | sim `open` | `com.palm.applicationManager/open` (services/appmanager) | 🟡 | runtime `watchLinks` |
| App menu | the card's app menu | the shell's menu | `openAppMenu` shell event → `pageOpenAppMenu` | 🟡 | runtime; `LsmWindowSource.appMenu` |
| Card activation | Mojo's `activate`/`deactivate`, Enyo's `windowActivated` | the shell | `cardActivation` from `onFocusedUidChanged` | 🟡 | runtime `cardActivation` |
| `runTextIndexer` | linkify text | sim | in the page | 🟡 | runtime |
| Legacy fixes (fonts, border images, backdrop blur, list widths, HiDPI art, animation frames) | the original apps' look | sim | the same functions on a device | 🟡 | runtime `installDeviceShell` |
| Just Type's page | com.palm.launcher's Just Type | the shell | the page's surface in the shell's Just Type; retries while it starts | 🟡 | runtime `deviceJustType` |
| The system UI | com.palm.systemui (dashboards' host) | the shell | started hidden at boot (`preload: "partial"`) | 🟡 | `LsmWindowSource.startBootApps`; `tst_lsm` systemUiStartsHidden |
| Headless apps (`noWindow`) | apps with no card | sim | SAM launch with `preload: "partial"` (WAM keeps the window hidden) | 🟡 | `services/appmanager` |
| Child windows | `window.open` dashboards, popup alerts | sim | WAM makes none (Q37) | ⬜ | — |

## 4. What the shell draws over or into pages

| Item | Simulator path | Device path today | Status |
| --- | --- | --- | --- |
| Edit popup over a page | `Shell` over the page | `SurfaceHost.openEditPopup`, scaled by the page's scale | 🟡 |
| Scene transitions | snapshot of the page | LSM's view, `sceneTransitionPrepared` | 🟡 |
| Just Type's results | the page in the shell | the page's surface | 🟡 |
| Banners, dashboards, toasts | `Shell` | `LsmWindowSource` signals; OSE toasts as banners | 🟡 |
| Screen captures | the window | LSM's view | 🟡 |
| Keyboard over a page | `Shell` | Maliit (V5, another agent) | 🚫 |
| Browser page views | `phoenix-sim` | none (Q38) | ⬜ |
| OAuth sign-in sheet | a page view | `services/oauth` exists; the sheet needs a page view (Q38) | ⬜ |
| High contrast | the shell filters the pages | not yet on LSM | ⬜ |

## 5. App and Node services

Every service with a `sysbus/` folder is installed with its five
luna-service2 files and its code (`tools/test-install-rootfs.py` checks it):
assistant, tts, dav, fediverse, filemanager, packages, backup, transcriber,
oauth, clipboard, devices, hardware, pty, systemmanager, updates, shellhost,
appmanager, dropshare, accessories, and the four Open webOS app services. All
🟡 (written against OSE, tested here, not run). One open question for all
of them: apps without `requiredPermissions` get trust `dev`, and some groups
(the file manager's `filemanager.operation`) are oem-only (Q62).

## What is left and why

- **WAM child windows** (Q37): luna-systemui's dashboards and popup alerts
  come from `window.open`; WAM needs an extension. Biggest gap left.
- **Browser page views and OAuth** (Q38): WAM has no `<webview>`.
- **Restart UI on a device** (Q39): `systemctl restart` of LSM needs a route
  the shell may take.
- **LuneOS's packages of Open webOS** (Q61): universalsearchmgr, mojomail,
  storaged, certmgrd, torchd, the VPN adapter: recipes to add.
- **ACG for apps** (Q62).
- **Hardware**: modem (telephony, data, SMS), Touch to Share's radio.
- Smaller: `launcherLayout`/`launchPointIcon` (SAM's launch points),
  `keepAlive`, `launchModalApp`, the ringer switch, high contrast on LSM,
  accounts' `createLocalAccount` (an upstart job; OSE runs systemd).

Everything marked 🟡 needs a first image: HARDWARE.md, "Written for the
device, not yet run".
