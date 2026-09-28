# Web app runtime

Phoenix runs web apps: the original Open webOS apps (Enyo 1.0, 2011–2012)
and new Phoenix apps (Settings, Camera, Photos, Music, ...). This page explains how they run
in the simulator, in a desktop browser, and on a device.

## Where the apps come from

| Source | What | License |
| --- | --- | --- |
| `third_party/core-apps` | Accounts, Calculator, Calendar, Clock, Contacts, Email, Memos | Apache-2.0 |
| `third_party/enyo-1.0` | The Enyo 1.0 framework they are written in | Apache-2.0 |
| `third_party/foundation-frameworks`, `loadable-frameworks`, `mojoloader`, `underscore` | Shared libraries loaded with MojoLoader (Calendar, Contacts, ...) | Apache-2.0 |
| `third_party/app-services` | The apps' background services (accounts, contacts, calendar reminders, email) | Apache-2.0 |
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
  `del`, `find`/`search` with `where`/`orderBy`/`limit`, `watch`), system
  service (time, preferences), application manager (launch, open), connection
  manager, power, accounts, and harmless stubs for the rest. Calls to a
  service it doesn't know return an error and are logged once.

Pages talk to the shell (launch another app, show a banner) through
`phoenixHost.postToHost(type, payload)`. In phoenix-sim that arrives as a
console message with the `__phoenix__` prefix.

The Settings app's services (Wi-Fi, Bluetooth, settings service, audio, ...)
are simulated in their own clearly marked block at the end of the runtime;
see [Settings](#settings) below. The media services (media indexer, camera,
media files) follow in another; see [Camera, Photos and Music](#camera-photos-and-music).

## Running apps

**In the simulator.** Build `phoenix-sim` with Qt WebEngine (Homebrew's `qt`
includes it; on Ubuntu install `qt6-webengine-dev qml6-module-qtwebengine`).
The apps then appear in the launcher and quick launch with their original
icons.

```sh
./build/phoenix-sim --launch com.palm.app.notes
```

Windows an app opens (`window.open`, `enyo.windows.activate`) become new cards
in that app's stack. Headless apps (`"noWindow": true` in `appinfo.json`, e.g.
Calendar, Clock, Email) run their main page invisibly, and each window they
open is a card, as on webOS.

**In a desktop browser.**

```sh
tools/serve-rootfs.py        # then open http://127.0.0.1:8765/
```

This serves the same filesystem and adds the runtime to every app page. It's
handy for debugging an app with the browser's developer tools.

**Automated check.** `node tools/test-apps.cjs [--tablet]` loads every app in
headless Chromium, follows the windows headless apps open, and fails if an app
marked as working in `tools/app-expectations.json` stops starting cleanly.
Screenshots go to `build/app-tests/`.

## On a device

`tools/install-rootfs.py DESTDIR` installs the same filesystem for an image:
apps under `/usr/palm/applications` (where webOS OSE's application manager
still looks for system apps), frameworks under `/usr/palm/frameworks`, the
runtime under `/usr/share/phoenix/runtime`, and each app's db8 kinds and
permissions under `/etc/palm/db`. Overlays are applied and app pages get the
runtime `<script>` tag. The `phoenix-apps` recipe in `meta-phoenix` runs it,
and `webos-phoenix-image` includes it. Built apps (`dist/`) must be built
before the recipe runs.

## Status of the original apps

See `tools/app-expectations.json` for the current list. Calculator, Clock and
Memos start cleanly; Accounts, Calendar, Contacts and Email need more of the
simulated services, and Contacts references two source files missing from the
Open webOS release.
Phoenix Settings (`org.webosphoenix.settings` and its launch points) starts
cleanly on phone and tablet; `node tools/test-settings.cjs [--tablet]` also
drives it (Wi-Fi, password, PIN, brightness, airplane mode, Bluetooth).
Phoenix Phone and Messaging start cleanly too, and
`node tools/test-phone-messaging.cjs [--tablet]` places, holds and ends a
call, answers and ignores simulated incoming calls, and sends and receives
texts.

Camera, Photos and Music start cleanly too, and `node tools/test-media.cjs
[--tablet]` drives them.

## Phoenix apps (React + TypeScript)

New Phoenix apps live in `apps/`, an npm workspace:

