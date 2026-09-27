# Legacy webOS asset inventory (luna-sysmgr `images/` and `sounds/`)

Generated from <https://github.com/openwebos/luna-sysmgr> (commit `1393f0af`) (Open webOS luna-sysmgr) by parsing PNG IHDR headers (`struct.unpack('>II', hdr[16:24])`) and WAV RIFF headers. MP3 durations are estimated from file size at the 128 kbps CBR bitrate reported by `file`.

**Licensing note.** Every source and conf file in the repo carries an Apache-2.0 header (`Copyright (c) 2008-2013 LG Electronics, Inc.`, see `README.md:168-185`), and the README states "All content ... except otherwise noted" is Apache-2.0, which covers these binary assets. Apache-2.0 section 6 does **not** grant trademark rights, so anything that is an HP or Palm mark, or that shows HP/Palm hardware trade dress, is marked **NO**. Items marked **review** are product-identifying sounds that we should replace anyway. "yes" means generic UI chrome that we can reuse, keeping attribution and a NOTICE file.

Column "used by" lists the files that reference the asset's basename. A dash means the basename isn't referenced directly. It may be built at runtime (for example `battery-%d.png`, `wifi-" + n + ".png"`, `dockmode/time/...` directory prefixes) or it's unused.


## `images/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `activity-indicator-32x32.png` | 13044 | 32x384 | yes | - |  |
| `activity-progress.png` | 20980 | 76x1320 | yes | `Src/base/BootupAnimation.cpp` |  |
| `activity-spinner.png` | 3079 | 22x220 | yes | `Src/base/BootupAnimation.cpp` |  |
| `activity-static.png` | 2991 | 76x66 | yes | `Src/base/BootupAnimation.cpp` |  |
| `back-button.png` | 2796 | 320x100 | yes | - |  |
| `bell_off.png` | 4140 | 48x48 | yes | `Src/lunaui/notifications/VolumeControlAlertWindow.cpp` |  |
| `card-shadow-tile.png` | 5094 | 87x87 | yes | `Src/base/visual/CardDropShadowEffect.cpp` |  |
| `dashboard-mask-bottom.png` | 950 | 5x8 | yes | `Src/lunaui/notifications/DashboardWindowContainer.cpp` |  |
| `dashboard-mask-top.png` | 953 | 5x8 | yes | `Src/lunaui/notifications/DashboardWindowContainer.cpp` |  |
| `dashboard-scroll-fade.png` | 586 | 320x29 | yes | `Src/lunaui/lockscreen/LockWindow.cpp` |  |
| `default-app-icon.png` | 6449 | 64x64 | yes | `Src/base/application/LaunchPoint.cpp` |  |
| `dock-item-shadow-tile.png` | 2982 | 17x17 | yes | - |  |
| `empty-launcher.png` | 12872 | 120x120 | yes | - |  |
| `fade-arrow-down.png` | 784 | 24x24 | yes | - |  |
| `fsck-usb.png` | 116240 | 768x768 | NO | `Src/base/ProgressAnimation.cpp` | depicts HP TouchPad hardware (trade dress) |
| `fullscreen-play-button.png` | 19049 | 100x200 | yes | `Src/lunaui/cards/CardHostWindow.cpp` |  |
| `glow-bg.png` | 231464 | 768x768 | yes | `Src/base/ProgressAnimation.cpp` |  |
| `hp-logo-bright.png` | 11431 | 200x200 | NO | `Src/base/BootupAnimation.cpp`, `Src/base/ProgressAnimation.cpp` | HP logo (trademark) |
| `hp-logo.png` | 7992 | 200x200 | NO | `Src/base/BootupAnimation.cpp`, `Src/base/ProgressAnimation.cpp`, `Src/base/WindowServer.cpp` | HP logo (trademark) |
| `loading-bg.png` | 431416 | 768x1024 | yes | `Src/lunaui/cards/CardLoading.cpp` |  |
| `loading-card-scrim.png` | 38026 | 320x452 | yes | - |  |
| `loading-glow.png` | 25916 | 228x228 | yes | `Src/lunaui/dock/DockModeWindow.cpp`, `Src/lunaui/cards/CardLoading.cpp` |  |
| `loading-strip.png` | 7424 | 32x608 | yes | `Src/base/SystemUiController.cpp`, `Src/lunaui/launcher/elements/icons/iconheap.cpp` |  |
| `menu-arrow-down.png` | 1387 | 21x21 | yes | `Src/lunaui/notifications/DashboardWindowContainer.cpp`, `uiComponents/MenuContainer/MenuContainer.qml`, `uiComponents/SystemMenu/SystemMenu.qml` |  |
| `menu-arrow-up.png` | 1417 | 21x21 | yes | `Src/lunaui/notifications/DashboardWindowContainer.cpp`, `uiComponents/MenuContainer/MenuContainer.qml`, `uiComponents/SystemMenu/SystemMenu.qml` |  |
| `menu-divider.png` | 1002 | 10x2 | yes | `Src/lunaui/dock/DockModeAppMenuContainer.cpp`, `Src/lunaui/notifications/DashboardWindowContainer.cpp`, `Src/lunaui/lockscreen/LockWindow.cpp` (+1) |  |
| `menu-dropdown-bg.png` | 1343 | 80x160 | yes | `Src/lunaui/notifications/DashboardWindowContainer.cpp`, `uiComponents/MenuContainer/MenuContainer.qml`, `uiComponents/SystemMenu/SystemMenu.qml` |  |
| `menu-dropdown-scrollfade-bottom.png` | 1172 | 60x30 | yes | `Src/lunaui/notifications/DashboardWindowContainer.cpp`, `uiComponents/MenuContainer/MenuContainer.qml`, `uiComponents/SystemMenu/SystemMenu.qml` |  |
| `menu-dropdown-scrollfade-top.png` | 1083 | 60x30 | yes | `Src/lunaui/notifications/DashboardWindowContainer.cpp`, `uiComponents/MenuContainer/MenuContainer.qml`, `uiComponents/SystemMenu/SystemMenu.qml` |  |
| `menu-dropdown-swipe-bg.png` | 1242 | 57x54 | yes | `Src/lunaui/notifications/DashboardWindowContainer.cpp` |  |
| `menu-dropdown-swipe-highlight.png` | 999 | 1x54 | yes | `Src/lunaui/notifications/DashboardWindowContainer.cpp` |  |
| `menu-selection-gradient-default.png` | 1070 | 40x55 | yes | `Src/lunaui/dock/DockModeAppMenuContainer.cpp`, `uiComponents/SystemMenu/MenuListEntry.qml` |  |
| `menu-selection-gradient-last.png` | 1293 | 40x55 | yes | `uiComponents/SystemMenu/MenuListEntry.qml` |  |
| `meta-move.png` | 1447 | 34x34 | yes | - |  |
| `normal-bg.png` | 221323 | 768x768 | yes | `Src/base/ProgressAnimation.cpp`, `Src/lunaui/lockscreen/TopLevelWindowManager.cpp` |  |
| `normal-usb.png` | 115642 | 768x768 | NO | `Src/base/ProgressAnimation.cpp`, `Src/lunaui/lockscreen/TopLevelWindowManager.cpp` | depicts HP TouchPad hardware (trade dress) |
| `notification-music-indicator.png` | 13653 | 160x480 | yes | `Src/lunaui/notifications/VolumeControlAlertWindow.cpp` |  |
| `notification-ringtone-indicator.png` | 13531 | 160x480 | yes | `Src/lunaui/notifications/VolumeControlAlertWindow.cpp` |  |
| `notification-volume-indicator.png` | 11756 | 160x480 | yes | `Src/lunaui/notifications/VolumeControlAlertWindow.cpp` |  |
| `overlay-banner-bg.png` | 168 | 1x28 | yes | - |  |
| `penindicator-ripple.png` | 9613 | 66x67 | yes | `Src/base/visual/ReticleItem.cpp` |  |
| `popup-bg.png` | 2927 | 80x160 | yes | `Src/lunaui/lockscreen/LockWindow.cpp`, `Src/lunaui/GraphicsItemContainer.cpp`, `uiComponents/AppInfoDialog/AppInfoDialog.qml` (+2) |  |
| `popup-scrollfade-bottom.png` | 1218 | 60x30 | yes | - |  |
| `quick_launch_highlight.png` | 4746 | 64x64 | yes | - |  |
| `reorder-ripple.png` | 22700 | 180x180 | yes | - |  |
| `screen-lock-clock-0.png` | 4608 | 50x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-1.png` | 1867 | 38x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-2.png` | 3900 | 49x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-3.png` | 4983 | 49x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-4.png` | 3116 | 54x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-5.png` | 4129 | 49x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-6.png` | 4600 | 51x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-7.png` | 2854 | 48x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-8.png` | 5453 | 49x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-9.png` | 4700 | 51x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-colon.png` | 1684 | 20x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-clock-decimal.png` | 944 | 20x80 | yes | `Src/lunaui/lockscreen/ClockWindow.cpp` |  |
| `screen-lock-incoming-call-off.png` | 9323 | 100x100 | yes | `Src/lunaui/lockscreen/LockWindow.cpp` |  |
| `screen-lock-incoming-call-on.png` | 14020 | 100x100 | yes | `Src/lunaui/lockscreen/LockWindow.cpp` |  |
| `screen-lock-padlock-off.png` | 8081 | 100x100 | yes | `Src/lunaui/lockscreen/LockWindow.cpp` |  |
| `screen-lock-padlock-on.png` | 13919 | 100x100 | yes | `Src/lunaui/lockscreen/LockWindow.cpp` |  |
| `screen-lock-target-scrim.png` | 27555 | 320x190 | yes | `Src/lunaui/lockscreen/LockWindow.cpp` |  |
| `screen-lock-wallpaper-mask-bottom.png` | 267 | 10x250 | yes | `Src/lunaui/lockscreen/LockWindow.cpp` |  |
| `screen-lock-wallpaper-mask-top.png` | 886 | 320x117 | yes | `Src/lunaui/lockscreen/LockWindow.cpp` |  |
| `scrim.png` | 71103 | 320x480 | yes | `Src/base/settings/Settings.cpp`, `Src/lunaui/dock/DockModeLaunchPoint.cpp`, `Src/lunaui/cards/CardHostWindow.cpp` (+1) |  |
| `search-bottom-fade.png` | 192 | 1x32 | yes | - |  |
| `search-icon-disabled.png` | 2362 | 32x32 | yes | - |  |
| `search-pill-no-icon.png` | 1737 | 320x48 | yes | - |  |
| `search-pill.png` | 4962 | 320x48 | yes | - |  |
| `spinner.png` | 1419 | 32x32 | yes | `Src/base/BootupAnimation.cpp`, `Src/lunaui/status-bar/SystemMenu.cpp` |  |
| `transient-alart-bg.png` | 1375 | 80x80 | yes | `Src/lunaui/GraphicsItemContainer.cpp` |  |
| `warning-icon.png` | 1405 | 32x32 | yes | `Src/base/SystemUiController.cpp`, `Src/lunaui/launcher/elements/icons/iconheap.cpp` |  |
| `warning-system.png` | 6698 | 128x128 | yes | `Src/lunaui/FullEraseConfirmationWindow.cpp` |  |
| `wm-corner-bottom-left.png` | 325 | 24x24 | yes | `Src/base/visual/RoundedCorners.cpp` |  |
| `wm-corner-bottom-right.png` | 335 | 24x24 | yes | `Src/base/visual/RoundedCorners.cpp` |  |
| `wm-corner-top-left.png` | 335 | 24x24 | yes | `Src/base/visual/RoundedCorners.cpp` |  |
| `wm-corner-top-right.png` | 343 | 24x24 | yes | `Src/base/visual/RoundedCorners.cpp` |  |

## `images/dockmode/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `dock-loading-glow.png` | 42934 | 320x480 | yes | `Src/lunaui/dock/DockModeWindow.cpp` |  |
| `dropdown-bg-row-highlight.png` | 1111 | 10x70 | yes | - |  |
| `dropdown-bg-row.png` | 1028 | 10x70 | yes | - |  |
| `time-icon-48x48.png` | 4404 | 48x48 | yes | `Src/lunaui/dock/DockModeClock.cpp` |  |

