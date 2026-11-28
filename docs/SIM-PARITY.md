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
| #102 / #106 / #94 / #100 ls-hubd permissions | ls-hubd refuses a call whose method is in no group the caller holds (api.json, groups.json, `compat/app-permissions.json`, roles' outbound lists): sign-in frames, settingsservice's *Priv methods, the activity manager's replies | the runtime checks no permission: any page may call any method | yes, the largest | **Follow-up (large)**: enforce the sysbus files in the runtime's dispatch (the caller's app id against the api groups it holds), first as a warning in the console, then refused. `tools/test-devicecheck.py` checks the files statically today |
| #89 assistant caller | the shell's calls come as `com.webos.surfacemanager`, the caller from webos-service's sender | the simulator's shell calls as `com.palm.systemui` | no (a name; the Assistant accepts both, `apps/assistant/service/service.js:73`) | none |
| #74 web inspector | port 9998 only in Developer Mode, bound to 127.0.0.1 | phoenix-sim opens no remote debugging port | no | none |
| #97 / #93 / #103 location | the location service takes the account's relayed position, else the town; geoclue off | the runtime's location service (`runtime/phoenix-runtime.js:22078`) has its own positions | not audited further | The account side is another task's files (services/account); left to it |
| #85 registration 422 | the account service's registration | the same PR changed the runtime | no | none (services/account is another task's) |
| #99 RAUC OTA | A/B slots, bundles | the runtime's updates have slots (`runtime/phoenix-runtime.js:16860`) | not in scope | none |
| #84, #83, #82, #87, #90, #67, #103 | image build, packages, units, GPU, memory, zram | no simulator counterpart | no | none |
| #59, #60, #69, #71 | shared shell QML and the runtime itself | the same code | no | none |

## Follow-ups, in order of what they would catch

1. **Permissions in the simulator** (#102, #106, #94, #100): the runtime's
   dispatch reads the sysbus files and refuses what ls-hubd would. The
   largest gap: every permission bug so far was found on an image.
2. **Developer Mode restarts the simulator** (#79, #80), as the device's
   provider restarts the device.
3. **settingsservice's descriptions** (#94, #105): one table of described
   keys (`phoenix.description.json`), with ranges, that the simulator
   checks sets against and subscribes by; `measurementUnits` checked on an
   image first.
4. **Memory pressure closing the boot apps** (#95, #101): a simulator key.
5. **A failing USB link** (#86), if its state is ever shown.
