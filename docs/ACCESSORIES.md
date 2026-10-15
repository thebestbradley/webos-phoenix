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
- **Batteries** on the card, under the AirPods' name in the system menu's
  Bluetooth list, in Settings > Bluetooth's list and on their own page, and a
  notification as the earbuds go under 20, 10 and 5 percent (the levels
  Apple's iPhone notifies at: "How to charge your AirPods",
  support.apple.com/119912).
- **Settings > Bluetooth > (the AirPods)**: Noise Control (Off, Transparency,
  Adaptive, Noise Cancellation, as the model has them), Automatic Ear
  Detection, Conversation Awareness (on the models that have it), the name
  Phoenix gives them, Forget This Device.
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
- When one has travelled with the device for **30 minutes, been seen 3 times,
  over 400 m**, a notification says "Unknown AirTag found moving with you"
  (or "tracker"); at most one alert per tracker in 7 hours.
- The notification opens the tracker's page (Settings > Bluetooth > Tracker
  Alerts): when it was first and last seen, how far it came and a sketch of
  where, **Play Sound** (the tracker rings, through DULT's non-owner
  service), **How to Disable It**, a word on what to do if you feel unsafe,
  and Ignore This Tracker. Settings > Bluetooth > Tracker Alerts turns
  alerts on or off and lists the trackers seen.

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
| The control channel | `services/accessories/lib/aap.js`, `services/l2cap` | AirPods' L2CAP channel (PSM 0x1001): batteries, ears, listening mode, settings, model number; `phoenix-l2cap` relays the channel for Node, which has no Bluetooth sockets |
| Tracker detection | `services/accessories/lib/trackerdetect.js`, `lib/dult.js` | the travelling-with-you rule; DULT's non-owner Sound_Start over GATT |
| The device services | `services/accessories/earbuds.js`, `trackers.js`, `scanner.js` | `org.webosphoenix.earbuds` and `org.webosphoenix.trackers` in the accessories service's process, over OSE's `com.webos.service.bluetooth2` (`le/startScan`, `adapter/pair`, `a2dp/connect`, `gatt/*`) and `com.webos.service.location` |
| The shell | `shell/qml/Phoenix/Shell/Earbuds.js`, `EarbudsMonitor.qml`, `EarbudsAlert.qml`, `EarbudsArt.qml`, `SystemMenu.qml` | the card, ear detection, low battery, the system menu |
| Device status | `LsmSystemStatus.qml` (`earbuds`), `LsmWindowSource.qml` (the shell's own alerts) | the service's status for the shell on a device |
| Settings | `apps/settings/src/pages/Bluetooth.tsx`, `Earbuds.tsx`, `Trackers.tsx` | the pages above |
| The simulator | `runtime/phoenix-runtime.js` ("AirPods and tracker alerts"), `sim.qml` | both services with the device's requests and replies; Simulate > AirPods and Trackers; the scenes `airpods`, `airpodsbattery`, `airpodsmenu`, `airpodssettings`, `trackeralert` |
| Packaging | `meta-phoenix/recipes-phoenix/phoenix-l2cap`, `packagegroup-phoenix-accessories` | the helper on the image; the services come with `phoenix-apps` (`tools/install-rootfs.py`) |

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
battery low, and has an AirTag or a Find Hub tracker follow you; the keys
are Ctrl+Shift+P (case open), Ctrl+Shift+E (both in), Ctrl+Shift+F (an
AirTag follows).

## Sources

Phoenix's code is written from **protocol facts** in these sources. No code
or text of another project is used; GPL projects (LibrePods, OpenPods,
AirPodsDesktop, furiousMAC's dissector) were not used for code.

| Source | Licence | What it gave |
|---|---|---|
| Bluetooth SIG, Assigned Numbers (company identifiers, member UUIDs; Core Specification Supplement) | public specification | 0x004C Apple; 0xFCB2 and 0xFD44 Apple, 0xFEAA Google, 0xFD5A Samsung, 0xFEEC and 0xFEED Tile; AD types |
| Martin et al., "Handoff All Your Privacy", PoPETs 2019(4) | open access (Sciendo, CC BY-NC-ND) | Apple's manufacturer data as Continuity messages: type, length, value |
| Celosia & Cunche, "Discontinued Privacy: Personal Data Leaks in Apple Bluetooth-Low-Energy Continuity Protocols", PoPETs 2020(1), Fig. 5, Tables 5-7, §4.2 | open access (Sciendo, CC BY-NC-ND) | the Proximity Pairing message's layout; battery levels in tenths, the charging bits, the case's level only while the lid is open, the lid open counter; model codes 0x0220, 0x0320, 0x0520, 0x0620; colours |
| furiousMAC/continuity, `messages/proximity_pairing.md` | GPL-2.0 (facts only) | which nibble is the right earbud's; levels above 10 seen; model 0x0e20 AirPods Pro |
| Heinrich, Bittner & Hollick, "AirGuard - Protecting Android Users From Stalking Attacks By Apple Find My Devices", WiSec 2022 (arXiv:2202.11813) | arXiv | the Find My message (type 0x12, 25 bytes while separated, the status byte's device type bits); the nearby and separated states; iOS's detection values and AirGuard's own rule (30 minutes, 3 sightings, 400 m, 7 hours) |
| draft-ietf-dult-accessory-protocol-00 (2024), draft-ledvina-apple-google-unwanted-trackers-03 (June 2026), draft-ietf-dult-threat-model-05 (August 2026) | IETF Trust (BCP 78) | the 0xFCB2 payload and near-owner bit; address rotation; the non-owner GATT service and characteristic, Sound_Start / Sound_Stop / Command_Response / Sound_Completed and the accessory information opcodes; the network ID registry; disablement; the threat model's case for letting the user choose sensitivity |
| Google, Find Hub Network accessory specification (developers.google.com/nearby/fast-pair/specifications/extensions/fmdn) | CC BY 4.0 | the 0xFEAA frame, 0x41 unwanted tracking protection mode; ringing through DULT's non-owner service |
| tyalie/AAP-Protocol-Defintion (README, FINDINGS.md, `aap.ksy`, `examples/`) | no licence stated (facts and short wire messages) | PSM 0x1001; packet kinds and service ID; connect; the battery, in-ear, role, setting, notification filter and version messages, from captures with what Apple's PacketLogger reads in them |
| rithvikvibhu, "Apple Airpods Bluetooth Packets" (gist, September 2025) | no licence stated (facts) | Transparency is setting 0x0D, value 0x03 |
| brianpht/librepods-rs README ("How It Works") | no licence file found (facts) | Noise Cancellation is 0x0D 0x02; Conversation Awareness is setting 0x28; which features need Apple's vendor ID |
| Apple Support: "Identify your AirPods" (109525); AirPods User Guide, "Switch between listening modes"; "How to charge your AirPods" (119912); "Connect AirPods to a non-Apple device" | Apple's documentation (facts) | model numbers and names; which models have Noise Cancellation, Transparency and Adaptive; the low battery levels; pairing with the case's button |

### Values not yet confirmed

The AAP values the sources above do not give are taken as the community
reports them, marked `UNVERIFIED` in `lib/aap.js`, all in one table there
to correct after testing with AirPods: Adaptive (0x0D, 0x04); in the ear
0x00 and out of the ear 0x01 (in the case, 0x02, is confirmed); ear
detection off 0x01 (on, 0x02, is confirmed by PacketLogger); Conversation
Awareness on 0x01 and off 0x02; a single battery (AirPods Max) 0x01; a
right primary earbud 0x02. Proximity Pairing model codes other than the
five above are not named: such AirPods show as "AirPods" until their
control channel gives the model number.

Which advertisement belongs to which paired AirPods: the advertisement's
address is random and its identifying part encrypted with a key the
AirPods hand only to their owner's devices, so Phoenix takes the one paired
pair of that model to be the ones nearby.

## Privacy

- Nothing about AirPods or trackers leaves the device. Phoenix does not look
  a tracker up with its maker (the DULT drafts' AccessoryInfo service and
  Get_Identifier are not used).
- The trackers seen are kept in the accessories service's store
  (`/var/lib/phoenix/accessories/state.json`, readable by the system only)
  and forgotten after 7 days; Clear List forgets them at once.
- The device's location is asked only when a tracker away from its owner is
  heard, at most once every two minutes, and kept only with that tracker's
  sightings. With Location Services off, trackers are listed but never
  alerted (time alone cannot tell a tracker following you from one lying
  where you are).
- Turning Tracker Alerts off stops it: trackers' advertisements are ignored and nothing is scanned while the screen is off.

## Power

Listening keeps the radio on. With the screen on (and Bluetooth on) the
scan runs, so a case opened nearby shows at once; with the screen off it
runs for 10 seconds every 3 minutes, and only while Tracker Alerts are on
(iOS scans every 1 to 5 minutes, AirGuard 8 seconds every 15 minutes:
AirGuard §3.7, §4.1.1); with Bluetooth off, never. The control channel is
open only while AirPods are connected. Measuring it on hardware is left
(below).

## Art

The earbuds and case are Phoenix's own drawing, plain shapes in code
(`shell/qml/Phoenix/Shell/EarbudsArt.qml` and the same in
`apps/settings/src/pages/Earbuds.tsx`; no image files); the batteries use
Open webOS's status bar icons (`shell/assets/openwebos/statusBar/battery-*`,
docs/LEGAL.md). No Apple artwork or logo is used. "AirPods", "AirTag",
"Beats" and "Find My" name what works with Phoenix (docs/LEGAL.md).

## Tested, and what is left for a device

Tested: the parsers on byte vectors from the sources (`continuity.test.ts`,
`aap.test.ts`), both services over fakes of bluetooth2, the location
service and the L2CAP helper (`earbuds.test.ts`), Settings against the
simulated services (`Earbuds.test.tsx`), the shell (`tst_earbuds.qml`,
`tst_lsmstatus.qml`), and every screen in phoenix-sim, phone and tablet.

Left, on hardware: that bluetooth2's LE scan (BlueZ SIL) reports each
advertisement's data (`scanRecord` or `manufacturerData`) as it changes;
the `UNVERIFIED` values with real AirPods; pairing from the card with the
case's button; Play Sound with a separated AirTag and a Find Hub tag; the
luna-service2 permissions; what scanning costs the battery. And later: a
sensitivity setting for alerts (the DULT threat model §4.1.2), the
AirPods' own rename (an AAP message not confirmed yet; Phoenix renames them
for itself), head tracking, firmware versions.