## `images/dockmode/time/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `clock_bg.png` | 333287 | 1024x768 | yes | `uiComponents/DockModeTime/Clocks.qml` |  |

## `images/dockmode/time/analog/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `base.png` | 59908 | 488x488 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |
| `hour.png` | 2398 | 30x488 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |
| `minute.png` | 2467 | 30x488 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |
| `second.png` | 3165 | 30x488 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |

## `images/dockmode/time/analog/glass/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `base.png` | 140741 | 508x508 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |
| `hour.png` | 8998 | 508x508 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |
| `minute.png` | 11085 | 508x508 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |

## `images/dockmode/time/analog/matte/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `base.png` | 55581 | 488x488 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |
| `hour.png` | 2430 | 30x488 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |
| `minute.png` | 2467 | 30x488 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |
| `second.png` | 3159 | 30x488 | yes | `uiComponents/DockModeTime/AnalogClock.qml` |  |

## `images/dockmode/time/digital/landscape/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `dots.png` | 1381 | 28x249 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |
| `flippers-date-mask.png` | 1752 | 70x104 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |
| `flippers-date.png` | 5067 | 70x104 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |
| `flippers-time-mask.png` | 2921 | 178x249 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |
| `flippers-time.png` | 24837 | 178x249 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |

## `images/dockmode/time/digital/portrait/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `Divider-Date.png` | 1117 | 60x88 | yes | - |  |
| `divider.png` | 1392 | 150x209 | yes | `Src/lunaui/dock/DockModeAppMenuContainer.cpp`, `Src/lunaui/launcher/elements/page/icon_layouts/alphabeticonlayout.cpp`, `Src/lunaui/launcher/elements/bars/pagetabbar.cpp` (+3) |  |
| `dots.png` | 1296 | 29x209 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |
| `flippers-date-mask.png` | 1506 | 60x88 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |
| `flippers-date.png` | 3484 | 60x88 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |
| `flippers-time-mask.png` | 2377 | 150x209 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |
| `flippers-time.png` | 14818 | 150x209 | yes | `uiComponents/DockModeTime/DigitalClock.qml` |  |

