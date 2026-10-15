# Decisions

The owner's decisions that change the plan, newest first: what was
decided, why, what it settles, and where the detail lives. The earlier
ones (September and early October 2026) are in
[ROADMAP.md](ROADMAP.md#decisions-so-far), one line each; questions still
open are in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

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
2. **The simulator moves to the newest Qt WebEngine**: Qt 6.12, whose
   Chromium is 140 (in its own branch of this work).
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
