# Legacy webOS system-UI feature inventory

Checklist of every user-facing system-UI feature that the Open webOS `luna-sysmgr` source shows evidence of
(<https://github.com/openwebos/luna-sysmgr> at commit `1393f0af`; paths below are relative to it). Tick items off as Phoenix implements them.
The pixel and timing details for each feature are in [`legacy-ui-spec.md`](legacy-ui-spec.md), with section numbers in brackets.

## 1. Card view / multitasking [spec §1]

- [x] Cards for running apps, with maximized and minimized (card view) states. `Src/lunaui/cards/CardWindowManager.cpp:180-246`
- [x] Card **stacks** (groups): cards launched by the focused app stack with it, others open a new stack to the right. `CardWindowManager.cpp:556-599`
- [x] Fanned layout inside the active stack, with tilt and a slight drop; closed stacks sit left and right with a 7 px offset. `Src/lunaui/cards/CardGroup.cpp:699-771`
- [x] Horizontal drag and flick through cards and stacks, snapping to the nearest stack. `CardWindowManager.cpp:1452-1600,1677-1738`
- [x] Flick a card up to close it (velocity/distance rule), or drag it off the top. `CardWindowManager.cpp:63-65,1700-1716`
- [ ] "Angry card": drag a card off the bottom to force-close it (no keep-alive), with an upside-down sound easter egg. `CardWindowManager.cpp:1280-1283,2841-2894`
- [x] Tap a card to maximize it; tap a partly hidden card to scroll the fan instead. `CardWindowManager.cpp:2151-2195`; `CardGroup.cpp:402-470`
- [x] Tap left or right of the stack, or tap-and-hold off a card, to switch stacks. `CardWindowManager.cpp:1648-1661,2176-2188`
- [x] Tap-and-hold to reorder cards within a stack and move them between stacks (20% edge zones). `CardWindowManager.cpp:1835-2101`
- [x] Rounded card corners (shader) and drop shadow. `CardWindow.cpp:2485-2533`; `Src/base/visual/CardDropShadowEffect.cpp`
- [x] Dimming of cards that aren't active (0.8). `CardWindow.cpp:245-255`
- [ ] Loading card: splash icon, pulsing glow and splash background while an app launches. `Src/lunaui/cards/CardLoading.cpp`
- [ ] In-app scene push/pop zoom transition. `Src/lunaui/cards/CardTransition.cpp`
- [ ] Modal cards (320x480 child window over a dimmed parent), via `launchModalApp`/`dismissModalApp`. `CardWindow.cpp:1855-2125`; `Src/base/SystemService.cpp:247-248`
- [ ] Full-screen apps that hide the status bar. `Src/base/SystemUiController.cpp:1389-1400`
- [ ] Card rotation and orientation lock per app (fixed-orientation apps). `CardWindow.cpp:2536-`; `Src/lunaui/cards/CardHostWindow.cpp:180-240`
- [x] Keyboard navigation of cards (←/→, Enter, Ctrl+Backspace). `CardWindowManager.cpp:1189-1212`
- [ ] First-use "dismiss card" tutorial dialog. `CardWindowManager.cpp:1168-1187`; `uiComponents/DismissCardTutorial/dismissDialog.qml`
- [ ] Card limit and low-memory launch blocking, with a low-memory alert dialog. `conf/luna.conf:63-65`; `Src/base/MemoryMonitor.cpp`; `uiComponents/MemoryAlert/alert.qml`
- [ ] Card-view wallpaper, rotated for landscape. `Src/lunaui/WindowServerLuna.cpp:89-156,900-928`
- [ ] Touch-to-Share "ghost card" throw animation and glow. `CardWindowManager.cpp:2915-2957`; `Src/base/visual/TouchToShareGlow.cpp`

## 2. Status bar [spec §2]

- [ ] 28 px status bar: carrier or app title, clock, battery, and signal/connection icons. `Src/lunaui/status-bar/StatusBar.cpp`
- [ ] App-tinted status bar (custom color and title while an app is maximized). `StatusBar.cpp:476-520`
- [ ] Tappable title for the app menu (tablet). `StatusBar.cpp:111-116`
- [ ] Battery gauge with 12 levels, charging variants and error state; "battery full" sound. `StatusBarBattery.cpp`
- [ ] Clock in 12/24 h, following the locale time-format preference. `StatusBarClock.cpp:198-232`
- [ ] Icons: RSSI (GSM / 1x / EV-DO dual), WAN type, Bluetooth, Wi-Fi bars, TTY, HAC, call forwarding, roaming (triangle variant), VPN, rotation lock, mute, airplane mode. `StatusBarInfo.cpp:183-326`
- [ ] Notification icon strip in the status bar (tablet, up to 10). `StatusBarNotificationArea.cpp`; `StatusBar.h:31-32`
- [ ] Phone rounded screen corners. `Src/lunaui/status-bar/MenuWindowManager.cpp:126-146`

## 3. System menu (status-bar drop-down) [spec §3]

- [ ] Long-format date (refreshes every 30 s). `uiComponents/SystemMenu/DateElement.qml`; `Src/lunaui/status-bar/SystemMenu.cpp:63`
- [ ] Battery percentage. `uiComponents/SystemMenu/BatteryElement.qml`
- [ ] Brightness slider (10-100%). `uiComponents/SystemMenu/BrightnessElement.qml`; `SystemMenu.cpp:870-882`
- [ ] Wi-Fi drawer: on/off, network list (signal, lock, checkmark, status), "Wi-Fi Preferences". `uiComponents/SystemMenu/WiFiElement.qml`, `WifiEntry.qml`
- [ ] VPN drawer: profile list and connect. `uiComponents/SystemMenu/VpnElement.qml`, `VpnEntry.qml`
- [ ] Bluetooth drawer: on/off, device list with connect status, "Bluetooth Preferences". `uiComponents/SystemMenu/BluetoothElement.qml`, `BluetoothEntry.qml`; `Src/lunaui/status-bar/BtDeviceClass.cpp`
- [ ] Airplane mode toggle (disables radios, shows progress). `uiComponents/SystemMenu/AirplaneModeElement.qml`; `SystemMenu.qml:68-78`
- [ ] Rotation lock toggle. `uiComponents/SystemMenu/RotationLockElement.qml`
- [ ] Mute toggle. `uiComponents/SystemMenu/MuteElement.qml`
- [ ] Scrollable menu with fade and arrow affordances, closing after a selection. `SystemMenu.qml:289-341`
- [ ] Device menu (phone-era "DeviceMenu" persistent window of `com.palm.systemui`). `conf/persistentWindows.conf:19-21`

## 4. Notifications [spec §4]

- [ ] Banner notifications: scrolling ticker with icon, queueing (5 s alone, 2 s when queued), sounds. `Src/lunaui/notifications/BannerMessageHandler.cpp`
- [ ] Phone: bottom notification bar with dashboard icons; tap to open dashboards upward. `Src/lunaui/notifications/DashboardWindowManager.cpp`; `SystemUiController.cpp:82,1361-1470`
- [ ] Tablet: notification drop-down (320 px) from the status bar. `uiComponents/DashboardMenu/DashboardMenu.qml`; `DashboardWindowManager.cpp:142-170`
- [ ] Dashboards (persistent app mini-windows, 52 px rows) with swipe-to-dismiss, persistent (non-dismissable) variant, and scrolling after 5.5 rows. `Src/lunaui/notifications/DashboardWindowContainer.cpp`
- [ ] Popup alerts (incoming call, alarm, calendar reminder, system alerts) filtered by the policy file. `Src/lunaui/notifications/AlertWindow.cpp`; `conf/notificationPolicy.conf`; `NotificationPolicy.cpp`
- [ ] Transient alerts. `DashboardWindowManager.cpp:183-190`
- [ ] Active-call banner with running call timer. `Src/lunaui/notifications/ActiveCallBanner.cpp`
- [ ] Volume / ringer HUD. `Src/lunaui/notifications/VolumeControlAlertWindow.cpp`
- [ ] QML alert windows (generic system dialogs). `Src/lunaui/notifications/QmlAlertWindow.cpp`; `uiComponents/MessageDialog/MessageDialog.qml`
- [ ] Native alert manager (low-level system alerts, e.g. low battery). `Src/lunaui/notifications/NativeAlertManager.cpp`
- [ ] LED notification throbber and blink-notifications preferences. `conf/defaultPreferences.txt` (`LEDThrobberEnabled`, `BlinkNotifications`); `Src/base/CoreNaviLeds.cpp`
- [ ] "Show alerts when locked" preference. `conf/defaultPreferences.txt` (`showAlertsWhenLocked`)

## 5. Launcher, quick launch and search [spec §5]

- [ ] Full-screen launcher sliding up over cards, with tabbed pages (apps, downloads, settings, favorites). `Src/lunaui/launcher/dimensionslauncher.cpp`; `conf/default-launcher-page-layout.json`
- [ ] Vertical scroll within a page; tabs across the top. `Src/lunaui/launcher/elements/bars/pagetabbar.cpp`; `elements/page/page.cpp`
- [ ] Alphabetical page layout with letter dividers. `elements/page/icon_layouts/alphabeticonlayout.cpp`
- [ ] Reorder mode: tap-and-hold to drag icons, move them between pages (edge dwell), Done button. `elements/page/icon_layouts/reorderableiconlayout.cpp`; `dimensionslauncher.cpp`
- [ ] Delete/remove badges on icons (uninstall user apps, remove launch points). `elements/icons/iconheap.cpp:35-39`
- [ ] App info dialog (version, size, remove). `uiComponents/AppInfoDialog/AppInfoDialog.qml`
- [ ] Install progress and error badges on icons. `elements/icons/iconheap.cpp:44-51`; `Src/base/application/ApplicationInstaller.cpp`
- [ ] Launch feedback (touch highlight, 3 s timeout). `Src/lunaui/launcher/OverlayWindowManager.cpp:2018-2030`
- [ ] Quick-launch bar (dock) of up to 5 apps, plus a launcher button; drag to reorder, drag in from the launcher. `elements/bars/quicklaunchbar.cpp`; `QuicklaunchLayout.cpp`
- [ ] Quick-launch "wave" (swipe up and hold). `OverlayWindowManager.cpp:1000-1011`
- [ ] Search pill in card view. `OverlayWindowManager.cpp:1150-1177`
- [ ] **Just Type** / universal search: typing in card view opens search (the `com.palm.launcher` web app); web search providers. `OverlayWindowManager.cpp:971-995`; `conf/defaultPreferences.txt` (`webSearchList`)
- [ ] App blacklist (hidden system apps) and keyword → page mapping. `conf/launcher3/app_blacklist.conf`; `conf/launcher3/app-keywords-to-designator-map.txt`
- [ ] Launch points (multiple per app, custom launch points added by apps). `Src/base/application/LaunchPoint.cpp`; README `addLaunchPoint`
- [ ] Launcher and dock position persistence. `Src/lunaui/launcher/systeminterface/pagesaver.cpp`, `pagerestore.cpp`; `Src/base/settings/Settings.cpp:161-165`
- [ ] Empty-page hint. `Src/lunaui/launcher/elements/page/reorderablepage.cpp:64`

## 6. Lock screen and security [spec §6]

- [ ] Lock screen with large bitmap clock, status bar with date, and wallpaper. `Src/lunaui/lockscreen/LockWindow.cpp`; `ClockWindow.cpp`
- [ ] Drag-up padlock to unlock (146 px radius). `LockWindow.cpp:1801-1860`
- [ ] Incoming call on the lock screen: "Drag up to answer". `LockWindow.cpp:95-96,2333-2335`
- [ ] Notifications on the lock screen (dashboards, banners, popups). `LockWindow.cpp:2595-2860`
- [ ] PIN pad unlock. `uiComponents/UnlockPanel/PINPad.qml`
- [ ] Password unlock (hardware or virtual keyboard). `uiComponents/UnlockPanel/PasswordField.qml`
- [ ] Last-try warning and "set new PIN" dialogs (EAS policy). `Src/lunaui/lockscreen/LockWindow.h:129-137`; `Src/base/EASPolicyManager.cpp`
- [ ] Device passcode service (`setDevicePasscode`, `matchDevicePasscode`, `getDeviceLockMode`, `getSecurityPolicy`). `Src/base/SystemService.cpp:218-222`; `Src/base/Security.cpp`
- [ ] Lock timeout preference; auto-lock on display off. `Src/base/DisplayManager.cpp`; `conf/defaultPreferences.txt` (`lockTimeout`)
- [ ] Full Erase key chord with countdown confirmation. `Src/lunaui/FullEraseConfirmationWindow.cpp`; `Src/lunaui/WindowServerLuna.cpp:1240-1276`

## 7. Navigation: gesture area, home button, light bar [spec §7]

- [ ] Back gesture. `SystemUiController.cpp:424-443`
- [ ] Up-swipe to card view / launcher toggle. `SystemUiController.cpp:445-497`
- [ ] Down-swipe to re-maximize the active card. `SystemUiController.cpp:499-526`
- [ ] Optional advanced gestures: previous/next app (full-width swipe). `SystemUiController.cpp:308-315,394-408`; `Src/base/settings/Preferences.cpp:66,598-604`
- [ ] Meta key (gesture-area hold) for copy/cut/paste/select-all. `Src/base/MetaKeyManager.cpp`; `SystemUiController.cpp:180-184`
- [ ] Home button: minimize, launcher toggle, double-press. `SystemUiController.cpp:528-584`
- [ ] TouchPad bezel edge-flick. `SystemUiController.cpp:2041-2121`; `Src/base/gesture/ScreenEdgeFlickGestureRecognizer.cpp`
- [ ] Light-bar / CoreNavi LED gesture feedback. `Src/base/CoreNaviManager.cpp`; `Src/base/CoreNaviLeds.cpp`
- [ ] Screenshot (Home + Power) and the `takeScreenShot` service, with a screenshot flash animation. `Src/base/WindowServer.cpp:629-683`; `Src/base/visual/WSOverlayScreenShotAnimation.cpp`
- [ ] Touch reticle (tap ripple). `Src/base/visual/ReticleItem.cpp`
- [ ] Bluetooth keyboard shortcuts (Esc for dashboard, Search for Just Type, Super for card view, Keyboard key for the IME). `SystemUiController.cpp:338-343,586-624`

## 8. Input [spec §8]

- [ ] Virtual keyboard (plugin) with show/hide, phone and tablet art. `Src/ime/*`; `images/keyboard-phone/`, `images/keyboard-tablet/`
- [ ] Keyboard layouts and languages preference (QWERTY/AZERTY/QWERTZ). `Src/ime/VirtualKeyboardPreferences.cpp`
- [ ] IME variants: pinyin and handwriting (persistent windows). `conf/persistentWindows.conf:28-31`
- [ ] Hardware keyboard slider support (Pre, Veer): keyboard-open events, slider unlock timeouts. `Src/base/settings/DeviceInfo.cpp:212-275`; `Src/base/DisplayManager.cpp:110-113`
- [ ] Text-assist prefs: spell check, autocorrect, shortcuts. `conf/defaultPreferences.txt` (`x_palm_textinput`)

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
- [ ] Emergency (full-screen call) mode. `Src/lunaui/emergency/EmergencyWindowManager.cpp`
- [ ] Boot and shutdown sounds, charging sounds, and the system sound set. `sounds/`; `Src/base/settings/Settings.cpp:103-107`
- [ ] Ringtone, alert tone and notification tone preferences. `conf/defaultPreferences.txt`
- [ ] Wallpaper preference, plus a separate dock wallpaper. `conf/defaultPreferences.txt`; `Src/base/settings/Preferences.cpp` (`dockwallpaper`)
- [ ] Auto-brightness (ambient light sensor), brightness scales, display timeout and dimming. `Src/base/AmbientLightSensor.cpp`; `Src/base/DisplayManager.cpp:95-115`; `conf/luna.conf:49-53`
- [ ] UI rotation driven by the accelerometer, with rotation lock. `Src/base/WindowServer.cpp:1900-1960`; `conf/luna.conf:121`
- [ ] Haptics / vibration (`vibrate`, `vibrateNamedEffect`). `Src/base/HapticsController.cpp`; README.md:127-128
- [ ] Headset, audio, media and ringer switch keys (`com.palm.keys/*`). README.md:96-99
- [ ] Locale, region, time zone and network time preferences. `conf/defaultPreferences.txt`; `conf/locale.txt`; `conf/timezone.txt`
- [ ] Backup and restore hooks (`preBackup` / `postRestore`). `Src/base/BackupManager.cpp`; README.md:27-28
- [ ] Turbo-mode (CPU boost) subscription. `Src/base/SystemService.cpp:249`
- [ ] FPS counter / touch plot debugging overlays. `Src/base/SystemService.cpp:238-239`; `Src/base/visual/TouchPlot.cpp`

## 11. Services LunaSysMgr exposes (README.md:24-128)

- [ ] `com.palm.applicationManager/*`: launch, open, close, running, listApps, launch points (add/remove/list/update icon), dock-mode launch points, MIME / URL / redirect / resource handler registry, searchApps, install, rescan, getAppInfo, getSizeOfApps. README.md:38-90; `Src/base/application/ApplicationManagerService.cpp`
- [ ] `com.palm.appinstaller/*`: install, installNoVerify, remove, revoke, isInstalled, installProgressQuery, notifyOnChange, queryInstallCapacity, getUserInstalledAppSizes. README.md:29-37; `Src/base/application/ApplicationInstaller.cpp`
- [ ] `com.palm.systemmanager/*`: systemUi (launcher, quick launch, universal search, VK control, app menu), publish/subscribeToSystemUI, getForegroundApplication, applicationHasBeenTerminated, getLockStatus, getDockModeStatus, lockButtonTriggered, passcode methods, getBootStatus, runProgressAnimation, takeScreenShot, launchModalApp/dismissModalApp, get/setAnimationValues, touchToShare*, subscribeTurboMode, clearCache, getAppRestoreNeeded, getSystemStatus, setJavascriptFlags. README.md:100-126; `Src/base/SystemService.cpp:209-250`
- [ ] `com.palm.display/*` (status, control getProperty/setProperty/setState). README.md:91-95; `Src/base/DisplayManager.cpp`
- [ ] `com.palm.ambientLightSensor/control/status`. README.md:26; `Src/base/AmbientLightSensor.cpp`
- [ ] `com.palm.keys/*` (audio, headset, media, switches). README.md:96-99; `Src/base/InputManager.cpp`
- [ ] `com.palm.vibrate/*`. README.md:127-128
- [ ] `com.palm.appDataBackup/*`. README.md:27-28

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
- [ ] **Phone / Dialer** (`com.palm.app.phone`): launch-at-boot, keep-alive, incoming-call popups, active-call banner. `conf/luna.conf:99,102`; `conf/notificationPolicy.conf:20-28`. *Phoenix: `apps/phone` (`org.webosphoenix.phone`) has the dial pad, call log, favourites, in-call and incoming-call screens and an incoming-call banner, against simulated legacy telephony; still missing: launch-at-boot / keep-alive, the lock-screen answer, the active-call banner, conference calls, a real telephony service.*
- [ ] **Messaging** (SMS/MMS/IM, `com.palm.app.messaging`). `conf/luna.conf:99`; `conf/notificationPolicy.conf:35`. *Phoenix: `apps/messaging` (`org.webosphoenix.messaging`) sends and receives SMS (simulated), with conversations, chat balloons and a contact picker; MMS and IM transports are not done (IM shown as unavailable).*
- [x] **Email** (`com.palm.app.email`, Enyo `com.palm.app.enyo-email` on the TouchPad). `conf/luna.conf:99`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`. No mail server yet (simulated transports).
- [x] **Contacts / Synergy** (`com.palm.app.contacts`, `com.palm.app.enyo-contacts`). `conf/default-launcher-page-layout.json`; `conf/luna.conf:65`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [x] **Calendar** (`com.palm.app.calendar`, `com.palm.app.enyo-calendar`). `conf/luna.conf:99`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [ ] **Agenda view** exhibition (`com.palm.app.agendaview`). `Src/base/application/ApplicationManagerService.cpp:2524`
- [x] **Accounts** (Synergy account manager, `com.palm.app.accounts`). `conf/default-launcher-page-layout.json`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [ ] **Voice Dial** (`com.palm.sysapp.voicedial`). In this repo: `sysapps/`
- [ ] **SIM Toolkit** (`com.palm.app.stk`). `Src/base/SystemUiController.cpp:2014`

## Web and media
- [ ] **Web browser** (`com.palm.app.browser`). `conf/luna.conf:105`
- [x] **Camera** (`com.palm.app.camera`). `conf/luna.conf:99`. Phoenix: `apps/camera` (viewfinder, photo and video, flash, last shot opens Photos; no zoom, timer or geotags yet)
- [x] **Photos & Videos** (`com.palm.app.photos`, plus `com.palm.app.videoplayer`). `conf/luna-topaz.conf:22`; `ApplicationManagerService.cpp:3836`. Phoenix: `apps/photos` (albums, grid, swipe viewer, share, delete, set as wallpaper, video playback; no slideshow, pinch zoom or online albums yet)
- [x] **Music** (`com.palm.app.musicplayer`, `com.palm.app.streamingmusicplayer`). `conf/luna-topaz.conf:22`; `ApplicationManagerService.cpp:4495`. Phoenix: `apps/music` (artists, albums, songs, now playing, seek, volume, shuffle/repeat, banner; no playlists, genres or dashboard controls yet)
- [ ] **YouTube** (`com.palm.app.youtube`), **Amazon MP3** (`com.palm.app.amazonmp3`), **Kindle** (`com.palm.app.kindle`), **Facebook** (`com.palm.app.enyo-facebook`). `conf/default-launcher-page-layout.json`
- [ ] **Maps** (`com.palm.app.maps`; Bing/Google Maps). `conf/default-launcher-page-layout.json`

## Productivity
- [x] **Memos / Notes** (`com.palm.app.notes`). `conf/default-launcher-page-layout.json`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [ ] **QuickOffice** viewer / editor (`com.quickoffice.webos`, `com.quickoffice.ar`). `conf/default-launcher-page-layout.json`
- [x] **Calculator** (`com.palm.calculator`; Open webOS `com.palm.app.calculator`). `Src/base/application/ApplicationDescription.cpp:1119`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [x] **Clock / alarms** (`com.palm.app.clock`). `conf/notificationPolicy.conf:26`. Runs as the original Open webOS app (`third_party/core-apps`), phone and tablet; see `docs/APP-RUNTIME.md`.
- [ ] Alarm "ring" popup (needs the activity manager to fire alarms).
- [ ] **Tasks**. Not referenced in this repo.
- [ ] **PDF View / Doc View** (pre-QuickOffice phone apps). Not referenced in this repo.
- [ ] **Help** (`com.palm.app.help`). `conf/default-launcher-page-layout.json`
- [ ] **Print Manager** (`com.palm.app.printmanager`). `conf/default-launcher-page-layout.json`

## Store and first use
- [ ] **HP App Catalog** (`com.palm.app.enyo-findapps`, older `com.palm.app.findapps`), plus the payment app. `conf/luna.conf:157`; `Src/lunaui/launcher/operationalsettings.cpp:194`
- [ ] **First Use / setup wizard** (`com.palm.app.firstuse`). `Src/base/application/ApplicationManager.cpp:2381`
- [ ] **Software Manager** (`com.palm.app.swmanager`) and **System Updates** (`com.palm.app.updates`). `conf/default-launcher-page-layout.json`. *Phoenix: Settings > Updates is a stub (version + check button); no OTA yet.*
- [ ] **Backup** (`com.palm.app.backup`). `conf/default-launcher-page-layout.json`

## Settings apps (launcher "Settings" page, `conf/default-launcher-page-layout.json:29-51`)

Phoenix rebuilds these as one React app, `apps/settings` (`org.webosphoenix.settings`), with one launcher
icon and card per pane (launch points). Checked items work in the simulator against simulated OSE services;
none has run on a device yet. See `docs/APP-RUNTIME.md`.

- [x] Wi-Fi (`com.palm.app.wifi`): on/off, network list, join with password, join other network, forget
- [x] Bluetooth (`com.palm.app.bluetooth`): on/off, search, pair, forget (no per-profile connect yet)
- [ ] VPN (`com.palm.app.vpn`)
- [x] Date & Time (`com.palm.app.dateandtime`): 12/24 hour, network time and time zone, zone picker, manual date/time
- [x] Device Info (`com.palm.app.deviceinfo`): device, software, battery, storage, memory, licenses, reset options
- [ ] Exhibition preferences (`com.palm.app.exhibitionpreferences`)
- [ ] Just Type / search preferences (`com.palm.app.searchpreferences`)
- [ ] Location Services (`com.palm.app.location`)
- [x] Language picker (`com.palm.app.languagepicker`): Language & Region (UI and format locales); apps do not localize yet
- [x] Screen & Lock (`com.palm.app.screenlock`): brightness, timeout, rotation lock, wallpaper, notifications when locked, PIN/password (the lock screen does not ask for it yet)
- [x] Sounds & Ringtones (`com.palm.app.soundsandalerts`): volumes, mute, ringtone (no sound files yet), touch sounds
- [ ] Text Assist (`com.palm.app.textassist`)
- [ ] Certificate Manager (`com.palm.app.certificate`). `ApplicationManagerService.cpp:3822`
- [ ] Phone preferences / Network settings / Power (phone-era prefs apps). Not referenced in this repo.
- [x] Airplane Mode pane (Phoenix addition; on webOS it lived only in the system menu)
