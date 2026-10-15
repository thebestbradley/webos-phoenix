# Decisions

The owner's decisions that change the plan, newest first: what was
decided, why, what it settles, and where the detail lives. The earlier
ones (September and early October 2026) are in
[ROADMAP.md](ROADMAP.md#decisions-so-far), one line each; questions still
open are in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

## 15 October 2026: the simulator: the current Chrome version, the newest engine

**The owner**: the same request as the next entry's (the devices'), for
the simulator.

**Decided**:

1. **Every web page is told Chrome's current version.** One user agent
   policy for every web surface (the apps' cards, installed web apps, the
   browser's normal and private views): Chrome on an Android phone or
   tablet by the device's form factor, Chrome on Linux for the browser's
   Desktop Site, in Chrome's own reduced form, with client hints and
   `navigator.platform` that agree. The version follows Chrome's four-week
   release cadence from the date (anchored at Chrome 155, stable 6 October
   2026), so it stays current without a change; the environment can
   override it, and a feed can re-anchor it later. The engine's real
   version is said where people look (the simulator's start-up line,
   Settings > Device Info).
2. **The newest engine available on every platform.** The simulator moves
   from Qt 6.8.1 (Chromium 122) to Qt 6.11.3, whose Qt WebEngine is the
   newest Qt has: Chromium 140, the newest base, with security fixes to
   153.0.8010.52. Qt 6.12.0 (the LTS release LuneOS's device stack uses)
   has the same base but an older build of it, with fixes only to
   147.0.7727.138, so 6.11.3 it is until a 6.12 release carries newer ones.
   Qt 6.8 stays the oldest the QML must run on, the device's, and CI checks
   it.

**Why nothing stopped it before**: the simulator used Qt 6.8.1 because a
webOS OSE image ships it, and its QML must run there; that holds with the
QML tested on both. The user agent named the engine's own Chromium, which
sites such as Slack refuse ("Please update your browser").

**Done** (branch `wp/modern-web`): `shell/sim/useragent.h` and its tests,
applied to every profile, the engine in Settings > Device Info, Qt 6.11.3
in `./phoenix`, CI and the docs. Slack's web app, installed from the
Marketplace in the simulator, now opens on Slack's sign-in page where it
said "Please update your browser". Details: APP-RUNTIME.md, "The web engine
and the user agent".

**Open**:

- The devices apply the same policy through their own stack: Chromium 151
  on LuneOS's layers and the same user agent and client hints from
  `phoenix-wam-conf` (the next entry). The two are written to agree: a
  change to one is a change to both (`shell/sim/useragent.h`,
  `meta-phoenix/recipes-phoenix/phoenix-wam-conf/`).
- Move to Qt 6.12.1 (its branch already carries newer fixes), or to
  whichever release carries the newest security fixes, when it ships;
  check with `strings` on its `libQt6WebEngineCore` (APP-RUNTIME.md).
  Homebrew's `qtwebengine` (6.11.2, fixes to 151) keeps a Mac a little
  behind until Homebrew moves.
- The update or catalog feed giving the current Chrome release
  (`UserAgent::setFeedAnchor`), for when the cadence slips.

## 15 October 2026: the newest web engine on every system

> "Is there a reason we are not using or reporting the latest Chromium?
> … I would prefer that we use the most current for both systems. If
> possible let's make that happen. The user agent should be modern and
> working with the latest browsers; webOS is centered around the web to
> function, this is a top priority." (the owner)

**Decided:**

1. **Devices move to the newest web runtime there is: Chromium 151, on
   LuneOS's layer stack.** Device images build on the layers
   [webos-ports-setup](https://github.com/webOS-ports/webos-ports-setup)
   pins (Yocto 6.0 wrynose, meta-qt6 6.12, `meta-webos-ports`), whose
   `webruntime_151.bb` builds Chromium 151.0.7922.108 from
   `webos-ports/chromium151`, with `meta-phoenix` on top, instead of webOS
   OSE's `build-webos` (Yocto 5.0 scarthgap, Qt 6.8.1, Chromium 120). This
   settles the question [HARDWARE.md](HARDWARE.md#a-webos-ose-targets)
   called the largest open one in the plan ("stay on build-webos or follow
   LuneOS's wrynose layer stack"), and PRE-IMAGE-CHECKLIST B14. The OSE
   path stays only until each machine builds on the new one
   ([HARDWARE.md](HARDWARE.md#the-web-runtime-chromium-151-on-luneoss-layers)
   has the plan).
2. **The simulator moves to the newest Qt WebEngine**: Qt 6.11.3, Chromium
   140 with security fixes to 153.0.8010.52 (6.12.0's stop at 147; the
   entry above).
3. **One user agent policy on both systems**: what Chrome on Android sends
   today, whatever engine is underneath.
   - Chrome's reduced user agent with the **current Chrome stable major**,
     computed from the date on Chrome's four-week cadence (Chrome 155 is
     the stable release of 6 October 2026; one more every 28 days; never
     lower than 155): `Mozilla/5.0 (Linux; Android 10; K)
     AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile
     Safari/537.36`, with `Mobile` on phones and without it on tablets.
   - No `webOS`, `Web0S`, `WebAppManager` or `QtWebEngine` token: sites
     read them as LG's TVs or Palm's 2011 browser and refuse the page.
   - Client hints that agree: brands Chromium `<major>` with Chromium's
     GREASE brand, platform Android, mobile by form factor.
   - On a device it is computed at every start of WebAppMgr
     (`meta-phoenix/recipes-phoenix/phoenix-wam-conf`), so a device that
     is never updated still names a current Chrome; on LuneOS's layers
     the runtime's client hints follow it (a patch to neva). See
     [APP-RUNTIME.md](APP-RUNTIME.md#the-user-agent).

**Why not stay on OSE.** OSE has had no release, blog post or
`build-webos` commit since 2.28.0 (27 March 2025). Its runtime, Chromium
120, is 35 major versions behind Chrome 155, and sites already turn it
away by version: Slack serves its client only to Chrome 137 or newer
([APP-STORE.md](APP-STORE.md)). LG never published a newer tree; LuneOS
built one itself, forward-porting LG's "neva" port from 120 to 151
(`meta-luneos/recipes-webos-ose/chromium/webruntime-repo_151.inc`).

**Why the whole stack, not just the runtime.** `webruntime_151` cannot be
lifted onto OSE's scarthgap layers. It builds with the toolchain wrynose
has and scarthgap has not: oe-core's own clang (LLVM 22.1.8; OSE uses
meta-clang's 18.1.6), Rust 1.94.1 with `libstd-rs` (scarthgap: 1.75.0; Rust
is not optional in Chromium 151, `//url` needs it), Node 24
(`nodejs24-native`, meta-luneos's own) and `bindgen-cli`
(`webruntime-clang_151.bb`, `chromium-host-llvm.inc`,
`webruntime-repo_151.inc`). Carrying that toolchain and the runtime on
scarthgap would make Phoenix the maintainer of a Chromium port; on
LuneOS's layers it is maintained by the people who made it. The same
stack also brings Mesa 26.0.5, which the Fairphone 6's Adreno 810 needs
(OPEN-QUESTIONS Q82; OSE's scarthgap has Mesa 24.0.7), Qt 6.12, and a Yocto
release supported to April 2030 instead of April 2028.

**What does not change.** Phoenix stays an independent project
([LUNEOS.md](LUNEOS.md#the-owners-position-28-september-2026)): the
layers are used as libraries, at pinned commits, changed only through
`meta-phoenix`; no agreement with LuneOS is needed or implied. The shell,
the apps and the runtime are the same on either stack.

**Licences of what is reused.** Recipes (read by the build, not copied
into Phoenix): `meta-luneos` MIT (`COPYING.MIT`), `meta-rpi-luneos`
Apache-2.0, `meta-raspberrypi`, `meta-android`, `meta-qt6`,
`meta-openembedded` and `openembedded-core` MIT; `meta-luneui`, the
backports and holdbacks layers and `meta-qualcomm-modems` have no licence
file (used as they are, never copied; [LUNEOS.md](LUNEOS.md#the-owners-position-28-september-2026)).
What ships in the image: WebAppMgr Apache-2.0; the runtime
`Apache-2.0 & BSD-3-Clause & LGPL-2.0-only & LGPL-2.1-only`
(`webruntime-common.inc:5`: Chromium, Blink's LGPL parts, LG's neva),
as OSE's 120 was. LuneOS's image also carries the Mojo 1.0 framework,
`LICENSE = "CLOSED"`; Phoenix's image leaves it out
(`packagegroup-webos-extended.bbappend`). Phoenix's own bbappends and
patches are Apache-2.0.

**What it leaves open** (for the owner; the meantime choice in brackets):

- The name in the image. On LuneOS's layers the distro is LuneOS's own
  (`DISTRO = "luneos"`), so `/etc/os-release` says LuneOS, and so does
  the device name `phoenix-apps` writes into `servers.json`
  (`${DISTRO_NAME} ${MACHINE}`). A `phoenix` distro of our own on top of
  LuneOS's is a small file, but WAM takes its platform from the distro's
  name (`-DPLATFORM=PLATFORM_${DISTRO}`, meta-luneos `wam.inc:50`) and
  Phoenix's name waits on trademark searches ([BRANDING.md](BRANDING.md)).
  (LuneOS's distro, unchanged, until the first image.)
- LuneOS's Atlas browser. LuneOS's image has it as the browser
  (`VIRTUAL-RUNTIME_com.webos.app.browser`), running on Chromium's
  `browser_shell` because WAM cannot embed a page; Phoenix's browser (HP's
  Isis) still needs a page view on a device (ROADMAP M1). Keep Atlas until
  then, or leave it out with OSE's other UI apps (PRE-IMAGE-CHECKLIST F3)?
  (In the image's task graph today; decided with F3.)
- Security updates of the engine. Chromium fixes security bugs only in
  its current and extended stable releases; 151 gets no more upstream
  fixes now that 155 is out, so the devices' engine is as safe as LuneOS's
  uprevs are frequent (OSE's 120 is far older). Phoenix may need to fund
  or do uprevs itself ([HARDWARE.md](HARDWARE.md#the-web-runtime-chromium-151-on-luneoss-layers),
  "going past 151"). (Follow LuneOS's.)
