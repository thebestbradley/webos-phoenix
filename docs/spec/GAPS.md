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
| C1 | New card starts off-screen below at scale 1 while other stacks slide aside, then rises into place on `cardMaximize` 300 ms OutQuart; a touch while preparing/loading cancels to card view (`CardWindowManager.cpp:580-594,1224-1237`; `CardWindowManagerStates.cpp:626-670`) | Grows out of its card-view slot, 400 ms (an unread conf key); no rise, no cancel | P1 · M |
| C2 | Loading card after 750 ms: splash or `loading-bg.png` / gradient, 128 px icon (192 tablet) on `loading-glow.png`, pulse from 900 ms (1000 ms InQuad on, 1000 ms pause), 300 ms fade (`CardLoading.cpp`; `lunaAnimations.conf:51-60`) | None; blank card while loading | P1 · M |
| C3 | Angry card: 1:1 vertical drag both ways; released with centre below the bottom → force close, thrown off the top; `carddrag` / `birdappclose` sounds when upside down (`:1522-1533,1709-1711,2846-2891`) | **Done** (872f8b3), without the sounds | P1 · S |
| C4 | Drag-to-close when the card centre leaves the top (~235 px on a Pre); no fade; the stack reflows in parallel with the 300 ms OutCubic fly-off; `appclose` sound (`:994-1022,1589-1590,2862-2893`) | Closes at half the scaled height (~130 px), fades, reflows after the fly-off (~650 ms total), no sound; app-closed cards have no fly-off | P1 · S |
| C5 | Flick = average velocity 2.5–11 px/ms (`FlickGestureRecognizer.cpp:44-46,100-113`); fan momentum `pos += -vx/1000` (`CardGroup.cpp:617-626`); 3 fan positions per unscaled card width (`:594-602`) | Last-segment velocity > 0.5; no fan momentum; fan ~1.7× too fast | P2 · S |
| C6 | First touch only, vertical drag only on the active stack, within the card's column (`:1443-1458,1500-1516`) | Any card, up to 5 fingers (a Phoenix addition, kept by request) | P2 · S |
| C7 | Stacks of >4: tap far from the fan scrolls instead of maximizing; tap in the column on no card does nothing (`CardGroup.cpp:401-470`) | Always maximizes | P2 · S |
| C8 | New window joins the focused stack when its `launchingAppId` is the focused app (browser from Email stacks on Email) (`:561-567`) | Only same-app windows stack | P1 · S |
| C9 | Corners: elliptical factors (0.491 h, 0.478/0.473 v), smoothstep feather (`CardRoundedCornerShaderStage.h:64-127`) | 40 px circular mask that snaps square at the end of maximize | P2 · S |
| C10 | Stack collapse driven by x offset (`CardGroup.cpp:727-736`) | Lerp on distance from position | P2 · S |
| C11 | Scene transitions, modal cards, first-use tutorial, card limit / low-memory alert, Touch-to-Share ghost | None | P2 · S–M |

