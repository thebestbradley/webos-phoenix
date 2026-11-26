// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The devices this computer is paired with, and which one a command means
// (docs/DEV-PUSH.md 6.1, 6.3): ~/.config/nova/devices.json
//
//   {"devices": [{"name", "deviceId", "key" (base64: pinned), "fingerprint",
//                 "address", "port", "paired", "lastUsed"}], "last": name}
//
// -d / --device, as Palm's -d did:
//   NAME or DEVICE ID   a paired device, at its last address
//   usb                 the USB network link (the device's fixed address
//                       on it, 172.16.42.1: P3/P5 make the gadget)
//   sim, sim:NAME       a running phoenix-sim (its novad writes where it
//                       listens to ~/.config/nova/sims/<NAME or default>.json)
//   ADDRESS[:PORT]      a device there (pairing; or a paired one moved)
// Without -d: the one paired device, else the last one used.

"use strict";

const fs = require("fs");
const path = require("path");
const keys = require("./keys.cjs");

const USB_ADDRESS = "172.16.42.1";
const PORT = 6965;

function fail(code, text) { return Object.assign(new Error(text), { code }); }

function file() { return path.join(keys.configDir(), "devices.json"); }
function load() {
    try {
        const d = JSON.parse(fs.readFileSync(file(), "utf8"));
        return { devices: Array.isArray(d.devices) ? d.devices : [], last: d.last || null };
    } catch (e) { return { devices: [], last: null }; }
}
function save(d) {
    fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file() + ".new", JSON.stringify(d, null, 1) + "\n", { mode: 0o600 });
    fs.renameSync(file() + ".new", file());
}

// A running simulator: {address, port, fingerprint, instance}.
function sim(instance) {
    const name = instance || "default";
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(keys.configDir(), "sims", name + ".json"), "utf8")); } catch (e) {
        throw fail("NO_SIM", "No simulator" + (instance ? " " + instance : "") + " is running with dev push (start it: ./phoenix run" +
                   (instance ? " --instance " + instance : "") + ")");
    }
    let alive = true;
    try { process.kill(s.pid, 0); } catch (e) { alive = e.code === "EPERM"; }
    if (!alive) throw fail("NO_SIM", "The simulator" + (instance ? " " + instance : "") + " that used dev push is no longer running");
    return Object.assign({ instance: name }, s);
}
function listSims() {
    let names = [];
    try { names = fs.readdirSync(path.join(keys.configDir(), "sims")).filter((n) => n.endsWith(".json")); } catch (e) { /* none */ }
    return names.map((n) => { try { return sim(n === "default.json" ? null : n.slice(0, -5)); } catch (e) { return null; } }).filter(Boolean);
}

function parseAddress(a) {
    const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(a);
    if (!m) return null;
    return { address: m[1], port: m[2] ? Number(m[2]) : PORT };
}

// sel (-d's value or undefined) -> {name, address, port, key (pinned) |
// null, entry (devices.json's) | null, sim?}
function select(sel) {
    const d = load();
    const byName = (n) => d.devices.find((x) => x.name === n || x.deviceId === n);
    if (!sel) {
        if (d.devices.length === 1) return target(d.devices[0]);
        const last = d.last && byName(d.last);
        if (last) return target(last);
        if (!d.devices.length) throw fail("NO_DEVICE", "No device is paired with this computer: nova pair ADDRESS (or -d sim, -d usb)");
        throw fail("NO_DEVICE", "Which device? -d NAME (nova devices lists them)");
    }
    if (sel === "sim" || sel.startsWith("sim:")) {
        const s = sim(sel === "sim" ? null : sel.slice(4));
        const name = sel === "sim" ? "sim" : sel;
        const entry = d.devices.find((x) => x.name === name && x.fingerprint === s.fingerprint) || null;
        return { name, address: s.address, port: s.port, key: entry ? entry.key : null, entry, sim: s };
    }
    const known = byName(sel);
    if (known) return target(known);
    if (sel === "usb") {
        const entry = d.devices.find((x) => x.address === USB_ADDRESS) || null;
        return { name: entry ? entry.name : "usb", address: USB_ADDRESS, port: PORT, key: entry ? entry.key : null, entry };
    }
    // A bare word is a name; an address has a dot or a colon (192.168.1.23,
    // phone.local, [fe80::1]:6965).
    const a = /[.:]/.test(sel) ? parseAddress(sel) : null;
    if (!a) throw fail("NO_DEVICE", "No paired device is called " + sel + " (nova devices lists them)");
    const entry = d.devices.find((x) => x.address === a.address && x.port === a.port) || null;
    return { name: entry ? entry.name : sel, address: a.address, port: a.port, key: entry ? entry.key : null, entry };
}
function target(e) { return { name: e.name, address: e.address, port: e.port || PORT, key: e.key, entry: e }; }

// After pairing: the device kept under name (replacing one with the same
// name or key).
function remember(entry) {
    const d = load();
    d.devices = d.devices.filter((x) => x.name !== entry.name && x.key !== entry.key);
    d.devices.push(entry);
    d.last = entry.name;
    save(d);
}
function used(name, address) {
    const d = load();
    const e = d.devices.find((x) => x.name === name);
    if (!e) return;
    e.lastUsed = new Date().toISOString();
    if (address) e.address = address;
    d.last = name;
    save(d);
}
function forget(name) {
    const d = load();
    const before = d.devices.length;
    d.devices = d.devices.filter((x) => x.name !== name && x.deviceId !== name);
    if (d.last === name) d.last = null;
    save(d);
    return d.devices.length !== before;
}

module.exports = { USB_ADDRESS, PORT, load, save, select, remember, used, forget, sim, listSims, parseAddress };
