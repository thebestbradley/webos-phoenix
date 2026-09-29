# Web app runtime

Phoenix runs web apps: the original Open webOS apps (Enyo 1.0, 2011–2012)
and new Phoenix apps (Settings, Camera, Photos, Music, Tasks, ...). This page explains how they run
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
  focus-on-tap), card activation (`Mojo.stageActivated`), cross-app window
  params, and aliases for the Prelude font.

Pages talk to the shell (launch another app, show a banner) through
`phoenixHost.postToHost(type, payload)`. In phoenix-sim that arrives as a
console message with the `__phoenix__` prefix.

The Settings app's services (Wi-Fi, Bluetooth, settings service, audio, ...)
are simulated in their own clearly marked block at the end of the runtime;
see [Settings](#settings) below. The media services (media indexer, camera,
media files) follow in another; see [Camera, Photos and Music](#camera-photos-and-music).
Then come, each in its own block: the file manager service and the legacy
app installer used by Files (see [Files](#files)); the activity manager
(`com.palm.activitymanager`) and `com.palm.power` timeouts, which fire
scheduled activities such as Tasks' reminders (see [Tasks](#tasks)); the
speech-to-text service of Voice Memos (see [Voice Memos](#voice-memos));
HTTP, the download manager and audio focus for the reading and listening
apps (see [Videos, Podcasts, PDF View and Doc View](#videos-podcasts-pdf-view-and-doc-view));
and last the CardDAV and CalDAV account's transport (see
[CardDAV and CalDAV](#carddav-and-caldav)).

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
  shell last reported (`orientation` in `applyHostStatus`).

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
applied and app pages get the runtime `<script>` tag. The `phoenix-apps` recipe in `meta-phoenix` runs it,
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

Phoenix Settings (`org.webosphoenix.settings` and its launch points) starts
cleanly on phone and tablet; `node tools/test-settings.cjs [--tablet]` also
drives it (Wi-Fi, password, PIN, brightness, airplane mode, Bluetooth).
Phoenix Phone and Messaging start cleanly too, and
`node tools/test-phone-messaging.cjs [--tablet]` places, holds and ends a
call, answers and ignores simulated incoming calls, and sends and receives
texts.

Camera, Photos and Music start cleanly too, and `node tools/test-media.cjs
[--tablet]` drives them. So does Files, driven by `node tools/test-files.cjs
[--tablet]`, and Tasks, driven by `node tools/test-tasks.cjs [--tablet]`.

[--tablet]`, and Voice Memos, driven by `node tools/test-voicememos.cjs
[--tablet]`.

## Phoenix apps (React + TypeScript)

New Phoenix apps live in `apps/`, an npm workspace:

| Path | What |
| --- | --- |
| `apps/shared/luna` (`@phoenix/luna`) | Typed client for `PalmServiceBridge`: `call()` returns a promise, `subscribe()` a cancellable subscription, errors are `LunaError`s. `types.ts` types the OSE methods the apps use; `services.ts` wraps them (`wifi.connect()`, `bluetooth.pair()`, ...), each citing the OSE source it follows; `db8.ts` (`db.find/put/merge/watch`), `contacts.ts` (`com.palm.person:1`), `telephony.ts` and `messaging.ts` serve Phone and Messaging, `media.ts` Camera, Photos and Music, `files.ts` Files (`fileManager`, `appInstaller`, `openWith`, path and size helpers), `tasks.ts` Tasks (`com.palm.task:1`, `com.palm.tasklist:1`, reminder activities, `postNotification`); `@phoenix/luna/react` has `useLuna()` and `useLaunchParams()` |

| `apps/shared/luna` (`@phoenix/luna`) | Typed client for `PalmServiceBridge`: `call()` returns a promise, `subscribe()` a cancellable subscription, errors are `LunaError`s. `types.ts` types the OSE methods the apps use; `services.ts` wraps them (`wifi.connect()`, `bluetooth.pair()`, ...), each citing the OSE source it follows; `db8.ts` (`db.find/put/merge/watch`), `contacts.ts` (`com.palm.person:1`), `telephony.ts` and `messaging.ts` serve Phone and Messaging, `media.ts` Camera, Photos and Music, `files.ts` Files (`fileManager`, `appInstaller`, `openWith`, path and size helpers), `transcriber.ts` Voice Memos (`transcriber.transcribe()` with progress, `TRANSCRIBE_ERRORS`); `@phoenix/luna/react` has `useLuna()` and `useLaunchParams()` |
| `apps/shared/phoenix-ui` (`@phoenix/ui`) | React components with the webOS 1.x/2.x look, drawn with the Enyo 1.0 "Heritage" artwork (copied into `assets/enyo`, see its `PROVENANCE.md`): `PageHeader`, `Group`, `Row`, `Divider`, `ToggleButton`, `Slider` (also as a progress/seek bar), `ListSelector`, `Picker`, `PopupMenu`, `Button`, `Drawer`, `DividerDrawer`, `Dialog`, `Spinner`, `TextField`; for Phone and Messaging the webOS dial pad (`Dialpad`, `DialButton`, `BackspaceButton`, from Enyo's `lib/telephony` art), the command menu (`ToolBar`, `RadioToolGroup`, `ToolButton`), `Avatar` and number / time formatting (`formatDuration` takes milliseconds); for the media apps `Toolbar`, `IconToolButton`, `GroupedToolButtons`, `Glyph` and `formatSeconds`; for Files `CheckBox` (Heritage `checkbox.png`) and file glyphs (copy, cut, paste, new folder, ...); `BackProvider`/`useBack` for the back gesture |
| `apps/settings` | Settings (see below) |
| `apps/phone`, `apps/messaging` | Phone and Messaging (see below) |
| `apps/camera`, `apps/photos`, `apps/music` | Camera, Photos, Music (see [below](#camera-photos-and-music)); `@phoenix/luna`'s `media.ts` wraps their services |
| `apps/media-samples` | Generated demo photos and songs, mounted at `/media/internal/samples` |
| `apps/files` | Files (see [below](#files)); `apps/files/service` is its Node.js Luna service for the device |
| `apps/tasks` | Tasks (see [below](#tasks)) |

| `apps/voicememos` | Voice Memos (see [below](#voice-memos)); `apps/voicememos/service` is its speech-to-text Luna service (whisper.cpp) for the device |
| `apps/videos`, `apps/podcasts`, `apps/pdfview`, `apps/docview` | Videos, Podcasts, PDF View and Doc View (see [below](#videos-podcasts-pdf-view-and-doc-view)); `@phoenix/luna`'s `web.ts` (HTTP, download manager), `playback.ts` (audio focus, `nowPlaying`, orientation) and `documents.ts` (launch targets, reading files, finding documents) serve them |

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

Icons: `icon.png` is 64 px; ship `icon-256x256.png` too and name it as
`"splashicon"`, as the Open webOS apps did, and the shell draws it on dense
screens and on the loading card (a launch point's `icons/name.png` gets
`icons/name-256x256.png`). The apps' `tools/render-icon*.cjs` write both
(docs/spec/hidpi-art.md).

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
`phoenix://` pages fetch directly, so there only feeds and servers that
send CORS headers can be reached. Downloads go into the media block's
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
`POST /__phoenix/proxy`; phoenix-sim's pages call the server directly, which
only works with servers that send CORS headers (SYNERGY.md section 3.6 has a
Radicale configuration). `__phoenixRuntime.dav.sync(accountId)` syncs from a
test or the console.

`node tools/test-dav-sync.cjs [--tablet]` starts Radicale (`pip install
radicale`), adds the account in the original Accounts app, and checks sync
both ways against db8, Contacts and Calendar; screenshots go to
`build/dav-tests/`. The device service's tests (`apps/dav/service/*.test.ts`)
run with `npm test`.
