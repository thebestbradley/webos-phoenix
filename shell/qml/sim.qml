// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Desktop simulator entry point (loaded by phoenix-sim).
//
// Context properties set by phoenix-sim:
//   simScene       "locked" | "cards" | "stacks" | "longstack" | "reorder" | "maximized" | "heldcard" | "launcher" |
//                  "launcheredit" | "pin" | "emergency" | "firstuse" | "lowbattery" | "banner" | "notified" | "dashboard" | "drawer" | "capture" | "capturepreview" |
//                  "justtype" | "keyboard" | "clipstrip" | "assistant" | "assistantbird" | "assistantbirds" | "assistantbirdmoves" |
//                  "wakeword" | "wakewordlocked" |
//                  "systemmenu" | "empty"
//   simFirstUse    start with First Use (--first-use); without it First Use
//                  runs at start-up until it has been done once
//                  (simSettings "firstuse/done", set when the app reports the
//                  system preference firstUseComplete), unless a scene or an
//                  app to launch was given
//   simFormFactor  "auto" | "phone" | "tablet"
//   simDensity     device pixels per legacy pixel (--scale, default 1)
//   simHomeButton  the device has a hardware Home button instead of the
//                  gesture bar (--home-button; the Home key presses it)
//   simLaunch      app ids to launch (--launch)
//   simOpen        a web address to open in the browser (--open)
//   simDisplayWidth, simDisplayHeight  the window's size at start-up, upright (--size);
//                  after that the screen follows the window
//   simOrientation how the device is held at start-up (--orientation)
//   simTurn        an orientation to turn the device to after a second (--turn)
//   simBootSounds  play the boot and shutdown sounds (not with --quiet,
//                  --screenshot or the offscreen platform)
//   simTouchstone  start on a Touchstone, in dock mode (--touchstone; F12
//                  sets the device on one or lifts it off)
//   simBootAnimation  start with the boot animation (not with --screenshot,
//                  the offscreen platform or --no-boot-animation; always
//                  with --boot-animation)
//   simUpdating    the boot after a system update: "Updating the system"
//                  (phoenix-sim restarts itself with --updating)
//   simSecurityPolicy  --security-policy as a com.palm.securitypolicy:1
//                  object (JSON), "none" to remove it, "" to leave it be
//   simUsb, simUsbBusy  --usb (a cable from a computer is in), --usb-busy
//                  (an app keeps a file open on the USB drive)
//   simTouchToShare  --touch-to-share: a Touch to Share phone in range
//                  from the start (Shift+F7 / Ctrl+F7)
//   simChrome      phoenix-sim's window around the screen, with its menus and
//                  toolbar (SimChrome), or null: resizeScreen(w, h)

