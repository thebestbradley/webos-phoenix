// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's side of AirPods (docs/ACCESSORIES.md), from system.earbuds
// (org.webosphoenix.earbuds' status: LsmSystemStatus subscribes on a
// device, the runtime reports it in phoenix-sim) with Earbuds.js deciding:
//
//   - the AirPods card (EarbudsAlert.qml) when a case opens nearby, in the
//     popup alert's place (the window source's showShellAlert, as its own
//     alerts: MemoryAlert); its Connect, Cancel and Not Now go to the
//     service (system.earbudsRequest); the battery card closes by itself;
//   - ear detection: an earbud out pauses what plays, back in plays it
//     again, through the media keys (DeviceServices.mediaKey: com.palm.keys
//     /media, which the players hear, @phoenix/luna mediakeys.ts), only if
//     something was playing (org.webosphoenix.system getNowPlaying);
//   - a notification as the earbuds' battery runs low (20, 10, 5 %).

import QtQuick
import "Earbuds.js" as Logic

Item {
    id: monitor
    visible: false

    property var system: null
    property var source: null
    property var deviceServices: null
    // The card's key in the window source's alerts.
    readonly property string alertKey: "earbudsalert"
    // Legacy pixels: room for a two-line message.
    readonly property int alertHeight: 250
    // How long the battery card stays.
    property int batteryCardTime: 6000

    readonly property var status: system && system.earbuds ? system.earbuds : null
    property var _prev: null
    property var _dismissed: ({})
    // The card showing: {kind, id, address}, or null.
    property var card: null
    property Item _alert: null
    // Ear detection paused what played (resume only that).
    property bool pausedByEar: false
    // The last pause / resume and notification (tests).
    property string lastEarAction: ""
    property var lastNotification: null

    onStatusChanged: _update()
    function _update() {
        var next = status;
        if (!next)
            return;
        var prev = _prev;
        _prev = next;
        _dismissed = Logic.stillDismissed(_dismissed, next);
        // The card: a case just opened.
        var c = Logic.cardFor(prev, next, _dismissed);
        if (c && (!card || card.id !== c.id || card.kind !== c.kind))
            _show(c);
        _refreshCard(next);
        // Ear detection and the batteries, for each paired pair.
        (next.devices || []).forEach(function (d) {
            var before = Logic.deviceFor(prev, d.address);
            var act = Logic.earAction(before, d);
            if (act !== "")
                _ear(act);
            var low = Logic.lowBattery(before, d);
            if (low)
                _notifyLow(d, low);
        });
    }

    // ---- The card ----------------------------------------------------------------
    Component {
        id: alertComponent
        EarbudsAlert {}
    }
    function _show(c) {
        if (!source || typeof source.showShellAlert !== "function")
            return;
        _close();
        var a = alertComponent.createObject(source, { visible: false, kind: c.kind, nearby: c.nearby, device: c.device });
        a.connectPressed.connect(function () {
            a.connecting = true;
            monitor._request("connect", { id: c.id });
        });
        a.notNowPressed.connect(function () {
            var d = Object.assign({}, monitor._dismissed);
            d[c.id] = true;
            monitor._dismissed = d;
            monitor._close();
        });
        a.cancelPressed.connect(function () {
            monitor._request("cancelConnect", {});
            a.connecting = false;
            monitor._close();
        });
        a.donePressed.connect(function () { monitor._close(); });
        _alert = a;
        card = { kind: c.kind, id: c.id, address: c.device ? c.device.address : "" };
        source.showShellAlert(alertKey, a, alertHeight);
        if (c.kind === "battery")
            batteryTimer.restart();
    }
    function _close() {
        batteryTimer.stop();
        if (!card)
            return;
        card = null;
        _alert = null;
        if (source && typeof source.closeAlert === "function")
            source.closeAlert(alertKey);
    }
    Timer {
        id: batteryTimer
        interval: monitor.batteryCardTime
        onTriggered: monitor._close()
    }
    // The card follows the status: the batteries, the pairing, the
    // AirPods paired at last (it becomes their battery card), gone when the
    // AirPods are (the case closed, out of range).
    function _refreshCard(next) {
        if (!card || !_alert)
            return;
        var n = Logic.nearbyFor(next, card.id);
        var p = next.pairing && next.pairing.id === card.id ? next.pairing : null;
        if (card.kind === "pair" && _alert.connecting && !p) {
            // Paired and connected: the battery card.
            var dev = n && n.paired ? Logic.deviceFor(next, n.paired) : Logic.connectedDevice(next);
            if (dev) {
                _alert.connecting = false;
                _alert.kind = "battery";
                _alert.device = dev;
                card = { kind: "battery", id: card.id, address: dev.address };
                batteryTimer.restart();
            }
        }
        if (p) {
            _alert.pairing = p;
            if (p.state === "failed")
                _alert.connecting = false;
        } else if (_alert.pairing) {
            _alert.pairing = null;
        }
        if (n)
            _alert.nearby = n;
        if (card.address)
            _alert.device = Logic.deviceFor(next, card.address);
        if (!n && !p && !_alert.connecting)
            _close();
    }

    function _request(method, params) {
        if (system && typeof system.earbudsRequest === "function")
            system.earbudsRequest(method, params);
    }

    // ---- Ear detection -------------------------------------------------------------
    function _ear(act) {
        lastEarAction = act;
        if (act === "pause") {
            var pause = function () {
                monitor.pausedByEar = true;
                if (monitor.deviceServices)
                    monitor.deviceServices.mediaKey("pause");
            };
            if (source && typeof source.lunaCall === "function")
                source.lunaCall("luna://org.webosphoenix.system/getNowPlaying", {}, function (r) {
                    // Only what plays; with no answer, pausing is harmless
                    // (a player pauses only when it plays).
                    if (!r || (r.nowPlaying && r.nowPlaying.playing))
                        pause();
                });
            else
                pause();
        } else if (act === "resume" && pausedByEar) {
            pausedByEar = false;
            if (deviceServices)
                deviceServices.mediaKey("play");
        }
    }

    // ---- Low battery ------------------------------------------------------------------
    function _notifyLow(d, low) {
        lastNotification = { title: low.title, body: low.body };
        if (source && typeof source.notify === "function")
            source.notify("org.webosphoenix.settings", low.title, low.body,
                          { page: "bluetooth", view: "earbuds", address: d.address }, { tag: "earbuds-battery-" + d.address });
    }
}
