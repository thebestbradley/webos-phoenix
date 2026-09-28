// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// HiDPI art: which file Theme.asset() and Theme.appIcon() pick for the
// density, and that the picked art keeps its size and borders
// (docs/spec/hidpi-art.md).
// Run: qmltestrunner -import qml -import <build>/qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Native

Item {
    id: root
    width: 320
    height: 480

    readonly property url calculator: Qt.resolvedUrl("../../third_party/core-apps/com.palm.app.calculator/icon.png")
    readonly property url clock: Qt.resolvedUrl("../../third_party/core-apps/com.palm.app.clock/icon.png")
    readonly property url calendar: Qt.resolvedUrl("../../third_party/core-apps/com.palm.app.calendar/images/icon.png")
    readonly property url phone: Qt.resolvedUrl("../../apps/phone/public/icon.png")
    readonly property url wifiIcon: Qt.resolvedUrl("../../apps/settings/public/icons/wifi.png")

    function fileName(url) {
        var s = String(url);
        return s.substring(s.lastIndexOf("/") + 1);
    }

    Image {
        id: wifi
        source: Theme.asset("statusBar/wifi-3.png")
        width: Theme.artPx(sourceSize.width, source)
        height: Theme.artPx(sourceSize.height, source)
    }
    BorderImage {
        id: menuBg
        width: Theme.px(300)
        height: Theme.px(200)
        source: Theme.asset("menu-dropdown-bg.png")
        border { left: Theme.artBorder(30, source); top: Theme.artBorder(10, source); right: Theme.artBorder(30, source); bottom: Theme.artBorder(30, source) }
    }
    BorderImage {
        id: pill
        width: Theme.px(300)
        height: Theme.px(50)
        source: Theme.asset("launcher3/search-field-bg-launcher.png")
        border { left: Theme.artBorder(40, source); right: Theme.artBorder(40, source); top: 0; bottom: 0 }
    }
    CardLoading {
        id: loading
        width: 320
        height: 452
        active: true
        icon: root.calculator
    }
    AppIcon {
        id: appIcon
        showLabel: false
        interactive: false
        source: root.calculator
    }

    TestCase {
        name: "HiDpi"
        when: windowShown

        function cleanup() {
            Theme.u = 1;
            appIcon.size = Qt.binding(function() { return Theme.launcherIconSize; });
            appIcon.source = root.calculator;
            appIcon.largeSource = "";
        }

        function test_oneXArtIsTheArtItself() {
            Theme.u = 1;
            compare(String(Theme.asset("statusBar/wifi-3.png")), String(Theme.assetUrl("statusBar/wifi-3.png")));
            compare(String(Theme.asset("spinner.png")), String(Theme.assetUrl("spinner.png")));
            compare(Theme.artScale(Theme.asset("statusBar/wifi-3.png")), 1);
            // Below 1 too.
            compare(String(Theme.variant(Theme.assetUrl("spinner.png"), 0.75)), String(Theme.assetUrl("spinner.png")));
        }

        function test_smallestVariantAtLeastTheDensity() {
            var cases = [
                [1.25, "wifi-3@2x.png"], [1.5, "wifi-3@2x.png"], [2, "wifi-3@2x.png"],
                [2.25, "wifi-3@3x.png"], [3, "wifi-3@3x.png"],
                // None big enough: the biggest there is.
                [4, "wifi-3@3x.png"]
            ];
            for (var i = 0; i < cases.length; ++i) {
                Theme.u = cases[i][0];
                compare(root.fileName(Theme.asset("statusBar/wifi-3.png")), cases[i][1], "u = " + cases[i][0]);
            }
            // The Onyx original at 1.5, then the enlarged ones.
            Theme.u = 1.5;
            compare(root.fileName(Theme.asset("spinner.png")), "spinner@1.5x.png");
            compare(Theme.artScale(Theme.asset("spinner.png")), 1.5);
            Theme.u = 2;
            compare(root.fileName(Theme.asset("spinner.png")), "spinner@2x.png");
            // The menu art: only its 1.5x original.
            compare(root.fileName(Theme.asset("menu-dropdown-bg.png")), "menu-dropdown-bg@1.5x.png");
        }

        function test_artWithoutVariantsStaysOneX() {
            Theme.u = 2;
            compare(String(Theme.asset("launcher3/tab-bg.png")), String(Theme.assetUrl("launcher3/tab-bg.png")));
            // Directories (the keyboards' art root) come back as they are.
            compare(String(Theme.asset("keyboard-phone/")), String(Theme.assetUrl("keyboard-phone/")));
        }

        function test_variantKeepsTheArtsSize() {
            Theme.u = 1;
            tryCompare(wifi, "status", Image.Ready);
            var w = wifi.width, h = wifi.height;
            Theme.u = 2;
            tryCompare(wifi, "status", Image.Ready);
            compare(root.fileName(wifi.source), "wifi-3@2x.png");
            compare(wifi.sourceSize.width, 2 * w);
            compare(wifi.width, 2 * w);
            compare(wifi.height, 2 * h);
            Theme.u = 3;
            tryCompare(wifi, "status", Image.Ready);
            compare(wifi.width, 3 * w);
        }

        function test_borderImageBorders() {
            Theme.u = 1;
            compare(menuBg.border.left, 30);
            compare(pill.border.left, 40);
            // @1.5x: Qt reads it as 1x, so the borders are scaled here.
            Theme.u = 1.5;
            compare(root.fileName(menuBg.source), "menu-dropdown-bg@1.5x.png");
            compare(menuBg.border.left, 45);
            compare(menuBg.border.top, 15);
            // @2x: Qt scales a BorderImage's borders by the file's ratio itself.
            Theme.u = 2;
            compare(root.fileName(pill.source), "search-field-bg-launcher@2x.png");
            compare(pill.border.left, 40);
            compare(HiDpi.borderScale(pill.source), 1);
            compare(HiDpi.borderScale(menuBg.source), 1.5);
        }

        function test_appIconKeepsTheIconWhileItIsBigEnough() {
            compare(String(Theme.appIcon(root.calculator, 64)), String(root.calculator));
            compare(String(Theme.appIcon(root.calculator, 48)), String(root.calculator));
            // Not the clock's icon-48.png at 48: the icon itself.
            compare(String(Theme.appIcon(root.clock, 48)), String(root.clock));
        }

        function test_appIconTakesTheBiggerOne() {
            compare(root.fileName(Theme.appIcon(root.calculator, 128)), "icon-256x256.png");
            compare(root.fileName(Theme.appIcon(root.clock, 96)), "icon-256x256.png");
            // Calendar keeps its icons in images/.
            compare(root.fileName(Theme.appIcon(root.calendar, 160)), "icon-256x256.png");
            // Phoenix's own, rendered at 256 (render-icon.cjs), and a launch point's.
            compare(root.fileName(Theme.appIcon(root.phone, 128)), "icon-256x256.png");
            compare(root.fileName(Theme.appIcon(root.wifiIcon, 128)), "wifi-256x256.png");
            // Bigger than any: the biggest.
            compare(root.fileName(Theme.appIcon(root.calculator, 1000)), "icon-256x256.png");
            // The app's splashicon, when it names one.
            var email = Qt.resolvedUrl("../../third_party/core-apps/com.palm.app.email/icon.png");
            var mail256 = Qt.resolvedUrl("../../third_party/core-apps/com.palm.app.email/images/Mail-2-1a-256.png");
            compare(String(Theme.appIcon(email, 128, mail256)), String(mail256));
            // Not a file: as it is.
            compare(String(Theme.appIcon("https://example.com/icon.png", 128)), "https://example.com/icon.png");
        }

        function test_loadingCardSizesFromTheIconDrawsTheBiggerOne() {
            // One and a half times the 64 px icon: 96 px, from the 256 px one.
            var img = null;
            for (var i = 0; i < loading.children.length; ++i)
                if (loading.children[i].hasOwnProperty("side"))
                    img = loading.children[i];
            verify(img);
            compare(img.side, 96);
            compare(img.width, 96);
            compare(root.fileName(img.source), "icon-256x256.png");
            compare(img.sourceSize.width, 96);
            Theme.u = 2;
            compare(img.width, 192);
            compare(img.sourceSize.width, 192);
        }

        function test_appIconDrawsTheBiggerOneAtItsSize() {
            var img = findChild(appIcon, "iconImage");
            verify(img);
            Theme.u = 1;
            compare(String(img.source), String(root.calculator));
            // Decoded as it is: exactly the 1x drawing.
            compare(img.sourceSize.width, 64);
            Theme.u = 2;
            compare(appIcon.size, 128);
            compare(root.fileName(img.source), "icon-256x256.png");
            tryCompare(img, "status", Image.Ready);
            // Decoded at the drawn size.
            compare(img.sourceSize.width, 128);
            compare(img.width, 128);
        }
    }
}
