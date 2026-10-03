# Android apps

> **Decision (28 September 2026, from the project owner).** Android apps come
> **early, before the phones are finished**, not after: people expect their
> apps, and having them at launch is what makes Phoenix worth trying. PWAs
> stay the lead, since this is a web operating system, but Android support
> moves ahead of Milestone 5 on the emulator image and first devices.

How Phoenix could run Android apps, so that the apps nobody will ever
write for webOS (a bank's, a bus company's, a messenger's) are still there,
and how each Android app would look and behave like a webOS app: its own
launcher icon, its own card, notifications in the dashboard, the back
gesture.

This is a plan for Milestone 5 work that can start earlier on the emulator
image. Nothing here has run on a Phoenix device (see
[ROADMAP.md](ROADMAP.md)). Facts are as of **28 September 2026**; anything
unverified says so. It builds on the device plan in
[HARDWARE.md](HARDWARE.md) and the app gaps in [APP-GAPS.md](APP-GAPS.md).

## Summary

- **Use Waydroid.** It is the only maintained, general way to run Android
  apps on a Linux phone, and every comparable project (Ubuntu Touch,
  Droidian, FuriOS, Mobian, postmarketOS, and now LuneOS) uses it or a
  fork of it. Anbox is dead, Shashlik is dead, Sailfish's AppSupport is
  proprietary.
- **LuneOS has already done the webOS part.** In September 2026 LuneOS
  merged Waydroid 1.6.3 with patches that turn every Android app into a
  webOS app (`waydroid.<package>`), show each app's window as a card under
  luna-surfacemanager, and post Android notifications to
  `com.webos.notification`
  ([meta-webos-ports PR #810](https://github.com/webOS-ports/meta-webos-ports/pull/810),
  merged 4 September 2026). Phoenix runs on the same OSE components, so we
  start from their recipes and patches rather than from scratch.
- **Keep an eye on Android Translation Layer (ATL).** It runs Android apps
  without a container, with far less memory, and it is active, but today
  it runs a curated set of simple apps. Not a first choice; a possible
  second runtime later for light apps.
- **No Google apps.** Phoenix will not ship or offer Google Mobile
  Services. F-Droid is the default app source; microG is an opt-in the
  user installs. Apps that need Play Integrity (most banking apps) will not
  work, and we say so up front.
- **It costs memory and battery.** Plan for 4 GB of RAM as the minimum and
  a container that is frozen whenever no Android app is on screen.

## Contents

1. [Options compared](#1-options-compared)
2. [How other projects did it](#2-how-other-projects-did-it)
3. [Waydroid in brief](#3-waydroid-in-brief)
4. [Android apps as webOS apps](#4-android-apps-as-webos-apps)
5. [Devices and kernels](#5-devices-and-kernels)
6. [Battery, memory and storage](#6-battery-memory-and-storage)
7. [App sources](#7-app-sources)
8. [Legal](#8-legal)
9. [Recommendation and plan](#9-recommendation-and-plan)
10. [Risks](#10-risks)
11. [Open questions](#11-open-questions)
12. [Sources](#12-sources)

---

## 1. Options compared

| Option | How it works | State (Sept 2026) | Licence | App compatibility | Cost on the device | Fit for Phoenix |
| --- | --- | --- | --- | --- | --- | --- |
| **[Waydroid](https://waydro.id/)** | A full LineageOS-based Android in an LXC container on the host kernel; binder through binderfs; graphics through the host's Mesa (or libhybris on Halium); each Android window can be its own Wayland surface ("multi-window") | **Active.** 1.6.3 on 28 May 2026 (initial Android 16 image support); default image LineageOS 20 (Android 13); notifications forwarded to the host since 1.6.0 (21 November 2025) ([releases](https://github.com/waydroid/waydroid/releases)) | GPL-3.0 (tools); images are LineageOS (Apache-2.0 and others) | High: it *is* Android. Fails on Play Integrity, some DRM, hardware the container cannot see | ~1 GB image; several hundred MB RAM while running; frozen when idle | **Recommended** |
| Anbox | The predecessor: Android in a container, rendering through its own protocol | **Dead.** Deprecated 3 February 2023; GitHub organisation archived 13 February 2024; "development has shifted to Waydroid" ([Wikipedia](https://en.wikipedia.org/wiki/Anbox)) | GPL-3.0 | Old Android 7 | — | No. (Its `anbox-modules` repository still hosts the out-of-tree binder module LuneOS builds for old kernels) |
| **[Android Translation Layer (ATL)](https://gitlab.com/android_translation_layer/android_translation_layer)** | Reimplements Android's app APIs on desktop Linux: AOSP's ART and libcore, Android views drawn as GTK 4 widgets, no Android system | **Active** (GitLab activity 28 September 2026); NLnet / NGI Mobifree grant from August 2024 ([NLnet](https://nlnet.nl/project/ATL/)); packaged in Alpine / postmarketOS | GPL-3.0-or-later | **Low**: "still in very early days" ([Hackaday, Sept 2025](https://hackaday.com/2025/09/10/a-look-at-not-an-android-emulator/)); runs NewPipe, Öffi, some games; each API is implemented as apps need it, like Wine | Low: one process per app, no container | Later, for selected light apps. Needs GTK 4 in the image and a Wayland client that luna-surfacemanager accepts |
| Shashlik | KDE project: Android apps on Plasma | Inactive since about 2016 (*exact end unverified*) | GPL | Android 4.4 | — | No |
| Sailfish **AppSupport** | Jolla's Android layer (formerly Alien Dalvik); Android 13 level since Sailfish OS 5; on the 2026 Jolla Phone ([Sailfish docs](https://docs.sailfishos.org/Support/Help_Articles/Android_App_Support/)) | Active, commercial | **Proprietary**, licensed per device | High | Similar to Waydroid | No: not available to other projects |
| FuriOS "Andromeda" | FuriLabs' fork of Waydroid for the FLX1 phones | Active | Based on Waydroid (GPL-3.0) | High | Similar | Worth reading for fixes; not a separate option |
| Emulation (QEMU / Android Emulator) | A full Android VM | Works on desktops | Various | High | Far too heavy for a phone | No |

---

## 2. How other projects did it

| Project | Android support | Integration with its shell | Lessons for Phoenix |
| --- | --- | --- | --- |
| **LuneOS** (webOS-ports) | Waydroid 1.6.3 in `meta-luneos` (`recipes-support/waydroid/`), on mainline and Halium machines (`tissot-halium`, `mido-halium`, `halium-arm64` for the Pixel 3a, `mindphone`) | Patched Waydroid: one webOS app directory (`appinfo.json`, icon) per launchable Android package, id `waydroid.<package>` to match the Wayland `app_id` Waydroid's hwcomposer sets; a long-running launcher per app so SAM can track and close it; notifications to `com.webos.notification` (`createToast`, or `createAlert` when there are actions); LuneOS's luna-surfacemanager changed to respect the card area; a launch daemon that cut app start from 17 s to under 1 s; NFC left to the host; kernel fragment `waydroid-anbox.cfg` | **Our reference.** Same compositor, same SAM, same notification service. Their patches are GPL-3.0 (Waydroid's licence); the layer is MIT. We can carry the same recipes in `meta-phoenix` or depend on their layer |
| **Ubuntu Touch** (UBports) | Waydroid preinstalled on all Halium 9+ devices since focal; `waydroid init` by the user ([docs](https://docs.ubports.com/en/latest/userguide/dailyuse/waydroid.html)) | Full-screen Android UI or apps via .desktop files; notifications did not reach Lomiri (forum reports before Waydroid 1.6.0); Mir patches for per-app windows | Waydroid on Halium works across ~100 devices; users accept "some apps won't run" if told plainly. Their docs warn about battery and Play Integrity |
| **Droidian** | Waydroid ([docs](https://docs.droidian.org/info/android-apps/), own packaging) | Phosh; apps get .desktop entries | Halium + Waydroid is the common pairing |
| **FuriOS** (FuriLabs FLX1) | "Andromeda", a Waydroid fork with many fixes | Phosh | Shows a company shipping it as a selling point |
| **Mobian / postmarketOS** | Waydroid packages; postmarketOS also packages ATL | Phosh, Plasma Mobile | Kernel options for Waydroid are part of pmOS device kernels (`pmbootstrap` has a Waydroid config check), which we inherit for mainline phones |
| **webOS TouchPad: ACL** (Open Mobile, 2012) | "Application Compatibility Layer", sold per device: a chroot of Android 2.3 with `binder` and `logger` modules built for the TouchPad's 2.6.35 kernel; each Android app drew into a webOS card through PDK/SDL | One card per Android app; a generated launcher icon per app; Android notifications into webOS's; intents for links, mail and maps handed to webOS apps; a pause control to stop the Android side; uninstall that removed the whole layer | **Closed source and not redistributable, and tied to its 2011 kernel: nothing can be reused.** Its ideas are what the user saw on a TouchPad, and Phoenix's plan keeps all of them (section 4), on Waydroid. Android cards get the same app menu as web apps (Back, Forward, Reload) |
| **Sailfish OS** | AppSupport (proprietary) | Deep: Android apps in Sailfish's app grid and covers, notifications, sharing | Shows how good the integration can feel; the parts to copy are the ideas (per-app covers, share targets), not code |

---

## 3. Waydroid in brief

```
┌──────────────────────────── Phoenix (host) ─────────────────────────────┐
│ luna-surfacemanager (Wayland compositor) + Phoenix shell                │
│      ▲ wl_surface per Android task (multi-window)                       │
│      │                                                                  │
│ ┌────┴──────────────────── LXC container (namespaces) ───────────────┐  │
│ │ LineageOS 20 (Android 13) system + vendor images (squashfs/ext4)   │  │
│ │ hwcomposer HAL ─ Wayland client   audio HAL ─ host PulseAudio      │  │
│ │ gralloc/EGL ─ host Mesa (or libhybris)   input from Wayland seat   │  │
│ │ /data = ~/.local/share/waydroid/data (host directory)              │  │
│ └───────────────▲──────────────────────────────▲─────────────────────┘  │
│   binderfs (binder, hwbinder, vndbinder)        │ D-Bus / gbinder        │
│ waydroid container service (root) ──────── waydroid session (user)      │
│   network: waydroid0 bridge + NAT (dnsmasq)                             │
└──────────────────────────────────────────────────────────────────────────┘
```

- Two halves: a root **container service** that starts LXC, and a
  **session** in the user's Wayland session. LuneOS found the compositor
  runs as root with its own session bus, and reads the session environment
  back from the compositor (`waydroid-luneos-session.sh`); Phoenix on OSE
  is in the same position.
- **Multi-window**: `waydroid prop set persist.waydroid.multi_windows true`
  makes each Android task its own Wayland toplevel with `app_id`
  `waydroid.<package>` ([prop options](https://docs.waydro.id/usage/waydroid-prop-options)).
- **Suspend**: `persist.waydroid.suspend` (default on for kernel 4.9+)
  freezes the container when no Android app is displayed.
- **Images**: `lineage-20.0` builds for `waydroid_x86_64` and
  `waydroid_arm64`, in VANILLA and GAPPS variants, downloaded by `waydroid
  init` from Waydroid's OTA channel (SourceForge); or preinstalled under
  `/usr/share/waydroid-extra/images` (LuneOS does this for devices whose
  vendor line is frozen).
- **Android 13 needs ACLs** on the filesystem holding Waydroid's data
  ([known issues](https://docs.waydro.id/debugging/known-issues)).
- **GPU**: Mesa drivers work (freedreno, panfrost, v3d, virtio-gpu with
  virgl in QEMU); NVIDIA's proprietary driver does not and falls back to
  software rendering (SwiftShader) ([VM FAQ](https://docs.waydro.id/faq/get-waydroid-to-work-through-a-vm)).

---

## 4. Android apps as webOS apps

### 4.1 Integration map

| webOS experience | How it works for an Android app | Source of the idea | Work |
| --- | --- | --- | --- |
| **Launcher icon** | For each launchable package, an app directory with `appinfo.json` (`id: "waydroid.<package>"`, `type: "native"`, `main`: the launcher script with the package name, `title` from the Android label, `icon` from the extracted icon at the densities in [APP-STORE.md](APP-STORE.md#13-icons-at-every-density), `launcherTab: 1`) | LuneOS patch `0005-user_manager-give-every-Android-app-a-webOS-app` | Port; install through `com.webos.appInstallService`'s `pwa://` directory path instead of writing to disk, so SAM learns about the app without the `sam.service` restart LuneOS needs (*unverified that appinstalld2 accepts a `native` app this way*) |
| **Card per activity** | Multi-window mode: each Android task is a Wayland toplevel; Phoenix's `LsmWindowSource` makes a card from it, matched to the app by `app_id`. Activities of one task stack in one card; a second task of the same app joins that app's card stack | Waydroid multi-window; LuneOS's luna-surfacemanager | Check that stock OSE luna-surfacemanager accepts Waydroid's toplevels (xdg-shell) and gives them the card area (positive space); LuneOS changed its fork for the latter |
| **Card title and thumbnail** | Title from `appinfo.json`; the card shows the live surface as for any app | — | None beyond the above |
| **Close (flick up)** | `waydroid app` / `am force-stop <package>` through `waydroid shell`, then the launcher process exits | LuneOS: launcher stays alive so SAM can close it | Port |
| **Back gesture** | Deliver `KEY_BACK` (Linux keycode 158) to the focused Android surface; Android maps it to `KEYCODE_BACK` | Android's generic key layout | Needs the C++ back-gesture extension already on the M1 list ([ARCHITECTURE.md](ARCHITECTURE.md#known-gaps-on-device-milestone-1)) |
| **Swipe up / Home** | Minimise the card, as for any app; Android keeps running until frozen | — | None |
| **Orientation** | Android asks through the window's size; Phoenix rotates the whole UI. Apps that lock portrait keep the card upright, like webOS apps that hold orientation | — | Map Android's requested orientation (hwcomposer) to the shell's per-card orientation (*unverified that Waydroid exposes it*) |
| **Notifications** | Waydroid 1.6.0+ forwards notifications. LuneOS's patch posts them to `com.webos.notification` with `sourceId` = the app's id, so the banner and dashboard item show the app's name and icon and tapping raises the app | LuneOS patch `0006-notification_manager-post-to-com.webos.notification` | Port; M1 already plans to feed the dashboard from `com.webos.notification`. Next step LuneOS left open: route a notification's **action buttons** back into Android (a small Luna service that calls the Waydroid platform service) |
| **Badges** | Android 8+ notification dots derive from notifications; show the count on the launcher icon | — | S |
| **Keyboard / IME** | Phase 1: Android's own keyboard inside the container (LineageOS's AOSP keyboard). Later: hide it and use Phoenix's keyboard through Wayland `text-input` if Waydroid supports it (*unverified*) | [Disable on-screen keyboard FAQ](https://docs.waydro.id/faq/disable-on-screen-keyboard) | M, later |
| **Clipboard** | Waydroid syncs the clipboard with the host through `pyclip` (wl-clipboard). Phoenix needs a clipboard owner the Android side can read and write, bridged to what webOS apps use (`PalmSystem` copy/paste goes through the page) | Waydroid | M; *unverified* how it behaves under luna-surfacemanager |
| **Share: Android → webOS** | A tiny Android app, "Phoenix", preinstalled in the image, registered for `ACTION_SEND`; it hands the text, URL or file to the host (through a shared folder and the Waydroid platform service), and the Phoenix share sheet opens | Sailfish's share integration (idea only) | M |
| **Share: webOS → Android** | The Phoenix share sheet lists Android apps that accept `ACTION_SEND` for the MIME type; sending runs `waydroid app intent` with the content in the shared folder | Waydroid CLI `app intent` | M |
| **Links and files** | `tel:`, `mailto:`, `http(s):` from Android go to webOS apps through the same share bridge (`ACTION_VIEW` handler app); Files' "Open with" lists Android apps for a MIME type | — | M |
| **File access** | Bind `/media/internal/{Downloads,Pictures,Music,Documents,DCIM}` into Android's `/sdcard` (Waydroid's [shared folder](https://docs.waydro.id/faq/setting-up-a-shared-folder) approach). Files sees Android's downloads; Photos indexes pictures Android apps save | Waydroid docs; Ubuntu Touch symlinks | S–M; the media indexer must watch those folders |
| **Audio** | Android's audio HAL plays through the host's PulseAudio, which OSE's `audiod` also uses; volume keys and the ringer follow the host | Waydroid | Check that Android streams get the right `audiod` stream type (media vs. notification) |
| **Camera** | Pass the camera to Android as an external (USB-style) camera; LuneOS did this with an "external camera configuration" | LuneOS PR #810 | Depends on the camera work in [HARDWARE.md](HARDWARE.md#hardware-abstraction-plan); only one side can own the camera at a time |
| **GPS / location** | Android in Waydroid has no GNSS of its own; feed it from the host location service (a location provider app or HAL talking to `com.webos.service.location` / GeoClue) | — (*no known upstream solution; to research*) | M |
| **Sensors** | `waydroid-sensors` bridges the host's sensorfw to Android (LuneOS packages it) | LuneOS `waydroid-sensors.bb` | S on Halium; on mainline, depends on our sensor service |
| **Network** | Android sees a NAT'd bridge (`waydroid0`) and thinks it is on Wi-Fi; VPN on the host covers it | Waydroid | None; metered-network hints are lost |
| **Telephony, SMS** | Not shared: Android apps cannot place calls or read texts; the Phoenix Phone and Messaging apps own the modem | — | By design |
| **Just Type** | Search Android app names (they are webOS apps); "Open in <app>" actions later | — | None / S |

### 4.2 Launch and lifecycle

```mermaid
sequenceDiagram
  participant U as User
  participant S as Phoenix shell
  participant SAM as SAM (applicationManager)
  participant L as waydroid launcher (per app)
  participant W as Waydroid session / container
  participant C as luna-surfacemanager
  U->>S: tap "Signal" icon (waydroid.org.thoughtcrime.securesms)
  S->>SAM: launch {id}
  SAM->>L: exec main (package name)
  L->>W: unfreeze, start container if needed, launch package
  W->>C: new toplevel, app_id waydroid.org.thoughtcrime.securesms
  C->>S: surface -> card (LsmWindowSource matches app_id)
  U->>S: flick card up
  S->>SAM: close {id}
  SAM->>L: SIGTERM
  L->>W: force-stop package; freeze if nothing else shown
```

The first launch after boot starts the container (LuneOS measured about
17 s for a cold CLI start before their launch daemon; the daemon brings a
warm start under 1 s). The shell shows the launch card with the app's icon
meanwhile, as for any app.

### 4.3 What the user sees

- A setting, **Android apps**, off by default: turning it on downloads or
  unpacks the image (about 1 GB), explains the battery cost, and installs
  F-Droid.
- Android apps appear in the **Downloads** tab like other installed apps,
  with a small Android badge on the icon (optional, for honesty about what
  will run how).
- An **Android** entry in Settings: storage used, stop Android now, reset
  Android, open the full Android settings (the full UI in one card).

---

## 5. Devices and kernels

Waydroid needs, in the host kernel (from LuneOS's `waydroid-anbox.cfg` and
postmarketOS's checks):

| Option | Why |
| --- | --- |
| `CONFIG_ANDROID_BINDER_IPC=y`, `CONFIG_ANDROID_BINDERFS=y`, `CONFIG_ANDROID_BINDER_DEVICES="binder,hwbinder,vndbinder"` | Android's IPC |
| `CONFIG_PSI=y` (not disabled by default) | Android's low-memory killer |
| memfd (`CONFIG_MEMFD_CREATE`); ashmem only for old images / kernels | Shared memory; ashmem left mainline staging, and Android 11+ uses memfd |
| `CONFIG_USER_NS`, `CONFIG_VETH`, bridge, netfilter NAT and MASQUERADE, `CONFIG_SQUASHFS` (+ XZ, XATTR), `CONFIG_OVERLAY_FS`, cgroups (freezer, BPF) | LXC container, networking and images |
| `CONFIG_UHID`, `CONFIG_SW_SYNC` | Input and graphics fences |
| `# CONFIG_RT_GROUP_SCHED is not set` | Waydroid issue #346 |

Per device, against the plan in [HARDWARE.md](HARDWARE.md#device-tiers):

| Device | Kernel source | Binder etc. | GPU in Android | Architecture | Verdict |
| --- | --- | --- | --- | --- | --- |
| `qemux86-64` (emulator image) | OSE `linux-yocto` | Add a config fragment in `meta-phoenix` (LuneOS's `linux-yocto` bbappend is the model) | virtio-gpu with virgl if QEMU has 3D; SwiftShader otherwise | x86-64: many apps ship ARM-only native code, and the ARM translators (libhoudini, libndk_translation) are proprietary; **we will not ship them** | Development target; app coverage limited |
| Raspberry Pi 4 (4 GB+) | `linux-raspberrypi` from `meta-raspberrypi` | Add the fragment (*check the Pi kernel carries binderfs; it is mainline code*) | v3d (Mesa) (*works per community reports; unverified by us*) | arm64 | **First real target**; 4 GB is tight with Chromium and Android both running |
| OnePlus 6 / 6T, Pixel 3a (mainline), SHIFT6mq, Poco F1 | postmarketOS SDM845 / SDM670 kernels | pmOS device kernels are checked for Waydroid options by `pmbootstrap` (*verify per device*) | freedreno | arm64 | Good; 8 GB (OnePlus 6) is comfortable, 4 GB (Pixel 3a) workable |
| Pixel 3a, Pixel 6a/7, Fairphone 4/5 (Halium) | Android vendor kernels via LuneOS / UBports | Binder is built in; Waydroid shares binderfs with the Halium container (as Ubuntu Touch does on Halium 9+) | libhybris path (Waydroid images for Halium vendors, as LuneOS does for `halium-arm64`) | arm64 | Good; what Ubuntu Touch users run daily |
| PinePhone Pro | pmOS / `meta-pine64-luneos` | Add options | panfrost | arm64 | Works but slow; 4 GB |
| PinePhone | pmOS | Add options | lima (GLES 2 only) | arm64 | **Not supported**: 2–3 GB RAM and GLES 2 |
| Surface Go and x86 tablets | mainline | Add options | Intel (Mesa) | x86-64 | Works; ARM-only apps fail without a translator |

---

## 6. Battery, memory and storage

- **Memory:** the container's system services use several hundred MB
  before any app runs (*measure on the Pi 4 and Pixel 3a in B0*). With OSE's
  Chromium web runtime also resident, **4 GB is the minimum**; Android
  support is off on 2–3 GB devices.
- **Battery:** the container is frozen (cgroup freezer) when no Android
  window is visible (`persist.waydroid.suspend`). A frozen Android gets
  **no background work**: no push messages, no alarms. That is the honest
  trade-off:
  - Default: frozen when hidden. Android apps behave like webOS apps that
    are closed.
  - Per app "Allow in background" (for a messenger): the container stays
    awake while that app has a notification channel open; show the cost in
    Settings. Messengers that support **UnifiedPush** can instead wake on
    a push from a distributor on the host (see
    [APP-STORE.md](APP-STORE.md#14-which-web-runtime) on push).
  - Ubuntu Touch's documentation lists higher battery use as the main
    limitation; expect the same.
- **Storage:** about 1 GB of images plus app data under `/var` (or
  `/home`), which must support ACLs (Android 13). Preinstalled images go
  in the read-only root only on devices that need a frozen vendor pair.
- **Updates:** Waydroid images update through Waydroid's OTA channel
  (independent of the RAUC system update); LuneOS disables that for
  preinstalled images. Security patches for Android come from LineageOS
  through Waydroid's image builds; Phoenix does not build Android images
  itself unless we must.

---

## 7. App sources

| Source | What | Ship? |
| --- | --- | --- |
| **[F-Droid](https://f-droid.org/)** | Free-software Android apps, built from source, repository index signed. F-Droid 2.0 (a rewrite) shipped 24 September 2026 | **Yes**: preinstalled (or installed when Android support is turned on). Later, the Phoenix catalog could list F-Droid apps directly from its signed `index-v2.json` and install them with `waydroid app install` (see [APP-STORE.md](APP-STORE.md#6-open-questions)) |
| **microG** (GmsCore) | Free reimplementation of Google Play Services APIs (location, push via Google's servers, maps API shims); needs signature spoofing, which LineageOS-based builds restrict to the official microG signature | **Opt-in, installed by the user** from F-Droid (microG's own repository). Not preinstalled: it talks to Google on the user's behalf, which should be their choice |
| **Aurora Store** | Anonymous Google Play client (GPL-3.0) | **Not preinstalled.** It downloads from Google Play against Google's terms of service; users may install it from F-Droid themselves |
| **Google Play / GMS** | Google's proprietary apps, licensed only to certified devices | **Never shipped or offered.** Waydroid's GAPPS image exists and users can choose it themselves, but Phoenix will not link to it, download it or document it as a feature |
| APK files | From Files ("Install" on an `.apk`) or a browser download | Yes, with the same "unknown source" warning as unknown `.ipk` files |

**Google's developer verification** (from 30 September 2026 in Brazil,
Indonesia, Singapore and Thailand, globally in 2027) blocks unverified apps
only on **certified** Android devices ([F-Droid's open letter](https://f-droid.org/2026/02/24/open-letter-opposing-developer-verification.html),
[Google's help page](https://support.google.com/android-developer-console/answer/16561738)).
Waydroid's vanilla image is not certified, so Phoenix is not affected, and
F-Droid remains fully usable.

**What will not work, stated plainly:** apps that check Play Integrity
(most banking and payment apps, some games and streaming apps), apps that
need Google Play Services without microG, Widevine L1 streaming, apps that
need telephony or SMS access, and on x86 devices apps with ARM-only native
code.

---

## 8. Legal

- **Waydroid** is GPL-3.0; it runs as a separate program. Phoenix's own
  code stays Apache-2.0. Patches to Waydroid (ours or LuneOS's) are
  GPL-3.0 and live as `.patch` files in `meta-phoenix`, with the licence
  recorded in the recipe, as LuneOS does. **ATL** is GPL-3.0-or-later,
  same treatment.
- **LineageOS images** are mostly Apache-2.0 with GPL components (kernel is
  the host's, so not in the image); distributing them means providing
  source offers, which Waydroid's image project does. If Phoenix ever
  preinstalls images, we inherit that duty: point to the exact source
  revisions.
- **Google Mobile Services** are licensed by Google only to device makers
  whose devices pass certification (the MADA/CTS regime). Shipping or
  bundling Play Store or Play Services would infringe Google's copyright
  and terms. Phoenix does not do it.
- **"Android"** is a Google trademark. Say "runs Android apps" as a
  compatibility statement; do not use the Android robot or imply
  certification. **"Waydroid"** credited as the upstream project.
- **Aurora Store and Play downloads:** not distributed by us (Google's
  terms prohibit automated access to Play).
- **ARM translators** (Intel's libhoudini, Google's libndk_translation) are
  proprietary binaries from Android images; not shipped.
- **Widevine:** see [APP-GAPS.md](APP-GAPS.md#streaming-services-honestly);
  unchanged by Android support in practice.

---

## 9. Recommendation and plan

**Recommendation:** Waydroid, integrated the way LuneOS has done it,
imported into `meta-phoenix` (or taken from `meta-luneos` directly if we
decide to build on LuneOS's layer stack, the open question in
[HARDWARE.md](HARDWARE.md#open-questions)). F-Droid as the app source, no
Google, off by default, 4 GB+ devices only. Revisit ATL once a year as a
lighter runtime for simple apps.

Effort: **S** up to a week, **M** two to four weeks, **L** one to three
months, for one developer.

| Phase | Contents | Effort | Depends on |
| --- | --- | --- | --- |
| **B0** Spike | Kernel fragment for `qemux86-64` and Pi 4; Waydroid 1.6.3, `python3-gbinder`, `libgbinder`, LXC recipes (from `meta-luneos`); `waydroid init` with the vanilla image; the full Android UI running in one Phoenix card; measure RAM, boot time, idle drain | **M** | ROADMAP M1 (Phoenix boots on OSE) |
| **B1** Cards and launcher | Multi-window; one webOS app per Android package (LuneOS patch 0005, installed through appinstalld2 if possible); `LsmWindowSource` matches `waydroid.*` app ids; close; back gesture; positive space for Android surfaces; launch daemon | **M** | B0; M1's back-gesture compositor extension |
| **B2** Everyday integration | Notifications to `com.webos.notification` (LuneOS patch 0006) and action buttons routed back; shared folders with the media indexer; clipboard; share sheet both ways (the Phoenix Android helper app); `.apk` install from Files; Settings > Android; F-Droid preinstall | **M–L** | B1; Phoenix share sheet |
| **B3** Phones | OnePlus 6 and Pixel 3a (mainline), Pixel 3a (Halium); camera hand-over, location provider, `waydroid-sensors`, audio stream types, background policy per app; battery measurements against targets | **L** | HARDWARE.md phases 3a–3c |
| **B4** Catalog | Android apps in the Phoenix catalog from F-Droid's signed index; updates through the same update check | **M** | B2; APP-STORE.md A3 |
| **B5** (optional) ATL | Package ATL, try it for a list of simple apps (NewPipe, Öffi), compare RAM and start time with Waydroid | **M** | B1 |

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Stock OSE luna-surfacemanager does not handle Waydroid's windows the way LuneOS's fork does | Medium | No per-app cards | Borrow LuneOS's compositor changes as patches; full-UI-in-one-card fallback |
| RAM: Chromium runtime + Android on 4 GB devices | High | Kills, slow switching | Off by default; freeze aggressively; limit to 4 GB+ and recommend 6 GB+ |
| Battery drain | High | Users blame Phoenix | Freeze when hidden; per-app background opt-in; show usage |
| Waydroid's upstream pace (one maintainer-heavy project) | Medium | Security fixes lag | Track upstream closely; share work with LuneOS, UBports, FuriLabs |
| App expectations (banking apps) | High | Disappointment | Say it plainly in the setting's first screen and the docs |
| GPL-3.0 patch handling in an Apache-2.0 repo | Low | Licence confusion | Keep patches in recipe directories with licence headers; document in LEGAL.md |
| x86 app coverage without ARM translation | Certain on x86 | Many apps fail on the emulator image | Test on arm64 hardware; x86 is for development |

---

## 11. Open questions

1. **Do you want Android support at all in the first year**, or keep it
   for after the phones work? *Answered (owner, 29 September 2026):
   Android apps are part of the 1.0 release, towards its end; see
   [ROADMAP.md](ROADMAP.md#10-release).* B0 can run on the emulator image
   early.
2. **LuneOS layer or our own recipes?** Depend on `meta-luneos`'s Waydroid
   recipes (and share fixes with them), or copy them into `meta-phoenix`?
   This ties into the scarthgap-vs-LuneOS question in HARDWARE.md.
3. **microG**: offer a one-tap "Install microG" in Settings (downloads from
   microG's F-Droid repository), or leave it entirely to the user?
4. **Background policy**: frozen-when-hidden by default with per-app
   exceptions, or awake by default on devices with enough RAM?
5. **Badge on Android icons**: mark Android apps in the launcher, or make
   them indistinguishable from webOS apps?
6. **ATL**: worth a small experiment (B5), or ignore until it matures?
7. **Android keyboard**: acceptable to show Android's keyboard in Android
   apps, at least at first?

---

## 12. Sources

Accessed 28 September 2026 unless noted.

- Waydroid: <https://waydro.id/>; releases (1.6.0 21 Nov 2025, 1.6.1 29 Dec 2025, 1.6.2 22 Feb 2026, 1.6.3 28 May 2026) <https://github.com/waydroid/waydroid/releases>; docs <https://docs.waydro.id/> (README, prop options, known issues, VM/GPU FAQ, Google Play certification, shared folders)
- LuneOS Waydroid integration, PR #810 merged 4 September 2026: <https://github.com/webOS-ports/meta-webos-ports/pull/810>; recipes and patches read in `meta-luneos/recipes-support/waydroid/` (patches 0005, 0006, 0009 dated 2–13 September 2026) and `meta-luneos/recipes-kernel/linux/linux-yocto/waydroid-anbox.cfg`
- Anbox status: <https://en.wikipedia.org/wiki/Anbox>, <https://github.com/anbox>
- Android Translation Layer: <https://gitlab.com/android_translation_layer/android_translation_layer> (README, `meson.build`: GTK 4, licence GPL-3.0-or-later via the GitLab API); <https://nlnet.nl/project/ATL/>; <https://hackaday.com/2025/09/10/a-look-at-not-an-android-emulator/>
- Sailfish AppSupport: <https://docs.sailfishos.org/Support/Help_Articles/Android_App_Support/>; Jolla Phone 2026 hands-on <https://www.androidauthority.com/jolla-phone-2026-hands-on-3646591/>
- Ubuntu Touch Android apps: <https://docs.ubports.com/en/latest/userguide/dailyuse/waydroid.html>; Waydroid 1.6.0 notifications <https://ubuntuhandbook.org/index.php/2025/11/waydroid-1-6-0-forward-notifications-to-desktop/>
- Droidian Android apps: <https://docs.droidian.org/info/android-apps/>; FuriOS Andromeda: <https://blog-d.luigi311.com/furilabs-flx1/>
- Kernel options: Gentoo wiki <https://wiki.gentoo.org/wiki/Waydroid>; Arch wiki <https://wiki.archlinux.org/title/Waydroid> (could not be fetched on 28 September 2026; options taken from LuneOS's fragment)
- Google developer verification: <https://f-droid.org/2026/02/24/open-letter-opposing-developer-verification.html>; <https://support.google.com/android-developer-console/answer/16561738>; F-Droid 2.0 <https://pinggy.io/blog/f_droid_2_0_android_developer_verification/>
- microG: <https://en.wikipedia.org/wiki/MicroG>; signature spoofing <https://github.com/microg/GmsCore/wiki/Signature-Spoofing>
