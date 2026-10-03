# Legacy webOS system-UI feature inventory

Checklist of every user-facing system-UI feature that the Open webOS `luna-sysmgr` source shows evidence of
(<https://github.com/openwebos/luna-sysmgr> at commit `1393f0af`; paths below are relative to it). Tick items off as Phoenix implements them. A tick means it works in the simulator; what a device still needs is in
[`GAPS.md`](GAPS.md) and [`../ROADMAP.md`](../ROADMAP.md). Partly done items stay unticked, with a *Phoenix:* note on what is done
and what is missing. Items with nothing to port (dead code, test fixtures) are ticked and marked *N/A*. (Last checked against the code on 3 October 2026.)
The pixel and timing details for each feature are in [`legacy-ui-spec.md`](legacy-ui-spec.md), with section numbers in brackets.

## 1. Card view / multitasking [spec §1]

- [x] Cards for running apps, with maximized and minimized (card view) states. `Src/lunaui/cards/CardWindowManager.cpp:180-246`
- [x] Card **stacks** (groups): cards launched by the focused app stack with it, others open a new stack to the right. `CardWindowManager.cpp:556-599`
- [x] Fanned layout inside the active stack, with tilt and a slight drop; other stacks fold by their distance from the centre, cards 10 px apart when folded (the 7 px closed layout is only for unanimated relayouts). `Src/lunaui/cards/CardGroup.cpp:699-771`
- [x] Horizontal drag and flick through cards and stacks, snapping to the nearest stack. `CardWindowManager.cpp:1452-1600,1677-1738`
- [x] Flick a card up to close it (velocity/distance rule), or drag it off the top. `CardWindowManager.cpp:63-65,1700-1716`
- [x] Close any card on screen, including the stacks at the sides, and several at once with several fingers.
- [x] "Angry card": drag a card off the bottom to force-close it (no keep-alive); it is slung up off the top. Not yet: the upside-down Angry Birds sounds ("carddrag", "birdappclose"), which need sound files we can ship. `CardWindowManager.cpp:1280-1283,2841-2894`
- [x] Tap a card to maximize it; tap a partly hidden card to scroll the fan instead. `CardWindowManager.cpp:2151-2195`; `CardGroup.cpp:402-470`
- [x] Tap left or right of the stack, or tap-and-hold off a card, to switch stacks. `CardWindowManager.cpp:1648-1661,2176-2188`
- [x] Tap-and-hold to reorder cards within a stack and move them between stacks (20% edge zones). `CardWindowManager.cpp:1835-2101`
- [x] Rounded card corners (shader) and drop shadow. `CardWindow.cpp:2485-2533`; `Src/base/visual/CardDropShadowEffect.cpp` *Phoenix: the devices' shader corners (CardCornerMask.qml).*
- [x] Dimming of cards that aren't active (0.8). `CardWindow.cpp:245-255`
- [x] Loading card: splash icon, pulsing glow and splash background while an app launches. `Src/lunaui/cards/CardLoading.cpp` *Phoenix: CardLoading.qml: the app's splashicon fitted to SplashIconSize (else its launcher icon at 1.5×), the pulsing glow, and its appinfo.json splashBackground tiled from the top left (else loading-bg.png). Not the per-window splashbackgroundname a window can name when it opens.*
- [ ] In-app scene push/pop zoom transition. `Src/lunaui/cards/CardTransition.cpp` *Phoenix: not done (GAPS C11).*
- [ ] Modal cards (320x480 child window over a dimmed parent), via `launchModalApp`/`dismissModalApp`. `CardWindow.cpp:1855-2125`; `Src/base/SystemService.cpp:247-248` *Phoenix: not done; no released app calls launchModalApp (the core apps' "modal" dialogs are popups in their own page).*
- [x] Full-screen apps that hide the status bar. `Src/base/SystemUiController.cpp:1389-1400` *Phoenix: in the simulator (enableFullScreenMode).*
- [x] Card rotation and orientation lock per app (fixed-orientation apps). `CardWindow.cpp:2536-`; `Src/lunaui/cards/CardHostWindow.cpp:180-240`
- [x] Keyboard navigation of cards (←/→, Enter, Ctrl+Backspace). `CardWindowManager.cpp:1189-1212`
- [ ] First-use "dismiss card" tutorial dialog. `CardWindowManager.cpp:1168-1187`; `uiComponents/DismissCardTutorial/dismissDialog.qml` *Phoenix: not done (GAPS C11).*
- [x] Card limit and low-memory launch blocking, with a low-memory alert dialog. `conf/luna.conf:63-65`; `Src/base/MemoryMonitor.cpp`; `uiComponents/MemoryAlert/alert.qml` *Phoenix: MemoryMonitor (MemAvailable) refuses a launch when memory is low, except phone, contacts and messaging, and MemoryAlert.qml says "Sorry, Too Many Cards" (phoenix-sim --low-memory). The card limit is off in the original too (CardLimit=-1). The device source does not refuse launches yet.*
- [x] Card-view wallpaper, rotated for landscape. `Src/lunaui/WindowServerLuna.cpp:89-156,900-928`
- [ ] Touch-to-Share "ghost card" throw animation and glow. `CardWindowManager.cpp:2915-2957`; `Src/base/visual/TouchToShareGlow.cpp` *Phoenix: not done; `tap_to_share.mp3` ships unused, and the `touchToShare*` methods answer without doing anything.*

## 2. Status bar [spec §2]

- [x] 28 px status bar: carrier or app title, clock, battery, and signal/connection icons. `Src/lunaui/status-bar/StatusBar.cpp`
- [x] App-tinted status bar (custom color and title while an app is maximized). `StatusBar.cpp:476-520` *Phoenix: the maximized app's title, and on tablets its setWindowProperties statusBarColor, faded to over 300 ms (GAPS S6).*
- [x] Tappable title for the app menu (tablet). `StatusBar.cpp:111-116`
- [x] Battery gauge with 12 levels, charging variants and error state; "battery full" sound. `StatusBarBattery.cpp` *Phoenix: `StatusBar.qml` battery; the error battery while there is no reading (simulator Shift+F6; `tst_shell` test_batteryStates).*
- [x] Clock in 12/24 h, following the locale time-format preference. `StatusBarClock.cpp:198-232`
- [ ] Icons: RSSI (GSM / 1x / EV-DO dual), WAN type, Bluetooth, Wi-Fi bars, TTY, HAC, call forwarding, roaming (triangle variant), VPN, rotation lock, mute, airplane mode. `StatusBarInfo.cpp:183-326` *Phoenix: airplane, mute, rotation lock, VPN, Wi-Fi, Bluetooth and signal done; not yet WAN type, dual RSSI, TTY, HAC, call forwarding, roaming, connecting states.*
- [x] Notification icon strip in the status bar (tablet, up to 10). `StatusBarNotificationArea.cpp`; `StatusBar.h:31-32` *Phoenix: Notifications.qml's tablet icons, at most ten icons' width with the leftmost past it cut off.*
- [x] Phone rounded screen corners. `Src/lunaui/status-bar/MenuWindowManager.cpp:126-146` *Phoenix: at the positive space's corners in every view, hidden while a full-screen card covers the screen.*

## 3. System menu (status-bar drop-down) [spec §3]

- [x] Long-format date (refreshes every 30 s). `uiComponents/SystemMenu/DateElement.qml`; `Src/lunaui/status-bar/SystemMenu.cpp:63`
- [x] Battery percentage. `uiComponents/SystemMenu/BatteryElement.qml`
- [x] Brightness slider (10-100%). `uiComponents/SystemMenu/BrightnessElement.qml`; `SystemMenu.cpp:870-882`
- [x] Wi-Fi drawer: on/off, network list (signal, lock, checkmark, status), "Wi-Fi Preferences". `uiComponents/SystemMenu/WiFiElement.qml`, `WifiEntry.qml`
- [x] VPN drawer: profile list and connect. `uiComponents/SystemMenu/VpnElement.qml`, `VpnEntry.qml`
- [x] Bluetooth drawer: on/off, device list with connect status, "Bluetooth Preferences". `uiComponents/SystemMenu/BluetoothElement.qml`, `BluetoothEntry.qml`; `Src/lunaui/status-bar/BtDeviceClass.cpp`
- [x] Airplane mode toggle (disables radios, shows progress). `uiComponents/SystemMenu/AirplaneModeElement.qml`; `SystemMenu.qml:68-78`
- [x] Rotation lock toggle. `uiComponents/SystemMenu/RotationLockElement.qml`
- [x] Mute toggle. `uiComponents/SystemMenu/MuteElement.qml`
- [x] Scrollable menu with fade and arrow affordances, closing after a selection. `SystemMenu.qml:289-341`
- [x] Device menu (phone-era "DeviceMenu" persistent window of `com.palm.systemui`). `conf/persistentWindows.conf:19-21` *Phoenix: phones open the ported system menu (`SystemMenu.qml`), as Open webOS itself did on every device (`MenuWindowManager.cpp:89` always makes a `SystemMenu`); the 2.x DeviceMenu window is not in the released luna-systemui.*

## 4. Notifications [spec §4]

- [x] Banner notifications: scrolling ticker with icon, queueing (5 s alone, 2 s when queued), sounds. `Src/lunaui/notifications/BannerMessageHandler.cpp` *Phoenix: `Notifications.qml` banner queue: each waits its turn, 5 s alone, 2 s with others waiting (a new one cuts the one showing to 2 s), its sound as it shows; `removeBannerMessage` / `clearBannerMessages`; long text cut off at the end as the original's (`tst_shell` test_bannerQueue). The "ticker" is the slide in: the original never scrolled a banner's text.*
- [x] Phone: bottom notification bar with dashboard icons; tap to open dashboards upward. The bar and dashboard are negative space: the app shrinks and moves up (400 ms OutCubic), never covered. `Src/lunaui/notifications/DashboardWindowManager.cpp`; `SystemUiController.cpp:82,1361-1470`
- [x] Tablet: notification drop-down (320 px) from the status bar. `uiComponents/DashboardMenu/DashboardMenu.qml`; `DashboardWindowManager.cpp:142-170`
- [ ] Dashboards (persistent app mini-windows, 52 px rows) with swipe-to-dismiss, persistent (non-dismissable) variant, and scrolling after 5.5 rows. `Src/lunaui/notifications/DashboardWindowContainer.cpp` *Phoenix: 52 px rows, swipe to dismiss, scrolling after 5.5 rows done; app dashboards persistent only as live activities (no persistent dashboard variant).*
- [x] Popup alerts (incoming call, alarm, calendar reminder, system alerts) filtered by the policy file. `Src/lunaui/notifications/AlertWindow.cpp`; `conf/notificationPolicy.conf`; `NotificationPolicy.cpp` *Phoenix: with the notificationPolicy.conf queue.*
- [x] Transient alerts. `DashboardWindowManager.cpp:183-190` *Phoenix: `VolumeIndicator.qml` on transient-alart-bg.png (GAPS N7). The volume window is the only transient alert in the source (`VolumeControlAlertWindow.cpp:48` is the only `setTransient` caller); apps cannot open one.*
- [x] Active-call banner with running call timer. `Src/lunaui/notifications/ActiveCallBanner.cpp` *Phoenix: done on phones (GAPS N7).*
- [x] Volume / ringer HUD. `Src/lunaui/notifications/VolumeControlAlertWindow.cpp` *Phoenix: done (`VolumeIndicator.qml`; GAPS N7).*
- [ ] QML alert windows (generic system dialogs). `Src/lunaui/notifications/QmlAlertWindow.cpp`; `uiComponents/MessageDialog/MessageDialog.qml` *Phoenix: in the source this window shows three alerts (`WindowServerLuna.cpp:1353-1380`): the memory alert (done, `MemoryAlert.qml` in the popup alert's place), MsmEntryFailed (USB mode, below) and the dismiss-card tutorial (section 1), neither done. MessageDialog.qml is the lock screen's EAS dialog (`LockWindow.cpp:491`, section 6), not a service apps call.*
- [x] Native alert manager. `Src/lunaui/notifications/NativeAlertManager.cpp` *Phoenix: it was only the volume HUD's driver (it watches com.palm.audio's media, phone, ringtone and system status and shows `VolumeControlAlertWindow`); Phoenix shows `VolumeIndicator.qml` from the volume keys and the audio scenario (`Shell.qml`, `tst_volumekeys.qml`). Low battery comes from luna-systemui's popup.*
- [ ] LED notification throbber and blink-notifications preferences. `conf/defaultPreferences.txt` (`LEDThrobberEnabled`, `BlinkNotifications`); `Src/base/CoreNaviLeds.cpp` *Phoenix: the Blink Notifications preference only; nothing blinks yet.*
- [x] "Show alerts when locked" preference. `conf/defaultPreferences.txt` (`showAlertsWhenLocked`)

## 5. Launcher, quick launch and search [spec §5]

- [ ] Full-screen launcher sliding up over cards, with tabbed pages (apps, downloads, settings, favorites). `Src/lunaui/launcher/dimensionslauncher.cpp`; `conf/default-launcher-page-layout.json` *Phoenix: Apps, Downloads and Settings tabs with the slide-up; no Favorites page.*
- [x] Vertical scroll within a page; tabs across the top. `Src/lunaui/launcher/elements/bars/pagetabbar.cpp`; `elements/page/page.cpp`
- [x] Alphabetical page layout with letter dividers. `elements/page/icon_layouts/alphabeticonlayout.cpp` *N/A: dead code in the release. Only `AlphabetPage` makes this layout, and nothing makes an `AlphabetPage` (its one use, `dimensionslauncher.cpp:2817`, is commented out); the pages are all reorderable.*
- [ ] Reorder mode: tap-and-hold to drag icons, move them between pages (edge dwell), Done button. `elements/page/icon_layouts/reorderableiconlayout.cpp`; `dimensionslauncher.cpp` *Phoenix: hold to drag, Done, drop on a tab to move between pages; no edge dwell.*
- [x] Delete/remove badges on icons (uninstall user apps, remove launch points). `elements/icons/iconheap.cpp:35-39`
- [x] App info dialog (version, size, remove). `uiComponents/AppInfoDialog/AppInfoDialog.qml` *Phoenix: done as the launcher used it: the (x) in edit mode asks "Remove Application?" with the title and version, Cancel and Remove (`tst_launcher.qml`). The original showed no size.*
- [ ] Install progress and error badges on icons. `elements/icons/iconheap.cpp:44-51`; `Src/base/application/ApplicationInstaller.cpp` *Phoenix: not done (GAPS L8); an app appears in the launcher once installed, and the Marketplace shows the progress.*
- [x] Launch feedback (touch highlight, 3 s timeout). `Src/lunaui/launcher/OverlayWindowManager.cpp:2018-2030`
- [x] Quick-launch bar (dock) of up to 5 apps, plus a launcher button; drag to reorder, drag in from the launcher. `elements/bars/quicklaunchbar.cpp`; `QuicklaunchLayout.cpp`
- [ ] Quick-launch "wave" (swipe up and hold). `OverlayWindowManager.cpp:1000-1011` *Phoenix: not done. The release keeps only unused state for it; the wave itself (webOS 1.x-2.x) was closed source, so it would be designed from videos (GAPS Q3).*
- [x] Search pill in card view. `OverlayWindowManager.cpp:1150-1177`
- [x] **Just Type** / universal search: typing in card view opens search (the `com.palm.launcher` web app); web search providers. `OverlayWindowManager.cpp:971-995`; `conf/defaultPreferences.txt` (`webSearchList`) *Phoenix: Just Type's own app menu still to do (GAPS O1).*
- [ ] App blacklist (hidden system apps) and keyword → page mapping. `conf/launcher3/app_blacklist.conf`; `conf/launcher3/app-keywords-to-designator-map.txt` *Phoenix: hidden system apps and launcher tabs from appinfo.json; not the original's blacklist or keyword map files.*
- [ ] Launch points (multiple per app, custom launch points added by apps). `Src/base/application/LaunchPoint.cpp`; README `addLaunchPoint` *Phoenix: several per app from appinfo.json; addLaunchPoint does not add one yet.*
- [x] Launcher and dock position persistence. `Src/lunaui/launcher/systeminterface/pagesaver.cpp`, `pagerestore.cpp`; `Src/base/settings/Settings.cpp:161-165` *Phoenix: in the simulator.*
- [x] Empty-page hint. `Src/lunaui/launcher/elements/page/reorderablepage.cpp:64` *Phoenix: done (`Launcher.qml`, `tst_launcher.qml`).*

## 6. Lock screen and security [spec §6]

- [x] Lock screen with large bitmap clock, status bar with date, and wallpaper. `Src/lunaui/lockscreen/LockWindow.cpp`; `ClockWindow.cpp`
- [x] Drag-up padlock to unlock (146 px radius). `LockWindow.cpp:1801-1860`
- [x] Incoming call on the lock screen: "Drag up to answer". `LockWindow.cpp:95-96,2333-2335`
- [x] Notifications on the lock screen (dashboards, banners, popups). `LockWindow.cpp:2595-2860`
- [x] PIN pad unlock. `uiComponents/UnlockPanel/PINPad.qml`
- [x] Password unlock (hardware or virtual keyboard). `uiComponents/UnlockPanel/PasswordField.qml`
- [ ] Last-try warning and "set new PIN" dialogs (EAS policy). `Src/lunaui/lockscreen/LockWindow.h:129-137`; `Src/base/EASPolicyManager.cpp` *Phoenix: not done: no retry count or security policy, and no port of `uiComponents/MessageDialog` (GAPS K1, K7).*
- [ ] Device passcode service (`setDevicePasscode`, `matchDevicePasscode`, `getDeviceLockMode`, `getSecurityPolicy`). `Src/base/SystemService.cpp:218-222`; `Src/base/Security.cpp` *Phoenix: set, match and lock mode in the simulator; no getSecurityPolicy, no device service yet.*
- [x] Lock timeout preference; auto-lock on display off. `Src/base/DisplayManager.cpp`; `conf/defaultPreferences.txt` (`lockTimeout`) *Phoenix: done (`Display.qml`, `tst_display.qml`): the screen dims and turns off when left alone, turning off locks, Power turns it off and Power or Home on; Screen & Lock's "Lock after" (`lockTimeout`) skips the PIN within that long of locking (`LockWindow::requiresPasscode`).*
- [ ] Full Erase key chord with countdown confirmation. `Src/lunaui/FullEraseConfirmationWindow.cpp`; `Src/lunaui/WindowServerLuna.cpp:1240-1276` *Phoenix: not the chord or its window; Settings > Device Info > Full Erase erases (`org.webosphoenix.service.reset/fullErase` in the simulator).*

## 7. Navigation: gesture area, home button, light bar [spec §7]

- [x] Back gesture. `SystemUiController.cpp:424-443`
- [x] Up-swipe to card view / launcher toggle. `SystemUiController.cpp:445-497`
- [x] Down-swipe to re-maximize the active card. `SystemUiController.cpp:499-526`
- [x] Optional advanced gestures: previous/next app (full-width swipe). `SystemUiController.cpp:308-315,394-408`; `Src/base/settings/Preferences.cpp:66,598-604` *Phoenix: Settings > Screen & Lock > Advanced gestures, where there is a gesture area; a swipe across its centre over half its width.*
- [x] Meta key (gesture-area hold) for copy/cut/paste/select-all. `Src/base/MetaKeyManager.cpp`; `SystemUiController.cpp:180-184` *Phoenix: a finger resting on the gesture bar is the meta key (`GestureArea.metaHeld`); A, C, X, V typed on a keyboard or the virtual keyboard are Select All, Copy, Cut, Paste in the app in front or Just Type; the bar glows while held (`tst_gesturebar` test_metaKey).*
- [x] Home button: minimize, launcher toggle, double-press. `SystemUiController.cpp:528-584`
- [x] TouchPad bezel edge-flick. `SystemUiController.cpp:2041-2121`; `Src/base/gesture/ScreenEdgeFlickGestureRecognizer.cpp`
- [x] Light-bar / CoreNavi LED gesture feedback. `Src/base/CoreNaviManager.cpp`; `Src/base/CoreNaviLeds.cpp` *Phoenix: on the on-screen gesture bar: lit while an app is maximized, a drop from the centre for up, its reverse for down, a run left / right for back / forward. A device's own LEDs are not driven yet.*
- [x] Screenshot (Home + Power) and the `takeScreenShot` service, with a screenshot flash animation. `Src/base/WindowServer.cpp:629-683`; `Src/base/visual/WSOverlayScreenShotAnimation.cpp` *Phoenix: Home + Power, the flash, then a thumbnail and preview (docs/SCREENSHOTS.md); no com.palm.systemmanager/takeScreenShot service yet.*
- [x] Touch reticle (tap ripple). `Src/base/visual/ReticleItem.cpp` *Phoenix: Shell.qml's reticle, from UserActivity's taps.*
- [ ] Bluetooth keyboard shortcuts (Esc for dashboard, Search for Just Type, Super for card view, Keyboard key for the IME). `SystemUiController.cpp:338-343,586-624` *Phoenix: Search toggles Just Type and Super (alone) is card view; Esc stays Back (the simulator's Back key) and typing in card view starts Just Type. Not the Keyboard key (Qt has no code for it).*

## 8. Input [spec §8]

- [x] Virtual keyboard (plugin) with show/hide, phone and tablet art (simulator; GAPS V1). `Src/ime/*`; `images/keyboard-phone/`, `images/keyboard-tablet/`
- [x] Keyboard layouts and languages preference (QWERTY/AZERTY/QWERTZ). `Src/ime/VirtualKeyboardPreferences.cpp` *Phoenix: done: Settings > Text Assist > Keyboards turns on English (QWERTY), Deutsch (QWERTZ), Français (AZERTY) and a QWERTY without words (`x_palm_virtualkeyboard_prefs` keyboards); with two or more, the language key (tablet: beside 123; phone: Shift on the 123 page) goes to the next and, held, lists them, the one in use kept in `x_palm_virtualkeyboard_settings`; suggestions, corrections and swipe follow its language (`tst_keyboard.qml`, `tst_tabletkeyboard.qml`, `tools/test-settings.cjs`). Choosing between whole keyboards (V7) is still to come.*
- [ ] IME variants: pinyin and handwriting (persistent windows). `conf/persistentWindows.conf:28-31` *Phoenix: not done; the `com.palm.app.ime` app these windows belonged to is not in the open source.*
- [ ] Hardware keyboard slider support (Pre, Veer): keyboard-open events, slider unlock timeouts. `Src/base/settings/DeviceInfo.cpp:212-275`; `Src/base/DisplayManager.cpp:110-113`
- [ ] Text-assist prefs: spell check, autocorrect, shortcuts. `conf/defaultPreferences.txt` (`x_palm_textinput`) *Phoenix: Settings > Text Assist: suggestions, auto-correct, swipe typing (GAPS V3); no editable shortcuts.*

## 9. Dock mode / Exhibition [spec §9]

- [ ] Enter dock mode on the Touchstone (inductive) charger; exit on Home or gesture. `Src/base/DisplayManager.cpp:544-547,1000-1022`
- [ ] Exhibition app switcher menu from the status bar (up to 3 apps, per-puck). `Src/lunaui/dock/DockModeMenuManager.cpp`, `DockModeAppMenuContainer.cpp`, `DockModePositionManager.cpp`
- [ ] Built-in Time exhibition: three clocks (analog glass, flip digital, analog matte). `uiComponents/DockModeTime/*.qml`; `Src/lunaui/dock/DockModeClock.cpp`
- [ ] Photos slideshow as the default exhibition app. `conf/default-exhibition-apps.json`
- [ ] Night-mode brightness and dock sound preference. `Src/base/settings/Settings.cpp:184`; `conf/defaultPreferences.txt` (`dockModeSoundPref`)
- [ ] Dock-mode lock state (lock screen in dock mode). `LockWindow.h:132`

## 10. System lifecycle and misc surfaces [spec §10]

- [ ] Boot animation (logo plus spinner) and "Updating the system" progress. `Src/base/BootupAnimation.cpp`
- [ ] USB mass-storage mode (MSM) and fsck screens. `Src/base/ProgressAnimation.cpp`; `Src/lunaui/lockscreen/TopLevelWindowManager.cpp:180-200`; `uiComponents/MsmEntryFailed/alert.qml`
- [x] Emergency (full-screen call) mode. `Src/lunaui/emergency/EmergencyWindowManager.cpp` *Phoenix: EmergencyWindow.qml, from the lock screen's Emergency Call.*
- [x] Boot and shutdown sounds, charging sounds, and the system sound set. `sounds/`; `Src/base/settings/Settings.cpp:103-107` *Phoenix: in the simulator; on a device the MP3s need WAV copies (GAPS A1).*
- [ ] Ringtone, alert tone and notification tone preferences. `conf/defaultPreferences.txt` *Phoenix: the ringtone is chosen in Settings > Sounds; alert and notification tones have no picker.*
- [ ] Wallpaper preference, plus a separate dock wallpaper. `conf/defaultPreferences.txt`; `Src/base/settings/Preferences.cpp` (`dockwallpaper`) *Phoenix: wallpaper done (Settings > Screen & Lock); no dock wallpaper.*
- [ ] Auto-brightness (ambient light sensor), brightness scales, display timeout and dimming. `Src/base/AmbientLightSensor.cpp`; `Src/base/DisplayManager.cpp:95-115`; `conf/luna.conf:49-53` *Phoenix: brightness, and the timeout and dimming (Display.qml: dim at two thirds of "Turn off after", off a third later, 5 s on the lock screen, woken by alerts, calls and the charger); no light sensor yet (device).*
- [x] UI rotation driven by the accelerometer, with rotation lock (simulator; the device's sensor is not wired yet). `Src/base/WindowServer.cpp:1900-1960`; `conf/luna.conf:121`
- [ ] Haptics / vibration (`vibrate`, `vibrateNamedEffect`). `Src/base/HapticsController.cpp`; README.md:127-128 *Phoenix: the shell counts vibrations; nothing is felt, no vibrateNamedEffect.*
- [ ] Headset, audio, media and ringer switch keys (`com.palm.keys/*`). README.md:96-99 *Phoenix: the volume keys only (simulator F10 / F11, `Shell.volumeKey`); no ringer switch, headset or media keys.*
- [x] Locale, region, time zone and network time preferences. `conf/defaultPreferences.txt`; `conf/locale.txt`; `conf/timezone.txt` *Phoenix: Settings > Date & Time and Language & Region, in the simulator.*
- [x] Backup and restore hooks (`preBackup` / `postRestore`). `Src/base/BackupManager.cpp`; README.md:27-28. *Phoenix: `com.palm.sysMgrDataBackup` in `runtime/phoenix-runtime.js` ("Backup") saves and restores the launcher pages and dock (there is no dock mode to save), called by Settings > Backup and First Use's restore (`tools/test-backup.cjs`). On a device the shell does not register the service yet.*
- [ ] Turbo-mode (CPU boost) subscription. `Src/base/SystemService.cpp:249` *Phoenix: `subscribeTurboMode` answers without doing anything.*
- [ ] FPS counter / touch plot debugging overlays. `Src/base/SystemService.cpp:238-239`; `Src/base/visual/TouchPlot.cpp` *Phoenix: not done (the tap reticle is the only touch overlay).*

## 11. Services LunaSysMgr exposes (README.md:24-128)

- [ ] `com.palm.applicationManager/*`: launch, open, close, running, listApps, launch points (add/remove/list/update icon), dock-mode launch points, MIME / URL / redirect / resource handler registry, searchApps, install, rescan, getAppInfo, getSizeOfApps. README.md:38-90; `Src/base/application/ApplicationManagerService.cpp` *Phoenix (`runtime/phoenix-runtime.js`): launch, open, listApps, listLaunchPoints, launchPointChanges, updateLaunchPointIcon, searchApps, getAppInfo, getAppBasePath, and the MIME handlers (getHandlerForMimeType, listAllHandlersForMime, getResourceInfo, from appinfo.json) in the simulator; running and addLaunchPoint are stubs; not close, removeLaunchPoint, dock-mode launch points, the add / swap / remove handler registry, install, rescan, getSizeOfApps.*
- [ ] `com.palm.appinstaller/*`: install, installNoVerify, remove, revoke, isInstalled, installProgressQuery, notifyOnChange, queryInstallCapacity, getUserInstalledAppSizes. README.md:29-37; `Src/base/application/ApplicationInstaller.cpp` *Phoenix: install, installNoVerify, remove, isInstalled in the simulator; not revoke, notifyOnChange, or the progress, capacity and size methods.*
- [ ] `com.palm.systemmanager/*`: systemUi (launcher, quick launch, universal search, VK control, app menu), publish/subscribeToSystemUI, getForegroundApplication, applicationHasBeenTerminated, getLockStatus, getDockModeStatus, lockButtonTriggered, passcode methods, getBootStatus, runProgressAnimation, takeScreenShot, launchModalApp/dismissModalApp, get/setAnimationValues, touchToShare*, subscribeTurboMode, clearCache, getAppRestoreNeeded, getSystemStatus, setJavascriptFlags. README.md:100-126; `Src/base/SystemService.cpp:209-250` *Phoenix: getLockStatus, getSystemStatus, getDeviceLockMode, setDevicePasscode, matchDevicePasscode, getBootStatus, publishToSystemUI and subscribeToSystemUI; the rest answer without doing anything.*
- [ ] `com.palm.display/*` (status, control getProperty/setProperty/setState). README.md:91-95; `Src/base/DisplayManager.cpp` *Phoenix: a fixed displayOn status only; the shell's real display state (`Display.qml`) is not reported, and apps keep the screen on through `blockScreenTimeout` instead.*
- [ ] `com.palm.ambientLightSensor/control/status`. README.md:26; `Src/base/AmbientLightSensor.cpp`
- [ ] `com.palm.keys/*` (audio, headset, media, switches). README.md:96-99; `Src/base/InputManager.cpp` *Phoenix: a stub that answers without doing anything.*
- [ ] `com.palm.vibrate/*`. README.md:127-128 *Phoenix: a stub that answers without doing anything.*
- [x] `com.palm.appDataBackup/*`. README.md:27-28 *Phoenix: the README's name is wrong: `BackupManager.cpp:71` registers `com.palm.sysMgrDataBackup`, which the runtime answers (preBackup, postRestore; see the backup hooks above).*

## 12. Boot-time app policy

- [ ] Launch-at-boot (headless, pre-warmed): phone, email, calendar, messaging, camera (base). Pixi adds contacts; TouchPad drops camera; Pre 3 (windsornot) keeps only phone and email. `conf/luna.conf:98-99`; `conf/luna-pixie.conf:30-31`; `conf/luna-topaz.conf:18-19`; `conf/luna-windsornot.conf:18-19` *Phoenix: only luna-systemui starts at boot (`SimWindowSource.bootApps`); the core apps start when first launched.*
- [ ] Keep-alive apps: phone (base). TouchPad: email, calendar, messaging, photos, musicplayer. `conf/luna.conf:101-102`; `conf/luna-topaz.conf:21-22` *Phoenix: not done; closing an app's last card closes the app, headless apps included (`SimWindowSource.qml`), and `PalmSystem.keepAlive` does nothing.*
- [ ] Keep alive until memory pressure: browser (Pixi also camera). `conf/luna.conf:104-105`; `conf/luna-pixie.conf:33-34` *Phoenix: not done.*
- [x] Apps allowed in low memory: phone, contacts, messaging. `conf/luna.conf:65` *Phoenix: SimWindowSource.appsAllowedInLowMemory (and the Phoenix Phone and Messaging); any other launch shows "Sorry, Too Many Cards" (phoenix-sim --low-memory).*
- [x] SUC apps with special launch privileges: App Catalog (enyo-findapps), QuickOffice AR, payment app and service. `conf/luna.conf:156-157` *N/A: the privilege was only that these could launch while not ready (being installed or updated), when any other app's launch went to Software Manager instead (`WebAppMgrProxy.cpp:544-559`). Phoenix has no not-ready apps in the launcher, and none of these apps ships.*
- [x] Persistent (pre-created, cached) windows: systemui DeviceMenu; phone incoming / incoming-known / incoming-unknown; IME pinyin and hwr. `conf/persistentWindows.conf:18-32`; `Src/lunaui/PersistentWindowCache.cpp` *N/A: a cache to show these windows faster, not a feature of its own. What it held is covered elsewhere: the device menu is the shell's own system menu (section 3), Phoenix Phone's incoming call is a popup alert (Apps, Phone), and pinyin and handwriting are under Input (section 8).*

## 13. System apps in this repo (`sysapps/`)

- [ ] **Voice Dial** (`com.palm.sysapp.voicedial`): hands-free voice dialing, system app with a generic microphone icon. `sysapps/com.palm.sysapp.voicedial/appinfo.json` *Phoenix: not done. Its launcher icon only called `com.palm.pmvoicecommand/startVoiceCommand {source: "appicon"}` (`ApplicationManager.cpp:2960-2976`), a service that was never released.*
- [x] `sysapps-test/` holds test fixtures only (not user-facing). `sysapps-test/` *N/A: test fixtures, nothing to port. Its one app is launchermode0, below.*
- [x] `com.palm.sysapp.launchermode0`: hidden system app used to switch launcher modes (blacklisted from the launcher). `conf/launcher3/app_blacklist.conf:25`; `Src/base/application/ApplicationManager.cpp:2982` *N/A: a developer tool ("Anger My Cards") that runs a `.system.sh` script that is not in the release; nothing user-facing to port.*

---

# Apps (outside system UI)

The core apps legacy webOS shipped. Evidence gives where the ID appears in the legacy system UI; "not referenced" means I know
of the app from legacy webOS (**inferred**) but it never names it. The seven apps Palm/HP released as Open webOS (Accounts,
Calculator, Calendar, Clock, Contacts, Email, Memos) run unmodified from `third_party/core-apps` and are checked below; the
others need reimplementation or an alternative for Phoenix.

## Communication
- [ ] **Phone / Dialer** (`com.palm.app.phone`): launch-at-boot, keep-alive, incoming-call popups, active-call banner. `conf/luna.conf:99,102`; `conf/notificationPolicy.conf:20-28`. *Phoenix: `apps/phone` (`org.webosphoenix.phone`) has the dial pad, call log, favourites and in-call screen, the incoming call as a popup alert (`incoming-known` / `incoming-unknown`, Answer / Ignore; answering brings the card up) and an incoming-call banner, against simulated legacy telephony, the lock-screen answer (GAPS K2), hold / swap of a second call, the emergency mode, and the active-call banner while a call is connected (GAPS N7). Still missing: launch-at-boot / keep-alive, conference calls, a real telephony service (device).*
- [ ] **Messaging** (SMS/MMS/IM, `com.palm.app.messaging`). `conf/luna.conf:99`; `conf/notificationPolicy.conf:35`. *Phoenix: `apps/messaging` (`org.webosphoenix.messaging`) sends and receives SMS (simulated), with conversations, chat balloons and a contact picker; MMS and IM transports are not done (IM shown as unavailable).*
- [x] **Email** (`com.palm.app.email`, Enyo `com.palm.app.enyo-email` on the TouchPad). `conf/luna.conf:99`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`. No mail server yet (simulated transports).
- [x] **Contacts / Synergy** (`com.palm.app.contacts`, `com.palm.app.enyo-contacts`). `conf/default-launcher-page-layout.json`; `conf/luna.conf:65`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [x] **Calendar** (`com.palm.app.calendar`, `com.palm.app.enyo-calendar`). `conf/luna.conf:99`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [ ] **Agenda view** exhibition (`com.palm.app.agendaview`). `Src/base/application/ApplicationManagerService.cpp:2524` *Phoenix: not done; needs dock mode (section 9).*
- [x] **Accounts** (Synergy account manager, `com.palm.app.accounts`). `conf/default-launcher-page-layout.json`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [ ] **Voice Dial** (`com.palm.sysapp.voicedial`). In this repo: `sysapps/` *Phoenix: not done (see section 13).*
- [ ] **SIM Toolkit** (`com.palm.app.stk`). `Src/base/SystemUiController.cpp:2014` *Phoenix: not done.*

## Web and media
- [x] **Web browser** (`com.palm.app.browser`). `conf/luna.conf:105` *Phoenix: HP's Isis browser, unmodified (a native Chromium view in phoenix-sim); see docs/APP-RUNTIME.md. Its downloads go to the simulated download manager (`com.palm.downloadmanager`), not checked end to end. Missing: printing, and a page view on a device.*
- [x] **Camera** (`com.palm.app.camera`). `conf/luna.conf:99`. Phoenix: `apps/camera` (viewfinder, photo and video, flash, last shot opens Photos; no zoom, timer or geotags yet)
- [x] **Photos & Videos** (`com.palm.app.photos`, plus `com.palm.app.videoplayer`). `conf/luna-topaz.conf:22`; `ApplicationManagerService.cpp:3836`. Phoenix: `apps/photos` (albums, grid, swipe viewer, share, delete, set as wallpaper, video playback; no slideshow, pinch zoom or online albums yet)
- [x] **Music** (`com.palm.app.musicplayer`, `com.palm.app.streamingmusicplayer`). `conf/luna-topaz.conf:22`; `ApplicationManagerService.cpp:4495`. Phoenix: `apps/music` (artists, albums, songs, now playing, seek, volume, shuffle/repeat, banner; no playlists, genres or dashboard controls yet)
- [ ] **YouTube** (`com.palm.app.youtube`), **Amazon MP3** (`com.palm.app.amazonmp3`), **Kindle** (`com.palm.app.kindle`), **Facebook** (`com.palm.app.enyo-facebook`). `conf/default-launcher-page-layout.json` *Phoenix: YouTube and Facebook as Marketplace web apps; nothing for Amazon MP3 or Kindle.*
- [x] **Maps** (`com.palm.app.maps`; Bing/Google Maps). `conf/default-launcher-page-layout.json` *Phoenix: `apps/maps` (MapLibre: search, routes, turn-by-turn, saved places, offline areas). On a device: GPS and a speech engine.*

## Productivity
- [x] **Memos / Notes** (`com.palm.app.notes`). `conf/default-launcher-page-layout.json`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [ ] **QuickOffice** viewer / editor (`com.quickoffice.webos`, `com.quickoffice.ar`). `conf/default-launcher-page-layout.json` *Phoenix: `apps/docview` reads Word, Excel, PowerPoint, EPUB and Markdown; no editing. The original Quickoffice installs but needs its PDK plugin (docs/PDK.md).*
- [x] **Calculator** (`com.palm.calculator`; Open webOS `com.palm.app.calculator`). `Src/base/application/ApplicationDescription.cpp:1119`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [x] **Clock / alarms** (`com.palm.app.clock`). `conf/notificationPolicy.conf:26`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [x] Alarm "ring" popup. *Phoenix: the simulated activity manager fires alarms and launches Clock with its ring params; checked end to end (tools/test-alarm.cjs): the alarm fires, Clock relaunches and rings as a popup alert.*
- [x] **Tasks** (webOS 1.x; lists synced per account through Synergy, e.g. Exchange's `com.palm.task.eas:1`). Phoenix: `apps/tasks` (`org.webosphoenix.tasks`): lists (Inbox, add, rename, delete), tasks with due date and time, priority, notes, complete (struck through), hide completed, Today / Upcoming / Overdue, reminders through `com.palm.activitymanager` with a notification (tap: Snooze 10 min / Done), Just Type "New Task" and task search; db8 kinds `com.palm.task:1`, `com.palm.tasklist:1`. No account sync yet. See `docs/APP-RUNTIME.md#tasks`
- [x] **Voice Memos** (webOS 2.x, Pre 2 / Pre 3). Not referenced in this repo (**inferred**). Phoenix: `apps/voicememos` (`org.webosphoenix.voicememos`): record with a level meter, pause / resume, list, playback with a scrubber, rename, share, delete, and transcription (whisper.cpp on the device through `org.webosphoenix.transcriber`), searchable in the app and in Just Type. See `docs/APP-RUNTIME.md#voice-memos`
- [x] **PDF View / Doc View** (pre-QuickOffice phone apps). Not referenced in this repo. *Phoenix: `apps/pdfview` and `apps/docview`.*
- [x] **Help** (`com.palm.app.help`). `conf/default-launcher-page-layout.json` *Phoenix: `apps/help` (searchable topics, in Just Type).*
- [ ] **Print Manager** (`com.palm.app.printmanager`). `conf/default-launcher-page-layout.json` *Phoenix: not done; no printing anywhere.*
- [x] **File manager** (not shipped by Palm; homebrew from Preware, above all Internalz Pro). Phoenix: `apps/files` (`org.webosphoenix.files`), a clean-room design with Internalz Pro's feature set: browse, sort, hidden files, favourites, multi-select, copy / cut / paste, delete, rename, new folder / file, info, image viewer, text editor, "Open with", .ipk install through `com.palm.appinstaller` (simulated); on the Phoenix service `org.webosphoenix.filemanager`. See `docs/APP-RUNTIME.md#files`

## Store and first use
- [x] **HP App Catalog** (`com.palm.app.enyo-findapps`, older `com.palm.app.findapps`), plus the payment app. *Phoenix: the Marketplace (`apps/marketplace`, `server/marketplace`; no payments), with the App Museum II and Preware as add-on catalogs (docs/APP-RUNTIME.md#marketplace).* `conf/luna.conf:157`; `Src/lunaui/launcher/operationalsettings.cpp:194`
- [x] **First Use / setup wizard** (`com.palm.app.firstuse`). `Src/base/application/ApplicationManager.cpp:2381` *Phoenix: `apps/firstuse`: language, Wi-Fi, date and time, accounts, passcode, privacy, tutorial, restore from backup; Settings > Device Info runs it again.*
- [x] **Software Manager** (`com.palm.app.swmanager`) and **System Updates** (`com.palm.app.updates`). `conf/default-launcher-page-layout.json`. *Phoenix: System Updates is Settings > Updates on `com.palm.update` (Palm's API, kept for luna-systemui's alerts) over RAUC A/B slots; done in the simulator (docs/APP-RUNTIME.md#system-updates). The Software Manager's list of installed apps is the launcher's delete and the Marketplace.*
- [x] **Backup** (`com.palm.app.backup`). `conf/default-launcher-page-layout.json`. *Phoenix: Settings > Backup and `org.webosphoenix.service.backup` (USB drive or WebDAV, encrypted), restore in First Use; `com.palm.app.backup` opens it (docs/APP-RUNTIME.md#backup).*

## Settings apps (launcher "Settings" page, `conf/default-launcher-page-layout.json:29-51`)

Phoenix rebuilds these as one React app, `apps/settings` (`org.webosphoenix.settings`), with one launcher
icon and card per pane (launch points). Checked items work in the simulator against simulated OSE services;
none has run on a device yet. See `docs/APP-RUNTIME.md`.

- [x] Wi-Fi (`com.palm.app.wifi`): on/off, network list, join with password, join other network, forget
- [x] Bluetooth (`com.palm.app.bluetooth`): on/off, search, pair, forget (no per-profile connect yet)
- [x] VPN (`com.palm.app.vpn`): profiles of six kinds (LuneOS `com.webos.service.vpn`), import of WireGuard and OpenVPN files, connect with sign-in, edit, delete
- [x] Date & Time (`com.palm.app.dateandtime`): 12/24 hour, network time and time zone, zone picker, manual date/time
- [x] Device Info (`com.palm.app.deviceinfo`): device, software, phone (number, carrier, network, IMEI/MEID, SIM), battery, storage, memory, licenses, reset options (Reset All Settings, Erase Apps & Data, Full Erase)
- [ ] Exhibition preferences (`com.palm.app.exhibitionpreferences`) *Phoenix: not done; needs dock mode (section 9).*
- [ ] Just Type / search preferences (`com.palm.app.searchpreferences`) *Phoenix: not done. The preferences are stored and served (`com.palm.universalsearch` get/setSearchPreference, updateSearchItem in the runtime), but there is no pane, and the shell does not open Just Type's app menu, whose Preferences item would launch it (GAPS O1).*
- [x] Location Services (`com.palm.app.location`) *Phoenix: Settings > Location: on/off, GPS and network, per-app permissions.*
- [x] Language picker (`com.palm.app.languagepicker`): Language & Region (UI and format locales); apps do not localize yet
- [x] Screen & Lock (`com.palm.app.screenlock`): brightness, timeout, rotation lock, wallpaper, notifications when locked, PIN/password (the lock screen asks for it: the ported PIN pad and password panel), "Lock after"; the screen turning off locks (`Display.qml`)
- [x] Sounds & Ringtones (`com.palm.app.soundsandalerts`): volumes (master, ringer, alerts, system sounds, media), mute, ringtone (Open webOS's ringtone.mp3 and phone.wav, plus /media/internal/ringtones), System sounds, Keyboard clicks
- [x] Text Assist (`com.palm.app.textassist`). *Phoenix: Settings > Text Assist (suggestions, auto-correct, swipe typing, learned words) for the keyboard's candidate bar, swipe typing and dictation (docs/spec/GAPS.md V2, V3).*
- [ ] Certificate Manager (`com.palm.app.certificate`). `ApplicationManagerService.cpp:3822` *Phoenix: not done.*
- [ ] Phone preferences / Network settings / Power (phone-era prefs apps). Not referenced in this repo. *Phoenix: phone details in Device Info and radios in Airplane Mode; no call forwarding, data / roaming or power panes.*
- [x] Airplane Mode pane (Phoenix addition; on webOS it lived only in the system menu)
- [x] Emergency Info, Accessibility, Developer Mode, Updates, Backup, Text Assist and Location panes (Phoenix additions or moved here; see `apps/settings/src/pages/`)
