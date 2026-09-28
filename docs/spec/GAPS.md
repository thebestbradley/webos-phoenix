# Gaps: Phoenix shell vs luna-sysmgr

An audit of `shell/qml/Phoenix/Shell` against the original system UI,
`openwebos/luna-sysmgr` (cited as `lsm:`), plus `luna-systemui` and
`luna-applauncher`. Audited 2026-09-28 at `ef131d7`. Status notes are
added as items are closed.

Priority: **P0** breaks the webOS feel or basic use, **P1** noticeable,
**P2** polish. Effort: **S** under a day, **M** days, **L** a week or more.
Nearly all the art is already in `shell/assets/openwebos/`.

## 1. Cards

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| C1 | New card starts off-screen below at scale 1 while other stacks slide aside, then rises into place on `cardMaximize` 300 ms OutQuart; a touch while preparing/loading cancels to card view (`CardWindowManager.cpp:580-594,1224-1237`; `CardWindowManagerStates.cpp:626-670`) | **Done**: a new card waits full size below the screen with its stack in place, rises when the app is ready or after 750 ms (`cardAddMaxDuration`), 300 ms OutQuart; a touch before that cancels to card view. Not the 150 ms prepare step: the card waits from the start | P1 · M |
| C2 | Loading card after 750 ms: splash or `loading-bg.png` / gradient, 128 px icon (192 tablet) on `loading-glow.png`, pulse from 900 ms (1000 ms InQuad on, 1000 ms pause), 300 ms fade (`CardLoading.cpp`; `lunaAnimations.conf:51-60`) | **Done** (`CardLoading.qml`): loading-bg, the icon at 1.5× (≤128 / 192 px), the glow pulsing from 900 ms (500 up, 500 down, 1 s rest), a 300 ms cross-fade when the page has loaded. Shown from the start rather than after the 150 ms prepare delay | P1 · M |
| C3 | Angry card: 1:1 vertical drag both ways; released with centre below the bottom → force close, thrown off the top; `carddrag` / `birdappclose` sounds when upside down (`:1522-1533,1709-1711,2846-2891`) | **Done** (872f8b3), without the sounds | P1 · S |
| C4 | Drag-to-close when the card centre leaves the top (~235 px on a Pre); no fade; the stack reflows in parallel with the 300 ms OutCubic fly-off; `appclose` sound (`:994-1022,1589-1590,2862-2893`) | **Done**: closes when let go with the centre above the top (or on a flick), flies off the top without fading over 300 ms OutCubic while the rest slide into place at the same time; app-closed cards fly off too in the simulator. Not yet: the `appclose` sound (A1), the fly-off from a maximized card, and on a device a card whose client destroyed its surface | P1 · S |
| C5 | Flick = average velocity 2.5–11 px/ms (`FlickGestureRecognizer.cpp:44-46,100-113`); fan momentum `pos += -vx/1000` (`CardGroup.cpp:617-626`); 3 fan positions per unscaled card width (`:594-602`) | Last-segment velocity > 0.5; no fan momentum; fan ~1.7× too fast | P2 · S |
| C6 | First touch only, vertical drag only on the active stack, within the card's column (`:1443-1458,1500-1516`) | Any card, up to 5 fingers (a Phoenix addition, kept by request) | P2 · S |
| C7 | Stacks of >4: tap far from the fan scrolls instead of maximizing; tap in the column on no card does nothing (`CardGroup.cpp:401-470`) | Always maximizes | P2 · S |
| C8 | New window joins the focused stack when its `launchingAppId` is the focused app (browser from Email stacks on Email) (`:561-567`) | **Done** in the simulator: an app launched by the card in front (maximized and focused) joins its stack at the front; the device source does not know the launching app yet | P1 · S |
| C9 | Corners: elliptical factors (0.491 h, 0.478/0.473 v), smoothstep feather (`CardRoundedCornerShaderStage.h:64-127`) | 40 px circular mask that snaps square at the end of maximize | P2 · S |
| C10 | Stack collapse driven by x offset (`CardGroup.cpp:727-736`) | Lerp on distance from position | P2 · S |
| C11 | Scene transitions, modal cards, first-use tutorial, card limit / low-memory alert, Touch-to-Share ghost | None | P2 · S–M |