## `images/dockmode/time/indicator/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `off.png` | 996 | 8x8 | yes | `Src/lunaui/notifications/VolumeControlAlertWindow.cpp`, `Src/lunaui/lockscreen/LockWindow.cpp`, `uiComponents/SystemMenu/AirplaneModeElement.qml` (+2) |  |
| `on.png` | 993 | 8x8 | yes | `Src/base/SystemUiController.cpp`, `Src/base/application/ApplicationManagerService.cpp`, `Src/base/application/LaunchPoint.cpp` (+6) |  |

## `images/keyboard-phone/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `drag-handle.png` | 1168 | 30x30 | yes | - |  |
| `drag-highlight.png` | 1001 | 20x3 | yes | - |  |
| `icon-delete.png` | 2008 | 50x38 | yes | `uiComponents/UnlockPanel/PINPad.qml` |  |
| `icon-hide-keyboard.png` | 1599 | 50x44 | yes | - |  |
| `icon-shift-lock.png` | 1255 | 50x50 | yes | - |  |
| `icon-shift-on.png` | 1314 | 50x50 | yes | - |  |
| `icon-shift.png` | 1316 | 50x50 | yes | - |  |
| `key-black.png` | 3264 | 48x96 | yes | - |  |
| `key-gray.png` | 3264 | 48x96 | yes | - |  |
| `key-shift-lock.png` | 3264 | 48x96 | yes | - |  |
| `key-shift-on.png` | 3264 | 48x96 | yes | - |  |
| `key-white.png` | 2893 | 48x96 | yes | - |  |
| `keyboard-bg.png` | 164 | 3x200 | yes | - |  |
| `popup-bg-2.png` | 3933 | 100x150 | yes | - |  |
| `popup-bg.png` | 3755 | 100x90 | yes | `Src/lunaui/lockscreen/LockWindow.cpp`, `Src/lunaui/GraphicsItemContainer.cpp`, `uiComponents/AppInfoDialog/AppInfoDialog.qml` (+2) |  |
| `popup-key.png` | 2563 | 80x120 | yes | - |  |

