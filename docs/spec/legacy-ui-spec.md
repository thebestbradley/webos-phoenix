# Legacy webOS System UI: pixel spec (from luna-sysmgr source)

Source: Open webOS `luna-sysmgr` (Apache-2.0, © 2008-2013 LG Electronics / Palm / HP), cloned at
<https://github.com/openwebos/luna-sysmgr> (commit `1393f0af`). Every `path:line` below is relative to that root. Values come from reading
code and conf files. Anything I derived or computed instead of reading is marked **(inferred)**.

> **Read this first: what this codebase is.** The open-sourced LunaSysMgr is the **webOS 3.0.x "Dartfish" /
> TouchPad codebase**, ported to Qt 4.8/Qt 5. The base `conf/luna.conf` sets `TabletUi=true` and 1024x768
> (`conf/luna.conf:30-31,120`), and phone confs only override a few keys. The webOS **1.x/2.x phone** card view and
> status bar lived partly in the separate `luna-systemui` web app (`SystemPath=/usr/lib/luna/system/luna-systemui`,
> `conf/luna.conf:24`), which is not in this repo. The phone code paths that remain are the `!tabletUi` branches
> (centered clock, black status bar, rounded screen corners, bottom notification bar). Treat them as authoritative
> for layout logic only; the phone assets are partly the 320px-wide ones in `images/`.

Conventions:
* Coordinates: most QGraphicsItems are **center-origin** (bounding rect `(-w/2,-h/2,w,h)`).
* "Curve N" = `static_cast<QEasingCurve::Type>(N)` via `AS_CURVE` (`Src/base/settings/AnimationSettings.h:256`).
  Qt enum: 0 Linear, 1 InQuad, 2 OutQuad, 3 InOutQuad, 5 InCubic, 6 OutCubic, 7 InOutCubic, 9 InQuart,
  10 OutQuart, 15 InOutQuint, 22 OutExpo, 30 OutElastic, 40 OutInBounce.
* Conf files are layered: `/etc/palm/luna.conf`, then `/etc/palm/luna-platform.conf`, which is the per-device
  `conf/luna-<machine>.conf` (`Src/base/settings/Settings.cpp:39-40,248-249`). Animations use
  `lunaAnimations.conf` + `lunaAnimations-platform.conf` (`Src/base/settings/AnimationSettings.cpp:27-28,136-137`).