## 2. Launcher

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| L1 | Full screen, slides from the bottom, 350 ms InOutQuint, no fade; launcher z 0 < Just Type 10 < dock 20 < feedback 40; dock background cross-fades to `quicklaunch-bg-solid.png`; cards hidden once up (`OverlayWindowManager.cpp:101-104,275-297,1451-1477,1674`) | **Done** (79b37b3): slide and z-order. Not yet: solid dock background, hiding cards | P1 · S |
| L2 | Opaque tiled `launcher-bg.png`; `launcher-scrollfade-top.png` under the tabs (`dimensionslauncher.cpp:98,1290,1592`) | **Done**: opaque tiled `launcher-bg.png`; no top scroll fade yet | P1 · S |
| L3 | Cell 128×128, icon 64 at (0,−11), label box 100×40, Prelude 14 bold; tablet 7 per row, margins 27/20 (`launcher3/*.conf`) | **Done** for tablets: up to 7 a row (as many as fit), 128 px cells on a 140 px pitch from 27 px in, 138 px rows, the icon 11 px above centre, 14 px bold labels in a 100 px box 2 px below. Phones keep 3 columns and 13 px labels (the webOS 2 phone launcher is not in the release) | P1 · S |
| L4 | Tabs 50 px, 16 px bold both states, `#FFFFFF` / `#C8C8C8`, max 150 wide (`layoutsettings.cpp:67-74`) | 15/18 px, bold only when selected, `#a0a0a0` | P2 · S |
| L5 | Saved order seeded from `conf/default-launcher-page-layout.json` | **Done** (ce78209): saved order; new apps alphabetical | P2 · S |
| L6 | Press-and-hold edit mode, Done button, reorder 300 ms InQuad, page switch on 1000 ms dwell at edges, auto-scroll, delete/remove badges, drag to and from the dock, empty-page hint (`reorderablepage.cpp`; `dynamicssettings.cpp:86-104`) | **Done** (ce78209) except edge-dwell page switching (tabs instead), auto-scroll, app-info dialog, empty-page hint | P1 · L |
| L7 | `launcher-touch-feedback.png` 90×90 behind a tapped icon until launch (`OverlayWindowManager.cpp:2018-2040`) | Icon scales to 0.92 | P2 · S |
| L8 | Install badges and progress | None | P2 · M |

## 3. Quick launch dock

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| Q1 | Launcher button fixed in a 128 px cell at the right; apps spread over the rest; `quicklaunch-bg.png` tiled into a 100 px bar (`quicklaunchbar.cpp:283-345,662-722`) | Equal slots including the button; stretched art; phone height 68 inferred | P2 · S |
| Q2 | Own show/hide: 350 ms OutCubic slide + 200 ms fade; hides on card added, maximize and Just Type (`OverlayWindowManager.cpp:282-292,372-378,1480-1540`) | Slaved to maximize progress; not hidden for Just Type | P2 · S |
| Q3 | The "wave" of webOS 1.x–2.x: swipe up and hold, the dock follows the finger | **Not in the reference.** Open webOS 3.0.5 only keeps the state: `OverlayWindowManager.cpp:1005-1009` sets `m_dockHasMetFinger` and `m_dockWasShownBeforeDrag` and grabs the mouse, but nothing reads them and `m_inDrag` is never set; the wave launcher itself was closed source. Nothing to port; building it would mean designing it from videos, so it waits on a decision | — |
| Q4 | Dragging dock icons (opacity 0.5, raised 15 px) (`quicklaunchbar.cpp:68,1366`) | **Done** (ce78209), proxy at 0.9 opacity, 1.15 scale | P1 · L |

## 4. Search pill and Just Type

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| O1 | Status bar shows the launcher / Just Type title on `#4F545A` (`SystemUiController.cpp:806-838`) | Carrier | P2 · S |
| O2 | Just Type 150 ms OutCubic cross-fade, at overlay z 10 under the (hidden) dock | 150 ms linear fade, full-screen scrim over everything | P2 · S |
| O3 | Search pill: 588 wide, 50 tall, 9 px below the bar, 18 px oblique 80% white, 200 ms fade | **Matches** | — |

