# Web app runtime

Phoenix runs web apps: the original Open webOS apps (Enyo 1.0, 2011–2012)
and new Phoenix apps (Settings, Camera, Photos, Music, Tasks, ...). This page explains how they run
in the simulator, in a desktop browser, and on a device.

## Where the apps come from

| Source | What | License |
| --- | --- | --- |
| `third_party/core-apps` | Accounts, Calculator, Calendar, Clock, Contacts, Email, Memos | Apache-2.0 |
| `third_party/enyo-1.0` | The Enyo 1.0 framework they are written in | Apache-2.0 |
| `third_party/enyo-2/enyo`, `onyx`, `layout` | Enyo 2.5.2 with its Onyx widgets and Layout kinds, for Enyo 2 apps ([Enyo 2 apps](#enyo-2-apps)) | Apache-2.0 |
| `third_party/enyo-webos` | enyo-webos's `webOS.js`: the platform library Enyo 2 and Enact apps use for services, banners and device info | Apache-2.0 |
| `third_party/foundation-frameworks`, `loadable-frameworks`, `mojoloader`, `underscore` | Shared libraries loaded with MojoLoader (Calendar, Contacts, ...) | Apache-2.0 |
| `third_party/app-services` | The apps' background services (accounts, contacts, calendar reminders, email) | Apache-2.0 |
| `third_party/isis/isis-browser` | The browser ("Web"), from HP's Isis project | Apache-2.0 |
| `third_party/luna-applauncher`, `luna-systemui` | Original Just Type and system alert UIs | Apache-2.0 |
| `apps/` | New Phoenix apps | Apache-2.0 |

The `third_party` directories are git submodules of the original repositories,
unmodified. After cloning, run:

```sh
git submodule update --init
```

These apps are the **webOS 3.x (TouchPad) versions**, the only ones Palm/HP
open-sourced, so some are laid out for a 1024×768 tablet. Phone layouts are
part of porting them.

## The virtual webOS filesystem

The original apps load their framework from device paths such as
`/usr/palm/frameworks/enyo/0.10/framework/enyo.js`. `runtime/rootfs.json` maps
every device path to a directory in this repository, following the layout of
the Open webOS desktop build (`openwebos/build-desktop`):

- `mounts`: device path prefix → repository directory
- `applicationDirs`: directories whose children are apps (`appinfo.json`, or
  `dist/appinfo.json` for built apps), served at `/usr/palm/applications/<id>/`
- `systemApps`: single app directories for system UI (Just Type,
  `com.palm.launcher`), also served there but never shown in the launcher
- `overlays`: directories laid out like the device (`compat/rootfs/usr/...`)
  whose files win over everything else. Fixes and missing files for the
  original apps go here, so `third_party` stays pristine.

## phoenix-runtime.js

Web apps expect the device's web runtime to provide `PalmSystem` (app and
window info, banners, locale, ...) and `PalmServiceBridge` (calls on the Luna
service bus). `runtime/phoenix-runtime.js` runs before the app's own scripts:

- **On a webOS OSE device**, WebAppMgr provides both. The runtime only renames
  the legacy services that OSE registers under new names
  (`com.palm.systemservice` → `com.webos.service.systemservice`,
  `com.palm.applicationManager` → `com.webos.applicationManager`,
  `com.palm.connectionmanager` → `com.webos.service.connectionmanager`).
  OSE still registers db8 as `com.palm.db` and `com.palm.tempdb`.
- **In the simulator or a browser**, it provides both itself, with simulated
  services that store their data in localStorage: db8 (`put`, `get`, `merge`,
  `del`, `find`/`search` with `where`/`orderBy`/`limit`, `watch`, kind
  inheritance, revision sets, `_id`s for objects in arrays, the core apps'
  search index properties; each object and kind under a localStorage key of
  its own, so pages writing at once keep each other's changes, and watches
  fire for other pages' writes), system service (time, preferences), application
  manager (launch, open), connection manager, power, LunaSysMgr's device
  services (display, keys, vibrator, light sensor; see [Device
  services](#device-services-display-keys-vibrator-light-sensor)), and
  harmless stubs for the rest. Calls to a service it doesn't know return an error and are logged
  once. For the core apps it also simulates, modelled on
  `third_party/app-services`:
  - **accounts** (`com.palm.service.accounts`): accounts in db8, the account
    templates released with Open webOS (HP webOS profile, IMAP/POP/email)
    read from `/usr/palm/public/accounts/`, credentials; the HP webOS
    Account server returns the sample owner. Phoenix's CardDAV & CalDAV
    template and its transport are added by the CardDAV and CalDAV block (see
    [CardDAV and CalDAV](#carddav-and-caldav)).
  - **contacts linker** (`com.palm.service.contacts.linker`): runs the
    linker's own steps on the page's contacts framework (new contact,
    manual link/unlink); no automatic linking of similar contacts.
  - **email transports** (`com.palm.smtp`, `com.palm.imap`, `com.palm.pop`):
    saving drafts and sending (into Sent at once, bodies in a simulated file
    cache); there is no mail server, so syncs find nothing new.

  On first start it loads **sample data** (`runtime/sample-data.js`,
  simulator only, all fictional): an owner, the HP webOS profile account and
  an IMAP account, contacts, this week's calendar events, memos and emails
  (bodies in `runtime/sample-mail/`). `__phoenixRuntime.resetSampleData()`
  loads it again on the next start.

  It also puts back behaviour of the 2011 WebKit the Enyo 1.0 apps were
  written for: border images drawn without a border style (buttons, frames),
  `webkitCancelRequestAnimationFrame` (without it Enyo cancels unrelated
  timers and pane transitions hang), `PalmSystem.simulateMouseClick` (Enyo's
  focus-on-tap), card activation (`Mojo.stageActivated`; in phoenix-sim the
  shell also says when a card gains or leaves the front, as a
  `phoenixcardactivation` event with `{active}`, because a card minimized to
  card view stays visible), cross-app window params, and aliases for the
  Prelude font.

Pages talk to the shell (launch another app, show a banner) through
`phoenixHost.postToHost(type, payload)`. In phoenix-sim that arrives as a
console message with the `__phoenix__` prefix.

### Scene transitions

Mojo apps had the card do their scene changes, and so can any page:
`PalmSystem.prepareSceneTransition(isPop)` as the scene change begins (the
shell snapshots the card and shows the snapshot), then, once the new scene
is in the page, `PalmSystem.runSceneTransition(type, isPop)` with type
`"zoom-fade"` (Mojo's default) or `"cross-fade"`; or
`cancelSceneTransition()`. The card then animates from the snapshot to the
live page over 300 ms, as LunaSysMgr's `CardTransition.cpp` drew it: a push
zooms the new scene in from 0.75 over the fading old one, a pop zooms it
down from 1.25 under it. A host message cannot hold the page while the
shell takes its snapshot, as the original's IPC did, so
`prepareSceneTransition` also returns a promise that settles once the
snapshot is taken (or after 250 ms without a shell). Phoenix's apps use
`sceneTransition(change, {pop, type})` from `@phoenix/luna`, which waits
for it; `change` must update the page at once (in React, `flushSync`).
Settings opens and leaves its panes with it.

### Touch to Share

The TouchPad's Touch to Share, as the tap2share service
(`com.palm.stservice`, not in the open-source release) ran it with
LunaSysMgr: `com.palm.systemmanager/touchToShareDeviceInRange {inRange}`
shows the glow while a phone is near; when the phone touches the device,
the app in front, if its `appinfo.json` says `"tapToShareSupported": true`
(the browser), is relaunched with `{sendDataToShare: true}` and answers
with `com.palm.stservice/shareData {data: {target, type, mimetype}}`; then
`touchToShareAppUrlTransferred {appid}` sends its card to card view and
throws a ghost of it off the top, with `tap_to_share.mp3`. In phoenix-sim
**Shift+F7** brings a phone in range or takes it away and **Ctrl+F7**
touches it to the device (`--touch-to-share` starts with one in range); the
data the phone received is logged (`Touch to Share: <appId> sent {...}`).

### DropShare

DropShare (`org.webosphoenix.dropshare`, `apps/dropshare`) is Phoenix's
own take on the webOS Archive's LuneDrop, built on Touch to Share
(docs/M6-PLAN.md F4 item 8). It moves files to and from any phone or
computer on the same network, through a web page the device serves:
- **Receive**: the DropShare card shows a QR code of an address like
  `http://192.168.1.20:41813/<token>/`. Any browser that opens it gets a
  page to pick files (`web/receive.html`). Each file is a
  `POST <token>/upload?name=&type=`, then `POST <token>/done`. Files land
  in `/media/internal/Downloads` (a second of a name is numbered). An
  ongoing activity shows while they come, and a notification opens Files
  at Downloads.
- **Send**: the share sheet offers DropShare for files (its `shareTargets`).
  The card shows the address of a page listing them (`web/send.html`,
  `GET <token>/files`, `GET <token>/file/N`).
- **Touch to Share**: DropShare is `tapToShareSupported`. A webOS phone
  touched to the device gets the address (`shareData {target}`) and
  opens it.
- **Security**: off until the user turns it on (Settings > DropShare,
  system preference `dropShareEnabled`). Each session has a new token of
  128 random bits in every address; anything else is 404. A session ends
  when the transfer is done, after ten minutes without a request, or when
  the card closes; the port closes with it. Limits: 512 MB a file, 2 GB
  and 50 files a session.

The service is `org.webosphoenix.dropshare` (`receive`, `send {files}`,
`stop`, `getStatus`; `@phoenix/luna` `dropShare`). In phoenix-sim the
server is `SimDropShare` (`shell/sim/simdropshare.h`, plain Qt Network,
bound to every interface). The runtime drives it through the scheme
handler's `/__phoenix/dropshare`, and hands it the files to send in
base64 parts: QtWebEngine's `requestBody()` reads a large POST only part
way, or blocks. The simulator logs each address (`DropShare: receive at
...`). A desktop browser has no server, so the service says so.
`build/simnet-test` runs the server over real sockets;
`tools/test-sharing.cjs` drives the app against a fake one. On a device a
small Node service serves the same requests: the same two pages, the
same JSON operations, the device's LAN address.

### Accessories, tethering and the battery

Phoenix's services for Settings > Game Controllers, USB, Hotspot &
Tethering and Battery (docs/M6-PLAN.md F4 items 8-9; `@phoenix/luna`
`gamepads`, `usbDrives`, `tethering`, `battery`). In the simulator the
hardware is phoenix-sim's Simulate menu, which reaches the pages as shell
status (`gamepads`, `usbDrives`, `formFactor`, `usageTick`; the runtime's
`hostStatusHooks`):
- **Game controllers** (`org.webosphoenix.gamepads/list`): the Gamepad API
  works in every web app under QtWebEngine. Chromium's own controllers (the
  computer's) and the simulator's (Ctrl+Shift+G, A on Ctrl+Shift+A) both
  come from `navigator.getGamepads()`, with `gamepadconnected` and
  `gamepaddisconnected` events. On a device, Bluetooth controllers pair in
  Settings > Bluetooth (BlueZ's HID profile makes them evdev devices), and
  USB ones are evdev devices at once. Chromium reads both through udev, so
  WebAppMgr's Chromium needs the gamepad service (udev) and access to
  `/dev/input/event*` for the web apps' user.
- **USB drives** (`org.webosphoenix.usb`: `listDrives`, `unmount`,
  `mount`): drives in the device's own port, in host mode with an OTG
  cable (Ctrl+Shift+U in the simulator). A notification says when one
  goes in, and Safely Remove lets it go. On a device: udisks2 over D-Bus
  (`org.freedesktop.UDisks2`: `Filesystem.Mount` under `/media/usb/<label>`,
  `Filesystem.Unmount` then `Drive.PowerOff` for Safely Remove,
  `InterfacesAdded` / `InterfacesRemoved` for drives coming and going). The
  kernel needs the port in host or OTG mode (`dr_mode` or the role
  switch).
- **Hotspot & Tethering** (`org.webosphoenix.tethering`: `getStatus`,
  `setWifi {enabled, ssid, passphrase, security}`, `setUsb {enabled}`):
  phones only (`available` is false where the shell says "tablet"). An
  ongoing activity shows while it is on. On a device: OSE's connman
  (`net.connman.Technology` `SetProperty Tethering` with `TetheringIdentifier`
  and `TetheringPassphrase` for Wi-Fi, the gadget technology for USB), or
  NetworkManager where it runs (`nmcli connection add type wifi mode ap
  ipv4.method shared`, and a shared connection on the USB gadget's `usb0`).
- **Battery** (`org.webosphoenix.battery/usage`): the level over the last
  24 hours (each change powerd reports, `runtime.recordBattery`), and how
  long each app was in front with the screen on (the shell's `usageTick`,
  every minute and when the app in front changes). Each app's share is an
  estimate from that time. The simulator seeds a demo day the first time,
  as `runtime/sample-data.js` seeds the apps. On a device the shell keeps
  the same ticks, and the level comes from powerd's `batteryStatus`.
- **Temperature**: powerd's `batteryStatus` carries `temperature_C`
  (Ctrl+Shift+T in the simulator: 31, 46, 51 °C). luna-systemui warns,
  through a compat overlay (`data/phoenix-temperature.js`, after Jason
  Robitaille's Device Temperature Warnings patch): a banner at 45 °C, a
  Device Too Hot alert at 50 °C (`app/PowerdAlerts/
  phoenix-temperature-alert.js`). It checks every five minutes, and on each
  signal. Each warning comes once, until the battery cools 2 °C below its
  mark. `--scene hot` shows the alert.

### Editing: Cut, Copy, Paste, Select All

Every app menu starts with **Edit** (Select All, Cut, Copy, Paste), as Mojo
gave every app. Enyo 1.0 apps get Enyo's own `EditMenu`. The runtime adds
it to `enyo.AppMenu` as Enyo defines it, first on screen and first in the
menu's items. It is added only when the lazy menu makes its items, and not
at all when an app has its own. The apps are not changed. Phoenix apps get
the same submenu from `@phoenix/ui`'s `AppMenu` (`edit={false}` leaves it
out). Its items read `__phoenixRuntime.editState()` as the menu opens, and
it keeps the field's focus while you choose.

- Select All, Cut and Copy are the page's own commands. As in Enyo's
  `Input`, `__phoenixRuntime.edit(action)` runs them. Enyo's `EditMenu`
  sends them to the focused Enyo control, as on webOS.
- Paste is `PalmSystem.paste()`. In phoenix-sim it posts `editAction
  {action: "paste"}`, and the shell pastes the system clipboard into the
  page (`WebEngineView.triggerWebAction`), as WebAppMgr did on webOS. In a
  plain browser the runtime reads the clipboard itself.
- There is one clipboard, the system's. Copy from any app, the browser's
  pages or the shell, and paste into any other.
- Pressing and holding text shows the **edit popup**
  (`shell/qml/Phoenix/Shell/EditPopup.qml`), with only the commands that
  apply:
  - **Touch:** Chromium's own long press selects the word and shows its
    handles. The shell draws the handles in the highlight colour.
  - **Mouse:** a press and hold of 500 ms without moving selects the word.
    The runtime then posts `editMenu {x, y, width, height, canSelectAll,
    canCut, canCopy, canPaste}`.
  - **Right click:** also shows the popup.

  The popup is not shown for text the page keeps unselectable (Enyo 1.0's
  own UI, as on webOS), nor on buttons or links. The browser's embedded
  pages get the same popup, and the adapter's `cut`, `copy`, `paste` and
  `selectAll` act on them. Just Type's built-in search field has the popup
  too.

Tests: `tools/test-editing.cjs` (Memos and Files in Chromium) and
`shell/tests/tst_editpopup.qml`.

Every copy is also kept in the clipboard history (see
[Clipboard history](#clipboard-history)), and Copy and Cut work in a
password field, where Chromium refuses them: the runtime copies the
selection itself and keeps it as a secret.

System sounds follow LunaSysMgr's routes. `PalmSystem.addBannerMessage(msg,
params, icon, soundClass, soundFile, duration)` puts the sound in the
`banner` message; `PalmSystem.playSoundNotification(soundClass, soundFile,
duration)` posts a `sound` message; a popup alert's `sound` and
`soundclass` window attributes travel in its URL fragment
(`phoenixSound`, `phoenixSoundClass`). The shell decides what plays
(`shell/qml/Phoenix/Shell/SoundPolicy.js`) and plays it through one runtime
page with the simulated audiod: `com.webos.service.audio` `playSound
{fileName, sink}` (plus Phoenix's `loop`, `duration`, `volume`, `fallback`),
`controlPlayback {playbackId, requestType: "stop"}` and `playFeedback
{name, sink?}` (also `com.palm.audio/systemsounds/playFeedback`), all with
HTML audio (`__phoenixRuntime.sounds`). The sounds are Open webOS's
`/usr/palm/sounds` and Phoenix's feedback clicks in
`/usr/share/phoenix/sounds/feedback` (`shell/assets/sounds/PROVENANCE.md`).

The Settings app's services (Wi-Fi, Bluetooth, settings service, audio, ...)
are simulated in their own clearly marked block at the end of the runtime;
see [Settings](#settings) below. The media services (media indexer, camera,
media files) follow in another; see [Camera, Photos and Music](#camera-photos-and-music).
Then come, each in its own block: the file manager service and the legacy
app installer used by Files (see [Files](#files)); the activity manager
(`com.palm.activitymanager`) and `com.palm.power` timeouts, which fire
scheduled activities such as Tasks' reminders (see [Tasks](#tasks)); the
speech-to-text service of Voice Memos (see [Voice Memos](#voice-memos));
the CardDAV and CalDAV account's transport (see
[CardDAV and CalDAV](#carddav-and-caldav)); HTTP, the download manager and
audio focus for the reading and listening apps (see [Videos, Podcasts, PDF
View and Doc View](#videos-podcasts-pdf-view-and-doc-view)); then the torch and the
location service (see [Flashlight](#flashlight) and [Weather](#weather));
the Terminal's shells, `org.webosphoenix.pty` (see
[Terminal](#terminal)); and last First Use, emergency information,
location and help (see [First Use](#first-use),
[Emergency information](#emergency-information),
[Location](#location) and [Help](#help)).

## Enyo 2 apps

Enyo 2 (2012–2016, with the Onyx widget set) came after the TouchPad. Palm's
own apps never used it, but LuneOS's apps (`org.webosports.app.*`), many
App Museum titles and LG's early webOS TV apps did. It is no longer
developed: the last release is 2.7.0 (April 2016), and LG's successor is
Enact, a React framework used by webOS TV and webOS OSE.

The simulator serves Enyo 2.5.2, the last release that loads in a browser
from source without a build step, the way Enyo 2 apps' debug builds did:

| Device path | Repository |
| --- | --- |
| `/usr/palm/frameworks/enyo2/enyo/` | `third_party/enyo-2/enyo` (tag 2.5.2) |
| `/usr/palm/frameworks/enyo2/lib/onyx/`, `lib/layout/` | `third_party/enyo-2/onyx`, `layout` (2.5.2); `$lib` in `package.js` resolves here |
| `/usr/palm/frameworks/enyo2/webOS/` | `third_party/enyo-webos/webOS` (`webOS.js`) |

Released Enyo 2 apps were built with `deploy`, which bundles Enyo into the
app, so they run without these paths; the paths are for apps loaded from
source. `apps/enyo2demo` (temporary) samples the Onyx widgets and the
`webOS.js` calls. `webOS.js` sets no `webOS.platform` flag on Phoenix, because
it only recognises webOS 3 when `PalmSystem.deviceInfo` reports
`platformVersionMinor` as a truthy value, which the TouchPad's `0` is not; its
calls then take the OSE route, so `webOS.notification.showToast` uses OSE's
`com.webos.notification` `createToast`, which the runtime shows as the calling
app's banner.

## Enact apps

Enact is LG's current web app framework (React), used by webOS TV and
webOS OSE, with themes that give apps their look: Limestone (webOS TV
today, the successor of Sandstone, which has had no release since April
2025), Agate (touch screens and car dashboards) and others. Two temporary
demos show it: `apps/enact-notes-limestone` and `apps/enact-notes-agate`,
the same Apple Notes-style app in each theme, sharing their notes in db8
(`apps/shared/notes-core`).

- **Built with Enact's CLI** (`enact pack`), which expects the app's
  packages in the app's own `node_modules`: with npm workspaces' hoisting
  it writes theme fonts outside `dist/` and points iLib at the wrong path.
  So each demo is an npm project of its own with its own lock file, not a
  workspace of `apps/`, and takes shared code as a built package
  (`install-links`). CMake and CI build them after `apps/`.
- **Served like the other built apps**: `dist/` holds `appinfo.json` (from
  `webos-meta/`), the fonts and iLib's data.
- **Luna calls** go through Enact's `@enact/webos/LS2Request`, on
  `PalmServiceBridge` (or `WebOSServiceBridge` on OSE).
- **TypeScript**: Enact ships type definitions generated from its JSDoc;
  where they are wrong, `src/enact.ts` in each app says so and corrects
  them.
- **Findings**: Limestone is sized for a TV, and its CSS needs Chromium 119+
  (relative colours; Qt 6.4's WebEngine is 102). Text fields in both themes
  lock the pointer while editing (the first tap outside only ends editing),
  which suits a remote, not a touch screen. The app READMEs have the
  details.
- **Platform**: Enact's `@enact/webos/platform` finds webOS OSE in Phoenix
  (`open: true`, from `PalmSystem.deviceInfo`'s platform version), not a TV
  (`tv` needs "SmartTV" in the user agent). Nothing changes on screen for
  it: Limestone reads the platform only to ask a TV's input service whether
  a remote pointer is in use.

## Ionic and Flutter apps

Two more demos of the same Notes app weigh frameworks for 2.0 apps, both
laid out for phones and tablets and sharing the Enact demos' notes in db8:

- **Ionic** (`apps/ionic-notes`): Ionic 9's React components (iOS and
  Material Design modes) with its router, built with Vite as a workspace of
  `apps/`. Luna calls go through `@phoenix/luna`; the model is
  `@phoenix/notes-core`, the same code as the Enact demos. The back
  gesture (Escape) becomes Ionic's hardware back button. `@ionic/react`
  cannot be tree-shaken, so the app is about 1.5 MB of script.
- **Flutter** (`apps/flutter-notes`): Flutter's web build (dart2js and the
  CanvasKit renderer) with Material 3 widgets. Luna calls go through
  `PalmServiceBridge` from Dart (`dart:js_interop`); the model is a Dart
  port of notes-core, whose tests check it keeps the same kinds and
  welcome note. CanvasKit and the fonts are bundled, so nothing is fetched
  from Google's CDN. Built only when Flutter is installed (CMake finds it). In phoenix-sim it
  needs Qt 6.6+, whose `FetchApiAllowed` scheme flag lets Flutter
  `fetch()` its renderer and fonts from `phoenix://`.
  Flutter draws into a canvas, and its semantics tree (on here for screen
  readers) is what tests drive. LG's native Flutter embedder for webOS TV
  is the route for native Flutter apps later; the READMEs compare them.

## Running apps

**In the simulator.** Build `phoenix-sim` with Qt WebEngine (Homebrew's `qt`
includes it; on Ubuntu `scripts/linux-setup.sh` installs Qt 6.8.1 with it).
The apps then appear in the launcher and quick launch with their original
icons.

```sh
./build/phoenix-sim --launch com.palm.app.notes
```

Windows an app opens (`window.open`, `enyo.windows.activate`) become new cards
in that app's stack. Headless apps (`"noWindow": true` in `appinfo.json`, e.g.
Calendar, Clock, Email) run their main page invisibly, and each window they
open is a card, as on webOS.

**Launch at boot and keep alive** (`SimWindowSource`, after luna.conf). At
start-up the launch-at-boot apps start without a card, with the launch
params `{"launchedAtBoot": true}` (Email and Calendar then open nothing:
`Launch.js`, `App.handleLaunchParams`): phones Phone, Email, Calendar,
Messaging and Camera (`conf/luna.conf` [LaunchAtBoot]), tablets the same
without Camera (`luna-topaz.conf`); the original ids map to the Phoenix
apps that replace them. A headless app keeps its page; any other keeps its
window, ready, and its first launch shows it at once. Closing the last card
of a keep-alive app keeps the app running without a card, and the next
launch brings the same window back and relaunches it (the page gets the
launch params, `webOSRelaunch` / `Mojo.relaunch`): phones keep Phone
([KeepAlive]); tablets Email, Calendar, Messaging, Photos and Music
(`luna-topaz.conf`); both keep the browser until memory runs low
([KeepAliveUntilMemPressure]: when `MemoryMonitor` says low, it closes).
A page can ask for its own window (`PalmSystem.keepAlive(true)`: Email's
main card, Calendar's), as WebAppMgr's off-screen cache did. The angry card
(thrown down off the screen) and a window the app closes itself end the app
for good (`CardWindowManager::closeWindow` / `setDisableKeepAlive`).
`--scene` and the tests build their own scenes and start no boot apps
(`SimWindowSource.bootAppsEnabled`, which `sim.qml` turns on).

**In a desktop browser.**

```sh
tools/serve-rootfs.py        # then open http://127.0.0.1:8765/
```

This serves the same filesystem and adds the runtime to every app page
(and to the framework pages apps open as windows, such as Enyo's dashboard
window). It's
handy for debugging an app with the browser's developer tools.

**Automated check.** `node tools/test-apps.cjs [--tablet]` loads every app in
headless Chromium, follows the windows headless apps open, and fails if an app
marked as working in `tools/app-expectations.json` stops starting cleanly.
`node tools/smoke-apps.cjs [--tablet]` then uses each core app (12×3 in
Calculator, a new memo, an alarm, opening and adding a contact and a calendar
event, reading and sending an email, the account settings) and checks the
result. Screenshots of both go to `build/app-tests/`.

phoenix-sim keeps its web storage (and so the sample data) in its Qt
WebEngine profile, `~/.local/share/phoenix-sim/`. Delete it, or point
`XDG_DATA_HOME` elsewhere, to start from fresh sample data.

**Log lines you can ignore.** phoenix-sim prints each page's console. A few
lines come from the original code doing what it always did:

- `enyo.xhr.request() exception: NetworkError ... tellurium_config.json`, once
  per Enyo 1.0 page. Enyo's startup looks for the config of Tellurium, Palm's
  test automation, at `/usr/palm/frameworks/tellurium/`. Phoenix doesn't ship
  it, so the read fails, Enyo logs it and Tellurium stays off, as on a device
  without it. (Qt's scheme handlers can only fail a request, not answer 404,
  so a missing file is a network error.)
- `AppPrefs: Access to pref listSortOrder before prefs object is ready` in
  Contacts: the contacts framework reads a pref while its prefs are still
  loading from db8, and uses the default.
- `errorHandler({"errorId":"PDK error","msg":"plugin failed to load"})` in
  Quickoffice: its native plugin can't run yet ([PDK.md](PDK.md)).
- `tile memory limits exceeded, some content may not draw`: Chromium's
  compositor on a very tall page; the page draws as it scrolls.

## Phone layouts

The core apps are the TouchPad (1024×768) versions. On a phone card (320
wide) they get small compat stylesheets and, where the app is a split view,
a small script, loaded by an overlay of the app's `depends.js` in
`compat/rootfs/`. The artwork, fonts and colours stay the same:

- **Calculator, Clock, Memos**: the fixed-size calculator body, clock faces
  and sticky notes are fitted to the card.
- **Contacts**: list or details, one at a time; the back gesture returns to
  the list (the app's own unused narrow-mode back handler, now wired up).
- **Calendar**: the day/week/month views already adapt; headings, toolbar,
  event details and the event editor are fitted.
- **Email**: Enyo's SlidingPane already shows one pane at a time below
  500 px; choosing a folder or a message now moves to the next pane.
- **Accounts** and the account pages inside the other apps: the Enyo
  accounts library's 500 px column uses the card width.

## Orientation

The shell turns its whole UI with the device (`UiRotation.qml`, after
LunaSysMgr's `WindowServer`); the apps take part the way they did under
WebAppMgr:

- **Asking for an orientation.** `PalmSystem.setWindowOrientation(o)`
  (Enyo 1.0's `enyo.setAllowedOrientation`, Mojo's
  `stageController.setWindowOrientation`) with `"free"`, `"up"`, `"down"`,
  `"left"`, `"right"`, `"landscape"` or `"portrait"` posts
  `windowOrientation {orientation}` to the shell. Enyo asks for `"free"`
  once loaded. appinfo.json's `requestedWindowOrientation` is the card's
  orientation until the page asks. While the card is maximized the UI stays
  in that orientation (the device's wait until it is minimized), and
  maximizing it turns the UI there with a cross-fade; in card view a card
  held another way than the UI is drawn turned.
- **Being turned.** When the card's window turns, the shell resizes the
  page to the turned card and calls
  `__phoenixRuntime.screenOrientationChanged(o)`: `PalmSystem.screenOrientation`
  and `windowOrientation` change, Mojo apps get
  `Mojo.screenOrientationChanged(o)`, and a `resize` event goes out, so Enyo's
  `windowRotated` (`enyo.ApplicationEvents` `onWindowRotated`) follows, also
  for a half turn.
- **Asking how things are turned.** `com.palm.systemmanager/getSystemStatus`
  (subscribable) answers `{ime: {visible}, orientation: {ui, device}}` as the
  shell last reported (`orientation` in `applyHostStatus`), and Phoenix's
  `gestureArea` (the device has the strip below the screen; Settings offers
  Advanced gestures by it).

`tools/test-orientation.cjs` checks all three with the original Calculator.

## On a device

`tools/install-rootfs.py DESTDIR` installs the same filesystem for an image:
apps under `/usr/palm/applications` (where webOS OSE's application manager
still looks for system apps), frameworks under `/usr/palm/frameworks`, the
runtime under `/usr/share/phoenix/runtime`, and each app's db8 kinds and
permissions under `/etc/palm/db`. An app's Node.js Luna service
(`apps/<app>/service`, e.g. Files' or Voice Memos') goes to `/usr/palm/services/<service id>`,
where `run-js-service` starts it, and its `sysbus/` role, permission, groups,
manifest and service files to `/usr/share/luna-service2/*.d`. Overlays are
applied and app pages (and framework pages opened as windows, such as
Enyo's dashboard window) get the runtime `<script>` tag. The `phoenix-apps` recipe in `meta-phoenix` runs it,
and `webos-phoenix-image` includes it. Built apps (`dist/`) must be built
before the recipe runs.

## Status of the original apps

See `tools/app-expectations.json` for the current list.
All seven start cleanly and are usable on phone and tablet
(`tools/app-expectations.json` has per-app notes). What is still missing:

- **Servers**: no mail, contacts or calendar sync; new accounts cannot be
  signed in (nothing to validate credentials against).
- **Background services**: calendar reminders are stored but never fire (the
  reminders service is not simulated). The simulated activity manager now
  fires scheduled activities, so the Clock's alarms launch Clock with their
  ring params, but that is not yet checked end to end; no alarm popups.
- **Contacts**: no automatic linking of similar contacts, photos, or vCard
  import/export.

- **Servers**: contacts and calendars sync with a CardDAV & CalDAV account
  (below); there is no mail server, so email accounts cannot be signed in.
- **Background services**: scheduled activities fire (the activity manager
  block; see [Tasks](#tasks)), but Clock alarms and calendar reminders have
  not been checked end to end.
- **Contacts**: contacts are linked into people only when a CardDAV sync
  adds them (the linker's strongest rules); no photos for local contacts, no
  vCard import/export.
- The Contacts and Accounts sources listed in `depends.js` but missing from the
  Open webOS release (`Ringtones.js`, `NameDetails.js`, `FirstLaunch.js`) are
  empty stand-ins; nothing in the released apps uses them.
- **Memos** has one bug fix (overlay `app/views/EditView.js`): its hidden
  editor saved on every card deactivation, even with no memo open, and after
  one minimize no memo could be opened. It now saves on deactivation only while
  a memo is open; `tools/smoke-apps.cjs` minimizes it before and during an edit.

Phoenix Settings (`org.webosphoenix.settings` and its launch points) starts
cleanly on phone and tablet; `node tools/test-settings.cjs [--tablet]` also
drives it (Wi-Fi, password, PIN, brightness, airplane mode, Bluetooth).
Phoenix Phone and Messaging start cleanly too, and
`node tools/test-phone-messaging.cjs [--tablet]` places, holds and ends a
call, answers and ignores simulated incoming calls, and sends and receives
texts, picture messages (MMS) and instant messages (a Jabber account on
the simulated server).

Camera, Photos and Music start cleanly too, and `node tools/test-media.cjs
[--tablet]` drives them. So does Files, driven by `node tools/test-files.cjs
[--tablet]`, and Tasks, driven by `node tools/test-tasks.cjs [--tablet]`.

[--tablet]`, and Voice Memos, driven by `node tools/test-voicememos.cjs
[--tablet]`. Passwords and Authenticator are driven by
`node tools/test-passwords.cjs [--tablet]` and `node tools/test-authenticator.cjs
[--tablet]`, and the Terminal by `node tools/test-terminal.cjs
[--tablet]`. First
Use, Help, emergency information and Location Services have
`tools/test-firstuse.cjs`, `tools/test-help.cjs`, `tools/test-emergency.cjs`
and `tools/test-location.cjs` (each with `--tablet`).

## Phoenix apps (React + TypeScript)

New Phoenix apps live in `apps/`, an npm workspace:

| Path | What |
| --- | --- |
| `apps/shared/luna` (`@phoenix/luna`) | Typed client for `PalmServiceBridge`: `call()` returns a promise, `subscribe()` a cancellable subscription, errors are `LunaError`s. `types.ts` types the OSE methods the apps use; `services.ts` wraps them (`wifi.connect()`, `bluetooth.pair()`, ...), each citing the OSE source it follows; `db8.ts` (`db.find/put/merge/watch`), `contacts.ts` (`com.palm.person:1`), `telephony.ts` and `messaging.ts` serve Phone and Messaging, `media.ts` Camera, Photos and Music, `files.ts` Files (`fileManager`, `appInstaller`, `openWith`, path and size helpers), `tasks.ts` Tasks (`com.palm.task:1`, `com.palm.tasklist:1`, reminder activities, `postNotification`); `@phoenix/luna/react` has `useLuna()` and `useLaunchParams()` |

| `apps/shared/luna` (`@phoenix/luna`) | Typed client for `PalmServiceBridge`: `call()` returns a promise, `subscribe()` a cancellable subscription, errors are `LunaError`s. `types.ts` types the OSE methods the apps use; `services.ts` wraps them (`wifi.connect()`, `bluetooth.pair()`, ...), each citing the OSE source it follows; `db8.ts` (`db.find/put/merge/watch`), `contacts.ts` (`com.palm.person:1`), `telephony.ts` and `messaging.ts` serve Phone and Messaging, `media.ts` Camera, Photos and Music, `files.ts` Files (`fileManager`, `appInstaller`, `openWith`, path and size helpers), `transcriber.ts` Voice Memos (`transcriber.transcribe()` with progress, `TRANSCRIBE_ERRORS`), `location.ts` the location service and per-app permissions (`location`, `locationPermissions`, `LOCATION_ERRORS`), `setup.ts` First Use, the medical ID, accessibility and the emergency numbers (`firstUse`, `emergencyInfo`, `accessibility`, `isEmergencyNumber`); `vpn.ts` the VPN service (`vpn`, file import helpers), `backup.ts` the backup service (`backup`, `BACKUP_PARTS`), `search.ts` Just Type's preferences (`universalSearch`), `certificates.ts` the certificate store (`certificates`, `CERTIFICATE_ERRORS`), and in `telephony.ts` the phone preferences (`phonePrefs`, `mobileData`); `@phoenix/luna/react` has `useLuna()` and `useLaunchParams()` |
| `apps/shared/phoenix-ui` (`@phoenix/ui`) | React components with the webOS 1.x/2.x look, drawn with the Enyo 1.0 "Heritage" artwork (copied into `assets/enyo`, see its `PROVENANCE.md`): `PageHeader`, `Group`, `Row`, `Divider`, `ToggleButton`, `Slider` (also as a progress/seek bar), `ListSelector`, `Picker`, `PopupMenu`, `Button`, `Drawer`, `DividerDrawer`, `Dialog`, `Spinner`, `TextField`; for Phone and Messaging the webOS dial pad (`Dialpad`, `DialButton`, `BackspaceButton`, from Enyo's `lib/telephony` art), the command menu (`ToolBar`, `RadioToolGroup`, `ToolButton`), `Avatar` and number / time formatting (`formatDuration` takes milliseconds); for the media apps `Toolbar`, `IconToolButton`, `GroupedToolButtons`, `Glyph` and `formatSeconds`; for Files `CheckBox` (Heritage `checkbox.png`) and file glyphs (copy, cut, paste, new folder, ...); `BackProvider`/`useBack` for the back gesture |
| `apps/settings` | Settings (see below) |
| `apps/phone`, `apps/messaging` | Phone and Messaging (see below) |
| `apps/camera`, `apps/photos`, `apps/music` | Camera, Photos, Music (see [below](#camera-photos-and-music)); `@phoenix/luna`'s `media.ts` wraps their services |
| `apps/media-samples` | Generated demo photos and songs, mounted at `/media/internal/samples` |
| `apps/files` | Files (see [below](#files)); `apps/files/service` is its Node.js Luna service for the device |
| `apps/tasks` | Tasks (see [below](#tasks)) |

| `apps/voicememos` | Voice Memos (see [below](#voice-memos)); `apps/voicememos/service` is its speech-to-text Luna service (whisper.cpp) for the device |
| `apps/flashlight`, `apps/scanner`, `apps/weather` | Flashlight, QR Scanner and Weather (see [below](#flashlight)); `@phoenix/luna`'s `torch.ts` and `location.ts` wrap `org.webosports.service.torch` and `com.webos.service.location` |
| `apps/shared/secrets` (`@phoenix/secrets`) | For the apps that hold secrets: TOTP/HOTP and `otpauth://` URIs (RFC 6238/4226, on WebCrypto HMAC), base32, sealing with AES-GCM and PBKDF2 (`sealJson`, `wrapKey`, passphrase files), `SecretClipboard` (clears itself), `AutoLock` (screen lock, card minimized, idle); `@phoenix/secrets/react` has `useAutoLock()`, `useTotpCode()`, `CountdownRing` |
| `apps/passwords` | Passwords, a KeePass (KDBX 4) password manager (see [below](#passwords-and-authenticator)) |
| `apps/authenticator` | Authenticator, TOTP/HOTP codes (see [below](#passwords-and-authenticator)) |
| `apps/terminal` | Terminal (see [below](#terminal)): xterm.js on `org.webosphoenix.pty`, the C++ PTY service in `services/pty`; `@phoenix/luna`'s `pty.ts` is its client |
| `apps/videos`, `apps/podcasts`, `apps/pdfview`, `apps/docview` | Videos, Podcasts, PDF View and Doc View (see [below](#videos-podcasts-pdf-view-and-doc-view)); `@phoenix/luna`'s `web.ts` (HTTP, download manager), `playback.ts` (audio focus, `nowPlaying`, orientation) and `documents.ts` (launch targets, reading files, finding documents) serve them |

| `apps/firstuse` | First Use (see [below](#first-use)) |
| `apps/printmanager` | Print Manager (see [below](#printing)); `@phoenix/luna`'s `print.ts` is the print manager's client and `@phoenix/ui`'s `PrintDialog` the print dialog for Phoenix apps |
| `apps/voicedial` | Voice Dial (see [below](#voice-dial)); `@phoenix/luna`'s `dictation.ts` is the client of `org.webosphoenix.dictation`, the shell's microphone and transcriber |
| `apps/help` | Help (see [below](#help)); its topics are Markdown files in `apps/help/topics` |

| `apps/dav` | The CardDAV & CalDAV account (see [below](#carddav-and-caldav)): a hidden Enyo 1.0 app with the account's sign-in page, its db8 kinds and account template, and `apps/dav/service`, its Node.js Luna service and sync engine |

Build (Node.js 22 or 24 LTS; 20.19+ also works):

```sh
cd apps
npm ci
npm run build       # every app into apps/<name>/dist/
npm test            # vitest: the Luna client (also against the simulated services) and components
npm run typecheck
```

`cmake --build` runs the same (`npm ci` when `package-lock.json` changes, then
`npm run build`) through the `phoenix-apps` target when npm is installed;
`-DPHOENIX_BUILD_APPS=OFF` turns it off. For live reloading while working on
an app, `npm run dev -w @phoenix/settings` serves it with Vite (without the
runtime: open it through `tools/serve-rootfs.py` to get the simulated services).

Each app's `dist/` is a complete webOS app (`appinfo.json`, `index.html`,
icons, relative asset paths), so `runtime/rootfs.json`'s `applicationDirs`
entry for `apps` picks it up. `dist/` and `node_modules/` are not committed.

Icons: `icon.png` is 64 px; ship `icon-256x256.png` too and name it as
`"splashicon"`, as the Open webOS apps did, with `icon-128x128.png` and
`icon-512x512.png` beside it, named as the webOS fields `"largeIcon"` and
`"extraLargeIcon"` (Enact's packer copies only the files `appinfo.json`
names); the shell picks the one for the screen's
density and draws the bigger ones on the loading card (a launch point's
`icons/name.png` gets `icons/name-128x128.png` and so on). Phoenix's icons
are SVG in `art/app-icons`, the app's object on the webOS glass disc (user
apps) or grey diamond (system apps), rendered by `tools/render-app-icons.cjs`
(docs/spec/app-icons.md, docs/spec/hidpi-art.md).

### Launcher metadata and launch points

`appinfo.json` may have a `phoenix` object, read by `shell/sim/rootfs.cpp` and
`tools/serve-rootfs.py`:

```json
"phoenix": {
    "launcherTab": 2,
    "hidden": true,
    "launchPoints": [
        { "id": "org.webosphoenix.settings.wifi", "title": "Wi-Fi", "icon": "icons/wifi.png", "params": { "page": "wifi" } }
    ]
}
```

- `launcherTab`: 0 Apps, 1 Downloads, 2 Settings, 3 Favorites. Without
  it the launcher places a new app as luna-sysmgr did
  (`LauncherLayout.pageFor`): by its `category`, then its `keywords`,
  through the keyword map (`conf/launcher3/app-keywords-to-designator-map.txt`,
  which ships only a placeholder; Phoenix adds "settings" and "preferences"
  for the Settings page); else the app catalog (the Marketplace) and apps
  the user installed go to Downloads, a built-in app of category
  "Settings" to Settings, the rest to Apps
  (`pageIndexForAppByPredefinedDesignators`). Apps in
  `conf/launcher3/app_blacklist.conf` (`com.palm.sysapp.launchermode0`)
  never show. The launcher's pages are Apps, Downloads, Favorites and
  Settings, as on the TouchPad; a layout saved before Favorites keeps its
  three pages.
- `hidden`: leave the app itself out of the launcher (its launch points stay)
- `quickLaunch`: put the app in this quick launch slot (1-4); Phone is 1 and
  Messaging 3 (Email 2 and Calendar 4 are set by title in `SimWindowSource`)
- `launchPoints`: extra launcher icons for the same app. Each is its own
  card and starts the app with `params` as its launch params
  (`PalmSystem.launchParams`, `?launchParams=` on the page URL). A web app
  whose title matches a placeholder (Wi-Fi, Bluetooth, ...) replaces it.

At the top level of `appinfo.json` (not in `phoenix`), Phoenix also reads
`"multipleInstances": true`: the app runs in several windows at once, so
the launcher's icon menu offers New Window, which starts another instance
in a stack of its own (`launchNewInstance`). The original browser, whose
`appinfo.json` stays as released, counts as one (`SimWindowSource`
`multipleInstanceApps`): it opens a card on every launch anyway.

An app can also add launch points of its own at run time, as on webOS
(`applicationManager/addLaunchPoint {id, title, icon, params, removable}`
-> `{launchPointId}`, eight digits; `removeLaunchPoint {launchPointId}`).
They go on the launcher's Favorites page (`slotAppAuxiliaryIconAdd`), have
the (–) remove decorator in edit mode ("Remove Shortcut?"), and survive
restarts: phoenix-sim keeps each as `/var/luna/launchpoints/<id>` in its
data folder, as LunaSysMgr did. The browser's Share > Add to Launcher makes
one (see [The browser](#the-browser-and-enyowebview)).

On OSE, the same launch points are registered with SAM
(`com.webos.applicationManager/addLaunchPoint`), and launch params arrive the
same way. When the shell launches an app that is already running with new
params, the page gets OSE's `webOSRelaunch` document event
(`__phoenixRuntime.relaunch()` in the simulator); `useLaunchParams()` handles
both. A `launch` host message (`applicationManager/launch {id, params}`) whose
params match a launch point opens that launch point's card.

## Settings

`apps/settings` is one app with one launch point per pane, like the separate
preference apps of webOS 2.x: Wi-Fi, Bluetooth, Airplane Mode, Phone Preferences, Screen & Lock,
Sounds & Ringtones, Date & Time, Language & Region, Text Assist, Just Type,
Accessibility, Location Services, Emergency Info, Certificate Manager,
Device Info, Backup, Updates, VPN, Developer Mode.
Launched without a page it lists them all. The launcher icons are drawn in
`art/app-icons` (on the grey diamond, as Palm's preference apps were) and the
wallpapers by
`tools/make-wallpapers.py` (CC0); Palm's were never open-sourced.

### Services

The app codes against webOS OSE's services, checked against their sources
(webosose GitHub). The simulator implements exactly these calls, with the
same request and reply shapes:

| Pane | Service and methods | Source |
| --- | --- | --- |
| Wi-Fi | `com.webos.service.wifi`: `setstate`, `getstatus`, `findnetworks`, `connect` (`ssid` + `security.simpleSecurity.passKey`, or `profileId`; error 10 = wrong password), `deleteprofile` | `webos-connman-adapter` `src/wifi_service.c` |
| Airplane Mode | `com.webos.service.connectionmanager`: `getstatus` (`offlineMode`), `setstate {offlineMode}` | `webos-connman-adapter` `src/connectionmanager_service.c` |
| Bluetooth | `com.webos.service.bluetooth2`: `adapter/getStatus`, `adapter/setState {powered}`, `adapter/startDiscovery`, `adapter/cancelDiscovery`, `adapter/pair`, `adapter/unpair`, `device/getStatus` | `com.webos.service.bluetooth2` `src/bluetoothmanagerservice.cpp`, `bluetoothmanageradapter.cpp` |
| Screen & Lock | `com.webos.settingsservice` `get/setSystemSettings {category: "picture", backlight}`; `com.webos.service.systemservice` `get/setPreferences` (`screenTimeout`, `rotationLock`, `wallpaper`, `showAlertsWhenLocked`, `blinkNotifications`) | `settingsservice` `inc/SettingsServiceApi.h`; `luna-sysservice` `Src/PrefsFactory.cpp` (stores any key) |
| Screen & Lock (PIN) | `com.palm.systemmanager` `getDeviceLockMode`, `setDevicePasscode`, `matchDevicePasscode` (and `getSecurityPolicy`: a security policy's rules; see [Device security](#device-security-erase-usb-drive-mode-and-debugging)): the legacy webOS API; OSE has none, so Phoenix will have to provide it | `openwebos/luna-sysmgr` `Src/base/SystemService.cpp` |
| Sounds | `com.webos.service.audio` `master/getVolume`, `master/setVolume`, `master/muteVolume`, `getInputVolume` / `setInputVolume` (`streamType` `pringtones`, `palerts`, `pfeedback`, `pmedia`), `playFeedback`, `playSound`, `controlPlayback`; system service `ringtone`, `alerttone`, `notificationtone` (`{name, fullPath}`: Open webOS's alert.wav and notification.wav or any ringtone; the shell plays them for alerts, alarms and reminders, and for notifications, that name no sound of their own, as LunaSysMgr's `AlertWindow` and `BannerMessageHandler` did), `systemSounds`, `x_palm_virtualkeyboard_prefs` (`TapSounds`: Keyboard clicks), `ringtone/listRingtones` | `audiod-pro` `src/modules/masterVolumeManager`, `audioPolicyManager`, `systemSoundsManager`; `luna-sysmgr` `conf/defaultPreferences.txt`, `Src/base/settings/Preferences.cpp` |
| Text Assist | system service `get/setPreferences`: `x_palm_virtualkeyboard_prefs` (`WordSuggestions`, `AutoCorrect`, `SwipeTyping`, `spaces2period`, `ForgetWords`, `keyboards`), `keyboardShortcuts`, and `x_palm_textinput` (`shortcutChecking` `"autoCorrect"` / `"off"`; Phoenix adds `shortcuts: [{shortcut, text}]`, the user's text replacements). The runtime gives the shell's keyboard `systemStatus` `textAssist` (`suggestions`, `autoCorrect`, `swipe`, `spaces2period`, `forgetWords`, `shortcuts` as `{typed: text}`, `shortcutsOn`); the space bar puts a shortcut's text in (`TextAssist.js` `shortcut()`), in any keyboard language, and backspace puts the shortcut back | `luna-sysmgr` `conf/defaultPreferences.txt` (`x_palm_textinput`), `Src/ime/VirtualKeyboardPreferences.cpp` |
| Date & Time | system service `get/setPreferences` (`timeFormat`, `useNetworkTime`, `useNetworkTimeZone`, `timeZone`), `getPreferenceValues {key: "timeZone"}`, `time/getSystemTime`, `time/setSystemTime {utc}` | `luna-sysservice` `Src/TimePrefsHandler.cpp` |
| Language & Region | `com.webos.settingsservice` `get/setSystemSettings {keys: ["localeInfo"]}` (`locales.UI`, `locales.FMT`) | `settingsservice` |
| Device Info | system service `deviceInfo/query`, `osInfo/query`; `com.palm.power` `batteryStatusQuery` (legacy); `com.palm.telephony` `platformQuery` (IMEI/MEID, carrier), `subscriberIdQuery` (`msisdn`: the phone number), `simStatusQuery`, `networkStatusQuery`; settings service `resetSystemSettings`; `org.webosphoenix.service.reset` `eraseUserData` (apps' data and settings; the user's files on the USB drive are kept, as legacy webOS's "Erase Apps & Data") and `fullErase` (everything, files too) (Phoenix, simulator only so far); "Help and tips" and "Run setup again" launch Help and First Use (`{rerun: true}`) | `luna-sysservice` `Src/DeviceInfoService.cpp`, `OsInfoService.cpp` |
| Backup | `org.webosphoenix.service.backup` `getStatus`, `configure`, `backupNow`, `listBackups`, `inspect`, `restore`, `deleteBackup` | see [Backup](#backup) |
| Accessibility | system service `get/setPreferences` `accessibility {reduceMotion, highContrast, monoAudio, captions}` (Phoenix key) | `luna-sysservice` `Src/PrefsFactory.cpp` (stores any key) |
| Location Services | `com.webos.service.location` `getAllLocationHandlers`, `setState {Handler, state}`, `getLocationUpdates`, `getReverseLocation`; `org.webosphoenix.service.location` `getPermissions`, `setPermission`, `removePermission` (Phoenix) | see [Location](#location) |
| Emergency Info | system service `get/setPreferences` `emergencyInfo` (Phoenix key); contacts from db8 `com.palm.person:1` | see [Emergency information](#emergency-information) |
| Phone Preferences | `com.palm.telephony` `forwardQuery {condition: "unconditional", bearer, subscribe}` / `forwardRegister {number, condition, bearer, time}` (call forwarding; `""` stops it), `clirQuery` / `clirSet {restrict}` (Show My Caller ID), `callWaitingQuery` / `callWaitingSet {bearer, enable}`, `voicemailNumberQuery {subscribe}` / `voicemailNumberSet {number}`, `roamModeQuery` / `roamModeSet {mode: "automatic" \| "carrieronly"}` (Voice Network), `ratQuery` / `ratSet {mode: "automatic" \| "umts" \| "gsm"}` (Network Type); the supplementary services answer errorCode 102 without the network (airplane mode). `com.palm.wan` `getstatus {subscribe}` (`disablewan` `"on"`: Data Usage off; `roamguard` `"enable"`: Data Roaming off) and `set {disablewan, roamguard}`. In the simulator unconditional forwarding sends an incoming call on (it does not ring), and the runtime's `systemStatus` `callForwarding` shows the status bar's call-forward icon. The Phone app's menu has Preferences. webOS had no Power preferences app (the battery is in Device Info) | `com.palm.app.phone` `shared/phoneprefs/controls/CallsPref.js`, `NetworkPref.js`, `VoicemailNumberPref.js` (the original app, as LuneOS's CE build ships it); `luna-sysmgr` `StatusBarServicesConnector.cpp:1956-2046` |
| Certificate Manager | `com.palm.certificatemanager` `listcertificates` (`userCertificateStore`: the user's, as Wi-Fi setup reads them; Phoenix adds `certificates`, all of them, and `subscribe`), `getcertificatedetails {certificateFilename \| certificateId}` (subject and issuer `commonname`, `organization`, `organizationalunit`, `location`, `state`, `country`, `altname`; `startdate`, `expiredate`, `serialNumber`, `version`, `signature.algorithm`, `publicKey.algorithm`; Phoenix adds `publicKey.bits` / `curve`, `fingerprints {sha256, sha1}`, `isCA`, `trusted`, `system`, `pem`); Phoenix: `addcertificate {certificateFilename}` (PEM, one or more, or DER, read with `org.webosphoenix.filemanager`), `setcertificatetrust {certificateId, trusted}`, `removecertificate {certificateId}`, `restorecertificates`; errors -1 to -5 (`CERTIFICATE_ERRORS`). The simulator parses X.509 itself (no signature checks) and keeps the store in the runtime's store; the system's CAs are `runtime/certs` (`/usr/share/phoenix/runtime/certs`). `com.palm.app.certificate` opens the pane, as Device Info's app menu and Email's "Open Certificate Manager" did; certificates are added from the files on `/media/internal` (`.crt`, `.pem`, `.cer`, `.der`; the demo media has `samples/documents/phoenix-lab-root-ca.crt`) | Enyo 1.0 `lib/wifi/wifi.js` (`listcertificates`), `isis-browser` `source/CertificateDetail.js` (`getcertificatedetails`); `luna-sysmgr` `ApplicationManagerService.cpp:3822` |
| Developer Mode | `com.webos.service.devmode` `getDevMode {subscribe}`, `setDevMode {status: "enabled" \| "disabled"}`; `com.palm.systemmanager` `getDeviceLockMode`, `matchDevicePasscode` | OSE's Developer Mode service (`com.webos.service.devmode`); see [Developer Mode](#developer-mode) |
| VPN | `com.webos.service.vpn` (LuneOS): `getStatus` (connection states and credential prompts, subscribed), `getProfileList`, `getProfileDetails`, `getConnectionDetails`, `getAgents`, `getAgentFormFields`, `addProfile`, `updateProfile`, `deleteProfile`, `connect`, `disconnect`, `uiPromptResponse`, `cancelUiPrompt`; errors -1 to -10 as legacy `com.palm.vpn`. A `.ovpn` is written with `org.webosphoenix.filemanager` to `/media/internal/vpn` and used as `OpenVPN.ConfigFile`; a WireGuard `.conf` is split into its fields (`@phoenix/luna` `parseWireGuardConf`). The shell's VPN drawer gets the profiles from `systemStatus` `vpnProfiles` and sends `{vpnConnect}` / `{vpnDisconnect}` | `luneos-vpn-adapter` `src/vpn_service.c`, `vpn_errors.h`, `vpn_providers.c`, `files/formfields/*.json` (commit 40bdda2) |

The simulated services keep their state in the runtime's store (shared by
every app window, persistent across restarts) and have a few simulated
networks and devices. Passwords that work: `Phoenix` = `phoenix123`,
`Lab 5G` = `webos2009`, `Neighbor` = `12345`.

### The shell in the simulator

Settings and the status bar stay in step:

1. Whenever a radio, airplane mode, brightness, mute, rotation lock or the
   wallpaper changes, and when a page starts, the runtime posts
   `systemStatus` (`wifiEnabled`, `wifiConnected`, `wifiBars`, `bluetoothOn`,
   `airplaneMode`, `brightness` 0-100, `volume` 0-100, `rotationLocked`,
   `muted`, `reduceMotion`, `wallpaperFile`). The system menu has a volume
   slider below brightness (a Phoenix addition, in the brightness row's
   art); on a device it is `com.webos.service.audio` `master/setVolume`.
2. `SimWindowSource` turns the wallpaper's device path into a file URL and
   emits `systemStatusReported(status)`; `sim.qml` applies it with
   `SimSystemStatus.applyAppStatus()` and sets the shell wallpaper.
3. When the user changes something in the system menu, `sim.qml` sends just
   that key (`SimSystemStatus.appStatusFor()`) to every web page with
   `SimWindowSource.pushSystemStatus()`, which runs
   `__phoenixRuntime.applyHostStatus({...})`. The runtime applies it (airplane
   mode also switches the radios off) and answers with one `systemStatus`.
   Changes made while no web page runs wait for the next page to load.

Without Qt WebEngine none of this runs and the system menu works on its own.
On a device, `LsmSystemStatus` would subscribe to the same OSE services
instead (Milestone 1).

## Phone and Messaging

`apps/phone` (`org.webosphoenix.phone`) and `apps/messaging`
(`org.webosphoenix.messaging`) replace the Phone and Messaging placeholders
and sit in quick launch slots 1 and 3. Palm never open-sourced the webOS
phone and messaging apps, so these are new, drawn with the Enyo 1.0 art:
the webOS dial pad and dial button (`lib/telephony/dialpad`), the Heritage
command menu, the lock screen's incoming-call handset, the contacts
framework's avatar.

- **Phone**: dial pad (hold 0 for +, hold 1 for voicemail, an empty dial
  button recalls the last number, the number is matched to a contact as you
  type), call log (all / missed, by day, tap to call back, voicemail entry
  on top), favourites and contacts from `com.palm.person:1`, the in-call
  screen (timer, mute, speaker, keypad with touch tones, hold / resume, a
  held second call to swap to, end), and the incoming call (Answer / Ignore,
  "Hold & Answer" for a waiting call). Incoming and missed calls post a
  banner (`PalmSystem.addBannerMessage`), which the shell shows as a banner
  and dashboard item. Ended calls are logged as `com.palm.phonecall:1`.
  Tablet: dial pad on the left, log or favourites on the right.
- **Messaging**: Conversations / Buddies view menu, conversations newest
  first with unread counts, the conversation as chat balloons with time
  stamps and sending status, compose with a "To:" field that suggests
  contacts by name or number and IM buddies. The compose bar's attach
  button opens the system picture picker
  (`org.webosphoenix.filepicker/pick`); the picture waits above the field
  and the message goes as MMS, its pictures shown in the balloon (tap: full
  screen, with Share). **Buddies**: My Status per IM account (Available /
  Busy / Offline, Offline signs out), the buddies of signed-in accounts
  grouped by presence with their status messages (tap: chat), Accounts to
  add one; an IM conversation shows the buddy's presence under the name and
  sends by their service, text only. AIM, Google Talk, Yahoo! and Skype are
  listed as not available (closed networks). Tablet: conversations on the
  left, the conversation on the right.

Launch params: Phone `{number}` fills in the dial pad, `{number, dial: true}`
calls it at once (Voice Dial); Messaging
`{threadId}` opens a conversation, `{to, name}` starts a message,
`{attachment}` or a share's `{share: {files}}` with a picture starts a
picture message (Messaging is a share target for `image/*`).

### Services

webOS OSE has no telephony. LuneOS (webOS-ports) reimplemented the legacy
webOS services on oFono, so the apps code against those, and the runtime
simulates exactly these calls (block "Phone and Messaging services" at the
end of `runtime/phoenix-runtime.js`):

| What | Service and methods | Source |
| --- | --- | --- |
| Calls | `com.palm.telephony` `dial {number, blockId}`, `answer {id}`, `ignore {id}`, `hangup {id}`; `isTelephonyReady`, `powerQuery`, `platformQuery`, `networkStatusQuery` | `webOS-ports/webos-telephonyd` `src/telephonyservice.c`, `src/telephonyservice_call.c` |
| Call state | `com.palm.telephony` `callStatusQuery {subscribe}` -> `{calls: [{id, state, number, name, direction, startTime, connectTime, endTime, disconnectReason}], muted, speaker}`, `hold`, `unhold`, `sendDtmf {tones}`, `muteSet {mute}`, `speakerSet {speaker}`, `voicemailQuery {subscribe}`: **Phoenix additions**. telephonyd leaves call state to oFono, which the LuneOS phone app reads directly (`qml/services/VoiceCallMgrWrapper.qml`); these follow oFono's VoiceCall states and its VoiceCallManager, CallVolume and MessageWaiting APIs | oFono `doc/voicecall-api.txt` and friends |
| Contacts | db8 `com.palm.person:1` (`name`, `phoneNumbers[{value, type, normalizedValue}]`, `favorite`, `sortKey`) | `third_party/app-services/com.palm.service.contacts.linker/db/kinds/com.palm.person` |
| Call log | db8 `com.palm.phonecall:1` (`type` incoming / outgoing / missed / ignored, `timestamp`, `duration`, `from`, `to[]`), written by the app | LuneOS phone app `qml/model/CallHistory.qml` |
| Texts | db8 `com.palm.smsmessage:1` (extends `com.palm.message:1`: `folder` inbox / outbox, `status` pending / sending / successful / failed, `messageText`, `from`, `to[]`, `conversations[]`, `flags.read`), `com.palm.chatthread:1` (`displayName`, `summary`, `timestamp`, `unreadCount`, `personId`, `replyAddress`) | `webos-telephonyd` `files/db8/kinds`, `src/telephonyservice_sms.c`; `webOS-ports/org.webosports.messaging` `service/configuration/db/kinds` |
| Sending | `org.webosports.service.messaging` `putMessage {message}` -> `{threadids}`: assigns the thread and stores the message; the telephony service then sends outbox messages with status pending (`sendSmsFromDb`) | `org.webosports.messaging` `service/javascript/assistants/PutMessage.js`, `utils/MessageAssigner.js`; `webos-telephonyd` `files/activities/com.palm.telephony/outgoing-sms.json` |
| Picture messages | db8 `com.palm.mmsmessage:1` (extends `com.palm.message:1`; `serviceName: "mms"`, `parts[{path, mimeType, name}]`), shipped by Messaging. `putMessage` first copies each part into `/media/internal/.mms/` so the message keeps its picture (the media indexer skips dot folders); the summary reads "Picture: text" | the legacy `com.palm.mmsmessage` kind (`webos-telephonyd` leaves MMS to `mmsd`, which LuneOS never wired up) |
| Instant messages | db8 `com.palm.immessage:1` / `com.palm.immessage.xmpp:1` (`serviceName: "type_jabber"`, `username` = your account), `com.palm.imloginstate:1` (per account: `state` online / offline, `availability` 0 available, 2 busy, 4 offline, `customMessage`), tempdb `com.palm.imbuddystatus:1` (`username`, `displayName`, `availability`, `status`, `personId`). An IM conversation is its own `com.palm.chatthread:1` (`replyService`, `replyAddress` = the buddy, `username`); a person's texts and IMs are not merged into one thread | the readers in the tree: Enyo 1.0 `lib/contactsui/UI/PersonList.js` (`imloginstate`, `imbuddystatus` from tempdb), Email `facades/ContactCache.js`; `webOS-ports/org.webosports.messaging` `service/configuration/db/kinds` |
| IM transport | `org.webosphoenix.service.xmpp`: the Synergy callbacks of the `com.webosphoenix.xmpp` account template (Accounts > Add > Jabber (XMPP), `runtime/accounts/com.webosphoenix.xmpp`): `checkCredentials`, `onCreate`, `onEnabled` (signs in: login state + roster), `onDelete` (state, roster, IM conversations); `setPresence {accountId, availability}` (Phoenix) | the template layout of the legacy Synergy accounts (`com.palm.service.accounts`) |

The apps ship their db8 kinds in `public/configuration/db/kinds`, which
`tools/install-rootfs.py` installs to `/etc/palm/db/kinds`.

### In the simulator

The simulated telephony keeps its calls in the runtime's store
(`telephony:state`), so every page sees the same calls; a dialled call goes
dialing -> alerting -> active in about two seconds, an unanswered incoming
call is missed after 30 s, and dialling fails in airplane mode. db8 watches
fire across windows, so Messaging updates when another page stores a text.
First start seeds demo data: seven fictional contacts with 555 numbers
(four favourites), a few calls and three conversations
(`__phoenixRuntime.seedPhoneDemoData(true)` resets them).

Helpers for tests and the shell:

- `__phoenixRuntime.simulateIncomingCall({number?, name?})` rings the phone
  (phoenix-sim **F4**: brings the Phone card up ringing)
- `__phoenixRuntime.simulateRemoteHangup()`
- `__phoenixRuntime.simulateIncomingSms({from?, text?})` stores a received
  text and posts `phoenixHost.postToHost("notification", {appId, title,
  body})` for Messaging, which `SimWindowSource` shows as a banner and
  dashboard item for that app (phoenix-sim **F5**)
- `__phoenixRuntime.simulateIncomingMms({from?, text?, image?})` the same
  for a picture message (default: a sample photo from Ada; **Shift+F5**)
- `__phoenixRuntime.simulateIncomingIm({from?, text?})` an instant message
  to the first signed-in Jabber account (**Ctrl+F5**);
  `__phoenixRuntime.xmpp.setBuddyPresence(jid, availability, status?)`

The IM server is simulated: any `name@chat.example` with a password signs
in, the roster is four of the demo contacts (Ada and Lena available,
Marcus busy, Theo offline), and a buddy who is not offline answers a
message after about two seconds. Sending fails while signed out or in
airplane mode. A real transport (XMPP, as planned in
`docs/SYNERGY-MODERN.md`) registers with
`runtime.registerImTransport(service, send)` the same way.

db8 here follows `extends` through every level (`com.palm.immessage.xmpp:1`
-> `com.palm.immessage:1` -> `com.palm.message:1`), and watches on tempdb
fire across windows as db8's do.

## Camera, Photos and Music

`apps/camera`, `apps/photos` and `apps/music` rebuild the webOS 2.x Camera,
Photos & Videos and Music apps (Palm never open-sourced them) with the
`@phoenix/ui` kit, which gained the Heritage command menu (`Toolbar`,
`IconToolButton`), grouped tool buttons, a progress `Slider` and white glyphs for
them.

- **Camera**: full-card viewfinder, flash (auto/on/off) at the top left, the
  last shot at the bottom left (tap to open it in Photos), the shutter, and the
  photo/video switch. Taking a picture closes and opens a shutter over the
  viewfinder and flies the frame into the thumbnail; nothing makes a sound.
  Without a camera, or when access is refused, it says so. Pictures and videos
  go to `/media/internal/DCIM/100PHNX/CIMGnnnn.jpg|webm`.
- **Photos**: albums are folders (Camera Roll, Sample Photos, ...), a
  thumbnail grid per album, and a black full-screen viewer: swipe (or the arrow
  keys) between pictures, tap for the title and the command menu: share (Email
  with the picture attached, or Messaging), set as wallpaper, delete. Videos
  play in the viewer. Launched with `{imageList: {results: [item]}}` or
  `{target: path}` it opens that picture.
- **Music**: Artists / Albums / Songs, album and artist pages, Now Playing
  (cover with reflection, seek bar, volume, previous / play / next, shuffle,
  repeat) and a mini player above the library.

### Services

| What | Service and methods | Source |
| --- | --- | --- |
| Find media | `com.webos.service.mediaindexer` `getImageList`, `getVideoList`, `getAudioList` `{uri, count, subscribe}` (first reply `{subscribed: true}`, then `{imageList: {results, count}}` and again on every change), `get*Metadata {uri}`, `getDeviceList` | `com.webos.service.mediaindexer` `src/indexerservice.cpp`, `src/dbconnector/mediadb.cpp` (reply shapes, item fields), `src/mediaitem.cpp` (field names) |
| Index a new file | mediaindexer `requestMediaScan {path}`, as `com.webos.app.camera` does after a snapshot | same; `webosose/com.webos.app.camera` `src/actions/syncMedia.js` |
| Forget a file | mediaindexer `requestDelete {uri}` | same |
| Is there a camera | `com.webos.service.camera2` `getCameraList` (`deviceList: [{id: "camera1"}]`), `getInfo {id}` | `com.webos.service.camera` `src/services/camera/camera_service.cpp`, `json_parser.cpp` |
| Viewfinder, capture, recording | the web runtime's `getUserMedia`, canvas JPEG and `MediaRecorder` (WebM) | Chromium (WebAppMgr) |
| Save and delete files | `org.webosphoenix.service.mediafiles` `write {path, data (base64), mimeType}`, `remove {path}`, under `/media/internal` only | Phoenix; simulator only so far (a page cannot write files) |
| Open the shot in Photos | `com.webos.applicationManager` `launch {id, params: {imageList: {results: [item], count: 1}}}` | `com.webos.app.camera` `src/actions/launchActions.js` |
| Set as wallpaper | `com.webos.service.systemservice` `setPreferences {wallpaper: {wallpaperName, wallpaperFile}}`, the preference Settings' Screen & Lock sets. OSE dropped legacy webOS's `wallpaper/importWallpaper`, so the file is used as it is | `luna-sysservice` `Src/PrefsFactory.cpp` |
| Play songs | HTML5 `<audio>`: WebAppMgr plays web media through uMediaServer (`com.webos.media`) | `webosose/umediaserver` |
| Volume | `com.webos.service.audio` `getInputVolume` / `setInputVolume {streamType: "pmedia"}` | `audiod-pro` |
| Legacy media kinds | the simulator mirrors the index into db8 as `com.palm.media.image.file:1`, `com.palm.media.audio.file:1`, `com.palm.media.video.file:1` (webOS 2.x/3.x), for legacy apps | legacy webOS media indexer |

Item uris are the storage device's uri plus the path
(`storage:///media/internal/DCIM/100PHNX/CIMG0001.jpg`); an app shows a file
with `mediaUrl(path)` from `@phoenix/luna` (`file://` + path on a device, a
`blob:` URL for simulator files). OSE's media indexer indexes the paths in its
`STORAGE_DEVS` build setting (`/media/multimedia` by default); Phoenix uses
`/media/internal`, as legacy webOS did, and `meta-phoenix` will have to set it.

Music posts a `nowPlaying` host message (`{title, artist, album, playing}`)
whenever the song or play state changes, and a banner
(`PalmSystem.addBannerMessage`) when a new song starts while its card is in
the background. The shell does not show a now-playing dashboard yet.

### In the simulator

The runtime's media block keeps files in IndexedDB (`phoenix-media`, shared by
every app page) and the index in the shared store; a picture taken in Camera
reaches Photos' subscription through a `storage` event. The demo media in
`apps/media-samples/media` (generated by its `tools/make-samples.cjs`, CC0) is
mounted at `/media/internal/samples` (`runtime/rootfs.json`) and indexed from
its `index.json` on first use. For a wallpaper under `/media`, `systemStatus`
also carries `wallpaperUrl`, a `data:` URL of the picture, since the shell
cannot read IndexedDB.

phoenix-sim grants web pages the camera and microphone and lets media start
without a tap (as WebAppMgr does). Chromium's test camera stands in for a real
one: `QTWEBENGINE_CHROMIUM_FLAGS=--use-fake-device-for-media-stream`.

`node tools/test-media.cjs [--tablet]` takes a photo and a video with the fake
camera, opens the shot in Photos, swipes the viewer, sets a wallpaper, deletes
the photo, and plays, pauses, seeks and skips a song, with screenshots in
`build/media-tests/`.

## Just Type

Typing in card view opens the original Just Type, `com.palm.launcher` from
`openwebos/luna-applauncher`: the TouchPad's universal search, with its
Launch, Contacts, Content, web search and Quick Actions sections. The shell
shows it over the cards (`JustType.qml`); in the simulator it is one page
that stays loaded (`SimWindowSource.justTypeWindow()`), and gets each search
as it is typed. What it finds comes from:

- the application manager's `listLaunchPoints` and `searchApps`, answered
  from the installed apps (`/usr/share/phoenix/apps.json`, which phoenix-sim
  and `tools/serve-rootfs.py` generate);
- contacts, through the contacts library and db8;
- `com.palm.universalsearch`, simulated after
  `openwebos/luna-universalsearchmgr`: the web search engines from its
  `UniversalSearchList.json`, and the actions ("New Memo") and content
  searches ("Calendar Events") that apps declare in the `universalSearch`
  field of their `appinfo.json`.

Its app menu (the status bar's "Just Type", as `SystemUiController` made the
title actionable) is the page's own Enyo `AppMenu`: Preferences launches
`com.palm.app.searchpreferences`, which the runtime opens as Settings > Just
Type, and Help (Enyo's `HelpMenu` opens `com.palm.app.help` with a help.palm.com address, which the runtime turns into Phoenix's Help at the matching topic; this goes for every original app's Help). The back gesture goes to the page: an open menu closes
first, then Just Type (`SimWindowSource.justTypeAppMenu()`,
`justTypeBack()`).

Settings > Just Type (`apps/settings/src/pages/JustType.tsx`) changes what it
shows through the same service, after luna-universalsearchmgr's methods
(`Src/UniversalSearchService.cpp:75-92`): `setSearchPreference` (`AppSearch`,
`ContactSearch`, `GAL`, `defaultSearch`), `updateSearchItem {category, id,
enabled, setDefault}`, `updateAllSearchItems` and `reorderSearchItem
{category, id, toIndex}` (the item's new place in its category; the
original counted it below the default engine). `getUniversalSearchList`
lists each category in the user's order, which Just Type follows.

`tools/test-justtype.cjs` uses it end to end. On a device, the compositor
still has to show `com.palm.launcher`'s window this way (see the roadmap).

## The browser and enyo.WebView

The browser is HP's Enyo browser from the Isis project
(`isis-project/isis-browser`), unmodified. Its page view, like Email's
message view, is `enyo.WebView`, which on webOS was the BrowserAdapter
plugin (`<object type="application/x-palm-browser">`) showing pages that
BrowserServer rendered with WebKit. The runtime gives those objects the
plugin's scripting API (`openURL`, `goBack`, `reloadPage`, ...) and its
callbacks (`urlTitleChanged`, `loadProgressChanged`, ...), with one of two
engines behind them:

- **phoenix-sim**: a native Chromium view per object, laid over its
  rectangle inside the card (`WebAppWindow.qml`) and hidden while an Enyo
  menu or dialog is open. Any site works, as in a real browser.
  `phoenix-sim --open <url>` opens a page in it.
- **A desktop browser** (`tools/serve-rootfs.py`, the Playwright tests): an
  `<iframe>`, so only sites that allow framing show, and only same-origin
  pages report their titles.

Share > Add to Launcher works as on webOS: the plugin's
`saveViewToFile`, `generateIconFromFile` and `resizeImage` make the page's
thumbnail and a 64 px icon in `/var/luna/data/browser/icons/`
(phoenix-sim's `SimSnapshots`: the shell takes a picture of the page's
Chromium view; the icon is the top of the page in a rounded frame, since
BrowserServer's own art was never released), the dialog shows it, and Add
to Launcher calls `applicationManager/addLaunchPoint` with the page's
address: a launcher icon on Favorites that opens the page in its own
card. The calls return at once, as the plugin's did; a picture still being
made is served when it is ready. In a desktop browser the page is an
`<iframe>`, so there is no picture and the shortcut gets the browser's icon.

Links for other apps (`mailto:`, `tel:`, `sms:`) go to them through
`/usr/palm/command-resource-handlers.json` (a compat file), as the
application manager's `open` does on webOS. `tools/test-browser.cjs` browses
with it end to end.

**Downloads.** A file the page view does not show (a PDF, a link with
`download`) is not downloaded by Chromium: phoenix-sim's view hands it
back to the page as BrowserAdapter did, with the plugin's
`mimeNotSupported(mime, url)` callback (`WebAppWindow.qml` catches the
profile's `downloadRequested` for that view). The browser then does what
it always did: `getResourceInfo` names the app for the type, and
`com.palm.downloadmanager/download` fetches the file into
`/media/internal/Downloads` (the folder Files shows), while Isis's own
Downloads drawer shows the progress bar. The simulated download manager
reports the real progress, read from the host's proxy while the body
comes (`/__phoenix/proxy/progress`), and shows each download as an
[ongoing activity](#ongoing-activities); a tap opens the browser's
Downloads drawer (`{toasterOpen: "downloads"}`, the params of its
"finished downloading" banner). Open in the drawer, or tapping the file in
Files, opens it in its app (PDF View for a PDF). A type no app opens gets
the browser's original "Cannot open MIME type", as on webOS, whose
application manager had no handler for it either. Downloaded files are not
apps: the launcher's Downloads tab lists installed apps, as on webOS.
`tools/test-browser.cjs` (download) and `apps/shared/luna/src/
mediaapps.test.ts` check it; the native view's hand-back was checked in
phoenix-sim. The drawer (`enyo.Toaster`) flies in over the page: the native
view keeps to the part it leaves uncovered (on a phone, none), since
nothing in the page can draw over it.

**The page views' profile and the community's features** (docs/M6-PLAN.md
F4 item 7). In phoenix-sim the page views use a web profile of their own
("phoenix-web"), apart from the apps' pages, as BrowserServer kept its
own cookies and cache (`simBrowser`, `shell/sim/simbrowser.h`). A compat
overlay of the browser (`source/phoenix-browser.js`) adds:
- **Private Browsing**, an app menu check item per card. The toolbars turn
  red and the card's pages go to no history. The adapter's Phoenix call
  `setPrivateBrowsing(on)` moves the native view to an off-the-record
  profile at the same page (host message `webView {op: "private"}`). That
  profile is dropped once its last view is gone.
- **Find on Page**: `findInPage(text, backward)`. The count comes back as
  a `phoenixfindresult` event on the `<object>` (`{active, total}`). The
  iframe engine finds in same-origin pages with `window.find`.
- **Block Ads & Trackers** and **Mobile / Desktop Site**: the system
  preferences `browserContentBlocker` and `browserUserAgent`, which reach
  the shell as systemStatus `browser`. The profile's request interceptor
  fails a page's requests to the hosts on
  `/usr/share/phoenix/runtime/content-blocker/hosts.txt` (and their
  subdomains), but never the page itself. The user agent is webOS's (mobile,
  the default) or Chromium's own (desktop).
- Clear Cookies and Clear Cache (`com.palm.browserServer`) clear that
  profile.
The system proxy (Settings > Wi-Fi > Proxy, preference `networkProxy`
`{type: "none" | "http" | "socks", host, port}`, systemStatus `proxy`) is
Qt's application proxy in phoenix-sim. Chromium takes it at once for every
page, and so do the runtime's proxied requests. On a device the
connection manager sets it (connman's service `Proxy.Configuration`,
Method "manual"), and the browser's page view will take the profile
settings above.

phoenix-sim's own proxy, and every request the runtime makes to the host
there, go through `XMLHttpRequest`: Chromium refuses `fetch()` on the
`phoenix:` scheme before Qt 6.6 (`FetchApiAllowed`), which left downloads
(and the other proxied requests) failing on Qt 6.4. On a device, OSE's WebAppMgr has no BrowserAdapter, so
the browser needs a native view there too (see the roadmap).

## Files

`apps/files` (`org.webosphoenix.files`, Apps tab) is a file manager for the
whole device. Palm shipped none; webOS users installed one from Preware, most
often Internalz Pro. Files has Internalz Pro's feature set but is a new,
clean-room design (see [LEGAL.md](LEGAL.md#phoenix-apps-apps)), drawn with
the Enyo 1.0 art:

- **Browse**: the folder's name in the page header, a path bar (tap a
  segment to go there), the list with type icons, size and date; the up
  button, and the back gesture through the folders visited. Starts in
  `/media/internal`; launch params `{path}` open another folder.
- **Header menu**: sort by name, size or date (folders first), show or hide
  hidden files, add or remove the folder from the favourites, folder info.
  Favourites (the star in the command menu; a column on tablets) start as
  `/media/internal` and its Downloads, Documents, Pictures and Music.
  Preferences are kept in the app's localStorage.
- **Select**: hold an item, or the select button, and tick more; then copy,
  cut, delete (with a confirmation), or from the menu rename, info, "Open
  with" and select all. Paste (with the number of items) appears in the
  command menu; pasting where a name is taken makes "name 2.txt".
- **New folder, new file** (the new file opens in the editor), **info**
  (type and MIME type, size, modified, permissions as `-rw-r--r-- (0644)`,
  read-only, full path).
- **Open**: pictures in a black image viewer (swipe or arrows for the
  folder's other pictures), text and small unknown files in a text editor
  that saves back (and asks before dropping changes; read-only files open
  read-only), `.ipk` packages in an install sheet, anything else in "Open
  with" (the apps that handle the MIME type, or open by type).

### Services

| What | Service and methods | Source |
| --- | --- | --- |
| Files and folders | `org.webosphoenix.filemanager` `list {path}` -> `{entries: [{name, path, type, size, mtime, mode, readOnly?}]}`, `stat {path}` -> `{entry}` (folders add `count`), `mkdir {path}`, `copy` / `move {from, to, overwrite?}` (folders recursively), `remove {path, recursive?}`, `read {path, encoding: "utf8" \| "base64", maxBytes?}` -> `{data, size}`, `write {path, data, encoding, overwrite?}`. Errors: `errorCode` 1 not found, 2 exists, 3 read-only, 4 not a folder, 5 is a folder, 6 not empty, 7 too large, 8 invalid (a folder into itself), -1 bad parameters | Phoenix; `apps/files/service` on a device, simulated in the runtime |
| Install a package | `com.palm.appinstaller` `installNoVerify {target, subscribe}` -> `{ticket, status}`: `STARTING`, `IPKG_INSTALL`, then `SUCCESS` or `FAILED_*` | legacy webOS (as Preware-era file managers called it); both it and OSE's `com.webos.appInstallService` install for real in the simulator ([Installing apps](#installing-apps)) |
| Open with | `com.webos.applicationManager` `listAllHandlersForMime {mime}` -> `{resources: [{appId}]}`, `launch {id, params: {target}}`, `open {target}` | legacy webOS / SAM |

The device service is Node.js (`apps/files/service`: `filemanager.js` does
the work with `fs`, `service.js` registers it with `webos-service`); it sees
the whole filesystem but only changes files under `/media`, `/home`, `/tmp`,
`/var/tmp`, `/mnt` and `/run/media`, and reports the rest `readOnly`. Its
luna-service2 files are in `apps/files/service/sysbus` (`filemanager.operation`
is the ACG group the app asks for). `tools/install-rootfs.py` installs it.

### In the simulator

The runtime's block "File manager" keeps a virtual filesystem in the shared
store (`files:vfs`), so every page sees the same files. File contents are
text or base64 in the store (what `write` stores, up to 1 MB), a reference to
a rootfs file (the demo media, apps' `appinfo.json`, the runtime), or a file
of the media block's IndexedDB store (Camera's pictures appear in
`/media/internal/DCIM/...` when the folder is listed, and deleting them there
deletes them for Photos too). The first start seeds `/media/internal`
(Downloads with an example `.ipk`, Documents with a few text files,
Pictures, Music and ringtones pointing at the demo media, the demo media
itself under `samples`, a hidden `.thumbnails`) and read-only system folders:
`/usr/palm/applications` with the installed apps (from `/apps.json`, else the
known list), `/usr/share/phoenix/runtime`, `/etc`, `/var/log`; `/tmp` and
`/home/root` are writable. `__phoenixRuntime.fileManager.reset()` seeds it
again; `__phoenixRuntime.fileManager.url(path)` gives a URL to show a file
(`fileUrl()` in `@phoenix/luna`). The app installer answers with success
after half a second (nothing is installed), and the application manager
names Photos for pictures and videos and Music for audio.

`node tools/test-files.cjs [--tablet]` browses, shows hidden files, sorts,
makes and renames a folder, copies and pastes a file twice, edits and saves
text, makes a new file, goes back, shows info, deletes a folder, views
pictures, installs the `.ipk`, opens a song with Music and opens a read-only
system file, with screenshots in `build/files-tests/`.

## Tasks

`apps/tasks` (`org.webosphoenix.tasks`, Apps tab) brings back the Tasks app
of webOS 1.x: to-do lists, one of them synced per account through Synergy
(Exchange's tasks, for one). Palm never open-sourced it, so it is new, in
the webOS 2.x/3.x style of the other Phoenix apps:

- **Lists**: Today, Upcoming and Overdue gather tasks from every list (with
  the number of open tasks; Overdue's in red); below them the lists, Inbox
  first. A list is added from the command menu, and renamed or deleted
  (with its tasks) from the header menu; the Inbox cannot be deleted. Lists
  that sync with an account are grouped under its name.
- **Tasks**: open tasks first, by due date, then priority (`!!!`, `!!`,
  `!`); overdue dates in red, a bell for a pending reminder. Tick a task to
  complete it (struck through, moved to the bottom); the check button in
  the command menu (or the header menu) hides completed tasks, and that is
  remembered. "Add a task" at the top adds one at once, due today in Today
  and tomorrow in Upcoming.
- **Editor**: summary, notes, list, priority, completed, the due date (all
  day, or at a time) and the reminder, with the Heritage date and time
  pickers. It saves on Done or the back gesture, as Mojo scenes did; Delete
  asks first.
- **Tablet**: the lists on the left, the tasks or the editor on the right.
  **Phone**: one at a time; the back gesture goes back.

Launch params: `{taskId, fromReminder?}` opens a task, `{text}` starts a new
one (Just Type's "New Task" passes the typed text URI-encoded), and
`{reminder: taskId}` is a reminder coming due (see below).

### Data and services

| What | Service and methods | Source |
| --- | --- | --- |
| Lists | db8 `com.palm.tasklist:1`: `name`, `accountId` (`""` on this device), `sortOrder`, `isDefault` (the Inbox) | Phoenix. Open webOS released no task kinds: only the TASKS capability and Exchange's `com.palm.task.eas:1` sub-kind in the account templates (`third_party/app-services/account-templates`) |
| Tasks | db8 `com.palm.task:1`: `summary`, `notes`, `due` (ms; local midnight with `allDay`), `allDay`, `completed`, `completedTime`, `priority` (iCalendar: 0 none, 1 high, 5 medium, 9 low), `listId`, `accountId`, `remind` (ms), `uid`, `createdTime`, `modifiedTime` | Phoenix, shaped after an iCalendar VTODO (SUMMARY, DESCRIPTION, DUE as DATE or DATE-TIME, STATUS/COMPLETED, PRIORITY, VALARM, UID, CREATED, LAST-MODIFIED) for a later CalDAV sync; an account's synced tasks would go in its own sub-kind, like `com.palm.task.eas:1` |
| Reminders | `com.palm.activitymanager` `create {activity: {name: "org.webosphoenix.tasks.remind.<taskId>", type: {foreground, persist}, schedule: {start: "YYYY-MM-DD HH:MM:SSZ"}, callback: {method: "palm://com.palm.applicationManager/launch", params: {id, params: {reminder: taskId}}}}, start, replace}`; `complete {activityName}` when the task is done, deleted, changed or has fired | the Clock app's alarms (`core-apps/com.palm.app.clock/utility/activitymanager.js`); the UTC schedule format of the calendar reminders service (`app-services/com.palm.service.calendar.reminders/utils.js`) |
| Notification | `phoenixHost.postToHost("notification", {appId, title, body, params: {taskId, fromReminder: true}})`, else `PalmSystem.addBannerMessage` | as the runtime does for texts (see [Phone and Messaging](#phone-and-messaging)) |
| Just Type | `universalSearch` in `appinfo.json`: the action "New Task" (`launchParam: "text"`) and the content search "Tasks" (db8 `?` search on `summary`, `launchParam: "taskId"`) | `core-apps/com.palm.app.calendar/appinfo.json` |

The kinds and their db8 permissions (Just Type may read tasks; any caller
may extend them with a sub-kind) are in `public/configuration/db`, which
`tools/install-rootfs.py` installs to `/etc/palm/db`.

### Reminders

1. Saving a task with a reminder time ahead of now (and not completed)
   creates or replaces its activity; anything else completes it.
2. When the time comes, the activity manager calls the callback, adding
   `$activity {activityId, name}` to the app's launch params (Calendar reads
   them from there too): the Tasks app gets `{reminder: taskId, $activity}`,
   as a relaunch (`webOSRelaunch`) if it is running.
3. The app completes the activity and, unless the task is gone or done,
   posts a notification: the task's summary and "Due ..." (or its first
   line of notes). It does not change what it shows.
4. The shell shows a banner and a dashboard item. Tapping it launches the
   app with the notification's `params`; the shell's notification model has
   no action buttons, so the task opens with a reminder bar offering
   **Snooze 10 min** (a new reminder ten minutes on) and **Done** (complete).

### In the simulator

The runtime's activity manager block simulates: `create`
(`replace`, error 17 for a name in use), `complete` (with `restart`,
`schedule`, `callback`), `cancel`, `stop`, `getDetails`, `list`, and the
older `com.palm.power` `timeout/set {key, at | in, uri, params}` and
`timeout/clear` on the same schedule. Schedule times are UTC unless
`local: true`. Activities are kept in the shared store (`activities`), so
every page sees them and any page can fire one: the target app's own page
at once (a relaunch in place), other pages a second later (the shell then
launches or relaunches the app; `SimWindowSource` does not bring up the
card of a launch whose params carry `$activity`). A page claims an activity
in the store before firing it, so it fires once; one that came due while no
page ran fires when the next page starts. An activity started with no
schedule or trigger runs at once, on the page that created it ("Sync now");
one with an interval schedule is kept but never fires. Tests move the clock on with
`__phoenixRuntime.activities.fireDue(at)`; `activities.list()` shows what is
scheduled.

In phoenix-sim, notifications carry their `params` (JSON) in
`SimWindowSource.notifications`, and tapping one in the dashboard launches
the app with them (`Shell.launch(appId, params)`).

`node tools/test-tasks.cjs [--tablet]` makes a list, adds tasks (quickly and
in the editor), completes and hides them, checks Today, Upcoming and
Overdue, edits a task, sets a reminder and fires it, opens it from the
notification and snoozes and completes it, renames and deletes, and uses
Just Type's task search and "New Task", with screenshots in
`build/tasks-tests/`.

## Voice Memos

`apps/voicememos` (`org.webosphoenix.voicememos`, Apps tab) rebuilds the
Voice Memos app of webOS 2.x (Pre 2, Pre 3), which Palm never open-sourced,
with the `@phoenix/ui` kit:

- **List**: the memos newest first under day dividers, each with its title,
  time and length (and a line of its transcript), a search field that finds
  memos by title and transcript, and the big red record button in the
  command menu (the Camera's capture button art).
- **Record**: a dark sheet with the elapsed time, a 20-segment level meter,
  Pause / Resume, Stop (saves) and Discard. The back gesture stops and saves.
  Without a microphone, or when access is refused, it says so.
- **A memo** opens in place: play / pause and a scrubber with the times, the
  transcript (tap a sentence to play from there), and Transcribe, Share
  (Email with the file attached, Messaging, or "Open in" an app that plays
  WAV, i.e. Music), Rename (the title; the file keeps its name) and Delete
  (the file, its index entry and the memo, after a confirmation).
- **Preferences** (header menu, kept in the app's localStorage):
  "Transcribe automatically" transcribes each new memo when it is saved; the
  language for the transcriber (English by default; the default model,
  `base.en`, only knows English).
- **Just Type** (`universalSearch` in `appinfo.json`, after Calendar's): the
  action "New Voice Memo" starts recording, titled with the typed text
  (launch params `{newMemo}`), and the content search "Voice Memos" finds
  memos by title and transcript and opens them (`{memoId}`).
- On first start the app installs two demo memos (`public/samples`, spoken by
  eSpeak NG from scripts in `tools/make-samples.cjs`, CC0) into
  `/media/internal/voicememos`. They have no transcript until you tap
  Transcribe.

Recordings are made with `getUserMedia` and `MediaRecorder` (WebM/Opus),
then decoded and resampled with Web Audio and saved as 16 kHz mono 16-bit
WAV: what whisper.cpp reads without converting, and a format every player
and the media indexer know. Files are named `memo-YYYYMMDD-HHMMSS.wav`.

### Services

| What | Service and methods | Source |
| --- | --- | --- |
| Save and delete the audio | `org.webosphoenix.service.mediafiles` `write` / `remove`, then mediaindexer `requestMediaScan {path}` / `requestDelete {uri}`: the Camera's way, so Files and the media indexer see the memos | see [Camera, Photos and Music](#camera-photos-and-music) |
| The memos | db8 `org.webosphoenix.voicememo:1` (`title`, `path`, `duration` s, `size`, `created` ISO date, `mimeType`, `transcript: {text, segments, language, engine, placeholder, time}`, `searchText` = title and transcript, lower-case). The kind and its permissions (Just Type, `com.palm.launcher`, may read) are in `public/configuration/db` | Phoenix |
| Speech to text | `org.webosphoenix.transcriber` `transcribe {path, language?, subscribe?}`: with subscribe, `{state: "queued" \| "converting" \| "transcribing", progress}` replies, then `{state: "done", progress: 100, text, segments: [{start, end, text}] (seconds), language, engine}`; `getStatus` -> `{engine, installed, model, modelInstalled, converter}`. Errors (`TRANSCRIBE_ERRORS`): -1 bad parameters, 1 no such file, 2 engine not installed, 3 model not installed, 4 needs converting and there is no ffmpeg, 5 failed | Phoenix; `apps/voicememos/service` on a device, simulated in the runtime |
| Share | `com.webos.applicationManager` `launch` Email `{attachments: [{fullPath, mimeType}], summary}` or Messaging `{attachment}`; `listAllHandlersForMime {mime: "audio/wav"}` and `launch {id, params: {target}}` for "Open in" | as Photos |

### On a device

The service is Node.js (`apps/voicememos/service`: `transcriber.js` does the
work, `service.js` registers it with `webos-service` and stops `whisper-cli`
when a subscriber cancels). For each file it:

1. uses a 16 kHz WAV as it is, and converts anything else with `ffmpeg` to
   one (without ffmpeg, recent `whisper-cli` builds still read MP3, Ogg and
   FLAC themselves);
2. runs `whisper-cli -m MODEL -f WAV -l LANG -oj -of TMP -pp` and turns
   `TMP.json`'s `transcription` (offsets in ms) into segments, passing on
   the `progress = N%` lines from stderr as progress replies.

One file is transcribed at a time; the others wait in a queue. The model is
`/usr/share/whisper/ggml-base.en.bin` unless `PHOENIX_WHISPER_MODEL` or
`/etc/phoenix/transcriber.json` (`{"whisper", "model", "ffmpeg", "threads"}`)
says otherwise; `whisper-cli` is found on the PATH (or as `whisper-cpp`, or
the old `main` in `/usr/share/whisper`). When the program or the model is
missing, `transcribe` fails at once with errorCode 2 or 3 and an errorText
that says what to install, which the app shows under the memo.
`meta-phoenix/recipes-support/whisper-cpp` is a recipe stub (not built yet)
for `whisper-cli` and the model. The unit tests
(`apps/voicememos/service/transcriber.test.ts`) run it against stand-ins for
`whisper-cli` and `ffmpeg`, and against the real whisper.cpp when
`PHOENIX_TEST_WHISPER_CLI` and `PHOENIX_TEST_WHISPER_MODEL` are set.

### In the simulator

The runtime's block "Voice memos" answers `org.webosphoenix.transcriber`
without whisper.cpp, and never makes up a transcript of someone's
recording:

- the **demo memos** get their known scripts (from the app's
  `samples/samples.json`), recognised by the file's size and FNV-1a hash,
  whatever the memo has been renamed to, after a short show of progress;
- **any other recording** gets the text "(transcription runs on the device
  with whisper.cpp)" with `placeholder: true`. The app shows it in grey
  italics and does not search it.
- Where the browser has the **Web Speech API** (`getStatus` says `live`),
  the simulator-only method `listen {language, subscribe}` passes on what it
  hears while recording, and a later Transcribe uses that text for the memo
  instead of the placeholder. In Chrome that recognition runs on Google's
  servers. Qt WebEngine (phoenix-sim) has no Web Speech API, and headless
  Chromium has one that hears nothing (no speech service), so there the
  placeholder stands.

The same block makes `mediafiles/remove` also drop the file from the file
manager's virtual filesystem, so a deleted memo (or a picture deleted in
Photos) disappears from Files too.

`node tools/test-voicememos.cjs [--tablet]` checks the demo memos in the list,
records with Chromium's fake microphone (level meter, time, pause and
resume, stop; the WAV in Files and the media indexer), plays and scrubs,
transcribes the demo memo (its known text) and a recording (the
placeholder), searches in the app and through Just Type's content search,
renames, shares by Email, deletes, "transcribe automatically", and the
`{memoId}` and `{newMemo}` launch params, with screenshots in
`build/voicememos-tests/`.

## Voice Dial

`apps/voicedial` (`org.webosphoenix.voicedial`, Apps tab, with the original
generic microphone icon of luna-sysmgr's
`sysapps/com.palm.sysapp.voicedial`) is the Voice Dial system app.
`com.palm.sysapp.voicedial` is an alias of it, and
`com.palm.pmvoicecommand/startVoiceCommand {source}`, the only thing the
original's launcher icon did (`ApplicationManager.cpp`
`slotBuiltInAppEntryPoint_VoiceDial`; that service was never released),
opens it.

- It listens as soon as it opens: "Call Ada Palmer", "Call Marcus at work",
  "Dial 4 0 8 5 5 5 0 1 4 2" (digits or words, "double five"). It stops by
  itself a second after you finish speaking; a tap on the microphone stops
  it sooner, or listens again.
- What was said is matched to the contacts with a phone number
  (`com.palm.person:1`; `src/lib/match.ts`): word by word, letter by letter,
  so a name heard wrong still finds them ("Call either Palmer" is Ada
  Palmer). A number is matched to its contact. "at work", "home", "mobile"
  pick the number. When two people are about as likely (two Marcuses), it
  asks which one; no match, or nothing heard, says so with Try Again.
- The confirmation ("Call Ada Palmer?", the number and its type) listens
  for "Yes" or "No", or takes a tap on Call or No. Yes launches Phone with
  `{number, dial: true}` (a Phoenix launch param: Phone places the call at
  once and shows it), and Voice Dial closes.

**Listening** is the keyboard's dictation, lent to the app: the runtime's
`org.webosphoenix.dictation` (`start {prompt, autoStop, subscribe}`,
`stop`, `getStatus`; `@phoenix/luna`'s `dictation.ts`) sends "dictation"
host messages to the shell, whose `Dictation` (`shell/native/dictation.cpp`)
records the microphone and runs `org.webosphoenix.transcriber`
(whisper.cpp) on it, and `SimWindowSource` passes its states back to the
window. One microphone: the window that started a recording owns it
(`Dictation.owner`) and only it gets the transcript; the keyboard ignores
it. Voice Dial passes the contacts' names as `prompt`, which goes to
whisper as its initial prompt (`transcribe {prompt}`, `whisper-cli
--prompt`): with it whisper.cpp writes the names as they are spelled
(espeak-ng saying "Call Lena Okafor mobile" came back as "Call the Iraq
Affirmal" without it, "Call Lena Okafor Mobile." with it). `autoStop` ends
the recording after speech and a second of quiet (`Dictation::EndOfSpeech`),
or with "Nothing was heard." after 7 seconds without speech. In a browser
without the shell there is no microphone to lend, and Voice Dial says so.

**In phoenix-sim**, dictation runs `apps/voicememos/service/transcribe-cli.js`
on the computer (whisper.cpp from `PHOENIX_WHISPER_CLI` /
`PHOENIX_WHISPER_MODEL`, or the PATH). A computer without a microphone (or
a test) can play WAV files as the microphone: `--microphone-file
call.wav --microphone-file yes.wav` plays one per recording, each followed
by quiet.

`node tools/test-voicedial.cjs [--tablet]` drives it with the script in the
shell's place (the dictation host messages, answered with the transcripts
whisper.cpp made of espeak-ng's speech): the prompt, a misheard name, Yes
and Phone's call, No, a number, a choice, no match, nothing heard, the
microphone button, no microphone, and the original ids;
`apps/voicedial/src/lib/match.test.ts` the matching;
`build/dictation-test` the end of speech, the prompt and the file
microphone.

## Device services: display, keys, vibrator, light sensor

The services LunaSysMgr itself registered for the apps (luna-sysmgr
`README.md:24-128`), with its requests, replies, events and error texts.
The original Clock holds the display on while an alarm rings and snoozes
on a volume key or Power; Phoenix apps have a client in `@phoenix/luna`
(`device.ts`: `display`, `keys`, `vibrator`, `lightSensor`).

| Service and methods | Requests and replies | Source |
| --- | --- | --- |
| `com.palm.display/status` | `{subscribe}` -> `{event: "request", state: "on" \| "dimmed" \| "off", subscribed}`, then `{event: "displayOn" \| "displayDimmed" \| "displayOff"}` (`displayOn` has `dockMode: true` in dock mode) | `DisplayManager.cpp:2296-2357`, `:1453-1534` |
| `com.palm.display/control/status` | as `status`, plus `timeout` (s), `blockDisplay` (`"true"` / `"false"`: a string), `active`; events also `changedTimeout {timeout}`, `blockedDisplay`, `unblockedDisplay`, `displayActive`, `displayInactive` | same |
| `com.palm.display/control/setState` | `{state: "on" \| "dimmed" \| "off" \| "unlock" \| "dock" \| "undock"}`; another state: `{returnValue: false, errorText: "call failed"}`. On: not out of dock mode; dimmed: only from on, unlocked; unlock: on, and the lock screen goes as if slid open (a passcode is still asked for) | `:1225-1308`; `DisplayStates.cpp` |
| `com.palm.display/control/getProperty` | `{properties: [...]}`: `requestBlock`, `powerKeyBlock`, `timeout`, `maximumBrightness`, `onWhenConnected`, `proximityEnabled`; none known: `errorCode` 1 "failed to get property" | `:1633-1712` |
| `com.palm.display/control/setProperty` | `{requestBlock: true, client}` holds the display on (and turns it on), locked or not, until the call is cancelled; `{powerKeyBlock: true, client}`: Power goes to the caller as `{powerKey: "released"}`, until cancelled; `{proximityEnabled: true, client}` (counted only); without `client`: `errorCode` 22 "'requestBlock' needs 'client' string". `timeout` (s; 0 or less is 120), `maximumBrightness` (1-100), `onWhenConnected` (the display stays on on a USB charger) are the system's preferences (`screenTimeout`, `picture.backlight`, `display:onWhenConnected`) | `:1796-1990` |
| `com.palm.keys/audio/status`, `/media/status`, `/headset/status` | `{subscribe: true}` -> `{subscribed: true}`, then `{key, state: "down" \| "up"}`: `volume_up`, `volume_down`; `play`, `pause`, `togglePausePlay`, `stop`, `next`, `prev`; `headset_button` (also `single_click`, `double_click`, `hold`), `headset` and `headset-mic` (in: down). Without subscribe: `errorCode` -1 "We were expecting a subscribe type message, but we did not recieve one." | `InputManager.cpp:333-370`, `:876-1177`; headset button `:225-330` |
| `com.palm.keys/switches/status` | `{subscribe: true}`: `{key: "ringer" \| "power", state}` (ringer up: sound on, down: silent); `{get: name}` -> `{key, state, returnValue}` (`ringer`, `slider` (closed: down), `headset`, `headset-mic`; others "unknown") | `:556-650`, `:766-800` |
| `com.palm.vibrate/vibrate` | `{period, duration}` (ms); no `period`: "Invalid arguments"; no duration: until cancelled | `HapticsController.cpp:117-181` |
| `com.palm.vibrate/vibrateNamedEffect` | `{name: "ringtone" \| "alert" \| "notification" \| "tapdown" \| "tapup", continous}`; another name: "Unable to vibrate"; `continous`: until cancelled | `:236-307`; `HapticsControllerCastle.cpp:78-97` |
| `com.palm.ambientLightSensor/control/status` | `{subscribe, disableALS}` -> `{current, average, disabled, subscribed}`, then `{current, region}` per reading (0 undefined, 1 dark, 2 dim, 3 indoor, 4 outdoor); `disableALS` holds the region at 0 while subscribed | `AmbientLightSensor.cpp:420-570` |
| `com.palm.audio/system/status` | `{"ringer switch": true}` while the ringer is on (the Clock asks before it rings: `utility/keymanager.js:113-120`) | Open webOS audiod (as the Clock reads it) |

### In the simulator

Each page's runtime answers these. The shell (`Phoenix.Shell`
`DeviceServices.qml`) tells every page what changed with
`__phoenixRuntime.devices.hostEvent({display, holds, key, switches, light,
powerKey})` (and a page that loads later gets the last of each); pages ask
the shell with host messages: `displayState {state}`, `displayHolds
{requestBlock, powerKeyBlock, proximity, alsDisabled, clients}` (what this
page holds; `SimWindowSource` adds every page's up and drops a page's when
it goes, as the bus does when a process leaves) and `vibrate {id, on, name
| period, duration}`. The keys are the simulator's (F3 Power, F10 / F11
volume, Ctrl+Shift+R the ringer switch, Ctrl+Shift+H a headset,
Ctrl+Shift+B its button, Ctrl+Shift+M play/pause, Ctrl+Shift+L the light);
a vibration shakes the window. `PalmSystem.setWindowProperties
{blockScreenTimeout}` still keeps the screen on while the app is in front,
as before. The players (Music, Podcasts, Videos) take the headset
button, the media keys and the headset's removal through
`watchMediaKeys` (`apps/shared/luna/src/mediakeys.ts`): a single click
plays or pauses, a double click (which arrives as single_click, then
double_click) restores the play state and goes to the next track, the
media keys play, pause, toggle, stop, go next or back, and a headset
up pauses whatever plays; only the player holding the media audio
focus takes the buttons. Tests: `apps/shared/luna/src/device.test.ts`,
`apps/shared/luna/src/mediakeys.test.ts`, `tools/test-media.cjs`,
`shell/tests/tst_deviceservices.qml`, `tools/test-device-services.cjs`
(the Clock's alarm).

### On a device

OSE has none of these services; `phoenix-devices` (`services/devices`) is
them, over the backlight, evdev, the vibrator and the IIO light sensor, and
the shell reports its display to it. It finds them by looking and follows
them as they come and go, so a USB or Bluetooth headset's media keys reach
`com.palm.keys/media` as soon as it is connected. See
[HARDWARE.md](HARDWARE.md), "LunaSysMgr's device services".

## Flashlight

`apps/flashlight` (`org.webosphoenix.flashlight`, Apps tab) is a dark card
with one big button, after the webOS 2.x Camera (Palm never shipped a
flashlight; people used homebrew ones):

- **LED**: the camera flash LED as a steady torch, with a brightness slider
  (5-100%). The app subscribes to the torch's status, so a change made by
  another app (QR Scanner's light button) shows at once.
- **Screen**: the whole card turns white; tap it to turn it off. It is the
  only light on a device without a flash LED (the TouchPad), and the app
  says so.
- While lit, the screen does not time out (`PalmSystem.setWindowProperties
  {blockScreenTimeout: true}`, as Mojo and Enyo apps asked).
- Closing the card turns the LED off, unless "Leave LED On When Closed" is
  ticked in the app menu (LuneOS's Torch app does the same).
- Launch params `{on: true}` light it at once.

There is **no system menu toggle**: the original webOS system menu
(`luna-systemui`, the shell's `SystemMenu`) had none, so none was added.

### Services

| What | Service and methods | Source |
| --- | --- | --- |
| The torch | `org.webosports.service.torch` `getStatus {subscribe}` -> `{available, on, brightness}` (0-100); `set {on}` or `{brightness}` (brightness wins; out of range is an error); `toggle`. Errors have an `errorText` only ("no torch on this device") | LuneOS's torchd ([webOS-ports/org.webosports.service.torch](https://github.com/webOS-ports/org.webosports.service.torch), Apache-2.0), used unchanged |

On a device torchd opens nyx's `NYX_DEVICE_LED` "Torch" module (LuneOS
`nyx-modules` `src/led_torch`), which drives the **kernel LED class**: the
flash LED's `/sys/class/leds/<name>/brightness` (a node named `*torch*`,
else `*flash*`, or the one in `/etc/nyx.conf`), scaled to its
`max_brightness`; on `LEDS_CLASS_FLASH` devices that is the torch current,
and the strobe (`flash_brightness`, `flash_strobe`) is left alone.
Qualcomm's `qpnp-flash-v2` also needs its `led:switch*` node set; MediaTek
phones use `/dev/flashlight` ioctls; on Halium the hybris module asks
Android's camera service (on or off only). OSE has neither torchd nor a
torch module: `meta-phoenix/recipes-bsp/torchd` is a stub recipe for it
(see [HARDWARE.md](HARDWARE.md#hardware-abstraction-plan)).

### In the simulator

The runtime's block "Torch and location" answers the same API with one
simulated LED kept in the shared store (so every card sees the same
torch). `__phoenixRuntime.torch.setAvailable(false)` makes a device without
one. `node tools/test-flashlight.cjs [--tablet]` checks the LED on, off and
dimmed, a change from another app, the screen timeout, the LED going off
when the card closes (and staying on when asked), the screen light, a
device without a torch and `{on: true}`, with screenshots in
`build/flashlight-tests/`.

## QR Scanner

`apps/scanner` (`org.webosphoenix.scanner`, Apps tab) is a full-card
viewfinder like the Camera's that reads a code as soon as one is in view
and says what it is:

| Code | Shown | Actions |
| --- | --- | --- |
| `http(s)://` | the host, then the whole address | Open in Browser (`applicationManager/open {target}`), Copy. Other schemes (`javascript:`, `file:`) are only text |
| `WIFI:T:WPA;S:...;P:...;H:true;;` | network, security, password hidden until Show | Join Network: Settings with `{page: "wifi", join: {ssid, security, passKey, hidden}}`, which opens the join dialog filled in (the user taps Connect); Copy Password |
| `BEGIN:VCARD`, `MECARD:` | name, numbers, emails, company | Add to Contacts: `com.palm.app.contacts` `{launchType: "newContact", contact}` with `com.palm.contact:1` fields |
| `otpauth://totp/...` | issuer and account only | Add to Authenticator: `org.webosphoenix.authenticator` `{otpauth: "<uri>"}` when `getAppInfo` finds it installed; otherwise a note. The key is never shown or kept in the history |
| `tel:`, `mailto:`, `MATMSG:`, `sms:`, `smsto:` | number or address (and message) | Call, Write Email, Send Text (`open` with `tel:`, `mailto:`, `sms:`), Copy |
| `geo:`, EAN/UPC, anything else | coordinates, product number, text | Copy |

- **History** (newest first, the same code once) opens any earlier result
  again; on tablets it stays beside the viewfinder. It is kept in the app's
  localStorage; the app menu turns it off (which clears it) or clears it.
- The **light** button in the command menu lights the torch
  (`org.webosports.service.torch`) when the device has one, and the app
  puts it out when it closes.
- **Scanning for other apps**: launched with `{returnTo: appId}`, it
  relaunches that app with `{scanned: {text, format}}` after the first code
  and closes, so an app (the Authenticator, Settings) need not have its own
  scanner.

Decoding is **zxing-wasm** (zxing-cpp compiled to WebAssembly, the reader
build only), on the device: frames from `getUserMedia` (as the Camera gets
them, after `com.webos.service.camera2 getCameraList`) are drawn at up to
800 px wide into a canvas five times a second. The `.wasm` file is bundled
with the app and loaded with XMLHttpRequest, which works for phoenix-sim's
`phoenix://` pages and a device's `file://` app directory (zxing-wasm would
otherwise fetch it from a CDN). Chromium's `BarcodeDetector` is not used:
it is not available on Linux.

`node tools/test-scanner.cjs [--tablet]` draws codes with zxing-wasm's
writer into Y4M videos for Chromium's fake camera and checks each kind:
Wi-Fi (join, copy), a web address (and a `javascript:` code that is not
opened), a vCard, `otpauth://` with and without the authenticator
installed (and that its secret is never shown or saved), EAN-13, the
history, the torch button and `{returnTo}`, with screenshots in
`build/scanner-tests/`. The same videos work in phoenix-sim:
`QTWEBENGINE_CHROMIUM_FLAGS="--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream --use-file-for-fake-video-capture=code.y4m"`.

## Weather

`apps/weather` (`org.webosphoenix.weather`, Apps tab) shows forecasts
from [Open-Meteo](https://open-meteo.com/) in the webOS 2.x style: no
dashboard, banner or notification, only what the user opens.

- **Now**: temperature, conditions, feels like, today's high and low on a
  sky panel (blue by day, navy at night, grey under cloud); wind, humidity,
  sunrise and sunset.
- **Next 24 hours** in a strip (with the chance of rain from 20%), and **7
  days** with a temperature bar across the week's range.
- **Places**: Current Location (`com.webos.service.location
  getLocationUpdates` without `subscribe`, once per start; off in Preferences) and cities found
  with Open-Meteo's geocoding search, in the user's order; Edit reorders
  and removes them. Tablets show the places beside the forecast.
- **Units** follow the system region (`com.webos.settingsservice`
  `localeInfo.locales.FMT`: °F and mph for the US, °C and mph for the UK,
  °C and km/h elsewhere) unless Preferences says Metric or Imperial; hours
  follow the system clock (`timeFormat` HH12 / HH24). The forecast is
  fetched in metric units and converted in the app.
- **Offline**: the last forecast of each place is kept (localStorage) and
  shown with the time it is from when the service can't be reached, also
  after a restart; an error reply from the server (for example the daily
  limit) is shown with its reason. A forecast is fetched again when it is
  older than 30 minutes, or on Refresh.
- The app menu has Preferences (units, Use My Location, the forecast
  server) and About Weather Data (what is sent, below).

### What is sent

| Request | Sent to | Contents |
| --- | --- | --- |
| Forecast | `api.open-meteo.com/v1/forecast` (or the server in Preferences) | latitude and longitude **rounded to 2 decimals** (about 1 km), the variables, `timezone=auto`, `forecast_days=7`, `forecast_hours=25` |
| City search | `geocoding-api.open-meteo.com/v1/search` | the typed name, `count=10`, the UI language |

Nothing else: no API key, account, cookie or device identifier. As with
any request, Open-Meteo sees the device's IP address; its terms say it keeps
web server logs (which may contain coordinates) for 90 days and shares them
with no one. The precise position from the location service never leaves
the device. Places and forecasts stay in the app's localStorage.

Open-Meteo's free API is for **non-commercial use** (fewer than 10,000
calls a day; [terms](https://open-meteo.com/en/terms)), and its data is CC
BY 4.0 (credited at the bottom of the forecast). A commercial product
needs a paid plan or its own Open-Meteo server (see
[LEGAL.md](LEGAL.md)).

### In the simulator

The runtime's block "First use, emergency information, location and help" answers
`com.webos.service.location getLocationUpdates` with the simulated
position (downtown San Jose, inside Maps' demo region), or one set with
`__phoenixRuntime.location.set({latitude, longitude})`; `set(null)` turns
both handlers off, which is "location services are off" (errorCode 5). On a device
the location service is OSE's (see [HARDWARE.md](HARDWARE.md), GPS).
phoenix-sim fetches live forecasts from Open-Meteo (which sends CORS
headers). `node tools/test-weather.cjs [--tablet]` answers Open-Meteo with
recorded replies (`apps/weather/fixtures`) and checks the first start, what
the requests contain, the cache, search and places, units and the clock,
offline and error replies, Edit, and no location, with screenshots in
`build/weather-tests/`.

## Passwords and Authenticator

Two apps that hold secrets; their threat model and what is implemented now
versus on a device is in [SECURITY-APPS.md](SECURITY-APPS.md).

`apps/passwords` (`org.webosphoenix.passwords`, Apps tab) is a KeePass
password manager:

- **Locked**: the `.kdbx` files found in `/media/internal/passwords`,
  `Documents`, `Downloads` and `/media/internal`, and the recently opened
  ones; tap one and type its master password. New Database makes a KDBX 4
  file with Argon2id in `/media/internal/passwords`.
- **Unlocked**: groups and entries (the recycle bin last), a search field
  (title, user name, URL, notes, tags), an entry's fields with Show and Copy,
  its TOTP code with a countdown ring, custom fields (protected ones hidden),
  Open Website, Edit (with the generator and a strength meter) and Delete (to
  the recycle bin, then for good). The header menu: Rename / Delete Group,
  Empty Recycle Bin, Change Master Password, Preferences (clipboard clear
  time, idle lock, lock when minimized), Lock.
- **Files**: "Open with" offers Passwords for `.kdbx` files
  (`application/x-keepass2`); the app gets `{target: path}`.
- Launch params `{newEntry: {password, title?, username?, url?}}` (the
  Clipboard app's Save to Passwords) open a new entry filled in with them
  once a database is unlocked; nothing is saved until the user saves it.

`apps/authenticator` (`org.webosphoenix.authenticator`, Apps tab) shows
two-factor codes:

- Without a device passcode it asks for one (Screen & Lock); with one, it asks
  for it on every start and after every lock.
- The list: service, account, the current code in large digits and a
  countdown ring (HOTP: "Tap for code"); tap to copy. The per-account menu:
  Edit, Delete. The + button: Enter a Setup Key, Add from a Link.
- Launch params `{otpauth: "otpauth://..."}` (the QR scanner) offer that
  code after unlocking, for confirmation.
- The header menu: Import (Authenticator backups, Aegis and andOTP plain
  exports, `otpauth://` lists, from Downloads or Documents), Export Backup
  (encrypted with a passphrase, into Documents), Preferences, Lock.

### Services

| What | Service and methods | Source |
| --- | --- | --- |
| The `.kdbx` files, backups and imports | `org.webosphoenix.filemanager` `list`, `stat`, `read`, `write`, `move`, `mkdir`, `remove` | `apps/files/service` |
| The device passcode | `com.palm.systemmanager` `getDeviceLockMode`, `matchDevicePasscode {passCode}` | legacy webOS; simulated in the runtime (OSE has no passcode service yet) |
| Screen lock | `com.palm.systemmanager` `getLockStatus {subscribe}` -> `{locked}` (`deviceLock.watchLocked()`) | legacy webOS; the shell sets it |
| Open Website, Screen & Lock | `com.webos.applicationManager` `launch` | |

Neither app declares a Just Type search or writes to db8.

## Clipboard history

Phoenix's own (webOS had none; [M6-PLAN.md](M6-PLAN.md) F2): every copy in
every app is kept, with the app it came from, as Paste does on macOS. The
keyboard, the Clipboard app and Settings share one history through
`org.webosphoenix.clipboard` (`@phoenix/luna` `clipboard`), simulated in the
runtime (block "Clipboard history"). Threat model:
[SECURITY-APPS.md](SECURITY-APPS.md#clipboard-history).

**What is recorded**, in every page the runtime runs in:

- `copy` and `cut` events: the selection, or what the page put on the
  clipboard itself (`clipboardData`, read after the page's handlers); a
  picture selected alone is kept by its address;
- `navigator.clipboard.writeText` and `write` (text and pictures as
  `data:` URLs, up to about 750 kB);
- the shell's own copies (Just Type, the site menu's Copy Link), through
  `lunaCall` `add`;
- Copy and Cut in a password field (keys, the edit popup, the app menu's
  Edit): `__phoenixRuntime.clipboard.passwordCopy`.

A clip is `{id, type: "text" | "link" | "image", text?, title?, image?,
source, time, pinned, category, sensitive, kind?}`. A link is a text that is
one `http(s)`/`ftp` address or `www.` name; its title is the link's own text
where it was copied, or the page's title for its own address. Copying the
same thing again moves its clip to the front.

**The service**, `luna://org.webosphoenix.clipboard/`:

| Method | Does |
| --- | --- |
| `history {category?, query?, limit?, subscribe?}` | `{clips, categories, settings}`, newest first; `category` is `recent` (default), `pinned` or a category id; a secret comes without its text (`kind`, `length`) |
| `subscribe` | `history` with `subscribe` |
| `add {text \| image, title?, source?, sensitive?, kind?}` | `{clip}` or `{skipped: "off" \| "excluded" \| "sensitive" \| "empty" \| "too large"}` |
| `pin`, `unpin {id}`; `setCategory {id, category}`; `update {id, text}` | change a clip (`update`: text clips only) |
| `delete {id \| ids}`; `clear {all?}` | `clear` keeps pinned and categorized clips unless `all` |
| `paste {id}` | `{clip}` with its text; a secret only for the system UI (the keyboard), error -3 otherwise |
| `reveal {id, passCode}` | `{text}` after `com.palm.systemmanager/matchDevicePasscode`; error -5 when it is wrong |
| `addCategory {name}`, `renameCategory {id, name}`, `deleteCategory {id}`, `reorderCategories {ids}` | categories; a deleted one's clips stay, in none |
| `getSettings {subscribe?}`, `setSettings {...}` | `{enabled, keyboardKey, maxItems, keepFor: hour \| day \| week \| month \| forever, clearOnLock, sensitive: mask \| skip, detectSecrets, excludedApps}` |

Pinned clips and clips in a category are "saved": they neither expire nor
count against `maxItems`. Expiry and the size limit are applied by whichever
page reads or adds. When the shell says the screen locked
(`applyHostStatus {deviceLocked}`) and `clearOnLock` is on, the history goes.
Turning the history off drops it and takes the keyboard key away.

**Storage**: each clip is its own key (`phoenix:clipboard:clip:<id>`), so
pages copying at once in their own processes never write over one another
(the shared-blob race of PR 7); settings and categories are one key each,
written only when the user changes them. Changes in other pages arrive as
`storage` events and go to subscribers.

**Secrets**: a copy from a password field (`kind: "password"`), a copy an
app marks with `__phoenixRuntime.clipboard.markSensitive(text, kind?)`
(`@phoenix/secrets` `SecretClipboard` does, so Passwords and the
Authenticator's copies are secrets), and, with `detectSecrets`, text that
looks like a one-time code (`otp`: 6 digits, `123 456`, 7 or 8 digits), an
`otpauth://` link (`otpauth`), a base32 TOTP key of 16 characters or more
(`totp`) or a password (8 to 64 characters, no spaces, three kinds of
characters with a symbol, or all four). They are kept AES-GCM encrypted
(see SECURITY-APPS.md), shown masked, and searched never.

**The keyboard** (`shell/qml/Phoenix/Shell/ClipStrip.qml`,
`ClipboardClient.qml`): the clipboard key at the left of the candidate
bar, in every field while the history and the key are on (not over the
lock screen). In a field without Text Assist (a password, an address) the
bar holds only the key. It swaps the keys for the clip strip (rising and
fading in over them): Recent, Pinned and category tabs in the launcher's
tab bar art; the clips as card view's cards, the one in focus centred and
its neighbours peeking in beside it, smaller (the non-active card scale)
and dimmed (`cardDimming`); a swipe moves them and they snap clip to clip
with card view's flick and slide; another tab slides its clips in from its
side. A tap on a side clip centres it; a tap on the middle clip pastes
through the IME's commit and brings the keys back (a secret
only into a password field; elsewhere the strip says to reveal it in
Clipboard); a picture goes into rich text (`clipboard.insertImage`); a hold
opens Pin, Save to…, Delete, Open Clipboard. ABC, Back, the key, or the
keyboard going away bring the keys back. The shell talks to the service
with the window source's `lunaCall` (the system UI page in phoenix-sim).
`phoenix-sim --scene clipstrip [--launch <app>]` shows it.

**The Clipboard app** (`apps/clipboard`, `org.webosphoenix.clipboard`, Apps
tab): tabs, search, and a clip's page: Copy (a secret through
`SecretClipboard`, cleared after 30 s), Show (the device passcode), Save to
Passwords (`{newEntry: {password}}`) or Add to Authenticator (`{otpauth}`;
a TOTP key becomes `otpauth://totp/Imported%20key?secret=...`), Open in
Browser, Edit, Pinned, Category, Delete. The app menu: Categories (new,
rename, move, delete), Clear History, Preferences. Revealed secrets are
hidden again when the screen locks. No Just Type search.

**Settings > Clipboard** (`apps/settings/src/pages/Clipboard.tsx`, launch
point `org.webosphoenix.settings.clipboard`): every setting above, Clear
History and Clear All Clips.

Tests: `apps/shared/luna/src/clipboard.test.ts` (recording, expiry, size,
pins, categories, detection, encryption, the lock),
`shell/tests/tst_clipstrip.qml` (the key and the strip),
`tools/test-clipboard.cjs` (the app and Settings, phone and tablet).

On a device the service must run on the bus (a small Node.js or C++
service with the same API; today it exists only in the web runtime), and
the keyboard must be the device's input method (GAPS V5).

## Phoenix Assistant

Phoenix's own (webOS had none; [M6-PLAN.md](M6-PLAN.md) F3,
[AI-AND-MCP.md](AI-AND-MCP.md#10-as-built-7-october-2026-in-the-simulator)).
The service is the device's own code, `apps/assistant/service` (a Node.js
Luna service: `service.js`, `assistant.js`, `lib/`); the runtime runs it in
the page (block "The Phoenix Assistant", loaded from
`/usr/palm/services/org.webosphoenix.assistant/` with `nodeServiceLoader`)
and gives it Luna calls on the simulated bus, HTTP through the host's proxy,
the shared store and the sealing key. `@phoenix/luna` `assistant` and `tts`
are the clients.

**The service**, `luna://org.webosphoenix.assistant/` (`threads`, `thread`,
`getSettings`, `providers`, `models` and `commands` take `subscribe`):

| Method | Does |
| --- | --- |
| `ask {text, threadId?, newThread?, speak?}` | `{thread, messages}`: the user's words and the answers. In the thread in use unless told otherwise. System UI, Assistant and Settings only (error -3); error -4 while the assistant is off |
| `choose {threadId, messageId, choice}` | a message's choice: `cloud:<provider id>` (the thread goes on with that provider), `web`, `settings` |
| `confirm {threadId, messageId, accept}` | a read-back (`status: "pending"`): run it, or not |
| `threads` / `thread {id?}` | `{threads, current}` / `{thread, messages}` (the one in use without an id) |
| `newThread`, `setCurrent {id}`, `deleteThread {id}`, `clearHistory` | conversations |
| `getSettings` / `setSettings {...}` | `{enabled, speak, language, units, localModel, defaultProvider, allowCloudControl, disabledCommands}`; only Settings may set `allowCloudControl` |
| `commands` | `{commands: [{id, title, risk, builtIn, appId, enabled, confirms}]}` |
| `providers` | `{providers: [{id, type, name, model, baseUrl, hasKey, keyHint, label}], defaultProvider, types}` |
| `setProvider {id?, type, name?, model?, baseUrl?, key?}`, `removeProvider {id}`, `testProvider {id \| type, model, baseUrl, key}`, `listModels {...}` | Settings only. A key is sealed at once; `testProvider` answers `{ok, text}` or `{ok: false, error}` |
| `models` | the on-device catalogue with `fits`, `recommended`, `installed`, `downloading`, and `status: {available, running, ramBytes, error, howToInstall}` |
| `downloadModel {id}`, `cancelDownload {id}`, `removeModel {id}`, `selectModel {id}` | on-device models |
| `speak {text}`, `stopSpeaking` | the device's voice |

A message is `{id, threadId, role, text, time, via: "commands" | "on-device"
| "cloud", source (who answered), command, status: "pending" | "done" |
"cancelled" | "failed", confirm: {command, args}, choices: [{id, label}],
chosen}`. Each thread (`assistant:thread:<id>`), message
(`assistant:msg:<thread>:<id>`) and provider (`assistant:provider:<id>`) is
its own stored key, so the shell's view and the app never write over each
other (PR 7).

`luna://org.webosphoenix.tts/`: `speak {text, lang?}`, `stop`, `getStatus`
-> `{available, engine}`.

**What the commands do** (`lib/commands.js`): Phone `{number, dial}`; an
SMS through `org.webosports.service.messaging/putMessage` (Messaging's
compose without words); a timer as an activity that opens the Assistant app
with `{timerDone}` (notification, sound, words); the Clock's own alarm
(a `com.palm.clock.alarm:1` record and the activity the Clock schedules,
which launches it with `{action: "ring"}`); a task in Tasks with its
reminder activity; Wi-Fi, Bluetooth, airplane mode, the torch, the
ringtone volume; `applicationManager/launch`; Maps `{target:
"mapto:<place>"}`; Music `{play: "<artist, album or song>"}`; Open-Meteo
for the weather; the browser with Just Type's default engine.

**Apps' commands**: `appinfo.json` `"assistant": {"commands": [{"id",
"displayName", "url", "launchParam", "phrases": {"en": ["new note {text}"]},
"risk": "change" | "send" | "delete"}]}`; the app is launched with
`{<launchParam>: <text>}`, and `send`/`delete` are read back first. An app's
Just Type Quick Action (`universalSearch.action`) works as "<displayName>
<text>" without anything more. phoenix-sim and `serve-rootfs.py` pass the
`assistant` field in `/usr/share/phoenix/apps.json`.

**The shell** (`AssistantOverlay.qml`): holding the launcher button opens
it over everything but the lock screen (a tap still opens the launcher).
Each opening is a new, empty conversation: its first request is `ask
{text, newThread: true}`, the next ones `ask {text, threadId}` (through
`lunaCall`), so an opening without a request leaves no thread, and the
earlier ones stay in the app's Conversations. Buttons for choices and
read-backs, a field (the keyboard comes with a tap; at once where there is
no microphone) and the microphone (the shell's dictation with `autoStop`,
owner `"assistant"`). The Assistant's icon at the top left closes it and
launches the app with `{threadId}` (none before the first request), to go
on there. Back, Escape or a tap outside closes it. It grows out of the
held button with the blur and dim fading in, and shrinks back into it
(`Theme.launcherDuration`); messages slide in from their side
(`cardTransitionDuration`), choices appear one after another, rings spread
from the microphone while it listens, three dots bounce while it thinks;
all through `Theme.motion` (Animation speed, reduced motion).
`phoenix-sim --scene assistant [--launch <app>]` shows a short conversation
over the screen.

**The assistant's bird** ([ASSISTANT-CHARACTER.md](ASSISTANT-CHARACTER.md),
`AssistantBird.qml`) sits at the top in the middle of the panel (72 to 104
px by its height; small beside the field where the panel is short, as on a
phone with the keyboard up), over the conversation, which scrolls on up
behind it and fades out under the heading rather than being cut off and plays what is going on (`birdPose`):
asleep as the panel grows, hello, then listening while the microphone is
on (following the dictation's `loudness`), thinking while a request or a
transcription waits, then the reply's outcome (`outcomeOf` its new
messages): a command that ran (`status: "done"` with a `command`) plays
working then done, `failed` plays shy (Oops), choices play confused, each
for a moment (`beatsFor`, at Animation speed); speaking while the shell's
`Speech` speaks; asking while a read-back waits; idle (with a nod for an
answer that is not spoken); asleep again as it closes. A tap on it waves.
Every pose acts, never a still: hello waves, thinking taps its chin,
working bobs and pumps its flippers, speaking gestures with its words,
idle shifts its weight and looks around now and then (each pose's loop in
`bird.json`'s `motion.acting`; a pose change blends from wherever the loop
is; Reduce motion holds it still). `phoenix-sim --scene assistantbird` cycles through its poses,
`--scene assistantbirds` shows them all; both log the frame rate.

**The on-device model and speech in phoenix-sim**: `/usr/share/phoenix/host.json`
has `"assistant": true`; the runtime sends `assistant` host messages (`{op:
status | download | cancel | remove | ensure | speak | stopSpeaking |
speechStatus, requestId}`) and gets `__phoenixRuntime.assistantHostEvent({requestId,
...})` back; every page hears `{changed: true}` as models change. The shell's
`LocalModels` (models in the simulator's data folder, `models/<id>.gguf`;
`--llama-server <path>`) and `Speech` (`--speech-command <command>`) do the
work.

**The Assistant app** (`apps/assistant`, Apps tab): the conversation, its
choices and read-backs, the field, the microphone
(`org.webosphoenix.dictation`), Conversations (new, open, delete), and
Preferences. Launch params: `{text}` (Just Type's "Ask Assistant"),
`{threadId}`, `{timerDone}`. Its CSP allows `unsafe-eval` only because the
simulator runs the service in its page. The same bird (`src/bird/Bird.tsx`)
greets on an empty conversation (thinking while it loads), and stands below
the conversation while a request runs: thinking, then working and done, a
shrug or Oops, as the shell's view decides (`src/bird/pose.ts`). It acts
as the shell's does, with the generated CSS keyframes (the CSP allows no
style made at run time); the blend between poses sets the part's drawn
transform through the CSSOM, which the CSP allows.

**Settings > Assistant** (`apps/settings/src/pages/Assistant.tsx`, launch
point `org.webosphoenix.settings.assistant`): everything above.

Tests: `apps/assistant/service/*.test.ts` (grammar per command, the router
against a local mock of each provider API, the permission gate, read-backs,
the device side with a stand-in llama-server), `apps/shared/luna/src/assistant.test.ts`
(the runtime), `shell/tests/tst_assistant.qml`, `build/localmodels-test`,
`tools/test-assistant.cjs`.

## Terminal

`apps/terminal` (`org.webosphoenix.terminal`) is a real Linux terminal:
xterm.js in a React app, one shell per card, on a PTY owned by the
`org.webosphoenix.pty` service. [TERMINAL.md](TERMINAL.md) has the design,
the service's methods, the security model and what is still to do; this is
how it runs off the device.

| Where | The shell | How the page reaches it |
| --- | --- | --- |
| Device | The C++ Luna service in `services/pty` (meta-phoenix `phoenix-pty`), as the device user | `PalmServiceBridge` to `luna://org.webosphoenix.pty` |
| phoenix-sim | **A real shell on your computer**, in your home directory, with your environment (bash unless Preferences say otherwise): `shell/sim/simpty.cpp` on the service's PTY core | The runtime's "Terminal" block posts `pty` host messages; `SimWindowSource` hands them to `simPty` with the window's app id, and runs the replies in the page as `__phoenixRuntime.ptyEvent(...)` |
| Browser, `tools/serve-rootfs.py --terminal` | A real shell on your computer (Python's `pty`) | A WebSocket per session, with the token and address from `/usr/share/phoenix/host.json` |
| Browser without `--terminal`, `phoenix-sim --no-host-shell`, unit tests | The runtime's small simulated shell (`echo`, `ls`, `cd`, `pwd`, `clear`, `seq`, `printenv`, `history`, `exit`) | In the page |

The runtime picks the first one the host offers in
`/usr/share/phoenix/host.json` (`{"pty": "host"}` from phoenix-sim,
`{"pty": "websocket", "url": ...}` from the dev server, `{}` otherwise). All
of them answer only `org.webosphoenix.terminal`; phoenix-sim and the device
service check the caller's app id themselves, not the page's word for it.
Throwing a Terminal card away hangs its shells up.

`node tools/test-terminal.cjs [--tablet]` types into the simulated shell
(commands, the extras row with sticky and locked Ctrl, arrows, its other
pages, rotation, links, long press and copy and paste, the app menu and
Preferences, New Session and Ctrl+Shift+T, the back gesture, exit and
restart, and another app being refused), then runs `/bin/sh` for real
through `serve-rootfs.py --terminal` (arithmetic, the PTY's size and its
change, UTF-8, 600 KB through the flow control, the exit status, a wrong
token and another origin refused). The service itself is tested by
`services/pty`'s `pty-test`, which phoenix-sim's build compiles.

## Videos, Podcasts, PDF View and Doc View

Four apps for watching, listening and reading, in the webOS 2.x style of
the other Phoenix apps (Palm never open-sourced its video player or PDF
View, and shipped no podcast app or e-reader):

- **Videos** (`apps/videos`): the videos of the media indexer
  (`getVideoList`) with stills the app draws itself, a black full-screen
  player free to turn with the device (`PalmSystem.setWindowOrientation("free")`,
  `enableFullScreenMode`), controls that fade (subtitles, back 10 s,
  play, ahead 30 s, fit / fill), the place kept per file ("Resume at",
  Start Over), and SRT or WebVTT subtitles found beside the video
  (`film.srt`, `film.es.vtt`), drawn by the app, the language chosen from a
  menu. Photos still plays videos in place and has "Play in Videos".
- **Podcasts** (`apps/podcasts`): subscribe by RSS or Atom address, by a
  directory search (Apple's keyless iTunes Search API; the Podcast Index
  when the user enters a key), or from OPML; episodes newest first with
  what is new and what is left; downloads; a dark Now Playing with the
  speed and a sleep timer; a mini player; OPML export to
  `Documents/Podcasts.opml`; a refresh every 6 hours in the background.
- **PDF View** (`apps/pdfview`): PDF.js 4.10's legacy build (Qt WebEngine
  6.4 is Chromium 102; PDF.js 5 and 6 need newer browsers): recent
  documents and the PDFs on the device, continuous pages, zoom (pinch,
  buttons, Ctrl+wheel, double tap), search with every match marked,
  thumbnails, passwords, the page kept per file.
- **Doc View** (`apps/docview`): EPUB books in pages (CSS columns, two on a
  tablet; table of contents, text size and font, night mode), Word
  (mammoth.js), Excel and PowerPoint (read by the app's own OOXML code),
  Markdown and text, scrolled. Each chapter or document is drawn in a
  frame sandboxed without scripts, after DOMPurify. EPUB and document
  viewing are one app: the same reflowing reader, and webOS had no
  e-reader of its own.

Launch params for all four: `{target}` (a path, `file://` uri or web
address; also `{fileName, mimeType}` from Email), which Files ("Open with",
"Open by Type"), Email attachments and the browser's downloads send. Each
app declares what it opens in `appinfo.json`'s `mimeTypes`
(`[{mime, extension, stream}]`, as legacy webOS apps did; Email's
`message/rfc822` in core-apps), which phoenix-sim and `serve-rootfs.py`
pass on in the launch point list.
### Services

| What | Service and methods | Source |
| --- | --- | --- |
| Who opens a type | `com.webos.applicationManager` `listAllHandlersForMime {mime}`, `getResourceInfo {uri, mime}` -> `{appIdByExtension, mimeByExtension, canStream}`, `open {target}` (a file goes to its app; a web address whose extension an app registered goes to that app) | legacy webOS (Email's `AttachmentsDrawer.js`, the Isis browser's `gotResourceInfo`) |
| Files and documents | `org.webosphoenix.filemanager` `list`, `read {encoding: "base64"}` (see [Files](#files)) | Phoenix |
| Web pages, feeds | HTTP from the page (`httpRequest` in `web.ts`) | the web runtime |
| Downloads | `com.webos.service.downloadmanager` (and legacy `com.palm.downloadmanager`) `download {target, targetDir, targetFilename, subscribe}` -> `{ticket}`, `{amountReceived, amountTotal}`, `{completed, completionStatusCode, destPath, destFile, target}`; `cancelDownload {ticket}`, `getAllHistory`, `clearHistory` | OSE `com.webos.service.downloadmanager`, the legacy API the Isis browser calls |
| Audio focus | `com.webos.service.audiofocusmanager` `requestFocus {requestType, streamType, displayId, subscribe}` -> `{result: "AF_GRANTED"}`, then `"AF_LOST"` to the app that had it; `releaseFocus`, `getStatus`. Music, Videos and Podcasts pause each other | OSE LS2 API reference; the `AF_LOST` / `AF_PAUSE` event names are audiod's, not in the public reference |
| Podcasts' data | db8 `org.webosphoenix.podcast:1` (feedUrl, title, author, image, lastRefresh, lastError) and `org.webosphoenix.podcast.episode:1` (podcastId, guid, title, published, duration, url, position, played, file); kinds in `public/configuration/db` | Phoenix |
| Background refresh | `com.palm.activitymanager` `create` `org.webosphoenix.podcasts.refresh` with `schedule: {start}` 6 hours on, callback `launch {id, params: {refresh: true}}`; each run completes it, refreshes, posts a notification for new episodes and schedules the next | as Tasks' reminders |
| What plays | the `nowPlaying` host message (`{title, artist, album, playing, appId}`) and a banner in the background, as Music | Phoenix |

The shell still has no now-playing dashboard for Music or Podcasts.

### In the simulator

The runtime block "HTTP, downloads and audio focus" gives
`__phoenixRuntime.http.request`: a page served by `tools/serve-rootfs.py`
sends requests through its proxy (`POST /__phoenix/proxy`, which now
follows redirects and can answer binary bodies as base64); phoenix-sim's
`phoenix://` pages use its own proxy (`GET /__phoenix/proxy?req=...`,
`RootfsSchemeHandler` on Qt Network), so any feed or server can be reached. Downloads go into the media block's
store under `/media/internal`, so Files sees them. The audio focus holder is
kept in the shared store, so pages tell each other. `serve-rootfs.py` also
answers HEAD and byte ranges now, so videos can seek.

The demo videos (two WebM clips with WebVTT and SRT subtitles) and
documents (a PDF, an EPUB, a Word document, an Excel workbook, a
PowerPoint presentation, Markdown) are in `apps/media-samples`
(generated, CC0), mounted at `/media/internal/samples`; the file manager
and the media indexer add them to a simulated device seeded before they
existed.

`node tools/test-videos.cjs`, `node tools/test-podcasts.cjs` (against a
feed server it runs itself, with the directory search answered by the
test) and `node tools/test-docs.cjs` (PDF View and Doc View), each with
`[--tablet]`, drive them, with screenshots in `build/*-tests/`.

## CardDAV and CalDAV

A Synergy account that syncs contacts and calendars both ways with any
CardDAV / CalDAV server (iCloud, Fastmail, Nextcloud, Radicale, ...). How
legacy Synergy worked, the plan for Google, Microsoft, mail, SMS and Matrix,
and the details of this first transport are in [SYNERGY.md](SYNERGY.md).

- **Template** `com.webosphoenix.dav` (`apps/dav/public/accounts/`, installed at
  `/usr/palm/public/accounts/com.webosphoenix.dav/`): CONTACTS and CALENDAR
  providers on `org.webosphoenix.service.dav`, with the db8 kinds
  `com.palm.contact.dav:1`, `com.palm.calendar.dav:1` and
  `com.palm.calendarevent.dav:1`, which extend the kinds Contacts and Calendar
  read.
- **Sign-in** (`apps/dav/accounts/wizard.html`, the template's
  `validator.customUI`): server, user name and app password, checked by
  service discovery.
- **Service** (`apps/dav/service`): `checkCredentials`, `onCreate`,
  `onEnabled`, `onCredentialsChanged`, `onDelete`, `sync`. The sync engine in
  `lib/` maps vCard and iCalendar to the legacy kinds, syncs with
  sync-collection or ctag / etag, uploads with If-Match, and lets the server
  win conflicts. It also keeps `com.palm.person:1` up to date for the
  contacts it syncs.

**Subscribed calendars** (docs/M6-PLAN.md F4 item 8, after the webOS
Archive's WebCal Sync): the template `com.webosphoenix.webcal` ("Subscribed
Calendar", `apps/dav/public/accounts/com.webosphoenix.webcal/`) has a
CALENDAR provider on the same service. Its page (`accounts/webcal.html`)
takes a public `.ics` address (http, https or webcal) and an optional name.
The validator, `checkCredentials {templateId: "com.webosphoenix.webcal",
config: {url}}`, reads the file. The address is kept as the account's
credentials (`common.url`). Each sync (`lib/webcal.js`) reads the file
again, one way, into a read-only `com.palm.calendar.dav:1` with the file's
name. It cuts the file into one calendar per UID for the CalDAV mapping,
replaces the events when the text changed, and skips it when it did not.
The periodic activity runs every 30 minutes on a device; in the simulator
the file is read when the account is created and on "Sync now".

### In the simulator

The block "CardDAV and CalDAV" at the end of `runtime/phoenix-runtime.js`
loads the service's own modules into the page (from
`/usr/palm/applications/org.webosphoenix.dav/service/`) and registers them on
the simulated bus, so the simulator runs the device's code. It adds the
template to the simulated accounts service and calls the transport as the
real accounts service does (onCreate and onEnabled after createAccount,
onEnabled on capability changes, onCredentialsChanged, onEnabled(false) and
onDelete before deleteAccount) and registers the kinds. "Sync now"
(Contacts and Calendar) is an activity with no schedule, which the activity
manager runs at once. Interval schedules do not run: sync happens when the account is created or enabled,
and on "Sync now". One sync runs at a time per account across all pages.

HTTP needs a way past the browser's same-origin rule: pages served over HTTP
(`tools/serve-rootfs.py`, the tests) send requests through the server's
`POST /__phoenix/proxy`; phoenix-sim's pages through its own,
`GET /__phoenix/proxy?req=...` (`RootfsSchemeHandler`, Qt Network), so any
DAV server works there too. `__phoenixRuntime.dav.sync(accountId)` syncs from a
test or the console.

`node tools/test-dav-sync.cjs [--tablet]` starts Radicale (`pip install
radicale`), adds the account in the original Accounts app, and checks sync
both ways against db8, Contacts and Calendar; screenshots go to
`build/dav-tests/`. The device service's tests (`apps/dav/service/*.test.ts`)
run with `npm test`.

## First Use

`apps/firstuse` (`org.webosphoenix.firstuse`, hidden from the launcher)
rebuilds the webOS First Use app, which Palm never open-sourced. On webOS,
`LunaSysMgr.upstart` started LunaSysMgr in its minimal UI with
`-u minimal -a com.palm.app.firstuse` until `/var/luna/preferences/ran-first-use`
existed (`WindowManagerMinimal`: a status bar and the app full screen; no
launcher, lock screen or system menu), and `com.palm.systemmanager/getBootStatus`
answered `firstUse: true` meanwhile. Phoenix does the same:

- **Steps**: Welcome (language: `com.webos.settingsservice` `localeInfo`),
  Wi-Fi (join, with a password dialog), Restore (a backup from the USB
  drive or a WebDAV server, see [Backup](#backup); afterwards the device
  backs up there every day with the same passphrase), Date & Time (time zone, network
  time, 24-hour clock), Accounts (Synergy explained, the accounts there are,
  "Add an account" opens the Accounts app; what syncs today, per
  [SYNERGY-MODERN.md](SYNERGY-MODERN.md)), Passcode (none, simple PIN or
  password, through `com.palm.systemmanager setDevicePasscode`), Privacy
  (Location Services and network location; the assistant of
  [AI-AND-MCP.md](AI-AND-MCP.md) is marked "coming later"), Cards & Gestures
  (the tutorial), All Set (Help and tips, Emergency Info). Every step but the
  first and last has Skip; Back and the back gesture go back a step; "Skip
  setup" on the first page ends it at once after asking.
- **The tutorial** plays each gesture on a small drawn phone (a tablet on
  tablets): swipe up for card view, tap a card, flick a card away, swipe
  left for back (phones only), swipe up again for the launcher, Just Type.
  CSS animations, new: Palm's tutorial was not released.
- **Done or skipped**: the app sets the system preference
  `firstUseComplete` and closes its window.

The shell (`Shell.startFirstUse()`) launches the app as the only card,
maximized: no dock, launcher, search pill, Just Type, system menu or lock
screen; swipe up shows card view only when First Use has opened another app
(Accounts, Help), and First Use's card cannot be flicked away
(`CardView.pinnedUid`). When the card closes, `Shell.firstUse` ends and the
normal shell is back. phoenix-sim runs it at start-up until it has been done
once (its settings file keeps `firstuse/done`, set when a page reports
`firstUseComplete`), unless `--scene` or `--launch` is given;
`phoenix-sim --first-use` or `--scene firstuse` runs it anyway. The shell
tells the pages (`applyHostStatus {firstUse}`), so `getBootStatus` answers
as LunaSysMgr's did. Settings > Device Info > "Run setup again" launches it
as an ordinary card with `{rerun: true}`.

On a device, the shell has to read `firstUseComplete` from the system
service at boot (not wired in `LsmSystemStatus` yet).

## Marketplace

`apps/marketplace` (`org.webosphoenix.marketplace`, Downloads tab) is the
Marketplace ([APP-STORE.md](APP-STORE.md); the owner named it, 1 October
2026): the webOS 2.x App Catalog's shape (a blue header with search,
Featured / Web Apps / Apps / Classics with categories, an app page whose
Download button becomes the progress bar and then Open, Installed with
Update All, Catalogs). Behind it is `org.webosphoenix.service.packages`
(`apps/marketplace/service/`, Node.js; methods in `packagesservice.js`),
which runs unchanged in the simulator:

- **Sources** (`/etc/palm/marketplace/sources.json`, then the user's):
  the Phoenix Marketplace (a signed catalog; for now at
  `http://127.0.0.1:8088/v1/`, `server/marketplace/bin/serve.sh`, or
  `phoenix-sim --marketplace`, which starts it with the simulator and opens
  the Marketplace), the
  webOS Archive's App Museum II and the PreCentral homebrew feed (both off
  until switched on). Catalogs can be added by address.
- **Signed catalogs** (`lib/catalog.js`, `lib/ed25519.js`): `index.json`,
  its Ed25519 signature and `key.json`. A catalog's key is trusted once,
  after the user sees its fingerprint; then only indexes signed with it,
  not expired and not older than the last one taken are read.
- **Installing** goes through OSE's installer (`com.webos.appInstallService
  install {id, ipkUrl}`), which takes an `.ipk`:
  - a web app (PWA): the site's manifest is read (`lib/pwa.js`; its start
    page must stay on the catalog's origin) and packaged as an `.ipk`
    (`lib/ipk.js`) whose `appinfo.json` "main" is the site, with the site's
    icons: its own launcher icon and cards;
  - a Phoenix app: the `.ipk`, checked against the size and SHA-256 the
    catalog signed;
  - a Classic: the App Museum's package (`lib/appmuseum.js`), or a Preware
    feed's (`lib/preware.js`, MD5 checked).
  Every package is read first and refused when it is native or a Mojo app
  (`sources.json` without `depends.js`: Palm's Mojo was never released).
  One that runs install scripts, has services or puts files outside its
  app needs [Developer Mode](#developer-mode) (`NEEDS_DEVMODE`; the app
  page then links to Settings > Developer Mode), and is installed with
  `developerMode: true`.
- **Screenshots**: the app page's strip leaves out the ones that do not
  load (the webOS Archive lists some it no longer has); a tap opens them
  full screen (`src/Gallery.tsx`), where they follow the finger and
  settle on the next one after a quarter of the width or a flick, with
  arrows, dots, the arrow keys, and the back gesture to close.
- **Updates**: a daily activity reads the catalogs and posts one toast
  ("2 app updates in the Marketplace", opening Installed); Update All
  installs them. Apps removed in the launcher are forgotten.

In the simulator, the runtime gives the service HTTP through the host's
proxy, WebCrypto and gzip streams, and `/tmp` in memory; its state is in the
shared store. Tests: `apps/marketplace/service/lib.test.ts` (against OpenSSL,
`ar` and `tar`), `service.test.ts` (against the real catalog service, a web
app site, an App Museum stand-in and a Preware feed), `tools/test-marketplace.cjs`.

The catalog service is `server/marketplace` (PHP 8 + PDO; MySQL/MariaDB on a
server, SQLite on one computer): accounts, submissions with the same
automatic checks, a review queue (`/admin`), ratings and reviews, reports,
opt-outs for the curated web apps (126 popular sites' PWAs, found and
checked by `bin/probe-pwas.py`), and publishing the signed index (its
README).

### Installing apps

`com.webos.appInstallService` (`install`, `remove`, `status`, with OSE's
status values) and the legacy `com.palm.appinstaller` (`installNoVerify`,
which Files' `.ipk` sheet uses) are real in the simulator now: the runtime
reads the package and hands its app's files to the host, phoenix-sim's
`SimInstaller` ("installApp" / "removeApp" host messages; its data folder's
`cryptofs/apps`, or `--installed-dir`) or `tools/serve-rootfs.py`
(`POST /__phoenix/installer`, `--installed-dir`). Installed apps are served
at `/usr/palm/applications/<id>/` like the built-in ones, are marked
`removable`, and the launcher's Delete removes them (as webOS did); pages
hear of it through `launchPointChanges`. An app whose "main" is an
`https://` address (an installed web app) opens that site; the site has
no webOS app menu, so the shell draws one for it (`SiteMenu.qml`, in the
system menu's art): Back, Forward, Reload, Copy Link and Open in Browser.
The back gesture goes back in the site's history first. Android cards will
get the same menu ([ANDROID.md](ANDROID.md)). A built-in
app's id cannot be installed over. `build/siminstaller-test` tests
SimInstaller.

**In the launcher, as it goes.** Whoever installs tells the shell
(`runtime.installStatus`, an `installStatus` host message: state,
progress, title, icon, the reason of a failure, how to try again): the
Marketplace from its first download step (`deps.pending` of the packages
service), the installer as it reads and installs the package. An app not
installed yet gets a pending icon of its own (on Downloads), faded to half
with a 32 px progress badge, a frame of `loading-strip.png` per 1/19 of the
progress; a failed one shows `warning-icon.png` (LunaSysMgr's install
status decorators, `iconheap.cpp:44-51`, at 50 px right of and above the
cell's centre on tablets). A tap on it does not launch it: while it
installs it opens the app's page in the Marketplace, as webOS sent such
launches to Software Manager; after a failure it asks "Installation
Failed", with Try Again (the same install again: the Marketplace's, or the
installer's with the same file) and Remove. `phoenix-sim --scene
launcherinstall` shows both.

**The rest of the installer and the application manager** (luna-sysmgr's
`ApplicationInstaller.cpp`, `ApplicationManagerService.cpp`; the host's
part through `runtime.hostOp`, phoenix-sim's `SimWindowSource` or
`tools/serve-rootfs.py`; `tools/test-appmanager.cjs` tests them):

| Method | What it does here |
| --- | --- |
| `com.palm.appinstaller/notifyOnChange {appId?}` | `{appId, version, statusChange: "INSTALLED" \| "REMOVED", cause: "USER" \| "REVOKED"}` for one app or all (`*`) |
| `installProgressQuery {appId, subscribe?}` | `{state, progress, title, reason}` of a pending install (LunaSysMgr never answered it) |
| `queryInstallCapacity {appId \| packageId, size, uncompressedSize}` | `{result (1 download, 2 install space short), spaceNeededInKB}`, against the free space where apps go |
| `getUserInstalledAppSizes` | `{apps: [{appName, size (KB)}], totalSize}` |
| `revoke {item: '{"payload": {signature, appId: [...]}}'}` | removes the apps (cause REVOKED) when a trusted Marketplace catalog's Ed25519 key signed their ids; else `verify failed` |
| `com.palm.applicationManager/addLaunchPoint`, `removeLaunchPoint` | above |
| `running`, `close {processId}` | the apps with cards, headless or kept alive, with process ids; close ends one for good |
| `install {target}`, `rescan` | install a package file; read the apps again |
| `getSizeOfApps {appIds}` | `{<appId>: bytes}` |
| `listPendingLaunchPoints` | the apps being installed |
| `listDockModeLaunchPoints`, `addDockModeLaunchPoint`, `removeDockModeLaunchPoint`, `listDockPoints` | apps with `"exhibitionMode"` (or `"dockMode"`) in `appinfo.json`, enabled by default as `conf/default-exhibition-apps.json` (Photos); data only until dock mode comes |
| `addResourceHandler`, `swapResourceHandler`, `addRedirectHandler`, `swapRedirectHandler`, `removeHandlersForAppId`, `listAllHandlersForMime` / `ForUrl`, `getHandlerForUrl` / `ForExtension`, `mimeTypeForExtension`, `listResourceHandlers`, `listRedirectHandlers`, `listExtensionMap` | the handler registry: the apps' `mimeTypes`, the built-in handlers and `command-resource-handlers.json`, plus those apps add (kept in the shared store, indexes from 1000); the first for a type or pattern is active until swapped |

### Developer Mode

Settings > Developer Mode (the last pane, under Advanced) turns on what
ordinary apps may not do: packages that run install scripts, have
background services or put files outside their app, and later the
Terminal's sudo and SSH ([TERMINAL.md](TERMINAL.md) T4). Turning it on
shows what it allows and asks for the device PIN or password
(`matchDevicePasscode`); with no secure unlock set it asks for one first
and offers Screen & Lock. Turning it off asks nothing. The state is OSE's
`com.webos.service.devmode` (`getDevMode`, `setDevMode`); erasing the
device turns it off. While it is on, its Debugging switches show the
shell's frame rate counter and touch plot (`enableFpsCounter`,
`enableTouchPlot`; see [Device security](#device-security-erase-usb-drive-mode-and-debugging)).

The installer takes such a package only when Developer Mode is on and the
request says `developerMode: true` (`com.webos.appInstallService install`;
the Marketplace sets it after its own check). In the simulator the app's
files are installed and the rest is not run: the reply's `details.skipped`
lists the install scripts, the services and the other files, and the
Marketplace's app page says so. On a device the installer will need the
privileged path OSE's Developer Mode uses for `ares-install` (services
under `/media/developer`), which is M1 work.

Why not ACL. HP's Android app player for the TouchPad ("ACL", Open Mobile)
was a closed-source chroot of Android 2.3 with kernel modules built for
the TouchPad's 2.6.35 kernel, sold per device: it cannot be redistributed
or run on Phoenix. Its ideas carry over to the Android plan
([ANDROID.md](ANDROID.md)), which uses Waydroid.

## System updates

`com.palm.update` (`services/updates`, Node.js; methods in
`updatesservice.js`) is System Updates. Palm's update daemon had this name,
and the luna-systemui Phoenix runs still listens to it
(`data/SysUpdateService.js`, `app/SysUpdateAlerts`): `GetStatus` says when to
show the "Update Available" alert, the download dashboard and the countdown
alert, which answer with `InstallLater`, `InstallNow` and `AlertDisplayed`. The
service keeps that API and adds Phoenix's own (`getStatus`, `check`,
`download`, `cancel`, `installNow`, `setPreferences`) for Settings > Updates,
which is `com.palm.app.updates` (the alerts open it).

The system is installed with RAUC into two root slots, so:

1. a daily activity reads the feed, `<feed>/<compatible>/<channel>.json`
   (`/etc/palm/updates.json`; `server/updates` writes them), stable or beta;
2. over Wi-Fi (or when asked) it downloads the bundle, checks its size and
   SHA-256 against the feed, and RAUC writes it to the other slot, while the
   device is in use. Both are an ongoing activity in the notification area;
3. the running slot stays the one that starts. luna-systemui shows "Update
   Available"; Install now switches slots and restarts (about a minute, which
   is what the alert says); Install later asks again, with the countdown
   alert, when the charger is next connected (an activity with
   `requirements: {charging: true}`). Installing needs 20% battery or the
   charger;
4. after the restart a notification says "Updated to ..." or, when the
   bootloader went back to the old slot, that the update did not start.

The feed is not signed; the bundles are. RAUC checks a bundle's signature
against the keyring in the running system, and the service then uses it only
if its manifest is for this device (`compatible`) and its build is newer than
the running one (`/etc/os-release` `BUILD_ID`), so no feed can put an older
system back.

In the simulator the service runs unchanged over a simulated RAUC: two slots in
the shared store; osInfo's `webos_release` and `webos_build_id` are the running
slot's. A simulator bundle is only a RAUC manifest
(`php server/updates/bin/updates.php simulator --version 0.2.0 --build 2`,
served by `server/updates/bin/serve.sh` at `http://127.0.0.1:8089/`).
`com.palm.power/shutdown/machineReboot` restarts phoenix-sim (`simProcess`),
or reloads the page under `tools/serve-rootfs.py`; for a system update
(`reason: "System update"`) phoenix-sim starts again with `--updating`, and
the boot shows luna-sysmgr's "Updating the system / Do not remove battery"
(BootupAnimation's activity state) while the new system's UI loads, its
progress that page's loading. Tests:
`services/updates/updatesservice.test.ts` (with a stand-in for RAUC's command
line), `server/updates/tests/run.php`, `tools/test-updates.cjs`.

## Device security, erase, USB drive mode and debugging

The rest of luna-sysmgr's `com.palm.systemmanager` and the storage daemon's
`com.palm.storage` the system UI relies on, simulated in the runtime
(`runtime/phoenix-runtime.js`, "com.palm.systemmanager: device lock",
"com.palm.storage", "Debugging overlays"). OSE has none of them; on a device
Phoenix will have to provide them. `tools/test-security.cjs` tests them.

**Device lock and security policy** (`Security.cpp`, `EASPolicyManager.cpp`):

| Method | Phoenix |
| --- | --- |
| `getDeviceLockMode {subscribe}` | `{lockMode: "none" \| "pin" \| "password", policyState: "none" \| "active" \| "pending", retriesLeft}` (the policy's tries left; 0 without one) |
| `getSecurityPolicy {}` | `{policy: {password: {enabled, minLength, maxRetries, alphaNumeric, allowSimplePassword?}, inactivityInSeconds, id, status: {enforced, retriesLeft}}}`; `returnValue: false` without a policy |
| `setDevicePasscode {lockMode, passCode, oldPasscode}` | the old passcode when one is set, except while the policy is pending (the lock screen sets the new one it asks for); against a policy, the original's checks: `errorCode` -1 empty, -2 too short, -3 / -4 not alphanumeric, -5 not digits, -8 repeating, -9 sequential, with its texts ("No sequential numbers (1234)") |
| `matchDevicePasscode {passCode}` | `{succeeded}`, and when wrong `{lockedOut, retriesLeft}` (the original answered `returnValue: false`) |

A policy is what an Exchange account puts in db8: `com.palm.securitypolicy:1`
objects with EAS's fields (`devicePasswordEnabled`, `minDevicePasswordLength`,
`maxDevicePasswordFailedAttempts`, `alphanumericDevicePasswordRequired`,
`allowSimpleDevicePassword`, `maxInactivityTimeDeviceLock`), merged into the
strictest. phoenix-sim `--security-policy minLength=6,maxRetries=4,...` puts
one there (`_id` `phoenix-sim-policy`; `none` removes it). A policy the
passcode does not satisfy is pending: the lock screen shows "PIN Required" (or
"Password Required") and sets a new one. Active, each wrong passcode costs a
try: "2 Tries Remaining", then the last-try warning, then "Your device will
now be erased." and `com.palm.storage/erase/Wipe`. Its inactivity caps
Screen & Lock's "Lock after". Without a policy, three wrong passcodes hold the
next try off for 15 s (`lockedOut`).

**Erase and USB drive mode** (`com.palm.storage`):

| Method | Phoenix |
| --- | --- |
| `erase/EraseAll {}`, `erase/Wipe {}` | Full Erase (the Full Erase key chord; a policy's last try): as Settings' Full Erase (`org.webosphoenix.service.reset/fullErase`, which now does the same), then an `erase` host message: phoenix-sim restarts with no data (`simProcess.eraseAndRestart`: its data and cache folders and settings file go) into First Use |
| `diskmode/hostIsConnected {}` | `{result: true, hostIsConnected}`: a USB cable from a computer is in (the shell says so with the `usbHost` host status; a page waits for it, 3 s at most) |
| `diskmode/enterMSM {"user-confirmed", enterIMasq}` | an `enterMSM` host message to phoenix-sim's storaged (`SimStorage.qml`) |

storaged's `/storaged` signals (`MSMAvail {mode-avail}`, `MSMProgress {stage}`,
`MSMEntry {new-mode}`, `MSMFscking`, `PartitionAvail {fscked}`) reach
`com.palm.bus/signal/addmatch` in every page (`runtime.storagedSignal`,
luna-systemui's StoragedService.js: the "Connected" alert, the USB warning,
the USB dashboard, "Some data was damaged") and the shell
(`Shell.storagedSignal`: the brick screen, the check of the drive, "USB Drive
connection failed").

**Debugging and the rest** (`SystemService.cpp:209-250`):

| Method | Phoenix |
| --- | --- |
| `enableFpsCounter {enable?, reset?, dump?}` | the frame rate counter at the bottom left; `debugOverlay` host message |
| `enableTouchPlot {collection?, trails?, crosshairs?}` | the touch plot; `debugOverlay` host message. Both `returnValue: false` without a key they know |
| `getDebugOverlays {subscribe}` (Phoenix) | `{fpsCounter, touchPlot: {collection, trails, crosshairs}}`, as the shell reports them (`debugOverlays` host status); Settings > Developer Mode > Debugging has a switch for each |
| `runProgressAnimation {type, state}` | `"msm"`, `"fsck"` or anything else (the logo); `"start"` / `"stop"`; `progressAnimation` host message |
| `subscribeTurboMode {subscribe}` | `{subscribed, turboMode: true}` while subscribed (nothing to boost in the simulator) |

## Ongoing activities

Work going on in the background, such as a download or an install, is an
ongoing activity: a row in the notification area with its progress that
cannot be swiped away and goes when the work ends. A tap opens its app with
its params. It is the shell's API:

- `luna://org.webosphoenix.ongoing/set {id, appId?, title, body?, icon?, progress (0-100, -1: none), params?}`
- `luna://org.webosphoenix.ongoing/clear {id}`

System updates (`com.palm.update`), Marketplace installs and the download
manager (each download: file name, "Downloading 160 KB of 441 KB" and its
progress) use it. They are
pinned at the top of the notification list, in the order they began, with a
faint rule between them and the notifications (which keep the original's
order below). On a phone the list opens at them when there are any (else at
the newest notification, as the original). An app's activities go when its
last card closes: their work ran in its pages, and they cannot be swiped
away. The Notification Lab (`apps/notificationlab`, in the launcher) starts
them, with and without progress, one or several at once, next to a banner,
a dashboard, a popup alert and background tasks (`com.palm.activitymanager`),
to review how they look. The owner's plan (1 October 2026) is Live Activities: these get
their own place on the left of the notification area and open a pane when
tapped ([ROADMAP.md](ROADMAP.md)). The services do not change for that.

The notification drawer (Phoenix): the open dashboard has a handle on its
open edge (phones: the top; the tablet's drop-down: its foot). Pulled, the
dashboard follows the finger and opens to the whole screen past 40 px; a
tap toggles it, and on a phone a pull down from the normal size closes it
(however far the finger goes, the dashboard stays under it until it lets
go). At full screen a header offers Select (a check mark on each
notification, then Clear (n)) and Clear All, which asks once ("Clear 3?"):
a second tap within 3 s clears. The handle's and the buttons' touch areas
never overlap, and taps on the dashboard's blank parts stay in it. Live
activities are never selected or cleared. `phoenix-sim --scene drawer`
shows it.

Other legacy hooks the simulator now answers as a device would:
`com.palm.bus/signal/registerServerStatus` says whether a service exists
(luna-systemui waits on it before subscribing), and
`com.webos.notification/createToast` with an `onclick.appId` for another app
(a service's toast) posts that app's notification.

## Printing

Print is where webOS had it: in the app menu of Web and Email (both open
Enyo 1.0's own print dialog, `lib/printdialog`) and in Photos' viewer.
The dialog speaks to the print manager, `com.palm.printmgr`, which the
runtime simulates (block "Printing") with the calls `PrintJob.js`,
`DocumentPrintJob.js`, `ImagePrintJob.js` and the printer kinds make
(`printers/list`, `getCurrent`, `setCurrent`, `getCapabilities`, `add`;
`jobs/open`, `editPrintParams`, `getFinalParamsAndArea`, `getStatus`,
`getRenderStatus`, `addFile`, `close`, `cancel`) and the print manager's
error codes.

- **The printer** is **Save as PDF**: the job becomes a PDF in
  `/media/internal/Documents` (named after the page, "(2)" when taken),
  which Files and PDF View open. A network printer would need CUPS with
  IPP Everywhere on a device; there is none in the simulator, so Add a
  Printer answers "Unable to communicate with the printer" (-203).
- **Rendering**: a page view's page (the browser's, Email's message) or an
  app's own window (`PalmSystem.printFrame`, the dialog's `frameToPrint`)
  is rendered by Chromium in phoenix-sim: the "print" host message (or the
  page view's `print` op) has `WebAppWindow.qml` call QtWebEngine's
  `printToPdf` on that view, in the job's paper size, and hand the PDF back
  (`__phoenixRuntime.print.rendered`). In a desktop browser (and the
  Playwright tests) the page's text is printed instead. Pictures
  (`jobs/addFile`) are put on pages by the runtime's small PDF writer, one a
  page, turned and scaled to the paper.
- **Enyo 1.0** was released with two of the dialog's files empty
  (`MediaTypePicker.js`, `PrintQualityPicker.js`) although the options
  page creates both, so opening a printer's options failed; the compat
  overlay supplies them, written after `MediaSizePicker.js`.
- **While it prints**, a job is an ongoing activity in the notification area
  ("Printing <name>"), as the original Print Manager's status dashboard was
  (`PrintJob` still launches it headless, which opens no card here); when
  it is done a "Saved as PDF" notification opens the Print Manager at the
  job.
- **Print Manager** (`apps/printmanager`, `org.webosphoenix.printmanager`,
  on the launcher's Settings page as on webOS; `com.palm.app.printmanager`
  is an alias): the jobs (printing ones with Cancel, then the rest newest
  first; tap one to open its PDF; Clear Finished Jobs in the app menu) and
  the printers (the current one checked). It uses two Phoenix additions,
  `jobs/list {subscribe}` and `jobs/remove`. `@phoenix/luna`'s `print.ts`
  is the client; `@phoenix/ui`'s `PrintDialog` is the dialog for Phoenix
  apps (Photos), with the original's steps and words.

Tests: `apps/shared/luna/src/print.test.ts` (the service, the PDF writer),
`apps/printmanager/src/jobs.test.ts`, `tools/test-browser.cjs` (print:
the app menu, the dialog, the PDF, the Print Manager). Checked in
phoenix-sim, phone and tablet: the browser's page as Chromium's PDF and a
photo from Photos, both opened in PDF View.

## Screen captures

Home + Power together, as the original (released one while the other is
held), or Print Screen, Ctrl+Alt+P or (simulator) F9: the shell grabs the
UI (`Shell.takeScreenshot`), plays the "shutter" feedback sound and the
original's flash (`ScreenCaptureFlash.qml`, after
`WSOverlayScreenShotAnimation`), and hands the PNG (`ImageTools.pngBase64`,
Phoenix.Native) to the window source. In the simulator `SimWindowSource.
saveScreenshot` runs `runtime.saveScreenshot({data, app, time})` on one
page: the file goes to `/media/internal/screencaptures/<app> YYYY-MM-DD at
HH.MM.SS.png`, the media index scans it (Photos' Screen Captures album),
and a "Screen captured" notification opens it in the Screenshot app
(`apps/screenshot`, `org.webosphoenix.screenshot`, hidden from the
launcher; without a path it shows the newest capture). There: Crop,
Markup, Share (Email, Messaging), Delete, and Save over the capture.
Tests: `shell/tests/tst_screenshot.qml` (the keys, the flash, the hand
over), `apps/screenshot/src/editor.test.ts`, `tools/test-screenshot.cjs`;
`phoenix-sim --scene capture` / `capturepreview` (with `--delay`).
Plan and later features: [SCREENSHOTS.md](SCREENSHOTS.md).

## Exhibitions (dock mode)

On a Touchstone (the inductive charger) the shell goes into dock mode,
"Exhibition", as luna-sysmgr did (GAPS R5; the rules are in `Shell.qml`,
the surface in `DockMode.qml`): one exhibition fills the screen under the
status bar, and its title in the status bar drops the menu of exhibitions
(Time, built into the shell, then the apps the user turned on in
Settings > Exhibition, at most three; Photos at first). Any web app can be
one:

```json
"exhibitionMode": true,
"exhibitionModeOptions": { "title": "Weather" }
```

(`dockMode` / `dockModeOptions` are the webOS 2.x names and work too;
without a title the app's own is used; luna-sysmgr
`ApplicationDescription.cpp:369-398`.) Dock mode opens the app's
exhibition in a window of its own, not a card, with the launch params
`{"dockMode": true, "windowType": "dockModeWindow"}`
(`DockModeWindowManager::launchApp`): `PalmSystem.launchParams`, so the app
shows its exhibition instead of its usual first view
(`isExhibitionLaunch(params)` in `@phoenix/luna`; Photos shows a slideshow,
`apps/photos/src/Exhibition.tsx`, the Agenda the coming days,
`apps/agenda`). The window keeps running while dock mode is up; it hears
when it comes to the front of dock mode or leaves it as a card does, the
`phoenixcardactivation` event `{active}` (the shell's
`source.activateWindow`), and should pause its timers while not active.
Leaving dock mode closes the windows of the exhibitions not in front
(`dockModeCloseOnExit`); the one in front stays for next time. Tapping
something that opens an app (a link, a notification) ends dock mode.

| What | Service and methods | Source |
| --- | --- | --- |
| Dock mode is up | `com.palm.systemmanager` `getDockModeStatus {subscribe}` -> `{enabled}` (`dockMode.watch()`) | luna-sysmgr `SystemService.cpp:1913-1990`; the shell says it (`applyHostStatus {dockMode}`) |
| Exhibition apps | `com.palm.applicationManager` `listDockModeLaunchPoints` -> `{launchPoints: [{id, appId, title, icon, exhibitionMode, exhibitionModeTitle, enabled}], maxApps}`; Phoenix: `{subscribe: true}` hears each change (`dockMode.watchLaunchPoints()`) | `ApplicationManagerService.cpp:2486-2575` |
| Turn on / off | `addDockModeLaunchPoint {appId}` (last in the menu; fails past `maxApps` 3, errorCode -2, or for an app that is no exhibition, -1), `removeDockModeLaunchPoint {appId}`; Phoenix: `setDockModeLaunchPoints {appIds}`, the ones on in the menu's order | `:2820-2985`; `DockModePositionManager` |
| Preferences | `com.webos.service.systemservice` `getPreferences` / `setPreferences`: `dockwallpaper {wallpaperName, wallpaperFile}` and `dockModeSoundPref` (`"systemsettings"`, or Phoenix's `"mute"`) as luna-sysmgr kept them; Phoenix's `exhibition {enabled, startAfter (s; 0: when the screen would turn off), nightMode, nightStart, nightEnd ("HH:MM")}` | `conf/defaultPreferences.txt`, `Preferences.cpp:560-568` |
| The Touchstone | powerd's `USBDockStatus` signal and `chargerStatusQuery`: `{Charging, DockConnected, DockPower, DockSerialNo, USBConnected: false, type: "inductive"}` | `DisplayManager.cpp:967-1060` |

The old ids name the new apps: `com.palm.app.photos` is Phoenix Photos,
`com.palm.app.agendaview` the Agenda, and `com.palm.app.exhibitionpreferences`
opens Settings > Exhibition. The shell hears the list and the preferences in
`systemStatus` (`exhibitionApps`, `exhibition`, `dockModeSound`,
`dockWallpaperFile`). Tests: `shell/tests/tst_dockmode.qml`,
`apps/shared/luna/src/exhibition.test.ts`,
`apps/settings/src/pages/Exhibition.test.tsx`, `apps/photos/src/slideshow.test.ts`,
`apps/agenda/src/agenda.test.ts`, `node tools/test-exhibition.cjs`. In
phoenix-sim F12 sets the device on a Touchstone or lifts it off,
Shift+F12 moves it onto another one, and `--touchstone` starts on one, in
dock mode.

## Backup

Legacy webOS backed up to the Palm Profile servers every day, through a
backup service HP never released (`com.palm.service.backup`), and restored
at First Use. HP shut the servers down. Phoenix keeps the part that was
released and that OSE still ships, the **participant protocol**, and adds
its own coordinator, `org.webosphoenix.service.backup`
(`apps/settings/service/`, Node.js, run by run-js-service; methods in
`backupservice.js`):

- **Participants** register in `/etc/palm/backup/` with
  `{id, preBackup, postRestore}` (luna-sysservice
  `files/conf/com.webos.service.systemservice.backupRegistration.json`).
  For a backup the coordinator calls each one's `preBackup {tempDir,
  maxTempBytes, incrementalKey}` (plus `dir` and `bytes`, db8's names) and
  takes the files it answers with; for a restore it puts them back in a
  temporary folder and calls `postRestore {tempDir, dir, files}`. Phoenix
  1.0 has three:

  | Participant | What | Source |
  | --- | --- | --- |
  | `com.palm.db` `internal/preBackup`, `internal/postRestore` | db8 objects of the kinds marked `"sync": true` (MojDbKind); Phoenix marks the data that lives only on the device: the local contacts and people, calendar, tasks, memos, messages and chat threads, call log, alarms, the apps' preferences, voice memo and map place records. Account data (email, CardDAV / CalDAV) is in sub-kinds of its own and syncs back instead | db8 `MojDbServiceHandlerInternal.cpp`; registration shipped by Phoenix |
  | `com.webos.service.systemservice` `backup/preBackup`, `backup/postRestore` | The preferences in `/etc/palm/sysservice-backupkeys.json`: OSE's six plus Phoenix's (time format, tones, screen and lock, accessibility, emergency information; not the wallpaper, usually a picture the backup does not hold) | luna-sysservice `Src/BackupManager.cpp`; `compat/rootfs/etc/palm/` |
  | `com.palm.sysMgrDataBackup` `preBackup`, `postRestore` | The launcher layout (pages, dock, removed apps) | luna-sysmgr `Src/base/BackupManager.cpp`, a role the Phoenix shell takes |

- **The file**: `phoenix-backup-YYYYMMDD-HHMMSS.pbak`, one JSON document
  (`lib/archive.js`): a readable header (when, which device, which parts,
  the key derivation) and the parts' files encrypted with AES-256-GCM under
  a key from the passphrase (PBKDF2-SHA256, 600 000 iterations, random
  salt); the header is the additional data, so changing it makes the file
  fail to open. The service keeps the derived key, never the passphrase,
  so daily backups need no one to type it.
- **Where**: the USB drive (`/media/internal/backups`, to copy to a
  computer) or a WebDAV folder (Nextcloud, ownCloud, a NAS: `lib/webdav.js`,
  MKCOL, PROPFIND, PUT, GET, DELETE with Basic auth; the folder is checked
  and made when it is chosen, and a wrong password is refused there). The
  newest five backups are kept.
- **Every day**: an activity (`org.webosphoenix.backup.daily`, interval
  24 h, internet for WebDAV) calls `scheduled`. When backups keep failing
  for five days, the service publishes luna-systemui's own
  `subscribeToBackupStatus` event (`com.palm.systemmanager
  publishToSystemUI`), so the original "Backup Failure" dashboard shows;
  tapping it opens `com.palm.app.backup`, an alias of Settings > Backup.
- **UI**: Settings > Backup (`apps/settings/src/pages/Backup.tsx`: every
  day, Back Up Now, the last backup, where, the passphrase, the backups
  there, each with what it holds, Restore and Delete) and First Use's
  Restore step. Client: `@phoenix/luna` `backup`.

In the simulator the runtime runs the same service code in the page and
stands in for luna-sysservice's and the shell's participants (the shell
tells the pages its layout, `applyHostStatus {launcherLayout}`, and gets a
restored one back as a `launcherLayout` host message); the temporary
folder is in memory, the USB drive is the file manager's, and the settings
are in the shared store. The interval activity does not run there (no
background process).

On a device still to do: the shell's `com.palm.sysMgrDataBackup` service;
`"sync": true` on the core apps' kind files (meta-phoenix); the ACGs that
let the service call the participants' methods; the service's settings in
a file only it can read (service.js does this) or the key store; and the
installed apps list as a fourth participant once the Marketplace installs
apps. Tests: `apps/settings/service/backupservice.test.ts` (against a real
WebDAV server, WsgiDAV), `tools/test-backup.cjs`, `tools/test-firstuse.cjs`.

## Help

`apps/help` (`org.webosphoenix.help`, Apps tab) has short topics on the
gestures, cards, the launcher, notifications, Just Type, the system menu,
the lock screen, each Phoenix app, and the settings added here. Each topic
is a Markdown file in `apps/help/topics` with a front matter block (`title`,
`category`, `order`, `summary`, `keywords`, `app`); the app renders the
small part of Markdown they use (headings, lists, bold, italic, code, tips,
links; `topic:ID` links to another topic, `app:ID` opens an app) as React
elements, never as HTML. Search matches every word of the query against
title, keywords and text. Launch params: `{topic}`, `{search}`.

Just Type finds topics through a `dbsearch` in the app's `appinfo.json`:
the build writes `dist/help-index.json` (title, summary and search text of
each topic, and a version), which is put into db8 kind
`org.webosphoenix.helptopic:1` when it changed: by the simulator's runtime
when Just Type, the system UI or Help starts, and by Help itself on a
device (Just Type only finds help once Help has run there; a boot-time
indexer is still to do).

## Emergency information

**Settings > Emergency Info** keeps a medical ID: name, date of birth,
blood type, organ donor, medical conditions, allergies, medications,
notes, emergency contacts picked from `com.palm.person:1` (with a
relation), and "Show when locked". It is the system preference
`emergencyInfo` (`@phoenix/luna` `emergencyInfo`), so it can be read with
the device locked.

**The lock screen**: the PIN pad gets an **Emergency Call** button (on the
webOS phones the PIN screen came from the phone app; the TouchPad's
UnlockPanel, the only one released, had none). It opens Phone's restricted
mode as the shell's **emergency window** (`EmergencyWindow.qml`, after
luna-sysmgr's `EmergencyWindowManager`: one window, over the lock screen,
350 ms linear fade, Home or swipe up closes it). The window source makes it
with `openSystemWindow(appId, params, "emergency")`; phoenix-sim loads
Phone's page with `{emergency: true}`.

**Phone's restricted mode** (`apps/phone/src/views/Emergency.tsx`) dials
only emergency numbers (`isEmergencyNumber`: 112, 911, 000, 08, 110, 118,
119, 999 as 3GPP TS 22.101 lists them, plus the region's own) and the
Medical ID's emergency contacts; no contacts, call log, favourites or
voicemail. The empty dial button fills in the region's main number (911 in
North America, else 112) rather than calling it. Medical ID shows the
owner's details and calls their contacts. The calls go in the call log.
Cancel or the back gesture closes the window.

`node tools/test-emergency.cjs [--tablet]` fills in the medical ID, uses
restricted mode (a refused number, 911, the Medical ID, an emergency
contact) and Settings > Accessibility.

## Location

The simulator answers webOS OSE's `com.webos.service.location` (also as
the legacy `com.palm.location`), for Settings and for any app (Weather,
Maps):

| What | Service and methods | Source |
| --- | --- | --- |
| Handlers | `getAllLocationHandlers {subscribe}` -> `{handlers: [{name: "gps" \| "network", state}]}`, `getState {Handler}`, `setState {Handler, state}` (errorCode 10 without the capital-H `Handler`). Location Services "off" is both handlers off | LuneOS's findings on devices (`luneos-components` `LunaService.qml`, `luna-next-cardshell` `NewDeviceMenu.qml`) |
| Position | `getLocationUpdates {Handler?, subscribe?, minimumInterval}`: once without `subscribe`, then every move -> `{errorCode: 0, latitude, longitude, altitude, horizAccuracy, vertAccuracy, direction, speed, timestamp}` (ms); `mock/enable`, `mock/disable`, `mock/setLocation {location}` move the simulated device (Maps' tests). errorCodes as the legacy API: 1 timeout, 2 position unavailable, 5 location off, 6 permission denied (unverified against OSE) | OSE has no `getCurrentPosition`; the legacy `com.palm.location` name also answers `getCurrentPosition` and `startTracking`, with timestamps in seconds |
| Place | `getReverseLocation {latitude, longitude}` -> `{address, locality, region, country, countryCode}` | Phoenix (a list of cities in the simulator) |
| Permissions | `org.webosphoenix.service.location` `getPermissions {subscribe}` -> `{permissions: [{appId, title, allowed, time, lastUsed}]}`, `setPermission {appId, allowed}`, `removePermission {appId}` | Phoenix: OSE has no per-app location permission |
| Asking | the first request of an app with no answer posts `registerForLocationServiceNotifications {appId}` to `com.palm.systemmanager subscribeToSystemUI`; luna-systemui opens its own LocationAlert, whose buttons call `com.palm.location` `acceptLocationRequest` / `rejectLocationRequest` / `ignoreLocationRequest` | `luna-systemui` `data/SystemManagerService.js`, `app/SystemManagerAlerts/SystemManagerAlerts.js` |

The simulated device is at 950 W. Maude Ave., Sunnyvale (Palm's old
headquarters); a GPS fix is within 8 m, a network fix within 150 m (and
needs Wi-Fi). The alert's "Allow Once" is remembered like "Always Allow"
(change it in Settings). With no system UI to ask (a desktop browser) an app is
allowed and listed in Settings. The system apps (Just Type, the system UI,
Settings, First Use) never ask. `navigator.geolocation` is answered from
the same service and permission. `@phoenix/luna`'s `location` and
`locationPermissions` wrap all of it. For tests:
`__phoenixRuntime.location.setPosition({latitude, longitude})`, `.answer(appId, "allow" | "deny")`,
`.reset()`.

`node tools/test-location.cjs [--tablet]` uses Settings > Location
Services, asks from other apps (with and without luna-systemui's alert)
and checks `navigator.geolocation`.

On a device, the per-app permission is a Phoenix service still to write,
in front of OSE's location service.


## Community features (M6 F4)

What the community's options picked for 1.0 ([M6-PLAN.md](M6-PLAN.md) F4)
add to the runtime and the original apps:

- **Settings > Advanced** writes system preferences (LunaCE's own keys
  where it had the option: `infiniteCardCyclingEnabled`,
  `sysUiEnableMaximizeEdges`, `sysUiEnableWaveLauncher`,
  `showReticleAnimation`; Phoenix's `animationSpeed`, `gestureSensitivity`,
  `hapticFeedback`, `launcherGridDensity`, `showBatteryPercent`,
  `keyboardNumberRow`, `emailDashboardCycling`), and the shell gets them as
  the systemStatus `tweaks`. Settings > Sounds & Ringtones > Repeat alerts
  is `notificationRepeat` {enabled, minutes, apps}; Screen & Lock > Show
  previews is `lockScreenPreviews`.
- **Preferences across pages**: a page's getPreferences subscribers hear a
  preference another page changed (the store's storage event), as every
  subscriber on the bus did.
- **The power menu**: the shell sends com.palm.display's
  `/com/palm/display` `powerKeyPressed {showDialog: true}` signal to the
  pages' `com.palm.bus/signal/addmatch` listeners (`displaySignal`);
  luna-systemui opens its PowerOffAlert (compat overlay of
  `app/PowerdAlerts/PowerdAlerts.js`: Airplane Mode, Luna Restart, Device
  Restart, Shut Down, Cancel). The `airplaneMode` preference now turns the
  radios off and on. `com.palm.power/shutdown/machineOff` turns the
  simulator off (dark until Power) and `org.webosphoenix.system/restartUi`
  restarts its UI.
- **Contact tones**: Contacts' Edit has a Tones group (compat
  `app/phoenix-tones.js`): the person's own ringtone (`com.palm.person`
  ringtone) and a message tone in `org.webosphoenix.contacttone:1`
  {personId, messageTone: {name, location}}; a text from that person comes
  with `soundFile` set to it.
- **Email's cycling dashboard**: with `emailDashboardCycling`, the Email
  app's new-mail dashboards (compat `source/phoenix-dashboard.js`,
  `phoenix-dashboard/`) show one new email at a time with its time and a
  delete button.

Tests: `apps/shared/luna/src/tweaks.test.ts`, `tools/test-community.cjs`.
