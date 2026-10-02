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
  focus-on-tap), card activation (`Mojo.stageActivated`; in phoenix-sim the
  shell also says when a card gains or leaves the front, as a
  `phoenixcardactivation` event with `{active}`, because a card minimized to
  card view stays visible), cross-app window params, and aliases for the
  Prelude font.

Pages talk to the shell (launch another app, show a banner) through
`phoenixHost.postToHost(type, payload)`. In phoenix-sim that arrives as a
console message with the `__phoenix__` prefix.

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

| `apps/shared/luna` (`@phoenix/luna`) | Typed client for `PalmServiceBridge`: `call()` returns a promise, `subscribe()` a cancellable subscription, errors are `LunaError`s. `types.ts` types the OSE methods the apps use; `services.ts` wraps them (`wifi.connect()`, `bluetooth.pair()`, ...), each citing the OSE source it follows; `db8.ts` (`db.find/put/merge/watch`), `contacts.ts` (`com.palm.person:1`), `telephony.ts` and `messaging.ts` serve Phone and Messaging, `media.ts` Camera, Photos and Music, `files.ts` Files (`fileManager`, `appInstaller`, `openWith`, path and size helpers), `transcriber.ts` Voice Memos (`transcriber.transcribe()` with progress, `TRANSCRIBE_ERRORS`), `location.ts` the location service and per-app permissions (`location`, `locationPermissions`, `LOCATION_ERRORS`), `setup.ts` First Use, the medical ID, accessibility and the emergency numbers (`firstUse`, `emergencyInfo`, `accessibility`, `isEmergencyNumber`); `vpn.ts` the VPN service (`vpn`, file import helpers), `backup.ts` the backup service (`backup`, `BACKUP_PARTS`); `@phoenix/luna/react` has `useLuna()` and `useLaunchParams()` |
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
Sounds & Ringtones, Date & Time, Language & Region, Accessibility, Location
Services, Emergency Info, Device Info, Backup, Updates, VPN, Developer Mode.
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
| Sounds | `com.webos.service.audio` `master/getVolume`, `master/setVolume`, `master/muteVolume`, `getInputVolume` / `setInputVolume` (`streamType` `pringtones`, `palerts`, `pfeedback`, `pmedia`), `playFeedback`, `playSound`, `controlPlayback`; system service `ringtone`, `systemSounds`, `x_palm_virtualkeyboard_prefs` (`TapSounds`: Keyboard clicks), `ringtone/listRingtones` | `audiod-pro` `src/modules/masterVolumeManager`, `audioPolicyManager`, `systemSoundsManager` |
| Date & Time | system service `get/setPreferences` (`timeFormat`, `useNetworkTime`, `useNetworkTimeZone`, `timeZone`), `getPreferenceValues {key: "timeZone"}`, `time/getSystemTime`, `time/setSystemTime {utc}` | `luna-sysservice` `Src/TimePrefsHandler.cpp` |
| Language & Region | `com.webos.settingsservice` `get/setSystemSettings {keys: ["localeInfo"]}` (`locales.UI`, `locales.FMT`) | `settingsservice` |
| Device Info | system service `deviceInfo/query`, `osInfo/query`; `com.palm.power` `batteryStatusQuery` (legacy); `com.palm.telephony` `platformQuery` (IMEI/MEID, carrier), `subscriberIdQuery` (`msisdn`: the phone number), `simStatusQuery`, `networkStatusQuery`; settings service `resetSystemSettings`; `org.webosphoenix.service.reset` `eraseUserData` (apps' data and settings; the user's files on the USB drive are kept, as legacy webOS's "Erase Apps & Data") and `fullErase` (everything, files too) (Phoenix, simulator only so far); "Help and tips" and "Run setup again" launch Help and First Use (`{rerun: true}`) | `luna-sysservice` `Src/DeviceInfoService.cpp`, `OsInfoService.cpp` |
| Backup | `org.webosphoenix.service.backup` `getStatus`, `configure`, `backupNow`, `listBackups`, `inspect`, `restore`, `deleteBackup` | see [Backup](#backup) |
| Accessibility | system service `get/setPreferences` `accessibility {reduceMotion, highContrast, monoAudio, captions}` (Phoenix key) | `luna-sysservice` `Src/PrefsFactory.cpp` (stores any key) |
| Location Services | `com.webos.service.location` `getAllLocationHandlers`, `setState {Handler, state}`, `getLocationUpdates`, `getReverseLocation`; `org.webosphoenix.service.location` `getPermissions`, `setPermission`, `removePermission` (Phoenix) | see [Location](#location) |
| Emergency Info | system service `get/setPreferences` `emergencyInfo` (Phoenix key); contacts from db8 `com.palm.person:1` | see [Emergency information](#emergency-information) |
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
  `http://127.0.0.1:8088/v1/`, `server/marketplace/bin/serve.sh`), the
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
opt-outs for the curated web apps, and publishing the signed index (its
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

### Developer Mode

Settings > Developer Mode (the last pane, under Advanced) turns on what
ordinary apps may not do: packages that run install scripts, have
background services or put files outside their app, and later the
Terminal's sudo and SSH ([TERMINAL.md](TERMINAL.md) T4). Turning it on
shows what it allows and asks for the device PIN or password
(`matchDevicePasscode`); with no secure unlock set it asks for one first
and offers Screen & Lock. Turning it off asks nothing. The state is OSE's
`com.webos.service.devmode` (`getDevMode`, `setDevMode`); erasing the
device turns it off.

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
or reloads the page under `tools/serve-rootfs.py`. Tests:
`services/updates/updatesservice.test.ts` (with a stand-in for RAUC's command
line), `server/updates/tests/run.php`, `tools/test-updates.cjs`.

## Ongoing activities

Work going on in the background, such as a download or an install, is an
ongoing activity: a row in the notification area with its progress that
cannot be swiped away and goes when the work ends. A tap opens its app with
its params. It is the shell's API:

- `luna://org.webosphoenix.ongoing/set {id, appId?, title, body?, icon?, progress (0-100, -1: none), params?}`
- `luna://org.webosphoenix.ongoing/clear {id}`

System updates (`com.palm.update`) and Marketplace installs use it. They are
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

