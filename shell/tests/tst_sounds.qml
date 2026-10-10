// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// System sounds: which sound plays for which event, on which stream, and
// when nothing does (SoundPolicy.js, SystemSounds.qml, and the shell wiring
// them to banners, popup alerts, closing cards and the battery). The window
// source is the player; SimWindowSource logs what it was asked to play, and
// a fake player stands in for it in the SystemSounds tests.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import "../qml/Phoenix/Shell/SoundPolicy.js" as Policy

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    // Every sound the shell played through phoenix-sim's window source (its
    // soundLog keeps only the last 50).
    property var heard: []
    Connections {
        target: windows
        function onLastSoundChanged() { if (windows.lastSound) root.heard.push(windows.lastSound.path); }
    }

    // A player that records: playSound / stopSound / soundExists / appDir.
    QtObject {
        id: fakePlayer
        property var played: []
        property var stopped: []
        property var files: ["/usr/palm/sounds/alert.wav", "/usr/palm/sounds/notification.wav", "/usr/palm/sounds/phone.wav",
                             "/usr/palm/sounds/ringtone.mp3", "/usr/palm/sounds/boot.mp3", "/usr/palm/sounds/shutdown.mp3",
                             "/usr/palm/sounds/battery_full.mp3", "/usr/palm/sounds/battery_low.mp3",
                             "/usr/palm/sounds/charging.mp3", "/usr/palm/applications/com.example.app/sounds/ding.wav"]
        property int next: 1
        function playSound(path, stream, loop, duration, volume, fallback) {
            var h = "h" + (next++);
            played = played.concat([{ handle: h, path: path, stream: stream, loop: loop, duration: duration,
                                      volume: volume, fallback: fallback }]);
            return h;
        }
        function stopSound(h) { stopped = stopped.concat([h]); }
        function soundExists(path) { return files.indexOf(path) >= 0; }
        function appDir(appId) { return "/usr/palm/applications/" + appId; }
        function reset() { played = []; stopped = []; }
        function last() { return played.length ? played[played.length - 1] : null; }
    }

    QtObject {
        id: fakeSystem
        property bool muted: false
        property int volume: 100
        property var streams: ({ pringtones: 100, palerts: 50, pfeedback: 100 })
        property bool systemSounds: true
        property bool tapSounds: true
        property string ringtone: "/usr/palm/sounds/ringtone.mp3"
        property string alerttone: "/usr/palm/sounds/alert.wav"
        property string notificationtone: "/usr/palm/sounds/notification.wav"
        property int batteryPercent: 76
    }

    SystemSounds {
        id: sounds
        source: fakePlayer
        system: fakeSystem
    }

    // ---- The rules --------------------------------------------------------------------------

    TestCase {
        name: "SoundPolicy"

        function env(prefs) {
            return { appDir: "/usr/palm/applications/com.example.app",
                     exists: function(p) { return fakePlayer.files.indexOf(p) >= 0; },
                     prefs: prefs || { ringtone: "/usr/palm/sounds/ringtone.mp3", alerttone: "/usr/palm/sounds/alert.wav",
                                       notificationtone: "/usr/palm/sounds/notification.wav" } };
        }

        function test_streamClasses() {
            compare(Policy.streamClass("alert"), "alerts");
            compare(Policy.streamClass("notification"), "notifications");
            compare(Policy.streamClass("ringtone"), "ringtones");
            compare(Policy.streamClass("calendar"), "calendar");
            compare(Policy.streamClass("feedback"), "feedback");
            compare(Policy.streamClass("feedback", true), "notifications");
            compare(Policy.streamClass("anything"), "notifications");
            compare(Policy.streamClass("none"), "");
            compare(Policy.streamClass("vibrate"), "vibrate");
            compare(Policy.sinkFor("ringtones"), "pringtones");
            compare(Policy.sinkFor("calendar"), "palerts");
            compare(Policy.sinkFor("feedback"), "pfeedback");
        }

        // luna-systemui's "Charging Battery" banner (PowerdService.js:138).
        function test_chargingBanner() {
            var d = Policy.forBanner("notifications", "/usr/palm/sounds/charging.mp3", 0, false, env());
            compare(d.file, "/usr/palm/sounds/charging.mp3");
            compare(d.stream, "notifications");
            compare(d.loop, false);
            // Notifications are capped at 5 s (NotificationSoundDuration).
            compare(d.duration, 5000);
        }

        function test_bannerWithoutSound() {
            compare(Policy.forBanner("", "", 0, false, env()), null);
            compare(Policy.forBanner("none", "/usr/palm/sounds/charging.mp3", 0, false, env()), null);
            verify(Policy.forBanner("vibrate", "", 0, false, env()).vibrate);
        }

        function test_bannerTones() {
            // A class and no file: the user's tone for it.
            compare(Policy.forBanner("notifications", "", 0, false, env()).file, "/usr/palm/sounds/notification.wav");
            compare(Policy.forBanner("alerts", "", 3000, false, env()).file, "/usr/palm/sounds/alert.wav");
            compare(Policy.forBanner("alerts", "", 3000, false, env()).duration, 3000);
            compare(Policy.forBanner("alerts", "", 0, false, env()).duration, -1);
            // A file relative to the app, then to the system sounds.
            compare(Policy.forBanner("alerts", "sounds/ding.wav", 0, false, env()).file,
                    "/usr/palm/applications/com.example.app/sounds/ding.wav");
            compare(Policy.forBanner("alerts", "charging.mp3", 0, false, env()).file, "/usr/palm/sounds/charging.mp3");
            // A file that is not there: the tone for the class.
            compare(Policy.forBanner("alerts", "/usr/palm/applications/com.palm.app.email/sounds/emailreceived.mp3", 3000, false, env()).file,
                    "/usr/palm/sounds/alert.wav");
            // No tone set: alert.wav (lunaDefaultAlertSound).
            compare(Policy.forBanner("notifications", "", 0, false, env({})).file, "/usr/palm/sounds/alert.wav");
            // A tone that is gone: what SoundPlayer::healthCheck played instead.
            var gone = { ringtone: "/media/internal/ringtones/gone.mp3", notificationtone: "/gone.wav" };
            compare(Policy.forBanner("notifications", "", 0, false, env(gone)).file, "/usr/palm/sounds/alert.wav");
            compare(Policy.forBanner("ringtones", "", 0, true, env(gone)).file, "/usr/palm/sounds/notification.wav");
        }

        // Popup alerts (AlertWindow::extractSoundParams).
        function test_alerts() {
            // The incoming call rings the ringtone, looped, until it goes.
            var call = Policy.forAlert("", "ringtones", env());
            compare(call.file, "/usr/palm/sounds/ringtone.mp3");
            compare(call.stream, "ringtones");
            verify(call.loop);
            compare(call.duration, -1);
            // No ringtone to be found: phone.wav (lunaDefaultRingtoneSound).
            compare(Policy.forAlert("", "ringtones", env({ ringtone: "/media/x/Pre.mp3" })).file, "/usr/palm/sounds/phone.wav");
            compare(Policy.forAlert("/gone.mp3", "ringtones", env({})).file, "/usr/palm/sounds/phone.wav");
            // The contact's own ringtone.
            compare(Policy.forAlert("/usr/palm/sounds/alert.wav", "ringtone", env()).file, "/usr/palm/sounds/alert.wav");
            // An alert with its own sound and class.
            var low = Policy.forAlert("/usr/palm/sounds/battery_low.mp3", "alerts", env());
            compare(low.file, "/usr/palm/sounds/battery_low.mp3");
            compare(low.stream, "alerts");
            verify(!low.loop);
            // A Calendar reminder: the alert tone.
            compare(Policy.forAlert("", "calendar", env()).file, "/usr/palm/sounds/alert.wav");
            // A URL counts by its path.
            compare(Policy.forAlert("file:///usr/palm/sounds/charging.mp3", "alerts", env()).file, "/usr/palm/sounds/charging.mp3");
            // No class: a notification, capped at 5 s. luna-systemui's Low
            // Battery alert is one: it passes {sound: battery_low.mp3,
            // soundclass: "alerts"} as the window's params, not its
            // attributes (PowerdService.js:78), so LunaSysMgr never saw them.
            compare(Policy.forAlert("", "", env()).file, "/usr/palm/sounds/notification.wav");
            compare(Policy.forAlert("", "", env()).duration, 5000);
            compare(Policy.forAlert("", "none", env()), null);
            verify(Policy.forAlert("", "vibrate", env()).vibrate);
        }

        function test_feedback() {
            compare(Policy.forFeedback("key", "", {}), "/usr/share/phoenix/sounds/feedback/key.wav");
            compare(Policy.forFeedback("appclose", "", {}), "/usr/share/phoenix/sounds/feedback/appclose.wav");
            // The angry card's and the launcher's (Phoenix's mimics too).
            compare(Policy.forFeedback("carddrag", "", {}), "/usr/share/phoenix/sounds/feedback/carddrag.wav");
            compare(Policy.forFeedback("birdappclose", "", {}), "/usr/share/phoenix/sounds/feedback/birdappclose.wav");
            compare(Policy.forFeedback("LauncherOpenApp", "", {}), "/usr/share/phoenix/sounds/feedback/LauncherOpenApp.wav");
            compare(Policy.forFeedback("LauncherCloseApp", "", {}), "/usr/share/phoenix/sounds/feedback/LauncherCloseApp.wav");
            // audiod's other names have no sound here.
            compare(Policy.forFeedback("sysmgr_alert", "", {}), "");
            // "System Sounds" off: silent, unless a sink is named.
            compare(Policy.forFeedback("appclose", "", { systemSounds: false }), "");
            compare(Policy.forFeedback("appclose", "palerts", { systemSounds: false }), "/usr/share/phoenix/sounds/feedback/appclose.wav");
            // Keyboard clicks off: the keys only.
            compare(Policy.forFeedback("space", "", { tapSounds: false }), "");
            compare(Policy.forFeedback("appclose", "", { tapSounds: false }), "/usr/share/phoenix/sounds/feedback/appclose.wav");
        }

        function test_volume() {
            compare(Policy.volume("ringtones", {}), 1);
            compare(Policy.volume("ringtones", { muted: true }), 0);
            compare(Policy.volume("notifications", { volume: 50, streams: { palerts: 50 } }), 0.25);
            compare(Policy.volume("feedback", { volume: 100, streams: { pfeedback: 0 } }), 0);
            compare(Policy.volume("ringtones", { volume: 80, streams: { palerts: 10 } }), 0.8);
        }

        // StatusBarBattery: once at 100 %, after having been below 95 %.
        function test_batteryFull() {
            var r = Policy.batteryFull(false, 100, true);
            verify(!r.play);
            r = Policy.batteryFull(r.armed, 90, true);
            verify(r.armed && !r.play);
            r = Policy.batteryFull(r.armed, 99, true);
            verify(!r.play);
            r = Policy.batteryFull(r.armed, 100, true);
            verify(r.play && !r.armed);
            r = Policy.batteryFull(r.armed, 100, true);
            verify(!r.play);
            // Not before boot has finished.
            verify(!Policy.batteryFull(true, 100, false).play);
        }
    }

    // ---- SystemSounds with a fake player -----------------------------------------------------

    TestCase {
        name: "SystemSounds"

        function init() {
            fakePlayer.reset();
            fakeSystem.muted = false;
            fakeSystem.volume = 100;
            fakeSystem.systemSounds = true;
        }

        function test_notificationPlays() {
            sounds.notification("com.palm.systemui", "notifications", "/usr/palm/sounds/charging.mp3", 0, false);
            var p = fakePlayer.last();
            compare(p.path, "/usr/palm/sounds/charging.mp3");
            compare(p.stream, "notifications");
            compare(p.duration, 5000);
            // Alerts & notifications at 50 %.
            compare(p.volume, 0.5);
            compare(p.fallback, "/usr/palm/sounds/alert.wav");
        }

        function test_mutedIsSilent() {
            fakeSystem.muted = true;
            sounds.notification("com.palm.systemui", "notifications", "/usr/palm/sounds/charging.mp3", 0, false);
            sounds.feedback("key");
            sounds.alertActivated("a-muted", "org.webosphoenix.phone", "", "ringtones");
            compare(fakePlayer.played.length, 0);
            // It still decided what it would have played.
            compare(sounds.last.file, "/usr/palm/sounds/ringtone.mp3");
            compare(sounds.last.volume, 0);
            fakeSystem.muted = false;
            fakeSystem.volume = 0;
            sounds.notification("com.palm.systemui", "notifications", "", 0, false);
            compare(fakePlayer.played.length, 0);
        }

        function test_vibrate() {
            var n = sounds.vibrations;
            sounds.notification("com.palm.app.email", "vibrate", "", 0, false);
            compare(sounds.vibrations, n + 1);
            compare(fakePlayer.played.length, 0);
        }

        // AlertWindow::activate / deactivate.
        function test_alertSoundsOnceAndStops() {
            sounds.alertActivated("call-1", "org.webosphoenix.phone", "", "ringtones");
            compare(fakePlayer.played.length, 1);
            var h = fakePlayer.last().handle;
            verify(fakePlayer.last().loop);
            // Pushed behind another alert: it stops...
            sounds.alertDeactivated("call-1");
            compare(fakePlayer.stopped, [h]);
            // ...and does not sound again when it comes back.
            sounds.alertActivated("call-1", "org.webosphoenix.phone", "", "ringtones");
            compare(fakePlayer.played.length, 1);
            sounds.alertClosed("call-1");
            // A new window with the same key is a new alert.
            sounds.alertActivated("call-1", "org.webosphoenix.phone", "", "ringtones");
            compare(fakePlayer.played.length, 2);
            sounds.alertClosed("call-1");
            compare(fakePlayer.stopped.length, 2);
        }

        function test_bootAndBattery() {
            sounds.playBootSound = false;
            sounds.bootFinished();
            compare(fakePlayer.played.length, 0);
            sounds.playBootSound = true;
            sounds.bootFinished();
            compare(fakePlayer.last().path, "/usr/palm/sounds/boot.mp3");
            sounds.shutdown();
            compare(fakePlayer.last().path, "/usr/palm/sounds/shutdown.mp3");
            sounds.playBootSound = false;
            fakePlayer.reset();
            fakeSystem.batteryPercent = 94;
            fakeSystem.batteryPercent = 100;
            compare(fakePlayer.played.length, 1);
            compare(fakePlayer.last().path, "/usr/palm/sounds/battery_full.mp3");
            fakeSystem.batteryPercent = 99;
            fakeSystem.batteryPercent = 100;
            compare(fakePlayer.played.length, 1);
            fakeSystem.batteryPercent = 76;
        }
    }

    // ---- The shell ---------------------------------------------------------------------------

    TestCase {
        name: "ShellSounds"
        when: windowShown

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            windows.alerts.clear();
            shell.notifications.bannerActive = false;
            shell.cardView.maximizeProgress = 0;
            sys.muted = false;
            sys.systemSounds = true;
            shell.unlock();
        }

        // A banner's sound plays as it shows (BannerMessageHandler).
        function test_bannerSound() {
            var n = windows.soundCount;
            windows.bannerRequested("com.palm.systemui", "Charging Battery", "", "{}", "notifications", "/usr/palm/sounds/charging.mp3", 0, "");
            compare(windows.soundCount, n + 1);
            compare(windows.lastSound.path, "/usr/palm/sounds/charging.mp3");
            compare(windows.lastSound.stream, "notifications");
            compare(windows.lastSound.duration, 5000);
            // The simulator's volumes: master 60 %, alerts 70 %.
            fuzzyCompare(windows.lastSound.volume, 0.42, 0.0001);
            // A banner without a sound is silent.
            windows.bannerRequested("com.palm.app.calendar", "Syncing accounts", "", "{}", "", "", 0, "");
            compare(windows.soundCount, n + 1);
            shell.notifications.bannerActive = false;
        }

        // The runtime's host messages: playSoundNotification, a text that
        // arrived for Messaging.
        function test_appSounds() {
            windows._hostMessage("com.palm.app.email", "", "sound",
                                 { soundClass: "alerts", soundFile: "/usr/palm/applications/com.palm.app.email/sounds/emailreceived.mp3", duration: 3000 });
            // Phoenix's own emailreceived.mp3 (the original's cannot ship,
            // docs/LEGAL.md; the compat overlay has one in its place).
            compare(windows.lastSound.path, "/usr/palm/applications/com.palm.app.email/sounds/emailreceived.mp3");
            compare(windows.lastSound.duration, 3000);
            // One that is not there: the alert tone.
            windows._hostMessage("com.palm.app.email", "", "sound",
                                 { soundClass: "alerts", soundFile: "/usr/palm/applications/com.palm.app.email/sounds/gone.mp3", duration: 3000 });
            compare(windows.lastSound.path, "/usr/palm/sounds/alert.wav");
            windows._hostMessage("org.webosphoenix.messaging", "", "notification",
                                 { appId: "org.webosphoenix.messaging", title: "Sam", body: "Lunch?", soundClass: "notifications" });
            compare(windows.lastSound.path, "/usr/palm/sounds/notification.wav");
            compare(windows.lastSound.duration, 5000);
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
        }

        // Settings > Sounds' alert and notification tones, as the runtime
        // sends them (systemStatus alerttone / notificationtone): what sounds
        // for alerts and alarms, and for notifications, that name no sound
        // of their own (or one that does not exist).
        function test_chosenTonesPlay() {
            sys.applyAppStatus({ alerttone: "/usr/palm/sounds/phone.wav", notificationtone: "/usr/palm/sounds/ringtone.mp3" });
            windows._hostMessage("com.palm.app.email", "", "sound",
                                 { soundClass: "alerts", soundFile: "/usr/palm/applications/com.palm.app.email/sounds/gone.mp3", duration: 3000 });
            compare(windows.lastSound.path, "/usr/palm/sounds/phone.wav");
            windows._hostMessage("org.webosphoenix.messaging", "", "notification",
                                 { appId: "org.webosphoenix.messaging", title: "Sam", body: "Lunch?", soundClass: "notifications" });
            compare(windows.lastSound.path, "/usr/palm/sounds/ringtone.mp3");
            compare(windows.lastSound.duration, 5000);
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            var n = windows.soundCount;
            windows.alerts.append({ key: "alarm", appId: "com.palm.app.clock", name: "alarm", height: 150,
                                    sound: "", soundClass: "alarm" });
            tryCompare(windows, "soundCount", n + 1, 1000);
            compare(windows.lastSound.path, "/usr/palm/sounds/phone.wav");
            windows.alerts.clear();
            sys.applyAppStatus({ alerttone: "/usr/palm/sounds/alert.wav", notificationtone: "/usr/palm/sounds/notification.wav" });
        }

        function test_mutedBanner() {
            sys.muted = true;
            var n = windows.soundCount;
            windows.bannerRequested("com.palm.systemui", "Charging Battery", "", "{}", "notifications", "/usr/palm/sounds/charging.mp3", 0, "");
            compare(windows.soundCount, n);
            sys.muted = false;
            shell.notifications.bannerActive = false;
        }

        // The incoming call rings the ringtone until its alert goes.
        function test_incomingCallRings() {
            var n = windows.soundCount;
            windows.alerts.append({ key: "call-a", appId: "org.webosphoenix.phone", name: "incoming-known", height: 150,
                                    sound: "", soundClass: "ringtones" });
            tryCompare(windows, "soundCount", n + 1, 1000);
            compare(windows.lastSound.path, "/usr/palm/sounds/ringtone.mp3");
            compare(windows.lastSound.stream, "ringtones");
            verify(windows.lastSound.loop);
            var h = windows.lastSound.handle;
            // Settings' ringtone.
            sys.ringtone = "/usr/palm/sounds/phone.wav";
            windows.alerts.clear();
            tryVerify(function() { return windows.stoppedSounds.indexOf(h) >= 0; }, 1000);
            windows.alerts.append({ key: "call-b", appId: "org.webosphoenix.phone", name: "incoming-known", height: 150,
                                    sound: "", soundClass: "ringtones" });
            tryCompare(windows, "soundCount", n + 2, 1000);
            compare(windows.lastSound.path, "/usr/palm/sounds/phone.wav");
            windows.alerts.clear();
            sys.ringtone = "/usr/palm/sounds/ringtone.mp3";
        }

        // A more urgent alert in front: the one behind stops, and does not
        // sound again when it returns to the front.
        function test_alertBehindStops() {
            var n = windows.soundCount;
            // luna-systemui's Low Battery alert: no sound attributes (see
            // SoundPolicy's test), so the notification tone.
            windows.alerts.append({ key: "low", appId: "com.palm.systemui", name: "LowBatteryAlert", height: 150,
                                    sound: "", soundClass: "" });
            tryCompare(windows, "soundCount", n + 1, 1000);
            compare(windows.lastSound.path, "/usr/palm/sounds/notification.wav");
            compare(windows.lastSound.stream, "notifications");
            var low = windows.lastSound.handle;
            windows.alerts.insert(0, { key: "call", appId: "org.webosphoenix.phone", name: "incoming-known", height: 150,
                                       sound: "", soundClass: "ringtones" });
            tryCompare(windows, "soundCount", n + 2, 1000);
            compare(shell.notifications.alertKey, "call");
            verify(windows.stoppedSounds.indexOf(low) >= 0);
            windows.alerts.remove(0);
            wait(50);
            compare(windows.soundCount, n + 2);
            windows.alerts.clear();
        }

        // Throwing a card away plays "appclose"; a window closing itself does not.
        function test_cardCloseSound() {
            var uid = windows.launch("org.webosphoenix.email", "");
            var n = windows.soundCount;
            shell.cardView.close(uid);
            compare(windows.soundCount, n + 1);
            compare(windows.lastSound.path, "/usr/share/phoenix/sounds/feedback/appclose.wav");
            compare(windows.lastSound.stream, "feedback");
            tryCompare(windows.cards, "count", 0, 2000);
            uid = windows.launch("org.webosphoenix.email", "");
            n = windows.soundCount;
            windows.cardCloseRequested(uid);
            tryCompare(windows.cards, "count", 0, 2000);
            compare(windows.soundCount, n);
            // "System Sounds" off.
            uid = windows.launch("org.webosphoenix.email", "");
            sys.systemSounds = false;
            shell.cardView.close(uid);
            compare(windows.soundCount, n);
            tryCompare(windows.cards, "count", 0, 2000);
        }

        // Upside down, the angry card creaks as it is pulled past 15 % of
        // the screen and flies off with "birdappclose" instead of "appclose"
        // (CardWindowManager.cpp:1280-1283, 1523-1527, 2890-2893); upright,
        // no creak and "appclose".
        function angryPull(cv) {
            var x = cv.width / 2, y = cv.cardOriginY;
            mousePress(cv, x, y);
            for (var i = 1; i <= 14; ++i)
                mouseMove(cv, x, y + i * 25, 10);
            mouseRelease(cv, x, y + 350);
        }
        function soundsSince(n) {
            return root.heard.slice(n).map(function (p) { return p.replace(/.*\//, ""); });
        }
        function test_angryCardSounds() {
            var cv = shell.cardView;
            windows.launch("org.webosphoenix.email", "");
            wait(50);
            var n = root.heard.length;
            angryPull(cv);
            tryCompare(windows.cards, "count", 0, 2000);
            compare(soundsSince(n).join(), "appclose.wav");
            sys.deviceOrientation = "down";
            tryCompare(shell, "uiOrientation", "down", 2000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            windows.launch("org.webosphoenix.email", "");
            wait(50);
            n = root.heard.length;
            angryPull(cv);
            tryCompare(windows.cards, "count", 0, 2000);
            compare(soundsSince(n).join(), "carddrag.wav,birdappclose.wav");
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 2000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
        }

        // The launcher shown and hidden (SystemUiController::setLauncherShown).
        function test_launcherSounds() {
            var n = root.heard.length;
            shell.gestureUp();
            tryCompare(shell, "launcherOpen", true, 1000);
            compare(soundsSince(n).join(), "LauncherOpenApp.wav");
            shell.homeKey();
            tryCompare(shell, "launcherOpen", false, 1000);
            compare(soundsSince(n).join(), "LauncherOpenApp.wav,LauncherCloseApp.wav");
        }

        function test_batteryFull() {
            var n = windows.soundCount;
            sys.batteryPercent = 90;
            sys.batteryPercent = 100;
            compare(windows.soundCount, n + 1);
            compare(windows.lastSound.path, "/usr/palm/sounds/battery_full.mp3");
            sys.batteryPercent = 76;
        }

        // Tests (and screenshots) boot without the boot sound.
        function test_noBootSoundByDefault() {
            verify(!shell.bootSound);
            for (var i = 0; i < windows.soundLog.length; ++i)
                verify(windows.soundLog[i].path !== "/usr/palm/sounds/boot.mp3");
        }
    }
}