## 5. Status bar

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| S1 | Painted right to left from the battery: RSSI, WAN, BT, Wi-Fi, TTY, HAC, call forward, roaming, VPN, rotation lock, mute, airplane; spacing 5 (`StatusBarInfo.cpp:143-275`) | **Done**: the original order and spacing 5 | P1 · S |
| S2 | WAN type and dormancy, dual RSSI, roaming, VPN, BT connecting/connected, Wi-Fi connecting, TTY, HAC, call forward, rotation lock, mute, battery error (`StatusBarInfo.cpp:183-326`) | RSSI (flight-mode bars in airplane mode), BT on, Wi-Fi, battery, and now rotation lock, mute and airplane. Not yet, for want of the state: WAN type, roaming, VPN, BT connecting/connected, Wi-Fi connecting, TTY, HAC, call forward, battery error | P1 · M |
| S3 | Battery image = first threshold ≥ level in {12,20,28,36,44,52,60,68,76,84,88,99,100}; `battery_full.mp3` (`StatusBarBattery.cpp:35,200-218`) | **Done**: the thresholds; the full state uses battery-11, or battery-charged while charging. Not the `battery_full.mp3` sound (A1) | P2 · S |
| S4 | 12/24 h per locale, no leading zero in 12 h; lock screen bar shows the short date (`StatusBarClock.cpp:195-232`) | **Done**: 12 h without a leading zero, or 24 h from the system preference (also the lock-screen clock); the lock screen's bar shows the short date (K5) | P1 · S |
| S5 | Title Prelude 14 bold always, 90% spacing, caps 13/20, `menu-arrow.png` slides in 500 ms InOutQuad, 300 ms title cross-fade | Bold only for apps, no arrow, no cross-fade | P2 · S |
| S6 | App-tinted status bar, 300 ms lerp (tablet) | None | P2 · S |
| S7 | Tablet: clock at the right of the system group; fill fades in when an app maximizes (`StatusBar.cpp:98-104,240-262`) | **Done**: the clock is the rightmost item; the #515558 fill fades in (300 ms) under the tiled art while an app, the launcher or Just Type is up, and out in card view. Not the per-app tint (S6) | P1 · S |
| S8 | Menu tab highlight 3-slice fading 300 ms; icons slide in over 1000 ms | Instant | P2 · S |

## 6. System menu

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| M1 | 300 wide everywhere, max 410 tall, 42 px rows, Prelude 18 `#FFF` / `#AAA`, 13 px caps status, selection gradients, 200 ms fade (`uiComponents/SystemMenu`) | 240 on phone, 44 px rows, 16/14 px, 150 ms, no highlight | P1 · S |
| M2 | Date (long, refreshed every 30 s), "Battery: N%", brightness (floor 10%), Wi-Fi / VPN / Bluetooth drawers with lists and preference rows (350 ms OutCubic), "Turn on/off Airplane Mode", "Turn on/off Rotation Lock", "Mute/Unmute Sound", closes 250 ms after a toggle, "Turning on…" with spinner | No date, VPN or drawers; On/Off labels in an invented blue; stays open; floor 5% | P1 · M |
| M3 | Scroll fades and arrows | None | P2 · S |