## `images/keyboard-tablet/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `drag-handle.png` | 1168 | 30x30 | yes | - |  |
| `drag-highlight.png` | 1001 | 20x3 | yes | - |  |
| `icon-delete.png` | 2008 | 50x38 | yes | `uiComponents/UnlockPanel/PINPad.qml` |  |
| `icon-hide-keyboard.png` | 1599 | 50x44 | yes | - |  |
| `icon-shift-lock.png` | 1255 | 50x50 | yes | - |  |
| `icon-shift-on.png` | 1314 | 50x50 | yes | - |  |
| `icon-shift.png` | 1316 | 50x50 | yes | - |  |
| `key-black.png` | 2409 | 93x140 | yes | - |  |
| `key-gray-short.png` | 2353 | 93x110 | yes | - |  |
| `key-gray.png` | 2651 | 93x140 | yes | - |  |
| `key-shift-lock.png` | 4206 | 93x140 | yes | - |  |
| `key-shift-on.png` | 3736 | 93x140 | yes | - |  |
| `key-white.png` | 2775 | 93x140 | yes | - |  |
| `keyboard-bg.png` | 221 | 3x340 | yes | - |  |
| `popup-bg-2.png` | 3933 | 100x150 | yes | - |  |
| `popup-bg.png` | 3755 | 100x90 | yes | `Src/lunaui/lockscreen/LockWindow.cpp`, `Src/lunaui/GraphicsItemContainer.cpp`, `uiComponents/AppInfoDialog/AppInfoDialog.qml` (+2) |  |
| `popup-key.png` | 2563 | 80x120 | yes | - |  |