import QtQuick
import Phoenix.Native
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    // The simulated device's status (tests).
    readonly property var simStatus: status

    // ---- The simulated device ----------------------------------------------------
    // The window shows the device as it is held: turned on its side it is a
    // landscape window with the device's screen turned in it, so a UI that
    // followed the turn reads upright, and one held by the rotation lock or
    // an app reads sideways, as it would in the hand.

    readonly property var orientations: ["up", "left", "down", "right"]   // counter-clockwise
    readonly property int deviceAngle: 90 * Math.max(0, orientations.indexOf(status.deviceOrientation))
    // The device's screen is the window, turned back by how the device is
    // held: --size only sets the window it starts in. Resize the window and
    // the screen takes the new size (a bigger tablet, a narrower phone), and
    // the shell lays itself out again.
    readonly property bool sideways: deviceAngle % 180 !== 0

    // ---- Adaptive: a phone or a tablet by the window's size ---------------------------
    // Without --phone or --tablet (--adaptive, ./phoenix run) the shell's
    // formFactor is "auto": it is a tablet while the screen's shorter side
    // is at least Theme.tabletMinSide legacy pixels, a phone below, and
    // switches live as the window is resized (Shell.tablet is a binding;
    // every surface follows Theme.tablet), the apps running on. The pages
    // hear of it as of a turn: their window resizes, and the system status
    // carries the screen and the form factor (PalmSystem.deviceInfo).
    readonly property bool adaptive: shell.formFactor === "auto"
    // The screen, upright, in legacy pixels.
    readonly property int screenWidth: Math.round(device.width / shell.effectiveDensity)
    readonly property int screenHeight: Math.round(device.height / shell.effectiveDensity)
    // View > Device Size: legacy pixels, upright (the TouchPad is upright
    // on its side, as --tablet starts it). The Pre 3 is 480x800 at 1.5.
    readonly property var devicePresets: [
        { id: "pre", text: qsTr("Pre, Pixi, Veer (320x480)"), width: 320, height: 480 },
        { id: "pre3", text: qsTr("Pre 3 (320x533; 480x800 at 1.5x)"), width: 320, height: 533 },
        { id: "phone", text: qsTr("Modern Phone (393x852)"), width: 393, height: 852 },
        { id: "folded", text: qsTr("Foldable, Folded (344x882)"), width: 344, height: 882 },
        { id: "unfolded", text: qsTr("Foldable, Open (690x829)"), width: 690, height: 829 },
        { id: "touchpad", text: qsTr("TouchPad (1024x768)"), width: 1024, height: 768 },
        { id: "tablet", text: qsTr("Modern Tablet (1180x820)"), width: 1180, height: 820 }
    ]
    // The window at a preset's size, as the device is held now.
    function snapToPreset(id) {
        var p = devicePresets.filter(function (d) { return d.id === id; })[0];
        if (p)
            resizeScreen(p.width, p.height);
    }
    // The screen (upright, legacy pixels) at this size; the window turns it
    // as the device is held.
    function resizeScreen(width, height) {
        var w = Math.round(width * shell.effectiveDensity), h = Math.round(height * shell.effectiveDensity);
        if (sideways) {
            var t = w;
            w = h;
            h = t;
        }
        var win = root.Window.window;
        if (typeof simChrome !== "undefined" && simChrome) {
            simChrome.resizeScreen(w, h);
        } else if (win) {
            win.width = w;
            win.height = h;
        }
    }
    // The pages: the form factor and the screen as they change (resizing
    // the window is a stream of sizes: the last one, a moment after).
    function pushScreen() {
        windows.pushSystemStatus({ formFactor: shell.tablet ? "tablet" : "phone",
                                   screen: { width: screenWidth, height: screenHeight } });
    }
    Timer {
        id: screenPush
        interval: 150
        onTriggered: root.pushScreen()
    }
    onScreenWidthChanged: screenPush.restart()
    onScreenHeightChanged: screenPush.restart()
    Connections {
        target: shell
        // After the size it switched at has reached everything.
        function onTabletChanged() { Qt.callLater(root.layoutSwitched); }
    }
    function layoutSwitched() {
        pushScreen();
        console.info("phoenix-sim: " + (shell.tablet ? "tablet" : "phone") + " layout at " + screenWidth + "x" + screenHeight);
    }
    // The browser's pages ask for the phone's or the desktop's site by it.
    Binding {
        when: typeof simBrowser !== "undefined" && simBrowser !== null
        target: typeof simBrowser !== "undefined" ? simBrowser : null
        property: "phone"
        value: !shell.tablet
    }
    // The window's title says what the screen is.
    readonly property string screenInfo: "%1x%2, %3%4".arg(screenWidth).arg(screenHeight)
        .arg(shell.tablet ? qsTr("tablet") : qsTr("phone")).arg(adaptive ? qsTr(" (adaptive)") : "")
    onScreenInfoChanged: if (typeof simChrome !== "undefined" && simChrome) simChrome.setScreenInfo(screenInfo)

    Item {
        id: device
        anchors.centerIn: parent
        width: root.sideways ? root.height : root.width
        height: root.sideways ? root.width : root.height
        rotation: -root.deviceAngle

        Shell {
            id: shell
            anchors.fill: parent
            formFactor: typeof simFormFactor !== "undefined" ? simFormFactor : "auto"
            density: typeof simDensity !== "undefined" ? simDensity : 1
            hardwareHomeButton: typeof simHomeButton !== "undefined" && simHomeButton
            // The phones and the TouchPad of luna-sysmgr's day had one
            // ([VirtualKeyboard] VirtualKeyboardEnabled).
            virtualKeyboard: true
            dictationCommand: typeof simTranscriberCommand !== "undefined" ? simTranscriberCommand : []
            dictationInputFiles: typeof simMicrophoneFiles !== "undefined" ? simMicrophoneFiles : []
            wakeWordCommand: typeof simWakeWordCommand !== "undefined" ? simWakeWordCommand : []
            localModelsDir: typeof simModelsDir !== "undefined" ? simModelsDir : ""
            llamaServerCommand: typeof simLlamaServer !== "undefined" ? simLlamaServer : []
            speechCommand: typeof simSpeechCommand !== "undefined" ? simSpeechCommand : []
            bootSound: typeof simBootSounds !== "undefined" && simBootSounds
            bootAnimation: typeof simBootAnimation !== "undefined" && simBootAnimation
            bootUpdating: typeof simUpdating !== "undefined" && simUpdating
            stayAwake: typeof simStayAwake !== "undefined" && simStayAwake
            // A desktop window has no Power button a Mac keyboard reaches
            // (F3 is Mission Control there): a click wakes the dark screen.
            tapToWake: true
            // The launch-at-boot apps start with the simulator, as with
            // LunaSysMgr (WebAppMgrProxy.cpp:117).
            source: SimWindowSource { id: windows; bootAppsEnabled: true }
            system: SimSystemStatus {
                id: status
                // Fixed clock for reproducible screenshots.
                fixedTime: typeof simScene !== "undefined" && simScene !== "" ? new Date(2009, 5, 6, 9, 41) : null
                deviceOrientation: typeof simOrientation !== "undefined" && simOrientation !== "" ? simOrientation : "up"
            }
        }

        // "assistantbird": the Assistant's bird (docs/ASSISTANT-CHARACTER.md)
        // going through its twelve poses, a few seconds each, large, for
        // review; "assistantbirds": all twelve at once, a contact sheet;
        // "assistantbirdmoves": its moves one after another (the entrance,
        // each idle of the pool, each reaction, the exit), large.
        // Over the shell, on the storyboard's dark ground; the frame rate
        // counter at the bottom left.
        Loader {
            anchors.fill: shell
            active: root.scene === "assistantbird" || root.scene === "assistantbirds" || root.scene === "assistantbirdmoves"
            sourceComponent: Rectangle {
                id: review
                color: "#1E1C22"
                readonly property var poses: Object.keys(reviewProbe.art.poses)
                property int index: 0
                MouseArea { anchors.fill: parent }
                FpsCounter {
                    id: reviewFps
                    anchors.left: parent.left
                    anchors.bottom: parent.bottom
                    z: 1
                }
                // The frame rate over the last two seconds, to the log.
                Timer {
                    running: true
                    interval: 2000
                    repeat: true
                    onTriggered: {
                        var h = reviewFps.history.filter(function (e) { return e.time > Date.now() - 2000; });
                        if (h.length === 0)
                            return;
                        var sum = 0, low = 1000;
                        h.forEach(function (e) { sum += e.fps; low = Math.min(low, e.fps); });
                        console.info("Bird review: " + Math.round(sum / h.length) + " fps (lowest " + low + ")");
                    }
                }
                AssistantBird { id: reviewProbe; visible: false }
                // One at a time.
                Item {
                    anchors.fill: parent
                    visible: root.scene === "assistantbird"
                    AssistantBird {
                        id: big
                        objectName: "reviewBird"
                        width: Math.round(Math.min(parent.width * 0.6, parent.height * 0.5))
                        anchors.centerIn: parent
                        pose: review.poses[review.index]
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.top: big.bottom
                        anchors.topMargin: Theme.px(8)
                        text: (review.index + 1) + " / " + review.poses.length + "   " + big.art.poses[big.pose].label
                        color: "#F4EEE6"
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(Theme.tablet ? 28 : 20)
                    }
                    Timer {
                        running: root.scene === "assistantbird"
                        interval: 2600
                        repeat: true
                        onTriggered: review.index = (review.index + 1) % review.poses.length
                    }
                }
                // Its moves, one after another, with a pause between.
                Item {
                    anchors.fill: parent
                    visible: root.scene === "assistantbirdmoves"
                    readonly property var moves: {
                        var m = reviewProbe.art.motion.moves, order = ["enter"];
                        Object.keys(m).forEach(function (n) { if (m[n].kind === "idle") order.push(n); });
                        Object.keys(m).forEach(function (n) { if (m[n].kind === "react") order.push(n); });
                        return order.concat(["leave"]);
                    }
                    property int at: -1
                    AssistantBird {
                        id: mover
                        objectName: "reviewMoves"
                        width: Math.round(Math.min(parent.width * 0.45, parent.height * 0.4))
                        anchors.horizontalCenter: parent.horizontalCenter
                        y: Math.round(parent.height * 0.3)
                        glow: true
                        fidgety: false
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.top: mover.bottom
                        anchors.topMargin: Theme.px(8)
                        text: parent.at >= 0 ? (parent.at + 1) + " / " + parent.moves.length + "   " + parent.moves[parent.at] : ""
                        color: "#F4EEE6"
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(Theme.tablet ? 28 : 20)
                    }
                    Timer {
                        running: root.scene === "assistantbirdmoves"
                        interval: 2800
                        repeat: true
                        triggeredOnStart: true
                        onTriggered: {
                            var p = parent;
                            p.at = (p.at + 1) % p.moves.length;
                            var name = p.moves[p.at];
                            if (name === "enter")
                                mover.enter(0);
                            else if (name === "leave")
                                mover.leave();
                            else
                                mover.play(name);
                        }
                    }
                }
                // All at once.
                Grid {
                    visible: root.scene === "assistantbirds"
                    anchors.centerIn: parent
                    columns: review.width > review.height ? 4 : 3
                    readonly property real cellWidth: Math.floor(review.width / columns)
                    readonly property real cellHeight: Math.floor((review.height - Theme.statusBarHeight) / Math.ceil(review.poses.length / columns))
                    Repeater {
                        model: root.scene === "assistantbirds" ? review.poses : []
                        delegate: Item {
                            required property string modelData
                            width: parent.cellWidth
                            height: parent.cellHeight
                            AssistantBird {
                                id: one
                                width: Math.round(Math.min(parent.width * 0.7, (parent.height - label.height) * 0.8 / 1.1))
                                anchors.horizontalCenter: parent.horizontalCenter
                                y: Math.round(parent.height * 0.12)
                                pose: parent.modelData
                            }
                            Text {
                                id: label
                                anchors.horizontalCenter: parent.horizontalCenter
                                anchors.top: one.bottom
                                text: one.art.poses[one.pose].label
                                color: "#F4EEE6"
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.px(Theme.tablet ? 18 : 13)
                            }
                        }
                    }
                }
            }
        }
    }

    // The screen's state (Shell.display): dimmed or off. A device sets its
    // backlight; here the screen darkens, to a tenth of its brightness when
    // dimmed (DisplayManager::displayDim) and black when off.
    Rectangle {
        anchors.fill: parent
        color: "black"
        // Dock mode's night mode: the night brightness, 1 of 100
        // (DockModeNightBrightness), darker still. In dim or dark light the
        // light sensor turns the backlight down (Display.brightness, from
        // the user's brightness): darker by as much.
        opacity: shell.display.state === "off" ? 1 : shell.display.state === "dim" ? 0.9 : shell.display.night ? 0.95
                 : Math.max(0, 1 - shell.display.brightness / Math.max(1, shell.display.maximumBrightness)) * 0.75
        visible: opacity > 0
        Behavior on opacity { enabled: shell.display.state !== "off"; NumberAnimation { duration: 300 } }
        // The simulator says what a dark device would not.
        Text {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 16
            visible: shell.display.state === "off"
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            text: qsTr("Screen off. Click to wake it (or F3, Power).")
            color: "#777777"
            font.family: Theme.fontFamily
            font.pixelSize: 13
        }
    }

    // Turn the device a quarter turn (steps: 1 counter-clockwise, -1
    // clockwise) or to an orientation; the window turns with it.
    function turnDevice(to) {
        var from = status.deviceOrientation;
        if (typeof to === "number")
            to = orientations[(orientations.indexOf(from) + to + 4) % 4];
        if (orientations.indexOf(to) < 0 || to === from)
            return;
        var win = root.Window.window;
        if (win && (orientations.indexOf(to) - orientations.indexOf(from)) % 2 !== 0) {
            // In phoenix-sim's window, under its menus and toolbar, that
            // window turns around the screen.
            if (typeof simChrome !== "undefined" && simChrome) {
                simChrome.resizeScreen(win.height, win.width);
            } else {
                var w = win.width;
                win.width = win.height;
                win.height = w;
            }
        }
        status.deviceOrientation = to;
    }
    // --turn: a second after start-up, for screenshots of the turn.
    Timer {
        running: typeof simTurn !== "undefined" && simTurn !== ""
        interval: 1000
        onTriggered: root.turnDevice(simTurn)
    }

    // ---- The assistant's follow-up questions (docs/AI-AND-MCP.md) ------------------------
    // Assistant Follow-ups Now: the service's clock moved on to when the next
    // question waiting for later is due (followUpWake {at}), again until one
    // is shown as a notification (past the quiet hours, Do Not Disturb and
    // calls) or none waits. done() after.
    function followUpsNow(done, left) {
        var svc = "luna://org.webosphoenix.assistant/";
        if (left === undefined)
            left = 8;
        windows.lunaCall(svc + "followUps", {}, function (q) {
            var list = q && q.followUps ? q.followUps.filter(function (f) { return f.state !== "delivered"; }) : [];
            if (!list.length || left <= 0) {
                if (done) done();
                return;
            }
            var at = Math.max(Date.now(), Math.min.apply(null, list.map(function (f) { return f.nextAt; })));
            windows.lunaCall(svc + "followUpWake", { at: at }, function (r) {
                console.log("phoenix-sim: assistant follow-ups at " + new Date(at).toString() + ": " + JSON.stringify(r));
                if (r && r.delivered) {
                    if (done) done();
                    return;
                }
                root.followUpsNow(done, left - 1);
            });
        });
    }
    // --scene followup: the assistant's view, an event made and the
    // question after it; followuplater: an event made and left unanswered,
    // the clock moved on, its notification in the dashboard; followupchat:
    // then the Assistant app opened from it (its conversation).
    Timer {
        id: sceneFollowUpTimer
        interval: 9000
        onTriggered: {
            var svc = "luna://org.webosphoenix.assistant/";
            if (root.scene === "followup" || root.scene === "followupanswer") {
                shell.openAssistant();
                sceneFollowUpAsk.start();
                return;
            }
            windows.lunaCall(svc + "ask", { text: "schedule lunch with Sam on friday at noon", newThread: true }, function () {
                windows.lunaCall(svc + "followUpLeave", {}, function () {
                    root.followUpsNow(function () {
                        if (root.scene === "followupchat") {
                            windows.lunaCall(svc + "followUps", {}, function (q) {
                                var f = q && q.followUps && q.followUps[0];
                                if (f)
                                    shell.launch("org.webosphoenix.assistant", { followUp: f.id });
                            });
                        } else {
                            shell.notifications.bannerActive = false;
                            shell.notifications.dashboardOpen = root.scene !== "followupaction";
                            // followupaction: its first answer tapped, the confirmation in the banner.
                            if (root.scene === "followupaction")
                                sceneFollowUpAction.start();
                        }
                    });
                });
            });
        }
    }

    Timer {
        id: sceneFollowUpAsk
        interval: 1500
        onTriggered: {
            shell.assistantOverlay.ask("add a meeting with Sam tomorrow at 3");
            if (root.scene === "followupanswer")
                sceneFollowUpChoose.start();
        }
    }
    Timer {
        id: sceneFollowUpAction
        interval: 2000
        onTriggered: {
            for (var i = 0; i < windows.notifications.count; ++i)
                if (windows.notifications.get(i).actions) {
                    console.log("phoenix-sim: follow-up answered from its notification, " + (Date.now() - root.startedAt) + " ms in");
                    shell.notifications.runAction(i, "fu:0");
                    break;
                }
        }
    }
    readonly property double startedAt: Date.now()
    // --scene followupanswer: its first answer tapped.
    Timer {
        id: sceneFollowUpChoose
        interval: 2500
        onTriggered: {
            var ov = shell.assistantOverlay, list = ov.messages;
            for (var i = list.length - 1; i >= 0; --i)
                if (list[i].followUp && !list[i].chosen) {
                    ov.choose(list[i], list[i].choices[0]);
                    return;
                }
        }
    }

    // --scene launchermenu: once the launcher is up.
    Timer {
        id: sceneMenuTimer
        interval: 1200
        onTriggered: shell.openLauncherIconMenu(1)
    }
    // (luna-systemui's page has to be up and listening first.)
    Timer {
        id: scenePowerTimer
        interval: 10000
        onTriggered: shell.powerKeyHeld()
    }
    Timer {
        id: sceneHotTimer
        interval: 10000
        onTriggered: root.setTemperature(51)
    }
    Timer {
        id: sceneWaveTimer
        interval: 1200
        onTriggered: {
            var w = shell.waveLauncher;
            var n = Math.min(shell.launcherLayout.dock.length, Theme.quickLaunchMaxItems - 1) + 1;
            shell.openWave(w.width * 1.5 / n, w.height - w.baseHeight / 2);
        }
    }
    // --scene launchergroup, launchergroupopen, launchertabs (docs/M6-PLAN.md
    // F4): the Apps page's second to fifth apps grouped as "Accessories"
    // (and the group open); a tab "My Stuff" added, in edit mode.
    Timer {
        id: sceneGroupTimer
        interval: 1200
        onTriggered: {
            if (root.scene === "launchertabs") {
                shell.addLauncherTab("My Stuff");
                shell.launcherEditMode = true;
                return;
            }
            var page = shell.launcherLayout.pages[0];
            shell.groupLauncherApps(page.slice(1, 5), "Accessories");
            if (root.scene === "launchergroupopen")
                shell.openLauncherGroup(shell.launcherLayout.pages[0][1]);
        }
    }

    // How the UI and the device are turned, for the apps
    // (com.palm.systemmanager getSystemStatus).
    function pushOrientation() {
        windows.pushSystemStatus({ orientation: { ui: shell.uiOrientation, device: shell.deviceOrientation } });
    }
    Connections {
        target: shell
        function onUiOrientationChanged() { root.pushOrientation(); }
        function onDeviceOrientationChanged() { root.pushOrientation(); }
    }

    // Device state shared with the web apps (Settings, ...). Their simulated
    // services report changes as "systemStatus" host messages; the system
    // menu's toggles go back to them. See docs/APP-RUNTIME.md.
    Connections {
        target: windows
        function onSystemStatusReported(s) {
            status.applyAppStatus(s);
            if (s.wallpaperUrl !== undefined)
                shell.wallpaper = s.wallpaperUrl;
            // The exhibitions that are on, kept for the next start, as
            // LunaSysMgr read them at boot (user-exhibition-apps.json).
            if (s.exhibitionApps && typeof simSettings !== "undefined")
                simSettings.setValue("dockmode/exhibitionApps", JSON.stringify(s.exhibitionApps));
        }
    }
    Connections {
        target: status
        function onWifiBarsChanged() { root.statusChanged("wifiBars"); }
        function onAirplaneModeChanged() { root.statusChanged("airplaneMode"); }
        function onBluetoothOnChanged() { root.statusChanged("bluetoothOn"); }
        function onBrightnessChanged() { root.statusChanged("brightness"); }
        function onRotationLockedChanged() { root.statusChanged("rotationLocked"); }
        function onMutedChanged() { root.statusChanged("muted"); }
        function onVolumeChanged() { root.statusChanged("volume"); }
        function onKeyboardChanged() { root.statusChanged("keyboard"); }
    }
    // The browser's page views and the system proxy (the runtime's
    // systemStatus browser and proxy; shell/sim/simbrowser.h).
    readonly property bool hasSimBrowser: typeof simBrowser !== "undefined" && simBrowser !== null
    function applyBrowserSettings() {
        if (!hasSimBrowser)
            return;
        simBrowser.contentBlocker = !!status.browser.contentBlocker;
        simBrowser.userAgent = status.browser.userAgent === "desktop" ? "desktop" : "mobile";
    }
    Connections {
        target: status
        function onBrowserChanged() { root.applyBrowserSettings(); }
        function onProxyChanged() {
            if (!root.hasSimBrowser)
                return;
            simBrowser.setProxy(status.proxy);
            console.info("phoenix-sim: proxy " + (status.proxy.type === "none" ? "none (the computer's own)"
                                                   : status.proxy.type + " " + status.proxy.host + ":" + status.proxy.port));
        }
    }
    // The lock screen, for the apps (com.palm.systemmanager getLockStatus):
    // the phone answers a ringing call when the user unlocks.
    Connections {
        target: shell
        function onLockedChanged() { windows.pushSystemStatus({ deviceLocked: shell.locked }); }
        // com.palm.systemmanager getBootStatus {firstUse}.
        function onFirstUseChanged() { windows.pushSystemStatus({ firstUse: shell.firstUse }); }
        // com.palm.systemmanager getDockModeStatus {enabled}.
        function onDockModeChanged() { windows.pushSystemStatus({ dockMode: shell.dockMode }); }
        // The keyboard is up (com.palm.systemmanager getSystemStatus ime.visible).
        function onKeyboardOpenChanged() { windows.pushSystemStatus({ ime: { visible: shell.keyboardOpen } }); }
    }

    // A VPN row in the system menu: the runtime has the profiles.
    Connections {
        target: status
        function onVpnRequested(request) { windows.pushSystemStatus(request); }
    }

    function statusChanged(name) {
        if (!status.applyingAppStatus)
            windows.pushSystemStatus(status.appStatusFor(name));
    }

    // The power supply (simActions: F6 to F8, F12, Shift+F12).
    readonly property string charger: status.charger
    readonly property var touchstones: ["TS-0001", "TS-0002"]
    function power(changes) {
        // On the Touchstone powerd names it (DockSerialNo).
        if (changes.charger !== undefined)
            changes.puckId = changes.charger === "inductive" ? (changes.puckId || touchstones[0]) : "";
        windows.simulatePower(changes);
        if (changes.percent !== undefined)
            status.batteryPercent = changes.percent;
        if (changes.charger !== undefined) {
            status.puckId = changes.puckId;
            status.charger = changes.charger;
            status.charging = changes.charger !== "none";
        }
    }
    // The headset button's release (simActions: Ctrl+Shift+B).
    Timer {
        id: headsetButtonUp
        interval: 150
        onTriggered: shell.deviceServices.headsetButton(false)
    }
    // The light on the sensor, in lux: dark, dim, indoor, outdoor (Ctrl+Shift+L).
    readonly property var lightLevels: [1, 50, 300, 20000]

    // ---- Accessories and health (docs/M6-PLAN.md F4 items 8-9) ----------------------
    // A game controller (Ctrl+Shift+G; Ctrl+Shift+A presses A), a USB drive
    // in the device's port (Ctrl+Shift+U), the battery's temperature
    // (Ctrl+Shift+T). The pages hear them as shell status.
    function connectGamepad(on) {
        status.gamepads = on ? [{ index: 0, name: "Phoenix Wireless Controller", connection: "bluetooth", mapping: "standard",
                                  id: "Phoenix Wireless Controller (STANDARD GAMEPAD Vendor: 2d50 Product: 0001)",
                                  buttons: [], axes: [0, 0, 0, 0] }] : [];
        windows.pushSystemStatus({ gamepads: status.gamepads });
    }
    function pressGamepadButton(b) {
        if (!status.gamepads.length)
            connectGamepad(true);
        var pad = JSON.parse(JSON.stringify(status.gamepads[0]));
        pad.buttons = [b];
        status.gamepads = [pad];
        windows.pushSystemStatus({ gamepads: status.gamepads });
        gamepadRelease.restart();
    }
    Timer {
        id: gamepadRelease
        interval: 300
        onTriggered: {
            if (!status.gamepads.length)
                return;
            var pad = JSON.parse(JSON.stringify(status.gamepads[0]));
            pad.buttons = [];
            status.gamepads = [pad];
            windows.pushSystemStatus({ gamepads: status.gamepads });
        }
    }
    function attachUsbDrive(on) {
        status.usbDrives = on ? [{ id: "sda1", label: "PHOENIX", vendor: "SanDisk Cruzer Blade", size: 16008609792, used: 5368709120,
                                   fs: "vfat" }] : [];
        windows.pushSystemStatus({ usbDrives: status.usbDrives });
    }
    readonly property var temperatures: [31, 46, 51]
    function setTemperature(t) {
        status.temperature = t;
        // powerd's batteryStatus signal carries it (the pages' setPower).
        windows.simulatePower({ temperature: t });
        console.info("phoenix-sim: battery " + t + " °C");
    }

    // Which app is in front with the screen on, for Settings > Battery's
    // usage (the runtime's battery block): every minute, and when the app
    // in front changes, the time since goes to the pages.
    property string _usageApp: ""
    property real _usageSince: Date.now()
    function _usageTick() {
        var now = Date.now(), ms = Math.max(0, now - _usageSince);
        _usageSince = now;
        var on = shell.display.state !== "off";
        if (ms > 0 && on)
            windows.pushSystemStatus({ usageTick: { appId: shell.locked ? "" : _usageApp, ms: ms, at: now } });
        var i = windows.cardIndex(windows.focusedUid);
        _usageApp = i >= 0 && shell.cardView.maximized ? windows.cards.get(i).appId : "";
    }
    Timer {
        interval: 60000
        running: true
        repeat: true
        onTriggered: root._usageTick()
    }
    Connections {
        target: windows
        function onFocusedUidChanged() { root._usageTick(); }
    }

    // A vibration (com.palm.vibrate, a banner's "vibrate"): the device
    // shakes in the window while it lasts, under a label saying what it is.
    SequentialAnimation {
        running: shell.deviceServices.vibrating
        loops: Animation.Infinite
        onStopped: device.anchors.horizontalCenterOffset = 0
        NumberAnimation { target: device; property: "anchors.horizontalCenterOffset"; to: 3; duration: 25 }
        NumberAnimation { target: device; property: "anchors.horizontalCenterOffset"; to: -3; duration: 50 }
        NumberAnimation { target: device; property: "anchors.horizontalCenterOffset"; to: 0; duration: 25 }
    }
    Rectangle {
        visible: shell.deviceServices.vibrating
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: 36
        width: vibrationLabel.implicitWidth + 24
        height: vibrationLabel.implicitHeight + 10
        radius: height / 2
        color: "#cc202020"
        z: 10
        Text {
            id: vibrationLabel
            anchors.centerIn: parent
            text: qsTr("Vibrating: %1").arg(shell.deviceServices.vibration)
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: 13
        }
    }

    // The "Dismissing Cards" tutorial was shown: not again.
    Connections {
        target: windows
        function onFirstCardAlertShown() {
            if (typeof simSettings !== "undefined")
                simSettings.setValue("cards/usedFirstCard", "1");
        }
    }

    // ---- The simulator's functions ------------------------------------------------------
    // Every key and command the simulator adds, once: the keyboard shortcuts
    // below are made from this list, and phoenix-sim builds its menus,
    // toolbar and Help > Keyboard Shortcuts from it (simActionList(),
    // simTrigger(), simActionChecked(); shell/sim/simchrome.cpp). An entry:
    //   id        its name (simTrigger(id), the toolbar's simToolbar)
    //   menu      "device", "simulate" or "view"; "" for Help > Keyboard
    //             Shortcuts only; submenu: the submenu it goes in
    //   text      what it is called; tip: what it does, if the name does not say
    //   keys      its key sequences (Qt's portable text); the first is shown
    //             in the menu. keyText: a key chord no sequence can say
    //   run       what it does: then the keys are a Shortcut here
    //   press     instead, keys the shell handles itself (SystemKeys in
    //             Shell.qml: they act on press and release, and make chords):
    //             the menu presses them in order and lets go in reverse;
    //             hold: let go of only the last at once, the others when the
    //             item is unchecked (a chord to keep holding)
    //   checked   a function: the item is a check box showing it; radio: a
    //             group of which one is checked
    //   icon      its toolbar icon (shell/sim/icons/NAME.svg)
    // { separator: true, menu } separates; Help > Keyboard Shortcuts lists
    // them in this order.
    readonly property var simActions: [
        // Device: the buttons and switches, how it is held.
        { id: "power", menu: "device", text: qsTr("Power Button"), keys: ["F3"], press: [Qt.Key_F3], icon: "power",
          tip: qsTr("Lock: the screen off and locked, or on again") },
        // Power held 3 s: the power menu (Shell.powerKeyHeld; F3 held down
        // does the same).
        { id: "powerHold", menu: "device", text: qsTr("Hold Power Button"), keys: ["Shift+F3"],
          tip: qsTr("The power menu: Airplane Mode, Luna Restart, Device Restart, Shut Down"),
          run: function () { shell.powerKeyHeld(); } },
        { id: "home", menu: "device", text: qsTr("Home Button"), keys: ["Home"], press: [Qt.Key_Home], icon: "home",
          tip: qsTr("With F3: a screen capture") },
        { id: "back", menu: "device", text: qsTr("Back Gesture"), keys: ["Esc"], press: [Qt.Key_Escape], icon: "back" },
        { id: "up", menu: "device", text: qsTr("Up Gesture"), keys: ["F1"], press: [Qt.Key_F1],
          tip: qsTr("Card view, then the launcher") },
        { separator: true, menu: "device" },
        { id: "volumeUp", menu: "device", text: qsTr("Volume Up"), keys: ["F11"], press: [Qt.Key_F11], icon: "volume-up" },
        { id: "volumeDown", menu: "device", text: qsTr("Volume Down"), keys: ["F10"], press: [Qt.Key_F10], icon: "volume-down" },
        // The device's switches (com.palm.keys; DeviceServices): down is silent.
        { id: "ringer", menu: "device", text: qsTr("Ringer Switch Off (Silent)"), keys: ["Ctrl+Shift+R"], icon: "ringer",
          run: function () { status.ringerSwitch = status.ringerSwitch === "down" ? "up" : "down"; },
          checked: function () { return status.ringerSwitch === "down"; } },
        { separator: true, menu: "device" },
        { id: "rotateLeft", menu: "device", text: qsTr("Rotate Left"), keys: ["Ctrl+Left"], icon: "rotate-left",
          tip: qsTr("A quarter turn counter-clockwise"), run: function () { root.turnDevice(1); } },
        { id: "rotateRight", menu: "device", text: qsTr("Rotate Right"), keys: ["Ctrl+Right"], icon: "rotate-right",
          tip: qsTr("A quarter turn clockwise"), run: function () { root.turnDevice(-1); } },
        { separator: true, menu: "device" },
        { id: "capture", menu: "device", text: qsTr("Screen Capture"), keys: ["F9", "Print", "Ctrl+Alt+P"], keyText: "Home+F3",
          press: [Qt.Key_F9], icon: "screenshot" },
        { separator: true, menu: "device" },
        // The original's key chords (SystemScreens.qml).
        { id: "fullErase", menu: "device", text: qsTr("Hold Full Erase Chord"), keyText: qsTr("F3+F11, then Home"),
          press: [Qt.Key_F3, Qt.Key_F11, Qt.Key_Home], hold: true,
          tip: qsTr("Full Erase's countdown; held on, the device is erased (uncheck to let go)") },
        { id: "usbDrive", menu: "device", text: qsTr("USB Drive Chord"), keyText: "F3+F10", press: [Qt.Key_F3, Qt.Key_F10],
          tip: qsTr("Power and Volume Down on a USB cable: USB drive mode") },
        { separator: true, menu: "device" },
        { id: "keyboard", menu: "device", text: qsTr("Hardware Keyboard Attached"), keys: ["Ctrl+Shift+K"],
          run: function () { status.hardwareKeyboard = !status.hardwareKeyboard; },
          checked: function () { return status.hardwareKeyboard; } },
        // The on-screen keyboard up or down. It types into the field with
        // the focus (as on the device, it has nothing to type into
        // otherwise), so with none Just Type opens, its field focused (not
        // over the lock screen, where only its PIN or password field takes
        // the keyboard, nor in First Use).
        { id: "virtualKeyboard", menu: "device", text: qsTr("On-Screen Keyboard"), keys: ["Ctrl+Shift+O"], icon: "keyboard",
          tip: qsTr("Up or down; with no text field in use, Just Type opens with it"),
          run: function () {
              if (shell.keyboardOpen)
                  shell.hideKeyboard();
              else if (shell.imeClient)
                  shell.showVirtualKeyboard();
              else if (!shell.locked && !shell.firstUse)
                  shell.startJustType("");
          },
          checked: function () { return shell.keyboardOpen; } },

        // Simulate: what happens to the device. Incoming calls and messages
        // (SimWindowSource.simulateIncomingCall / Sms / Mms / Im).
        { id: "call", menu: "simulate", text: qsTr("Incoming Call"), keys: ["F4"], icon: "call",
          run: function () { windows.simulateIncomingCall(); } },
        { id: "sms", menu: "simulate", text: qsTr("Incoming Text Message"), keys: ["F5"], icon: "message",
          run: function () { windows.simulateIncomingSms(); } },
        { id: "mms", menu: "simulate", text: qsTr("Incoming Picture Message"), keys: ["Shift+F5"],
          run: function () { windows.simulateIncomingMms(); } },
        { id: "im", menu: "simulate", text: qsTr("Incoming Instant Message"), keys: ["Ctrl+F5"],
          tip: qsTr("From a buddy, once an IM account is set up"), run: function () { windows.simulateIncomingIm(); } },
        // The assistant's wake word, played into the microphone (on while
        // Settings > Assistant listens for it; --wake-file).
        { id: "wakeWord", menu: "simulate", text: qsTr("Say \"Hey Phoenix\""), keys: ["Ctrl+Shift+Y"],
          tip: qsTr("Plays a recording of the wake word into the microphone (Settings > Assistant must be listening for it)"),
          run: function () {
              if (!shell.dictation || typeof simWakeFile === "undefined" || !shell.dictation.hear(simWakeFile))
                  console.log("phoenix-sim: the microphone is not listening for \"Hey Phoenix\" (Settings > Assistant)");
          } },
        { id: "notification", menu: "simulate", text: qsTr("Demo Notification"), keys: ["F2"], press: [Qt.Key_F2], icon: "notification" },
        // The assistant's follow-up questions waiting for later: the clock
        // moved on to when the next is due (docs/AI-AND-MCP.md).
        { id: "followUpsNow", menu: "simulate", text: qsTr("Assistant Follow-ups Now"), keys: ["Shift+F2"],
          tip: qsTr("Moves the assistant's clock on until a follow-up question waiting for later is shown as a notification"),
          run: function () { root.followUpsNow(); } },
        { separator: true, menu: "simulate" },
        // The battery and chargers: 5% and under is luna-systemui's Low
        // Battery alert (battery_low.mp3); a wall charger "Charging Battery"
        // (charging.mp3); full, battery_full.mp3.
        { id: "lowBattery", menu: "simulate", text: qsTr("Low Battery (4%)"), keys: ["F6"], icon: "battery",
          run: function () { root.power({ percent: 4, charger: "none" }); } },
        // powerd gone: the status bar's battery-error, "Battery: Not
        // Available" in the system menu; or it reports again.
        { id: "batteryError", menu: "simulate", text: qsTr("Battery Not Reporting"), keys: ["Shift+F6"],
          run: function () { status.batteryPercent = status.batteryPercent < 0 ? 60 : -1; },
          checked: function () { return status.batteryPercent < 0; } },
        { id: "charger", menu: "simulate", text: qsTr("Wall Charger Plugged In"), keys: ["F7"], icon: "charger",
          run: function () {
              var c = root.charger === "wall" ? "none" : "wall";
              root.power({ charger: c, percent: c === "none" ? 60 : 61 });
          },
          checked: function () { return root.charger === "wall"; } },
        { id: "batteryFull", menu: "simulate", text: qsTr("Battery Charged to Full"), keys: ["F8"],
          run: function () { root.power({ charger: root.charger === "none" ? "wall" : root.charger, percent: 100, puckId: status.puckId }); } },
        { separator: true, menu: "simulate" },
        // A cable from a computer and USB drive mode (SimStorage.qml).
        { id: "usbCable", menu: "simulate", text: qsTr("USB Cable from a Computer"), keys: ["Shift+F8"],
          run: function () { storage.plug(!storage.hostConnected); },
          checked: function () { return storage.hostConnected; } },
        { id: "usbEject", menu: "simulate", text: qsTr("Computer Ejects the USB Drive"), keys: ["Ctrl+F8"],
          run: function () { storage.eject(); } },
        { separator: true, menu: "simulate" },
        // The inductive charger (dock mode, GAPS R5); each Touchstone
        // remembers its exhibition. --touchstone starts on one.
        { id: "touchstone", menu: "simulate", text: qsTr("On a Touchstone"), keys: ["F12"], icon: "touchstone",
          tip: qsTr("Set the device on the inductive charger (dock mode), or lift it off"),
          run: function () {
              root.power(root.charger === "inductive" ? { charger: "none", percent: 60 }
                                                      : { charger: "inductive", percent: 61, puckId: root.touchstones[0] });
          },
          checked: function () { return root.charger === "inductive"; } },
        { id: "touchstone2", menu: "simulate", text: qsTr("Onto the Other Touchstone"), keys: ["Shift+F12"],
          run: function () {
              // Lifted off one and set on the other.
              var next = status.puckId === root.touchstones[1] ? root.touchstones[0] : root.touchstones[1];
              if (root.charger === "inductive")
                  root.power({ charger: "none", percent: 60 });
              root.power({ charger: "inductive", percent: 61, puckId: next });
          } },
        { separator: true, menu: "simulate" },
        // Touch to Share with a phone nearby (SimWindowSource): in range,
        // the glow; touched, the app in front sends what it shares (the
        // browser: its page) and its card is thrown.
        { id: "touchToShare", menu: "simulate", text: qsTr("Touch to Share Phone in Range"), keys: ["Shift+F7"],
          run: function () { windows.simulateTouchToShareDevice(!windows.touchToShareInRange); },
          checked: function () { return windows.touchToShareInRange; } },
        { id: "touchToShareTap", menu: "simulate", text: qsTr("Touch to Share: Tap the Phone"), keys: ["Ctrl+F7"],
          run: function () { windows.simulateTouchToShareTap(); } },
        { separator: true, menu: "simulate" },
        // Accessories (docs/M6-PLAN.md F4 item 8): a Bluetooth game
        // controller (its A button), a USB drive on the device's own USB
        // port (host mode, OTG). The pages see them (the runtime's
        // gamepads and USB blocks): web apps through the Gamepad API.
        { id: "gamepad", menu: "simulate", text: qsTr("Game Controller Connected"), keys: ["Ctrl+Shift+G"],
          tip: qsTr("A Bluetooth game controller; web apps see it with the Gamepad API"),
          run: function () { root.connectGamepad(status.gamepads.length === 0); },
          checked: function () { return status.gamepads.length > 0; } },
        { id: "gamepadA", menu: "simulate", text: qsTr("Game Controller: Press A"), keys: ["Ctrl+Shift+A"],
          run: function () { root.pressGamepadButton(0); } },
        { id: "usbOtg", menu: "simulate", text: qsTr("USB Drive in the Device (OTG)"), keys: ["Ctrl+Shift+U"],
          tip: qsTr("A USB drive on the device's own port: Settings > USB"),
          run: function () { root.attachUsbDrive(status.usbDrives.length === 0); },
          checked: function () { return status.usbDrives.length > 0; } },
        // Health (item 9): the battery's temperature, normal, warm (45 °C,
        // the first warning) or hot (50 °C, the second), as powerd reports it.
        { id: "temperature", menu: "simulate", text: qsTr("Next Device Temperature"), keys: ["Ctrl+Shift+T"],
          tip: qsTr("Normal (31 °C), warm (46 °C), hot (51 °C)"),
          run: function () {
              var i = root.temperatures.indexOf(status.temperature);
              root.setTemperature(root.temperatures[(i + 1) % root.temperatures.length]);
          } },
        { separator: true, menu: "simulate" },
        // A headset (with its microphone) and its button, twice within a
        // second a double click; the play/pause media key; the light on
        // the sensor (com.palm.keys, com.palm.ambientLightSensor).
        { id: "headset", menu: "simulate", text: qsTr("Headset Plugged In"), keys: ["Ctrl+Shift+H"],
          run: function () { status.headset = status.headset === "none" ? "headset-mic" : "none"; },
          checked: function () { return status.headset !== "none"; } },
        { id: "headsetButton", menu: "simulate", text: qsTr("Headset Button"), keys: ["Ctrl+Shift+B"],
          tip: qsTr("Twice within a second: a double click"),
          run: function () {
              shell.deviceServices.headsetButton(true);
              headsetButtonUp.restart();
          } },
        { id: "playPause", menu: "simulate", text: qsTr("Play/Pause Media Key"), keys: ["Ctrl+Shift+M"],
          run: function () { shell.deviceServices.mediaKey("togglePausePlay"); } },
        { id: "light", menu: "simulate", text: qsTr("Next Light Level"), keys: ["Ctrl+Shift+L"],
          tip: qsTr("Dark, dim, indoor, outdoor"),
          run: function () {
              var i = root.lightLevels.indexOf(status.lightLevel);
              status.lightLevel = root.lightLevels[(i + 1) % root.lightLevels.length];
              console.info("phoenix-sim: light " + status.lightLevel + " lux");
          } },

        // View: the device. Adaptive (--adaptive, and without --phone or
        // --tablet): the shell is a phone or a tablet by the window's size,
        // live, and Phone and Tablet snap the window to the Pre's and the
        // TouchPad's sizes; with --phone or --tablet the layout is fixed and
        // they restart phoenix-sim as the other.
        { id: "phone", menu: "view", text: qsTr("Phone"), radio: "formFactor", icon: "phone",
          tip: qsTr("A phone: the Pre, 320x480 (adaptive: the window takes its size; else a restart)"),
          checked: function () { return !root.adaptive && !shell.tablet; },
          run: function () {
              if (root.adaptive)
                  root.snapToPreset("pre");
              else if (shell.tablet)
                  root.restartSim(["tablet", "phone", "adaptive", "size", "scale"], ["--phone"]);
          } },
        { id: "tablet", menu: "view", text: qsTr("Tablet"), radio: "formFactor", icon: "tablet",
          tip: qsTr("A tablet: the TouchPad, 1024x768 (adaptive: the window takes its size; else a restart)"),
          checked: function () { return !root.adaptive && shell.tablet; },
          run: function () {
              if (root.adaptive)
                  root.snapToPreset("touchpad");
              else if (!shell.tablet)
                  root.restartSim(["tablet", "phone", "adaptive", "size", "scale"], ["--tablet"]);
          } },
        { id: "adaptive", menu: "view", text: qsTr("Adaptive (Phone or Tablet by Size)"), radio: "formFactor",
          tip: qsTr("Resize the window freely: the shell becomes a tablet once its shorter side reaches %1 pixels, "
                    + "and a phone again below, without restarting the apps").arg(Theme.tabletMinSide),
          checked: function () { return root.adaptive; },
          run: function () {
              if (!root.adaptive)
                  root.restartSim(["tablet", "phone", "adaptive"], ["--adaptive"]);
          } }
    ].concat(devicePresets.map(function (p) {
        return { id: "size-" + p.id, menu: "view", submenu: qsTr("Device Size"), text: p.text, radio: "deviceSize",
                 tip: qsTr("The window at %1x%2, upright (%3 layout when adaptive)").arg(p.width).arg(p.height)
                      .arg(Theme.tabletLayoutFor(p.width, p.height, 1) ? qsTr("tablet") : qsTr("phone")),
                 checked: function () { return root.screenWidth === p.width && root.screenHeight === p.height; },
                 run: function () { root.snapToPreset(p.id); } };
    })).concat([
        { separator: true, menu: "view" }
    ]).concat([1, 1.5, 2].map(function (n) {
        return { id: "scale-" + n, menu: "view", submenu: qsTr("Scale"), text: qsTr("%1x").arg(n), radio: "scale",
                 tip: qsTr("Restart with --scale %1").arg(n),
                 checked: function () { return shell.density === n; },
                 run: function () {
                     // The screen it has now, at the new density.
                     root.restartSim(["size", "scale"], ["--scale", String(n), "--size",
                                     Math.round(root.screenWidth * n) + "x" + Math.round(root.screenHeight * n)]);
                 } };
    })).concat([""].concat(scenes).map(function (name) {
        return { id: "scene-" + (name || "none"), menu: "view", submenu: qsTr("Scene"), text: name || qsTr("None (a normal start)"),
                 radio: "scene", tip: name ? qsTr("Restart into the demo scene --scene %1").arg(name) : qsTr("Restart without a scene"),
                 checked: function () { return root.scene === name; },
                 run: function () {
                     root.restartSim(["scene", "launch", "open", "first-use", "turn"], name ? ["--scene", name] : []);
                 } };
    })).concat([
        { separator: true, menu: "view" },
        // The debugging overlays (com.palm.systemmanager enableFpsCounter
        // and enableTouchPlot), as the pages turn them on.
        { id: "fpsCounter", menu: "view", submenu: qsTr("Developer Overlays"), text: qsTr("Frame Rate Counter"),
          checked: function () { return shell.systemScreens.debugOverlays.fpsCounter; },
          run: function () { root.debugOverlay({ fpsCounter: { enable: !shell.systemScreens.debugOverlays.fpsCounter } }); } },
        { id: "touchPlot", menu: "view", submenu: qsTr("Developer Overlays"), text: qsTr("Touch Plot"),
          checked: function () { return shell.systemScreens.debugOverlays.touchPlot.collection; },
          run: function () {
              var on = !shell.systemScreens.debugOverlays.touchPlot.collection;
              root.debugOverlay({ touchPlot: { collection: on, trails: on, crosshairs: on } });
          } },

        // Keys of the shell's own, for Help > Keyboard Shortcuts.
        { id: "justType", menu: "", text: qsTr("Just Type"), keyText: qsTr("Type in card view, or the Search key") },
        { id: "cardView", menu: "", text: qsTr("Card View"), keyText: Qt.platform.os === "osx" ? "" : qsTr("Super, on its own") }
    ])
    // The toolbar's, in order ("|" separates).
    readonly property var simToolbar: ["power", "volumeUp", "volumeDown", "ringer", "|", "home", "back", "virtualKeyboard", "|",
                                       "rotateLeft", "rotateRight", "capture", "|",
                                       "call", "sms", "notification", "|", "lowBattery", "charger", "touchstone", "|",
                                       "phone", "tablet"]
    // The demo scenes (--scene; buildScene()).
    readonly property var scenes: ["locked", "cards", "stacks", "longstack", "reorder", "maximized", "heldcard",
                                   "launcher", "launcheredit", "launchermenu", "launchergroup", "launchergroupopen", "launchertabs", "launcherinstall", "wave", "powermenu", "hot", "pin", "emergency", "firstuse",
                                   "lowbattery", "banner", "notified", "dashboard", "drawer", "capture",
                                   "capturepreview", "justtype", "keyboard", "clipstrip", "assistant", "assistantbird", "assistantbirds", "assistantbirdmoves",
                                   "wakeword", "wakewordlocked", "systemmenu", "empty"]
    readonly property string scene: typeof simScene !== "undefined" ? simScene : ""

    // The keys of the entries that run something, wherever the keyboard
    // focus is (a web app's too).
    Repeater {
        model: root.simActions.filter(function (a) { return a.run && a.keys && a.keys.length > 0; })
        delegate: Item {
            required property var modelData
            Shortcut {
                sequences: modelData.keys
                context: Qt.ApplicationShortcut
                onActivated: modelData.run()
            }
        }
    }

    function _simAction(id) {
        for (var i = 0; i < simActions.length; ++i) {
            if (simActions[i].id === id)
                return simActions[i];
        }
        return null;
    }
    // For phoenix-sim's menus: the entries without their functions.
    function simActionList() {
        return simActions.map(function (a) {
            return { id: a.id || "", separator: !!a.separator, menu: a.menu || "", submenu: a.submenu || "",
                     text: a.text || "", tip: a.tip || "", keys: a.keys || [], keyText: a.keyText || "",
                     press: a.press || [], hold: !!a.hold, run: !!a.run, checkable: !!a.checked,
                     radio: a.radio || "", icon: a.icon || "" };
        });
    }
    function simActionChecked(id) {
        var a = _simAction(id);
        return !!(a && a.checked && a.checked());
    }
    function simTrigger(id) {
        var a = _simAction(id);
        if (a && a.run)
            a.run();
    }
    // phoenix-sim again, with other options (SimProcess.restartReplacing).
    function restartSim(drop, add) {
        if (typeof simProcess !== "undefined" && simProcess)
            simProcess.restartReplacing(drop, add);
    }
    function debugOverlay(request) {
        shell.systemScreens.debugOverlay(request);
        windows.pushSystemStatus({ debugOverlays: shell.systemScreens.debugOverlays });
    }

    // Closing the window turns the device off: the screen goes dark and
    // the shutdown sound plays before the simulator quits.
    property bool shuttingDown: false
    Connections {
        target: root.Window.window
        function onClosing(close) {
            if (root.shuttingDown || !shell.bootSound)
                return;
            close.accepted = false;
            root.shuttingDown = true;
            device.visible = false;
            shell.sounds.shutdown();
            shutdownTimer.start();
        }
    }
    Timer {
        id: shutdownTimer
        interval: 4200    // shutdown.mp3 is 4.1 s
        property bool restart: false
        property bool erase: false
        property var restartArgs: []
        onTriggered: {
            if (typeof simProcess !== "undefined") {
                if (erase && simProcess.eraseAndRestart())
                    return;
                if (restart && simProcess.restart(restartArgs))
                    return;
            }
            Qt.quit();
        }
    }
    // Off as above, then phoenix-sim starts again.
    function restartDevice(args, erase) {
        if (root.shuttingDown)
            return;
        root.shuttingDown = true;
        device.visible = false;
        shutdownTimer.restart = true;
        shutdownTimer.erase = !!erase;
        shutdownTimer.restartArgs = args || [];
        if (shell.bootSound) {
            shell.sounds.shutdown();
            shutdownTimer.start();
        } else {
            shutdownTimer.triggered();
        }
    }

    // The power menu's Shut Down (machineOff; docs/M6-PLAN.md F4): the
    // screen goes dark as the shutdown sound plays, and the device stays off
    // until Power (F3) or a click turns it on again: phoenix-sim starts
    // again, booting.
    property bool poweredOff: false
    Connections {
        target: windows
        function onShutdownRequested(reason) { root.powerOff(); }
        function onMediaKeyRequested(key) { shell.deviceServices.mediaKey(key); }
        // The Assistant's "take a screenshot": its view closes first, so
        // the capture shows what it was over.
        function onScreenshotRequested() {
            if (shell.assistantOpen) {
                shell.closeAssistant();
                screenshotDelay.start();
            } else {
                shell.takeScreenshot();
            }
        }
        // Luna Restart: the system UI again (phoenix-sim restarted at once,
        // its boot logo, no shutdown sound); the apps start afresh.
        function onRestartUiRequested() {
            if (root.shuttingDown)
                return;
            root.shuttingDown = true;
            device.visible = false;
            if (typeof simProcess === "undefined" || !simProcess || !simProcess.restart([]))
                Qt.quit();
        }
    }
    Timer {
        id: screenshotDelay
        interval: Theme.cardTransitionDuration + 100
        onTriggered: shell.takeScreenshot()
    }
    function powerOff() {
        if (root.shuttingDown)
            return;
        root.shuttingDown = true;
        device.visible = false;
        if (shell.bootSound)
            shell.sounds.shutdown();
        offDelay.start();
    }
    Timer {
        id: offDelay
        interval: shell.bootSound ? 4200 : 300
        onTriggered: root.poweredOff = true
    }
    function powerOn() {
        if (!root.poweredOff)
            return;
        if (typeof simProcess === "undefined" || !simProcess || !simProcess.restart([]))
            Qt.quit();
    }
    Rectangle {
        objectName: "simPoweredOff"
        anchors.fill: parent
        z: 10000
        color: "black"
        visible: root.poweredOff
        Text {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 16
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            text: qsTr("Off. Press F3 (Power) or click to turn it on.")
            color: "#777777"
            font.family: Theme.fontFamily
            font.pixelSize: 13
        }
        MouseArea { anchors.fill: parent; onClicked: root.powerOn() }
    }
    Shortcut {
        sequence: "F3"
        enabled: root.poweredOff
        context: Qt.ApplicationShortcut
        onActivated: root.powerOn()
    }

    // A restart (machineReboot: a system update's "Install now"): the
    // device boots into the new system, "Updating the system" first.
    Connections {
        target: windows
        function onRebootRequested(reason) {
            root.restartDevice(reason === "System update" ? ["--updating"] : []);
        }
    }

    // The device was erased (Full Erase, from Settings or the key chord;
    // the security policy's last try): it restarts with nothing on it, into
    // First Use. What the screen showed stays a moment ("Your device will
    // now be erased.", the countdown), as the erase itself took a while.
    Connections {
        target: windows
        function onEraseRequested() { eraseDelay.start(); }
    }
    Timer {
        id: eraseDelay
        interval: 2000
        onTriggered: root.restartDevice([], true)
    }

    // ---- Booting ---------------------------------------------------------------------
    // The boot animation runs until the system UI's page has loaded, and at
    // least through the logo's first glow (BootupAnimation.cpp:44,
    // kFirstGlowAnimDuration). After a system update its progress is that
    // page's loading: the new system starting.
    Timer {
        id: bootMinimum
        interval: 4000
        running: shell.bootAnimation
        property bool done: false
        onTriggered: done = true
    }
    readonly property bool _systemUiUp: !simWebEngineOn || windows.systemUiLoaded
    readonly property bool simWebEngineOn: typeof simWebEngine !== "undefined" && simWebEngine
    readonly property bool _bootDone: bootMinimum.done && _systemUiUp
    // Said on the output too, for scripts that drive the simulator (xdotool):
    // until then the boot animation takes every touch (BootAnimation.qml).
    on_BootDoneChanged: {
        if (!_bootDone)
            return;
        shell.systemScreens.finishBoot();
        if (shell.bootAnimation)
            console.info("phoenix-sim: booted (touches reach the UI once the logo has gone, " + Theme.motion(700) + " ms)");
    }
    Connections {
        target: windows
        function onSystemUiProgressChanged() { shell.systemScreens.bootProgress(windows.systemUiProgress, 100); }
    }

    // ---- Security policy (--security-policy) --------------------------------------------
    // The policy an Exchange account would have put in db8; phoenix-sim's
    // own (its _id), replaced or removed by the option.
    function applySecurityPolicy() {
        var spec = typeof simSecurityPolicy !== "undefined" ? simSecurityPolicy : "";
        if (spec === "")
            return;
        var del = function () { windows.lunaCall("palm://com.palm.db/del", { ids: ["phoenix-sim-policy"] }, function () {}); };
        if (spec === "none")
            return del();
        var policy = JSON.parse(spec);
        policy._kind = "com.palm.securitypolicy:1";
        policy._id = "phoenix-sim-policy";
        windows.lunaCall("palm://com.palm.db/put", { objects: [policy] }, function (r) {
            if (!r || r.returnValue === false)
                console.warn("phoenix-sim: could not set the security policy:", JSON.stringify(r));
        });
    }
    Connections {
        target: windows
        function onSystemUiLoadedChanged() {
            if (windows.systemUiLoaded)
                root.applySecurityPolicy();
        }
    }

    // ---- Debugging overlays and the progress animation ----------------------------------
    // com.palm.systemmanager enableFpsCounter, enableTouchPlot and
    // runProgressAnimation, from the pages; what shows goes back to them
    // (getDebugOverlays).
    Connections {
        target: windows
        function onDebugOverlayRequested(request) {
            shell.systemScreens.debugOverlay(request);
            windows.pushSystemStatus({ debugOverlays: shell.systemScreens.debugOverlays });
        }
        function onProgressAnimationRequested(type, state) {
            if (state === "start")
                shell.systemScreens.startProgressAnimation(type);
            else
                shell.systemScreens.stopProgressAnimation();
        }
    }

    // ---- USB: a cable from a computer, and USB drive mode --------------------------------
    // Shift+F8 plugs it in or out, Ctrl+F8 ejects the drive on the computer
    // (SimStorage.qml). Plugged in, it charges the device ("pc").
    SimStorage {
        id: storage
        busy: typeof simUsbBusy !== "undefined" && simUsbBusy
        onSignalled: (method, payload) => {
            windows.storagedSignal(method, payload);
            shell.storagedSignal(method, payload);
        }
        onCableChanged: (connected) => {
            windows.pushSystemStatus({ usbHost: connected });
            // root.charger follows status.charger (read-only); power() sets it.
            root.power({ charger: connected ? "pc" : "none" });
        }
    }
    Connections {
        target: windows
        function onEnterMSMRequested(enterIMasq) { storage.enterMSM(enterIMasq); }
    }

    // First Use is done (the app set firstUseComplete): not again at the next
    // start, as LunaSysMgr's /var/luna/preferences/ran-first-use.
    Connections {
        target: windows
        function onPreferencesReported(p) {
            if (typeof simSettings === "undefined" || p.firstUseComplete === undefined)
                return;
            simSettings.setValue("firstuse/done", p.firstUseComplete ? "1" : "");
        }
    }

    // The launcher layout (icon order, dock) survives restarts (simSettings,
    // phoenix-sim's settings file).
    Connections {
        target: windows
        function onLauncherLayoutJsonChanged() {
            if (typeof simSettings !== "undefined" && windows.launcherLayoutJson !== "")
                simSettings.setValue("launcher/layout", windows.launcherLayoutJson);
            // The pages back it up (com.palm.sysMgrDataBackup in the runtime).
            if (windows.launcherLayoutJson !== "")
                windows.pushSystemStatus({ launcherLayout: windows.launcherLayoutJson });
        }
    }

    // Which exhibition each Touchstone showed survives restarts too
    // (DockModePositionManager's knownPucks).
    Connections {
        target: windows
        function onDockModePositionsJsonChanged() {
            if (typeof simSettings !== "undefined" && windows.dockModePositionsJson !== "")
                simSettings.setValue("dockmode/positions", windows.dockModePositionsJson);
        }
    }

    // The keyboard's recent emoji and skin tones survive restarts too, and
    // the words Text Assist learned (saved a moment after the typing stops).
    Connections {
        target: shell.keyboard
        function onEmojiPrefsChanged() {
            if (typeof simSettings !== "undefined")
                simSettings.setValue("keyboard/emoji", shell.keyboard.emojiPrefs);
        }
        function onTextAssistDataChanged() { textAssistSave.restart(); }
    }
    Timer {
        id: textAssistSave
        interval: 2000
        onTriggered: {
            if (typeof simSettings !== "undefined")
                simSettings.setValue("keyboard/words", shell.keyboard.textAssistData);
        }
    }

    // Build a demo scene, as if the user had been using the phone for a bit.
    Component.onCompleted: {
        // Icons the system UI names by device path find their HiDPI variants
        // in the compat overlay as on a device, where it is installed beside
        // the submodule's files (luna-systemui's notification icons).
        if (typeof simRootfs !== "undefined" && simRootfs) {
            var twins = simRootfs.twinDirectories();
            for (var t = 0; t < twins.length; ++t)
                HiDpi.addTwinDirectory(twins[t][0], twins[t][1]);
        }
        windows.pushSystemStatus({ deviceLocked: shell.locked });
        // The USB cable (the pages wait for it before answering
        // hostIsConnected) and the debugging overlays, off at boot.
        windows.pushSystemStatus({ usbHost: false, debugOverlays: shell.systemScreens.debugOverlays });
        if (typeof simUsb !== "undefined" && simUsb)
            storage.plug(true);
        pushOrientation();
        // Settings offers Advanced gestures where there is a gesture area.
        windows.pushSystemStatus({ gestureArea: Theme.gestureAreaHeight > 0 });
        // The accessories (none at boot) and what the device is: Settings
        // offers tethering on phones.
        windows.pushSystemStatus({ gamepads: [], usbDrives: [] });
        pushScreen();
        if (typeof simChrome !== "undefined" && simChrome)
            simChrome.setScreenInfo(screenInfo);
        if (typeof simSettings !== "undefined") {
            windows.launcherLayoutJson = simSettings.value("launcher/layout");
            windows.dockModePositionsJson = simSettings.value("dockmode/positions");
            try {
                var exhibitions = JSON.parse(simSettings.value("dockmode/exhibitionApps") || "null");
                if (Array.isArray(exhibitions))
                    status.exhibitionApps = exhibitions;
            } catch (e) { /* the default */ }
        }
        // The "Dismissing Cards" tutorial, until it has been shown once
        // (not in a demo scene).
        if (typeof simSettings !== "undefined")
            windows.dismissedFirstCard = simSettings.value("cards/usedFirstCard") === "1"
                || (typeof simScene !== "undefined" && simScene !== "");
        // --touch-to-share: a phone in range from the start.
        if (typeof simTouchToShare !== "undefined" && simTouchToShare)
            windows.simulateTouchToShareDevice(true);
        if (typeof simSettings !== "undefined") {
            shell.keyboard.emojiPrefs = simSettings.value("keyboard/emoji");
            shell.keyboard.textAssistData = simSettings.value("keyboard/words");
        }
        // --launch <appId>: open these apps, in card view, then stop.
        // --open <url>: open a web page in the browser, as a link would.
        var opening = typeof simOpen !== "undefined" && simOpen !== "";
        if (opening || (typeof simLaunch !== "undefined" && simLaunch.length > 0)) {
            shell.unlock();
            // After the window source has built its app list.
            Qt.callLater(function() {
                for (var j = 0; simLaunch && j < simLaunch.length; ++j)
                    shell.launch(simLaunch[j]);
                if (opening)
                    windows.openUrl(simOpen);
                // --scene clipstrip with --launch: the strip over that app.
                if (typeof simScene !== "undefined" && simScene === "clipstrip")
                    root.clipStripScene();
                // --scene assistant with --launch: the assistant over that app.
                if (typeof simScene !== "undefined" && simScene === "assistant")
                    root.assistantScene();
                root.startOnTouchstone();
            });
            return;
        }
        // First Use: asked for, or never done on this simulator.
        var scene = typeof simScene !== "undefined" ? simScene : "";
        // (Not with --touchstone either, which asks for dock mode.)
        var touchstone = typeof simTouchstone !== "undefined" && simTouchstone;
        var firstUse = (typeof simFirstUse !== "undefined" && simFirstUse)
            || (scene === "" && !touchstone && typeof simSettings !== "undefined" && simSettings.value("firstuse/done") !== "1");
        if (firstUse) {
            Qt.callLater(function() {
                if (!shell.startFirstUse())
                    buildScene();
            });
            return;
        }
        // After the window source has built its app list.
        Qt.callLater(function() {
            buildScene();
            root.startOnTouchstone();
        });
    }

    // --touchstone: on a Touchstone from the start, its exhibition showing,
    // as when the device was set on it with the screen off.
    function startOnTouchstone() {
        if (typeof simTouchstone === "undefined" || !simTouchstone)
            return;
        root.power({ charger: "inductive", percent: 61, puckId: root.touchstones[0] });
        // Dock mode once the boot animation is over (it holds the screen).
        var screens = shell.systemScreens;
        if (!screens.holdsDisplay)
            return shell.enterDockMode();
        var after = function() {
            if (screens.holdsDisplay)
                return;
            screens.holdsDisplayChanged.disconnect(after);
            shell.enterDockMode();
        };
        screens.holdsDisplayChanged.connect(after);
    }

    function buildScene() {
        var scene = typeof simScene !== "undefined" && simScene !== "" ? simScene : "locked";
        if (scene === "empty")
            return shell.unlock();
        if (scene === "firstuse")
            return shell.startFirstUse();
        if (scene !== "locked" && scene !== "pin" && scene !== "emergency")
            shell.unlock();
        // Real apps where the simulator has them (Memos, Calculator), placeholders otherwise.
        var ids = ["Messaging", "Memos", "Calculator", "Web"].map(windows.appIdByTitle);
        var last = "";
        for (var i = 0; i < ids.length; ++i)
            last = windows.launch(ids[i], "");
        // As after minimizing the last of them: the dock is back (adding the
        // cards hid it). Scenes that maximize hide it again.
        shell.dockShown = true;
        shell.cardView.position = 1;
        if (scene === "stacks" || scene === "reorder" || scene === "longstack") {
            // Two extra Messaging windows stack with the first (five for
            // longstack: a fan longer than its four stationary cards).
            var msg = windows.runningUid(windows.appIdByTitle("Messaging"));
            for (var c = 0; c < (scene === "longstack" ? 5 : 2); ++c)
                windows.openChild(msg);
            // After the child windows' own focus requests have run.
            Qt.callLater(function() {
                var cv = shell.cardView;
                cv.jumpTo(cv.groupIndexOf(msg));
                if (scene === "reorder") {
                    var uid = cv.currentUid;
                    var p = cv.layout.cards[uid];
                    cv.enterReorder(uid, p.cx, p.cy);
                    cv.moveReorder(p.cx + 20, p.cy - 30);
                }
            });
        } else if (scene === "maximized") {
            shell.cardView.maximizeProgress = 1;
        } else if (scene === "heldcard") {
            // Messaging keeps the upright orientation, as if it had called
            // PalmSystem.setWindowOrientation("up"): with the device on its
            // side it shows turned in card view (--orientation left). (Enyo
            // apps ask for "free" once loaded, so not one of those.)
            var held = windows.runningUid(ids[0]);
            windows.cards.setProperty(windows.cardIndex(held), "orientation", "up");
            shell.cardView.position = 0;
        } else if (scene === "systemmenu") {
            shell.openSystemMenu();
        } else if (scene === "launcher" || scene === "launcheredit") {
            shell.gestureUp();
            if (scene === "launcheredit")
                shell.launcherEditMode = true;
        } else if (scene === "powermenu") {
            // Power held: luna-systemui's power menu (once its page is up).
            scenePowerTimer.start();
        } else if (scene === "hot") {
            // The battery at 51 °C: luna-systemui's temperature alert (once
            // its page is up).
            sceneHotTimer.start();
        } else if (scene === "wave") {
            // The wave launcher (Settings > Advanced) over an app, the
            // finger on the dock's second app.
            shell.cardView.maximizeProgress = 1;
            sceneWaveTimer.start();
        } else if (scene === "launchergroup" || scene === "launchergroupopen" || scene === "launchertabs") {
            shell.gestureUp();
            sceneGroupTimer.start();
        } else if (/^followup(?:answer|later|action|chat)?$/.test(scene)) {
            sceneFollowUpTimer.start();
        } else if (scene === "launchermenu") {
            // The icon menu of the launcher's second icon (press and hold).
            shell.gestureUp();
            sceneMenuTimer.start();
        } else if (scene === "launcherinstall") {
            // Downloads with two apps from the Marketplace: one being
            // installed (40%, the progress strip, the icon faded), one
            // whose install failed (the warning badge).
            windows._installStatus({ appId: "org.example.tides", state: "installing", progress: 40, title: "Tide Tables" });
            windows._installStatus({ appId: "org.example.sudoku", state: "failed", title: "Sudoku",
                                     reason: "The download was interrupted" });
            shell.gestureUp();
            Qt.callLater(shell.showLauncherPage, 1);
        } else if (scene === "lowbattery") {
            // An app is open; the battery drops to 4% and luna-systemui (booted
            // by the window source) raises its Low Battery alert.
            shell.cardView.maximizeProgress = 1;
            lowBatteryTimer.start();
        } else if (scene === "capture" || scene === "capturepreview") {
            // An app is open; the screen is captured (Home + Power): the
            // flash, then the "Screen captured" notification once the
            // runtime has saved it (docs/SCREENSHOTS.md).
            shell.cardView.maximizeProgress = 1;
            captureTimer.start();
        } else if (scene === "banner") {
            // An app is open; a notification comes in and the app makes room.
            shell.cardView.maximizeProgress = 1;
            windows.notify(windows.appIdByTitle("Messaging"), "Palm Pre", "It's good to be back.");
        } else if (scene === "drawer") {
            // The notification drawer pulled to the whole screen: a live
            // activity pinned on top of three notifications (Phoenix).
            shell.cardView.maximizeProgress = 1;
            windows.notify(windows.appIdByTitle("Messaging"), "Palm Pre", "It's good to be back.");
            windows.notify(windows.appIdByTitle("Email"), "3 new emails", "webOS Phoenix build passed");
            windows.notify(windows.appIdByTitle("Calendar"), "Launch party", "Tomorrow, 9:41 AM");
            windows.setOngoing("org.webosphoenix.marketplace", { id: "scene", title: "Downloading Quickoffice", body: "42%", progress: 42 });
            shell.notifications.bannerActive = false;
            shell.notifications.dashboardOpen = true;
            shell.notifications.setDrawerExpanded(true);
        } else if (scene === "dashboard" || scene === "notified" || scene === "locked") {
            if (scene !== "locked")
                shell.cardView.maximizeProgress = 1;
            windows.notify(windows.appIdByTitle("Messaging"), "Palm Pre", "It's good to be back.");
            windows.notify(windows.appIdByTitle("Email"), "3 new emails", "webOS Phoenix build passed");
            windows.notify(windows.appIdByTitle("Calendar"), "Launch party", "Tomorrow, 9:41 AM");
            if (scene === "dashboard")
                shell.notifications.dashboardOpen = true;
        } else if (scene === "pin" || scene === "emergency") {
            // The PIN panel as it asks for the passcode (nothing is set: the
            // scene only shows it); "emergency" then taps its Emergency Call.
            var panel = shell.lockScreen.unlockPanel;
            panel.setupDialog(true, qsTr("Device Locked"), qsTr("Enter PIN"), false, 0);
            panel.shown = true;
            if (scene === "emergency")
                shell.openEmergency();
        } else if (scene === "justtype") {
            shell.startJustType("m");
        } else if (scene === "keyboard") {
            // Just Type, its field focused: the keyboard comes up.
            shell.startJustType("");
        } else if (scene === "clipstrip") {
            shell.startJustType("");
            clipStripScene();
        } else if (scene === "assistant") {
            assistantScene();
        } else if (scene === "wakeword" || scene === "wakewordlocked") {
            wakeWordScene.locked = scene === "wakewordlocked";
            wakeWordScene.start();
        }
    }

    // "wakeword": Settings > Assistant listening for "Hey Phoenix" (the
    // microphone files, --microphone-file, then play as the microphone: a
    // wake word and request first, an answer to a read-back next);
    // "wakewordlocked" also over the lock screen, and locked.
    Timer {
        id: wakeWordScene
        property bool locked: false
        interval: 1000
        repeat: true
        triggeredOnStart: true
        onTriggered: {
            windows.lunaCall("luna://org.webosphoenix.assistant/setSettings", { wakeWord: true, wakeWhenLocked: locked }, function (r) {
                if (!r || r.returnValue === false || !wakeWordScene.running)
                    return;
                wakeWordScene.stop();
                if (wakeWordScene.locked)
                    shell.lock();
            });
        }
    }

    // "assistant": a short conversation with the Assistant
    // (org.webosphoenix.assistant: a sum, a timer, and a question nothing on
    // the phone can answer) in its view over the screen (the app with
    // --launch, else the card view), each opening being a conversation of
    // its own; with --launch org.webosphoenix.assistant the app has it
    // instead. Each request waits for an answer; one made before a page
    // with the runtime was up is made again.
    function assistantScene() {
        assistantSceneSteps.asks = ["What's 15% of 80?", "Set a timer for 10 minutes", "Who wrote the Odyssey?"];
        assistantSceneSteps.inApp = shell.cardView.maximized && shell._appIdOf(shell.cardView.currentUid) === "org.webosphoenix.assistant";
        assistantSceneSteps.up = false;
        assistantSceneSteps.next();
    }
    Timer {
        id: assistantSceneSteps
        property var asks: []
        property bool inApp: false
        property bool up: false         // the service answers (the system UI page is up)
        property int serial: 0
        interval: 3000
        onTriggered: next()
        function next() {
            var mine = ++serial;
            restart();
            if (!up) {
                // The view opens once the service is there to answer it.
                windows.lunaCall("luna://org.webosphoenix.assistant/getSettings", {}, function (r) {
                    if (mine !== assistantSceneSteps.serial || !r || r.returnValue === false)
                        return;
                    assistantSceneSteps.stop();
                    assistantSceneSteps.up = true;
                    if (!assistantSceneSteps.inApp)
                        shell.openAssistant(false);
                    assistantSceneSteps.next();
                });
                return;
            }
            if (asks.length === 0) {
                stop();
                return;
            }
            var answered = function (r) {
                if (mine !== assistantSceneSteps.serial || !r || r.returnValue === false)
                    return;
                assistantSceneSteps.stop();
                assistantSceneSteps.asks = assistantSceneSteps.asks.slice(1);
                assistantSceneSteps.next();
            };
            var view = shell.assistantOverlay;
            if (inApp || !view.open) {
                windows.lunaCall("luna://org.webosphoenix.assistant/ask", { text: asks[0], speak: false }, answered);
            } else if (!view.busy) {
                // A request that failed (no page up yet) is taken back.
                view.ask(asks[0], function (r) {
                    if (!r || r.returnValue === false) {
                        view.messages = [];
                        view.status = "";
                    }
                    answered(r);
                });
            }
        }
    }

    // "clipstrip": a few clips in the clipboard history (org.webosphoenix.
    // clipboard), the keyboard up for the field in front (the app's first
    // text field, with --launch; else Just Type's), and its clip strip open.
    function clipStripScene() {
        var seed = [
            { text: "Pick up the photos from the lab on Friday", source: "org.webosphoenix.tasks" },
            { text: "https://webosphoenix.org/news", title: "webOS Phoenix news", source: "org.webosphoenix.browser" },
            { text: "c0rrect-Horse!battery", sensitive: true, kind: "password", source: "org.webosphoenix.passwords" },
            { text: "482 913", source: "org.webosphoenix.authenticator", sensitive: true },
            { text: "350 Main Street, Sunnyvale", source: "org.webosphoenix.maps" },
            { text: "Thanks! See you at eight.", source: "org.webosphoenix.messaging" }
        ];
        var call = function (m, p, done) { windows.lunaCall("luna://org.webosphoenix.clipboard/" + m, p, done || function () {}); };
        var focusField = function () {
            var w = shell.cardView.maximized ? windows.windowFor(shell.cardView.currentUid) : null;
            // The page's view takes the focus first (Chromium sends a page
            // without it no focus events), as a tap on the card would.
            var view = w ? windows.inputTarget(shell.cardView.currentUid) : null;
            if (view)
                view.forceActiveFocus();
            if (w && w.runScript)
                w.runScript("(function f(n) { var e = document.querySelector('input:not([type=checkbox]):not([type=radio]), textarea');"
                            + " if (e) e.focus(); else if (n > 0) setTimeout(function () { f(n - 1); }, 300); })(20)");
            var open = function () {
                if (!shell.keyboardOpen)
                    return;
                shell.keyboardOpenChanged.disconnect(open);
                shell.keyboard.openClips();
            };
            if (shell.keyboardOpen)
                shell.keyboard.openClips();
            else
                shell.keyboardOpenChanged.connect(open);
        };
        var run = function () {
            call("addCategory", { name: "Work" }, function (c) {
                var i = 0;
                var next = function () {
                    if (i >= seed.length)
                        return focusField();
                    call("add", seed[i++], function (r) {
                        if (r && r.clip && i === 5)
                            call("pin", { id: r.clip.id });
                        if (r && r.clip && i === 1 && c && c.category)
                            call("setCategory", { id: r.clip.id, category: c.category.id });
                        next();
                    });
                };
                next();
            });
        };
        if (windows.systemUiLoaded)
            return run();
        var once = function () {
            if (!windows.systemUiLoaded)
                return;
            windows.systemUiLoadedChanged.disconnect(once);
            // The app's page has a moment to come up.
            Qt.callLater(run);
        };
        windows.systemUiLoadedChanged.connect(once);
    }

    Timer {
        id: captureTimer
        interval: 3000
        onTriggered: {
            shell.takeScreenshot();
            if (typeof simScene !== "undefined" && simScene === "capturepreview")
                previewTimer.start();
        }
    }
    // "capturepreview": then the notification's preview (the newest capture).
    Timer {
        id: previewTimer
        interval: 2500
        onTriggered: shell.launch("org.webosphoenix.screenshot")
    }

    // Once luna-systemui is up and listening (its page loads after the
    // scene starts on a busy computer), as Simulate > Low Battery does.
    Timer {
        id: lowBatteryTimer
        interval: 3000
        onTriggered: {
            if (!windows.systemUiLoaded)
                return restart();
            root.power({ percent: 4, charger: "none" });
        }
    }
}