## 7. Notifications

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| N1 | Phone banner rises from the bottom of the 28 px bar (VerticalScroll, 1000 ms OutCubic), drops back fading to 0.25 (`BannerWindow.cpp:47`; `BannerMessageHandler.cpp:122-130,321-343`); tablet reveals from the right | **Done**: phones scroll it up from the bottom of the bar, tablets in from the right, 1000 ms OutCubic; it goes back the same way fading to 0.25 | P1 · S |
| N2 | Tapping a banner launches its app; `notification.wav` / `alert.wav` capped at 5 s, or vibrate (`BannerWindow.cpp:122-129`; `BannerMessageHandler.cpp:691-772`) | **Done** for the tap: launches the banner's app with its params (from `addBannerMessage` or the notification), nothing without params; the dashboard opens when no banner shows. Not the sounds (A1) | P1 · S |
| N3 | Popup alert windows, queued by `notificationPolicy.conf` priority; phone: full width taking negative space; tablet: 320 wide top right, 400 ms fade, `popup-bg.png`. Incoming call, alarm "ring", reminders, system alerts | **Done** for popup alert windows and dashboard windows (phone negative space, tablet top right), the priority queue (`NotificationPolicy.js`, the conf's order; Phoenix Phone counts as `com.palm.app.phone`, the Enyo Clock's alarm windows as `ring`) and the Clock's alarm (tools/test-alarm.cjs). Phoenix Phone's incoming call is now a popup alert too (`incoming-known` / `incoming-unknown`; answering brings its card up) | P0 · L |
| N4 | luna-systemui battery / charging banners and alerts, network denied, etc. | **Done**: booted at start; battery banners, Low Battery alert, Charging banner (F6 / F7 in phoenix-sim) | P1 · M |
| N5 | Dismiss by ¼-width drag or a flick, 200 ms delete animation; persistent dashboards | **Done** on phones: past ¼ of the width or a sideways flick (whole-gesture average 2.5–11 px/ms, `FlickGestureRecognizer.cpp:44-45`) slides the row a width and a half right over 200 ms, then dismisses it; otherwise it snaps back over 500 ms OutCubic. Not yet: persistent dashboards — the window attribute that set it was handled in the closed WebAppManager and its name is not in the open sources; the tablet drop-down (with `uiComponents/DashboardMenu`) | P2 · S |
| N6 | Dashboards are app mini-windows, 52 px, 5.5 visible then scroll; bar icons right-aligned up to 28 px, no gaps | Phones **done**: the app's own dashboard window fills its 52 px row (`DashboardItem.qml`); the space is the rows plus 10 px, capped by the positive space; no dividers; `dashboard-mask-top/bottom.png` only while rows are scrolled out of view (`setMaskVisibility`). Notifications without a window still get a synthesised row. Not yet: the tablet drop-down (port `uiComponents/DashboardMenu`: 5.5 rows, dividers above all but the first, swipe backgrounds), bar icons | P2 · M |
| N7 | Active-call banner, volume HUD, transient alerts | None | P2 · M |
| N8 | Dashboard layer below the status bar and menus (`WindowServerLuna.cpp:161-171`) | Declared above the status bar | P2 · S |

Phone negative space (the app shrinks instead of being covered) and the
tablet drop-down: **done** (7090c64).

## 8. Lock screen

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| K1 | PIN / password panel ("Device Locked", 3×4 pad, `pin/*` art, 200 ms fade, last-try and new-PIN states); locks on display off / timeout | **Done** for the panel: luna-sysmgr's UnlockPanel ported (PIN pad, password field, Cancel/Done, "PIN Incorrect" / "Try Again", 200 ms fade), checked by `com.palm.systemmanager matchDevicePasscode`. Not yet: last-try and erase dialogs (no retry policy), new-PIN setup, locking on display off / timeout, and a device lock service on OSE | P0 · M |
| K2 | Incoming call on the lock screen: `screen-lock-incoming-call-*`, "Drag up to answer" | **Done**: the handle becomes the incoming-call icon and the help stays on "Drag up to answer"; the call interrupts PIN entry; unlocking answers (the alert watches `com.palm.systemmanager getLockStatus`, as the phone app did) | P0 · M |
| K3 | Dashboards, banners and popups shown on the lock screen (`LockWindow.cpp:2595-2860`) | **Done.** Popup alerts centred on popup-bg.png, 320 px wide (an incoming call gets the full height, under the handle). The dashboard centred on popup-bg.png, newest first, 52 px rows with dividers, at most 6 with the sixth cut in half under the scroll fade; taps reach a dashboard window only when it opened with `{clickableWhenLocked: true}` and not while the help shows. The banner centred and still (NoScroll) while it plays, in place of the dashboard. Both follow "Show notifications when locked" (`showAlertsWhenLocked`) and fade over 200 ms | — |
| K4 | Padlock follows the finger in 2D; unlock at distance > 146 px and above rest; help hides past the radius; snaps home instantly | **Done**: follows the finger in 2D, unlocks past 146 px and above its rest, help hides past the radius and 1 s after release, snaps home | P2 · S |
| K5 | Lock window above the status bar and menus, with its own bar (date in the centre, no system menu) | **Done**: the bar shows the short date in the centre, and neither the system nor the app menu opens while locked | P1 · S |
| K6 | 150 ms InQuad fade; masks at native size | **Done**: 150 ms InQuad; masks at their own height, the top one under the bar | P2 · S |
| K7 | EAS policies, Full Erase | None | P2 · M |

