// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The scenes tst_accessibility (phone) and tst_accessibilitytablet walk,
// and their checks: one shell, its window source and its status, driven
// into each main scene; a11y.js says what is not named there.

import QtQuick
import QtTest
import Phoenix.Shell
import "a11y.js" as A11y

QtObject {
    id: scenes
    property var test
    property var shell
    property var windows
    property var sys
    property var root

    function reset() {
        sys.textSize = 100;
        sys.boldText = false;
        sys.highContrast = false;
        sys.reduceMotion = false;
        sys.batteryPercent = 80;
        sys.charging = false;
        shell.unlock();
        var menu = find("systemMenu");
        if (menu)
            menu.open = false;
        shell.notifications.dashboardOpen = false;
        if (shell.justTypeOpen)
            shell.gestureBack();
        while (windows.cards.count > 0)
            windows.close(windows.cards.get(0).uid);
        while (windows.notifications.count > 0)
            windows.notifications.remove(0);
        var im = find("iconMenu");
        if (im)
            im.open = false;
        if (shell.launcherOpen)
            shell.gestureUp();
        test.tryCompare(shell, "launcherOpen", false, 2000);
    }
    function acc(o) { return o.Accessible; }
    function find(name, from) { return test.findChild(from || shell, name); }
    // No control on screen without a name.
    function noUnnamed(scene) {
        test.wait(50);
        var bad = A11y.unnamed(root, acc);
        test.verify(bad.length === 0, scene + ": " + bad.length + " controls without a name:\n  " + bad.join("\n  "));
    }
    function names() { return A11y.named(root, acc).map(function (n) { return n.name; }); }
    function hasName(re, scene) {
        var all = names();
        test.verify(all.some(function (n) { return re.test(n); }), scene + ": nothing named " + re + " in " + JSON.stringify(all));
    }
    function threeCards() {
        windows.launch("org.webosphoenix.email", "");
        windows.launch("org.webosphoenix.calendar", "");
        windows.launch("org.webosphoenix.memos", "");
        test.tryVerify(function () { return windows.cards.count === 3; }, 2000);
    }

    function lockScreen() {
        shell.lock();
        test.tryCompare(shell, "locked", true, 2000);
        test.wait(Theme.lockWindowFadeDuration + 100);
        noUnnamed("the lock screen");
        hasName(/unlock/i, "the lock screen");
    }
    function cardView() {
        threeCards();
        test.tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
        test.wait(600);
        noUnnamed("card view");
        hasName(/^Calendar, card 2 of 3$/, "card view");
    }
    function launcher() {
        shell.gestureUp();
        test.tryCompare(shell, "launcherOpen", true, 2000);
        test.wait(600);
        noUnnamed("the launcher");
        hasName(/^Settings$/, "the launcher");
        // An icon's menu (press and hold).
        verify(shell.openLauncherIconMenu(0) !== false);
        test.tryCompare(shell, "iconMenuOpen", true, 2000);
        test.wait(300);
        noUnnamed("an icon's menu");
        hasName(/Close the menu/, "an icon's menu");
    }
    function systemMenu() {
        shell.openSystemMenu();
        var menu = find("systemMenu");
        test.tryCompare(menu, "opacity", 1, 2000);
        noUnnamed("the system menu");
        hasName(/^Wi-Fi/, "the system menu");
        hasName(/^Turn on Airplane Mode$/, "the system menu");
        hasName(/^Battery: 80%$/, "the system menu");
        hasName(/^Brightness$/, "the system menu");
        var airplane = A11y.named(root, acc).filter(function (n) { return /Airplane/.test(n.name); })[0];
        test.compare(airplane.description, "Off", "a toggle says its state");
    }
    function dashboard() {
        windows.notify("org.webosphoenix.messaging", "Palm Pre", "It's good to be back.");
        windows.notify("org.webosphoenix.email", "Mail", "Two");
        test.wait(300);
        noUnnamed("a banner");
        shell.notifications.dashboardOpen = true;
        test.wait(800);
        noUnnamed("the dashboard");
        hasName(/Palm Pre/, "the dashboard");
    }
    function justType() {
        shell.startJustType("abc");
        test.tryCompare(shell, "justTypeOpen", true, 2000);
        test.wait(400);
        noUnnamed("Just Type");
    }
    function statusBar() {
        var bar = find("statusBar");
        var spoken = A11y.named(bar, acc).map(function (n) { return n.name + (n.description ? " (" + n.description + ")" : ""); }).join(" | ");
        test.verify(/Battery, 80 percent/.test(spoken), "the battery's level is spoken: " + spoken);
        test.verify(/9:41/.test(spoken), "the time: " + spoken);
        test.verify(/Wi-Fi, \d of 3 bars|Wi-Fi/.test(spoken), "Wi-Fi: " + spoken);
        sys.charging = true;
        spoken = A11y.named(bar, acc).map(function (n) { return n.name; }).join(" | ");
        test.verify(/80 percent, charging/.test(spoken), "charging: " + spoken);
    }
    // Text that does not fit its box (a clipped line), under item.
    function clipped(item) {
        var out = [];
        function walk(o) {
            if (!o || !o.visible)
                return;
            if (o.hasOwnProperty("textFormat") && o.hasOwnProperty("lineCount") && o.text !== "" && o.parent
                    && o.parent.height > 0 && o.implicitHeight > o.parent.height + 0.5 && o.parent.clip !== false)
                out.push(o.text + " (" + o.implicitHeight + " in " + o.parent.height + ")");
            // ... or runs past the screen's right edge.
            if (o.hasOwnProperty("textFormat") && o.hasOwnProperty("lineCount") && o.text !== "" && o.opacity > 0) {
                var r = o.mapToItem(root, 0, 0);
                var w = o.elide !== Text.ElideNone || o.wrapMode !== Text.NoWrap ? Math.min(o.width, o.contentWidth) : o.contentWidth;
                if (r.x + w > root.width + 0.5)
                    out.push(o.text + " (past the edge: " + Math.round(r.x + w) + " of " + root.width + ")");
            }
            for (var i = 0; i < (o.children || []).length; ++i)
                walk(o.children[i]);
        }
        walk(item);
        return out;
    }
    function textSize() {
        var clock = find("centreClock").visible ? find("centreClock") : find("tabletClock");
        compare(Theme.statusBarFontSize, Theme.px(14));
        compare(Theme.systemMenuRowHeight, Theme.px(42), "1x: the original's rows");
        compare(clock.font.pixelSize, Theme.px(15));
        sys.textSize = 150;
        compare(Theme.textSize, 150);
        verify(clock.font.pixelSize > Theme.px(15), "the clock follows Text size at once (" + clock.font.pixelSize + ")");
        verify(Theme.statusBarFontSize > Theme.px(14), "the status bar's text too");
        verify(clock.height <= Theme.statusBarHeight, "and still fits the bar (" + clock.height + ")");
        compare(Theme.fontPx(16), Math.round(Theme.px(16) * 1.5), "elsewhere, 150%");
        // The system menu's rows grow with their text: nothing clipped.
        shell.openSystemMenu();
        var menu = find("systemMenu");
        test.tryCompare(menu, "opacity", 1, 2000);
        var date = find("systemMenuDate", menu);
        verify(date.height > Theme.px(42), "rows grow with their text (" + date.height + ")");
        var bad = clipped(menu);
        verify(bad.length === 0, "no text clipped in the system menu: " + bad.join(", "));
        menu.open = false;
        // The dashboard's rows too.
        windows.notify("org.webosphoenix.messaging", "Palm Pre", "It's good to be back.");
        shell.notifications.dashboardOpen = true;
        test.wait(600);
        verify(Theme.dashboardItemHeight > Theme.px(52), "dashboard rows grow (" + Theme.dashboardItemHeight + ")");
        bad = clipped(shell.notifications);
        verify(bad.length === 0, "no text clipped in the dashboard: " + bad.join(", "));
        shell.notifications.dashboardOpen = false;
        sys.textSize = 100;
        compare(clock.font.pixelSize, Theme.px(15), "and back");
    }
    function compare(a, b, m) { test.compare(a, b, m); }
    function verify(c, m) { test.verify(c, m); }
    function boldText() {
        test.compare(Theme.textWeight, Font.Normal);
        sys.boldText = true;
        test.compare(Theme.textWeight, Font.DemiBold);
        var clock = find("centreClock") || find("tabletClock");
        test.compare(clock.font.weight, Font.DemiBold);
    }
    function highContrast() {
        var dimBefore = Qt.lighter(Theme.textDim, 1.0);
        shell.gestureUp();
        test.tryCompare(shell, "launcherOpen", true, 2000);
        test.wait(600);
        function plates() {
            var n = 0;
            (function walk(o) {
                if (!o || !o.visible) return;
                if (o.objectName === "labelPlate") ++n;
                for (var i = 0; i < (o.children || []).length; ++i) walk(o.children[i]);
            })(find("launcher"));
            return n;
        }
        compare(plates(), 0, "no label plates by default");
        sys.highContrast = true;
        verify(Theme.highContrast);
        verify(plates() > 0, "the launcher's labels on a dark plate");
        // WCAG AA: 4.5:1 for text, on the shell's darkest and lightest
        // backings (black, the menus' grey, the tablet's status bar).
        var pairs = [[Theme.textDim, "#000000"], [Theme.systemMenuTextDim, "#3a3a3a"], [Theme.launcherTabColor, "#4F545A"],
                     [Theme.text, Theme.statusBarFill], ["#ffffff", Qt.rgba(0, 0, 0, 0.75)]];
        for (var i = 0; i < pairs.length; ++i)
            verify(Theme.contrastRatio(pairs[i][0], pairs[i][1]) >= 4.5,
                   "AA: " + pairs[i][0] + " on " + pairs[i][1] + " is " + Theme.contrastRatio(pairs[i][0], pairs[i][1]).toFixed(2));
        verify(Theme.contrastRatio(Theme.textDim, "#000000") > Theme.contrastRatio(dimBefore, "#000000"), "dim text is stronger");
        verify(Theme.contrastBorderWidth > 0, "outlines are drawn");
        shell.gestureUp();
        test.tryCompare(shell, "launcherOpen", false, 2000);
        shell.openSystemMenu();
        var menu = find("systemMenu");
        test.tryCompare(menu, "opacity", 1, 2000);
        var outline = test.findChild(menu, "contrastOutline");
        verify(outline && outline.visible && outline.border.width > 0, "the system menu is outlined");
        sys.highContrast = false;
        verify(!outline.visible, "and not without high contrast");
    }
    function reduceMotion() {
        sys.reduceMotion = true;
        verify(Theme.reduceMotion);
        compare(Theme.cardDeleteDuration, 1);
        compare(Theme.cardGhostDuration, 1);
        // A card thrown away in card view goes at once.
        threeCards();
        test.tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
        var uid = windows.cards.get(1).uid;
        shell.cardView.close(uid);
        test.tryCompare(windows.cards, "count", 2, 150);
        sys.reduceMotion = false;
        verify(Theme.cardDeleteDuration > 1, "and animates again without it");
    }
}