## 2. Launcher

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| L1 | Full screen, slides from the bottom, 350 ms InOutQuint, no fade; launcher z 0 < Just Type 10 < dock 20 < feedback 40; dock background cross-fades to `quicklaunch-bg-solid.png`; cards hidden once up (`OverlayWindowManager.cpp:101-104,275-297,1451-1477,1674`) | **Done** (79b37b3): slide and z-order. Not yet: solid dock background, hiding cards | P1 · S |
| L2 | Opaque tiled `launcher-bg.png`; `launcher-scrollfade-top.png` under the tabs (`dimensionslauncher.cpp:98,1290,1592`) | `#4F545A` 90% + tile 35% (that colour is the status bar's while the launcher shows) | P1 · S |
| L3 | Cell 128×128, icon 64 at (0,−11), label box 100×40, Prelude 14 bold; tablet 7 per row, margins 27/20 (`launcher3/*.conf`) | 3 / 5 columns, 112 px cells, 13/16 px labels not bold | P1 · S |
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
| Q3 | The "wave": swipe up and hold, the dock follows the finger (`:1000-1011`; `SystemUiController.cpp:377-392`) | None | P1 · M |
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
| S1 | Painted right to left from the battery: RSSI, WAN, BT, Wi-Fi, TTY, HAC, call forward, roaming, VPN, rotation lock, mute, airplane; spacing 5 (`StatusBarInfo.cpp:143-275`) | Airplane, RSSI, BT, Wi-Fi, battery; spacing 4 | P1 · S |
| S2 | WAN type and dormancy, dual RSSI, roaming, VPN, BT connecting/connected, Wi-Fi connecting, TTY, HAC, call forward, rotation lock, mute, battery error (`StatusBarInfo.cpp:183-326`) | RSSI, BT on, Wi-Fi, battery only | P1 · M |
| S3 | Battery image = first threshold ≥ level in {12,20,28,36,44,52,60,68,76,84,88,99,100}; `battery_full.mp3` (`StatusBarBattery.cpp:35,200-218`) | `round(pct/100*11)` | P2 · S |
| S4 | 12/24 h per locale, no leading zero in 12 h; lock screen bar shows the short date (`StatusBarClock.cpp:195-232`) | 12 h, always the time | P1 · S |
| S5 | Title Prelude 14 bold always, 90% spacing, caps 13/20, `menu-arrow.png` slides in 500 ms InOutQuad, 300 ms title cross-fade | Bold only for apps, no arrow, no cross-fade | P2 · S |
| S6 | App-tinted status bar, 300 ms lerp (tablet) | None | P2 · S |
| S7 | Tablet: clock at the right of the system group; fill fades in when an app maximizes (`StatusBar.cpp:98-104,240-262`) | Clock centred, fill always solid | P1 · S |
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
| N1 | Phone banner rises from the bottom of the 28 px bar (VerticalScroll, 1000 ms OutCubic), drops back fading to 0.25 (`BannerWindow.cpp:47`; `BannerMessageHandler.cpp:122-130,321-343`); tablet reveals from the right | Slides in from the right | P1 · S |
| N2 | Tapping a banner launches its app; `notification.wav` / `alert.wav` capped at 5 s, or vibrate (`BannerWindow.cpp:122-129`; `BannerMessageHandler.cpp:691-772`) | Tap opens the dashboard; no sound | P1 · S |
| N3 | Popup alert windows, queued by `notificationPolicy.conf` priority; phone: full width taking negative space; tablet: 320 wide top right, 400 ms fade, `popup-bg.png`. Incoming call, alarm "ring", reminders, system alerts | In progress (runtime tags popup windows) | P0 · L |
| N4 | luna-systemui battery / charging banners and alerts, network denied, etc. | In progress: runs in headless tests, not yet booted by the shell | P1 · M |
| N5 | Dismiss by ¼-width drag or a flick, 200 ms delete animation; persistent dashboards | ¼ drag, instant remove; no persistent flag | P2 · S |
| N6 | Dashboards are app mini-windows, 52 px, 5.5 visible then scroll; bar icons right-aligned up to 28 px, no gaps | Synthesised rows; 22 px icons with gaps | P2 · M |
| N7 | Active-call banner, volume HUD, transient alerts | None | P2 · M |
| N8 | Dashboard layer below the status bar and menus (`WindowServerLuna.cpp:161-171`) | Declared above the status bar | P2 · S |

Phone negative space (the app shrinks instead of being covered) and the
tablet drop-down: **done** (7090c64).

## 8. Lock screen

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| K1 | PIN / password panel ("Device Locked", 3×4 pad, `pin/*` art, 200 ms fade, last-try and new-PIN states); locks on display off / timeout | None; a PIN set in Settings is never asked for; the device build starts unlocked | P0 · M |
| K2 | Incoming call on the lock screen: `screen-lock-incoming-call-*`, "Drag up to answer" | None | P0 · M |
| K3 | Dashboards, banners and popups shown on the lock screen (`LockWindow.cpp:2595-2860`) | Hidden while locked | P1 · M |
| K4 | Padlock follows the finger in 2D; unlock at distance > 146 px and above rest; help hides past the radius; snaps home instantly | Y only; 200 ms return | P2 · S |
| K5 | Lock window above the status bar and menus, with its own bar (date in the centre, no system menu) | System menu can open over the lock screen; bar shows the time | P1 · S |
| K6 | 150 ms InQuad fade; masks at native size | 300 ms linear; masks stretched | P2 · S |
| K7 | EAS policies, Full Erase | None | P2 · M |

## 9. Gestures

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| G1 | Tablet bezel swipe up from the bottom edge (≥60 px with the keyboard up) (`SystemUiController.cpp:2041-2121`) | Tablet has no gesture area: no way out of a maximized app except a key | P0 · S |
| G2 | Back goes to the app unless an overlay is up | Device adapter only logs a warning | P0 · M |
| G3 | Swipe down in card view maximizes the active card (`:499-526`) | None | P1 · S |
| G4 | Forward / Menu swipe | Emitted, not connected | P2 · S |
| G5 | Advanced gestures (switch apps while maximized) | None | P2 · M |
| G6 | Back order: dashboard → menu → launcher | Menu before dashboard | P2 · S |
| G7 | Home: close alert, hide Just Type, double press → launcher; Home + Power screenshot | Home = up gesture | P2 · S |
| G8 | Light bar animations, meta key, tap reticle | Generic glow | P2 · S |

## 10. Rotation, full screen, emergency, dock mode

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| R1 | UI rotates, 300 ms InOutCubic, rotation lock, per-app orientation | None. **Bug:** a phone turned landscape switches to the tablet UI (`formFactor: "auto"`) | P1 · M |
| R2 | Full-screen apps get the whole screen; bar and notifications hidden | Always inset | P1 · M |
| R3 | 24 px phone corners always at the positive-space corners, in card view too | Only while maximized | P2 · S |
| R4 | Emergency mode window | None | P2 · M |
| R5 | Dock / Exhibition mode | None | P2 · L |

## 11–13. Keyboard, sounds, fonts

| # | Original | Phoenix | P · effort |
|---|---|---|---|
| V1 | Phone and tablet virtual keyboards (art shipped), 300 ms show/hide, key sounds, apps resized into positive space | None in the simulator; stock OSE keyboard on a device | P1 · L |
| A1 | `appclose`, notification / alert, battery, charging, shutter, keyboard sounds | None | P1 · M |
| A2 | Vibrate named effect for "vibrate" banners | None | P2 · S |
| F1 | Prelude everywhere | `Theme.fontFallbacks` unused; no bundled Prelude substitute | P1 · S |
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
