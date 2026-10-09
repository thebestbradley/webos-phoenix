// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Simulate > Location (Phoenix.Sim SimLocation): the cities, a custom
// "lat, lon", moving along the route Maps shows, a fix a second with its
// heading and speed, stopping at the end; and the entries in sim.qml's
// Simulate menu.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    // Stand-ins for the simulator's pages: what they were asked to run.
    property var ran: []
    property var mapsRoute: null
    QtObject {
        id: systemPage
        property string url: "phoenix://rootfs/usr/palm/applications/com.palm.systemui/index.html"
        property string appId: "com.palm.systemui"
        function runScript(js, done) {
            root.ran.push(js);
            if (done) done(JSON.stringify({ latitude: 37.3337, longitude: -121.8907 }));
        }
    }
    QtObject {
        id: mapsPage
        property string url: "phoenix://rootfs/usr/palm/applications/org.webosphoenix.maps/index.html"
        property string appId: "org.webosphoenix.maps"
        function runScript(js, done) {
            root.ran.push(js);
            if (done) done(JSON.stringify(root.mapsRoute));
        }
    }
    QtObject {
        id: pages
        property bool withMaps: true
        function _webPages() { return withMaps ? [systemPage, mapsPage] : [systemPage]; }
    }

    SimLocation {
        id: loc
        windows: pages
        askText: function () { return "48.8584, 2.2945"; }
        property var told: []
        alert: function (text) { told = told.concat([text]); }
    }

    // The last position set: [lat, lon, extra].
    function lastSet() {
        for (var i = ran.length - 1; i >= 0; --i) {
            var m = /location\.set\(([^,]+), ([^,]+), (.*)\)$/.exec(ran[i]);
            if (m) return [Number(m[1]), Number(m[2]), JSON.parse(m[3])];
        }
        return null;
    }

    TestCase {
        name: "SimLocation"
        when: windowShown

        function init() { root.ran = []; loc.stopMoving(); }

        function test_cities() {
            verify(loc.goTo("london"));
            compare(lastSet().slice(0, 2), [51.5079, -0.1281]);
            compare(loc.current, "london");
            verify(loc.goTo("sanjose"));
            compare(lastSet().slice(0, 2), [37.3337, -121.8907], "San Jose: the runtime's home, in Maps' demo region");
            verify(!loc.goTo("atlantis"));
        }

        function test_custom() {
            compare(loc.parseCoords("37.33, -121.89"), [37.33, -121.89]);
            compare(loc.parseCoords("100, 0"), null);
            loc.askCustom();
            compare(lastSet().slice(0, 2), [48.8584, 2.2945]);
            compare(loc.current, "custom");
        }

        // A place the search cannot find, or no answer from it: the user is
        // told (it went only to the log), and the device stays put.
        function test_customNotFoundIsTold() {
            loc.told = [];
            loc.goTo("berlin");
            var url = loc.searchUrl;
            loc.searchUrl = "http://127.0.0.1:9/api";
            try {
                loc.custom("Atlantis");
                tryVerify(function () { return loc.told.length === 1; }, 5000);
                verify(/Atlantis/.test(loc.told[0]), loc.told[0]);
                compare(loc.current, "berlin");
            } finally {
                loc.searchUrl = url;
            }
        }

        function test_movingAlongTheRoute() {
            // About 330 m east, then 220 m north, walking.
            root.mapsRoute = { mode: "walk", geometry: [[-121.8907, 37.3337], [-121.8870, 37.3337], [-121.8870, 37.3357]] };
            loc.toggleMoving();
            verify(loc.moving);
            compare(loc.current, "moving");
            var first = lastSet();
            compare(first.slice(0, 2), [37.3337, -121.8907], "from the route's start");
            compare(first[2].speed, 1.4);
            fuzzyCompare(first[2].direction, 90, 1, "heading east");
            // A step a second at walking pace.
            loc.step();
            var second = lastSet();
            fuzzyCompare(loc.metres([first[1], first[0]], [second[1], second[0]]), 1.4, 0.05);
            // Past the corner it turns north, and it stops at the end.
            var p = loc.pointAlong(root.mapsRoute.geometry, 400);
            fuzzyCompare(p.heading, 0, 1);
            verify(!p.end);
            for (var i = 0; i < 500 && loc.moving; ++i) loc.step();
            verify(!loc.moving, "stopped at the end");
            var last = lastSet();
            compare([last[0].toFixed(4), last[1].toFixed(4)], ["37.3357", "-121.8870"]);
            compare(last[2].speed, 0);
        }

        function test_movingWithoutARoute() {
            root.mapsRoute = null;
            loc.toggleMoving();
            verify(loc.moving);
            compare(loc.status, "Walking north-east");
            verify(loc.pointAlong(loc._path, 10).heading > 0 && loc.pointAlong(loc._path, 10).heading < 90);
            loc.toggleMoving();
            verify(!loc.moving, "again: it stops");
        }

        function test_menu() {
            var ids = loc.actions.filter(function (a) { return !a.separator; }).map(function (a) { return a.id; });
            compare(ids, ["location-sanjose", "location-newyork", "location-london", "location-berlin", "location-paris", "location-tokyo",
                          "location-sydney", "location-custom", "location-host", "location-moving"]);
            loc.goTo("tokyo");
            verify(loc.actions[6].checked());
            verify(loc.actions.every(function (a) { return a.separator || (a.menu === "simulate" && a.submenu === "Location"); }));
        }
    }
}
