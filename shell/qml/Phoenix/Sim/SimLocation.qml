// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Simulate > Location: where the simulated device is. It moves the
// runtime's com.webos.service.location (runtime/phoenix-runtime.js,
// __phoenixRuntime.location.set: mock/setLocation), in one page; the
// others hear it as the store changes, so every app gets the new fix live
// (Maps' dot, the Assistant's "near me", the Weather's here).
//
//   - Cities: San Jose (the runtime's home, inside the demo map Maps
//     ships), New York, London, Berlin, Paris, Tokyo, Sydney.
//   - Custom...: "lat, lon", or a place's name (Photon, as Maps searches).
//   - This Computer's Location: Qt Positioning (SimHostPosition.qml, loaded
//     only where the module is: CoreLocation on a Mac, GeoClue on Linux).
//     The default: a device the simulator has not moved yet (or last left
//     at this computer's location) goes there as the simulator starts; San
//     Jose until a fix comes, and where there is none.
//   - Moving: along the route Maps shows (window.__phoenixMapsRoute: its
//     directions or navigation), at the route's pace (driving 13 m/s,
//     cycling 5, walking 1.4), a fix a second with its heading and speed;
//     with no route, a walk north-east. It stops at the end.

import QtQuick

Item {
    id: loc

    // The simulator's pages (SimWindowSource: _webPages(), each with runScript(js, done)).
    property var windows: null
    // Asks for a line of text (phoenix-sim's SimChrome.askText); "" when cancelled.
    property var askText: null
    // Tells the user what went wrong (SimChrome.alert): a place not found
    // went only to the log, and the menu seemed to do nothing.
    property var alert: null
    function _tell(text) {
        console.warn("phoenix-sim: " + text);
        if (alert)
            alert(text);
    }
    // Where Custom... searches a name (Photon's API).
    property string searchUrl: "https://photon.komoot.io/api"

    readonly property var presets: [
        { id: "sanjose", name: qsTr("San Jose"), lat: 37.3337, lon: -121.8907 },
        { id: "newyork", name: qsTr("New York"), lat: 40.7580, lon: -73.9855 },
        { id: "london", name: qsTr("London"), lat: 51.5079, lon: -0.1281 },
        { id: "berlin", name: qsTr("Berlin"), lat: 52.5163, lon: 13.3777 },
        { id: "paris", name: qsTr("Paris"), lat: 48.8584, lon: 2.2945 },
        { id: "tokyo", name: qsTr("Tokyo"), lat: 35.6812, lon: 139.7671 },
        { id: "sydney", name: qsTr("Sydney"), lat: -33.8568, lon: 151.2153 }
    ]
    // Which preset (its id), "custom", "host" or "moving".
    property string current: "sanjose"
    property string status: ""
    readonly property bool moving: mover.running

    readonly property bool hostAvailable: hostPosition.status === Loader.Ready && !!hostPosition.item && hostPosition.item.valid

    // ---- Setting it ------------------------------------------------------------------------

    function _page() {
        var pages = windows && windows._webPages ? windows._webPages() : [];
        return pages.length ? pages[0] : null;
    }
    // Each position set says which entry set it (simSource), so the menu
    // shows it again after a restart, and "host" is followed again.
    function setLocation(lat, lon, extra) {
        var p = _page();
        if (!p)
            return false;
        extra = extra || {};
        extra.simSource = current;
        p.runScript("window.__phoenixRuntime && __phoenixRuntime.location.set(" + JSON.stringify(lat) + ", " + JSON.stringify(lon)
                    + ", " + JSON.stringify(extra) + ")");
        return true;
    }
    function goTo(id) {
        for (var i = 0; i < presets.length; ++i) {
            if (presets[i].id === id) {
                stopMoving();
                current = id;
                status = presets[i].name;
                return setLocation(presets[i].lat, presets[i].lon);
            }
        }
        return false;
    }

    // "37.33, -121.89" -> [lat, lon], else null.
    function parseCoords(text) {
        var m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(text || ""));
        if (!m)
            return null;
        var lat = Number(m[1]), lon = Number(m[2]);
        return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
    }
    function custom(text) {
        var t = String(text || "").trim();
        if (!t)
            return;
        stopMoving();
        var c = parseCoords(t);
        if (c) {
            current = "custom";
            status = t;
            setLocation(c[0], c[1]);
            return;
        }
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE)
                return;
            if (xhr.status !== 200) {
                _tell(qsTr("Could not look up \u201c%1\u201d: the place search (%2) did not answer.").arg(t).arg(searchUrl));
                return;
            }
            var f = null;
            try { f = JSON.parse(xhr.responseText).features[0]; } catch (e) { f = null; }
            if (!f) {
                _tell(qsTr("No place called \u201c%1\u201d.").arg(t));
                return;
            }
            current = "custom";
            status = f.properties && f.properties.name || t;
            setLocation(f.geometry.coordinates[1], f.geometry.coordinates[0]);
        };
        xhr.open("GET", searchUrl + "?limit=1&q=" + encodeURIComponent(t));
        xhr.send();
    }
    function askCustom() {
        if (askText)
            custom(askText(qsTr("Location"), qsTr("Latitude, longitude (37.33, -121.89) or a place:"), ""));
    }

    function useHost() {
        if (!hostAvailable) {
            _tell(qsTr("This computer's location is not available (Qt Positioning has no source)."));
            return;
        }
        stopMoving();
        hostPosition.item.locate();
    }
    Loader {
        id: hostPosition
        // Only where Qt Positioning is installed: without it, this fails alone.
        source: Qt.resolvedUrl("SimHostPosition.qml")
    }
    // Off: start where the device was left (the tests).
    property bool followHost: true
    property bool _started: false
    // At start, once there is a page: the entry that set the device's
    // position last; this computer's location if that was it or nothing was.
    function start() {
        var p = _page();
        if (_started || !p)
            return;
        _started = true;
        p.runScript("JSON.stringify(window.__phoenixRuntime && __phoenixRuntime.location.get())", function (r) {
            var at = null;
            try { at = JSON.parse(r); } catch (e) { at = null; }
            var src = at && at.simSource ? String(at.simSource) : "";
            if (src === "moving")
                src = "custom";
            if (src && src !== "host") {
                loc.current = src;
                return;
            }
            if (loc.followHost && loc.hostAvailable)
                loc.useHost();
        });
    }
    Timer {
        // The pages come as the shell loads: look for one for half a minute.
        interval: 500
        repeat: true
        running: !loc._started
        property int tries: 0
        onTriggered: {
            loc.start();
            if (++tries >= 60)
                loc._started = true;
        }
    }
    Connections {
        target: hostPosition.item
        ignoreUnknownSignals: true
        function onFound(lat, lon) {
            loc.current = "host";
            loc.status = qsTr("This computer");
            loc.setLocation(lat, lon);
        }
    }

    // ---- Moving along the route ------------------------------------------------------------

    readonly property var paces: ({ drive: 13, cycle: 5, walk: 1.4 })
    property var _path: []
    property real _along: 0
    property real _pace: 1.4

    function metres(a, b) {
        var r = Math.PI / 180, x = Math.sin((b[1] - a[1]) * r / 2), y = Math.sin((b[0] - a[0]) * r / 2);
        return 2 * 6371000 * Math.asin(Math.sqrt(x * x + Math.cos(a[1] * r) * Math.cos(b[1] * r) * y * y));
    }
    function bearing(a, b) {
        var r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
        var x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
        return (Math.atan2(y, x) / r + 360) % 360;
    }
    // The point d metres along a line of [lon, lat]: {lon, lat, heading, end}.
    function pointAlong(path, d) {
        for (var i = 1; i < path.length; ++i) {
            var seg = metres(path[i - 1], path[i]);
            if (d <= seg || i === path.length - 1) {
                var k = seg > 0 ? Math.min(1, d / seg) : 1;
                return { lon: path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, lat: path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k,
                         heading: bearing(path[i - 1], path[i]), end: d >= seg && i === path.length - 1 };
            }
            d -= seg;
        }
        return { lon: path[0][0], lat: path[0][1], heading: 0, end: true };
    }
    function startMoving(route) {
        if (route && route.geometry && route.geometry.length > 1) {
            _path = route.geometry;
            _pace = paces[route.mode] || paces.drive;
            status = qsTr("Moving along the route");
        } else {
            // No route: a walk north-east from here (a kilometre).
            var from = route && route.from ? route.from : [presets[0].lon, presets[0].lat];
            _path = [from, [from[0] + 0.0080, from[1] + 0.0064]];
            _pace = paces.walk;
            status = qsTr("Walking north-east");
        }
        _along = 0;
        current = "moving";
        mover.restart();
        step();
    }
    function stopMoving() {
        mover.stop();
    }
    function step() {
        var p = pointAlong(_path, _along);
        setLocation(p.lat, p.lon, { direction: p.heading, speed: p.end ? 0 : _pace });
        if (p.end)
            mover.stop();
        _along += _pace * mover.interval / 1000;
    }
    // Moving: the route Maps shows, read from its page; else from where the device is.
    function toggleMoving() {
        if (mover.running) {
            stopMoving();
            return;
        }
        var pages = windows && windows._webPages ? windows._webPages() : [];
        var maps = null;
        for (var i = 0; i < pages.length; ++i)
            if (/org\.webosphoenix\.maps/.test(String(pages[i].url)) || pages[i].appId === "org.webosphoenix.maps")
                maps = pages[i];
        var fromHere = function () {
            var p = _page();
            if (!p) { startMoving(null); return; }
            p.runScript("JSON.stringify(window.__phoenixRuntime && __phoenixRuntime.location.get())", function (r) {
                var at = null;
                try { at = JSON.parse(r); } catch (e) { at = null; }
                startMoving(at ? { from: [at.longitude, at.latitude] } : null);
            });
        };
        if (!maps) { fromHere(); return; }
        maps.runScript("JSON.stringify(window.__phoenixMapsRoute || null)", function (r) {
            var route = null;
            try { route = JSON.parse(r); } catch (e) { route = null; }
            if (route && route.geometry && route.geometry.length > 1) startMoving(route);
            else fromHere();
        });
    }
    Timer {
        id: mover
        interval: 1000
        repeat: true
        onTriggered: loc.step()
    }

    // ---- Simulate > Location (sim.qml's simActions) ------------------------------------------

    readonly property var actions: [{ separator: true, menu: "simulate" }].concat(presets.map(function (p) {
        return { id: "location-" + p.id, menu: "simulate", submenu: qsTr("Location"), text: p.name, radio: "location",
                 tip: qsTr("The device at %1, %2").arg(p.lat).arg(p.lon),
                 checked: function () { return loc.current === p.id; },
                 run: function () { loc.goTo(p.id); } };
    })).concat([
        { id: "location-custom", menu: "simulate", submenu: qsTr("Location"), text: qsTr("Custom..."), radio: "location",
          tip: qsTr("Latitude and longitude, or a place's name"),
          checked: function () { return loc.current === "custom"; },
          run: function () { loc.askCustom(); } },
        { id: "location-host", menu: "simulate", submenu: qsTr("Location"), text: qsTr("This Computer's Location"), radio: "location",
          tip: qsTr("Where this computer is, from its location service (Qt Positioning)"),
          enabled: function () { return loc.hostAvailable; },
          checked: function () { return loc.current === "host"; },
          run: function () { loc.useHost(); } },
        { id: "location-moving", menu: "simulate", submenu: qsTr("Location"), text: qsTr("Moving Along the Route"),
          tip: qsTr("Along the route Maps shows, at its pace (a walk north-east without one); again to stop"),
          checked: function () { return loc.moving; },
          run: function () { loc.toggleMoving(); } }
    ])
}
