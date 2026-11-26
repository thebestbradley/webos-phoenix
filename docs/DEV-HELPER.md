# Nova Helper: one-click Phoenix in UTM, with the developer tools

The plan for a desktop app that lets a developer run Phoenix in UTM on
their own iPad or Mac with one click, then launch and inspect its apps,
read its logs, debug the shell's QML, push changes and open a shell, on a
UTM virtual machine, a test device or the simulator alike. Written 26
November 2026 at the owner's request: "a launch helper app that connects
the debugger to the UTM so when I connect and launch I can just click on
an app icon and it sets up everything for me", clarified: "I was talking
about the UTM debugger that is required to launch on non jail broken iOS
devices. but these options above should also be added to the simulator
tools as well as attach the UTM debugger right? So other developers have a
way to use UTM on their devices." The owner chose **Electron with React and
TypeScript**. **Status: plan, nothing built.**

It builds on the dev push plan, [DEV-PUSH.md](DEV-PUSH.md) (`nova` on the
computer, `novad` on the device): everything the helper does to a running
Phoenix goes through `novad`, and the helper is a window over the same
library `nova` uses. What is new here is the part before Phoenix runs (JIT
for UTM on an iPad, starting the VM) and the developer tools on top
(inspector, logs, QML debugger), in the simulator as well.

## Contents

