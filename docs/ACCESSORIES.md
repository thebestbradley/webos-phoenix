# AirPods and unknown tracker alerts

The owner asked (15 October 2026): *"Are we able to replicate the sync
process for Apple products like AirPods, Find My/AirTags, etc.? If so let's
add that to the OS."* Some of it can be done by any device that speaks
Bluetooth; some of it needs Apple's own devices and servers and cannot.
This page says which is which, how Phoenix does what it can, what the
protocol facts rest on, and what it does with your data and your battery.

## What works

**AirPods and Beats, as an iPhone shows them** (any device's Bluetooth can
hear what AirPods advertise; the rest is their own control channel):

- **The card.** Open an AirPods case near the device: a card comes up in
  the popup alert's place (the bottom of a phone, a tablet's top right),
  the way luna-sysmgr's own alerts look: the model, a drawing of the earbuds
  and case, each earbud's and the case's battery with the status bar's
  battery icons, **Connect** and **Not Now**. Connect pairs them the ordinary
  Bluetooth way and asks for the case's pairing mode (non-Apple devices pair
  only that way: hold the button on the back of the case until the light
  flashes white). Not Now keeps the card away until the lid closes. Opening
  the case of AirPods already paired shows their battery card for six
  seconds.
- **Your own AirPods, told apart from anyone else's.** Once connected, the
  AirPods give Phoenix their keys over their control channel; their
  identity resolving key tells their advertisements from other AirPods of
  the same model, and their encryption key opens the encrypted part of the
  advertisement, so the card shows their batteries to 1 % before they
  connect (see "Your AirPods' keys").
- **Batteries** on the card, under the AirPods' name in the system menu's
  Bluetooth list, in Settings > Bluetooth's list and on their own page, and a
  notification as the earbuds go under 20, 10 and 5 percent (the levels
  Apple's iPhone notifies at: "How to charge your AirPods",
  support.apple.com/119912).
- **Settings > Bluetooth > (the AirPods)**: Noise Control (Off, Transparency,
  Adaptive, Noise Cancellation, as the model has them), Automatic Ear
  Detection, Conversation Awareness (on the models that have it), the
  name, which model they are and how Phoenix recognizes them, Forget This
  Device. A new name is Phoenix's at once and is sent to the AirPods
  themselves; if they do not take it, Phoenix keeps it and says so under
  the name ("The AirPods kept their own name. Phoenix calls them this."),
  and if they are not connected they get it when they next connect.
- **Ear detection**: taking an earbud out pauses what plays, putting it back
  plays it again (only what ear detection paused, and only if something was
  playing), through the media keys every Phoenix player already follows.
- **Noise Control in the system menu** while AirPods with listening modes are
  connected: a drawer like Bluetooth's, the mode in use checked.

**Unknown tracker alerts** (anti-stalking; everything on the device):

- Phoenix listens for trackers that are away from their owners: AirTags and
  other Find My accessories (Apple's separated-state advertisement), any
  tracker that follows the IETF's DULT accessory protocol (Apple's, Google's,
  Samsung's and Amazon's networks have registered network IDs), Google's Find
  Hub trackers in their protection mode, Tile and Samsung tags (Phoenix does
  not read whether their owner is near; only the pattern of sightings counts).
- When one has travelled with the device long enough, often enough and far
  enough for the **sensitivity** chosen (below; Medium by default: **30
  minutes, 3 sightings, 400 m**), a notification says "Unknown AirTag found
  moving with you" (or "tracker"), with its own sound, a tracker's chirps
  and ping that no other alert makes (below, "The alert's sound").
- The notification opens the tracker's page (Settings > Bluetooth > Tracker
  Alerts): when it was first and last seen, how far it came and a sketch of
  where, **Play Sound** (the tracker rings, through DULT's non-owner
  service), **How to Disable It**, a word on what to do if you feel unsafe,
  and Ignore This Tracker. Settings > Bluetooth > Tracker Alerts turns
  alerts on or off, sets the sensitivity and lists the trackers seen.

### Sensitivity

