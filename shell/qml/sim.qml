// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Desktop simulator entry point (loaded by phoenix-sim).
//
// Context properties set by phoenix-sim:
//   simScene       "locked" | "cards" | "stacks" | "longstack" | "reorder" | "maximized" | "heldcard" | "launcher" |
//                  "launcheredit" | "pin" | "emergency" | "firstuse" | "lowbattery" | "banner" | "notified" | "dashboard" | "drawer" | "capture" | "capturepreview" |
//                  "justtype" | "keyboard" | "systemmenu" | "empty"
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

import QtQuick
import Phoenix.Native
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root

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
    }

    // The screen's state (Shell.display): dimmed or off. A device sets its
    // backlight; here the screen darkens, to a tenth of its brightness when
    // dimmed (DisplayManager::displayDim) and black when off.
    Rectangle {
        anchors.fill: parent
        color: "black"
        // Dock mode's night mode: the night brightness, 1 of 100
        // (DockModeNightBrightness), darker still.
        opacity: shell.display.state === "off" ? 1 : shell.display.state === "dim" ? 0.9 : shell.display.night ? 0.95 : 0
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
            var w = win.width;
            win.width = win.height;
            win.height = w;
        }
        status.deviceOrientation = to;
    }
    Shortcut {
        sequence: "Ctrl+Left"
        context: Qt.ApplicationShortcut
        onActivated: root.turnDevice(1)
    }
    Shortcut {
        sequence: "Ctrl+Right"
        context: Qt.ApplicationShortcut
        onActivated: root.turnDevice(-1)
    }
    // --turn: a second after start-up, for screenshots of the turn.
    Timer {
        running: typeof simTurn !== "undefined" && simTurn !== ""
        interval: 1000
        onTriggered: root.turnDevice(simTurn)
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

    // Simulator only: F4 rings the phone, F5 delivers a text message,
    // Shift+F5 a picture message and Ctrl+F5 an instant message from a
    // buddy (SimWindowSource.simulateIncomingCall / simulateIncomingSms /
    // simulateIncomingMms / simulateIncomingIm). Shortcuts, so they work
    // while a web app has keyboard focus.
    Shortcut {
        sequence: "F4"
        context: Qt.ApplicationShortcut
        onActivated: windows.simulateIncomingCall()
    }
    Shortcut {
        sequence: "F5"
        context: Qt.ApplicationShortcut
        onActivated: windows.simulateIncomingSms()
    }
    Shortcut {
        sequence: "Shift+F5"
        context: Qt.ApplicationShortcut
        onActivated: windows.simulateIncomingMms()
    }
    Shortcut {
        sequence: "Ctrl+F5"
        context: Qt.ApplicationShortcut
        onActivated: windows.simulateIncomingIm()
    }
    // F6: the battery runs low (5% and under: luna-systemui's Low Battery
    // alert, battery_low.mp3). F7: plug a wall charger in or out ("Charging
    // Battery", charging.mp3). F8: charged to full (battery_full.mp3).
    // F12: set the device on a Touchstone (the inductive charger; dock mode,
    // GAPS R5) or lift it off; Shift+F12: onto another Touchstone (each
    // remembers its exhibition). --touchstone starts on one.
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
    Shortcut {
        sequence: "F6"
        context: Qt.ApplicationShortcut
        onActivated: root.power({ percent: 4, charger: "none" })
    }
    Shortcut {
        sequence: "F7"
        context: Qt.ApplicationShortcut
        onActivated: {
            var c = root.charger === "wall" ? "none" : "wall";
            root.power({ charger: c, percent: c === "none" ? 60 : 61 });
        }
    }
    // Ctrl+Shift+K: a hardware keyboard attached or detached.
    Shortcut {
        sequence: "Ctrl+Shift+K"
        context: Qt.ApplicationShortcut
        onActivated: status.hardwareKeyboard = !status.hardwareKeyboard
    }
    // Shift+F6: the battery stops reporting (powerd gone: the status bar's
    // battery-error, "Battery: Not Available" in the system menu), or
    // reports again.
    Shortcut {
        sequence: "Shift+F6"
        context: Qt.ApplicationShortcut
        onActivated: status.batteryPercent = status.batteryPercent < 0 ? 60 : -1
    }
    Shortcut {
        sequence: "F8"
        context: Qt.ApplicationShortcut
        onActivated: root.power({ charger: root.charger === "none" ? "wall" : root.charger, percent: 100, puckId: status.puckId })
    }
    Shortcut {
        sequence: "F12"
        context: Qt.ApplicationShortcut
        onActivated: root.power(root.charger === "inductive" ? { charger: "none", percent: 60 }
                                                             : { charger: "inductive", percent: 61, puckId: root.touchstones[0] })
    }
    Shortcut {
        sequence: "Shift+F12"
        context: Qt.ApplicationShortcut
        onActivated: {
            // Lifted off one and set on the other.
            var next = status.puckId === root.touchstones[1] ? root.touchstones[0] : root.touchstones[1];
            if (root.charger === "inductive")
                root.power({ charger: "none", percent: 60 });
            root.power({ charger: "inductive", percent: 61, puckId: next });
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
    on_BootDoneChanged: if (_bootDone) shell.systemScreens.finishBoot()
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
            root.charger = connected ? "pc" : "none";
            root.power({ charger: root.charger });
        }
    }
    Connections {
        target: windows
        function onEnterMSMRequested(enterIMasq) { storage.enterMSM(enterIMasq); }
    }
    Shortcut {
        sequence: "Shift+F8"
        context: Qt.ApplicationShortcut
        onActivated: storage.plug(!storage.hostConnected)
    }
    Shortcut {
        sequence: "Ctrl+F8"
        context: Qt.ApplicationShortcut
        onActivated: storage.eject()
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
        }
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

    Timer {
        id: lowBatteryTimer
        interval: 3000
        onTriggered: windows.simulatePower({ percent: 4, charger: "none" })
    }
}
