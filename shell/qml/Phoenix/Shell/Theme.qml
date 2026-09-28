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

    // Set once by Shell.qml from the output size.
    property bool tablet: false
    // Device pixels per legacy pixel. 1.0 on a Pre, 1.5 on a Pre 3,
    // ~3.375 on a 1080px-wide modern phone.
    property real u: 1.0

    function px(v) { return Math.round(v * u) }

    // Reference canvases the scale factor is derived from.
    readonly property int phoneRefWidth: 320     // Pre, Pre 2, Pixi
    readonly property int tabletRefHeight: 768   // TouchPad (landscape)

    // ---- Typography -------------------------------------------------------

    // Legacy webOS used Prelude (conf/luna.conf [Fonts]), which is not
    // redistributable. We ask for it first so a user-installed copy is used,
    // then fall back to open fonts. See docs/LEGAL.md.
    readonly property string fontFamily: "Prelude"
    readonly property var fontFallbacks: ["Prelude", "Helvetica Neue", "Open Sans", "DejaVu Sans"]

    // ---- Status bar (luna-sysmgr/images/statusBar/status-bar-background.png is 28px tall)

    readonly property int statusBarHeight: px(28)
    readonly property int statusBarTitleMaxWidth: px(140)   // Src/base/settings/Settings.cpp:179
    readonly property int statusBarIconSpacing: px(4)
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
    readonly property int launcherColumns: tablet ? 5 : 3
    readonly property int launcherLabelFontSize: px(tablet ? 16 : 13)

    // ---- Lock screen ---------------------------------------------------------

    readonly property int lockDigitWidth: px(50)                     // images/screen-lock-clock-0.png
    readonly property int lockDigitHeight: px(80)
    readonly property int lockColonWidth: px(20)                     // images/screen-lock-clock-colon.png
    readonly property int lockPadlockSize: px(100)                   // images/screen-lock-padlock-off.png
    readonly property real lockClockCenterRatio: 0.15                // LockWindow.cpp:427 (-0.35 H from centre)
    readonly property real lockHandleOffsetRatio: 0.10               // LockWindow.cpp:81 LOCK_BUTTON_OFFSET
    readonly property int lockUnlockDistance: px(146)                // LockWindow.cpp:89
    readonly property int lockHelpFontSize: px(20)                   // LockWindow.cpp:91

    // ---- Notifications -------------------------------------------------------

    readonly property int bannerHeight: px(28)                       // positiveSpaceBottomPadding
    readonly property int bannerFontSize: px(16)                     // BannerMessageHandler.cpp:67
    readonly property int bannerSlideDuration: 1000                  // BannerMessageHandler.cpp:122-130
    readonly property int bannerShowTime: 5000                       // BannerMessageHandler.cpp:69
    readonly property int bannerShowTimeQueued: 2000                 // BannerMessageHandler.cpp:70
    readonly property int dashboardItemHeight: px(52)                // DashboardWindowContainer.cpp:48
    readonly property real maximumNegativeSpaceRatio: 0.55           // Settings.cpp MaximumNegativeSpaceHeightRatio
    readonly property int alertFadeDuration: 400                     // DashboardWindowManager.cpp:559,589
    readonly property int positiveSpaceDuration: 400                 // conf/lunaAnimations.conf:73-74, curve 6 OutCubic
    readonly property real dashboardDismissRatio: 0.25               // DashboardWindowContainer.cpp:350-363

    // Phones round the corners of the app area with 24px overlays.
    readonly property int screenCornerSize: px(24)                   // MenuWindowManager.cpp:126-146

    // ---- Colors --------------------------------------------------------------

    readonly property color black: "#000000"
    readonly property color text: "#ffffff"
    readonly property color textDim: "#a0a0a0"
    readonly property color launcherScrim: "#e64f545a"               // SystemUiController.cpp:69-70 (#4F545A); alpha inferred
    readonly property color highlight: "#3a8bd9"                     // (inferred)

    // ---- Animation (conf/lunaAnimations.conf [Cards]) -----------------------

    readonly property int cardLaunchDuration: 400
    readonly property int cardSlideDuration: 300                     // curve 10 = OutQuart
    readonly property int cardMaximizeDuration: 300                  // curve 10 = OutQuart
    readonly property int cardMinimizeDuration: 300                  // minimize is a cardSlide
    readonly property int cardDeleteDuration: 300                    // curve 6 = OutCubic
    readonly property int cardShuffleReorderDuration: 350            // curve 6 = OutCubic
    readonly property int cardGroupReorderDuration: 500              // conf/lunaAnimations.conf:43-46
    readonly property int cardDimmingDuration: 300
    readonly property int cardLoadingPulseDuration: 1000
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
