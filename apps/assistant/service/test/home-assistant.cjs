// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in Home Assistant for the tests and the evaluation (test/device.cjs
// answers its address with it): the REST API's few calls lib/commands-home.js
// makes (https://developers.home-assistant.io/docs/api/rest/), on a small
// house whose state each call changes. The token it takes: TOKEN.

"use strict";

var URL = "http://homeassistant.local:8123";
var TOKEN = "ha-test-token";

function house() {
    function e(id, state, name, more) { return { entity_id: id, state: state, attributes: Object.assign({ friendly_name: name }, more || {}) }; }
    return [
        e("light.kitchen", "on", "Kitchen Light", { brightness: 255 }),
        e("light.living_room", "off", "Living Room Lamp"),
        e("light.bedroom", "off", "Bedroom Light"),
        e("switch.coffee_maker", "off", "Coffee Maker"),
        e("fan.ceiling", "off", "Ceiling Fan", { percentage: 0 }),
        e("climate.thermostat", "heat", "Thermostat", { temperature: 68, current_temperature: 66, unit_of_measurement: "°F" }),
        e("lock.front_door", "locked", "Front Door"),
        e("cover.garage_door", "closed", "Garage Door"),
        e("scene.movie_night", "scening", "Movie Night"),
        e("scene.good_morning", "scening", "Good Morning"),
        e("sensor.outside", "54", "Outside Temperature")
    ];
}

function create() {
    var entities = house(), calls = [];
    function find(id) { return entities.filter(function (x) { return x.entity_id === id; })[0] || null; }
    function reply(status, body) { return Promise.resolve({ status: status, body: body === undefined ? "" : JSON.stringify(body) }); }
    function apply(domain, service, data) {
        var s = find(data.entity_id);
        if (!s) return false;
        calls.push({ domain: domain, service: service, data: data });
        var a = s.attributes;
        if (service === "turn_on") {
            s.state = domain === "climate" ? "heat" : domain === "scene" ? s.state : "on";
            if (data.brightness_pct !== undefined) a.brightness = Math.round(data.brightness_pct * 2.55);
        } else if (service === "turn_off") s.state = "off";
        else if (service === "set_temperature") a.temperature = data.temperature;
        else if (service === "set_percentage") { a.percentage = data.percentage; s.state = data.percentage > 0 ? "on" : "off"; }
        else if (service === "lock") s.state = "locked";
        else if (service === "unlock") s.state = "unlocked";
        else if (service === "open_cover") s.state = "open";
        else if (service === "close_cover") s.state = "closed";
        else return false;
        return true;
    }
    function request(r) {
        var auth = (r.headers && (r.headers.Authorization || r.headers.authorization)) || "";
        if (auth !== "Bearer " + TOKEN) return reply(401, { message: "Unauthorized" });
        var p = r.url.slice(URL.length), m;
        if (p === "/api/") return reply(200, { message: "API running." });
        if (p === "/api/states") return reply(200, entities);
        if ((m = /^\/api\/states\/(.+)$/.exec(p))) { var s = find(m[1]); return s ? reply(200, s) : reply(404, { message: "Entity not found." }); }
        if ((m = /^\/api\/services\/([a-z_]+)\/([a-z_]+)$/.exec(p)) && r.method === "POST")
            return apply(m[1], m[2], JSON.parse(r.body || "{}")) ? reply(200, []) : reply(400, { message: "Service not found." });
        return reply(404, { message: "Not found" });
    }
    // The same house over HTTP on 127.0.0.1 (the simulator's checks:
    // tools/test-assistant.cjs): Promise<{url, close()}>.
    function serve(port) {
        var server = require("http").createServer(function (q, res) {
            var body = "";
            q.on("data", function (c) { body += c; });
            q.on("end", function () {
                request({ url: URL + q.url, method: q.method, headers: { Authorization: q.headers.authorization || "" }, body: body }).then(function (r) {
                    res.writeHead(r.status, { "Content-Type": "application/json" });
                    res.end(r.body);
                });
            });
        });
        return new Promise(function (resolve) {
            server.listen(port || 0, "127.0.0.1", function () {
                resolve({ url: "http://127.0.0.1:" + server.address().port, close: function () { server.close(); } });
            });
        });
    }
    return {
        URL: URL, TOKEN: TOKEN, entities: entities, calls: calls, request: request, find: find, serve: serve,
        // The Assistant connected to it (lib/commands-home.js's storage; the device's secrets stand-in seals as {sealed}).
        connect: function (storage) {
            var kinds = ["light", "switch", "fan", "climate", "lock", "cover", "scene", "input_boolean"];
            storage.set("assistant:homeAssistant", { url: URL, tokenEnc: { sealed: TOKEN },
                entities: entities.filter(function (x) { return kinds.indexOf(x.entity_id.split(".")[0]) >= 0; })
                                  .map(function (x) { return { name: x.attributes.friendly_name, domain: x.entity_id.split(".")[0] }; }) });
        }
    };
}

module.exports = { create: create, URL: URL, TOKEN: TOKEN };
