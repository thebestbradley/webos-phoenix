# Animations: the original's and Phoenix's

Every animation of the original system UI and of the Enyo widgets the apps
use, against Phoenix's. Sources: luna-sysmgr (LunaSysMgr 3.0.5, `lsm:`
below; `conf/lunaAnimations.conf` and `Src/base/settings/AnimationSettings.cpp`
give the times and curves, a curve number being a `QEasingCurve::Type`),
`third_party/luna-systemui`, `third_party/luna-applauncher`,
`third_party/enyo-1.0` (`enyo:` below, under `framework/source`) and the
`keyboard-efigs` plugin. Phoenix's side is in `shell/qml/Phoenix/Shell`
(`Theme.qml` holds the times) and `apps/shared/phoenix-ui/src`.

Verdicts: **matches**; **implemented** (Phoenix had it missing or different;
done, see the last column); **original framework** (the original Enyo / Mojo
code runs as it was, through the compat overlay, so the animation is the
original's by construction); **n/a** (no such feature in Phoenix, or the
original never ran it); **differs** (left as it is, with the reason).

Reduce motion (Settings > Accessibility) and Animation speed "Fast"
(Settings > Advanced) now reach every shell animation below through
`Theme.motion()` (before: only cards, the launcher and the lock screen), and
the phoenix-ui ones through `data-phoenix-motion` (set by the web runtime,
read by `motion.ts` and the stylesheet's `--pui-motion`). Indicators that
only say something is going on (spinners, the loading card's pulse) keep
their pace.

Tests: `shell/tests/tst_animations.qml`, `shell/tests/tst_tabletanimations.qml`,
`apps/shared/phoenix-ui/src/motion.test.tsx` (each asserts the configured
durations and curves, never wall-clock time).

## Status bar and its menus

| Animation | Original | Phoenix | Verdict |
|---|---|---|---|
| Bar fill fading in/out (tablet: an app, the launcher or Just Type up) | 300 ms linear (`lsm: StatusBar.cpp:249-250`; conf `:112-113`) | `StatusBar.qml` fill, `Theme.statusBarFadeDuration` | matches |
| Bar fill colour change | 300 ms linear (`StatusBar.cpp:257-258`; conf `:114-115`) | `StatusBar.qml` ColorAnimation | matches |
| Title cross-fade (app name / carrier) | 300 ms linear (`StatusBarTitle.cpp:210-211`; conf `:116-117`) | `StatusBar.qml` titleFade | matches |
| App menu arrow beside the title (tablet) | 500 ms InOutQuad (`StatusBarItemGroup.cpp:137-158`; conf `:120-121`) | `StatusBar.qml` `_arrowProgress` | matches |
| System group arrow and separator (tablet), at start | 500 ms InOutQuad (`StatusBarItemGroup.cpp:136-158`, actionable from `StatusBar.cpp:138`; conf `:120-121`) | `StatusBar.qml` `_systemArrowFade` | matches |
| Status icon sliding in/out (Wi-Fi, Bluetooth, mute...) | 1000 ms, width InOutQuad in the first half, fade linear (`StatusBarIcon.cpp:84-205`; conf `:122-123`) | `StatusBar.qml` Indicator | matches |
| Menu tab behind a group while its menu is open (system menu, app menu, dashboard) | 200 ms linear (`StatusBarItemGroup.cpp:252-306`; conf `:124-125`) | `StatusBar.qml` systemMenuTab, `Notifications.qml` notificationTab | matches |
| **App menu** (status bar title) open/close | drawn by the app: `enyo.AppMenu` has no animation (its transition is commented out, `enyo: palm/themes/Onyx/css/AppMenu.css:11-24`) | phoenix-ui `AppMenu` appears at once | matches |
| App menu's Edit item opening its items | `enyo.MenuItem` puts them in a `BasicDrawer`: 250 ms open, 100 ms closed, cubicOut (`enyo: palm/controls/menu/MenuItem.js:53-69`, `base/containers/BasicDrawer.js:82-103`) | was instant | **implemented**: `appmenu.tsx` in a lazy `Drawer` |
| **System menu** open/close | the menu's opacity follows the tab's fade: 200 ms linear (`StatusBarItemGroup.cpp:252-306`) | `SystemMenu.qml` opacity, `Theme.systemMenuFadeDuration` | matches |
| System menu sub-menus (Wi-Fi, Bluetooth, VPN, brightness...) expanding/collapsing | 350 ms OutCubic; a list changing size in an open drawer 200 ms linear (`lsm: uiComponents/SystemMenu/Drawer.qml:77, 98-103`) | `SystemMenu.qml` drawer | matches |
| System menu scroll fades | 70 ms (`SystemMenu.qml:309, 332`) | `SystemMenu.qml` | matches |
| System menu scroll to an opened drawer | 200 ms InOutQuad, commented out in the original (`SystemMenu.qml:126-129, 184-231`) | none | matches (n/a) |
| System menu spinner (Wi-Fi/Bluetooth searching) | `AnimatedSpinner`, 60 frames a second (`SystemMenu.cpp:997-1012`) | `SystemMenu.qml`, `Theme.spinnerDuration` | matches |
| Tablet notification group (separator, icons) appearing with the first notification and going after the last | 300 ms; the conf's curve key is misspelt (`statusBarTabFadeeCurve`, conf `:119`) so the curve is 0, linear (`StatusBarItemGroup.cpp:185-232`, `StatusBar.cpp:688-697`) | was instant | **implemented**: `Notifications.qml` `groupOpacity`, `Theme.statusBarTabFadeDuration` |
| Tablet notification icons fading out while a banner shows, back after | 300 ms linear, to 0 (`StatusBarNotificationArea.cpp:31, 368-397`) | was instant | **implemented**: `Notifications.qml` `iconsOpacity`, `Theme.notificationIconsFadeDuration` |
| Device menu (dock mode's app menu) | the status bar group's menu fade, 200 ms linear | `DockModeAppMenu.qml` | matches |

## Notifications, banners, alerts

| Animation | Original | Phoenix | Verdict |
|---|---|---|---|
| Banner sliding in (phones up, tablets from the right) | 1000 ms OutCubic (`BannerMessageHandler.cpp:111-131, 611-672`) | `Notifications.qml` bannerShow | matches |
| Banner sliding out | 1000 ms linear, fading to 0.25 (same) | `Notifications.qml` bannerHide | matches |
| Phone dashboard opening/closing/growing (the negative space) | 400 ms OutCubic (`SystemUiController.cpp:159-160`; conf `:73-74`) | `Notifications.qml`, `Theme.positiveSpaceDuration` | matches |
| Tablet dashboard drop-down open/close | the notification group's menu fade, 200 ms linear | `DashboardMenu.qml` | matches |
| Tablet drop-down changing height | 500 ms OutCubic (`DashboardWindowContainer.cpp:118-122`; conf `:69-70`) | `DashboardMenu.qml` | matches |
| New row dropping into the open drop-down | from above the list (`DashboardWindowContainer.cpp:636-642`) | `DashboardMenu.qml` MenuRow | matches |
| Row swiped away / let go short | 1.5 widths in 200 ms linear / back in 500 ms OutCubic (`:700-708, 853-886`; `AnimationSettings.cpp:116-117`) | `Notifications.qml`, `DashboardMenu.qml` | matches |
| Row its **app** takes away | slides 1.5 widths in 200 ms linear first, then the rows close up (`removeWindow`, `:653-709`, `slotDeleteAnimationFinished`, `:724-741`) | vanished at once | **implemented**: phones `ListView.delayRemove` (`Notifications.qml` leave); tablets a copy of the row slides out (`DashboardMenu.qml` `_rowLeft`). Differs in two details: on tablets the rows below close up meanwhile, and the copy shows the row's icon and text, not the app's own dashboard window (which goes with the notification) |
| Layers of a multi-message dashboard (Email, Messaging) swiped | `left 0.2s ease`, 33 ms steps (`enyo: palm/system/dashboard-window/dashboard.css:61`, `AnimatedSwipeableItem.js`) | the apps' Enyo dashboards | original framework |
| Popup alerts (low battery, charging, power off menu, alarms, calls) | tablets 400 ms linear fade (`DashboardWindowManager.cpp:540-591`); phones the negative space, 400 ms OutCubic | `Notifications.qml` tabletAlert / phone space | matches (the alerts are luna-systemui's, `compat/rootfs`) |
| Volume indicator (transient alert) | 400 ms linear (`DashboardWindowManager::animateTransientAlertWindow`) | `VolumeIndicator.qml` | matches (now through `Theme.alertFadeDuration`) |

## Launcher, dock, Just Type

| Animation | Original | Phoenix | Verdict |
|---|---|---|---|
| Launcher open/close | 350 ms InOutQuint (`OverlayWindowManager.cpp:276-277`; conf `:83-84`) | `Launcher.qml` hidden | matches |
| Dock sliding and fading | 350 ms OutCubic slide, 200 ms OutCubic fade (`:285-292, 1480-1550`) | `Shell.qml` quickLaunch | matches |
| Dock background opacity | animated over 350 ms but never drawn (`dimensionsmain.cpp:372-379` only stores it) | none | n/a |
| Search pill fade | 200 ms OutCubic (`:303-306`) | `SearchPill.qml` | matches |
| **Page change** (a tab's tap, a drag let go) | 250 ms InQuad (`dimensionslauncher.cpp:3326-3329`, snapback `:1990-2010`; `dynamicssettings.cpp:86-87`) | was 300 ms, the ListView's own highlight move and snap | **implemented**: `Launcher.qml` `showPage` / `pageGlide` |
| **Page flick** | to the page beside the one it began on, distance / speed (speed px/ms x 100 / 1000), 200-1200 ms OutCubic (`:3330-3339, 3610-3645`; `FlickGestureRecognizer.cpp:44-46, 95-104`) | was the ListView's flick deceleration | **implemented, snappier by the owner's choice**: `Launcher.qml` `_pagesDragEnded`; the speed as the finger lets go (last 100 ms) from 0.4 px/ms with no upper bound, 150-400 ms |
| Page autoscroll under a dragged icon | 150 px over 300 ms, linear (`page.cpp:1704-1751`) | was OutCubic | **implemented**: `Launcher.qml` pageScroll |
| Icons making room while reordering | 300 ms InQuad (`dynamicssettings.cpp:92-93`) | `Launcher.qml` | matches |
| Remove Application? (app info dialog) | fade in 400 ms, out 600 ms, linear (`dynamicssettings.cpp:106-107`, `dimensionslauncher.cpp:3223-3266`, `AppInfoDialog.qml:55-68`) | was 300 ms both ways | **implemented**: `Shell.qml` deleteDialog, `Theme.appInfoDialogFade*Duration` |
| Launcher pages' overscroll rebound | `KineticScroller`, 350 / 500 ms OutCubic (`KineticScroller.cpp:38, 220-306`) | Qt Flickable's own rebound | differs (scroll physics, not a menu; left for now) |
| Just Type open/close | 150 ms OutCubic (`:311-315`; conf `:87-88`) | `JustType.qml` | matches |
| Just Type's suggestion and contact drawers | `BasicDrawer` (`luna-applauncher app/LaunchAndSearch.js:252-319`, `ContactSearch.js:189`) | the original Just Type app | original framework |
| Launcher fade under Just Type | created, never started (`OverlayWindowManager.cpp:270-273`) | none | n/a |

## Cards

| Animation | Original | Phoenix | Verdict |
|---|---|---|---|
| Maximize / minimize (min/max) | 300 ms OutQuart (`CardGroup.cpp:335-366`, minimize is a slide `CardWindowManager.cpp:2491-2685`; conf `:31-32`; conf's `cardMinimize*` is read by nothing) | `CardView.qml`, `Theme.cardMaximizeDuration` | matches |
| Card throw (close) | 300 ms OutCubic (`CardWindowManager.cpp:687-688, 2872-2873`) | `CardView.qml` flick | matches |
| Slide between cards, reorder, group reorder, dimming | 300 OutQuart / 350 OutCubic / 500 OutCubic / 300 OutCubic (conf `:25-66`) | `CardView.qml`, `Card.qml` | matches |
| Loading card pulse and cross-fade | `CardLoading.cpp:141-142`; conf `:55-60` | `CardLoading.qml` | matches |
| Scene push/pop (an app's own scenes) | 300 ms easeOutQuad (`CardTransition.cpp`; conf `:61-62`) | `Card.qml` | matches |
| Touch to Share ghost and glow | 750 ms OutQuart; 1000 ms linear (`CardWindowManager.cpp:2941-2942`, `TouchToShareGlow.cpp:99-127`) | `CardView.qml`, `TouchToShareGlow.qml` | matches |
| Modal card | 500 ms (`CardWindow.cpp:75, 2210-2211`) | no modal cards (GAPS C11) | n/a |

## Lock screen, keyboard, rotation, system screens

| Animation | Original | Phoenix | Verdict |
|---|---|---|---|
| Lock screen appearing / unlocking | 150 ms InQuad (`LockWindow.cpp:402-403`; conf `:104-105`) | `LockScreen.qml` | matches |
| Lock screen parts (clock, help, banner, dashboard), PIN / password panel, security dialog | 200 ms linear (`LockWindow.cpp:2103-2129, 2282-2283`; conf `:108-109`) | `LockScreen.qml` | matches |
| PIN panel slide | commented out (`LockWindow.cpp:644-645`) | none | matches (n/a) |
| Keyboard show/hide | the negative space, 400 ms OutCubic (`InputWindowManager.cpp:134-160`); its own fade is only for USB mode (`:177-197`) | `Shell.qml` `_slotShowIME` | matches |
| Rotation | 300 ms InOutCubic, rotate and cross-fade (`WindowServer.cpp:1950-1953`; conf `:127-128`) | `UiRotation.qml` | matches (now through `Theme.motion`) |
| USB mode (brick) screen, emergency mode, boot, progress | 300 linear; 350 linear; 700 linear; 2000/700 InQuad (`TopLevelWindowManager.cpp:69-70`, `EmergencyWindowManager.cpp:49`, `BootupAnimation.cpp:48`, `ProgressAnimation.cpp:91-105`) | `SystemScreens.qml`, `EmergencyWindow.qml`, `BootAnimation.qml`, `ProgressAnimation.qml` | matches |
| Dock mode in/out | 900 / 500 ms InOutQuad, 270 ms delay (`WindowServerLuna.cpp:622-641`) | `Shell.qml` | matches |
| Tap reticle, screenshot flash | 200 ms linear; 900 ms (`ReticleItem.cpp:61-70`, `WSOverlayScreenShotAnimation.cpp:79-86`) | `Shell.qml`, `ScreenCaptureFlash.qml` | matches |

## Enyo widgets in the apps (phoenix-ui's equivalents)

The original apps (`third_party/core-apps`, luna-systemui, the Just Type
app) run Enyo 1.0 itself, so theirs are the **original framework**'s. These
rows are phoenix-ui's copies for the React apps.

| Widget | Original | Phoenix | Verdict |
|---|---|---|---|
| Popup menus, ListSelector, PopupSelect, Picker, their (transparent) scrim | no animation (`Menu.css:6-22` commented out; `Popup.js` show/hide; `Scrim.js:180`) | `popups.tsx` PopupMenu | matches |
| Drawer, DividerDrawer | 250 ms open, 100 ms closed, cubicOut (`BasicDrawer.js:82-103`; Animator `dom/Animation.js:90-96`) | was 200 ms ease-out both ways | **implemented**: `popups.tsx` Drawer, `styles.css` |
| Dialog (bottom, Heritage = Mojo look) | a Toaster: up from below over 350 ms cubicOut and back down on close (`Toaster.js:57-95`); scrim fades in over 0.5 s (`Onyx/css/Scrim.css:10-11`), goes at once (`Scrim.js:84-90`) | was a 40 px slide and fade in 200 ms, no close animation | **implemented**: `popups.tsx` Dialog (stays drawn, inert, while it slides away). A dialog its parent unmounts (`{x && <Dialog open/>}`) still goes at once |
| Spinner | `RotatingImage`: the first frame turned once a second, linear (`palm/controls/image/RotatingImage.css`) | stepped through the 12 frames | **implemented**: `styles.css` `.pui-spinner::before` |
| SlidingPane | 700 ms cubicOut (`SlidingPane.js:47`) | `panes.css` | matches (now at the page's speed) |
| ModalDialog (centred, 0.5 s fade) | `ModalDialog.css:1-6` | phoenix-ui has none | n/a |
| Pane view changes | `enyo.transitions.Fade`, 300 ms cubicOut, Pane's default (`base/containers/Pane.js:73`, `Transitions.js:116-170`) | the React apps change views at once; the shell's scene transition is offered (`sceneTransition`, used by Settings) | differs: no shared view container to put it in; owner's call |
| Toaster from other edges | `Toaster.js` | phoenix-ui has none | n/a |
| Mojo (webOS 1.x/2.x phone apps) menus and transitions | not in the open-source release (`foundations.mojo` is only the JS foundations) | - | cannot be checked |

## Counts

64 rows: 43 match (four of them animations the original never ran, so none
in Phoenix either), 11 implemented, 2 run the original framework, 5 n/a
(features Phoenix does not have: modal cards, ModalDialog, side Toasters;
or animations nothing in the original showed), 2 differ and are left
(launcher overscroll physics; the React apps' view changes), 1 cannot be
checked (Mojo).