Settings > Bluetooth > Tracker Alerts > Sensitivity (the owner, 15 October
2026). The IETF's threat model recommends letting people choose how often
alerts come and the detection radius (draft-ietf-dult-threat-model-05
§4.1.2: some get "alert fatigue" from false alarms, others fear missing
one, and needs change as a situation does) and points to AirGuard's three
levels (§4.2.1.2). Apple and Google do not publish their current values.
Each level, as `services/accessories/lib/trackerdetect.js` `SENSITIVITY`
has it:

| Level | With you for | Seen | Over | Again after | Where each value comes from |
|---|---|---|---|---|---|
| Low | 2 hours | 4 times | 840 m | 8 hours | AirGuard's own "low" level today (seemoo-lab/AirGuard, Apache-2.0, `RiskLevelEvaluator.kt`: 120 minutes, 4 locations, 8 hours between notifications; its locations taken as sightings); 840 m is iOS's default distance (AirGuard paper §3.4.1) |
| **Medium** (default) | 30 minutes | 3 times | 400 m | 7 hours | AirGuard's published rule (Heinrich, Bittner & Hollick, WiSec 2022, §4.1.2), a simplified form of iOS's |
| High | 10 minutes | twice | 200 m | 2 hours | 10 minutes is iOS's default time (AirGuard paper §3.4.1); twice and 2 hours, AirGuard's "high" level (`RiskLevelEvaluator.kt`); **200 m is Phoenix's own choice**, half of Medium's |

High finds a tracker sooner and may alert for one that only goes the same
way, on a bus or a train; Low alerts less often and later. Every level
counts a tracker at most once in 2 minutes (a scan hears one many times),
and needs Location Services: time alone cannot tell a tracker following
you from one lying where you are.

### The alert's sound