## `images/launcher3/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `dark-arrow-left.png` | 1510 | 25x35 | yes | - |  |
| `dark-arrow-right.png` | 1506 | 25x35 | yes | - |  |
| `edit-button-delete.png` | 4410 | 40x80 | yes | `Src/lunaui/launcher/elements/icons/iconheap.cpp` |  |
| `edit-button-done.png` | 2512 | 100x80 | yes | `Src/lunaui/launcher/dimensionslauncher.cpp` |  |
| `edit-button-remove.png` | 3765 | 40x80 | yes | `Src/lunaui/launcher/elements/icons/iconheap.cpp` |  |
| `edit-icon-bg-light.png` | 1961 | 128x128 | yes | - |  |
| `edit-icon-bg-small-light.png` | 2578 | 100x100 | yes | - |  |
| `edit-icon-bg-small.png` | 2808 | 100x100 | yes | - |  |
| `edit-icon-bg.png` | 2056 | 128x128 | yes | `Src/lunaui/launcher/elements/icons/iconheap.cpp` |  |
| `launcher-bg.png` | 31546 | 180x180 | yes | `Src/lunaui/launcher/dimensionslauncher.cpp` |  |
| `launcher-bg64.png` | 12503 | 64x64 | yes | - |  |
| `launcher-empty-page.png` | 9041 | 280x220 | yes | `Src/lunaui/launcher/elements/page/reorderablepage.cpp` |  |
| `launcher-icon-64.png` | 5560 | 64x64 | yes | - |  |
| `launcher-icon-72.png` | 6150 | 72x72 | yes | - |  |
| `launcher-scrollfade-bottom.png` | 1036 | 20x20 | yes | `Src/lunaui/launcher/dimensionslauncher.cpp` |  |
| `launcher-scrollfade-top.png` | 1020 | 10x10 | yes | `Src/lunaui/launcher/dimensionslauncher.cpp` |  |
| `launcher-touch-feedback.png` | 9331 | 90x90 | yes | `Src/lunaui/launcher/elements/icons/iconheap.cpp`, `Src/lunaui/launcher/OverlayWindowManager.cpp` |  |
| `list-divider.png` | 1103 | 710x2 | yes | `Src/lunaui/launcher/elements/page/icon_layouts/alphabeticonlayout.cpp` |  |
| `quicklaunch-bg-solid.png` | 1021 | 10x105 | yes | `Src/lunaui/launcher/elements/bars/quicklaunchbar.cpp` |  |
| `quicklaunch-bg.png` | 1108 | 10x105 | yes | `Src/lunaui/launcher/elements/bars/quicklaunchbar.cpp` |  |
| `quicklaunch-button-launcher.png` | 11923 | 64x128 | yes | `Src/lunaui/launcher/elements/bars/quicklaunchbar.cpp` |  |
| `quicklaunch-button-search.png` | 10200 | 60x120 | yes | - |  |
| `quicklaunch-shadow-original.png` | 1024 | 10x10 | yes | - |  |
| `quicklaunch-shadow.png` | 403 | 8x8 | yes | `Src/lunaui/launcher/elements/page/page.cpp` |  |
| `search-button-launcher.png` | 2429 | 32x32 | yes | `Src/lunaui/launcher/OverlayWindowManager.cpp` |  |
| `search-field-bg-launcher.png` | 2994 | 90x50 | yes | `Src/lunaui/launcher/OverlayWindowManager.cpp` |  |
| `superscroll-bg-highlight.png` | 1849 | 29x120 | yes | - |  |
| `superscroll-bg.png` | 1983 | 29x120 | yes | - |  |
| `tab-bg.png` | 1088 | 10x50 | yes | `Src/lunaui/launcher/elements/bars/pagetabbar.cpp`, `Src/lunaui/launcher/dimensionslauncher.cpp` |  |
| `tab-divider.png` | 1095 | 2x50 | yes | `Src/lunaui/launcher/elements/bars/pagetabbar.cpp` |  |
| `tab-highlight.png` | 1375 | 50x50 | yes | `Src/lunaui/launcher/elements/bars/pagetabbar.cpp` |  |
| `tab-selected-bg.png` | 1526 | 50x50 | yes | `Src/lunaui/launcher/elements/bars/pagetabbar.cpp` |  |
| `tab-shadow-original.png` | 1020 | 10x10 | yes | - |  |
| `tab-shadow.png` | 403 | 8x8 | yes | `Src/lunaui/launcher/elements/page/page.cpp`, `Src/lunaui/launcher/elements/bars/pagetabbar.cpp` |  |

