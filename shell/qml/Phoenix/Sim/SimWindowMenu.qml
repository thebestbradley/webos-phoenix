// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's Window menu: the cards open on the simulated device, to
// choose the one to view, and the shell's views around them. It belongs to
// the simulator's window, as a desktop app's Window menu, not to the
// device, so there is no webOS original to follow; what it does on the
// device is the shell's own (below).
//
// The cards are card view's, in its order and stacks (CardView.groups):
// each stack's first card, then the cards stacked on it (a window the app
// opened, a card it launched into its stack). Headless apps, system
// windows (popup alerts, dashboards, the emergency window) and modal cards
// have no place in card view and are not listed. Each shows the card's
// title (the app's, or the window's own: "New Email") and the app's icon;
// a check mark is on the card in front while it is maximized.
//
// Choosing one brings it to the front, maximized, through the shell's own
// ways of bringing a card forward, so the two cannot drift apart:
//   - in card view, as a tap on it (CardView.maximize, the tap's);
//   - over a maximized card, the launcher, Just Type or dock mode, as an app
//     switched to from there or a card an app asks for (CardView.
//     focusLaunched: Shell.launch's, cardFocusRequested's); as the card
//     maximizes, the launcher, Just Type and the dashboard give way and
//     dock mode ends (Shell's onCardMaximized);
//   - locked, the same: the card comes to the front behind the lock screen
//     and shows once the user unlocks, as a card an app or a notification
//     asks for then does. Unlocking stays the user's.
// The fixed items are the shell's keyboard commands (Shell.shortcut, the
// hardware keyboard's: KeyboardShortcuts.js), which do nothing over the
// lock screen, in First Use or under the emergency window: there they are
// greyed.
//
// phoenix-sim (shell/sim/simchrome.cpp) lists `cards` (sim.qml simWindows)
// and calls show() (simShowWindow); sim.qml adds `actions` to its
// simActions, the list its menus and keys are made from.

import QtQuick

QtObject {
    id: menu

    // The shell (Shell.qml): its card view and its window source.
    property var shell: null
    readonly property var cardView: shell ? shell.cardView : null
    readonly property var windows: shell ? shell.source : null

    // [{uid, appId, title, icon, checked, child}] in card view's order:
    // child, a card stacked on its stack's first card.
    readonly property var cards: {
        var cv = cardView;
        if (!cv || !windows || !windows.cards)
            return [];
        _appsRevision;
        var groups = cv.groups;
        var front = cv.maximized ? cv.currentUid : "";
        var out = [];
        for (var g = 0; g < groups.length; ++g) {
            var uids = groups[g].uids;
            for (var k = 0; k < uids.length; ++k) {
                var i = cv.indexOf(uids[k]);
                if (i < 0)
                    continue;
                var c = windows.cards.get(i);
                var info = typeof windows.appInfo === "function" ? windows.appInfo(c.appId) : null;
                out.push({ uid: c.uid, appId: c.appId,
                           title: c.title || (info && info.title) || c.appId,
                           icon: info && info.icon ? String(info.icon) : "",
                           checked: c.uid === front, child: k > 0 });
            }
        }
        return out;
    }
    // The apps' titles and icons as they change (an app updated or
    // installed again while its card is open).
    property int _appsRevision: 0
    property Connections _appsWatch: Connections {
        target: menu.windows ? menu.windows.apps : null
        ignoreUnknownSignals: true
        function onDataChanged() { menu._appsRevision++; }
        function onRowsInserted() { menu._appsRevision++; }
        function onRowsRemoved() { menu._appsRevision++; }
        function onModelReset() { menu._appsRevision++; }
    }

    // Brings the card uid to the front, maximized (see above). False if
    // there is no such card in card view.
    function show(uid) {
        var cv = cardView;
        if (!cv || cv.groupIndexOf(uid) < 0)
            return false;
        _activity();
        var inCardView = !shell.locked && !shell.launcherOpen && !shell.justTypeOpen && !shell.dockMode
                         && (cv.maximizeProgress === 0 || cv.minimizing);
        if (inCardView)
            cv.maximize(uid);
        else
            cv.focusLaunched(uid);
        return true;
    }

    // The shell's keyboard commands can run (Shell.shortcut's own test).
    readonly property bool commandsAllowed: !!shell && !shell.locked && !shell.firstUse && !shell.emergencyShown
    // As a key does (SystemKeys' onChord): the screen stays lit.
    function _activity() {
        if (shell && shell.display)
            shell.display.activity();
    }
    function _command(action) {
        if (!commandsAllowed)
            return;
        _activity();
        shell.shortcut(action);
    }

    // For sim.qml's simActions (menu "window").
    readonly property var actions: [
        { id: "windowCardView", menu: "window", text: qsTr("Card View"),
          tip: qsTr("The open cards side by side, as the gesture up from an app shows them"),
          enabled: function () { return menu.commandsAllowed; },
          run: function () { menu._command("cardView"); } },
        // Opens it; Shell.shortcut's "launcher" closes it again when open.
        { id: "windowLauncher", menu: "window", text: qsTr("Launcher"),
          enabled: function () { return menu.commandsAllowed; },
          run: function () {
              if (menu.shell && !menu.shell.launcherOpen)
                  menu._command("launcher");
          } },
        { separator: true, menu: "window" },
        // Keys the shell and the simulator leave free (KeyboardShortcuts.js,
        // sim.qml's simActions): Shift+Command+] and [ switch tabs on a Mac.
        { id: "nextCard", menu: "window", text: qsTr("Next Card"), keys: ["Ctrl+Shift+]"],
          tip: qsTr("The card to the right, maximized if the one in front is"),
          enabled: function () { return menu.commandsAllowed && menu.cards.length > 1; },
          run: function () { menu._command("next"); } },
        { id: "previousCard", menu: "window", text: qsTr("Previous Card"), keys: ["Ctrl+Shift+["],
          tip: qsTr("The card to the left, maximized if the one in front is"),
          enabled: function () { return menu.commandsAllowed && menu.cards.length > 1; },
          run: function () { menu._command("previous"); } }
    ]
}