| Path | What |
| --- | --- |
| `apps/shared/luna` (`@phoenix/luna`) | Typed client for `PalmServiceBridge`: `call()` returns a promise, `subscribe()` a cancellable subscription, errors are `LunaError`s. `types.ts` types the OSE methods the apps use; `services.ts` wraps them (`wifi.connect()`, `bluetooth.pair()`, ...), each citing the OSE source it follows; `db8.ts` (`db.find/put/merge/watch`), `contacts.ts` (`com.palm.person:1`), `telephony.ts` and `messaging.ts` serve Phone and Messaging, `media.ts` Camera, Photos and Music; `@phoenix/luna/react` has `useLuna()` and `useLaunchParams()` |
| `apps/shared/phoenix-ui` (`@phoenix/ui`) | React components with the webOS 1.x/2.x look, drawn with the Enyo 1.0 "Heritage" artwork (copied into `assets/enyo`, see its `PROVENANCE.md`): `PageHeader`, `Group`, `Row`, `Divider`, `ToggleButton`, `Slider` (also as a progress/seek bar), `ListSelector`, `Picker`, `PopupMenu`, `Button`, `Drawer`, `DividerDrawer`, `Dialog`, `Spinner`, `TextField`; for Phone and Messaging the webOS dial pad (`Dialpad`, `DialButton`, `BackspaceButton`, from Enyo's `lib/telephony` art), the command menu (`ToolBar`, `RadioToolGroup`, `ToolButton`), `Avatar` and number / time formatting (`formatDuration` takes milliseconds); for the media apps `Toolbar`, `IconToolButton`, `GroupedToolButtons`, `Glyph` and `formatSeconds`; `BackProvider`/`useBack` for the back gesture |
| `apps/settings` | Settings (see below) |
| `apps/phone`, `apps/messaging` | Phone and Messaging (see below) |
| `apps/camera`, `apps/photos`, `apps/music` | Camera, Photos, Music (see [below](#camera-photos-and-music)); `@phoenix/luna`'s `media.ts` wraps their services |
| `apps/media-samples` | Generated demo photos and songs, mounted at `/media/internal/samples` |

Build (Node.js 20 or newer):

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

- `launcherTab`: 0 Apps (default), 1 Downloads, 2 Settings
- `hidden`: leave the app itself out of the launcher (its launch points stay)
- `quickLaunch`: put the app in this quick launch slot (1-4); Phone is 1 and
  Messaging 3 (Email 2 and Calendar 4 are set by title in `SimWindowSource`)
- `launchPoints`: extra launcher icons for the same app. Each is its own
  card and starts the app with `params` as its launch params
  (`PalmSystem.launchParams`, `?launchParams=` on the page URL). A web app
  whose title matches a placeholder (Wi-Fi, Bluetooth, ...) replaces it.

On OSE, the same launch points are registered with SAM
(`com.webos.applicationManager/addLaunchPoint`), and launch params arrive the
same way. When the shell launches an app that is already running with new
params, the page gets OSE's `webOSRelaunch` document event
(`__phoenixRuntime.relaunch()` in the simulator); `useLaunchParams()` handles
both. A `launch` host message (`applicationManager/launch {id, params}`) whose
params match a launch point opens that launch point's card.

## Settings

`apps/settings` is one app with one launch point per pane, like the separate
preference apps of webOS 2.x: Wi-Fi, Bluetooth, Airplane Mode, Screen & Lock,
Sounds & Ringtones, Date & Time, Language & Region, Device Info, Updates.
Launched without a page it lists them all. The launcher icons are drawn by
`apps/settings/tools/render-icons.cjs` and the wallpapers by
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
| Screen & Lock (PIN) | `com.palm.systemmanager` `getDeviceLockMode`, `setDevicePasscode`, `matchDevicePasscode`: the legacy webOS API; OSE has none, so Phoenix will have to provide it | `openwebos/luna-sysmgr` `Src/base/SystemService.cpp` |
| Sounds | `com.webos.service.audio` `master/getVolume`, `master/setVolume`, `master/muteVolume`, `getInputVolume` / `setInputVolume` (`streamType` `pringtones`, `palerts`, `pmedia`), `playFeedback`; system service `ringtone`, `systemSounds` | `audiod-pro` `src/modules/masterVolumeManager`, `audioPolicyManager`, `systemSoundsManager` |
| Date & Time | system service `get/setPreferences` (`timeFormat`, `useNetworkTime`, `useNetworkTimeZone`, `timeZone`), `getPreferenceValues {key: "timeZone"}`, `time/getSystemTime`, `time/setSystemTime {utc}` | `luna-sysservice` `Src/TimePrefsHandler.cpp` |
| Language & Region | `com.webos.settingsservice` `get/setSystemSettings {keys: ["localeInfo"]}` (`locales.UI`, `locales.FMT`) | `settingsservice` |
| Device Info | system service `deviceInfo/query`, `osInfo/query`; `com.palm.power` `batteryStatusQuery` (legacy); settings service `resetSystemSettings`; `org.webosphoenix.service.reset/eraseUserData` (Phoenix, simulator only so far) | `luna-sysservice` `Src/DeviceInfoService.cpp`, `OsInfoService.cpp` |

The simulated services keep their state in the runtime's store (shared by
every app window, persistent across restarts) and have a few simulated
networks and devices. Passwords that work: `Phoenix` = `phoenix123`,
`Lab 5G` = `webos2009`, `Neighbor` = `12345`.

### The shell in the simulator

Settings and the status bar stay in step:

1. Whenever a radio, airplane mode, brightness, mute, rotation lock or the
   wallpaper changes, and when a page starts, the runtime posts
   `systemStatus` (`wifiEnabled`, `wifiConnected`, `wifiBars`, `bluetoothOn`,
   `airplaneMode`, `brightness` 0-100, `rotationLocked`, `muted`,
   `wallpaperFile`).
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
  contacts by name or number, and a transport picker in which only SMS is
  available (AIM, Google Talk, Yahoo!, Skype are listed as unavailable, as
  is the Buddies view). Tablet: conversations on the left, the
  conversation on the right.

Launch params: Phone `{number}` fills in the dial pad; Messaging
`{threadId}` opens a conversation, `{to, name}` starts a message.

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
