# The simulator is not kinder than a device

The owner, 28 November 2026: when tests, reviews or device runs turn up how
a device behaves, the simulator (the runtime's simulated Luna services in
`runtime/phoenix-runtime.js`, `shell/qml/Phoenix/Sim`, `shell/sim`,
`services/nova/sim.js`) should behave the same, so a bug shows in the
simulator first. This page is the audit of the pull requests merged to
`main` from 14 to 28 November 2026 that changed what a device does, what
the simulator does for each today, and what was fixed or is left.

`tools/test-sim-parity.cjs` checks the runtime's side of the fixes below
(headless Chromium over `tools/serve-rootfs.py`); `tools/nova/nova.test.ts`
("nova -d sim") the simulator's novad.

## The audit

"Gap" means the simulator was kinder (or simply different) in a way a
device run could find and the simulator would not. File:line references are
to this branch.

| PR | Device behaviour | Simulator today | Gap | Fix |
|---|---|---|---|---|
| #86 dev push P3b | novad's `authorizedKeys()` makes `~/.ssh` 0700 and `authorized_keys` 0600, owned by the home's uid; no home, no account, nothing written (`services/nova/novaservice.js:726`) | `services/nova/sim.js` runs the same code over the simulator's data folder, but the folder had no `/home/user`, so pairing wrote nothing and the code never ran | yes | **Fixed**: sim.js makes `<data>/home/user` as the image's useradd does (`services/nova/sim.js:165`; phoenix-pty_git.bb:32). Test: nova.test.ts "nova -d sim" checks the file, 0700/0600 and the owner |
| #86 | The USB debugging link (`lib/usblink.js`): a failed `phoenix-usb-debug up` is tried again at each follow, logged once | sim.js's `run()` answers every command with success (`services/nova/sim.js:173`); the simulator has no USB gadget and nova reaches it over the loopback | no (nothing in the UI shows the link's state) | Follow-up: if Settings ever shows the link's state, make sim.js's `run()` able to fail `phoenix-usb-debug` (a sim key) so the retry path shows |
| #81 devmode both forms | `getDevMode` and `setDevMode` answer `{status, enabled}` (`services/devmode/devmode.js` `answer()`); `setDevMode` takes `{status}` or OSE's `{enabled}` | answered `{status}` only and refused `{enabled}` | yes | **Fixed** (`runtime/phoenix-runtime.js:8181-8203`). Test: test-sim-parity.cjs 1 |
| #79 / #80 devmode provider | A set to the current value changes nothing and says `{restarting: false}`; a change says `{restarting: true}` and **restarts the device** a second later (`services/devmode/service.js:46`) | told every watcher on any set, never said `restarting`; applies the change at once without a restart | partly | **Fixed**: no-op sets, `restarting` (same lines). **Follow-up**: restart the simulator on a change (the runtime's `machineReboot` path, `runtime/phoenix-runtime.js:17043`); it touches about 15 web tests that turn Developer Mode on and go on in the same page |
| #91 brightness/volume | audiod-pro refuses `master/getVolume {soundOutput: "alsa"}` with error 204 (`shell/qml/Phoenix/Lsm/LsmStatus.js:148`) | answered it | yes | **Fixed**: refused with 204, `{}` answers, `setVolume` still takes `alsa` (`runtime/phoenix-runtime.js:7541`). Test: test-sim-parity.cjs 2 |
| #91 / #94 / #105 settingsservice | OSE's settingsservice answers `{returnValue: false, errorKey}` for keys none of which is set, and subscribes nothing (`LsmStatus.js:185`, `backlightUnset`) | answered `{settings: {}}` and subscribed | yes | **Fixed** for that case (`runtime/phoenix-runtime.js:7489`). Test: test-sim-parity.cjs 3. `picture.backlight` keeps its default (70): the device's shell seeds it at boot (`LsmSystemStatus.qml:158`) |
| #91 / #94 / #105 | Partly found keys: a subscription only for the keys found; a set of a key with no description in settingsservice's db8 store fails with errorKey (phoenix-settingsservice-conf.bb:32) | subscribes for every key asked; any key is set | yes | **Follow-up (device first)**: `measurementUnits` (Settings > Language & Region > Units, `apps/shared/luna/src/units.ts`) has no description in `phoenix.description.json`, so on a device its set may fail and its watchers may never hear it. Local should check on an image (`luna-send` set and get of `measurementUnits`) before the simulator copies it; Settings' Language page watches it alone and now gets errorKey in the simulator until it is set, as a device would |
| #91 | Range checks: `picture.backlight` described 0-100, `valueCheck: true` | any value kept | small | Follow-up with the descriptions above (one table of described keys both sides read) |
| #108 developer apps | searchApps / listLaunchPoints leave developer apps out while Developer Mode is off; the shell's launcher follows `getDevMode {subscribe}` | the device was made to match the simulator (`runtime/phoenix-runtime.js:2850`) | no | none |
| #92 resource-info | `getResourceInfo` falls back to the scheme's handler | the same PR changed the runtime (`runtime/phoenix-runtime.js:11686`) | no | none |
| #86 rescan | `rescan` answers NO_RESCAN without SAM's scanApp | the runtime's `rescan` (`runtime/phoenix-runtime.js:2993`) always reads the apps again | no (the simulator's application manager is Phoenix's own, like webOS-ports' SAM) | none |
| #95 / #101 boot app restart | memorymanager closes `com.palm.systemui` under memory pressure; the shell starts it again 5 s later, once a minute, a close inside the guard retried | the simulator has no memory manager: nothing ever closes the boot app (`shell/qml/Phoenix/Sim/SimWindowSource.qml:1656`) | yes | **Follow-up**: a simulator key or `--scene` that closes the boot apps as memorymanager does, and SimWindowSource starting them again with the same guard as LsmWindowSource, so the recovery is seen before an image |
| #102 / #106 / #94 / #100 ls-hubd permissions | ls-hubd refuses a call whose method is in no group the caller holds (api.json, groups.json, `compat/app-permissions.json`, roles' outbound lists): sign-in frames, settingsservice's *Priv methods, the activity manager's replies | the runtime checked no permission: any page could call any method | yes, the largest | **Fixed**: the runtime refuses what ls-hubd would, with luna-service2's answer ([Bus permissions](#bus-permissions) below). Test: test-sim-permissions.cjs |
| #89 assistant caller | the shell's calls come as `com.webos.surfacemanager`, the caller from webos-service's sender | the simulator's shell calls as `com.palm.systemui` | no (a name; the Assistant accepts both, `apps/assistant/service/service.js:73`) | none |
| #74 web inspector | port 9998 only in Developer Mode, bound to 127.0.0.1 | phoenix-sim opens no remote debugging port | no | none |
| #97 / #93 / #103 location | the location service takes the account's relayed position, else the town; geoclue off | the runtime's location service (`runtime/phoenix-runtime.js:22078`) has its own positions | not audited further | The account side is another task's files (services/account); left to it |
| #85 registration 422 | the account service's registration | the same PR changed the runtime | no | none (services/account is another task's) |
| #99 RAUC OTA | A/B slots, bundles | the runtime's updates have slots (`runtime/phoenix-runtime.js:16860`) | not in scope | none |
| #84, #83, #82, #87, #90, #67, #103 | image build, packages, units, GPU, memory, zram | no simulator counterpart | no | none |
| #59, #60, #69, #71 | shared shell QML and the runtime itself | the same code | no | none |

