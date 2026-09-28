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
  search index properties), system service (time, preferences), application
  manager (launch, open), connection manager, power, and harmless stubs for
  the rest. Calls to a service it doesn't know return an error and are logged
  once. For the core apps it also simulates, modelled on
  `third_party/app-services`:
  - **accounts** (`com.palm.service.accounts`): accounts in db8, the account
    templates released with Open webOS (HP webOS profile, IMAP/POP/email)
    read from `/usr/palm/public/accounts/`, credentials; the HP webOS
    Account server returns the sample owner. Phoenix's CardDAV & CalDAV
    template and its transport are added by the last block (see
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
  focus-on-tap), card activation (`Mojo.stageActivated`), cross-app window
  params, and aliases for the Prelude font.

Pages talk to the shell (launch another app, show a banner) through
`phoenixHost.postToHost(type, payload)`. In phoenix-sim that arrives as a
console message with the `__phoenix__` prefix.

The Settings app's services (Wi-Fi, Bluetooth, settings service, audio, ...)
are simulated in their own clearly marked block at the end of the runtime;
see [Settings](#settings) below. The media services (media indexer, camera,
media files) follow in another; see [Camera, Photos and Music](#camera-photos-and-music).
Then come the file manager service and the legacy app installer used by
Files; see [Files](#files). The last block runs the CardDAV and CalDAV
account's transport; see [CardDAV and CalDAV](#carddav-and-caldav).

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
`node tools/smoke-apps.cjs [--tablet]` then uses each core app (12×3 in
Calculator, a new memo, an alarm, opening and adding a contact and a calendar
event, reading and sending an email, the account settings) and checks the
result. Screenshots of both go to `build/app-tests/`.

phoenix-sim keeps its web storage (and so the sample data) in its Qt
WebEngine profile, `~/.local/share/phoenix-sim/`. Delete it, or point
`XDG_DATA_HOME` elsewhere, to start from fresh sample data.

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

## On a device

`tools/install-rootfs.py DESTDIR` installs the same filesystem for an image:
apps under `/usr/palm/applications` (where webOS OSE's application manager
still looks for system apps), frameworks under `/usr/palm/frameworks`, the
runtime under `/usr/share/phoenix/runtime`, and each app's db8 kinds and
permissions under `/etc/palm/db`. An app's Node.js Luna service
(`apps/<app>/service`, e.g. Files') goes to `/usr/palm/services/<service id>`,
where `run-js-service` starts it, and its `sysbus/` role, permission, groups,
manifest and service files to `/usr/share/luna-service2/*.d`. Overlays are
applied and app pages get the runtime `<script>` tag. The `phoenix-apps` recipe in `meta-phoenix` runs it,
and `webos-phoenix-image` includes it. Built apps (`dist/`) must be built
before the recipe runs.

## Status of the original apps

See `tools/app-expectations.json` for the current list.
All seven start cleanly and are usable on phone and tablet
(`tools/app-expectations.json` has per-app notes). What is still missing:

- **Servers**: contacts and calendars sync with a CardDAV & CalDAV account
  (below); there is no mail server, so email accounts cannot be signed in.
- **Background services**: alarms and calendar reminders are stored but never
  fire (no activity manager); no dashboards or banners from them.
- **Contacts**: contacts are linked into people only when a CardDAV sync
  adds them (the linker's strongest rules); no photos for local contacts, no
  vCard import/export.
- The Contacts and Accounts sources listed in `depends.js` but missing from the
  Open webOS release (`Ringtones.js`, `NameDetails.js`, `FirstLaunch.js`) are
  empty stand-ins; nothing in the released apps uses them.

Phoenix Settings (`org.webosphoenix.settings` and its launch points) starts
cleanly on phone and tablet; `node tools/test-settings.cjs [--tablet]` also
drives it (Wi-Fi, password, PIN, brightness, airplane mode, Bluetooth).
Phoenix Phone and Messaging start cleanly too, and
`node tools/test-phone-messaging.cjs [--tablet]` places, holds and ends a
call, answers and ignores simulated incoming calls, and sends and receives
texts.

Camera, Photos and Music start cleanly too, and `node tools/test-media.cjs
[--tablet]` drives them. So does Files, driven by `node tools/test-files.cjs
[--tablet]`.

## Phoenix apps (React + TypeScript)

New Phoenix apps live in `apps/`, an npm workspace:

| Path | What |
| --- | --- |
| `apps/shared/luna` (`@phoenix/luna`) | Typed client for `PalmServiceBridge`: `call()` returns a promise, `subscribe()` a cancellable subscription, errors are `LunaError`s. `types.ts` types the OSE methods the apps use; `services.ts` wraps them (`wifi.connect()`, `bluetooth.pair()`, ...), each citing the OSE source it follows; `db8.ts` (`db.find/put/merge/watch`), `contacts.ts` (`com.palm.person:1`), `telephony.ts` and `messaging.ts` serve Phone and Messaging, `media.ts` Camera, Photos and Music, `files.ts` Files (`fileManager`, `appInstaller`, `openWith`, path and size helpers); `@phoenix/luna/react` has `useLuna()` and `useLaunchParams()` |
| `apps/shared/phoenix-ui` (`@phoenix/ui`) | React components with the webOS 1.x/2.x look, drawn with the Enyo 1.0 "Heritage" artwork (copied into `assets/enyo`, see its `PROVENANCE.md`): `PageHeader`, `Group`, `Row`, `Divider`, `ToggleButton`, `Slider` (also as a progress/seek bar), `ListSelector`, `Picker`, `PopupMenu`, `Button`, `Drawer`, `DividerDrawer`, `Dialog`, `Spinner`, `TextField`; for Phone and Messaging the webOS dial pad (`Dialpad`, `DialButton`, `BackspaceButton`, from Enyo's `lib/telephony` art), the command menu (`ToolBar`, `RadioToolGroup`, `ToolButton`), `Avatar` and number / time formatting (`formatDuration` takes milliseconds); for the media apps `Toolbar`, `IconToolButton`, `GroupedToolButtons`, `Glyph` and `formatSeconds`; for Files `CheckBox` (Heritage `checkbox.png`) and file glyphs (copy, cut, paste, new folder, ...); `BackProvider`/`useBack` for the back gesture |
| `apps/settings` | Settings (see below) |
| `apps/phone`, `apps/messaging` | Phone and Messaging (see below) |
| `apps/camera`, `apps/photos`, `apps/music` | Camera, Photos, Music (see [below](#camera-photos-and-music)); `@phoenix/luna`'s `media.ts` wraps their services |
| `apps/media-samples` | Generated demo photos and songs, mounted at `/media/internal/samples` |
| `apps/files` | Files (see [below](#files)); `apps/files/service` is its Node.js Luna service for the device |
| `apps/dav` | The CardDAV & CalDAV account (see [below](#carddav-and-caldav)): a hidden Enyo 1.0 app with the account's sign-in page, its db8 kinds and account template, and `apps/dav/service`, its Node.js Luna service and sync engine |

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

Links for other apps (`mailto:`, `tel:`, `sms:`) go to them through
`/usr/palm/command-resource-handlers.json` (a compat file), as the
application manager's `open` does on webOS. `tools/test-browser.cjs` browses
with it end to end. On a device, OSE's WebAppMgr has no BrowserAdapter, so
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
| Install a package | `com.palm.appinstaller` `installNoVerify {target, subscribe}` -> `{ticket, status}`: `STARTING`, `IPKG_INSTALL`, then `SUCCESS` or `FAILED_*` | legacy webOS (as Preware-era file managers called it); OSE's installer is `com.webos.appInstallService`, not yet wired |
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

### In the simulator

The block "CardDAV and CalDAV" at the end of `runtime/phoenix-runtime.js`
loads the service's own modules into the page (from
`/usr/palm/applications/org.webosphoenix.dav/service/`) and registers them on
the simulated bus, so the simulator runs the device's code. It adds the
template to the simulated accounts service and calls the transport as the
real accounts service does (onCreate and onEnabled after createAccount,
onEnabled on capability changes, onCredentialsChanged, onEnabled(false) and
onDelete before deleteAccount), runs "Sync now" activities (Contacts and
Calendar create them) at once, and registers the kinds. Scheduled
activities do not run: sync happens when the account is created or enabled,
and on "Sync now". One sync runs at a time per account across all pages.

HTTP needs a way past the browser's same-origin rule: pages served over HTTP
(`tools/serve-rootfs.py`, the tests) send requests through the server's
`POST /__phoenix/proxy`; phoenix-sim's pages call the server directly, which
only works with servers that send CORS headers (SYNERGY.md section 3.6 has a
Radicale configuration). `__phoenixRuntime.dav.sync(accountId)` syncs from a
test or the console.

`node tools/test-dav-sync.cjs [--tablet]` starts Radicale (`pip install
radicale`), adds the account in the original Accounts app, and checks sync
both ways against db8, Contacts and Calendar; screenshots go to
`build/dav-tests/`. The device service's tests (`apps/dav/service/*.test.ts`)
run with `npm test`.