1. [Goal](#1-goal)
2. [The name](#2-the-name)
3. [Why an iPad needs a debugger: JIT](#3-why-an-ipad-needs-a-debugger-jit)
4. [The iOS flow, version by version](#4-the-ios-flow-version-by-version)
5. [What the user does once](#5-what-the-user-does-once)
6. [Licences](#6-licences)
7. [Architecture](#7-architecture)
8. [Reaching Phoenix inside UTM](#8-reaching-phoenix-inside-utm)
9. [The developer tools](#9-the-developer-tools)
10. [The simulator](#10-the-simulator)
11. [Where the code lives](#11-where-the-code-lives)
12. [Packaging](#12-packaging)
13. [Security](#13-security)
14. [Tests](#14-tests)
15. [Phases and who does what](#15-phases-and-who-does-what)
16. [Open questions for the owner](#16-open-questions-for-the-owner)
17. [Risks](#17-risks)
18. [Sources](#18-sources)

---

## 1. Goal

- **One click to a running Phoenix.** Plug in an iPad (or pick a VM on the
  Mac), press **Start**: the helper gets UTM its JIT, starts the VM where
  it can, waits for Phoenix to boot and connects to it.
- **Click an app's icon to launch and inspect it.** The device's app grid,
  with its icons; a click launches the app and opens Chrome DevTools on
  its page, as `palm-launch -i` and Palm's Inspector did.
- **The rest of Palm's developer tools in one window**: live logs
  (`palm-log -f`), the shell's QML debugger and profiler (Qt Creator),
  dev push (`nova push`) and a terminal (`nova term`).
- **The same tools for the simulator.** phoenix-sim gets a Developer menu
  with the same tools, and the helper lists a running simulator as one
  more device.
- **For any developer, on their own devices**: no jailbreak, no Phoenix
  server, nothing Phoenix has to host; their own Apple ID signs UTM.
- **Permissive code only.** The helper and everything it ships are
  Apache-2.0 or permissive (MIT, BSD), as the rest of Phoenix
  ([LEGAL.md](LEGAL.md#our-code)).

Not a goal: making UTM itself, signing apps for the user, or getting
around Apple's rules. The helper does what Xcode does for an app the user
signed for development: it attaches a debugger.

## 2. The name

**Nova Helper** (the app; `nova-helper` the package and the command that
starts it). Palm named its desktop tools plainly, after what they did:
Palm Inspector, Palm Emulator, webOS Doctor, webOS Quick Install (a
community tool). The dev push plan named the command line `nova`, after
Nova, Palm's codename for webOS that novacom and novaterm carry
([DEV-PUSH.md](DEV-PUSH.md#the-names-phoenix-uses)); the helper is its
window, so it takes the same word and a plain one after it. Not "Ares":
that is LG's current webOS IDE and CLI (`ares-*`), still in use, and a
second "Ares" would confuse both. Not `palm-*`: Palm is someone else's mark
([LEGAL.md](LEGAL.md#name-and-trademarks)). Inside it, the panes keep
Palm's names where Palm had one: **Inspector**, **Log**, **Push**,
**Terminal**; **JIT** is new.

## 3. Why an iPad needs a debugger: JIT

UTM on an iPad runs QEMU's TCG, which translates the guest's code into
host code at run time. iOS lets a process map memory that is both written
and executed only with an entitlement Apple does not give sideloaded apps,
**or while a debugger is attached**: a debugged process (`CS_DEBUGGED`) may
run pages the debugger touched. UTM checks for it at start (UTM
`Services/UTMJailbreak.m:95-98`, `jb_has_debugger_attached`), and without
it tells the user it needs "a remote debugger attached"
(`Platform/Shared/ContentView.swift:108-127`). UTM SE, the App Store build,
needs no JIT: it uses QEMU's threaded interpreter, which is many times
slower ([BUILDING-MAC.md](BUILDING-MAC.md#what-to-install-on-the-ipad)).

So on an iPad that is not jailbroken, someone has to attach a debugger to
UTM each time it starts. That is the "UTM debugger" the owner means, and
the first thing the helper automates.

The debugger is Apple's own `debugserver` on the device. A computer (or an
app on the device, over a loopback VPN) reaches it through the device's
developer services, which need: the device trusting the computer (a
lockdown pairing), **Developer Mode** on (iOS 16 and later), and the
**Developer Disk Image** (DDI) mounted. How the computer reaches those
services changed with iOS 17, and what the debugger must do changed with
iOS 26. Section 4 goes version by version.

## 4. The iOS flow, version by version

Read on 26 November 2026. UTM 5.0.6 (a pre-release from September 2026)
needs iOS 15 or later; the last UTM for iOS 14 is 4.7.5
([docs.getutm.app/installation/ios](https://docs.getutm.app/installation/ios/)).

| iOS / iPadOS | How a computer reaches debugserver | What the debugger must do for UTM | Works today with | The helper |
| --- | --- | --- | --- | --- |
| 15, 16 | Lockdown over usbmuxd (USB or Wi-Fi sync); the classic DDI for that iOS version mounted; `com.apple.debugserver` (or the secure proxy) | Launch or attach, then detach: `CS_DEBUGGED` stays set | Xcode; AltJIT (AltServer, UTM `Platform/UTMData.swift:1154-1190`); Jitterbug; `idevicedebug`; go-ios | Yes. DDI from the user's Xcode (Mac) |
| 17.0 to 17.3.x | CoreDevice: RemoteXPC over a tunnel opened by a separate remote pairing (QUIC/TCP); a TUN device, so root on most tools; the personalized DDI | Same | Xcode 15+; pymobiledevice3 (`remote start-tunnel`, officially only on macOS and Windows for these versions) | **Not in v1**: the helper says "update iOS, or use Xcode" (16.1). StikDebug does not support it either |
| 17.4 to 18.x | Lockdown's **CoreDeviceProxy** service gives the tunnel without a remote pairing and without root (a user-space TCP stack); RSD lists the services; the personalized DDI; `com.apple.internal.dt.remote.debugproxy` | Launch or attach, then detach | StikDebug ("fully supported and stable"); SideStore; JitStreamer-EB (now deprecated); SideJITServer; pymobiledevice3; Xcode | **Yes: the main path** |
| 26.x on chips **without TXM** (A12 to A14, M1) | As 17.4 | Per LiveContainer's guide only A15+/M2+ need the script below; earlier chips attach as before. *To verify* on such an iPad | StikDebug; UTM **4.7.4 or later** ("Support for StikDebug on iOS 26 (non-SE only)") | Yes |
| 26.x on chips **with TXM** (A15 and later, M2 and later) | As 17.4 | The debugger must **stay attached until UTM asks for its JIT region and answer it** (below), then detach. UTM 4.7.0's notes: "iOS 26 breaks the technique that AltJIT and similar tools use" | StikDebug with UTM's script (`legacy.js` in StikDebug's supported-apps list); UTM 4.7.4 or later. iOS 26.4 (24 March 2026): mixed reports, StikDebug working for some, failing for others | **Yes: the hard part** |
| 27 (September 2026) | As 17.4; reports of the DDI failing to mount on some new chips with StikDebug's bundled image | As 26 with TXM; apps that have not adopted the opt-in method lose JIT within seconds. UTM is on the list that has | StikDebug (reported, not confirmed by StikDebug's own table) | *Unknown until tried* (H3v) |

### The iOS 26 TXM handshake

On a TXM device, attaching is no longer enough: pages become executable
only when the **debugger itself writes to them**. UTM (its QEMU, when the
VM starts and TCG allocates its translation cache) and the debugger meet
like this, as StikDebug's UTM script does it (read for the protocol only,
AGPL-3.0, nothing copied: section 6):

1. The debugger attaches to UTM by its process id (`vAttach;<pid>` in the
   GDB remote protocol debugserver speaks) and lets it run (`c`).
2. UTM maps its JIT region and executes `brk #0x69` with the region's
   address in `x0` and its size in `x1`.
3. The debugger gets the stop, reads the instruction at `pc` and checks
   the `brk` immediate is `0x69` (others are skipped).
4. It writes one byte into **each page** of the region (`M<addr>,1:69`,
   batched; StikDebug `JSSupport/JSDebugSupport.swift:104-167`), which
   marks those pages as debugger-modified.
5. It sets `pc` to `pc + 4` (past the `brk`), and after the expected
   number of such stops (one for UTM) detaches (`D`).

UTM starts QEMU once per launch on iPadOS
([BUILDING-MAC.md](BUILDING-MAC.md#start-it)), so the helper keeps the
debug session open from UTM's launch until the user starts the VM, answers
the one `brk #0x69`, then detaches. The VM's memory budget already counts
the translation cache twice for this case (BUILDING-MAC "CPU and memory").

### What the helper automates

From the moment the iPad is connected (USB, or Wi-Fi once paired), each
**Start**:

1. Find the iPad through usbmuxd (Apple's on macOS, libimobiledevice's
   daemon on Linux), read its iOS version, chip and Developer Mode state.
2. Check UTM: installed, which build (UTM with JIT, or UTM SE, which needs
   none), version (4.7.4 or later on iOS 26), and the days left on its
   signing profile (a free Apple ID's last 7: section 5).
3. Mount the DDI if it is not mounted (personalized on iOS 17 and later,
   from the user's Xcode on a Mac).
4. Launch UTM under the debugger (or attach, below), then: on iOS 15 to
   18 and non-TXM 26, detach at once; on TXM devices, stay until the
   `brk #0x69`, answer it, detach. The window shows "UTM has JIT".
5. The user taps the Phoenix VM in UTM (section 16, Q4: whether the helper
   can do this too).
6. Connect to Phoenix's `novad` through the iPad's USB link (section 8),
   wait for it to boot, pair the first time (the six-digit code shows on
   Phoenix's screen in UTM), then show the device: its apps, logs and the
   rest.

**Attach when UTM is opened on the iPad.** UTM can also ask a computer to
attach when it is started from the Home Screen: with "Enable JitStreamer
Attach" on and "JitStreamer IP Address" set in UTM's settings
(`Platform/iOS/Settings.bundle/Root.plist:3248-3278`), it sends `POST
http://<address>/attach/<pid>/` at start and expects `{"success": true,
"message": ...}` (`Platform/UTMData.swift:1199-1234`). The helper serves
that endpoint, so a developer who opens UTM by hand gets JIT too, as long
as the helper runs on the same network. The address is put into the URL
as written, so `192.168.1.20:9172` should give the port: *to verify* (H3v).

## 5. What the user does once

| Step | Who | The helper's part |
| --- | --- | --- |
| An Apple ID. Free: apps signed with it run for **7 days**, at most **3** sideloaded apps per device, **10 App IDs** per 7 days. Paid ($99 a year): a year | user | Explains the choice; shows the days left |
| Install and sign **UTM** (the `.ipa` from UTM's releases) with a **development** certificate, which carries `get-task-allow` (a debugger may attach). UTM recommends **AltStore** (it re-signs every 7 days; source `alt.getutm.app`) or **SideStore**; Xcode or Sideloadly work too. Most "cloud" signing services use the wrong certificate type | user, once and at each expiry | Detects UTM and its expiry; links UTM's install page. Does **not** sign apps itself (Q3) |
| **Trust This Computer** on the iPad (lockdown pairing) | user | Asks for it when the iPad first appears |
| **Developer Mode** (iOS 16+): Settings > Privacy & Security > Developer Mode, restart, confirm. The switch appears once a development-signed app is installed or Xcode has seen the device | user | Detects it and shows where it is |
| Trust the developer profile (Settings > General > VPN & Device Management) | user | Explains the "untrusted developer" error |
| **Xcode** on a Mac (free), for the DDI | user | Finds its DDIs; on Linux asks where they are (Q5) |
| Copy the Phoenix bundle (`scripts/make-utm.sh`) to UTM | user | Later: copies it over USB (UTM's Documents, through house_arrest) |
| Pair the helper with Phoenix (`nova pair`'s code) | user | Asks for the code shown on Phoenix's screen |
| Optional: **StikDebug** on the iPad, for JIT away from a computer (needs a pairing file and LocalDevVPN) | user | Links its guide only (section 6) |

## 6. Licences

Checked 26 November 2026 (each project's licence file):

| Tool | Licence | Use in Phoenix |
| --- | --- | --- |
| [idevice](https://github.com/jkcoxson/idevice) (Rust; usbmuxd, lockdown, pairing, CoreDeviceProxy and RSD, a user-space TCP stack, the image mounter, debugproxy, DVT, installation proxy, heartbeat; C and C++ bindings) | **MIT** | **Bundled**: the helper's device side (below) |
| [go-ios](https://github.com/danielpaulus/go-ios) | **MIT** | Alternative to idevice; not chosen (no JIT handshake, a Go toolchain more) |
| [UTM](https://github.com/utmapp/UTM) | **Apache-2.0** | Read: the attach endpoint, the JIT checks |
| [Jitterbug](https://github.com/osy/Jitterbug) (UTM's author; iOS 14 to 16) | **Apache-2.0** | Read for reference |
| Electron, React, xterm.js, `ssh2` | MIT | Bundled |
| [ares-cli](https://github.com/webosose/ares-cli) (LG's `ares-inspect`) | Apache-2.0 | Its inspector logic may be reused with attribution |
| [libimobiledevice](https://github.com/libimobiledevice/libimobiledevice) (`idevicedebug`, ...) | LGPL-2.1 library, GPL-2.0 tools | Not bundled; usbmuxd on Linux is the system's |
| [pymobiledevice3](https://github.com/doronz88/pymobiledevice3) | **GPL-3.0** | Not bundled, not called |
| [SideJITServer](https://github.com/nythepegasus/SideJITServer) | GPL-3.0 | Not bundled, not called |
| [ios-deploy](https://github.com/ios-control/ios-deploy) (UTM's old tethered launch) | GPL-3.0 | Not used |
| [StikDebug](https://github.com/StephenDev0/StikDebug) (including its `legacy.js`) | **AGPL-3.0** | Read for the protocol only; recommended to users as a separate app |
| [SideStore](https://github.com/SideStore/SideStore), [AltStore](https://github.com/altstoreio/AltStore) | AGPL-3.0 | Recommended to users as separate apps |
| [JitStreamer-EB](https://github.com/jkcoxson/JitStreamer-EB) | none found in the repository | Not used (deprecated, a server) |
| Apple's DDIs, Xcode | Apple's licence | Never shipped; the user's own Xcode supplies them |

**Decisions (recommended):**

1. **Everything the helper ships is permissive.** Its device side is a
   small Rust program, `nova-jit`, on the MIT idevice crate: compiled into
   the app, so its licence must be permissive, and it is.
2. **No GPL or AGPL code is copied or linked**, and none is needed. The
   TXM handshake is written from UTM's side (Apache-2.0) and the GDB
   remote protocol's documentation; StikDebug's AGPL script is read only to
   confirm the protocol (as LEGAL.md treats LuneOS's GPL code: reading is
   fine, copying is not). The author of `nova-jit`'s handshake writes it
   from this section's description, not from StikDebug's file.
3. **Calling a separately installed GPL tool** as another program (not
   linked, not shipped) would leave the helper's own licence alone, but v1
   needs none: idevice covers 15, 16 and 17.4 onward. For 17.0 to 17.3 the
   helper points to Xcode instead of shelling out to pymobiledevice3.
4. **Apple's files stay Apple's**: the DDIs come from the user's Xcode; the
   helper keeps no copy in its package or the repository.
5. `tools/check-licences.py` gains the helper's npm and Cargo dependency
   trees, failing on anything not permissive; LEGAL.md gets a "Nova Helper"
   section with the table above.

## 7. Architecture

```
 Nova Helper (Electron)
 ┌──────────────────────────────────────────────────────────────┐
 │ Renderer: React + TypeScript (contextIsolation, no Node)      │
 │  Devices · VMs · Start · App grid · Inspector · Log · QML     │
 │  · Push · Terminal · JIT                                      │
 │                  │ typed IPC (preload, contextBridge)          │
 │ Main process (Node 22)                                        │
 │  DeviceRegistry ── simulators (discovery files)               │
 │                 ├─ nova devices (paired, mDNS, USB link)      │
 │                 └─ iPads (nova-jit, usbmuxd)                  │
 │  JitService ──── nova-jit sidecar (Rust, idevice, JSON lines) │
 │  UtmService ──── utmctl (Mac)                                 │
 │  NovaClient ──── tools/nova library (TLS to novad, pairing,   │
 │                  push, log, launch, forward)                   │
 │  InspectorService ─ forwards to WAM's 9998, /json/list,       │
 │                  DevTools windows                              │
 │  AttachServer ── UTM's "JitStreamer attach" endpoint (opt-in) │
 └──────────────────────────────────────────────────────────────┘
          │ usbmuxd (USB / Wi-Fi)          │ TLS 6965 (paired)
     iPad: debugserver, UTM ──── QEMU ──── Phoenix VM: novad, WAM, shell
```

### The main process

- **DeviceRegistry**: one list of targets, each with a kind (`sim`,
  `utm-mac`, `utm-ipad`, `device`), how it is reached and what it offers.
- **JitService** runs `nova-jit` (bundled per platform: macOS arm64 and
  x86_64, Linux x86_64 and arm64) and talks JSON lines on its stdio:
  - `devices` (usbmuxd list with iOS version, chip, TXM or not, Developer
    Mode, paired);
  - `pair` (asks the iPad to trust; on a Mac, usually already done by
    Finder, and the record is read from usbmuxd without root);
  - `status UDID` (UTM installed, build, version, profile expiry from
    misagent);
  - `mount-ddi UDID [--xcode PATH]`;
  - `jit launch UDID com.utmapp.UTM` (launch suspended through DVT's
    process control, attach, then the per-version handling of section 4)
    and `jit attach UDID PID` (for the attach endpoint, after checking the
    process is UTM);
  - `forward UDID DEVICEPORT` (a local port to a TCP port on the iPad's
    loopback through usbmuxd, as `iproxy` does: section 8).
  Progress and errors come back as events the UI shows step by step.
- **UtmService** (Mac): `utmctl list`, `start`, `stop`, `status`
  (`/Applications/UTM.app/Contents/MacOS/utmctl`, a wrapper over UTM's
  AppleScript). `utmctl ip-address`, `exec` and `file` need the QEMU guest
  agent, which Phoenix's image does not have; the helper does not need
  them (section 8).
- **NovaClient** is `tools/nova`'s library (DEV-PUSH 6.1), imported, not
  shelled out: pairing, `push`, `log -f`, `launch`, `install`, `rescan`,
  `restart`, `status`, `revert`, and one addition this plan asks of
  `novad`: **`forward`** (section 9.1).
- **InspectorService**, **QmlDebugService**, **TerminalService**: section 9.
- **AttachServer**: off by default; listens on the LAN only while on
  (section 13).

### The renderer

- **Devices**: the sidebar. Each target with its state (iPad: connected,
  Developer Mode, UTM and its expiry, JIT; VM: stopped, booting, up;
  Phoenix: paired, build, Developer Mode).
- **Start**: one button per target, running the steps of section 4 (iPad)
  or `utmctl start` then wait (Mac), each step ticked as it completes,
  with what to do when one fails.
- **Apps**: the device's launcher as a grid of icons (from `novad`: the
  application manager's list and each app's icon). Click: launch and
  inspect. Menu: launch only, close, inspect the running page, remove,
  launch with parameters (JSON, as `--launch '<appId>:{json}'`).
- **Log**: the journal, live, filtered by app, service, unit and level,
  with search, pause and save.
- **Shell**: the QML debugger's state and a "Connect Qt Creator" panel.
- **Push**: `nova push` with its output, the overlay's contents
  (`nova status`) and Revert to Image.
- **Terminal**: xterm.js on `nova term`.
- **JIT**: the iPad's checklist (section 5) and a log of each attach.

Shared UI pieces come from `apps/shared/phoenix-ui` where they fit; the
look is a desktop tool's, not the device's.

## 8. Reaching Phoenix inside UTM

`novad` listens on 6965 in the guest (DEV-PUSH 6.2). Every other tool goes
through it (section 9.1), so **one forwarded port per VM is enough**, and
it is TLS with paired keys.

- **UTM on a Mac.** The bundle's emulated VLAN forwards host
  `127.0.0.1:2222` to the guest's 22 today (`scripts/make-utm.sh:247-248`).
  It gains `127.0.0.1:6965` to 6965 for `novad`. The helper finds the VM
  with `utmctl list`, starts it, and connects to that port. UTM's Shared
  Network mode would give the VM its own address but needs the guest
  agent or mDNS to learn it; the forward needs neither.
- **UTM on an iPad, over USB (the default).** The bundle forwards the same
  ports on the **iPad's own** `127.0.0.1` (QEMU's user networking in UTM's
  process). usbmuxd can open a TCP connection from the computer to any port
  listening on the device's loopback (what `iproxy` does, and how test
  tools reach a server an app opens on the device), so `nova-jit forward`
  gives the helper a local port that ends at `novad`. Nothing is open on
  the iPad's Wi-Fi. Over Wi-Fi sync (an iPad paired for it in Finder) the
  same works without the cable. *To verify* on the owner's iPad (H3v): that
  usbmuxd reaches a port UTM's QEMU listens on.
- **UTM on an iPad, over the LAN (opt-in).** `make-utm.sh --for ipad
  --lan` forwards `novad` on all the iPad's addresses instead; `novad`'s
  pairing protects it, and iOS may ask UTM for Local Network access. For a
  developer with no cable.
- A **phone or tablet running Phoenix** is reached as DEV-PUSH plans (LAN,
  USB network link); the helper is the same from there on.

## 9. The developer tools

### 9.1 `nova forward` (an addition to DEV-PUSH)

Palm's novacom had port forwarding (`connect tcp-port`), LG's `ares-inspect`
opens an SSH forward to WebAppMgr's port (ares-cli `lib/inspect.js:23-24,
128`). `novad` gets the same: **`forward`** opens a stream over the paired
TLS connection to a port on the device's loopback, **only for ports in a
fixed list** while Developer Mode is on: 9998 (WebAppMgr's inspector), the
shell's QML debug port (below), 22 (SSH, for `nova term`), and the
JavaScript services' inspector ports. `nova forward 9998` on the command
line, the same call in the helper. So the inspector and the QML debugger
never listen on a network, on any kind of device.

### 9.2 Web Inspector

- **The device.** WebAppMgr starts Chromium with
  `--remote-debugging-port=9998` on OSE and LuneOS alike, in every build
  (meta-webosose `d7ed46c` `recipes-webos/wam/wam/webapp-mgr.sh.in:187`;
  meta-webos-ports `ec5e878` `recipes-webos-ose/wam/wam/webapp-mgr.sh.in:222`),
  listening on the loopback. Phoenix's own `phoenix-wam.sh` is sourced just
  before WebAppMgr starts (its header, lines 4-10), so it can remove the
  switch when Developer Mode is off (section 13); PRE-IMAGE-CHECKLIST G3
  says Developer Mode already, which today is not so.
- **The flow** (as `ares-inspect --app`): `nova launch ID` (or the running
  card), then the targets from `/json/list` through the forward, matched
  to the app by its URL (`ares-cli lib/inspect.js:401-402`), then a
  DevTools window. The device's own DevTools front end (served by the
  runtime) when it has one; otherwise Electron's bundled front end
  (`devtools://devtools/bundled/inspector.html?ws=...`), which is a newer
  Chromium than the device's 120 or 151. Which works well enough is a
  thing to try (H2).
- **JavaScript services** (Node.js on the device): the Node inspector, as
  `ares-inspect --service`; later.

### 9.3 Logs

`nova log -f` (DEV-PUSH 6.1): `novad` streams the journal as JSON
(`journalctl -o json -f` with the filter), never a shell. The filters the
Log pane offers are the units G3 names: `surface-manager-daemon` (the
shell's `console.log`), `webapp-mgr` (pages' consoles), `ls-hubd` (refused
calls), Phoenix's services, plus by app id. **Save** writes what is shown;
**Diagnostics** runs `phoenix-diag` (G2) and fetches its archive.

### 9.4 The shell's QML debugger and profiler

Qt's QML debugger needs the debugging code compiled into the program
(`QT_QML_DEBUG`) and the program started with
`-qmljsdebugger=port:<port>[,host:<address>][,block]`; Qt warns to use it
only in a safe environment
([Qt: Debugging QML Applications](https://doc.qt.io/qt-6/qtquick-debugging.html)).

- **On the device**: luna-surfacemanager is OSE's program, so a
  meta-phoenix bbappend builds it with `QT_QML_DEBUG` (a
  `phoenix-devmode` package, or the image's debug variant: Q7), and
  Developer Mode's **QML Debugging** switch restarts the shell with
  `-qmljsdebugger=port:3768,host:127.0.0.1` (reached through
  `nova forward 3768`). How the unit passes arguments to it is to read in
  the image (P3v of DEV-PUSH).
- **In the helper**: Shell > **Enable QML debugging** (the switch, through
  `novad`), then the forward, then "In Qt Creator: Debug > Start
  Debugging > Attach to QML Port, host 127.0.0.1, port N", with the port
  copied. The QML Profiler connects the same way. Qt Creator is the user's
  own install (it is GPL; the helper only points to it).

### 9.5 Push and Terminal

The Push pane is `nova push` and its friends (DEV-PUSH 6.1) with their
output. The Terminal is `nova term` (SSH as `user` with the paired key,
DEV-PUSH; [TERMINAL.md](TERMINAL.md) T4) through `nova forward 22`,
drawn by xterm.js with `ssh2` in the main process.

## 10. The simulator

### 10.1 phoenix-sim's Developer menu

phoenix-sim's menus today are Device, Services, Simulate and View, with
the frame-rate counter and touch plot under View > Developer Overlays
(`shell/qml/sim.qml:1317-1320`), and the simulated Developer Mode is a
setting (`sim.qml:687-692, 1947-1948`). A **Developer** menu gathers the
tools, each available while the simulated Developer Mode is on:

| Item | Does |
| --- | --- |
| Web Inspector... | The cards' pages, pick one: Qt WebEngine's DevTools (`QWebEnginePage::setDevToolsPage`) in a window. Also `--remote-debugging PORT` / `QTWEBENGINE_REMOTE_DEBUGGING=127.0.0.1:PORT` for Chrome's `chrome://inspect` and the helper; always the loopback, as Qt WebEngine then accepts any origin ([Qt WebEngine debugging](https://doc.qt.io/qt-6/qtwebengine-debugging.html)) |
| QML Debugger | Shows the port: phoenix-sim built with `QT_QML_DEBUG` (a CMake option, on by default in developer builds) and started with `-qmljsdebugger=port:3768,host:127.0.0.1` (`./phoenix run ... --qml-debug`) |
| Log | The simulator's own log window: the shell's QML console and the pages' consoles, filterable, as on the device |
| Allow Nova Helper | Writes the discovery file (10.2) |
| Developer Overlays | Moves here from View |

### 10.2 The simulator as a device

A running phoenix-sim with **Allow Nova Helper** on writes
`~/.config/nova/sims/<instance>.json` (removed on exit): its instance
(`--instance`), process id, the inspector's port, the QML debugger's port,
and a local socket for `nova`'s requests (DEV-PUSH's `--device sim`:
launch, push into the simulator's overlay, log). The file is readable only
by the user. The helper lists each one as a device, with the same panes;
Start becomes `./phoenix run` with the chosen form factor when none runs.

## 11. Where the code lives

| Path | What |
| --- | --- |
| `tools/nova-helper/` | The Electron app: its own npm package with its own lockfile (Electron is large, and `apps/` is the device's apps), `src/main/`, `src/preload/`, `src/renderer/` (React, Vite), tests |
| `tools/nova-helper/jit/` | `nova-jit`, the Rust sidecar (Cargo, idevice pinned to a version) |
| `tools/nova/` | DEV-PUSH's `nova` library and CLI, imported by the helper; gains `forward` |
| `shell/sim/` and `shell/qml/sim.qml` | The Developer menu, the discovery file, `--qml-debug`, `--remote-debugging` |
| `scripts/make-utm.sh`, `tools/check-utm-bundle.py` | The `novad` forward; `--lan` |
| meta-phoenix | `novad`'s forward list; the WAM switch gated on Developer Mode; luna-surfacemanager with QML debugging |
| `./phoenix helper` | Builds and starts the helper from a checkout |

`tools/` already holds the host tools (`tools/nova/` in DEV-PUSH,
`tools/platform-mock/`, the test scripts); the helper is one of them, not a
device app. Its npm package is not an `apps/` workspace, so the apps'
builds and CI do not download Electron.

## 12. Packaging

- **macOS first**: a universal (arm64 and x86_64) `.dmg`, signed with a
  Developer ID certificate, hardened runtime, notarized with `notarytool`
  and stapled (electron-builder or Electron Forge, both MIT). `nova-jit`
  is signed inside it. The same certificate and notarization as the
  simulator's download: BETA-RELEASE **D2** on the agent board ("packaged,
  signed and notarized Mac simulator"). The helper is a second artifact of
  that job, or later the simulator's companion in one download (Q8).
- **Linux later**: an AppImage (x86_64, arm64), needing the system's
  `usbmuxd` for iPads (Ubuntu's package). Then a tarball for `./phoenix`.
- **Windows** not planned: Apple's device drivers and usbmuxd make it a
  project of its own (Q2).
- Updates: the beta downloads' feed, as the simulator's; no auto-updater
  in v1.

## 13. Security

- **Phoenix side through `novad` only**, paired and TLS (DEV-PUSH 6.4,
  9). The helper is a `nova` client and holds the same key; v1 stores it
  encrypted with Electron's `safeStorage` (the Keychain on macOS,
  libsecret on Linux), and DEV-PUSH's `~/.config/nova/key` moves there too,
  so the CLI and the helper share one key in the keychain (Q6).
- **No listening debug ports on any network.** The inspector and the QML
  debugger listen on the device's loopback and are reached through
  `nova forward`'s fixed list. **WebAppMgr's 9998 is on in every image
  today** (section 9.2): `phoenix-wam.sh` removes the switch unless
  Developer Mode is on. A finding for PRE-IMAGE-CHECKLIST G3 and X.
- **The iPad's lockdown pairing** stays where Apple keeps it (usbmuxd).
  The helper never copies it, never sends it anywhere. A **pairing file
  for StikDebug** would be the computer's lockdown key for that iPad, a
  secret: if ever offered (later), it is written straight to the iPad,
  never saved elsewhere.
- **The attach endpoint** (UTM's JitStreamer attach) has no authentication
  on UTM's side, so it is off by default, and when on: listens only while
  the helper runs, answers only devices the helper already knows (by
  their address), attaches only after checking the process id is UTM's
  (`com.utmapp.UTM`) on that device, and rate-limits.
- **Electron**: `contextIsolation` on, `nodeIntegration` off, a strict
  Content Security Policy, no remote content in the main window (DevTools
  windows only to the forwarded loopback ports), the IPC surface typed and
  checked. No telemetry.
- **No secrets in the app**: no Apple ID, no Phoenix server credentials,
  nothing on the agent board or in logs. The helper never asks for an
  Apple ID password: signing stays with AltStore, SideStore or Xcode.
- **Apple's rules**: attaching a debugger to an app the user signed for
  development on their own device is what Xcode does. The helper ships
  no Apple files and does not get around signing.

## 14. Tests

**In CI, without devices** (Linux; `tools/web-tests.txt` and
`tools/ci-checks.sh` as the repository's rules say):

- `nova-jit`: unit tests against a **fake debugserver** (a GDB remote
  protocol server in the test): attach, continue, a `brk #0x69` stop with
  `x0`/`x1`, the page writes (count, addresses, checksums), `pc + 4`,
  detach; other `brk` immediates skipped; timeouts; the non-TXM path.
  Version and chip to path selection from recorded device answers.
- The attach endpoint: UTM's request and answer shapes
  (`UTMData.swift:1199-1234`), refusal of unknown devices and of a pid
  that is not UTM.
- UtmService against a fake `utmctl` script; NovaClient against DEV-PUSH's
  fake-root `novad` (`tools/test-nova.cjs`), including `forward`'s list.
- The renderer: vitest for the components and state; Playwright's
  Electron driver for the window under `xvfb-run`: a fake device with
  apps, launch and inspect opening a DevTools window on a test page,
  logs streaming and filtering.
- The simulator: `tools/test-sim-devtools.cjs`: phoenix-sim with
  `--remote-debugging` lists its cards in `/json/list`; the discovery file
  appears and goes; with `--qml-debug` the port answers Qt's handshake.
- `make-utm.sh`: `tools/test-make-utm.py` and `check-utm-bundle.py` for
  the new forward and `--lan`.
- Licences: the helper's dependency trees in `tools/check-licences.py`.

**On the owner's Mac and iPad (local)**: the matrix of section 4 on what
the owner has (which iPad, which iOS: Q1): a fresh install of UTM through
AltStore or SideStore; Start from cold; JIT reported by UTM; the VM boots
and its boot time; usbmuxd reaching `novad`; pairing; an app launched and
inspected; logs; Qt Creator attached to the shell; a push and Revert; the
attach endpoint from a Home Screen launch; a 7-day expiry shown. On the
Mac: utmctl start and stop, the same tools. Each result to the board.

## 15. Phases and who does what

Sizes: S a day or less, M a few days, L a week or more. Cloud writes code
and tests; local runs it on the owner's Mac and iPad; the owner decides.

| Phase | What | Size | Who | Needs |
| --- | --- | --- | --- | --- |
| **H0** | The owner's answers to section 16 | — | owner | this plan |
| **H1** | phoenix-sim's Developer menu: inspector (in-process and `--remote-debugging`), `--qml-debug`, log window, discovery file; tests | M | cloud | H0 |
| **H2** | `tools/nova-helper/`: Electron shell, devices (simulators first), app grid, launch and inspect, logs, QML panel, push and terminal over `nova`; Playwright tests | L | cloud | H1; DEV-PUSH P2 for real devices (`nova`, `novad` with `forward`) |
| **H3** | `nova-jit` on idevice: devices, Developer Mode, UTM status, DDI mount from Xcode, launch and attach, the TXM handshake, usbmuxd forward; the attach endpoint; fake-debugserver tests | L | cloud | H0 (Q3, Q5) |
| **H3v** | On the owner's iPad and Mac: section 14's list; which iOS paths work; report to the board | M | local | H3, an image with `novad` (DEV-PUSH P3v), UTM signed on the iPad |
| **H4** | `make-utm.sh`'s `novad` forward and `--lan`; the WAM inspector gated on Developer Mode; QML debugging in the shell (meta-phoenix) | M | cloud | DEV-PUSH P3 |
| **H4v** | A VM image with H4: inspector, QML debugger, logs through the helper | S | local | H4 |
| **H5** | Packaging: signed, notarized `.dmg` (with D2); later the AppImage | M | cloud (config), local (signing, notarizing on the Mac) | H2, H3, a Developer ID |
| **Later** | Copy the `.utm` to the iPad from the helper; start the VM from the helper (Q4); JavaScript services' inspector; Linux AppImage; `nova generate` from the helper | M each | cloud, local | owner |

H1 can start at once. H3 does not wait for Phoenix's image: it is about
UTM and the iPad, and is checked with any VM in UTM.

## 16. Decisions (the owner, 26 November 2026)

| # | Decision |
| --- | --- |
| 1 | **The test device runs iOS 27.** That is the least proven case (section 4: only apps that adopted Apple's new opt-in keep JIT; UTM is reported among them; DDI mounting has failed on some new chips). H3 builds `nova-jit` for iOS 27 first, with 17.4-18 and 26 behind it, and H3v on the owner's device is the first real proof. If iOS 27 turns out to give UTM no JIT a debugger can provide, the helper says so plainly and UTM SE is the fallback. Local should not update the test device's iOS during H3v |
| 2 | **Mac and Linux together** from the first release (no Windows). Linux needs `usbmuxd` (the system's package) and Xcode's DDI folder copied from a Mac (decision 5); both platforms are in CI and H5 packages a Linux AppImage beside the Mac `.dmg` |
| 3 | **The helper attaches the debugger itself** (`nova-jit`, permissive); StikDebug is documented for when away from a computer |
| 4 | The user taps the VM in UTM in v1 |
| 5 | DDIs: ask for Xcode's DDI folder; never download or ship Apple's files |
| 6 | One key for `nova` and the helper, in the OS keychain (macOS Keychain, Linux Secret Service) |
| 7 | QML debugging behind Developer Mode in every image, loopback only |
| 8 | Ship separately from the simulator download at first, with the same signing |
| 9 | The name is **Nova Helper** |
| 10 | Gate WebAppMgr's port 9998 on Developer Mode in all images, **now**, as a 1.0 core fix apart from the helper |

## 17. Risks

- **Apple changes JIT again.** iOS 26 broke the old attach (UTM 4.7.0's
  notes), 26.4 broke it for some, and iOS 27 keeps JIT only for apps that
  adopted the new method. Each release can need a new handshake or end it.
  Mitigation: `nova-jit` is a small, separately versioned part; UTM SE
  (no JIT) stays the fallback; the helper says plainly when JIT is not
  possible.
- **DDI availability.** New chips on iOS 27 have been reported failing to
  mount a bundled DDI. Using the user's current Xcode is the most likely
  to match.
- **Free Apple IDs**: 7-day signing, 3 apps per device, 10 App IDs a week;
  AltStore or SideStore, or a paid account, are needed for comfort.
- **Apple policy.** The App Store's UTM SE shows Apple accepts emulators
  without JIT; a debugger-based JIT relies on developer features meant for
  development. Apple could restrict Developer Mode or debugserver further.
- **AGPL.** The only implementation of the TXM handshake in the open is
  AGPL. The plan writes its own from UTM's side and the protocol; a
  contributor must not paste StikDebug's code.
- **idevice is young and changes fast**: pinned, with tests against the
  fake debugserver, and updated deliberately.
- **Performance**: TCG on an iPad is slow and memory-bound
  ([BUILDING-MAC.md](BUILDING-MAC.md#what-to-expect)); the helper makes it
  easy, not fast.
- **usbmuxd to UTM's loopback** is expected but unproven (section 8); the
  LAN forward is the fallback.
- **Electron's DevTools against an older Chromium** may miss features;
  the device's own front end, when served, avoids it.

## 18. Sources

Read 26 November 2026.

- UTM, Apache-2.0, `main` at `3d4b8d8` (18 November 2026):
  <https://github.com/utmapp/UTM>: `Services/UTMJailbreak.m:95-98, 300-340`,
  `Platform/Main.swift:54-67`, `Platform/Shared/ContentView.swift:108-127`,
  `Platform/UTMData.swift:1143-1234`,
  `Platform/iOS/Settings.bundle/Root.plist:3248-3278`,
  `Documentation/TetheredLaunch.md` (the iOS 14 method with ios-deploy).
- UTM's releases: 4.7.0 ("iOS 26 breaks the technique that AltJIT and
  similar tools use"), 4.7.4 ("(iOS) Support for StikDebug on iOS 26
  (non-SE only)"), 5.0.6 (minimum iOS 15):
  <https://github.com/utmapp/UTM/releases>,
  <https://newreleases.io/project/github/utmapp/UTM/release/v4.7.0>,
  <https://newreleases.io/project/github/utmapp/UTM/release/v5.0.6>.
- UTM's documentation: installing on iOS
  <https://docs.getutm.app/installation/ios/>; scripting and `utmctl`
  <https://docs.getutm.app/scripting/scripting/>; remote control (URL
  commands removed in 4.5.1, Shortcuts on iOS 16+)
  <https://docs.getutm.app/advanced/remote-control/>.
- StikDebug, AGPL-3.0: <https://github.com/StephenDev0/StikDebug>
  (README's compatibility table; `SUPPORTED_APPS.md`: UTM uses
  `legacy.js`; `StikDebug/Scripts/legacy.js`;
  `StikDebug/JSSupport/JSDebugSupport.swift:104-167`;
  `StikDebug/JSSupport/RunJSView.swift:80-101`), <https://stikdebug.org/>.
- LiveContainer's JIT guide (A15+/M2+ need a script on iOS 26; tools
  compared; JitStreamer-EB deprecated):
  <https://livecontainer.github.io/docs/guides/jit-support>.
- iOS 26.4 and JIT: <https://piunikaweb.com/2026/03/26/ios-26-4-may-break-jit-for-sideloaded-apps/>.
- iOS 27 and JIT (opt-in apps, UTM among them):
  <https://builds.io/blog/technologies/ios-technologies/ios-27-beta-sideloading-broken-fix/>;
  DDI mounting on new chips: <https://github.com/Xarber/StikDebug27>.
- RetroArch's forum on iOS 26 JIT:
  <https://forums.libretro.com/t/what-is-the-current-situation-with-ra-on-ios-26-and-jit-support/49244>.
- idevice, MIT: <https://github.com/jkcoxson/idevice>. JitStreamer-EB:
  <https://github.com/jkcoxson/JitStreamer-EB>.
- pymobiledevice3, GPL-3.0 (17.0 to 17.3 tunnels on macOS and Windows; the
  lockdown tunnel from 17.4): <https://pypi.org/project/pymobiledevice3>.
- go-ios (MIT) <https://github.com/danielpaulus/go-ios>; libimobiledevice
  (LGPL-2.1, GPL-2.0) <https://github.com/libimobiledevice/libimobiledevice>;
  Jitterbug (Apache-2.0) <https://github.com/osy/Jitterbug>; SideJITServer
  (GPL-3.0) <https://github.com/nythepegasus/SideJITServer>; SideStore
  (AGPL-3.0) <https://github.com/SideStore/SideStore>; AltStore
  (AGPL-3.0) <https://github.com/altstoreio/AltStore>; ios-deploy
  (GPL-3.0) <https://github.com/ios-control/ios-deploy>.
- Apple: membership limits (free: 10 App IDs expiring after 7 days, 3 apps
  per device) <https://developer.apple.com/support/compare-memberships/>;
  AltStore's App ID FAQ <https://faq.altstore.io/altstore-classic/app-ids>;
  Developer Mode
  <https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device>.
- WebAppMgr's start script: meta-webosose `d7ed46c`
  `meta-webos/recipes-webos/wam/wam/webapp-mgr.sh.in:187, 243-247`;
  meta-webos-ports `ec5e878`
  `meta-luneos/recipes-webos-ose/wam/wam/webapp-mgr.sh.in:222`.
- LG's ares-cli, Apache-2.0, `develop`: <https://github.com/webosose/ares-cli>
  (`lib/inspect.js:23-24, 128, 371-374, 401-402`); its guide
  <https://www.webosose.org/docs/tools/sdk/cli/cli-user-guide/>.
- Qt: Debugging QML Applications
  <https://doc.qt.io/qt-6/qtquick-debugging.html>; Qt WebEngine Debugging
  and Profiling <https://doc.qt.io/qt-6/qtwebengine-debugging.html>.
- In this repository: [DEV-PUSH.md](DEV-PUSH.md),
  [BUILDING-MAC.md](BUILDING-MAC.md#run-it-on-an-ipad-with-utm),
  `scripts/make-utm.sh`, [PRE-IMAGE-CHECKLIST.md](PRE-IMAGE-CHECKLIST.md)
  G1-G4, `meta-phoenix/recipes-phoenix/phoenix-wam-conf/files/phoenix-wam.sh`,
  `shell/qml/sim.qml`, [LEGAL.md](LEGAL.md), [TERMINAL.md](TERMINAL.md).