## Follow-ups, in order of what they would catch

1. ~~**Permissions in the simulator** (#102, #106, #94, #100)~~: done,
   [Bus permissions](#bus-permissions). What it left open is in
   `tools/devicecheck/sim-bus-allowlist.json` (the connectors' account
   reads wait on the owner).
2. **Developer Mode restarts the simulator** (#79, #80), as the device's
   provider restarts the device.
3. **settingsservice's descriptions** (#94, #105): one table of described
   keys (`phoenix.description.json`), with ranges, that the simulator
   checks sets against and subscribes by; `measurementUnits` checked on an
   image first.
4. **Memory pressure closing the boot apps** (#95, #101): a simulator key.
5. **A failing USB link** (#86), if its state is ever shown.

## Bus permissions

Follow-up 1, done (#94, #100, #102, #106; the frames of #116). The runtime
checks every call a page makes (`PalmServiceBridge`) or a Phoenix service
running in the page makes (`nodeServiceLuna(name)`) as ls-hubd does, and
answers a refusal as luna-service2 does:

| Device (luna-service2 at the commit `ose-services.json` was read from, 5bc38aa) | Simulator |
|---|---|
| The method's api groups against the caller's: `LSCategoryMethodCall` returns `LSMessageHandlerResultPermissionDenied` (`src/libluna-service2/base.c:536-557`), the transport replies "Denied method call" (`transport.c:1840-1845`), the caller's callmap makes it `{"returnValue":false,"errorCode":-1,"errorText":"Denied method call \"<method>\" for category \"<category>\""}` (`callmap.c:540-590`) | the same answer, and the service never runs |
| A method no api group names has an empty mask: `_LSSecurityCheckGroup` (`base.c:370-388`) passes no one | refused the same way |
| A service calling outside its role's `outbound` list: the hub refuses the name, `"Not permitted to send to <service>."` (`callmap.c:940-949`) | the same |
| A frame of an app's card calls with the card's app's name (WebAppMgr's bridge; Accounts' sign-in pages, docs/DEVICE-AUDIT.md) | the caller is the top card's app (`busPageCaller`) |
| A page's legacy names reach the hub renamed (the runtime's `serviceAliases`); a service's do not | the same |

One model, so the simulator and the static checker cannot disagree:
`tools/devicecheck/luna.py` `model()` is what `tools/check-luna.py` checks
the code against, and `bus_table()` writes it as the table the runtime
reads (`tools/gen-bus-permissions.py`, `tools/devicecheck/bus-permissions.json`,
checked by `tools/ci-checks.sh` and `tools/test-devicecheck.py`). Apps and
services are apart in it (an app's pages are `<id>-*` on the bus; the
Clipboard app and the clipboard service share an id). OSE's own services
call with their perm files' groups. Not checked: services with no api file
(the simulator's own), and a service the table does not know (a test's,
a package installed since: its perm files are not read).

The simulator's own services had called as the page that ran them; they now
call as the service a device runs: the Marketplace's packages service, the
DAV service, the hardware and updates services, OSE's installer, the
accounts service's capability callbacks (`onCreate`, `onEnabled`, ...,
app-services' `notify-created.js`) and a connector's own outbox watch.

`PHOENIX_BUS_PERMISSIONS=log` (phoenix-sim, `tools/serve-rootfs.py`) only
warns; `PHOENIX_BUS_LOG=FILE` has serve-rootfs.py write each refusal with
the stack that made it. A test's own probe calls, made in an app's page to
drive a service, are not the app's: such a test gives that app the groups
it needs through `--host-json '{"busGrants": {"<app id>": [...]}}'`,
beside the calls.

### What the web tests found, and how each was resolved

A run of every web test in log-only mode (`PHOENIX_BUS_PERMISSIONS=log
PHOENIX_BUS_LOG=...`), then with the refusals on. Each refusal's stack said
whose code made it.

Fixed in the apps (their `requiredPermissions`, or
`compat/app-permissions.json` for the originals):

- **Accounts, Calendar, Contacts, the launcher, the system UI**: the
  temp db (`tempdatabase.operation`): Enyo 1.0's accounts library watches
  `com.palm.account.syncstate:1` and `com.palm.signaling:1` there
  (`lib/accounts/source/accounts-list.js:50`, `get-templates.js:28`).
  Without it Accounts launched with `{templateId}` never framed the
  template's sign-in page. Calendar, Contacts and the launcher also list the
  templates (`phoenix.accounts.list`); Calendar reads preferences and time
  (`systemsettings.query`, `time.query`); Contacts imports vCards
  (`phoenix.appservices.contacts`, `app/utils/VCardHelper.js`) and touches
  the file cache (`filecache.operation`); the system UI reads db8 and the
  lock status (`data/SystemManagerService.js`); the browser reads and sets
  its preferences and resource info (`source/BrowserApp.js`,
  `source/Browser.js`); the Clock reads the display (`utility/displaymanager.js`).
- **Phoenix's apps**: the ones with no `requiredPermissions` (C4) now
  declare what their calls need: Tasks, Messaging, Phone, Help, Voice Dial
  and the Ionic notes demo db8 (`database.operation`; Tasks and Messaging
  the temp db and Tasks activities), First Use its wizard's services,
  the Assistant its own service's `assistant.*` groups, the Clipboard
  `phoenix.clipboard`, DropShare `phoenix.dropshare`, Screen Captures the
  file manager and the media indexer; and the declared ones what they
  lacked: Music, Podcasts and Videos the media keys and audio focus,
  Podcasts downloads, Settings activities and the Assistant's settings,
  Weather, Maps, Photos, Phone, the Agenda and the Marketplace the system
  service's and settings service's reads, Files, Passwords and the
  Authenticator the lock status, Settings db8 (its emergency contacts'
  picker), Help, Messaging and the Clipboard the application manager's
  launch and list, and First Use the whole wizard's (the static checker's
  list, `tools/check-luna.py --suggest`, and the Assistant's settings). `tools/check-luna.py` closed 36 of its allowlisted findings (the ten apps without any `requiredPermissions` among them); for the apps that now declare them it finds 36 calls it charges an app only through what the app imports from `@phoenix/luna` and that no web test makes (Weather's `setSystemTime` through `system`), allowlisted as before (C4), not granted.
- **Phoenix's services**: every connector built on the sync kit writes its
  sync state to the temp db (`apps/shared/synckit/src/syncstate.js`):
  `tempdatabase.operation` in each connector's perm file (the catalog's,
  Fediverse, Telegram, DAV). The file manager lists the drives' accounts
  (`phoenix.accounts.list`); the backup service runs db8's and the system
  service's backup hooks and keeps its backups through the file manager
  (`database.management`, `systemsettings.management`, `filemanager.operation`).
  **The accounts service could not call a connector at all**: app-services'
  `onCreate`, `onEnabled`, `onCredentialsChanged` and `onDelete`
  (`notify-created.js`, `modify.js`) are in each transport's
  `accounts.transport` group, which `com.palm.service.accounts` did not
  hold (`compat/app-services/com.palm.service.accounts/sysbus`): on a
  device no connector heard of its accounts. It holds it now.

Allowlisted, each with why (`tools/devicecheck/sim-bus-allowlist.json`):

- **The share sheet and file picker** are a frame of the asking app's card,
  on a device too, so what they list (the file manager, the media indexer,
  the system manager's status) is asked as that app, and few apps hold
  those groups: on a device the sheet comes up empty in them. **For the
  owner**: those groups for every app that shares or picks, or the sheet
  in a card of its own.
- **Messaging's `markRead`** to a messaging connector is in each
  connector's own account group (`telegram.account`, ...), which Messaging
  does not hold. **For the owner**: a shared group for the transports'
  Messaging-facing methods.

- **`getAccountInfo` and the connector kit's credentials**: the kit reads every account's info and credentials
  (`apps/shared/connector-kit/src/service.ts:262-265`) but the catalog
  connectors hold no group for `getAccountInfo` (only the whole service's
  `phoenix.appservices.accounts`) and only the drives hold
  `phoenix.accounts.read-credentials` (`tools/test-devicecheck.py`). On a
  device the kit carries on without them, so a connector whose token is in
  the accounts service (Todoist's API token) cannot sync; Contacts' contacts
  library asks `getAccountInfo` too. **For the owner**: a narrow group for
  `getAccountInfo`, and whether the connectors may read their own
  credentials.
- Methods the device's provider does not have, all already in
  check-luna's allowlist (row C5): luna-sysmgr's systemmanager methods
  luna-systemui asks for, `getDebugOverlays`, `takeScreenShot`, OSE's
  missing `getDetails`, `filesysStatusCheck`, `ringtone/listRingtones`,
  the backup service's `publishToSystemUI`, Settings' `enableTouchPlot` and
  `enableFpsCounter`,
  SAM's `open` and handlers, the transcriber's `listen`; and Calendar's
  `updateLaunchPointIcon`, which Phoenix's application manager lacks.

The tests' own calls. Many tests drive a service from an app's page
(`page.evaluate` with a `PalmServiceBridge`): a device would refuse those
too, and they are the test's, not the app's. Each such test now names the
groups its calls need with `busGrants`, beside them (test-accounts,
-appmanager, -backup, -browser, -connectors, -db8-pages, -deltachat, -docs,
-drives, -exhibition, -fediverse, -filepicker, -firstuse, -launch-contracts,
-links, -location, -maps, -marketplace, -matrix, -notices, -phone-messaging,
-runtime-csp, -sftp, -telegram, -videos, -voicedial, -weather, -webfiles,
-xmpp). Three tests asserted what the simulator used to answer where a
device's hub answers first: another app opening a shell
(test-terminal) and a page asking the OAuth service for a token
(test-fediverse) now get the hub's "Denied method call"; test-docs asked
`com.webos.applicationManager/getResourceInfo`, which SAM does not have,
where Email asks the legacy name. test-voicedial counted a late start from
the page it left as one of the new page's (its store is now cleared from a
page that does not listen).
