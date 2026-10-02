# Native webOS apps (PDK and hybrid)

What the PDK apps of 2010-2011 were, why Phoenix does not run them yet,
and the plan to run them. The trigger was Quickoffice (App Museum II,
`com.quickoffice.webos` 2.2.247): it installs and starts on Phoenix, but
its document engine is a native plugin.

> **Status (2 October 2026).** Enyo 1 web apps run (`phoenix-runtime.js`).
> Mojo apps do not (the framework was never open-sourced, see
> [APP-STORE.md](APP-STORE.md) §2.3). Native apps do not yet: the
> Marketplace now says so plainly, and installs a web app with a native
> plugin while naming the plugin as what this device cannot run yet.

## 1. What they are

| Kind | What it is | Example |
| --- | --- | --- |
| **PDK app** (`appinfo.json` `"type": "pdk"`) | A Linux ELF program, compiled for the phones' and the TouchPad's 32-bit ARM, drawing with SDL 1.2 and OpenGL ES 1.1 or 2.0, and asking the system for things through Palm's `libpdl` (`PDL_Init`, `PDL_GetDeviceName`, `PDL_ScreenTimeoutEnable`, `PDL_Notify`, the accelerometer as an SDL joystick, ...) | Most games of the time: Angry Birds, Need for Speed, Plants vs. Zombies |
| **Hybrid app** (`"type": "web"`, `"plug-ins": true`) | A web app (Mojo or Enyo) with one or more native plugins: an ELF beside a `<name>_appinfo.json`, started by the system when the page creates `<object type="application/x-palm-remote">`. The page calls the plugin's functions and the plugin calls back into the page (`PDL_RegisterJSHandler`, `PDL_CallJS`) | Quickoffice: its Enyo UI renders documents the `qoservice` plugin parses (`getDCP`, `getDocStyles`, `getFiles`, `saveWkbk`, ...) |

The binaries are ARM EABI5, **soft-float** (`/lib/ld-linux.so.3`, Debian's
armel, not armhf). They link against the system libraries of webOS 2 and 3:
SDL 1.2, SDL_image, SDL_ttf, SDL_mixer, GLESv1/v2, libpng12, and for
Quickoffice ICU 3.6 (`libicuuc.so.36`).

## 2. Why not yet

- Phoenix devices are arm64 or x86-64. Many arm64 cores still run 32-bit
  programs (Cortex-A53, A55, A72, A76), newer ones do not (Cortex-X,
  A715 on, Apple silicon), and x86-64 never did.
- `libpdl` is Palm's and closed; it has to be rewritten against its
  documented API.
- The plugin bridge (`application/x-palm-remote`) was in the closed
  WebAppManager.
- The 2011 libraries (SDL 1.2, ICU 3.6, libpng12) are long gone from
  current distributions, and soft-float ARM is going too.

## 3. The plan: a compatibility layer

| Step | What | Notes |
| --- | --- | --- |
| PDK1 | **An armel user space** for the apps, kept apart from the system: glibc, libstdc++, SDL 1.2 as `sdl12-compat` on SDL 2, SDL_image, SDL_ttf, SDL_mixer, libpng12, ICU 3.6 built from source, Mesa's GLES | Built in the image like any other component; the app runs in its own jail as on webOS |
| PDK2 | **Running 32-bit ARM**: directly where the CPU still can, `qemu-arm` (user mode, binfmt) where it cannot (x86-64, and arm64 without AArch32) | The simulator on the Mac and PC uses qemu. 2011 apps were written for a 1 GHz Cortex-A8, so emulation is fast enough for most of them |
| PDK3 | **`libpdl`**, rewritten: the documented `PDL_*` calls, answered by the shell and the runtime's services (device info, screen timeout, notifications, orientation, sensors, purchases refused) | Compiled for armel, it talks to Phoenix over a socket |
| PDK4 | **The plugin bridge**: the runtime implements `<object type="application/x-palm-remote">`, starts the plugin through PDK2, and carries calls both ways (`PDL_RegisterJSHandler`, `PDL_CallJS`) | Enough for Quickoffice, which draws nothing itself: no GL needed |
| PDK5 | **Full-screen PDK apps**: SDL's window as a card (SDL 2's Wayland back end on a device, a shared buffer in the simulator), touch and keys in, sound out | GL under emulation runs Mesa's software renderer, fine for 2D games and slow for 3D ones; a GL pass-through is a later step |
| PDK6 | **The Marketplace**: native apps install once PDK1-PDK3 are in; the compatibility badge (APP-STORE.md §2.3) reports what works | |

**Quickoffice is the first target**: PDK1, PDK2, PDK3 (the few calls a
plugin makes) and PDK4, without PDK5. Rewriting what `qoservice` does
(parsing Word, Excel and PowerPoint for QOWT) instead would mean
re-creating an undocumented, closed document engine: far larger, and
rejected.

## 4. Effort

| Step | Effort |
| --- | --- |
| PDK1-PDK2 | M: packaging, and ICU 3.6 against today's compilers |
| PDK3 | S to M: the API is small and documented |
| PDK4 | M |
| PDK5 | M to L, mostly input and the GL path |

## Open questions for you

1. Ship the armel layer in every image, or as a download the first time a
   native app is installed (it is a few tens of MB)?
2. The legal position on running the apps is the same as for the App
   Museum's downloads ([LEGAL.md](LEGAL.md)); the layer itself is all open
   source plus Phoenix's own `libpdl`. Agreed?
