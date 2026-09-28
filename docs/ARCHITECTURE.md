# Architecture

## Where Phoenix fits

```
┌──────────────────────────────────────────────────────────────┐
│ Apps: Enact / web apps (WAM), QML apps, native apps           │
├──────────────────────────────────────────────────────────────┤
│ Phoenix shell (this repo)                                     │
│   Phoenix.Shell  card view, status bar, launcher, dashboard,  │
│                  lock screen, gesture area, Just Type         │
│   Phoenix.Lsm    adapter: compositor surfaces -> cards        │
├──────────────────────────────────────────────────────────────┤
│ webOS OSE (unchanged)                                         │
│   luna-surfacemanager  Qt 6 Wayland compositor (QML views)    │
│   SAM (applicationmanager), WAM (web runtime), luna-service2  │
│   bus, settings, connection manager, audio, media, ...        │
├──────────────────────────────────────────────────────────────┤
│ Linux, systemd, Yocto scarthgap, device BSP                   │
└──────────────────────────────────────────────────────────────┘
```

We do **not** fork webOS OSE's hundreds of repositories. OSE is built with
OpenEmbedded, so Phoenix is a layer (`meta-phoenix`) added to OSE's own
`build-webos` setup. When an OSE component needs a change, we carry a
`.bbappend` with a patch in `meta-phoenix`, and fork that one repository only
if the patch set grows large. This keeps us close to upstream and able to take
OSE updates.

## How the shell is loaded on a device

`luna-surfacemanager` builds its UI from QML. Its startup script sources
`/etc/surface-manager.d/product.env`, and its QML engine puts
`WEBOS_COMPOSITOR_IMPORT_PATH` first on the import path. The stock views
import a module named `WebOSCompositor` so products can override any view
(see `base/qml/WebOSCompositor/README` in luna-surfacemanager).

`meta-phoenix` installs:

- `/usr/share/phoenix/qml`: the `Phoenix.*` modules and a `WebOSCompositor`
  module whose `qmldir` replaces `ViewsRoot` with
  `WebOSCompositor/views/PhoenixViewsRoot.qml`
- `/usr/share/phoenix/assets`: the Open webOS artwork
- `/etc/surface-manager.d/product.env`: sets
  `WEBOS_COMPOSITOR_IMPORT_PATH=/usr/share/phoenix/qml`

`PhoenixViewsRoot` keeps the stock overlay, popup, notification, keyboard and
system UI views (the base controllers depend on them) and puts the Phoenix
`Shell` in place of the TV fullscreen view and launcher.

For local development, build straight from your checkout instead of GitHub
by adding this to `conf/local.conf`:

```
INHERIT += "externalsrc"
EXTERNALSRC:pn-phoenix-shell = "${TOPDIR}/webos-phoenix/shell"
```

## Inside the shell

The shell never talks to the compositor directly. It depends on two objects:

**Window source** (`Phoenix.Sim.SimWindowSource` in the simulator,
`Phoenix.Lsm.LsmWindowSource` on a device):

| Member | Meaning |
| --- | --- |
| `apps` | ListModel: `appId`, `title`, `icon`, `color`, `glyph`, `tab`, `quickLaunch` |
| `cards` | ListModel of open windows in screen order: `uid`, `appId`, `title`, `groupId`. Consecutive cards with the same `groupId` form a card stack |
| `windowFor(uid)` | The Item to show inside a card |
| `launch(appId, afterUid)` | Start or focus an app; new cards go right of `afterUid` |
| `close(uid)`, `back(uid)` | Close an app; deliver the back gesture |
| `moveCard(from, to)`, `setCardGroup(uid, groupId)`, `newGroupId()` | Reorder cards and move them between stacks |
| `cardFocusRequested(uid)` | Signal: show a newly opened window (e.g. a compose card) maximized |
| `notifications`, `notify()`, `dismissNotification()` | Notification list |

**System status** (`SimSystemStatus` / `LsmSystemStatus`): `carrier`,
`batteryPercent`, `charging`, `wifiBars`, `signalBars`, `airplaneMode`,
`bluetoothOn`, `rotationLocked`, `muted`, `brightness`.

This split lets the whole UI be developed, screenshot-tested and unit-tested
on a laptop, then run unchanged on a device.

### Legacy pixels

All measurements in `Theme.qml` are in *legacy pixels*, the pixel grid of the
original 320×480 Pre or 1024×768 TouchPad, with a citation into the Open
webOS source. `Theme.px()` scales them to the real screen (1.0 on a Pre, 1.5 on
a Pre 3, about 3.4 on a 1080px-wide phone). The UI is identical to the
original at the reference sizes and scales in proportion elsewhere.

### Card view model

Stack geometry is in `CardLayout.js`, a direct port of `CardGroup.cpp`'s
opened and closed layouts: the open stack fans its cards out (tilted,
right-hand cards dropping slightly), other stacks collapse to a pile with
7px steps, and stacks sit side by side with a fixed gap. Card view scrolls
between stacks; long stacks (5+ cards) scroll their fan first.

As in LunaSysMgr's `CardWindowManager`, each card is the app window at full
size, scaled about its centre. Card view and maximized are one continuous
`maximizeProgress` from 0 to 1: the focused card grows from `activeCardScale`
to 1 and the neighbours are pushed off-screen. Apps never re-layout during the
animation.

## Known gaps on device (Milestone 1)

- **Positive space.** OSE apps assume they fill the screen. Phoenix has a status
  bar and gesture area, so apps must be told the smaller area. For now
  `SurfaceHost` scales the surface down to fit.
- **Back gesture.** QML cannot inject key events into a client surface, so
  back needs a small C++ compositor extension.
- **System status.** `LsmSystemStatus` has placeholder values until it is
  wired to OSE Luna services.
- **GraphicalEffects.** Rounded card corners use `Qt5Compat.GraphicalEffects`.
  The recipe depends on `qt5compat`; check that it is in the OSE image.