## `images/pin/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `button-black-press.png` | 1191 | 52x52 | yes | `uiComponents/ActionButton/ActionButton.qml` |  |
| `button-black.png` | 610 | 52x52 | yes | `uiComponents/ActionButton/ActionButton.qml` |  |
| `button-green-press.png` | 1909 | 52x52 | yes | `uiComponents/ActionButton/ActionButton.qml` |  |
| `button-green.png` | 989 | 52x52 | yes | `uiComponents/ActionButton/ActionButton.qml` |  |
| `icon-delete.png` | 2731 | 50x50 | yes | `uiComponents/UnlockPanel/PINPad.qml` |  |
| `password-lock-field.png` | 1805 | 310x50 | yes | `uiComponents/UnlockPanel/PasswordField.qml` |  |
| `pin-grid.png` | 966 | 320x230 | yes | `uiComponents/UnlockPanel/PINPad.qml` |  |
| `pin-key-highlight.png` | 1775 | 106x55 | yes | `uiComponents/UnlockPanel/PINButton.qml` |  |

## `images/statusBar/`

| file | bytes | size (px) | reuse? | used by | note |
|---|---:|---|---|---|---|
| `appname-background.png` | 723 | 40x26 | yes | `Src/lunaui/status-bar/StatusBarTitle.cpp` |  |
| `battery-0.png` | 584 | 17x20 | yes | - |  |
| `battery-1.png` | 391 | 17x20 | yes | - |  |
| `battery-10.png` | 341 | 17x20 | yes | - |  |
| `battery-11.png` | 471 | 17x20 | yes | - |  |
| `battery-2.png` | 371 | 17x20 | yes | - |  |
| `battery-3.png` | 375 | 17x20 | yes | - |  |
| `battery-4.png` | 375 | 17x20 | yes | - |  |
| `battery-5.png` | 377 | 17x20 | yes | - |  |
| `battery-6.png` | 374 | 17x20 | yes | - |  |
| `battery-7.png` | 373 | 17x20 | yes | - |  |
| `battery-8.png` | 364 | 17x20 | yes | - |  |
| `battery-9.png` | 348 | 17x20 | yes | - |  |
| `battery-charged.png` | 761 | 17x20 | yes | `Src/lunaui/status-bar/StatusBarBattery.cpp` |  |
| `battery-charging-0.png` | 803 | 17x20 | yes | - |  |
| `battery-charging-1.png` | 665 | 17x20 | yes | - |  |
| `battery-charging-10.png` | 664 | 17x20 | yes | - |  |
| `battery-charging-11.png` | 647 | 17x20 | yes | - |  |
| `battery-charging-2.png` | 658 | 17x20 | yes | - |  |
| `battery-charging-3.png` | 677 | 17x20 | yes | - |  |
| `battery-charging-4.png` | 669 | 17x20 | yes | - |  |
| `battery-charging-5.png` | 662 | 17x20 | yes | - |  |
| `battery-charging-6.png` | 659 | 17x20 | yes | - |  |
| `battery-charging-7.png` | 666 | 17x20 | yes | - |  |
| `battery-charging-8.png` | 663 | 17x20 | yes | - |  |
| `battery-charging-9.png` | 663 | 17x20 | yes | - |  |
| `battery-error.png` | 461 | 17x20 | yes | `Src/lunaui/status-bar/StatusBarBattery.cpp` |  |
| `bluetooth-connected.png` | 481 | 13x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `bluetooth-connecting.png` | 455 | 13x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `bluetooth-error.png` | 348 | 13x18 | yes | - |  |
| `bluetooth-on.png` | 302 | 13x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `brightness-less.png` | 1941 | 24x24 | yes | `uiComponents/SystemMenu/BrightnessElement.qml` |  |
| `brightness-more.png` | 2214 | 24x24 | yes | `uiComponents/SystemMenu/BrightnessElement.qml` |  |
| `call-forward.png` | 395 | 13x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `hac.png` | 603 | 15x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `icon-airplane-off.png` | 2396 | 24x24 | yes | `uiComponents/SystemMenu/AirplaneModeElement.qml` |  |
| `icon-airplane.png` | 2171 | 24x24 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp`, `uiComponents/SystemMenu/AirplaneModeElement.qml` |  |
| `icon-mute-off.png` | 1854 | 24x24 | yes | `uiComponents/SystemMenu/MuteElement.qml` |  |
| `icon-mute.png` | 2247 | 24x24 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp`, `uiComponents/SystemMenu/MuteElement.qml` |  |
| `icon-rotation-lock-off.png` | 2177 | 24x24 | yes | `uiComponents/SystemMenu/RotationLockElement.qml` |  |
| `icon-rotation-lock.png` | 2394 | 24x24 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp`, `uiComponents/SystemMenu/RotationLockElement.qml` |  |
| `menu-arrow.png` | 526 | 15x26 | yes | `Src/lunaui/status-bar/StatusBarNotificationArea.cpp`, `Src/lunaui/status-bar/StatusBarItemGroup.cpp` |  |
| `network-1x-active.png` | 455 | 17x18 | yes | - |  |
| `network-1x-connected.png` | 406 | 17x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-1x-dormant.png` | 403 | 17x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-3g-active.png` | 468 | 17x18 | yes | - |  |
| `network-3g-connected.png` | 399 | 17x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-3g-dormant.png` | 440 | 17x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-edge-active.png` | 366 | 13x18 | yes | - |  |
| `network-edge-connected.png` | 324 | 13x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-evdo-active.png` | 430 | 17x18 | yes | - |  |
| `network-evdo-connected.png` | 422 | 17x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-evdo-dormant.png` | 411 | 17x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-gprs-active.png` | 408 | 13x18 | yes | - |  |
| `network-gprs-connected.png` | 360 | 13x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-hsdpa-active.png` | 313 | 13x18 | yes | - |  |
| `network-hsdpa-connected.png` | 310 | 13x18 | yes | - |  |
| `network-hsdpa-plus-connected.png` | 342 | 18x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-roaming-triangle.png` | 345 | 13x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-roaming.png` | 274 | 9x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `network-umts-active.png` | 347 | 13x18 | yes | - |  |
| `network-umts-connected.png` | 325 | 13x18 | yes | - |  |
| `rssi-0.png` | 211 | 19x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-1.png` | 219 | 19x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-1x-0.png` | 395 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-1x-1.png` | 413 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-1x-2.png` | 418 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-1x-3.png` | 416 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-1x-4.png` | 438 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-1x-5.png` | 414 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-2.png` | 241 | 19x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-3.png` | 274 | 19x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-3G-0.png` | 434 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-3G-1.png` | 446 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-3G-2.png` | 449 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-3G-3.png` | 462 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-3G-4.png` | 466 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-3G-5.png` | 442 | 33x11 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-4.png` | 301 | 19x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-5.png` | 313 | 19x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-error.png` | 455 | 19x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `rssi-ev-0.png` | 399 | 33x11 | yes | - |  |
| `rssi-ev-1.png` | 410 | 33x11 | yes | - |  |
| `rssi-ev-2.png` | 419 | 33x11 | yes | - |  |
| `rssi-ev-3.png` | 424 | 33x11 | yes | - |  |
| `rssi-ev-4.png` | 415 | 33x11 | yes | - |  |
| `rssi-ev-5.png` | 403 | 33x11 | yes | - |  |
| `rssi-flightmode.png` | 465 | 19x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `slider-handle.png` | 1138 | 30x30 | yes | `uiComponents/SystemMenu/Slider.qml` |  |
| `slider-track-progress.png` | 1231 | 35x24 | yes | `uiComponents/SystemMenu/Slider.qml` |  |
| `slider-track.png` | 374 | 50x24 | yes | `uiComponents/SystemMenu/Slider.qml` |  |
| `status-bar-background.png` | 1057 | 20x28 | yes | `Src/lunaui/status-bar/StatusBar.cpp` |  |
| `status-bar-menu-dropdown-tab-pressed.png` | 306 | 80x28 | yes | `Src/lunaui/status-bar/StatusBarItemGroup.cpp` |  |
| `status-bar-menu-dropdown-tab.png` | 1224 | 80x28 | yes | `Src/lunaui/status-bar/StatusBarItemGroup.cpp` |  |
| `status-bar-separator.png` | 1008 | 2x28 | yes | `Src/lunaui/status-bar/StatusBarItemGroup.cpp` |  |
| `system-menu-lock.png` | 252 | 20x23 | yes | `uiComponents/SystemMenu/WifiEntry.qml` |  |
| `system-menu-popup-item-checkmark.png` | 1207 | 31x23 | yes | `uiComponents/SystemMenu/BluetoothEntry.qml`, `uiComponents/SystemMenu/VpnEntry.qml`, `uiComponents/SystemMenu/WifiEntry.qml` |  |
| `tty.png` | 387 | 16x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `vpn-status-icon.png` | 454 | 22x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `wifi-0.png` | 420 | 20x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `wifi-1.png` | 423 | 20x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `wifi-2.png` | 440 | 20x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `wifi-3.png` | 456 | 20x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |
| `wifi-connecting.png` | 448 | 20x18 | yes | `Src/lunaui/status-bar/StatusBarInfo.cpp` |  |

## `sounds/`

| file | bytes | format / duration | reuse? | used by | note |
|---|---:|---|---|---|---|
| `alert.wav` | 530368 | WAV PCM 16-bit stereo 44.1 kHz, 3.00 s | yes | `Src/base/settings/Settings.cpp`, `Src/lunaui/notifications/BannerMessageHandler.cpp` |  |
| `battery_full.mp3` | 50154 | MP3 128 kbps 44.1 kHz stereo, ~3.1 s (est.) | yes | `Src/lunaui/status-bar/StatusBarBattery.cpp` |  |
| `battery_low.mp3` | 12119 | MP3 128 kbps 44.1 kHz stereo, ~0.8 s (est.) | yes | - |  |
| `boot.mp3` | 66036 | MP3 128 kbps 44.1 kHz stereo, ~4.1 s (est.) | review | `Src/base/WindowServer.cpp` | Palm/HP boot jingle - possible sound-mark; replace |
| `charging.mp3` | 50154 | MP3 128 kbps 44.1 kHz stereo, ~3.1 s (est.) | yes | - |  |
| `error.mp3` | 17971 | MP3 128 kbps 44.1 kHz stereo, ~1.1 s (est.) | yes | - |  |
| `notification.wav` | 177568 | WAV PCM 16-bit stereo 44.1 kHz, 1.00 s | yes | `Src/lunaui/notifications/BannerMessageHandler.cpp` |  |
| `panel.mp3` | 7522 | MP3 128 kbps 44.1 kHz stereo, ~0.5 s (est.) | yes | - |  |
| `phone.wav` | 990796 | WAV PCM 16-bit stereo 44.1 kHz, 5.62 s | yes | `Src/base/settings/Settings.cpp` |  |
| `ringtone.mp3` | 209815 | MP3 128 kbps 44.1 kHz stereo, ~13.1 s (est.) | review | - | default 'Pre' ringtone - product-identifying; replace |
| `shutdown.mp3` | 66036 | MP3 128 kbps 44.1 kHz stereo, ~4.1 s (est.) | review | - | Palm/HP shutdown jingle - possible sound-mark; replace |
| `tap_to_share.mp3` | 11701 | MP3 128 kbps 44.1 kHz stereo, ~0.7 s (est.) | yes | - |  |

## Summary

- Total files: 298 (286 images, 12 sounds)
- reuse = yes: 291; NO: 4; review: 3
- `images-unused/` (not inventoried above, 10 files) contains `emucard-device-frame.png` and `corenavi/` art for the emulator. Device-frame art is HP/Palm trade dress, so treat it as **NO**.
- The sysapp icon `sysapps/com.palm.sysapp.voicedial/icon-64x64.png` (a generic microphone) is outside `images/`. It's reusable, with attribution.
- Assets that the code references but that are **missing** from `images/`: `dock-mode-card-mask-portrait.png`, `dock-mode-card-mask-landscape.png`, `dock-app-default-splash-image.png` (`Src/lunaui/dock/DockModeLaunchPoint.cpp:92,97,483`), `activity-indicator-single-32x32.png` (`uiComponents/SystemMenu/Spinner.qml:7`), `icon-bg-small-light.png`/`icon-maps.png` (test-only, `Src/lunaui/launcher/elements/page/page.cpp:65-66`). Launcher art is loaded from `/usr/palm/sysmgr/images/launcher3/` (`Src/lunaui/launcher/gfx/gfxsettings.cpp:64`). `/usr/lib/luna/system/luna-applauncher/images/launcher_scrim.png` (`Src/base/settings/Settings.cpp:166`) and the default wallpaper `bluerocks.png` (`conf/defaultPreferences.txt`) ship in other repos (luna-applauncher / luna-systemui). We need to create replacements.
