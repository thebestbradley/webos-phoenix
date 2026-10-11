// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Design tokens for the Phoenix shell.
//
// Every number here comes from the legacy Open webOS system manager
// (openwebos/luna-sysmgr, Apache-2.0) and is expressed in *legacy pixels*:
// the pixel grid of the original 320x480 phone (Pre / Pre 2) or the
// 1024x768 tablet (TouchPad). Use Theme.px() to convert to device pixels,
// so the layout stays pixel-identical at the reference sizes and scales
// proportionally on modern high-density screens.
//
// Sources are cited as `luna-sysmgr/<path>:<line>`. See docs/spec/ for the
// full extracted spec.

pragma Singleton
import QtQuick
import Phoenix.Native

QtObject {
    id: theme

    // ---- Form factor ------------------------------------------------------

    // Set by Shell.qml.
    property bool tablet: false
    // Device pixels per legacy pixel: the output's density, not its size.
    // 1.0 on a Pre (320x480) and TouchPad (1024x768), 1.5 on a Pre 3
    // (480x800, a 320x533 canvas), 2.5 on a ~460 ppi modern phone. Layouts
    // fill whatever canvas that leaves, as they did across webOS devices.
    property real u: 1.0

    function px(v) { return Math.round(v * u) }
    // Where anchors.centerIn (alignWhenCentered) puts an item `size` long in
    // a parent `parentSize` long: each centre is half the length, rounded up
    // for an odd whole length (QQuickAnchorsPrivate hcenter / vcenter). For
    // an item that is centred only some of the time, at the same pixel.
    function centred(parentSize, size) {
        function half(l) { return Math.floor(l) % 2 ? (l + 1) / 2 : l / 2; }
        return half(parentSize) - half(size);
    }

    // Settings > Accessibility > Reduce motion (set by Shell.qml from
    // system.reduceMotion): cards, the launcher, the lock screen, the status
    // bar and its menus, the dashboard, banners, alerts and rotation appear
    // and go without animating (every duration through motion(); the
    // animations themselves are the original's, docs/spec/ANIMATIONS.md).
    // Indicators that only say something is going on (spinners, the loading
    // card's pulse) keep their pace. A Phoenix addition.
    property bool reduceMotion: false
    // Settings > Advanced > Animation speed (docs/M6-PLAN.md F4; the
    // community's Faster Card Animations patches): "fast" runs the shell's
    // animations (those through motion()) in 60% of their time. Set by
    // Shell.qml from the system's tweaks.
    property string animationSpeed: "normal"
    readonly property real animationScale: animationSpeed === "fast" ? 0.6 : 1.0
    function motion(ms) { return reduceMotion ? 1 : Math.round(ms * animationScale) }
    // Settings > Advanced > Gesture sensitivity (the Buttah patch): how far
    // and how fast a swipe or a flick must go before it counts, "low" half
    // as far again, "high" 60% of it.
    property string gestureSensitivity: "normal"
    readonly property real gestureScale: gestureSensitivity === "low" ? 1.5 : gestureSensitivity === "high" ? 0.6 : 1.0

    // The density for a screen of `ppi` pixels per inch: legacy pixels are
    // sized like the Pre's (186 ppi at 1.0) and the Pre 3's (260 ppi at 1.5),
    // about 1/180 inch, in steps of 0.25 so the art scales by even amounts.
    // Never below 1.0: the TouchPad (132 ppi) and desktop monitors, and
    // outputs that report no size (virtual machines), use 1.0.
    readonly property real legacyPixelsPerInch: 180
    function densityFor(ppi) {
        if (!(ppi > 0)) return 1.0;
        return Math.max(1.0, Math.round(ppi / legacyPixelsPerInch * 4) / 4);
    }

    // Outputs whose shorter side is at least this many legacy pixels get the
    // tablet layout (TouchPad 768; the largest webOS phone canvas, the
    // Pre 3's, was 320 wide).
    readonly property int tabletMinSide: 600
    function tabletLayoutFor(width, height, density) {
        return Math.min(width, height) / density >= tabletMinSide;
    }

    // ---- Typography -------------------------------------------------------

    // Legacy webOS used Prelude (conf/luna.conf [Fonts]), which is not
    // redistributable. A user-installed Prelude is used; otherwise Open Sans,
    // which Phoenix ships (assets/fonts/open-sans, Apache-2.0) and the web
    // apps get in its place too (runtime aliasPreludeFonts). See
    // docs/LEGAL.md.
    readonly property bool preludeInstalled: Qt.fontFamilies().indexOf("Prelude") >= 0
    readonly property string fontFamily: preludeInstalled ? "Prelude" : "Open Sans"
    readonly property list<QtObject> bundledFonts: [
        FontLoader { source: Qt.resolvedUrl("../../../assets/fonts/open-sans/OpenSans-Regular.ttf") },
        FontLoader { source: Qt.resolvedUrl("../../../assets/fonts/open-sans/OpenSans-Bold.ttf") },
        FontLoader { source: Qt.resolvedUrl("../../../assets/fonts/open-sans/OpenSans-Light.ttf") },
        FontLoader { source: Qt.resolvedUrl("../../../assets/fonts/open-sans/OpenSans-Semibold.ttf") },
        FontLoader { source: Qt.resolvedUrl("../../../assets/fonts/open-sans/OpenSans-Italic.ttf") },
        FontLoader { source: Qt.resolvedUrl("../../../assets/fonts/open-sans/OpenSans-BoldItalic.ttf") },
        // Colour emoji after the text font, everywhere text is drawn (GAPS V6;
        // assets/fonts/noto-color-emoji, SIL OFL 1.1).
        // (macOS draws emoji with its own Apple Color Emoji; Core Text has
        // no colour bitmap (CBDT) support for this font.)
        FontLoader { source: Qt.platform.os === "osx" ? "" : Qt.resolvedUrl("../../../assets/fonts/noto-color-emoji/NotoColorEmoji.ttf") }
    ]
    // For text that is only emoji (the keyboard's emoji page): the colour
    // font by name; elsewhere fontconfig's order brings it in after the text
    // font (assets/fonts/noto-color-emoji/50-phoenix-emoji.conf).
    readonly property string emojiFontFamily: Qt.platform.os === "osx" ? "Apple Color Emoji" : "Noto Color Emoji"

    // ---- Wallpaper

    // The default wallpaper, on the device: Settings' Northern Lights
    // (apps/settings/public/wallpapers, drawn by tools/wallpapers/generate.py),
    // as luna-sysmgr's default was a file its conf/defaultPreferences.txt
    // named. The system service's default wallpaper preference
    // (runtime/phoenix-runtime.js) is the same file.
    readonly property string defaultWallpaperPath: "/usr/palm/applications/org.webosphoenix.settings/wallpapers/northern-lights.jpg"

    // ---- Status bar (luna-sysmgr/images/statusBar/status-bar-background.png is 28px tall)

    readonly property int statusBarHeight: px(28)
    readonly property int statusBarTitleMaxWidth: px(140)   // Src/base/settings/Settings.cpp:179
    readonly property int statusBarFadeDuration: motion(300)                 // conf/lunaAnimations.conf:112-113 (linear)
    readonly property int statusBarIconSpacing: px(5)                // StatusBarIcon.h:35 ICON_SPACING
    // The battery state for a charge level: the first of these at or above
    // it (StatusBarBattery.cpp:34, 200-212).
    readonly property var batteryChargeLevels: [12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 88, 99, 100]
    function batteryState(percent) {
        for (var i = 0; i < batteryChargeLevels.length; ++i)
            if (percent <= batteryChargeLevels[i])
                return i;
        return batteryChargeLevels.length - 1;
    }
    readonly property int statusBarFontSize: px(14)                  // StatusBarTitle.cpp:36
    // The title: 14 px bold, letters at 90% (StatusBarTitle.cpp:55-63,
    // StatusBar.h:37); on phones, apps get appname-background.png with
    // 13 / 20 px caps, the text 9 px in, else 7 px in (:28-34, 188-218);
    // 2 px above centre (TEXT_BASELINE_OFFSET). A new title cross-fades
    // over 300 ms (statusBarTitleChange*, lunaAnimations.conf:116-117).
    readonly property int statusBarTitleSpacingPercent: 90
    readonly property int statusBarTitleCapLeft: 13
    readonly property int statusBarTitleCapRight: 20
    readonly property int statusBarTitleBorderPadding: px(13 - 4)
    readonly property int statusBarTitlePadding: px(7)
    readonly property int statusBarTitleBaselineOffset: px(-2)
    readonly property int statusBarTitleChangeDuration: motion(300)
    // Tablets: menu-arrow.png 5 px after the title while it opens a menu, fading
    // over 500 ms InOutQuad (StatusBarItemGroup.cpp:137-158, 412-424,
    // ITEM_SPACING 5; lunaAnimations.conf:120-121).
    readonly property int statusBarArrowSpacing: px(5)
    readonly property int statusBarArrowFadeDuration: motion(500)
    // Tablets: the fill under the art lerps over 300 ms between the default
    // #515558 and the launcher's / Just Type's #4F545A
    // (StatusBar.cpp:47, setBackgroundColor; SystemUiController.cpp:69-70;
    // lunaAnimations.conf:114-115).
    readonly property color statusBarLauncherFill: "#4F545A"
    readonly property int statusBarColorChangeDuration: motion(300)
    readonly property int statusBarItemSlideDuration: motion(1000)           // lunaAnimations.conf:122-123 (curve 3 InOutQuad on the width)
    readonly property int statusBarMenuFadeDuration: motion(200)             // lunaAnimations.conf:124-125 (linear)
    // Tablets: the notification group (its separator and icons) fades in
    // as the first notification comes and out after the last
    // (StatusBarItemGroup::show / hide, :185-232; StatusBar.cpp:688-697):
    // statusBarTabFade, 300 ms (lunaAnimations.conf:118). The conf names its
    // curve "statusBarTabFadeeCurve" (:119), a key nothing reads, so the
    // curve stays AnimationSettings.cpp:121's 0, Linear.
    readonly property int statusBarTabFadeDuration: motion(300)
    // ... and its icons fade out while a banner scrolls through the bar,
    // and back once the banners are done: 300 ms, linear
    // (StatusBarNotificationArea::setIconsShown, :368-397; FADED_ICONS_OPACITY 0, :31).
    readonly property int notificationIconsFadeDuration: motion(300)
    // Tablets: the drop-down tab behind a status bar group while its menu
    // is open (status-bar-menu-dropdown-tab.png) has 11 px caps, the
    // tab's edge with its shadow (StatusBarItemGroup.cpp:358 margin): the
    // art is solid only from 9 px in. The original put the group's
    // outermost item right at the cap's end (:362-366), so an icon could
    // touch the shadow; Phoenix keeps a few pixels of the tab around every
    // icon on both sides.
    readonly property int statusBarTabCap: px(11)
    readonly property int statusBarTabPadding: px(4)
    readonly property int statusBarClockFontSize: px(15)             // StatusBarClock.cpp:34
    // Phones: solid black (StatusBar.cpp:767). Tablet: tiled art over #515558 (StatusBar.cpp:47).
    readonly property color statusBarFill: tablet ? "#515558" : "#000000"

    // ---- System menu (uiComponents/SystemMenu, Src/lunaui/status-bar/SystemMenu.cpp)

    // The same on phones and tablets: 300 wide, at most 410 tall
    // (SystemMenu.qml:6,16), its right edge 11 px past the screen's so the
    // art's shadow falls off it (SystemMenu.qml:11 edgeOffset;
    // MenuWindowManager.cpp:117-122), under the status bar.
    readonly property int systemMenuWidth: px(300)
    readonly property int systemMenuMaxHeight: px(410)
    readonly property int systemMenuEdgeOffset: px(11)
    // The list sits 7 px in from the art's sides and 14 px up from its
    // bottom (SystemMenu.qml:113-116); dividers are 7 px narrower than the
    // list (:9 dividerWidthOffset, MenuDivider.qml:4).
    readonly property int systemMenuSideMargin: px(7)
    readonly property int systemMenuBottomMargin: px(14)
    readonly property int systemMenuDividerInset: px(7)
    readonly property int systemMenuRowHeight: px(42)                // MenuListEntry.qml:6
    // Text starts 14 px in; rows inside a drawer 16 px further (SystemMenu.qml:7-8).
    readonly property int systemMenuIndent: px(14)
    readonly property int systemMenuSubIndent: px(16)
    // Prelude 18 for rows, 16 for list entries, 13 caps for a drawer's
    // state, 10 caps under a list entry (DateElement.qml:17, WifiEntry.qml:24,
    // WiFiElement.qml:161-163, WifiEntry.qml:34-36).
    readonly property int systemMenuFontSize: px(18)
    readonly property int systemMenuEntryFontSize: px(16)
    readonly property int systemMenuStateFontSize: px(13)
    readonly property int systemMenuStatusFontSize: px(10)
    readonly property color systemMenuText: "#FFFFFF"                // AirplaneModeElement.qml:21
    readonly property color systemMenuTextDim: "#AAAAAA"             // DateElement.qml:15, BatteryElement.qml:19
    // Opening and closing fade: 200 ms, curve 0 = Linear
    // (conf/lunaAnimations.conf:124-125, StatusBarItemGroup.cpp:252-306).
    readonly property int systemMenuFadeDuration: motion(200)
    // Drawers open and close over 350 ms OutCubic (Drawer.qml:98-103); a
    // list changing size in an open drawer animates over 200 ms (:77).
    readonly property int systemMenuDrawerDuration: motion(350)
    readonly property int systemMenuDrawerResizeDuration: motion(200)
    // The menu closes 250 ms after a toggle (SystemMenu.qml:247,263,280),
    // 300 ms after a preferences or radio-off row, 350 ms after a Bluetooth
    // or VPN entry, 1 s after the Wi-Fi network picked connects
    // (WiFiElement.qml:93,202,227; BluetoothElement.qml:67,202,272).
    readonly property int systemMenuToggleCloseDelay: 250
    readonly property int systemMenuRowCloseDelay: 300
    readonly property int systemMenuEntryCloseDelay: 350
    readonly property int systemMenuWifiConnectCloseDelay: 1000
    readonly property int systemMenuDateInterval: 30000              // SystemMenu.cpp:63 kDateTimerInterval
    // The display never goes below 10%: the slider's 0..1 is 10..100%
    // (SystemMenu.cpp:61 MINIMUM_BRIGHTNESS, :873-882).
    readonly property real minimumBrightness: 0.10
    // Scroll fades show over 70 ms (SystemMenu.qml:309,332).
    readonly property int systemMenuScrollFadeDuration: motion(70)
    // AnimatedSpinner: spinner.png turned in 60 steps a second (SystemMenu.cpp:1006-1012).
    readonly property int spinnerFrames: 60
    readonly property int spinnerDuration: 1000

    // ---- Positive space / gesture area -------------------------------------

    // 28 on every device: conf/luna.conf:122-123, the base every device's
    // conf overrides, sets both (Settings.cpp:207-208's 24 is only the
    // compiled-in default).
    readonly property int positiveSpaceTopPadding: px(28)
    readonly property int positiveSpaceBottomPadding: px(28)

    // Phones had a physical gesture area below the screen. Modern devices do
    // not, so Phoenix reserves a thin on-screen strip that behaves the same
    // (swipe up = card view, swipe left = back), on phones and tablets alike.
    // The TouchPad had a Home button instead; Phoenix does not follow it.
    // Only a device whose maker uses a hardware Home button in its place
    // (Shell.hardwareHomeButton, DeviceConfig) goes without the strip.
    property bool hardwareHomeButton: false
    readonly property int gestureAreaHeight: hardwareHomeButton ? 0 : px(20)
    // Tablet bottom-edge flick (G1): where it starts, and how far it goes.
    readonly property int bezelEdgeHeight: px(8)                     // Phoenix: stands in for the bezel
    readonly property int bezelFlickMinimum: Math.round(30 * gestureScale)          // Phoenix: as GestureArea's swipe
    readonly property int bezelFlickMinimumWithKeyboard: Math.round(60 * gestureScale)  // SystemUiController.cpp:72

    // ---- Virtual keyboard (openwebos/keyboard-efigs; VirtualKeyboard.qml) ----------
    // The keyboards work in their own screens' pixels: the tablet's art is
    // the TouchPad's (1024 wide: "native assets", TabletKeyboard.cpp:471),
    // the phone's is for 480-wide phones of 250 dpi and more
    // (PhoneKeyboard.cpp:100; ten 48 px keys a row, key-white.png), the
    // Pre 3's 1.5 legacy density. Scene pixels per keyboard pixel:
    readonly property real phoneKeyboardDensity: 1.5
    readonly property real keyboardScale: tablet ? u : u / phoneKeyboardDensity

    // ---- Card view (Src/lunaui/cards/CardWindowManager.cpp:53-56) ---------

    // Ratios of the space below the 48px search-pill allowance; see
    // CardView.activeScale for the effective scale (CardWindowManager.cpp:2782).
    readonly property real activeCardRatio: tablet ? 0.55 : 0.659    // conf/luna-topaz.conf / Settings.cpp:210
    readonly property real nonActiveCardRatio: tablet ? 0.50 : 0.61  // conf/luna-topaz.conf / Settings.cpp:211
    readonly property real minimumCardScale: 0.26                    // CardWindowManager.cpp:60
    readonly property int searchPillAllowance: px(48)                // CardWindowManager.cpp:780-786
    readonly property int searchPillTopOffset: px(9)                 // layoutsettings.cpp:93, below the status bar
    readonly property real cardOriginRatio: 0.40                     // CardWindowManager.cpp:56 kWindowOriginRatio
    readonly property int gapBetweenCards: px(tablet ? 30 : 10)       // Settings.cpp:214 / luna-topaz.conf
    // Card stacks (CardGroup.cpp:699-771): how far apart fanned cards sit
    // and how much they tilt (degrees = x / (activeScale * factor)).
    readonly property real cardGroupingXDistanceFactor: tablet ? 0.35 : 1.0   // luna-topaz.conf / Settings.cpp:169
    readonly property real cardGroupRotFactor: tablet ? 90 : 30               // luna-topaz.conf / conf/luna.conf
    // Reorder: the outer fifth of the screen on each side is an edge zone.
    readonly property int reorderMarginSlice: 5                               // CardWindowManager.cpp:68
    // A tapped icon shows launcher-touch-feedback.png (90 x 90) behind it
    // until the launcher hides or 3 s pass (IconBase paint, icon.cpp:984-990;
    // LauncherObject::setAppLaunchFeedback; dynamicssettings.cpp:108).
    readonly property int launchFeedbackSize: px(90)
    readonly property int launchFeedbackTimeout: 3000
    readonly property int tapAndHoldInterval: 700                             // WebosTapAndHoldGestureRecognizer.cpp:52
    // Holding a launcher or dock icon this long opens its menu (IconMenu.qml;
    // the owner's choice, docs/M6-PLAN.md F1: time only, no pressure).
    readonly property int iconMenuHoldInterval: 500
    // Radius in window (buffer) coordinates, i.e. before the card is scaled.
    readonly property int cardShadowOutset: px(20)                   // CardDropShadowEffect.cpp:34-35
    readonly property int cardShadowOffsetY: px(5)                   // CardDropShadowEffect.cpp:44
    // The card that just lost focus dims to this brightness.
    readonly property real cardDimming: 0.8                          // CardWindow.cpp:211-213

    // Flick-to-close (CardWindowManager.cpp:63-65,1700-1708). Velocity is
    // in legacy px/ms: the original's touch velocities were px/ms x100.
    readonly property int cardCloseMinDistance: px(50 * gestureScale)
    readonly property real cardCloseMinVelocity: 5.0 * u * gestureScale
    // Drag-lock axis: horizontal if |dx| > 0.866 |dy| (CardWindowManager.cpp:1464-1476).
    readonly property real horizontalLockRatio: 0.866
    // A trackpad swipe ends when its events (momentum included) stop for this
    // long. Phoenix: webOS had no trackpad.
    readonly property int wheelGestureEndDelay: 150
    // A trackpad swipe settles quicker than a finger's release: the content
    // has already followed the fingers most of the way (Phoenix).
    readonly property int wheelSettleDuration: motion(180)
    // Content pixels per ms above which a lifted swipe goes on to the next stack.
    readonly property real wheelFlickVelocity: 0.5     // as a finger's flick (CardView release)
    readonly property int tapRadius: px(25)                          // conf/luna.conf:68 TapRadiusMax

    // ---- Quick launch / launcher -------------------------------------------

    // Tablet: layoutsettings.cpp:82-84, QuicklaunchLayout.cpp:46-49. The 2.x
    // phone dock is not in the Open webOS source; phone values are inferred.
    readonly property int quickLaunchHeight: px(tablet ? 100 : 68)
    readonly property int quickLaunchIconSize: px(tablet ? 64 : 48)
    readonly property int quickLaunchIconY: px(tablet ? 20 : 14)
    readonly property int quickLaunchMaxItems: 5                     // layoutsettings.cpp:87
    readonly property int quickLaunchCellWidth: px(128)              // icongeometrysettings.cpp:178 absoluteGeomSizePx
    readonly property int launcherIconSize: px(64)                   // images/launcher3/launcher-icon-64.png
    readonly property int launcherTabHeight: px(50)                  // images/launcher3/tab-bg.png
    // layoutsettings.cpp:67-74: 16 px bold in both states, white / #C8C8C8.
    readonly property int launcherTabFontSize: px(16)
    readonly property color launcherTabSelectedColor: "#FFFFFF"
    readonly property color launcherTabColor: "#C8C8C8"
    readonly property int launcherTabMaxWidth: px(150)               // pagetabbar.cpp:85
    // Tablet: launcher3's grid (launcher_icon_layoutsettings.conf,
    // icongeometrysettings.cpp:180-207, launcher_icon_geom_settings.conf):
    // up to 7 icons a row, 128 px cells 12 px apart from 27 px in, rows 10
    // px apart; the 64 px icon 11 px above the cell's centre; the label 14 px
    // bold in a 100 x 40 box 2 px under it. Phones keep 3 columns (the
    // webOS 2 phone launcher was not released).
    readonly property int launcherColumns: tablet ? 7 : 3
    readonly property int launcherCellSize: px(128)
    readonly property int launcherCellPitch: px(128 + 12)
    readonly property int launcherRowPitch: px(128 + 10)
    readonly property int launcherRowLeftMargin: px(27)
    readonly property int launcherIconOffsetY: px(-11)
    readonly property int launcherLabelWidth: px(100)
    readonly property int launcherLabelSpacing: px(2)
    readonly property int launcherLabelFontSize: px(tablet ? 14 : 13)
    readonly property bool launcherLabelBold: tablet

    // ---- Lock screen ---------------------------------------------------------

    readonly property int lockDigitWidth: px(50)                     // images/screen-lock-clock-0.png
    readonly property int lockDigitHeight: px(80)
    readonly property int lockColonWidth: px(20)                     // images/screen-lock-clock-colon.png
    readonly property int lockPadlockSize: px(100)                   // images/screen-lock-padlock-off.png
    readonly property real lockClockCenterRatio: 0.15                // LockWindow.cpp:427 (-0.35 H from centre)
    readonly property real lockHandleOffsetRatio: 0.10               // LockWindow.cpp:81 LOCK_BUTTON_OFFSET
    readonly property int lockUnlockDistance: px(146)                // LockWindow.cpp:89
    readonly property int lockHelpFontSize: px(20)                   // LockWindow.cpp:91
    readonly property int lockHideHelpDelay: 1000                    // LockWindow.cpp:91 kHideHelpTimeoutInMS
    readonly property int lockWindowFadeDuration: motion(150)                // conf/lunaAnimations.conf:104 (curve 1, InQuad)

    // ---- Notifications -------------------------------------------------------

    readonly property int bannerHeight: positiveSpaceBottomPadding   // BannerMessageHandler.cpp:201
    readonly property int bannerFontSize: px(16)                     // BannerMessageHandler.cpp:67
    readonly property int bannerSlideDuration: motion(1000)                  // BannerMessageHandler.cpp:122-130
    readonly property int bannerShowTime: 5000                       // BannerMessageHandler.cpp:69
    readonly property int bannerShowTimeQueued: 2000                 // BannerMessageHandler.cpp:70
    readonly property int dashboardItemHeight: px(52)                // DashboardWindowContainer.cpp:48
    readonly property real maximumNegativeSpaceRatio: 0.55           // Settings.cpp MaximumNegativeSpaceHeightRatio
    // BackdropBlur: a faint blur behind translucent surfaces (Phoenix addition).
    readonly property int backdropBlurRadius: 12
    readonly property int lockFadeDuration: motion(200)                      // conf/lunaAnimations.conf:108
    // The lock screen's dashboard and banner (LockWindow.cpp:84-102,
    // 2611-2615): 320 px wide on popup-bg.png, whose 10 px shadow and 9 px
    // corners make its 19 px border; at most 6 dashboard rows, 5.5 showing.
    readonly property int lockAlertsWidth: px(320)                   // LockWindow.cpp:84 kMaxWidth
    readonly property int lockAlertsShadow: px(10)                   // LockWindow.cpp:101 kShadowWidth
    readonly property int lockAlertsBorder: 19                       // :461-464, popup-bg.png source px
    readonly property int lockBannerPadding: px(10)                  // LockWindow.cpp:2747 kPadding
    readonly property int lockDashboardMaxItems: 6                   // LockWindow.cpp:2611-2613
    readonly property int lockDashboardTopPadding: px(1)             // LockWindow.cpp:2615
    readonly property int lockDashboardBottomPadding: px(3)          // LockWindow.cpp:2614
    readonly property int alertFadeDuration: motion(400)                     // DashboardWindowManager.cpp:559,589
    // Phones: room above a web page's popup alert (luna-systemui's Low
    // Battery, an alarm, a reminder) in the negative space. The phone's alert
    // container put the window at its very top (DashboardWindowManager.cpp:
    // 244, 1239-1240) and luna-systemui's content has no top margin
    // (notifications.css:13-15, "margin: 0 10px 10px"), so its title sat
    // against the app's bottom edge. 10 px, as the shell's own alerts have
    // above their titles (6 px margin + 4 px, uiComponents/MemoryAlert).
    readonly property int phoneAlertTopPadding: px(10)
    readonly property int positiveSpaceDuration: motion(400)                 // conf/lunaAnimations.conf:73-74, curve 6 OutCubic
    readonly property real dashboardDismissRatio: 0.25               // DashboardWindowContainer.cpp:350-363
    // A dashboard window that takes its own drags (webosDragMode "manual")
    // leaves the row's drag to its badge, this far from its left.
    readonly property int dashboardBadgeWidth: px(50)                // DashboardWindowContainer.cpp:49 sDashboardBadgeWidth
    readonly property int dashboardTopPadding: px(10)                // DashboardWindowContainer.cpp:107 (phones)
    // Dismissed: slides a width and a half to the right (:700-708).
    readonly property int dashboardDeleteDuration: motion(200)               // AnimationSettings.cpp:117, curve 0 Linear
    readonly property int dashboardSnapDuration: motion(500)                 // conf/lunaAnimations.conf:69-70, curve 6 OutCubic
    readonly property real dashboardDeleteTravel: 1.5                // DashboardWindowContainer.cpp:702
    // Where the bottom scroll mask sits above the viewport's bottom (:106, 1317).
    readonly property int dashboardBottomMaskOffset: px(10)
    // A flick: the whole gesture's average velocity, |vx| + |vy|, in legacy
    // px/ms (FlickGestureRecognizer.cpp:44-45, 95-104); sideways when
    // |vx| > |vy| (DashboardWindowContainer.cpp:430).
    readonly property real flickMinVelocity: 2.5 * u * gestureScale
    readonly property real flickMaxVelocity: 11.0 * u

    // ---- Notification drawer (Phoenix) --------------------------------------
    // A handle on the dashboard's open edge pulls it to the whole screen
    // (phones: up; tablets: the drop-down's foot, down), where a header
    // offers Select and Clear All. Live activities stay at the top, a faint
    // rule under them.
    readonly property int drawerHandleHeight: px(24)
    readonly property int drawerHandleWidth: px(36)
    readonly property int drawerHandleThickness: px(4)
    readonly property int drawerHeaderHeight: px(40)
    readonly property int drawerHeaderFontSize: px(16)
    // Clear All's second tap: how long it waits, and its colour meanwhile.
    readonly property int drawerConfirmTimeout: 3000
    // How long a capture's thumbnail stays in the corner (iOS: about 5 s).
    readonly property int screenCaptureThumbnailDuration: 5000
    readonly property color drawerConfirmColor: "#ff6b5e"
    // How far the handle must travel to expand or collapse.
    readonly property int drawerPullThreshold: px(40)
    readonly property int drawerDuration: motion(250)
    readonly property color drawerRule: Qt.rgba(1, 1, 1, 0.18)
    readonly property int drawerRuleGap: px(6)
    readonly property int drawerCheckSize: px(22)

    // ---- Tablet dashboard drop-down (uiComponents/DashboardMenu, MenuContainer)
    // 320 px rows (DashboardWindowManager.cpp:63 kTabletNotificationContentWidth;
    // MenuContainer.qml:65) 11 px in from the art's sides and 15 up from its
    // foot (:48-51); its right edge 11 px past the notification area's
    // (:9 edgeOffset; DashboardWindowManager.cpp:165, 1247-1257).
    readonly property int dashboardMenuWidth: px(320)
    readonly property int dashboardMenuSideMargin: px(11)
    readonly property int dashboardMenuBottomMargin: px(15)
    readonly property int dashboardMenuEdgeOffset: px(11)
    // menu-divider.png, 2 px, above every row but the top one
    // (DashboardWindowContainer.cpp:1245-1253 m_menuSeparatorHeight, 1357-1371).
    readonly property int dashboardMenuDividerHeight: px(2)
    // At most 5 1/2 rows and their dividers, then it scrolls
    // (DashboardWindowContainer.cpp:47, 152-155; setMaximumHeight,
    // DashboardWindowManager.cpp:167, MenuContainer.qml:17-19): 295 px.
    readonly property real dashboardMenuMaxRows: 5.5
    readonly property int dashboardMenuMaxContentHeight:
        px(Math.floor(dashboardMenuMaxRows * 52) + (dashboardMenuMaxRows - 1) * 2)
    // The bottom scroll fade sits 28 px above the list's foot, its arrow 10
    // px into it (MenuContainer.qml:99, 111).
    readonly property int dashboardMenuScrollFadeBottomOffset: px(28)
    // The swipe shading's 5 px ends (paintInsideMenu's paintHoriz3Tile calls,
    // DashboardWindowContainer.cpp:1382-1428).
    readonly property int dashboardMenuSwipeCap: 5

    // Phones round the corners of the app area with 24px overlays.
    readonly property int screenCornerSize: px(24)                   // MenuWindowManager.cpp:126-146

    // ---- Colors --------------------------------------------------------------

    readonly property color black: "#000000"
    readonly property color text: "#ffffff"
    readonly property color textDim: "#a0a0a0"
    readonly property color highlight: "#3a8bd9"                     // (inferred)

    // ---- Animation (conf/lunaAnimations.conf [Cards]) -----------------------

    readonly property int cardLaunchDuration: motion(400)
    readonly property int cardAddMaxDuration: motion(750)                    // conf/lunaAnimations.conf:53
    // conf/lunaAnimations.conf cardPrepareAddDuration: how long a new card
    // waits before it is prepared (CardWindow::delayPrepare,
    // CardWindow.cpp:1395-1400; CardView.focusLaunched).
    readonly property int cardPrepareAddDuration: motion(150)
    readonly property int cardSlideDuration: motion(300)                     // curve 10 = OutQuart
    readonly property int cardMaximizeDuration: motion(300)                  // curve 10 = OutQuart
    readonly property int cardMinimizeDuration: motion(300)                  // minimize is a cardSlide
    // The stack in front's own cards to their places in the fan, on a
    // minimize and on each move of a finger through the fan:
    // CardGroup::animateOpen(200, QEasingCurve::OutCubic) in slideAllGroups
    // (CardWindowManager.cpp:2495), a fixed value, not in the conf.
    readonly property int cardFanDuration: motion(200)
    readonly property int cardDeleteDuration: motion(300)                    // curve 6 = OutCubic
    // A modal card (Settings.cpp:239-240 ModalWindowWidth/Height, legacy px)
    // and its fade when the minimize gesture takes it away
    // (CardWindowManager.cpp:66 kModalWindowAnimationTimeout).
    readonly property int modalCardWidth: 320
    readonly property int modalCardHeight: 480
    readonly property int modalCardFadeDuration: motion(45)
    // Its move to its new place when the positive space changes
    // (CardWindow.cpp:75 sModalCardAnimationTimeout; :2210-2211, curve
    // cardDeleteCurve 6 = OutCubic).
    readonly property int modalCardMoveDuration: motion(500)
    // Loading card (CardLoading.cpp, lunaAnimations.conf:55-60, Settings.cpp:216).
    readonly property int cardLoadingTimeBeforePulse: 900
    readonly property int cardLoadingPulseDuration: 1000             // half up, half down
    readonly property int cardLoadingPulsePause: 1000
    readonly property int cardLoadingCrossFadeDuration: motion(300)          // curve 0 = Linear
    readonly property int splashIconSize: tablet ? 192 : 128         // luna.conf SplashIconSize; 192 on tablets
    readonly property int cardShuffleReorderDuration: motion(350)            // curve 6 = OutCubic
    readonly property int cardGroupReorderDuration: motion(500)              // conf/lunaAnimations.conf:43-46
    readonly property int cardDimmingDuration: motion(300)
    // An app's scene push / pop (CardTransition.cpp): conf/lunaAnimations.conf:61-62
    // cardTransitionDuration, curve 20 = easeOutQuad (AnimationSettings.cpp:380-396).
    readonly property int cardTransitionDuration: motion(300)
    // Touch to Share's ghost card: conf/lunaAnimations.conf:63-64
    // cardGhostDuration, curve 10 = OutQuart; it ends at GhostCardFinalRatio
    // of the full window (Settings.cpp:212, CardWindowManager.cpp:2949).
    readonly property int cardGhostDuration: motion(750)
    readonly property real ghostCardFinalRatio: 0.85
    // Touch to Share's glow: one 1000 ms pulse after another, the curve
    // reticleCurve = 0 Linear (TouchToShareGlow.cpp:99-127; lunaAnimations.conf:93).
    readonly property int touchToShareGlowDuration: 1000
    readonly property int launcherReorderDuration: motion(300)               // dynamicssettings.cpp:92-93 iconReorderIconMoveAnimTime, InQuad
    // Dragging an icon to a page's left or right edge (the 50 px border,
    // layoutsettings.cpp:61) takes it to the page beside at once; held
    // there, again every 1500 ms (PageMovementControl's restriction,
    // dynamicssettings.cpp:104 pagePanForIconMoveDelayMs). The 1000 ms
    // border timeouts of layoutsettings.cpp:62-65 are read but nothing
    // uses them. To the top or bottom 20 px it scrolls the page 150 px over
    // 300 ms, at most once every 800 ms (pageScrollDelayMs, :101-103).
    readonly property int launcherPagePanDelay: 1500
    readonly property int launcherEdgeWidth: px(tablet ? 50 : 25)    // phones: half, for their 3 narrow columns
    readonly property int launcherEdgeHeight: px(20)
    readonly property int launcherScrollDelay: 800
    readonly property int launcherScrollAmount: px(150)
    readonly property int launcherScrollDuration: motion(300)
    // Going to a page (dimensionslauncher.cpp:3287-3348 gotoPageIndex): a
    // tab's tap, or a drag let go short of a flick, glides to the page over
    // 250 ms InQuad (DynamicsSettings snapbackAnimTime / snapbackAnimCurve,
    // dynamicssettings.cpp:86-87; :1990-2010 for the snap back). A flick goes
    // on to the page beside the one it began on (:3624-3645) in
    // distance / speed, at least 200 and at most 1200 ms, OutCubic (:3330-3339;
    // the flick's speed is px/ms x 100, FlickGestureRecognizer.cpp:46, 98-101).
    // Phoenix's flick is snappier than the original's (the owner's choice):
    // the finger's speed as it lets go (the last 100 ms), not the whole
    // drag's, counts from 0.4 px/ms with no upper bound, and the glide takes
    // 150 to 400 ms.
    readonly property int launcherPageSnapDuration: motion(250)
    readonly property real launcherFlickMinVelocity: 0.4 * u * gestureScale
    readonly property int launcherFlickWindow: 100
    // The app info dialog (Remove Application?) fades in over 400 ms and out
    // over 600, linear (dynamicssettings.cpp:106-107; AppInfoDialog.qml:55-68).
    readonly property int appInfoDialogFadeInDuration: motion(400)
    readonly property int appInfoDialogFadeOutDuration: motion(600)
    readonly property int launcherPageFlickMinDuration: 150
    readonly property int launcherPageFlickMaxDuration: 400
    readonly property real launcherInstallingOpacity: 0.5            // dynamicssettings.cpp:105 iconInstallModeOpacity
    readonly property int launcherProgressFrames: 19                 // iconheap.cpp:47 loading-strip.png's frames
    // App groups (LunaCE): a dragged icon this near another's centre (a
    // share of the icon's size, either way) groups with it; further out it
    // reorders. How long it waits there first.
    readonly property real launcherGroupCentre: 0.3
    readonly property int launcherGroupHoverDelay: 400
    // How long a dragged icon rests over a place before the others make
    // room (Phoenix: so that it can pass over them to one's centre).
    readonly property int launcherReorderDelay: 150
    readonly property int launcherDuration: motion(350)                      // conf/lunaAnimations.conf:83-84 (curve 15 InOutQuint)
    readonly property int quickLaunchDuration: motion(350)                   // conf/lunaAnimations.conf:77-82
    readonly property int justTypeFadeDuration: motion(150)                  // conf/lunaAnimations.conf:87-88
    readonly property int searchPillFadeDuration: motion(200)                // conf/lunaAnimations.conf:81 quickLaunchFadeDuration
    readonly property int emergencyFadeDuration: motion(350)                 // EmergencyWindowManager.cpp:49 kFadeAnimDuration (linear)

    // ---- Dock mode (AnimationSettings.cpp:125-131, curve 3 InOutQuad) ----------
    readonly property int dockScreenFadeDuration: 900                // dockFadeScreenAnimationDuration
    readonly property int dockFadeDuration: 500                      // dockFadeDockAnimationDuration
    readonly property int dockStartDelay: 270                        // dockFadeDockStartDelay
    readonly property int reticleDuration: motion(200)                       // conf/lunaAnimations.conf:92-93 (curve 0 Linear)

    // lunaAnimations.conf curve numbers map to QEasingCurve types:
    // 6 = OutCubic, 10 = OutQuart.
    readonly property int cardEasing: Easing.OutQuart
    readonly property int cardDeleteEasing: Easing.OutCubic

    // ---- Assets ------------------------------------------------------------

    // Original Open webOS artwork, shipped in shell/assets/openwebos, drawn
    // at this density: the best of name@1.5x / @2x / @3x / @4x.png beside it
    // for u (HiDpi.variant), or the 1x file itself, always when u is 1. Size
    // an image with artWidth() / artHeight(), and give a BorderImage
    // artBorder() borders. See
    // docs/spec/hidpi-art.md.
    function assetUrl(path) {
        return Qt.resolvedUrl("../../../assets/openwebos/" + path)
    }
    function asset(path) {
        return HiDpi.variant(assetUrl(path), u)
    }
    // Any art file at `scale` device pixels per art pixel (the keyboards,
    // whose art is not in legacy pixels).
    function variant(url, scale) {
        return HiDpi.variant(url, scale)
    }
    // The width and height of the art in `url` (a file returned by
    // asset()), in device pixels: the file's own size read from its header,
    // divided by its variant factor, through px(). Not from the Image's
    // sourceSize: on a screen with a device pixel ratio above 1, Qt loads
    // "name@2x.png" in place of "name.png" by itself, and sourceSize is then
    // the @2x file's while the URL still says 1x.
    function artWidth(url) {
        var s = HiDpi.imageSize(url);
        return s.width > 0 ? px(s.width / HiDpi.variantScale(url)) : 0
    }
    function artHeight(url) {
        var s = HiDpi.imageSize(url);
        return s.height > 0 ? px(s.height / HiDpi.variantScale(url)) : 0
    }
    // How many times the 1x art's pixels a file returned by asset() has.
    function artScale(url) {
        return HiDpi.variantScale(url)
    }
    // px() of a length in the art's pixels, measured on a file that may be a
    // variant: Theme.artWidth(source).
    function artPx(v, url) {
        return px(v / HiDpi.variantScale(url))
    }
    // A BorderImage border given in the 1x art's pixels, for its source
    // (Qt scales @2x / @3x borders itself; see HiDpi.borderScale).
    function artBorder(v, url) {
        return Math.round(v * HiDpi.borderScale(url))
    }
    // Device pixels per logical pixel of an Image or BorderImage showing a
    // file returned by asset(), for art drawn at its own pixel size: a
    // BorderImage's borders, tiled images. Qt draws a @2x / @3x file's
    // pixels as the 1x art's (and a @1.5x file's as its own), the shell's
    // are u times bigger. ArtBorderImage and ArtTiledImage scale by it.
    function artDrawScale(url) {
        return u / HiDpi.borderScale(url)
    }
    // An app icon's file for drawing it `pixels` device pixels wide: the
    // icon, or a bigger one the app ships (`large`: appinfo.json's
    // splashicon; icon-256x256.png beside it) once the icon is too small.
    function appIcon(url, pixels, large) {
        return HiDpi.icon(url, pixels, large || "")
    }
}
