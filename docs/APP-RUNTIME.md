# Web app runtime

Phoenix runs web apps: the original Open webOS apps (Enyo 1.0, 2011–2012)
and new Phoenix apps (Settings, Phone, ...). This page explains how they run
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
    Account server returns the sample owner.
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

## Status of the original apps

All seven start cleanly and are usable on phone and tablet
(`tools/app-expectations.json` has per-app notes). What is still missing:

- **Servers**: no mail, contacts or calendar sync; new accounts cannot be
  signed in (nothing to validate credentials against).
- **Background services**: alarms and calendar reminders are stored but never
  fire (no activity manager); no dashboards or banners from them.
- **Contacts**: no automatic linking of similar contacts, photos, or vCard
  import/export.
- The Contacts and Accounts sources listed in `depends.js` but missing from the
  Open webOS release (`Ringtones.js`, `NameDetails.js`, `FirstLaunch.js`) are
  empty stand-ins; nothing in the released apps uses them.