`apps/settings/public/sounds/tracker-alert.mp3` (2.2 s), Phoenix's own,
synthesized by `tools/make-feedback-sounds.py` (`tracker_alert`, CC0 1.0;
nothing sampled or recorded, nothing of Apple's sounds imitated): two
bursts of three quick rising chirps, a beacon's call (1.4 to 2.5 kHz, then
a fourth higher, 70 ms each), then a sonar-like ping that rings out (a C6
with a struck bar's inharmonic partials). Every other Phoenix sound is a
bell, a marimba or a click, so this one is not taken for mail or a
message. The tracker service names it in its notification (`soundFile`,
with the alerts' volume); on a device it plays from its raw PCM twin like
every app sound (`tools/sounds-to-pcm.py`). Play Sound has no sound of its
own on the device: the tracker rings.

## Your AirPods' keys

The owner asked for this on 15 October 2026. Paired AirPods answer a
request on their control channel with two keys
(`04 00 04 00 30 00 05 00`, tyalie's FINDINGS.md; the answer, opcode 0x31,
as CAPod's documentation reads it):

- **The identity resolving key (IRK)** resolves the advertisement's random
  address, by the Bluetooth Core Specification's resolvable private
  address (Vol 6 Part B §1.3.2; the `ah` function, Vol 3 Part H §2.2.2,
  checked against the specification's sample data). An advertisement that
  resolves is these AirPods; once one has, other AirPods of the same model
  are no longer taken for them.
- **The encryption key** opens the last 16 bytes of the Proximity Pairing
  message (AES in ECB mode, tyalie's FINDINGS.md), which hold the batteries
  at 1 % (CAPod's documentation; the MagicPairing paper, Heinze, Classen &
  Hollick, WiSec 2020, §4.3: the encrypted part encodes battery state under
  a "MagicPairing EncryptionKey"). No source documents where in the 16
  bytes each battery is, so Phoenix **learns it from the AirPods
  themselves**: while they are connected it compares what it decrypts with
  the batteries their control channel reports at the same moment, keeps
  the byte positions that held the left and right levels every time, and
  settles only after the levels have changed and differed (so a byte that
  matched by chance has had to match again). Until then, or if the bytes
  hold the batteries some other way, the card shows the advertisement's
  tenths. Nothing is guessed.

Without keys (AirPods connected only to an Apple device so far, or that do
not answer), and until the key has resolved an advertisement once (the byte
order the AirPods send the key in is not documented, so both are tried),
Phoenix falls back to the model: the one paired pair of that model is taken
to be the ones nearby. The keys are the user's own AirPods' data, given to
the user's device by the AirPods; they stay in the accessories service's
store on the device (below, "Privacy").

## What is not possible, and why

- **Setting up or locating your own AirTags or Find My items.** An AirTag is
  registered by an Apple device to an Apple ID, and its reports are
  encrypted to keys only that account holds, fetched from Apple's servers
  after an Apple ID sign-in. Unofficial clients (FindMy.py and others)
  imitate Apple's sign-in with reverse-engineered authentication: fragile,
  broken by any server change, and likely against Apple's terms. Phoenix
  does not ship that.
- **Relaying for the Find My network** (being a "finder"): reports go to
  Apple's servers from Apple's devices; there is no open way in.
- **Automatic switching between your Apple devices**: iCloud keeps the
  AirPods' pairing and decides the switch between devices on one Apple ID.
- **AirDrop**: it runs over Apple's AWDL Wi-Fi link; Linux's open AWDL
  (OWL) needs a Wi-Fi chip in monitor mode with frame injection, which phone
  and tablet Wi-Fi does not offer.
- **Apple Watch pairing**: only an iPhone pairs a watch.
- **What AirPods keep for Apple devices**: Hearing Aid, Customize
  Transparency Mode and switching between devices are offered only to a
  host presenting Apple's Bluetooth vendor ID (librepods-rs README). Some
  projects make their computer claim it; **Phoenix does not** (it would
  misdescribe every Bluetooth device Phoenix talks to), so these are not
  offered. The iPhone's one-tap pairing (no button) needs Apple's own
  proximity-pairing exchange and keys; Phoenix pairs with the case's button.

## How it works

| Part | Where | What |
|---|---|---|
| The parsers | `services/accessories/lib/continuity.js` | Bluetooth LE advertisements: Apple's Proximity Pairing (AirPods, Beats), Find My, DULT, Find Hub, Tile and Samsung UUIDs |
| The control channel | `services/accessories/lib/aap.js`, `services/l2cap` | AirPods' L2CAP channel (PSM 0x1001): batteries, ears, listening mode, settings, model number, their keys, renaming; `phoenix-l2cap` relays the channel for Node, which has no Bluetooth sockets |
| The keys | `services/accessories/lib/keys.js` | resolving the advertisement's address, opening its encrypted part, learning where the batteries are in it |
| Tracker detection | `services/accessories/lib/trackerdetect.js`, `lib/dult.js` | the travelling-with-you rule and its three sensitivities; DULT's non-owner Sound_Start over GATT |
| The device services | `services/accessories/earbuds.js`, `trackers.js`, `scanner.js` | `org.webosphoenix.earbuds` and `org.webosphoenix.trackers` in the accessories service's process, over OSE's `com.webos.service.bluetooth2` (`le/startScan`, `adapter/pair`, `a2dp/connect`, `gatt/*`) and `com.webos.service.location`; the scan's three modes |
| The shell | `shell/qml/Phoenix/Shell/Earbuds.js`, `EarbudsMonitor.qml`, `EarbudsAlert.qml`, `EarbudsArt.qml`, `SystemMenu.qml` | the card, ear detection, low battery, the system menu |
| Device status | `LsmSystemStatus.qml` (`earbuds`), `LsmWindowSource.qml` (the shell's own alerts) | the service's status for the shell on a device |
| Settings | `apps/settings/src/pages/Bluetooth.tsx`, `Earbuds.tsx`, `Trackers.tsx`, `Scanning.tsx` | the pages above; the alert's sound in `apps/settings/public/sounds/` |
| The simulator | `runtime/phoenix-runtime.js` ("AirPods and tracker alerts"), `sim.qml` | both services with the device's requests and replies; Simulate > AirPods and Trackers; the scenes `airpods`, `airpodsbattery`, `airpodsmenu`, `airpodssettings`, `trackeralert` |
| Packaging | `meta-phoenix/recipes-phoenix/phoenix-l2cap`, `packagegroup-phoenix-accessories` | the helper on the image; the services come with `phoenix-apps` (`tools/install-rootfs.py`) |

`org.webosphoenix.trackers` takes `setSensitivity {sensitivity: "low" |
"medium" | "high"}` and `setScanMode {mode: "saver" | "balanced" |
"performance"}`, and reports both with their values in `getStatus`
(`thresholds`, `scanWindows`); the earbuds' status says how each pair is
recognized (`recognition`, `exactBattery`) and how a rename went
(`renamed`).

Why there: the accessories service is already the one process for
Settings' accessories (game controllers, USB, tethering, battery), keeps
itself running, and has its bus files and packaging; two more Luna names in
it are the smallest change. Why over OSE's Bluetooth service and not BlueZ's
D-Bus API directly: `com.webos.service.bluetooth2` already gives an LE scan
with each device's advertising data (`le/startScan`:
`BluetoothManagerAdapter::startScan`, `appendScanRecord`,
`appendManufacturerData`), pairing, A2DP and GATT, on both device stacks,
and owns BlueZ's adapter; Node has no D-Bus client without native modules.
The one thing it lacks is a raw L2CAP channel, hence `phoenix-l2cap` (a
hundred lines of C over the kernel's Bluetooth sockets).

The simulator: Simulate > AirPods and Trackers brings AirPods Pro 2 near
(case open: the card), puts earbuds in and out of the ears, presses the
stem (the next listening mode, as the AirPods report it), makes the
battery low, makes the AirPods refuse a new name, and has an AirTag or a
Find Hub tracker follow you (35 minutes and 1.2 km: an alert at Medium and
High, none at Low); the keys are Ctrl+Shift+P (case open), Ctrl+Shift+E
(both in), Ctrl+Shift+F (an AirTag follows). The simulated AirPods give
their keys on their first connection and show their exact batteries from
then on (a device learns the layout first).

## Sources

Phoenix's code is written from **protocol facts** in these sources. No code
or text of another project is used; GPL projects (LibrePods, OpenPods,
AirPodsDesktop, CAPod, furiousMAC's dissector) were not used for code.

| Source | Licence | What it gave |
|---|---|---|
| Bluetooth SIG, Assigned Numbers (company identifiers, member UUIDs; Core Specification Supplement) | public specification | 0x004C Apple; 0xFCB2 and 0xFD44 Apple, 0xFEAA Google, 0xFD5A Samsung, 0xFEEC and 0xFEED Tile; AD types |
| Bluetooth Core Specification, Vol 6 Part B §1.3.2 and Vol 3 Part H §2.2.2 and Appendix D | public specification | the resolvable private address and its resolution with an IRK (`ah`), and its sample data |
| Martin et al., "Handoff All Your Privacy", PoPETs 2019(4) | open access (Sciendo, CC BY-NC-ND) | Apple's manufacturer data as Continuity messages: type, length, value |
| Celosia & Cunche, "Discontinued Privacy: Personal Data Leaks in Apple Bluetooth-Low-Energy Continuity Protocols", PoPETs 2020(1), Fig. 5, Tables 5-7, §4.2 | open access (Sciendo, CC BY-NC-ND) | the Proximity Pairing message's layout; battery levels in tenths, the charging bits, the case's level only while the lid is open, the lid open counter; model codes 0x0220, 0x0320, 0x0520, 0x0620; colours |
| Heinze, Classen & Hollick, "MagicPairing: Apple's Take on Securing Bluetooth Peripherals", WiSec 2020 (arXiv:2005.07255), §4.3 | arXiv | the advertisement's encrypted part encodes battery state, under a MagicPairing encryption key |
| furiousMAC/continuity, `messages/proximity_pairing.md` | GPL-2.0 (facts only) | which nibble is the right earbud's; levels above 10 seen; model 0x0e20 AirPods Pro |
| Heinrich, Bittner & Hollick, "AirGuard - Protecting Android Users From Stalking Attacks By Apple Find My Devices", WiSec 2022 (arXiv:2202.11813) | arXiv | the Find My message (type 0x12, 25 bytes while separated, the status byte's device type bits); the nearby and separated states; iOS's detection values (10 minutes, 840 m) and AirGuard's own rule (30 minutes, 3 sightings, 400 m, 7 hours); iOS's scans every 1 to 5 minutes |
| seemoo-lab/AirGuard (the app, September 2026: `RiskLevelEvaluator.kt`, `WorkerConstants.kt`, `BackgroundBluetoothScanner.kt`) | Apache-2.0 (values only) | its three levels (120, 60 and 30 minutes; 4, 3 and 2 locations; 8, 4 and 2 hours between notifications); its background scan, 20 s every 15 minutes |
| draft-ietf-dult-accessory-protocol-00 (2024), draft-ledvina-apple-google-unwanted-trackers-03 (June 2026), draft-ietf-dult-threat-model-05 (August 2026) | IETF Trust (BCP 78) | the 0xFCB2 payload and near-owner bit; address rotation; the non-owner GATT service and characteristic, Sound_Start / Sound_Stop / Command_Response / Sound_Completed and the accessory information opcodes; the network ID registry; disablement; the threat model's case for letting the user choose how often alerts come and the detection radius (§4.1.2), and AirGuard's levels as an example (§4.2.1.2) |
| Google, Find Hub Network accessory specification (developers.google.com/nearby/fast-pair/specifications/extensions/fmdn) | CC BY 4.0 | the 0xFEAA frame, 0x41 unwanted tracking protection mode; ringing through DULT's non-owner service |
| tyalie/AAP-Protocol-Defintion (README, FINDINGS.md, `aap.ksy`, `examples/`) | no licence stated (facts and short wire messages) | PSM 0x1001; packet kinds and service ID; connect; the battery, in-ear, role, setting, notification filter and version messages, from captures with what Apple's PacketLogger reads in them; the keys' request (`04 00 04 00 30 00 05 00`), and that the advertisement is encrypted with AES in ECB mode |
| d4rken-org/capod wiki, "AirPod Keys" | the project is GPL-3.0 (facts only, no code) | the keys' answer: opcode 0x31, a count, each key's type (0x01 IRK, 0x04 encryption key), length and bytes; the IRK links the random addresses, the encryption key gives the batteries at 1 % |
| LibrePods, `docs/AAP Definitions.md`, "Renaming AirPods" | GPL-3.0 (the message's bytes only, no code or text) | renaming: opcode 0x1A, then 0x01, the name's length, 0x00 and the name |
| rithvikvibhu, "Apple Airpods Bluetooth Packets" (gist, September 2025) | no licence stated (facts) | Transparency is setting 0x0D, value 0x03 |
| brianpht/librepods-rs README ("How It Works") | no licence file found (facts) | Noise Cancellation is 0x0D 0x02; Conversation Awareness is setting 0x28; which features need Apple's vendor ID |
| Apple Support: "Identify your AirPods" (109525); AirPods User Guide, "Switch between listening modes"; "How to charge your AirPods" (119912); "Connect AirPods to a non-Apple device" | Apple's documentation (facts) | model numbers and names; which models have Noise Cancellation, Transparency and Adaptive; the low battery levels; pairing with the case's button |

### Values not yet confirmed

The AAP values the sources above do not give, or only one community source
gives, are marked `UNVERIFIED` in `lib/aap.js` and `lib/keys.js`, to
correct after testing with AirPods: Adaptive (0x0D, 0x04); in the ear 0x00
and out of the ear 0x01 (in the case, 0x02, is confirmed); ear detection
off 0x01 (on, 0x02, is confirmed by PacketLogger); Conversation Awareness on
0x01 and off 0x02; a single battery (AirPods Max) 0x01; a right primary
earbud 0x02; **the rename message** (one source, no capture; the AirPods
send no answer, so Phoenix counts it done only when they report the new
name, in their version information or their Bluetooth name, within 10
seconds); the byte order of the keys (both are tried); and where the
batteries are in the encrypted part (learned, never assumed). Proximity
Pairing model codes other than the five above are not named: such AirPods
show as "AirPods" until their control channel gives the model number.

## Privacy

- Nothing about AirPods or trackers leaves the device. Phoenix does not look
  a tracker up with its maker (the DULT drafts' AccessoryInfo service and
  Get_Identifier are not used).
- The trackers seen, and the AirPods' keys and learned layout, are kept in
  the accessories service's store (`/var/lib/phoenix/accessories/state.json`,
  readable by the system only). Trackers are forgotten after 7 days, and
  Clear List forgets them at once; Forget This Device forgets the AirPods'
  keys.
- The device's location is asked only when a tracker away from its owner is
  heard, at most once every two minutes, and kept only with that tracker's
  sightings. With Location Services off, trackers are listed but never
  alerted (time alone cannot tell a tracker following you from one lying
  where you are).
- Turning Tracker Alerts off stops it: trackers' advertisements are ignored
  and nothing is scanned while the screen is off.

## Power

Listening keeps the radio on, so how much is the user's choice:
Settings > Bluetooth > Scanning (the owner, 15 October 2026), one place for
both the AirPods' card and tracker alerts. With the screen off Phoenix
scans only while Tracker Alerts are on; with Bluetooth off, never. The
control channel is open only while AirPods are connected. Each mode, as
`services/accessories/scanner.js` `MODES` has it:

| Mode | Screen on | Screen off (Tracker Alerts on) | Where it comes from |
|---|---|---|---|
| Battery Saver | 10 s in every 30 s | 20 s every 15 minutes | screen off: AirGuard's background scan today (`WorkerConstants.MIN_MINUTES_TO_NEXT_BT_SCAN`, `BackgroundBluetoothScanner.getScanDuration`); screen on: **Phoenix's own** (an opened case shows within about 20 s) |
| **Balanced** (default) | always | 10 s every 3 minutes | within iOS's every 1 to 5 minutes (AirGuard paper §3.7, §4.1.1) |
| Performance | always | 10 s every minute | iOS's shortest interval. Not a scan that never stops: the tracker rule counts a tracker at most once in 2 minutes, and with the screen off nothing shows the AirPods' card, so a longer scan would only spend the battery |

Every sensitivity works with every mode: Battery Saver's 15-minute gaps
still give High its two sightings ten minutes apart, and Low its four in
two hours. A system-wide Low Power Mode is on the roadmap (docs/ROADMAP.md,
M5); when it comes, the scan follows it into Battery Saver. What each
mode costs is left to measure on hardware (below).

## Art

The earbuds and case are Phoenix's own drawing, plain shapes in code
(`shell/qml/Phoenix/Shell/EarbudsArt.qml` and the same in
`apps/settings/src/pages/Earbuds.tsx`; no image files); the batteries use
Open webOS's status bar icons (`shell/assets/openwebos/statusBar/battery-*`,
docs/LEGAL.md). No Apple artwork or logo is used. "AirPods", "AirTag",
"Beats" and "Find My" name what works with Phoenix (docs/LEGAL.md,
"AirPods and tracker alerts", **a draft: not reviewed by a lawyer; not
legal advice**).

## The owner's decisions (15 October 2026)

The questions this work left, and the owner's answers:

1. Tracker Alerts' sensitivity: yes, Low, Medium (the default, the
   published rule) and High, each stated and sourced ("Sensitivity").
2. Fetching the AirPods' keys: yes, to know your own pair exactly and read
   their exact batteries, falling back to the model match ("Your AirPods'
   keys").
3. Renaming: on the AirPods too, with Phoenix's name kept and said so when
   they do not take it.
4. Tile and SmartTag by their movement alone: fine as it is.
5. A tracker alert sound of Phoenix's own ("The alert's sound").
6. No lawyer's review: docs/LEGAL.md's section says it is a draft, not
   legal advice.
7. Scanning: continuous with the screen on is fine, with three modes to
   choose from ("Power").
8. A system-wide Low Power Mode goes on the roadmap (docs/ROADMAP.md, M5;
   GAPS E9), not built yet.

## Tested, and what is left for a device

Tested: the parsers on byte vectors from the sources (`continuity.test.ts`,
`aap.test.ts`), the keys against the Bluetooth specification's sample data
and the layout learner on blocks made with a chosen layout
(`keys.test.ts`), both services over fakes of bluetooth2, the location
service and the L2CAP helper, with the keys, the rename, the sensitivities
and the scan modes (`earbuds.test.ts`), Settings against the simulated
services (`Earbuds.test.tsx`, `tools/test-settings.cjs`), the shell
(`tst_earbuds.qml`, `tst_lsmstatus.qml`), and every screen in phoenix-sim,
phone and tablet.

Left, on hardware: that bluetooth2's LE scan (BlueZ SIL) reports each
advertisement's data (`scanRecord` or `manufacturerData`) as it changes;
the `UNVERIFIED` values with real AirPods, the rename among them; that the
keys' answer comes and its IRK resolves the advertisements (and in which
byte order), and that the layout settles; pairing from the card with the
case's button; Play Sound with a separated AirTag and a Find Hub tag; the
luna-service2 permissions; what each scan mode costs the battery. And
later: head tracking, firmware versions.