* Fonts: every system font is **"Prelude"** (Palm's typeface). See `conf/luna.conf:110-114` and
  `Src/base/settings/Settings.cpp:194-203`. Boot and progress text use `/usr/share/fonts/Prelude-Bold.ttf`
  (`Settings.cpp:199-200`). Prelude isn't in this repo. Phoenix needs a substitute (inferred).

---

## 0. Devices and global geometry

### 0.1 Per-device conf

| codename | device | DisplayWidth x Height | TabletUi | VK enabled | Active / NonActive card ratio | CardGroupRotFactor | GapBetweenCardGroups | other | source |
|---|---|---|---|---|---|---|---|---|---|
| (base) | default | 1024x768 | true | false | 0.659 / 0.61 | 30 | 10 | PositiveSpaceTop/Bottom 28/28, MaxNegSpace 0.55 | `conf/luna.conf:30-31,117,120-128` |
| castle | Pre | **not set** (inherits base 1024x768; real HW 320x480 (inferred)) | inherits true | false | inherits | inherits | inherits | only `AtlasMemThreshold=300` | `conf/luna-castle.conf:18-19` |
| pixie | Pixi | 320x400 | inherits | false | inherits | inherits | inherits | MaxNegSpace 0.65, BrightnessDark 20 | `conf/luna-pixie.conf:20-28` |
| broadway | Veer | 320x400 | inherits | false | inherits | inherits | inherits | — | `conf/luna-broadway.conf:18-21` |
| windsornot | (the brief says Pre 2, but see note) | **480x800** | true | **true** | 0.50 / 0.45 | 90 | 10 | HomeButtonOrientationAngle 0 | `conf/luna-windsornot.conf:23-39` |
| mantaray | Pre 3 | 480x800 | inherits | false | inherits | inherits | inherits | — | `conf/luna-mantaray.conf:18-21` |
| topaz | TouchPad | 1024x768 | true | true | 0.55 / 0.50 | 90 | 30 | XDistanceFactor 0.35, Modal 320x480, SplashIcon 192, HomeButtonAngle **270**, LockScreenTimeoutMs 10000 | `conf/luna-topaz.conf:24-49` |
| opal | TouchPad Go (inferred) | inherits 1024x768 | true | true | 0.55 / 0.50 | 90 | 30 | same as topaz, HomeButtonAngle 0 | `conf/luna-opal.conf:24-47` |
| tuna | (dev / Galaxy Nexus port, inferred) | 720x1280 | **false** | true | 0.50 / 0.45 | 90 | 20 | UIScale 0.4375, TextScale 1.75, VirtualCoreNavi 64px | `conf/luna-tuna.conf:22-55` |
| desktop | emulator | 1024x768 | true | false | 0.55 / 0.50 | 90 | 30 | GestureAreaHeight 40, ShowNotificationsAtTop | `conf/luna-desktop.conf:18-42` |
| chile | unknown | 800x480 | (full conf) | true | | | | DockModeMaxApps 6 | `conf/luna-chile.conf:30-57` |

**Surprise:** `windsornot` is 480x800 (`conf/luna-windsornot.conf:23-24`), which is the Pre 3 resolution, not
the Pre 2 (320x480) (inferred from hardware knowledge). `Src/base/settings/DeviceInfo.cpp:227-233` treats "Windsor" as a keyboard-slider phone.

### 0.2 Settings defaults that confs do not override (`Src/base/settings/Settings.cpp`)

| setting | default | line |
|---|---|---|
| positiveSpaceTopPadding (status bar height) | 24 (overridden to **28** by `conf/luna.conf:122`) | 207 |
| positiveSpaceBottomPadding (phone notification bar) | 24 (overridden to **28**, `conf/luna.conf:123`) | 208 |
| ghostCardFinalRatio | 0.85 | 212 |
| cardGroupRotFactor | 90 (base conf sets 30) | 213 |
| cardGroupingXDistanceFactor | 1.0 (tablets 0.35) | 169 |
| cardDimmPercentage | 0.8 | 243 |
| splashIconSize / enableSplashBackgrounds | 128 / true | 216-217 |
| gestureAreaHeight | 50 | 117 |
| statusBarTitleMaxWidth | 140 | 179 |
| modalWindowWidth x Height | 320 x 480 | 239-240 |
| tapRadius (max) / min / shrink% / shrink gran | 12 / 5 / 10 / 50 ms (conf: 25 / 5 / 10 / 200) | 135-139; `conf/luna.conf:68-71` |
| tapDoubleClickDuration | 300 ms (clamped 50..2000) | 140, 442-447 |
| homeDoubleClickDuration | 70 (conf 150) | 142; `conf/luna.conf:61` |
| launcherSideSwipeThreshold | 1.2 | 173 |
| launcherIconReorderPositionThreshold | 36.0 (conf 20) | 178; `conf/luna.conf:154` |
| launcherLabelXPadding | 12 (conf 0) | 177 |
| dockModeMaxApps / NightBrightness / MenuHeight | 3 / 1 / 400 | 183-188 |
| cardLimit | 16 (conf -1 = unlimited) | 101; `conf/luna.conf:64` |
| lockScreenTimeout | 5000 ms | 123 |
| notificationSoundDuration | 5000 ms | 108 |
| displayUiRotates / tabletUi | false / false (conf true) | 204-205 |

`DeviceInfo` derives the card sizes that apps see: max card = screen W x (H − topPadding), min card height = H − topPadding
− `maximumNegativeSpaceHeightRatio*H` (`Src/base/settings/DeviceInfo.cpp:95-104`).

### 0.3 Scene layering (bottom to top)

`WindowServerLuna` parents all window managers under one root item in this order (`Src/lunaui/WindowServerLuna.cpp:161-171`):

1. DockModeWindowManager
2. DockModeMenuManager
3. CardWindowManager (cards, over the wallpaper drawn by WindowServerLuna, `WindowServerLuna.cpp:89-156`)
4. OverlayWindowManager (launcher, quick-launch dock, search pill, Just Type)
5. EmergencyWindowManager (full-screen: phone call / Flash)
6. DashboardWindowManager (banners, dashboards, popup alerts)
7. MenuWindowManager (status bar, system menu, phone rounded screen corners)
8. TopLevelWindowManager (lock screen)
9. InputWindowManager (virtual keyboard, only if VK enabled, `:135,171`)

Full-erase confirmation window: z 1000 (`WindowServerLuna.cpp:841`).

### 0.4 Positive / negative space

* The screen is split into a **positive space** (where the app card lives) and a **negative space** (the dashboard
  area at the bottom on phones). Initial positive space = `(0, 28, W, H-28)` (`Src/base/SystemUiController.cpp:194-205`).
* The dashboard owns the bottom negative space only if the VK is disabled **and** `ShowNotificationsAtTop` is false
  (`SystemUiController.cpp:82`). So Pre/Pixi/Veer/Pre 3 use the bottom notification bar, and TouchPad and windsornot
  use the status-bar drop-down.
* When the dashboard has content on a phone, the positive space loses the bottom 28 px (`positiveSpaceBottomPadding`,
  `SystemUiController.cpp:1380-1381`). Full-screen apps get `(0,0,W,H)` and the status bar is hidden
  (`:1389-1400`).
* Positive-space change animation: **400 ms, curve 6 OutCubic** (`conf/lunaAnimations.conf:73-74`,
  `SystemUiController.cpp:159-160`). Pixie: 280 ms (`conf/lunaAnimations-pixie.conf`).
* Minimum positive-space height = `((0.26 * normalH) / 2) / 0.40` (`Src/lunaui/cards/CardWindowManager.cpp:280-281`).

---

## 1. Card view (CardWindowManager / CardGroup / CardWindow)

### 1.1 Geometry constants

| constant | value | source |
|---|---|---|
| kActiveScale (initial) | 0.659 | `Src/lunaui/cards/CardWindowManager.cpp:53` |
| kNonActiveScale (initial) | 0.61 | `CardWindowManager.cpp:54` |
| kWindowOriginRatio | 0.40 | `CardWindowManager.cpp:56` |
| kMinimumWindowScale | 0.26 | `CardWindowManager.cpp:60` |
| search-pill fudge | 48 px ("fake the existence of the search pill which happens to be 48 pixels tall") | `CardWindowManager.cpp:780-786` |
| card buffer size (normal) | W x (H − topPadding) | `CardWindowManager.cpp:275-277` |
| kGapBetweenGroups | `GapBetweenCardGroups` (10 base / 30 tablet / 20 tuna) | `CardWindowManager.cpp:166` |
| kMaxClosedSpacedCards | 3 | `Src/lunaui/cards/CardGroup.cpp:31` |
| kMaxStationaryCards | 4 | `CardGroup.cpp:33` |
| kPositionsPerWidth | 3 (one full-width drag shifts 3 cards) | `CardGroup.cpp:34, 598-600` |
| kVelocityPerPosition | 1000 (flick velocity per position) | `CardGroup.cpp:35, 620-626` |

**Effective scale** (`CardWindowManager.cpp:2782-2786`), with `r` the initial positive space:

```
activeScale    = max(0.26, (r.h - 48) * ActiveCardWindowRatio    / r.h)
nonActiveScale = max(0.26, (r.h - 48) * NonActiveCardWindowRatio / r.h)
groupCenterY   = cwm.top + (r.y + 48) + (r.h - 48) * 0.40            // kWindowOrigin, :287 / :2795
```

Worked examples **(inferred, computed from the formulas above)**:

| device | r (positive space) | active scale | minimized card (px) | non-active scale | group center y from screen top |
|---|---|---|---|---|---|
| Pre 3 480x800, base ratios 0.659/0.61 | 480x772 | 0.618 | 297x477 | 0.572 | 365 |
| windsornot 480x800, 0.50/0.45 | 480x772 | 0.469 | 225x362 | 0.422 | 365 |
| Pixi 320x400, base ratios | 320x372 | 0.574 | 184x213 | 0.531 | 206 |
| TouchPad 1024x768 landscape, 0.55/0.50 | 1024x740 | 0.514 | 527x381 | 0.468 | 353 |

### 1.2 Fan layout inside the active group (`CardGroup::calculateOpenedPositions`, `CardGroup.cpp:699-740`)

For card `i` in a group, with `pos` = fractional current position and `aw` = card width x activeScale:

```
x    = ((i - pos) / 3.0) * aw * CardGroupingXDistanceFactor        // :716
rOff = activeScale*50 + aw ;  lOff = -(activeScale*100)            // :711-712
if x > rOff: x = (x + 4*rOff)/5   elif x < lOff: x = (x + 4*lOff)/5 // compress the far ends, :717-720
y    = x > 0 ? x/15 : 0                                             // cards to the right drop slightly, :724
zRot = x / (activeScale * CardGroupRotFactor)   (degrees)           // fan tilt, :713,725
scale = activeScale                                                  // :723
```

* `pos` is clamped. 1 card → 0, 2 cards → 0.5, 3-4 cards → 1.0, more → `[1, n-4+1]` (`CardGroup.cpp:776-791`).
* When the group is offset horizontally (`xOffset != 0`, i.e. while sliding between groups), it collapses:
  `amt = max(1, aw-|xOffset|)/aw`, `x = x*amt + (1-amt)*10*i`, `y *= amt`, `scale = nonActive + (active-nonActive)*amt`,
  `zRot *= amt` (`CardGroup.cpp:727-736`).

### 1.3 Closed (non-active) groups (`CardGroup::calculateClosedPositions`, `CardGroup.cpp:744-771`)

* All cards use **nonActiveScale**. Cards stack with a **7 px** x-step, applied only to the top 3 cards
  (`kMaxClosedSpacedCards`). Deeper cards sit exactly underneath (`:757-764`).
* This layout is only used by `layoutAllGroups` (relayouts without animation: rotation, loading). After a slide
  (`slideAllGroups`, including the minimize) and while dragging (`slideAllGroupsOnTouchUpdate`) every other group is
  `calculateOpenedPositions(xOffset)` with its offset (`animateClose`: the card width, fully folded), so resting
  neighbours show the 10 px collapse above. Phoenix lays every stack out that way.
* Groups are laid out left and right of the active group with `GapBetweenCardGroups` between their bounding widths
  (`CardWindowManager.cpp:2501-2537`).

### 1.4 Card look

| property | value | source |
|---|---|---|
| rounded-corner radius | **40 px** passed to the GL shader, which for a radius of 45 or less uses fixed factors: quarter ellipses 0.009 W × 0.022 H (0.027 H wider than tall), feathered 30 % while scaled, 1 % at full size (`CardRoundedCornerShaderStage.h:64-127`); the software path is a 25 px circle (`m_paintPath`) | `Src/lunaui/cards/CardWindow.cpp:2515-2529` |
| corner radius vs scale | above scale 0.5 the radius factor is interpolated toward square, with the factor clamped at 0.48 | `Src/lunaui/cards/CardRoundedCornerShaderStage.h:112-116` |
| drop shadow | 9-tile `card-shadow-tile.png` (87x87), extends **20 px** on every side, offset **+5 px** down | `Src/base/visual/CardDropShadowEffect.cpp:34-35,44,75-81` |
| shadows off | while the launcher is fully visible ("low-res mode") and on the card being reordered | `CardWindowManager.cpp:3053-3067, 1893` |
| non-active dimming | active card 1.0, the previously active card animates to `cardDimmPercentage` **0.8**, **300 ms curve 6** | `Src/lunaui/cards/CardWindow.cpp:211-213,245-255`; `Src/base/SystemUiController.cpp:1000-1005` |
| modal parent scrim | `#0F0F0F` at 60% opacity over the parent card | `CardWindow.cpp:1593-1599` |

### 1.5 Gestures in card view (minimized state)

| gesture | threshold / behaviour | source |
|---|---|---|
| axis lock | after moving past `tapRadiusSquared` (TapRadiusMax 25 → 625 px²) the drag locks **horizontal** if `|dx| > 0.866·|dy|` (within 30° of horizontal), else vertical | `CardWindowManager.cpp:1464-1476`; `conf/luna.conf:68`; `Settings.cpp:440` |
| horizontal drag | first scrolls the fan inside the active group (`pos += -dx/(cardW/3)`). At the group edge it switches to dragging all groups | `CardWindowManager.cpp:1482-1499`; `CardGroup.cpp:594-602` |
| horizontal release | snaps to the group closest to center, then `slideAllGroups` | `CardWindowManager.cpp:1597-1600` |
| horizontal flick | inside the group: `pos += -vx/1000`. At the edge: vx>0 → previous group, else next group | `CardWindowManager.cpp:1720-1737` |
| vertical drag | only moves the card under the finger, and only while the finger stays inside that card's column | `CardWindowManager.cpp:1500-1535` |
| **flick up to close** | close if `distanceY < -50` AND `vy < -500` AND `vy < (-1100 * -50)/distanceY`. Units: touch-path velocity is px/ms x100 (`FlickGestureRecognizer.cpp:113`) | `CardWindowManager.cpp:63-65,1700-1708` |
| drag-release close | card center above the top edge → close. Card center **below the bottom edge → "angry card" close**, which also disables keep-alive (hard kill) | `CardWindowManager.cpp:1584-1596, 2841-2856` |
| close animation | card flies to `offTop = top − (y + h/2)`, **300 ms curve 6 OutCubic** (`cardDelete`) | `CardWindowManager.cpp:2862-2874`; `conf/lunaAnimations.conf:35-36` |
| close sounds | `appclose` feedback. The "angry" drag plays `carddrag` past threshold `(H/2)*0.30` and `birdappclose` on release, but only when the UI is upside down (Orientation_Down) — an easter egg | `CardWindowManager.cpp:264-267,1280-1283,1522-1527,2890-2894`; `Settings.cpp:106` |
| tap | if the tap hits the active group: groups of ≤4 cards maximize the tapped card. For larger groups, a card close to the current position maximizes, otherwise the fan scrolls toward the tap (`shouldMaximizeOrScroll`). A tap left or right outside the group column switches group | `CardWindowManager.cpp:2151-2195`; `CardGroup.cpp:402-470` |
| tap-and-hold on card | enters **Reorder**: card opacity 0.8, shadow off, detached from group | `CardWindowManager.cpp:1648-1661,1888-1899` |
| tap-and-hold off card | left of center → previous group, right → next group | `CardWindowManager.cpp:1655-1660` |
| flick recognizer (touch) | manhattan velocity between 2.5 and 11 px/ms. Velocity is reported x100 | `Src/base/gesture/FlickGestureRecognizer.cpp:44-46,100-113` |
| tap-and-hold / tap radius | 40 px (Qt5 recognizers) | `Src/base/gesture/WebosTapAndHoldGestureRecognizer.cpp:53`; `WebosTapGestureRecognizer.cpp:57` |
| keyboard nav | ←/→ switch card, Enter maximizes, Ctrl+Backspace closes | `CardWindowManager.cpp:1189-1212` |

### 1.6 Reorder

* Screen edge zones = width / `s_marginSlice` (5), so the left and right 20% are zones (`CardWindowManager.cpp:68,1876-1886`).
* In the center zone the card shuffles within its group (**350 ms curve 6**, `cardShuffleReorder`). Entering the left or
  right zone moves the card to the neighbouring group or creates one (**500 ms curve 6**, `cardGroupReorder`)
  (`CardWindowManager.cpp:1909-2040`; `conf/lunaAnimations.conf:43-46`).
* Tracking the dragged card: 1:1 with the finger, at activeScale (`CardWindowManager.cpp:1835-1847`).
* On release: opacity back to 1.0, shadow on, reattached, slideAllGroups (`CardWindowManager.cpp:1603-1621`).
* `launcherCardReorderScrollPauseDuration` 550 ms (`conf/lunaAnimations.conf:89`).

### 1.7 Maximize / minimize

* **Maximize** (`CardGroup::maximizeActiveCard`, `CardGroup.cpp:325-373`): the active card animates to translation
  `(−x, −y + positiveSpace.y/2)` at scale 1.0. Cards below it in the stack fly to `x = 2*parent.left`, cards above
  to `−2*parent.left`, at activeScale. **300 ms curve 10 OutQuart** (`conf/lunaAnimations.conf:31-32`). The center offset is
  `r.y()/2` (14 px) (`CardWindowManager.cpp:1105`).
* **Minimize**: `slideAllGroups()`. The active group's x → 0 over **300 ms curve 10 OutQuart** (`cardSlide`). The active group's
  cards fan open over a hard-coded **200 ms OutCubic**, and the other groups close over 300 ms curve 10
  (`CardWindowManager.cpp:2481-2541`; `conf/lunaAnimations.conf:25-26`).
* **Where new cards go**: a card launched by the focused app (same process or appId) joins the **front of the active group**.
  Otherwise it starts a **new group to the right** of the active group. Launches with no active group append a group at the end
  (`CardWindowManager.cpp:556-599`). New cards start off-screen below and slide in (`setActiveCardOffScreen`, `:1224-1237`).
* **Card-to-card transition** inside an app (scene push/pop): the old scene scales 1.0→1.25 (push) or →0.75 (pop) while fading out,
  and the new scene scales 0.75→1.0 (push) or 1.25→1.0 (pop) while fading in. **300 ms**, strength 20 → easeOutQuad
  (`Src/lunaui/cards/CardTransition.cpp:58-91,124-125`; `AnimationSettings.cpp:380-392`).
* Rotation: `rotationAnimationDuration` 300 ms (`conf/lunaAnimations.conf:127-128`). The window-server rotation uses
  InOutCubic (`Src/base/WindowServer.cpp:1952`).

### 1.8 Loading card and pulse

| phase | value | source |
|---|---|---|
| prepare delay before the card appears | `cardPrepareAddDuration` **150 ms** | `CardWindow.cpp:1395-1400`; `conf/lunaAnimations.conf:51` |
| max wait for app window | `cardAddMaxDuration` **750 ms** (modal 10 ms). The loading overlay starts only if the app isn't ready after 150 ms | `CardWindow.cpp:1470-1492`; `conf/lunaAnimations.conf:53-54` |
| background | app/scene splash bg if `EnableSplashBackgrounds` (off on tablets). Otherwise `loading-bg.png` (768x1024) through the rounded-corner shader. Fallback: vertical gradient `#484848 → #1E1E1E` | `Src/lunaui/cards/CardLoading.cpp:64-76,100-117,244-274` |
| icon | the app's `splashIcon` scaled to `SplashIconSize` (128, tablets 192), else the launcher icon x1.5 (capped at the splash size) | `CardLoading.cpp:80-98` |
| glow | `loading-glow.png` (228x228) behind the icon, opacity = pulse | `CardLoading.cpp:52-56,278-285` |
| pulse | starts after **900 ms**. One pulse = 1000 ms (500 in / 500 out) at `slowFPS` 20, then a 1000 ms pause | `CardLoading.cpp:124-135,296-316`; `conf/lunaAnimations.conf:55-60` |
| cross-fade out | **300 ms curve 0 Linear** | `CardLoading.cpp:139-143`; `conf/lunaAnimations.conf:58-59` |
| launch sound | `lunaSystemSoundAppOpen` feedback on add | `Src/lunaui/cards/CardWindowManagerStates.cpp:645-646` |

### 1.9 Ghost card (Touch-to-Share)

A clone at 50% opacity flies off the top and scales to `ghostCardFinalRatio` **0.85** over **750 ms curve 10 OutQuart**
(`CardWindowManager.cpp:2923-2957`; `conf/lunaAnimations.conf:63-64`; `Settings.cpp:212`).

### 1.10 First-card tutorial

On the first minimize, `signalFirstCardRun` shows `uiComponents/DismissCardTutorial/dismissDialog.qml` (320x170, title 18 px,
body 14 px, 52 px button). The marker file is `/var/luna/preferences/used-first-card`
(`CardWindowManager.cpp:1168-1187`; `Settings.cpp:167`; `dismissDialog.qml:16-55`).

### 1.11 Card state machine (`CardWindowManager.cpp:180-246`, `CardWindowManagerStates.cpp`)

| from \ signal | MaximizeActive | MinimizeActive | Preparing(win) | Focus(win) | EnterReorder | ExitReorder | LoadingActive |
|---|---|---|---|---|---|---|---|
| **Minimize** (initial) | → Maximize | — | → Preparing | → Focus | → Reorder | — | — |
| **Maximize** | — | → Minimize | → Preparing | → Focus (only if win ≠ active, `MaximizeToFocusTransition`) | — | — | — |
| **Focus** | → Maximize | → Minimize | → Preparing | → Focus | — | — | — |
| **Preparing** | → Maximize | → Minimize | → Preparing | — | — | — | → Loading |
| **Loading** | → Maximize | → Minimize | → Preparing | — | — | — | — |
| **Reorder** | — | — | — | — | — | → Minimize | — |

* Minimize entry: unfocus the active card, resize it to normal bounds, run the first-card alert, and report "not maximized"
  to SystemUiController (`CardWindowManagerStates.cpp:181-194`).
* Preparing and Loading: a touch anywhere minimizes (cancels the launch zoom) (`CardWindowManagerStates.cpp:626-632,663-670`).
* Maximize: an incoming phone call triggers the transition, and it handles Touch-to-Share (`CardWindowManagerStates.cpp:218-231,477-493`).

### 1.12 Card animation values actually consumed

`lunaAnimations.conf` has many `card*` keys that **no code in this repo reads**. They are 2.x leftovers:
`cardLaunch*`, `cardMinimize*`, `cardScootAwayOnLaunch*`, `cardMoveNormal*`, `cardMoveOverview*`, `cardSwitch*`
(grep shows no `AS(cardLaunch…)` etc.). The consumed values:

| key | ms | curve | used at |
|---|---|---|---|
| cardSlide | 300 | 10 OutQuart | `CardWindowManager.cpp:2490-2508` |
| (active group fan open) | 200 (hard-coded) | OutCubic | `CardWindowManager.cpp:2495` |
| cardTrack / cardTrackGroup | 300 / 50 | 10 / 0 | `CardWindowManager.cpp:2553-2591`; defaults `AnimationSettings.cpp:47-48`; conf `:27-30` |
| cardMaximize | 300 | 10 | `CardGroup.cpp:335-366` |
| cardDelete | 300 | 6 OutCubic | `CardWindowManager.cpp:688,792` |
| cardShuffleReorder | 350 | 6 | `CardWindowManager.cpp:1922,2051` |
| cardGroupReorder | 500 | 6 | `CardWindowManager.cpp:1976,2031` |
| cardGhost | 750 | 10 | `CardWindowManager.cpp:2941` |
| cardDimming | 300 | 6 | `CardWindow.cpp:212-213` |
| cardTransition | 300 | strength 20 → easeOutQuad | `CardTransition.cpp:58-59`; `CardHostWindow.cpp:73-74` |
| cardLoadingPulse / Pause / TimeBefore / CrossFade | 1000 / 1000 / 900 / 300 | 1 / – / – / 0 | `CardLoading.cpp:124-143` |
| Pixie overrides | ~0.7x: slide 210, maximize 210, delete 210, positiveSpace 280 … | | `conf/lunaAnimations-pixie.conf` |

---

## 2. Status bar

### 2.1 Geometry and background

| property | value | source |
|---|---|---|
| height | `PositiveSpaceTopPadding` = **28 px** on every device (no device conf overrides it. The code default is 24) | `conf/luna.conf:122`; `Settings.cpp:207`; `Src/lunaui/status-bar/MenuWindowManager.cpp:83` |
| position | top of screen, z 100 | `MenuWindowManager.cpp:111-115` |
| tablet background | tiled `statusBar/status-bar-background.png` (20x28) over a solid color fill. The fill's opacity animates 0↔1 when an app is maximized (`fadeBar`) | `StatusBar.cpp:227,240-262,765-778,780-` |
| default fill color | `#515558` | `StatusBar.cpp:47` |
| launcher / Just Type fill | `#4F545A` (0x4f545AFF) | `Src/base/SystemUiController.cpp:69-70,817-819` |
| app custom color | apps pass `0xRRGGBBAA` with the maximized title | `StatusBar.cpp:476-500` |
| phone background (`!tabletUi`) | solid **black** | `StatusBar.cpp:767-768` |
| phone screen corners | four 24x24 `wm-corner-{top,bottom}-{left,right}.png` overlays at the positive-space corners, only when `!tabletUi` | `MenuWindowManager.cpp:126-146,495-510`; `Src/base/visual/RoundedCorners.cpp:41-68` |

### 2.2 Layout

**Tablet** (`StatusBar.cpp:92-146,383-412`):

```
[ title group (left-aligned): app title / carrier, with down-arrow ] ...... [ notif group ][ system group: info icons · battery · clock · ▼ ]
```

* Title group at `x = -W/2`, system group right-aligned at `x = +W/2`, notification group placed immediately left of the system
  group (`StatusBar.cpp:386-410`).
* The system group adds items right to left: **clock** (rightmost), **battery**, then the **info icon strip**
  (`StatusBar.cpp:98-104`; `StatusBarItemGroup.cpp:504-565`).
* Info icons, right to left: RSSI, WAN (1x/EV-DO/3G/EDGE/GPRS/HSPA+), Bluetooth, Wi-Fi, TTY, HAC, call-forward,
  roaming, VPN, rotation-lock, mute, airplane (`StatusBarInfo.cpp:183-274`).
* Notification area: up to 10 icons x (24 + 5) px (`StatusBar.h:31-32`; `StatusBar.cpp:128`).

**Phone** (`!tabletUi`, `StatusBar.cpp:146-181,413-437`): title group left, system group (battery + info) right,
**clock centered at x=0**. Types TypeLockScreen/TypeFirstUse drop the title group.

| spacing constant | px | source |
|---|---|---|
| ITEM_SPACING | 5 | `StatusBarItemGroup.cpp:28` |
| GROUP_RIGHT_PADDING | 3 | `StatusBarItemGroup.cpp:29` |
| ARROW_SPACING | 7 | `StatusBar.h:33` |
| ICON_SPACING (info strip) | 5 | `StatusBarIcon.h:35` |
| title bg left / right cap | 13 / 20 (`appname-background.png` 40x26, 3-slice) | `StatusBarTitle.cpp:31-32,72,170-186` |
| title padding without border | 7. With border: −4 | `StatusBarTitle.cpp:34-35` |
| title max width | 140 | `Settings.cpp:179` |
| menu tab highlight | `status-bar-menu-dropdown-tab.png` (80x28), 3-slice, **11 px** margin, shown while the menu is open | `StatusBarItemGroup.cpp:94-95,382-401` |
| separator | `status-bar-separator.png` 2x28 | `StatusBarItemGroup.cpp:61` |
| menu arrow | `statusBar/menu-arrow.png` 15x26 | `StatusBarItemGroup.cpp:54` |

### 2.3 Text

| element | font | color | source |
|---|---|---|---|
| clock | Prelude **15 px**, baseline offset −2. Lock screen shows the date as well | white | `StatusBarClock.cpp:34,56-57,130`; `StatusBar.cpp:316-324` |
| clock format | 12 h drops the leading zero. Demo mode shows "12:00" | | `StatusBarClock.cpp:35,200-204` |
| title / carrier | Prelude **14 px**, letter spacing 90%, baseline −2, elided | white | `StatusBarTitle.cpp:36,56-59,192`; `StatusBar.h:37` |
| battery % text | Prelude 14 px, baseline −1 | white | `StatusBarBattery.cpp:33,67-68,138` |
| default carrier string | "Open webOS" | | `StatusBar.cpp:48` |

### 2.4 Battery

* 17x20 images `battery-0..11.png` and `battery-charging-0..11.png`, plus `battery-charged.png` and `battery-error.png`
  (`StatusBarBattery.cpp:49-50,158-178`).
* Level → index thresholds `{12,20,28,36,44,52,60,68,76,84,88,99,100}` (`StatusBarBattery.cpp:35,200-210`).
* Reaching 100% while charging plays `/usr/palm/sounds/battery_full.mp3` (`StatusBarBattery.cpp:216-218`).

### 2.5 Status-bar animations (`conf/lunaAnimations.conf:111-125`)

| key | ms | curve | notes |
|---|---|---|---|
| statusBarFade | 300 | 0 Linear | bg opacity on maximize (`StatusBar.cpp:249-250`) |
| statusBarColorChange | 300 | 0 | RGB lerp (`StatusBar.cpp:257-258,855-872`) |
| statusBarTitleChange | 300 | 0 | cross-fade with width lerp (`StatusBarTitle.cpp:206-235`) |
| statusBarTabFade | 300 | **0** (the conf key is misspelled `statusBarTabFadeeCurve`, so the 3 is ignored) | `conf/lunaAnimations.conf:118-119`; `AnimationSettings.cpp:309-310` |
| statusBarArrowSlide | 500 | 3 InOutQuad | `StatusBarItemGroup.cpp:146-148` |
| statusBarItemSlide | 1000 | 3 InOutQuad | icons appearing/disappearing (`StatusBarIcon.cpp:34,93-94`) |
| statusBarMenuFade | 200 | 0 | menu open/close (`StatusBarItemGroup.cpp:254-289`) |

### 2.6 Tap targets

* Tablet: the title group opens the app menu (actionable only when an app is maximized), the system group opens the **System Menu**,
  and the notification group opens the **dashboard drop-down** (`StatusBar.cpp:111-143`).
* Phone: the system group is actionable (system menu) and the title group opens the app menu (`StatusBar.cpp:150-165`).

---

## 3. System menu (status-bar drop-down)

QML: `uiComponents/SystemMenu/SystemMenu.qml`, hosted by `Src/lunaui/status-bar/SystemMenu.cpp` (C++ bounds 320x480,
`SystemMenu.cpp:94`; `MenuWindowManager.cpp:89`). It anchors to the right edge under the status bar
(`MenuWindowManager.cpp:117-123`).

| property | value | source |
|---|---|---|
| width / max height | **300 / 410** | `SystemMenu.qml:6,16` |
| background | `menu-dropdown-bg.png` (80x160) 9-slice, border L30 T10 R30 B30 | `SystemMenu.qml:101-106` |
| clip margins | left 7, top 0, right 7, bottom 14 | `SystemMenu.qml:108-116` |
| row height | **42 px** | `uiComponents/SystemMenu/MenuListEntry.qml:6` |
| selection highlight | `menu-selection-gradient-default.png` (last row: `-last`), 9-slice caps 19, width = row − 8 | `MenuListEntry.qml:16-29` |
| divider | `menu-divider.png` (10x2), width = parent − 7 | `MenuDivider.qml` |
| indents | header 14, sub-item 16, edge offset 11 | `SystemMenu.qml:7-11` |
| primary text | Prelude 18 px, `#FFF` (disabled `#AAA`) | `WiFiElement.qml:149-152`; `AirplaneModeElement.qml:21-24` |
| info text (date, battery) | Prelude 18 px `#AAA` | `DateElement.qml:13-18`; `BatteryElement.qml` |
| status sub-text | Prelude 13 px `#AAA`, ALL CAPS | `WiFiElement.qml:171-174` |
| network list row | name 16 px `#FFF`. Status 10 px `#AAA` caps. Signal icon `wifi-N.png`, lock `system-menu-lock.png`, check `system-menu-popup-item-checkmark.png` | `WifiEntry.qml:21-63` |
| scroll affordance | `menu-dropdown-scrollfade-top/bottom.png` + `menu-arrow-up/down.png`. Opacity 70 ms | `SystemMenu.qml:289-333` |
| scroll animation | 200 ms InOutQuad | `SystemMenu.qml:125-129` |
| drawer (Wi-Fi/VPN/BT) open/close | **350 ms OutCubic**. Body-height behaviour 200 ms | `uiComponents/SystemMenu/Drawer.qml:77,97-101` |
| close after toggle | 250 ms | `SystemMenu.qml:247,263,280` |
| date refresh | every 30 s | `SystemMenu.cpp:63` |
| brightness | slider with `brightness-less.png` / `-more.png` (24x24) end icons, `slider-track.png`, `slider-track-progress.png`, `slider-handle.png` (30x30). Floor **10%** | `BrightnessElement.qml:28-60`; `Slider.qml:127-145`; `SystemMenu.cpp:61,875` |
| spinner | `spinner.png`, 60 frames / 1000 ms | `SystemMenu.cpp:997-1006` |

**Item order (top to bottom)** (`SystemMenu.qml:137-283`): Date → Battery → Brightness → Wi-Fi (drawer, hidden until
a radio exists) → VPN (drawer) → Bluetooth (drawer) → Airplane Mode → Rotation Lock → Mute. Wi-Fi, BT and VPN drawers
close while airplane mode is transitioning (`SystemMenu.qml:68-78`). "Wi-Fi Preferences" / "Bluetooth Preferences" rows launch
`com.palm.app.wifi` / `com.palm.app.bluetooth` / `com.palm.app.vpn` (`SystemMenu.cpp:56-59`). Toggle icons:
`icon-airplane(-off)`, `icon-rotation-lock(-off)`, `icon-mute(-off)` (`AirplaneModeElement.qml:34,44`; `RotationLockElement.qml`;
`MuteElement.qml`).

Generic drop-down container (dock-mode app menu and other menus): `uiComponents/MenuContainer/MenuContainer.qml` uses the same
background and fades, max height 410.

---

## 4. Notifications

### 4.1 Which model

| | phone (Pre/Pixi/Veer/Pre 3) | tablet (TouchPad, windsornot, desktop) |
|---|---|---|
| condition | VK disabled and not ShowNotificationsAtTop → `dashboardOwnsNegativeSpace` | otherwise → overlay (`m_isOverlay`) |
| banner lives in | **bottom notification bar**, 28 px (`positiveSpaceBottomPadding`), black | status-bar notification area (top right) |
| dashboards | expand **upward from the bottom** into negative space, max `MaximumNegativeSpaceHeightRatio` 0.55 of H (Pixi 0.65) | 320 px wide drop-down under the status bar (`DashboardMenu.qml`) |
| popup alerts | full-width in negative space | 320 px wide, top-right, 5 px padding |
| source | `SystemUiController.cpp:82,1375-1450`; `DashboardWindowManager.cpp:110-126,142-180` | `DashboardWindowManager.cpp:62-63,1234-1260,1350-1355` |

### 4.2 Banner

| property | value | source |
|---|---|---|
| font | Prelude **16 px** | `Src/lunaui/notifications/BannerMessageHandler.cpp:67,200-208` |
| text margin | 5 px, icon then text | `BannerMessageHandler.cpp:68,320-430` |
| icon | height ≤ 28 (bar height), aspect kept | `Src/lunaui/notifications/BannerWindow.cpp:100-114` |
| show time | **5000 ms** if it's the only message, **2000 ms** if more are queued. When a new one arrives the current one shortens to the remaining part of 2000 | `BannerMessageHandler.cpp:69-70,488-507,629-633` |
| states | idle (pos 0, α 1) → show (pos 1, α 1) → close (pos 0, **α 0.25**) → final | `BannerMessageHandler.cpp:611-676` |
| animation | slide in from the right (`offsetX = (1-progress)*width`), **1000 ms OutCubic**. Hide 1000 ms (linear) | `BannerMessageHandler.cpp:122-130,348` |
| sounds | `notification.wav` / `alert.wav`. Duration cap `NotificationSoundDuration` 5000 | `BannerMessageHandler.cpp:72-75`; `conf/luna.conf:41` |
| active-call banner | Prelude 16 px, 2 px padding, timer tick 450 ms, `(hh:mm:ss)` | `ActiveCallBanner.cpp:36-56,107-131` |

### 4.3 Dashboard

| property | value | source |
|---|---|---|
| dashboard item height | **52 px** | `DashboardWindowContainer.cpp:48` |
| badge (icon) width | 50 px | `DashboardWindowContainer.cpp:49` |
| max visible | 5.5 items (then scroll with fades) | `DashboardWindowContainer.cpp:47` |
| tablet container width | 320 | `DashboardWindowManager.cpp:63` |
| top padding / bottom mask correction | phone 10/10, tablet menu 0/7 | `DashboardWindowContainer.cpp:96-108` |
| art | `dashboard-mask-top/bottom.png`, `menu-dropdown-bg.png`, scroll fades, `menu-arrow-up/down.png`, `menu-dropdown-swipe-bg.png`, `menu-dropdown-swipe-highlight.png`, `menu-divider.png` | `DashboardWindowContainer.cpp:1189-1246` |
| swipe to dismiss | drag > **¼ of item width**, or a flick with |vx| > |vy|. `persistent` dashboards can't be dismissed | `DashboardWindowContainer.cpp:350-363,428-440` |
| delete animation | `dashboardDelete` 200 ms Linear | `AnimationSettings.cpp:117`; `DashboardWindowContainer.cpp:704-705` |
| snap / height anim | `dashboardSnap` **500 ms curve 6** (conf; code default 200) | `conf/lunaAnimations.conf:68-70`; `DashboardWindowContainer.cpp:119-120` |
| alert fade | 400 ms | `DashboardWindowManager.cpp:559,589` |
| popup-alert container | `popup-bg.png` 9-tile, 20 px margin. Transient alerts use `transient-alart-bg.png` (sic) | `Src/lunaui/GraphicsItemContainer.cpp:40,118,128` |

### 4.4 Notification policy (`conf/notificationPolicy.conf:18-45`, read by `NotificationPolicy.cpp:28`)

* **popupalert** allow-list: phone (incoming-phoneapp, incoming-known, incoming-unknown, emergencymode, dropped, fail, missed,
  provisioning), clock "ring", systemui (SysUpdateFinalInstallAlert, CriticalResourceAlert, AccountServiceAlert, PowerOffAlert,
  TimezoneErrorAlert), calendar (all), messaging "messaging-class0Alert-stage".
* **activeBanner**: phone. **dashboard**: phone.

### 4.5 Volume HUD

`VolumeControlAlertWindow` uses `notification-volume-indicator.png` (phone), `notification-music-indicator.png`
(media), `notification-ringtone-indicator.png` (ringer), and `bell_off.png` (ringer muted) (`VolumeControlAlertWindow.cpp:34-37`).

---

## 5. Launcher ("launcher3" / DimensionsUI) and quick launch

Settings files: `/etc/palm/launcher3/*.conf` (`Src/lunaui/launcher/layoutsettings.cpp:33`, `gfx/gfxsettings.cpp:31`, etc.).
Art is loaded from `/usr/palm/sysmgr/images/launcher3/` (`gfx/gfxsettings.cpp:64`).

### 5.1 Overlay composition (`OverlayWindowManager.cpp:102-105`)

| layer | z |
|---|---|
| launcher (DimensionsUI) | 0 |
| search pill / Just Type | 10 |
| quick-launch dock | 20 |
| launch feedback | 40 |

States: Launcher {NoLauncher, Regular, Reorder}. Dock {NoDock, Normal, Reorder}. SearchPill {Hidden, Visible}.
UniversalSearch {Hidden, Visible} (`OverlayWindowManager.h:76-95`).

### 5.2 Launcher panel

| property | value | source |
|---|---|---|
| show/hide | slides up from `y = uiHeight` (hidden) to `y = topPadding/2` (shown) | `OverlayWindowManager.cpp:1267-1272,1995-2009` |
| slide animation | `launcherDuration` **350 ms, curve 15 InOutQuint** (conf. Code default 200/2). Pixie 245 | `conf/lunaAnimations.conf:83-84`; `OverlayWindowManager.cpp:275-279` |
| launcher size | 100% x 100% of screen. Page = 100% x **95%** of launcher | `layoutsettings.cpp:57-59` |
| background | `launcher3/launcher-bg.png` (180x180 tile), scroll fades `launcher-scrollfade-top/bottom.png` | `dimensionslauncher.cpp:92-99` |
| tab bar | height **50 px** absolute. Tab font **16 px bold**. Selected `#FFFFFF`, unselected `#C8C8C8`. Max tab width 150 | `layoutsettings.cpp:67-74`; `elements/bars/pagetabbar.cpp:76,85` |
| tab art | `tab-bg.png` (10x50), `tab-selected-bg.png` (50x50), `tab-highlight.png`, `tab-divider.png` (2x50), `tab-shadow.png` | `pagetabbar.cpp:52-56` |
| pages (default) | **apps**, **downloads**, **prefs** (named "settings"). Favorites is created if missing. Indices: system 0, installed 1, favorites 2, settings 3 | `conf/default-launcher-page-layout.json`; `conf/launcher3/app-keywords-to-designator-map.txt`; `operationalsettings.cpp:192-197` |
| Done button (reorder) | font 15 px bold white. Offset (12,0), conf x-adjust 42, text y-adjust −3. `edit-button-done.png` | `layoutsettings.cpp:76-80`; `conf/launcher3/layoutSettings.conf:18-20`; `dimensionslauncher.cpp:94` |
| page edge activation (drag icon to scroll) | vertical 20 px, horizontal 50 px, 1000 ms dwell | `layoutsettings.cpp:60-65` |
| page auto-scroll | delay 800 ms, amount 150 px, animation 300 ms. Pan during icon move 1500 ms | `dynamicssettings.cpp:101-104` |
| empty page | text "Tap and hold any app to drag it to this page." Conf: 18 px `#aaaaaa`, box 350 wide, +190 px from center. `launcher-empty-page.png` 280x220 | `iconlayoutsettings.cpp:163-170`; `conf/launcher3/launcher_icon_layoutsettings.conf:23-26`; `reorderablepage.cpp:64` |

### 5.3 Icon grid and icon

| property | value | source |
|---|---|---|
| icon cell | **128x128** fixed | `icongeometrysettings.cpp:178`; `iconlayoutsettings.cpp:153,160` |
| main icon | **64x64**, offset (0,−13) from cell center (conf −11) | `icongeometrysettings.cpp:188,193`; `conf/launcher3/launcher_icon_geom_settings.conf:23` |
| label box | 100x40. Label spacing below icon 5 (conf **2**) | `icongeometrysettings.cpp:180-182`; conf `:25` |
| label font | **14 px bold white** Prelude | `icongeometrysettings.cpp:203-205` |
| frame / edit background | `edit-icon-bg.png` 128x128. Touch feedback `launcher-touch-feedback.png` 90x90 | `elements/icons/iconheap.cpp:61-62` |
| remove/delete badge | 32x32 at (−50,−47) (conf (−50,−50)): `edit-button-remove.png`, `edit-button-delete.png` | `icongeometrysettings.cpp:190-197`; `iconheap.cpp:35-39` |
| install-status badge | 32x32 at (50,−50). Progress `loading-strip.png`, error `warning-icon.png` | `icongeometrysettings.cpp:198-202`; `iconheap.cpp:44,51` |
| reorderable grid | max per row **7** (conf. Default 6). Row left margin **27** (conf. Default 50). Top margin 20. Inter-row 10. Horizontal adjust **12** (conf) | `iconlayoutsettings.cpp:156-162`; `conf/launcher3/launcher_icon_layoutsettings.conf:18-22` |
| alphabetic grid | 7 per row, left margin 25, rows 10/10, divider `list-divider.png` (710x2) with label 16 px bold `#999999` | `iconlayoutsettings.cpp:146-155`; `staticelementsettings.cpp:177-182`; `alphabeticonlayout.cpp:44` |
| installing icon opacity | 0.5 | `dynamicssettings.cpp:105` |
| reorder motion | icon move 300 ms InQuad (distance-scaled, minimum 200). Snapback 250 ms InQuad | `dynamicssettings.cpp:86-100` |
| app info dialog | `uiComponents/AppInfoDialog/AppInfoDialog.qml` (width 320+2·edge, title 18, body 14, buttons 52 high). Fade in 400 / out 600 | `AppInfoDialog.qml:23-133`; `dynamicssettings.cpp:106-107` |
| launch feedback timeout | 3000 ms | `dynamicssettings.cpp:108` |
| label width/padding conf | `LauncherLabelWidthAdjust=0`, `LauncherLabelXPadding=0`, reorder threshold 20 | `conf/luna.conf:151-154` |

### 5.4 Quick-launch bar (dock)

| property | value | source |
|---|---|---|
| height | **100 px** absolute, full width | `layoutsettings.cpp:82-84`; `elements/bars/quicklaunchbar.cpp:643` |
| max items | **5** | `layoutsettings.cpp:87` |
| icon size / y | 64x64 at y = 20 | `QuicklaunchLayout.cpp:46-49` |
| item spacing | 5..200 px (MIN/MAX_ITEM_DISTANCE) | `QuicklaunchLayout.cpp:26-27,50` |
| item area offset | (0, 65) | `layoutsettings.cpp:86` |
| launcher-access button | `quicklaunch-button-launcher.png` 64x128 sprite: normal (0,0,64,64), active (0,64,64,64). Offset y 20 | `quicklaunchbar.cpp:65-67`; `layoutsettings.cpp:85` |
| backgrounds | `quicklaunch-bg.png` (translucent, 10x105 h-tile) over cards, `quicklaunch-bg-solid.png` over the launcher (bg opacity animated) | `quicklaunchbar.cpp:62-63`; `OverlayWindowManager.cpp:295-297` |
| dragging icon | opacity 0.5, raised 15 px | `quicklaunchbar.cpp:68,1390` |
| shown / hidden | shown at bottom. Hidden = shown + bar height (slides down) | `OverlayWindowManager.cpp:1188-1197` |
| animations | position `quickLaunch` **350 ms OutCubic**. Fade 200 ms OutCubic. Slide-to-stache 150. Pixie 245/105 | `conf/lunaAnimations.conf:77-82`; `OverlayWindowManager.cpp:282-297` |
| dock visibility rule | the dock shows in card view and hides when a card maximizes (`signalShowDock`/`signalHideDock` on Home, up-swipe, down-swipe) | `SystemUiController.cpp:485-488,516-519,572-576` |

### 5.5 Search pill and "Just Type" (universal search)

* Pill: width **588**, 3-slice `search-field-bg-launcher.png` (90x50, 40 px caps) with `search-button-launcher.png`.
  Placed **9 px** below the status bar, horizontally centered (`layoutsettings.cpp:91-94`; `OverlayWindowManager.cpp:1150-1177`).
  Tapping it opens universal search. Card view reserves 48 px above the cards for it (see 1.1).
* **Just Type:** any printable key (Space..ÿ) or Shift/Alt pressed while no card is maximized opens universal search and forwards the key
  (`OverlayWindowManager.cpp:971-995`). BT keyboard `Key_Search` toggles it (`SystemUiController.cpp:607-619`).
* The universal search window is the `com.palm.launcher` web app (`Type_Launcher`) (`Src/remote/WebAppMgrProxy.cpp:105-110`;
  `OverlayWindowManager.cpp:1872`). Cross-fade **150 ms OutCubic** (`conf/lunaAnimations.conf:87-88`). While it's shown, the status bar takes
  the launcher color `#4F545A` and the app's title (`SystemUiController.cpp:815-820`).
* Default web search: Google (`conf/defaultPreferences.txt`, `webSearchList`).

---

## 6. Lock screen (`Src/lunaui/lockscreen/LockWindow.cpp`, `ClockWindow.cpp`)

| element | value | source |
|---|---|---|
| status bar | TypeLockScreen, same 28 px. Clock centered **with date** | `LockWindow.cpp:412-415`; `StatusBar.cpp:95-98,316-324` |
| big clock | digit bitmaps `screen-lock-clock-0..9.png` (50x80), `-colon.png` (20x80), `-decimal.png`. Laid out centered by summing glyph widths. 12 h format drops the leading zero | `ClockWindow.cpp:81-99,108-157` |
| clock position | center y = **−0.35·H** from screen center (15% from top) | `LockWindow.cpp:427,543` |
| unlock handle | `screen-lock-padlock-off.png` / `-on.png` (100x100). The incoming-call variant uses `screen-lock-incoming-call-off/on.png` | `LockWindow.cpp:2327-2335` |
| handle rest position | center y = bottom − **0.10·H** − h/2 (`LOCK_BUTTON_OFFSET 0.1`) | `LockWindow.cpp:81,454,560` |
| unlock rule | drag the handle so its distance from the anchor is > **146 px** (radius² 146²) **and** it's above the rest y, then release | `LockWindow.cpp:89,1801-1847` |
| help text | "Drag up to unlock" / "Drag up to answer", Prelude **20 px bold** white, drawn on `screen-lock-target-scrim.png` (320x190). Hides 1000 ms after release | `LockWindow.cpp:91,95-96,2417-2454` |
| wallpaper masks | `screen-lock-wallpaper-mask-top.png` (320x117), `-bottom.png` (10x250) | `LockWindow.cpp:2510-2513` |
| lock-screen notifications | width **320** (`kMaxWidth`). Alerts area from topPadding down to **84 px** above the bottom. Dashboards use `dashboard-scroll-fade.png` and `menu-divider.png`. Popups use `popup-bg.png` 9-tile with 10 px padding | `LockWindow.cpp:83-87,459,2601-2606,2745-2852` |
| fades | lock window 150 ms curve 1 InQuad. PIN panel / dialogs 200 ms Linear | `conf/lunaAnimations.conf:103-109`; `LockWindow.cpp:402-403,2103-2129,2282-2283` |
| states | Unlocked, Normal, DockMode, PinEntry, LastTryDialog, NewPinDialog | `LockWindow.h:129-137` |
| lock timeouts | lockScreenTimeout 5000 ms (TouchPad 10000). Display defaults: timeout 120 s, brightness 40, lock-after-off 2000 ms, alert 6000 ms | `Settings.cpp:123`; `conf/luna-topaz.conf:46`; `Src/base/DisplayManager.cpp:95-115` |

### 6.1 PIN / password panel (`uiComponents/UnlockPanel/*.qml`)

| property | value | source |
|---|---|---|
| panel | width 320 + 2·edge, `popup-bg.png`, margin 6 | `UnlockPanel.qml:8,46-53` |
| title | "Device Locked", Prelude 18 bold `#FFF` | `UnlockPanel.qml:57-66` |
| field | `pin/password-lock-field.png` (310x50). Entry text 18 bold, letter spacing 2 (white for PIN, black for password). Hint "Enter PIN"/"Enter Password" 17 px `#9C9C9C` | `PasswordField.qml:11-81` |
| PIN pad | 320 wide, grid `pin/pin-grid.png` (320x230), **3x4**: 1-9, blank, 0, ⌫ (`pin/icon-delete.png`) | `PINPad.qml:6-38` |
| PIN key | Prelude **30 px bold** white, press highlight `pin/pin-key-highlight.png` (106x55) | `PINButton.qml:11-32` |
| buttons | 2 columns x 52 px (`ActionButton`: `pin/button-green/red/black(-press).png` 52x52 9-slice, 16 px text) | `UnlockPanel.qml:111-130`; `ActionButton.qml:11-32` |
| fade | 300 ms | `UnlockPanel.qml:160` |

---

## 7. Gesture area / CoreNavi and the home button

The gesture-area recognizer lives in the input driver (hidd/QPA), not in this repo. It delivers **synthetic keys**, and
LunaSysMgr only handles them. The mapping of physical gestures to keys is **(inferred)** from Palm HI docs.

| key | physical gesture (inferred) | behaviour (key **release**) | source |
|---|---|---|---|
| `Key_CoreNavi_Back` | swipe right→left in the gesture area | close dashboard → hide menu → hide launcher. Otherwise passed to the app as Back | `Src/base/SystemUiController.cpp:424-443` |
| `Key_CoreNavi_Menu` | (advanced) | closes dashboard/menu, then goes to the app | `SystemUiController.cpp:410-422` |
| `Key_CoreNavi_Launcher` / `Qt::Key_Super_L` | swipe **up** from the gesture area | dock mode → exit. Locked → ignore. Emergency → notify. Close dashboard/menu/Just Type. In `sysUiNoHomeButtonMode` (default **true**): launcher shown → hide it. Card maximized → show dock + **minimize to card view**. Otherwise → toggle launcher | `SystemUiController.cpp:445-497`; `Src/base/settings/Preferences.cpp:65` |
| `Key_CoreNavi_QuickLaunch` | swipe-up-and-hold ("wave") | closes dashboard/menu. The overlay grabs the mouse so the dock follows the finger | `SystemUiController.cpp:377-392`; `Src/lunaui/launcher/OverlayWindowManager.cpp:1005-1011` |
| `Key_CoreNavi_SwipeDown` | swipe down | in NoHomeButton mode: card view → hide dock and **maximize** the active card | `SystemUiController.cpp:499-526` |
| `Key_CoreNavi_Previous` / `Next` | full-width sideways swipe | switch maximized card. **Off by default** (`sysUiEnableNextPrevGestures=false`): remapped to Back / Menu | `SystemUiController.cpp:308-315,394-408`; `Preferences.cpp:66` |
| `Key_CoreNavi_Home` | center button (Pre "castle"), **TouchPad home button** | see 7.1 | `SystemUiController.cpp:528-584` |
| `Key_CoreNavi_Meta` | hold in the gesture area (meta key) | modifier. Doesn't close the dashboard | `SystemUiController.cpp:349-351`; `Src/base/MetaKeyManager.cpp` |
| `Qt::Key_Escape` (BT keyboard) | — | toggles the dashboard | `SystemUiController.cpp:586-605` |
| key-downs | all CoreNavi key-downs are swallowed. Back/Menu down is swallowed if the dashboard, menu or launcher is up | `SystemUiController.cpp:320-336` |

**Screen-edge flick (TouchPad bezel swipe-up)**: `handleScreenEdgeFlickGesture` accepts only the edge that's at the bottom for
the current orientation. With the keyboard up it needs ≥ **60 px** of Y travel. Order of handling: dock mode → exit, locked →
ignore, close dashboard/menu, hide Just Type, launcher shown → hide, card maximized → show dock + minimize, else toggle launcher
(`SystemUiController.cpp:72,2041-2121`).

### 7.1 Home button (TouchPad / Pre center button) (`SystemUiController.cpp:528-584`)

Evaluated in order:
1. dock mode → exit dock mode. 2. locked → pass through. 3. emergency mode → emergency handler. 4. dashboard open → close.
5. alert visible → close. 6. menu → hide. 7. launcher shown → hide. 8. Just Type shown → hide.
9. card maximized (or about to maximize) and **not a double-press** (`isAutoRepeat` on release marks a double-tap) → show dock + minimize.
10. otherwise → **toggle launcher** (a double-press from a maximized app therefore goes straight to the launcher).

Chords (`Src/base/WindowServer.cpp:629-683`; `Src/lunaui/WindowServerLuna.cpp:1269-1276`): **Home + Power within 3 s → screenshot**
(to `/media/internal/screencaptures`, `Settings.cpp:100`). **Power + VolUp + Home held → Full Erase countdown**
(`FullEraseConfirmationWindow`: title 26 px, body 16, countdown 20, `warning-system.png`, `FullEraseConfirmationWindow.cpp:32-57`).

### 7.2 Light bar (Pre 2 / Pre 3 / Veer, when there's no physical center button)

Enabled when `EnableLightBar` and the device has no CoreNavi button (`Src/base/CoreNaviManager.cpp:74-77`. Castle has a button,
`Src/base/settings/DeviceInfo.cpp:219-226`). Brightness scaler 60, throbber 100/50 (`conf/luna.conf:55-61`). Veer minimum
brightness 5 (`CoreNaviManager.cpp:36-41`).

| gesture | LED animation (ms) | source |
|---|---|---|
| Launcher / QuickLaunch | waterdrop center→sides: in 300, out 500, sides in 400, out 500 (light-bar variant 200/400/300/400, then restore after 1300) | `CoreNaviManager.cpp:213-217,260-265` |
| Back | left LED fade 200/300/200/600 (light-bar: swipe-left after 100) | `CoreNaviManager.cpp:218-222,273-276` |
| Menu | right LED fade (mirror) | `CoreNaviManager.cpp:223-227,277-280` |
| SwipeDown | reverse waterdrop | `CoreNaviManager.cpp:229-233,267-272` |
| Prev / Next | full fade across all three, 100/500/100/400/300 | `CoreNaviManager.cpp:234-245` |
| meta glow | center ramp to brightness in 200 ms, off in 600 ms | `CoreNaviManager.cpp:103-115` |
| light bar while maximized | stays on while a card is maximized and the screen is unlocked, otherwise off (200 ms ramp) | `CoreNaviManager.cpp:176-203,289-301` |

`GestureAnimationSpeedInMs` 1000 → `m_animationSpeed` 200 (`CoreNaviManager.cpp:79`). The software "virtual CoreNavi" (64 px, tuna)
is config-only (`conf/luna-tuna.conf:53-55`).

---

## 8. Virtual keyboard (high level)

* The keyboard is a **Qt plugin loaded at runtime** (`Src/ime/IMEManager.cpp:42-60`). Its layouts aren't in this repo.
  LunaSysMgr supplies prefs (layout/language, QWERTY/AZERTY/QWERTZ defaults by locale, `Src/ime/VirtualKeyboardPreferences.cpp:280-296`)
  and the input window manager. The show/hide fade uses `brickDuration` **300 ms Linear** (`Src/ime/InputWindowManager.cpp:81-84`).
* Enabled per device: off on base/castle/pixie/broadway/mantaray/desktop, on for windsornot/topaz/opal/tuna (see 0.1).
  When enabled, notifications move to the top (see 4.1).
* Art in `images/keyboard-phone/` vs `images/keyboard-tablet/` (same file set, the tablet adds `key-gray-short.png`):

| asset | phone | tablet |
|---|---|---|
| key-white / key-gray / key-black | 48x96 | 93x140 |
| keyboard-bg (v-tile) | 3x200 → keyboard height about 200 px **(inferred)** | 3x340 → about 340 px **(inferred)** |
| popup-key / popup-bg | 80x120 / 100x90 | same |
| drag-handle | 30x30 | same |

* Hardware keyboard types are detected from `KEYoBRD`: z=QWERTY, w=AZERTY, y=QWERTZ, w1=AZERTY_FR, y1=QWERTZ_DE
  (`Src/base/settings/DeviceInfo.cpp:256-275`). `Key_Keyboard` toggles the IME (`SystemUiController.cpp:620-624`).

---

## 9. Dock mode ("Exhibition")

| property | value | source |
|---|---|---|
| trigger | on an inductive charger (Touchstone) with `DockConnected`. Puck serial tracked | `Src/base/DisplayManager.cpp:544-547,1000-1022,1098` |
| max apps | 3 (chile 6). Default exhibition app `com.palm.app.photos`. Built-in **Time** app `com.palm.app.dockmodetime` | `Settings.cpp:183`; `conf/default-exhibition-apps.json`; `Src/lunaui/dock/DockModeClock.cpp:67,123` |
| status bar | TypeDockMode, clock padding 5, title group opens the dock app menu | `StatusBar.cpp:80-83,282-290` |
| app menu | width 320. Rows **70 px**, 5.5 visible. Icon 48, padding 10. Fonts 18 / 21 px. Highlight `menu-selection-gradient-default.png`, divider `menu-divider.png` | `DockModeAppMenuContainer.cpp:54-58,95,182,209-221`; `DockModeMenuManager.cpp:60` |
| layout | top offset portrait 30 / landscape 10, row spacing 45, maximized window spacing 50 | `DockModeWindowManager.cpp:77-86` |
| app tiles | rounded radius 25. Masks `dock-mode-card-mask-portrait/landscape.png` (not shipped). Label 14 px | `DockModeLaunchPoint.cpp:51,92-104` |
| loading | `dockmode/dock-loading-glow.png` (320x480) pulse. 60 s load timeout | `DockModeWindow.cpp:50,73,100-116` |
| animations | screen fade 900, dock fade 500, dock start delay 270, curve 3 InOutQuad, rotation 600, card slide 300 curve 7 InOutCubic, menu scroll 150 curve 10 | `AnimationSettings.cpp:125-131`; `DockModeWindowManager.cpp:190-195` |
| night brightness | 1 | `Settings.cpp:184` |
| Time app (QML) | 1024x768 canvas, `clock_bg.png`. Three pages swipe horizontally (snap one item): **analog glass**, **digital flip**, **analog matte**. Page dots `indicator/on|off.png`, spacing 10, at +340 (landscape) / +400 (portrait) from center | `uiComponents/DockModeTime/Clocks.qml:3-40` |
| analog clocks | face `analog/<glass\|matte>/base.png` (508 / 488 px) centred; hands the face's size (glass) or 30x488 (matte), turned about their centre, clockwise; hour `h·30 + m·0.5`°, minute `m·6`°; second hand matte only, OutBack 300 ms. Glass: the locale's long date 300 px under the centre. Matte: short weekday (`QLocale::dayName ShortFormat`) and day of month 108 px left / right of the centre. Prelude point size 30, `#e1e1e1`. Read every 100 ms while in front (`mainTimerRunning`) | `AnalogClock.qml`; `WindowServer.cpp:306-326` |
| flip clock | `digital/<portrait\|landscape>/flippers-time.png` x4 (178x249 / 150x209), gaps 4, 22, dots, 22, 4, row 48 px above the centre; hours with a leading zero, 12 h unless HH24, AM/PM (point size 20 / 15) in the first flipper's corner (-42,-95 / -38,-80). Date row of 11 `flippers-date.png` (70x104 / 60x88), spacing 2, 136 px under the centre: month (`ShortFormat`, upper case), blank, day, blank, year. Digits point size 158 / 132 (date 52 / 44), 4 px above each flipper's centre; `-mask.png` over them | `DigitalClock.qml` |
| when (display states) | screen off on the puck: dock mode at once (locked) or OnPuck (unlocked / on a call). Screen on: OnPuck, lock state unlocked (the lock screen tries to unlock), no dimming; dock mode after dim + off timeouts (`DisplayOnPuck::timeout`), on Power, or on a lock request. Dock mode: no timeout; Power -> off (still docked on the puck); Home / undock -> OnPuck or On (lock state unlocked); off the puck -> On; a call -> OnPuck | `DisplayStates.cpp:307-370, 953-1070, 1545-1890` |
| lock state | `StateDockMode`: no padlock, background or alerts, PIN panel hidden; the lock window itself hidden in dock mode (`reorderWindowManagersForDockMode`) | `LockWindow.cpp:1138-1158`; `WindowServerLuna.cpp:569-615` |
| exit | Home, launcher gesture, Back rejected by the window, screen-edge flick, a card added or maximized, brick mode | `SystemUiController.cpp:450-453, 529-532, 694-720, 944-951, 2082-2085` |
| exhibition apps | appinfo `exhibitionMode` (or `dockMode`) true; menu title `exhibitionModeOptions.title` (or `dockModeOptions`), else `appmenu`. Launched with `{"windowType": "dockModeWindow", "dockMode": true}` by `com.palm.launcher`. Enabled list and per-puck app (`knownPucks`) in `/var/palm/user-exhibition-apps.json`; non-default windows closed on exit (`DockModeCloseAppsOnExit` true) | `ApplicationDescription.cpp:369-398`; `DockModeWindowManager.cpp:509-603`; `DockModePositionManager.cpp` |
| services | `com.palm.systemmanager/getDockModeStatus {subscribe}` -> `{enabled}`; `com.palm.applicationManager/listDockModeLaunchPoints`, `addDockModeLaunchPoint {appId}`, `removeDockModeLaunchPoint {appId}`; deviceInfo `dockModeEnabled` | `SystemService.cpp:1913-1990`; `ApplicationManagerService.cpp:2486-2985`; `DeviceInfo.cpp:315` |
| preferences | `dockModeSoundPref` "systemsettings"; `dockwallpaper {wallpaperFile}` | `conf/defaultPreferences.txt:32`; `Preferences.cpp:560-568` |

---

## 10. Other system surfaces

| surface | key facts | source |
|---|---|---|
| Boot animation | `hp-logo.png` / `hp-logo-bright.png` (200x200) with activity spinner (`activity-spinner.png` 10 frames) and progress (`activity-progress.png` 20 frames). Frames 80 ms slow / 33 ms fast. Update text 20/16 px "Updating the system" / "Do not remove battery". Rotated by HomeButtonOrientationAngle | `Src/base/BootupAnimation.cpp:50-58,126-146,167,587` |
| USB mass-storage / fsck (MSM) | `normal-bg.png`/`glow-bg.png` (768x768) + `normal-usb.png`/`fsck-usb.png`. Pulse 2000 ms curve 1, finish 700 ms. Text 18 px | `Src/base/ProgressAnimation.cpp:36,55-105`; `conf/lunaAnimations.conf:95-101` |
| Touch reticle | `penindicator-ripple.png` (66x67), 200 ms Linear opacity+scale on every tap (`ShowReticle=true`) | `Src/base/visual/ReticleItem.cpp:39-78`; `conf/luna.conf:40` |
| Touch-to-Share glow | 1000 ms opacity+scale, oriented by HomeButtonOrientationAngle | `Src/base/visual/TouchToShareGlow.cpp:43,109-118` |
| Emergency mode WM | full-screen window with a 350 ms fade and rounded corners | `Src/lunaui/emergency/EmergencyWindowManager.cpp:44-50,216-237` |
| Low-memory alert / MSM-failed | QML dialogs 320x160, title 18, body 14, 52 px buttons | `uiComponents/MemoryAlert/alert.qml:15-54` |
| Modal cards | 320x480 centered in positive space, parent dimmed 60% | `Settings.cpp:239-240`; `CardWindow.cpp:1861-2120` |

---

## 11. Phone vs tablet: summary of differences

| area | phone (`TabletUi=false`, 2.x-style) | tablet (`TabletUi=true`, 3.x) | source |
|---|---|---|---|
| status bar bg | solid black, always | translucent tile + color fill that fades in when an app is maximized | `StatusBar.cpp:765-778` |
| status bar layout | carrier/title left, **clock centered**, battery and icons right | title left, notifications + icons + battery + **clock right**, drop-down arrows | `StatusBar.cpp:383-437` |
| screen corners | 24 px rounded corner overlays | none | `MenuWindowManager.cpp:126-146` |
| notifications | bottom 28 px bar + upward dashboard (if VK off) | status-bar drop-down, 320 px | §4.1 |
| system menu | same QML drop-down, from the system group | same | §3 |
| card ratio / rot | 0.659 / 0.61, rot 30 (base). windsornot 0.50/0.45 rot 90 | 0.55 / 0.50, rot 90, x-distance 0.35, gap 30 | §0.1 |
| home | gesture area (up-swipe) + light bar. Castle center button | physical Home button + bezel edge-flick | §7 |
| keyboard | hardware slider (VK off) | VK plugin (tablet art) | §8 |
| splash | splash backgrounds on, icon 128 | backgrounds off, icon 192 | `Settings.cpp:216-217`; `conf/luna-topaz.conf:40-41` |
| assets | many `images/*.png` are 320 wide (e.g. `scrim.png` 320x480, `search-pill.png` 320x48, `screen-lock-target-scrim.png` 320x190), which fits the phone width | launcher3 art at 128 px cells, tab bar 50 | asset-inventory.md |

---

## 12. Open questions / gaps for Phoenix

1. The **2.x phone card view** (single row of cards, no stacks, Pre-era "card view" wallpaper) isn't separately implemented here.
   Stacks (`CardGroup`) arrived in webOS 2.0 and the same code serves phones. Values for Pre-era 1.x-style card view would have to come
   from `luna-systemui` or from video reference **(inferred)**.
2. The gesture-area recognizer (distances and timings for back, up-swipe and wave) isn't in this repo. It lives in `hidd` / the QPA plugin.
3. The Prelude font and the default wallpaper (`bluerocks.png`, `conf/defaultPreferences.txt`) aren't in this repo.
4. `luna-applauncher` (`launcher_scrim.png`, `Settings.cpp:166`) and the `com.palm.launcher` Just Type web app are separate repos.