## 9. Gestures

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| G1 | Tablet bezel swipe up from the bottom edge (≥60 px with the keyboard up) (`SystemUiController.cpp:2041-2121`) | **Done**: a flick up from an 8 px strip along the bottom edge (60 px with `Shell.keyboardOpen`); the device build does not yet tell the shell when the keyboard is up | P0 · S |
| G2 | Back goes to the app unless an overlay is up | **Done**: the device build sends the webOS Back key (evdev 412) to the card's surface through `Phoenix.Native.KeyInjector`; not yet run on hardware | P0 · M |
| G3 | Swipe down in card view maximizes the active card (`SystemUiController.cpp:498-525`) | **Done**: a swipe down in the gesture area, unless the dashboard, a menu, the launcher or Just Type is open | P1 · S |
| G4 | Forward / Menu swipe | Emitted, not connected | P2 · S |
| G5 | Advanced gestures (switch apps while maximized) | None | P2 · M |
| G6 | Back order: dashboard → menu → launcher | Menu before dashboard | P2 · S |
| G7 | Home: close alert, hide Just Type, double press → launcher; Home + Power screenshot | Home = up gesture | P2 · S |
| G8 | Light bar animations, meta key, tap reticle | Generic glow | P2 · S |

## 10. Rotation, full screen, emergency, dock mode

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| R1 | UI rotates, 300 ms InOutCubic, rotation lock, per-app orientation | None. (The landscape-phone bug is fixed: `auto` now picks the tablet layout by canvas size, not orientation.) | P1 · M |
| R2 | Full-screen apps get the whole screen; bar and notifications hidden | **Done** in the simulator: `PalmSystem.enableFullScreenMode` (Enyo `enyo.setFullScreen`) hides the status bar and notification area while the app is maximized and gives it the whole screen; popup alerts still make room. The device source does not pass the request on yet | P1 · M |
| R3 | 24 px phone corners always at the positive-space corners, in card view too | Only while maximized | P2 · S |
| R4 | Emergency mode window | None | P2 · M |
| R5 | Dock / Exhibition mode | None | P2 · L |

## 11–13. Keyboard, sounds, fonts

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| V1 | Phone and tablet virtual keyboards (art shipped), 300 ms show/hide, key sounds, apps resized into positive space | None in the simulator; stock OSE keyboard on a device | P1 · L |
| A1 | `appclose`, notification / alert, battery, charging, shutter, keyboard sounds; ringtones | None. No ringtones ship (`/media/internal/ringtones` is empty, `listRingtones` answers none), so the Clock's default alarm sound, `ringtones/Flurry.mp3`, is missing and alarms are silent | P1 · M |
| A2 | Vibrate named effect for "vibrate" banners | None | P2 · S |
| F1 | Prelude everywhere | **Done**: Prelude when installed, otherwise the bundled Open Sans (Apache-2.0), in the shell and, through the runtime's aliases for every Prelude name, in the original and Phoenix apps | P1 · S |
| F2 | positiveSpace paddings 28 on every device; `cardMaximize` 300; status bar icon spacing 5 | Theme values off (24, 400, 4) | P2 · S |

## Recommended order

1. G1 tablet bezel swipe up
2. G2 Back delivered on a device
3. K1 PIN / password unlock and auto-lock
4. N3 popup alert windows, then incoming call and alarm "ring" (with N4)
5. K5 + K2 lock screen layering, its status bar, "Drag up to answer"
6. L1 + L2 launcher background and solid dock background
7. C1 + C2 launch rise and loading card
8. C4 card close timing, no fade, `appclose`
9. S1 + S2 + S4 status bar order, indicators, 12/24 h
10. N1 + N2 phone banner motion, tap to activate, sound
11. A1 UI sounds
12. F1 font fallbacks and a bundled Prelude substitute
13. G3 + C8 swipe down, `launchingAppId` stacking
14. R1 + R2 rotation (and the landscape phone bug), full screen
15. L3 launcher metrics
