# Legacy webOS system-UI feature inventory

Checklist of every user-facing system-UI feature that the Open webOS `luna-sysmgr` source shows evidence of
(<https://github.com/openwebos/luna-sysmgr> at commit `1393f0af`; paths below are relative to it). Tick items off as Phoenix implements them. A tick means it works in the simulator; what a device still needs is in
[`GAPS.md`](GAPS.md) and [`../ROADMAP.md`](../ROADMAP.md). Partly done items stay unticked, with a *Phoenix:* note on what is done
and what is missing. (Last checked against the code on 2 October 2026.)
The pixel and timing details for each feature are in [`legacy-ui-spec.md`](legacy-ui-spec.md), with section numbers in brackets.

## 1. Card view / multitasking [spec §1]

- [x] Cards for running apps, with maximized and minimized (card view) states. `Src/lunaui/cards/CardWindowManager.cpp:180-246`
- [x] Card **stacks** (groups): cards launched by the focused app stack with it, others open a new stack to the right. `CardWindowManager.cpp:556-599`
- [x] Fanned layout inside the active stack, with tilt and a slight drop; closed stacks sit left and right with a 7 px offset. `Src/lunaui/cards/CardGroup.cpp:699-771`
- [x] Horizontal drag and flick through cards and stacks, snapping to the nearest stack. `CardWindowManager.cpp:1452-1600,1677-1738`
- [x] Flick a card up to close it (velocity/distance rule), or drag it off the top. `CardWindowManager.cpp:63-65,1700-1716`
- [x] Close any card on screen, including the stacks at the sides, and several at once with several fingers.
- [x] "Angry card": drag a card off the bottom to force-close it (no keep-alive); it is slung up off the top. Not yet: the upside-down Angry Birds sounds ("carddrag", "birdappclose"), which need sound files we can ship. `CardWindowManager.cpp:1280-1283,2841-2894`
- [x] Tap a card to maximize it; tap a partly hidden card to scroll the fan instead. `CardWindowManager.cpp:2151-2195`; `CardGroup.cpp:402-470`
- [x] Tap left or right of the stack, or tap-and-hold off a card, to switch stacks. `CardWindowManager.cpp:1648-1661,2176-2188`
- [x] Tap-and-hold to reorder cards within a stack and move them between stacks (20% edge zones). `CardWindowManager.cpp:1835-2101`
- [x] Rounded card corners (shader) and drop shadow. `CardWindow.cpp:2485-2533`; `Src/base/visual/CardDropShadowEffect.cpp`
- [x] Dimming of cards that aren't active (0.8). `CardWindow.cpp:245-255`
- [ ] Loading card: splash icon, pulsing glow and splash background while an app launches. `Src/lunaui/cards/CardLoading.cpp` *Phoenix: icon, pulsing glow and loading background done (CardLoading.qml); not yet the app's own splash background.*
- [ ] In-app scene push/pop zoom transition. `Src/lunaui/cards/CardTransition.cpp`
- [ ] Modal cards (320x480 child window over a dimmed parent), via `launchModalApp`/`dismissModalApp`. `CardWindow.cpp:1855-2125`; `Src/base/SystemService.cpp:247-248`
- [x] Full-screen apps that hide the status bar. `Src/base/SystemUiController.cpp:1389-1400` *Phoenix: in the simulator (enableFullScreenMode).*
- [x] Card rotation and orientation lock per app (fixed-orientation apps). `CardWindow.cpp:2536-`; `Src/lunaui/cards/CardHostWindow.cpp:180-240`
- [x] Keyboard navigation of cards (←/→, Enter, Ctrl+Backspace). `CardWindowManager.cpp:1189-1212`
- [ ] First-use "dismiss card" tutorial dialog. `CardWindowManager.cpp:1168-1187`; `uiComponents/DismissCardTutorial/dismissDialog.qml`
- [ ] Card limit and low-memory launch blocking, with a low-memory alert dialog. `conf/luna.conf:63-65`; `Src/base/MemoryMonitor.cpp`; `uiComponents/MemoryAlert/alert.qml`
- [x] Card-view wallpaper, rotated for landscape. `Src/lunaui/WindowServerLuna.cpp:89-156,900-928`
- [ ] Touch-to-Share "ghost card" throw animation and glow. `CardWindowManager.cpp:2915-2957`; `Src/base/visual/TouchToShareGlow.cpp`

## 2. Status bar [spec §2]

- [x] 28 px status bar: carrier or app title, clock, battery, and signal/connection icons. `Src/lunaui/status-bar/StatusBar.cpp`
- [ ] App-tinted status bar (custom color and title while an app is maximized). `StatusBar.cpp:476-520` *Phoenix: the maximized app's title is shown; no per-app colour yet (GAPS S6).*
- [x] Tappable title for the app menu (tablet). `StatusBar.cpp:111-116`
- [ ] Battery gauge with 12 levels, charging variants and error state; "battery full" sound. `StatusBarBattery.cpp` *Phoenix: levels, charging and the "battery full" sound done; no error state yet.*
- [x] Clock in 12/24 h, following the locale time-format preference. `StatusBarClock.cpp:198-232`
- [ ] Icons: RSSI (GSM / 1x / EV-DO dual), WAN type, Bluetooth, Wi-Fi bars, TTY, HAC, call forwarding, roaming (triangle variant), VPN, rotation lock, mute, airplane mode. `StatusBarInfo.cpp:183-326` *Phoenix: airplane, mute, rotation lock, VPN, Wi-Fi, Bluetooth and signal done; not yet WAN type, dual RSSI, TTY, HAC, call forwarding, roaming, connecting states.*
- [ ] Notification icon strip in the status bar (tablet, up to 10). `StatusBarNotificationArea.cpp`; `StatusBar.h:31-32` *Phoenix: done (Notifications.qml tabletIcons); not capped at 10.*
- [ ] Phone rounded screen corners. `Src/lunaui/status-bar/MenuWindowManager.cpp:126-146` *Phoenix: drawn while an app is maximized, not in card view.*

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
- [ ] Device menu (phone-era "DeviceMenu" persistent window of `com.palm.systemui`). `conf/persistentWindows.conf:19-21` *Phoenix: phones use the ported SystemMenu instead of luna-systemui's DeviceMenu window.*

## 4. Notifications [spec §4]

- [ ] Banner notifications: scrolling ticker with icon, queueing (5 s alone, 2 s when queued), sounds. `Src/lunaui/notifications/BannerMessageHandler.cpp` *Phoenix: banners with 5 s / 2 s timing and sounds; no real queue yet, no ticker scroll for long text.*
- [x] Phone: bottom notification bar with dashboard icons; tap to open dashboards upward. The bar and dashboard are negative space: the app shrinks and moves up (400 ms OutCubic), never covered. `Src/lunaui/notifications/DashboardWindowManager.cpp`; `SystemUiController.cpp:82,1361-1470`
- [x] Tablet: notification drop-down (320 px) from the status bar. `uiComponents/DashboardMenu/DashboardMenu.qml`; `DashboardWindowManager.cpp:142-170`
- [ ] Dashboards (persistent app mini-windows, 52 px rows) with swipe-to-dismiss, persistent (non-dismissable) variant, and scrolling after 5.5 rows. `Src/lunaui/notifications/DashboardWindowContainer.cpp` *Phoenix: 52 px rows, swipe to dismiss, scrolling after 5.5 rows done; app dashboards persistent only as live activities (no persistent dashboard variant).*
- [x] Popup alerts (incoming call, alarm, calendar reminder, system alerts) filtered by the policy file. `Src/lunaui/notifications/AlertWindow.cpp`; `conf/notificationPolicy.conf`; `NotificationPolicy.cpp` *Phoenix: with the notificationPolicy.conf queue.*
- [ ] Transient alerts. `DashboardWindowManager.cpp:183-190`
- [ ] Active-call banner with running call timer. `Src/lunaui/notifications/ActiveCallBanner.cpp`
- [ ] Volume / ringer HUD. `Src/lunaui/notifications/VolumeControlAlertWindow.cpp`
- [ ] QML alert windows (generic system dialogs). `Src/lunaui/notifications/QmlAlertWindow.cpp`; `uiComponents/MessageDialog/MessageDialog.qml`
- [ ] Native alert manager (low-level system alerts, e.g. low battery). `Src/lunaui/notifications/NativeAlertManager.cpp` *Phoenix: low battery comes from luna-systemui's popup; no native alert manager.*
- [ ] LED notification throbber and blink-notifications preferences. `conf/defaultPreferences.txt` (`LEDThrobberEnabled`, `BlinkNotifications`); `Src/base/CoreNaviLeds.cpp` *Phoenix: the Blink Notifications preference only; nothing blinks yet.*
- [x] "Show alerts when locked" preference. `conf/defaultPreferences.txt` (`showAlertsWhenLocked`)

## 5. Launcher, quick launch and search [spec §5]

- [ ] Full-screen launcher sliding up over cards, with tabbed pages (apps, downloads, settings, favorites). `Src/lunaui/launcher/dimensionslauncher.cpp`; `conf/default-launcher-page-layout.json` *Phoenix: Apps, Downloads and Settings tabs with the slide-up; no Favorites page.*
- [x] Vertical scroll within a page; tabs across the top. `Src/lunaui/launcher/elements/bars/pagetabbar.cpp`; `elements/page/page.cpp`
- [ ] Alphabetical page layout with letter dividers. `elements/page/icon_layouts/alphabeticonlayout.cpp`
- [ ] Reorder mode: tap-and-hold to drag icons, move them between pages (edge dwell), Done button. `elements/page/icon_layouts/reorderableiconlayout.cpp`; `dimensionslauncher.cpp` *Phoenix: hold to drag, Done, drop on a tab to move between pages; no edge dwell.*
- [x] Delete/remove badges on icons (uninstall user apps, remove launch points). `elements/icons/iconheap.cpp:35-39`
- [ ] App info dialog (version, size, remove). `uiComponents/AppInfoDialog/AppInfoDialog.qml`
- [ ] Install progress and error badges on icons. `elements/icons/iconheap.cpp:44-51`; `Src/base/application/ApplicationInstaller.cpp`
- [x] Launch feedback (touch highlight, 3 s timeout). `Src/lunaui/launcher/OverlayWindowManager.cpp:2018-2030`
- [x] Quick-launch bar (dock) of up to 5 apps, plus a launcher button; drag to reorder, drag in from the launcher. `elements/bars/quicklaunchbar.cpp`; `QuicklaunchLayout.cpp`
- [ ] Quick-launch "wave" (swipe up and hold). `OverlayWindowManager.cpp:1000-1011`
- [x] Search pill in card view. `OverlayWindowManager.cpp:1150-1177`
- [x] **Just Type** / universal search: typing in card view opens search (the `com.palm.launcher` web app); web search providers. `OverlayWindowManager.cpp:971-995`; `conf/defaultPreferences.txt` (`webSearchList`) *Phoenix: Just Type's own app menu still to do (GAPS O1).*
- [ ] App blacklist (hidden system apps) and keyword → page mapping. `conf/launcher3/app_blacklist.conf`; `conf/launcher3/app-keywords-to-designator-map.txt` *Phoenix: hidden system apps and launcher tabs from appinfo.json; not the original's blacklist or keyword map files.*
- [ ] Launch points (multiple per app, custom launch points added by apps). `Src/base/application/LaunchPoint.cpp`; README `addLaunchPoint` *Phoenix: several per app from appinfo.json; addLaunchPoint does not add one yet.*
- [x] Launcher and dock position persistence. `Src/lunaui/launcher/systeminterface/pagesaver.cpp`, `pagerestore.cpp`; `Src/base/settings/Settings.cpp:161-165` *Phoenix: in the simulator.*
- [ ] Empty-page hint. `Src/lunaui/launcher/elements/page/reorderablepage.cpp:64`

## 6. Lock screen and security [spec §6]

- [x] Lock screen with large bitmap clock, status bar with date, and wallpaper. `Src/lunaui/lockscreen/LockWindow.cpp`; `ClockWindow.cpp`
- [x] Drag-up padlock to unlock (146 px radius). `LockWindow.cpp:1801-1860`
- [x] Incoming call on the lock screen: "Drag up to answer". `LockWindow.cpp:95-96,2333-2335`
- [x] Notifications on the lock screen (dashboards, banners, popups). `LockWindow.cpp:2595-2860`
- [x] PIN pad unlock. `uiComponents/UnlockPanel/PINPad.qml`
- [x] Password unlock (hardware or virtual keyboard). `uiComponents/UnlockPanel/PasswordField.qml`
- [ ] Last-try warning and "set new PIN" dialogs (EAS policy). `Src/lunaui/lockscreen/LockWindow.h:129-137`; `Src/base/EASPolicyManager.cpp`
- [ ] Device passcode service (`setDevicePasscode`, `matchDevicePasscode`, `getDeviceLockMode`, `getSecurityPolicy`). `Src/base/SystemService.cpp:218-222`; `Src/base/Security.cpp` *Phoenix: set, match and lock mode in the simulator; no getSecurityPolicy, no device service yet.*
- [ ] Lock timeout preference; auto-lock on display off. `Src/base/DisplayManager.cpp`; `conf/defaultPreferences.txt` (`lockTimeout`) *Phoenix: the preference exists; the shell does not lock on timeout or display off yet.*
- [ ] Full Erase key chord with countdown confirmation. `Src/lunaui/FullEraseConfirmationWindow.cpp`; `Src/lunaui/WindowServerLuna.cpp:1240-1276`

## 7. Navigation: gesture area, home button, light bar [spec §7]

- [x] Back gesture. `SystemUiController.cpp:424-443`
- [x] Up-swipe to card view / launcher toggle. `SystemUiController.cpp:445-497`
- [x] Down-swipe to re-maximize the active card. `SystemUiController.cpp:499-526`
- [ ] Optional advanced gestures: previous/next app (full-width swipe). `SystemUiController.cpp:308-315,394-408`; `Src/base/settings/Preferences.cpp:66,598-604`
- [ ] Meta key (gesture-area hold) for copy/cut/paste/select-all. `Src/base/MetaKeyManager.cpp`; `SystemUiController.cpp:180-184`
- [x] Home button: minimize, launcher toggle, double-press. `SystemUiController.cpp:528-584`
- [x] TouchPad bezel edge-flick. `SystemUiController.cpp:2041-2121`; `Src/base/gesture/ScreenEdgeFlickGestureRecognizer.cpp`
- [ ] Light-bar / CoreNavi LED gesture feedback. `Src/base/CoreNaviManager.cpp`; `Src/base/CoreNaviLeds.cpp` *Phoenix: an on-screen glow on the gesture bar; no LED animations.*
- [x] Screenshot (Home + Power) and the `takeScreenShot` service, with a screenshot flash animation. `Src/base/WindowServer.cpp:629-683`; `Src/base/visual/WSOverlayScreenShotAnimation.cpp` *Phoenix: Home + Power, the flash, then a thumbnail and preview (docs/SCREENSHOTS.md); no com.palm.systemmanager/takeScreenShot service yet.*
- [ ] Touch reticle (tap ripple). `Src/base/visual/ReticleItem.cpp`
- [ ] Bluetooth keyboard shortcuts (Esc for dashboard, Search for Just Type, Super for card view, Keyboard key for the IME). `SystemUiController.cpp:338-343,586-624` *Phoenix: Esc is Back and typing in card view starts Just Type; not Search, Super or the Keyboard key.*

## 8. Input [spec §8]

- [x] Virtual keyboard (plugin) with show/hide, phone and tablet art (simulator; GAPS V1). `Src/ime/*`; `images/keyboard-phone/`, `images/keyboard-tablet/`
- [ ] Keyboard layouts and languages preference (QWERTY/AZERTY/QWERTZ). `Src/ime/VirtualKeyboardPreferences.cpp` *Phoenix: the QWERTY, QWERTZ and AZERTY layouts exist; nothing chooses them yet (V7).*
- [ ] IME variants: pinyin and handwriting (persistent windows). `conf/persistentWindows.conf:28-31`
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
- [ ] Auto-brightness (ambient light sensor), brightness scales, display timeout and dimming. `Src/base/AmbientLightSensor.cpp`; `Src/base/DisplayManager.cpp:95-115`; `conf/luna.conf:49-53` *Phoenix: brightness and the timeout preference; no ambient light sensor, dimming or display timeout yet.*
- [x] UI rotation driven by the accelerometer, with rotation lock (simulator; the device's sensor is not wired yet). `Src/base/WindowServer.cpp:1900-1960`; `conf/luna.conf:121`
- [ ] Haptics / vibration (`vibrate`, `vibrateNamedEffect`). `Src/base/HapticsController.cpp`; README.md:127-128 *Phoenix: the shell counts vibrations; nothing is felt, no vibrateNamedEffect.*
- [ ] Headset, audio, media and ringer switch keys (`com.palm.keys/*`). README.md:96-99
- [x] Locale, region, time zone and network time preferences. `conf/defaultPreferences.txt`; `conf/locale.txt`; `conf/timezone.txt` *Phoenix: Settings > Date & Time and Language & Region, in the simulator.*
- [ ] Backup and restore hooks (`preBackup` / `postRestore`). `Src/base/BackupManager.cpp`; README.md:27-28. *Phoenix: the launcher layout, in the simulator (the runtime's `com.palm.sysMgrDataBackup`); the shell's own service on a device is still to do.*
- [ ] Turbo-mode (CPU boost) subscription. `Src/base/SystemService.cpp:249`
- [ ] FPS counter / touch plot debugging overlays. `Src/base/SystemService.cpp:238-239`; `Src/base/visual/TouchPlot.cpp`

## 11. Services LunaSysMgr exposes (README.md:24-128)

- [ ] `com.palm.applicationManager/*`: launch, open, close, running, listApps, launch points (add/remove/list/update icon), dock-mode launch points, MIME / URL / redirect / resource handler registry, searchApps, install, rescan, getAppInfo, getSizeOfApps. README.md:38-90; `Src/base/application/ApplicationManagerService.cpp` *Phoenix: launch, open, handlers, listApps, launch points, searchApps, getAppInfo in the simulator; not close, removeLaunchPoint, rescan, getSizeOfApps; running and addLaunchPoint are stubs.*
- [ ] `com.palm.appinstaller/*`: install, installNoVerify, remove, revoke, isInstalled, installProgressQuery, notifyOnChange, queryInstallCapacity, getUserInstalledAppSizes. README.md:29-37; `Src/base/application/ApplicationInstaller.cpp` *Phoenix: install, installNoVerify, remove, isInstalled; not the progress, capacity and size methods.*
- [ ] `com.palm.systemmanager/*`: systemUi (launcher, quick launch, universal search, VK control, app menu), publish/subscribeToSystemUI, getForegroundApplication, applicationHasBeenTerminated, getLockStatus, getDockModeStatus, lockButtonTriggered, passcode methods, getBootStatus, runProgressAnimation, takeScreenShot, launchModalApp/dismissModalApp, get/setAnimationValues, touchToShare*, subscribeTurboMode, clearCache, getAppRestoreNeeded, getSystemStatus, setJavascriptFlags. README.md:100-126; `Src/base/SystemService.cpp:209-250` *Phoenix: lock status, passcode, system status, boot status, publish/subscribe to system UI; the rest answer without doing anything.*
- [ ] `com.palm.display/*` (status, control getProperty/setProperty/setState). README.md:91-95; `Src/base/DisplayManager.cpp` *Phoenix: a fixed displayOn status only.*
- [ ] `com.palm.ambientLightSensor/control/status`. README.md:26; `Src/base/AmbientLightSensor.cpp`
- [ ] `com.palm.keys/*` (audio, headset, media, switches). README.md:96-99; `Src/base/InputManager.cpp`
- [ ] `com.palm.vibrate/*`. README.md:127-128
- [ ] `com.palm.appDataBackup/*`. README.md:27-28 *Phoenix: preBackup and postRestore under com.palm.sysMgrDataBackup.*

## 12. Boot-time app policy

- [ ] Launch-at-boot (headless, pre-warmed): phone, email, calendar, messaging, camera (base). Pixi adds contacts; TouchPad drops camera; Pre 3 (windsornot) keeps only phone and email. `conf/luna.conf:98-99`; `conf/luna-pixie.conf:30-31`; `conf/luna-topaz.conf:18-19`; `conf/luna-windsornot.conf:18-19`
- [ ] Keep-alive apps: phone (base). TouchPad: email, calendar, messaging, photos, musicplayer. `conf/luna.conf:101-102`; `conf/luna-topaz.conf:21-22`
- [ ] Keep alive until memory pressure: browser (Pixi also camera). `conf/luna.conf:104-105`; `conf/luna-pixie.conf:33-34`
- [ ] Apps allowed in low memory: phone, contacts, messaging. `conf/luna.conf:65`
- [ ] SUC apps with special launch privileges: App Catalog (enyo-findapps), QuickOffice AR, payment app and service. `conf/luna.conf:156-157`
- [ ] Persistent (pre-created, cached) windows: systemui DeviceMenu; phone incoming / incoming-known / incoming-unknown; IME pinyin and hwr. `conf/persistentWindows.conf:18-32`; `Src/lunaui/PersistentWindowCache.cpp`

## 13. System apps in this repo (`sysapps/`)

- [ ] **Voice Dial** (`com.palm.sysapp.voicedial`): hands-free voice dialing, system app with a generic microphone icon. `sysapps/com.palm.sysapp.voicedial/appinfo.json`
- [ ] `sysapps-test/` holds test fixtures only (not user-facing). `sysapps-test/`
- [ ] `com.palm.sysapp.launchermode0`: hidden system app used to switch launcher modes (blacklisted from the launcher). `conf/launcher3/app_blacklist.conf:25`; `Src/base/application/ApplicationManager.cpp:2982`

---

# Apps (outside system UI)

The core apps legacy webOS shipped. Evidence gives where the ID appears in the legacy system UI; "not referenced" means I know
of the app from legacy webOS (**inferred**) but it never names it. The seven apps Palm/HP released as Open webOS (Accounts,
Calculator, Calendar, Clock, Contacts, Email, Memos) run unmodified from `third_party/core-apps` and are checked below; the
others need reimplementation or an alternative for Phoenix.

## Communication
- [ ] **Phone / Dialer** (`com.palm.app.phone`): launch-at-boot, keep-alive, incoming-call popups, active-call banner. `conf/luna.conf:99,102`; `conf/notificationPolicy.conf:20-28`. *Phoenix: `apps/phone` (`org.webosphoenix.phone`) has the dial pad, call log, favourites and in-call screen, the incoming call as a popup alert (`incoming-known` / `incoming-unknown`, Answer / Ignore; answering brings the card up) and an incoming-call banner, against simulated legacy telephony; still missing: launch-at-boot / keep-alive, the lock-screen answer, the active-call banner, conference calls, a real telephony service.* *Phoenix: since then: the lock-screen answer (GAPS K2) and hold / swap of a second call. Still missing: the active-call banner, launch-at-boot / keep-alive, conference calls, a real telephony service.*
- [ ] **Messaging** (SMS/MMS/IM, `com.palm.app.messaging`). `conf/luna.conf:99`; `conf/notificationPolicy.conf:35`. *Phoenix: `apps/messaging` (`org.webosphoenix.messaging`) sends and receives SMS (simulated), with conversations, chat balloons and a contact picker; MMS and IM transports are not done (IM shown as unavailable).*
- [x] **Email** (`com.palm.app.email`, Enyo `com.palm.app.enyo-email` on the TouchPad). `conf/luna.conf:99`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`. No mail server yet (simulated transports).
- [x] **Contacts / Synergy** (`com.palm.app.contacts`, `com.palm.app.enyo-contacts`). `conf/default-launcher-page-layout.json`; `conf/luna.conf:65`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [x] **Calendar** (`com.palm.app.calendar`, `com.palm.app.enyo-calendar`). `conf/luna.conf:99`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [ ] **Agenda view** exhibition (`com.palm.app.agendaview`). `Src/base/application/ApplicationManagerService.cpp:2524`
- [x] **Accounts** (Synergy account manager, `com.palm.app.accounts`). `conf/default-launcher-page-layout.json`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [ ] **Voice Dial** (`com.palm.sysapp.voicedial`). In this repo: `sysapps/`
- [ ] **SIM Toolkit** (`com.palm.app.stk`). `Src/base/SystemUiController.cpp:2014`

## Web and media
- [x] **Web browser** (`com.palm.app.browser`). `conf/luna.conf:105` *Phoenix: HP's Isis browser, unmodified (a native Chromium view in phoenix-sim); see docs/APP-RUNTIME.md. Missing: downloads, printing, and a page view on a device.*
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
- [x] Alarm "ring" popup (the simulated activity manager now fires alarms and launches Clock with its ring params; not yet checked end to end). *Phoenix: checked end to end (tools/test-alarm.cjs): the alarm fires, Clock relaunches and rings as a popup alert.*
- [x] **Tasks** (webOS 1.x; lists synced per account through Synergy, e.g. Exchange's `com.palm.task.eas:1`). Phoenix: `apps/tasks` (`org.webosphoenix.tasks`): lists (Inbox, add, rename, delete), tasks with due date and time, priority, notes, complete (struck through), hide completed, Today / Upcoming / Overdue, reminders through `com.palm.activitymanager` with a notification (tap: Snooze 10 min / Done), Just Type "New Task" and task search; db8 kinds `com.palm.task:1`, `com.palm.tasklist:1`. No account sync yet. See `docs/APP-RUNTIME.md#tasks`
- [x] **Voice Memos** (webOS 2.x, Pre 2 / Pre 3). Not referenced in this repo (**inferred**). Phoenix: `apps/voicememos` (`org.webosphoenix.voicememos`): record with a level meter, pause / resume, list, playback with a scrubber, rename, share, delete, and transcription (whisper.cpp on the device through `org.webosphoenix.transcriber`), searchable in the app and in Just Type. See `docs/APP-RUNTIME.md#voice-memos`
- [x] **PDF View / Doc View** (pre-QuickOffice phone apps). Not referenced in this repo. *Phoenix: `apps/pdfview` and `apps/docview`.*
- [x] **Help** (`com.palm.app.help`). `conf/default-launcher-page-layout.json` *Phoenix: `apps/help` (searchable topics, in Just Type).*
- [ ] **Print Manager** (`com.palm.app.printmanager`). `conf/default-launcher-page-layout.json`
- [x] **File manager** (not shipped by Palm; homebrew from Preware, above all Internalz Pro). Phoenix: `apps/files` (`org.webosphoenix.files`), a clean-room design with Internalz Pro's feature set: browse, sort, hidden files, favourites, multi-select, copy / cut / paste, delete, rename, new folder / file, info, image viewer, text editor, "Open with", .ipk install through `com.palm.appinstaller` (simulated); on the Phoenix service `org.webosphoenix.filemanager`. See `docs/APP-RUNTIME.md#files`

## Store and first use
- [x] **HP App Catalog** (`com.palm.app.enyo-findapps`, older `com.palm.app.findapps`), plus the payment app. *Phoenix: the Marketplace (`apps/marketplace`, `server/marketplace`; no payments), with the App Museum II and Preware as add-on catalogs (docs/APP-RUNTIME.md#marketplace).* `conf/luna.conf:157`; `Src/lunaui/launcher/operationalsettings.cpp:194`
- [x] **First Use / setup wizard** (`com.palm.app.firstuse`). `Src/base/application/ApplicationManager.cpp:2381` *Phoenix: `apps/firstuse`: language, Wi-Fi, date and time, accounts, passcode, privacy, tutorial, restore from backup; Settings > Device Info runs it again.*
- [x] **Software Manager** (`com.palm.app.swmanager`) and **System Updates** (`com.palm.app.updates`). `conf/default-launcher-page-layout.json`. *Phoenix: System Updates is Settings > Updates on `com.palm.update` (Palm's API, kept for luna-systemui's alerts) over RAUC A/B slots; done in the simulator (docs/APP-RUNTIME.md#system-updates).* *Phoenix: System Updates done in the simulator (above); the Software Manager's list of installed apps is the launcher's delete and the Marketplace.*
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
- [ ] Exhibition preferences (`com.palm.app.exhibitionpreferences`)
- [ ] Just Type / search preferences (`com.palm.app.searchpreferences`) *Phoenix: Just Type's Preferences menu item opens nothing yet.*
- [x] Location Services (`com.palm.app.location`) *Phoenix: Settings > Location: on/off, GPS and network, per-app permissions.*
- [x] Language picker (`com.palm.app.languagepicker`): Language & Region (UI and format locales); apps do not localize yet
- [x] Screen & Lock (`com.palm.app.screenlock`): brightness, timeout, rotation lock, wallpaper, notifications when locked, PIN/password (the lock screen asks for it: the ported PIN pad and password panel; not yet locking on timeout)
- [x] Sounds & Ringtones (`com.palm.app.soundsandalerts`): volumes (master, ringer, alerts, system sounds, media), mute, ringtone (Open webOS's ringtone.mp3 and phone.wav, plus /media/internal/ringtones), System sounds, Keyboard clicks
- [x] Text Assist (`com.palm.app.textassist`). *Phoenix: Settings > Text Assist (suggestions, auto-correct, swipe typing, learned words) for the keyboard's candidate bar, swipe typing and dictation (docs/spec/GAPS.md V2, V3).*
- [ ] Certificate Manager (`com.palm.app.certificate`). `ApplicationManagerService.cpp:3822`
- [ ] Phone preferences / Network settings / Power (phone-era prefs apps). Not referenced in this repo. *Phoenix: phone details in Device Info and radios in Airplane Mode; no call forwarding, data / roaming or power panes.*
- [x] Airplane Mode pane (Phoenix addition; on webOS it lived only in the system menu)
- [x] Emergency Info, Accessibility, Developer Mode, Updates, Backup, Text Assist and Location panes (Phoenix additions or moved here; see `apps/settings/src/pages/`)
