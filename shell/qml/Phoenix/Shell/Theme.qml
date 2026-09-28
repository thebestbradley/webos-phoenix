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
        FontLoader { source: Qt.resolvedUrl("../../../assets/fonts/open-sans/OpenSans-BoldItalic.ttf") }
    ]

    // ---- Status bar (luna-sysmgr/images/statusBar/status-bar-background.png is 28px tall)

    readonly property int statusBarHeight: px(28)
    readonly property int statusBarTitleMaxWidth: px(140)   // Src/base/settings/Settings.cpp:179
    readonly property int statusBarFadeDuration: 300                 // conf/lunaAnimations.conf:112-113 (linear)
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
    readonly property int statusBarTitleChangeDuration: 300
    // Tablets: menu-arrow.png 5 px after the title while it opens a menu, fading
    // over 500 ms InOutQuad (StatusBarItemGroup.cpp:137-158, 412-424,
    // ITEM_SPACING 5; lunaAnimations.conf:120-121).
    readonly property int statusBarArrowSpacing: px(5)
    readonly property int statusBarArrowFadeDuration: 500
    // Tablets: the fill under the art lerps over 300 ms between the default
    // #515558 and the launcher's / Just Type's #4F545A
    // (StatusBar.cpp:47, setBackgroundColor; SystemUiController.cpp:69-70;
    // lunaAnimations.conf:114-115).
    readonly property color statusBarLauncherFill: "#4F545A"
    readonly property int statusBarColorChangeDuration: 300
    readonly property int statusBarItemSlideDuration: 1000           // lunaAnimations.conf:122-123 (curve 3 InOutQuad on the width)
    readonly property int statusBarMenuFadeDuration: 200             // lunaAnimations.conf:124-125 (linear)
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
    readonly property int systemMenuFadeDuration: 200
    // Drawers open and close over 350 ms OutCubic (Drawer.qml:98-103); a
    // list changing size in an open drawer animates over 200 ms (:77).
    readonly property int systemMenuDrawerDuration: 350
    readonly property int systemMenuDrawerResizeDuration: 200
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
    readonly property int systemMenuScrollFadeDuration: 70
    // AnimatedSpinner: spinner.png turned in 60 steps a second (SystemMenu.cpp:1006-1012).
    readonly property int spinnerFrames: 60
    readonly property int spinnerDuration: 1000

    // ---- Positive space / gesture area -------------------------------------

    // 28 on every device: conf/luna.conf:122-123, the base every device's
    // conf overrides, sets both (Settings.cpp:207-208's 24 is only the
    // compiled-in default).
    readonly property int positiveSpaceTopPadding: px(28)
    readonly property int positiveSpaceBottomPadding: px(28)

    // Phones had a physical gesture area below the screen. Modern phones do
    // not, so Phoenix reserves a thin on-screen strip that behaves the same
    // (swipe up = card view, swipe left = back). 0 disables it.
    property int gestureAreaHeight: tablet ? 0 : px(20)
    // Tablet bottom-edge flick (G1): where it starts, and how far it goes.
    readonly property int bezelEdgeHeight: px(8)                     // Phoenix: stands in for the bezel
    readonly property int bezelFlickMinimum: 30                       // Phoenix: as GestureArea's swipe
    readonly property int bezelFlickMinimumWithKeyboard: 60           // SystemUiController.cpp:72

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
    // Radius in window (buffer) coordinates, i.e. before the card is scaled.
    readonly property int cardCornerRadius: px(40)                   // CardWindow.cpp:2515-2529
    readonly property int cardShadowOutset: px(20)                   // CardDropShadowEffect.cpp:34-35
    readonly property int cardShadowOffsetY: px(5)                   // CardDropShadowEffect.cpp:44
    // The card that just lost focus dims to this brightness.
    readonly property real cardDimming: 0.8                          // CardWindow.cpp:211-213

    // Flick-to-close (CardWindowManager.cpp:63-65,1700-1708). Velocity is
    // in legacy px/ms: the original's touch velocities were px/ms x100.
    readonly property int cardCloseMinDistance: px(50)
    readonly property real cardCloseMinVelocity: 5.0 * u
    // Drag-lock axis: horizontal if |dx| > 0.866 |dy| (CardWindowManager.cpp:1464-1476).
    readonly property real horizontalLockRatio: 0.866
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
    readonly property int lockWindowFadeDuration: 150                // conf/lunaAnimations.conf:104 (curve 1, InQuad)

    // ---- Notifications -------------------------------------------------------

    readonly property int bannerHeight: positiveSpaceBottomPadding   // BannerMessageHandler.cpp:201
    readonly property int bannerFontSize: px(16)                     // BannerMessageHandler.cpp:67
    readonly property int bannerSlideDuration: 1000                  // BannerMessageHandler.cpp:122-130
    readonly property int bannerShowTime: 5000                       // BannerMessageHandler.cpp:69
    readonly property int bannerShowTimeQueued: 2000                 // BannerMessageHandler.cpp:70
    readonly property int dashboardItemHeight: px(52)                // DashboardWindowContainer.cpp:48
    readonly property real maximumNegativeSpaceRatio: 0.55           // Settings.cpp MaximumNegativeSpaceHeightRatio
    // BackdropBlur: a faint blur behind translucent surfaces (Phoenix addition).
    readonly property int backdropBlurRadius: 12
    readonly property int lockFadeDuration: 200                      // conf/lunaAnimations.conf:108
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
    readonly property int alertFadeDuration: 400                     // DashboardWindowManager.cpp:559,589
    readonly property int positiveSpaceDuration: 400                 // conf/lunaAnimations.conf:73-74, curve 6 OutCubic
    readonly property real dashboardDismissRatio: 0.25               // DashboardWindowContainer.cpp:350-363
    readonly property int dashboardTopPadding: px(10)                // DashboardWindowContainer.cpp:107 (phones)
    // Dismissed: slides a width and a half to the right (:700-708).
    readonly property int dashboardDeleteDuration: 200               // AnimationSettings.cpp:117, curve 0 Linear
    readonly property int dashboardSnapDuration: 500                 // conf/lunaAnimations.conf:69-70, curve 6 OutCubic
    readonly property real dashboardDeleteTravel: 1.5                // DashboardWindowContainer.cpp:702
    // Where the bottom scroll mask sits above the viewport's bottom (:106, 1317).
    readonly property int dashboardBottomMaskOffset: px(10)
    // A flick: the whole gesture's average velocity, |vx| + |vy|, in legacy
    // px/ms (FlickGestureRecognizer.cpp:44-45, 95-104); sideways when
    // |vx| > |vy| (DashboardWindowContainer.cpp:430).
    readonly property real flickMinVelocity: 2.5 * u
    readonly property real flickMaxVelocity: 11.0 * u

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

    readonly property int cardLaunchDuration: 400
    readonly property int cardAddMaxDuration: 750                    // conf/lunaAnimations.conf:53
    readonly property int cardSlideDuration: 300                     // curve 10 = OutQuart
    readonly property int cardMaximizeDuration: 300                  // curve 10 = OutQuart
    readonly property int cardMinimizeDuration: 300                  // minimize is a cardSlide
    readonly property int cardDeleteDuration: 300                    // curve 6 = OutCubic
    // Loading card (CardLoading.cpp, lunaAnimations.conf:55-60, Settings.cpp:216).
    readonly property int cardLoadingTimeBeforePulse: 900
    readonly property int cardLoadingPulseDuration: 1000             // half up, half down
    readonly property int cardLoadingPulsePause: 1000
    readonly property int cardLoadingCrossFadeDuration: 300          // curve 0 = Linear
    readonly property int splashIconSize: tablet ? 192 : 128         // luna.conf SplashIconSize; 192 on tablets
    readonly property int cardShuffleReorderDuration: 350            // curve 6 = OutCubic
    readonly property int cardGroupReorderDuration: 500              // conf/lunaAnimations.conf:43-46
    readonly property int cardDimmingDuration: 300
    readonly property int launcherReorderDuration: 300               // dynamicssettings.cpp:92-93 iconReorderIconMoveAnimTime, InQuad
    readonly property int launcherDuration: 350                      // conf/lunaAnimations.conf:83-84 (curve 15 InOutQuint)
    readonly property int quickLaunchDuration: 350                   // conf/lunaAnimations.conf:77-82
    readonly property int justTypeFadeDuration: 150                  // conf/lunaAnimations.conf:87-88
    readonly property int searchPillFadeDuration: 200                // conf/lunaAnimations.conf:81 quickLaunchFadeDuration

    // lunaAnimations.conf curve numbers map to QEasingCurve types:
    // 6 = OutCubic, 10 = OutQuart.
    readonly property int cardEasing: Easing.OutQuart
    readonly property int cardDeleteEasing: Easing.OutCubic

    // ---- Assets ------------------------------------------------------------

    // Original Open webOS artwork, shipped in shell/assets/openwebos, drawn
    // at this density: the best of name@1.5x / @2x / @3x / @4x.png beside it
    // for u (HiDpi.variant), or the 1x file itself, always when u is 1. The
    // variant's sourceSize is k times the art's, so size an image from it
    // with artPx(), and give a BorderImage artBorder() borders. See
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
    // How many times the 1x art's pixels a file returned by asset() has.
    function artScale(url) {
        return HiDpi.variantScale(url)
    }
    // px() of a length in the art's pixels, measured on a file that may be a
    // variant: Theme.artPx(sourceSize.width, source).
    function artPx(v, url) {
        return px(v / HiDpi.variantScale(url))
    }
    // A BorderImage border given in the 1x art's pixels, for its source
    // (Qt scales @2x / @3x borders itself; see HiDpi.borderScale).
    function artBorder(v, url) {
        return Math.round(v * HiDpi.borderScale(url))
    }
    // An app icon's file for drawing it `pixels` device pixels wide: the
    // icon, or a bigger one the app ships (`large`: appinfo.json's
    // splashicon; icon-256x256.png beside it) once the icon is too small.
    function appIcon(url, pixels, large) {
        return HiDpi.icon(url, pixels, large || "")
    }
}
