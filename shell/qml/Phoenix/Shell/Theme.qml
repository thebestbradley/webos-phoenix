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
    readonly property int statusBarClockFontSize: px(15)             // StatusBarClock.cpp:34
    // Phones: solid black (StatusBar.cpp:767). Tablet: tiled art over #515558 (StatusBar.cpp:47).
    readonly property color statusBarFill: tablet ? "#515558" : "#000000"

    // ---- Positive space / gesture area -------------------------------------

    // Settings.cpp:207-208 (phone default 24, luna.conf tablet 28)
    readonly property int positiveSpaceTopPadding: px(tablet ? 28 : 24)
    readonly property int positiveSpaceBottomPadding: px(tablet ? 28 : 24)

    // Phones had a physical gesture area below the screen. Modern phones do
    // not, so Phoenix reserves a thin on-screen strip that behaves the same
    // (swipe up = card view, swipe left = back). 0 disables it.
    property int gestureAreaHeight: tablet ? 0 : px(20)
    // Tablet bottom-edge flick (G1): where it starts, and how far it goes.
    readonly property int bezelEdgeHeight: px(8)                     // Phoenix: stands in for the bezel
    readonly property int bezelFlickMinimum: 30                       // Phoenix: as GestureArea's swipe
    readonly property int bezelFlickMinimumWithKeyboard: 60           // SystemUiController.cpp:72

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
    readonly property int launcherIconSize: px(64)                   // images/launcher3/launcher-icon-64.png
    readonly property int launcherTabHeight: px(50)                  // images/launcher3/tab-bg.png
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

    readonly property int bannerHeight: px(28)                       // positiveSpaceBottomPadding
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

    // Original Open webOS artwork, shipped in shell/assets/openwebos.
    function asset(path) {
        return Qt.resolvedUrl("../../../assets/openwebos/" + path)
    }
}
