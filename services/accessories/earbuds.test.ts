// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.earbuds and org.webosphoenix.trackers on a device
// (earbuds.js, trackers.js, scanner.js), over fakes of OSE's Bluetooth
// service (com.webos.service.bluetooth2: the adapter, the devices, the LE
// scan, pairing, A2DP, GATT), its location service, and phoenix-l2cap (a
// transport that records what is sent and plays the AirPods' answers).

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const earbudsLib = require("./earbuds.js") as Any;
const trackersLib = require("./trackers.js") as Any;
const scannerLib = require("./scanner.js") as Any;
const aap = require("./lib/aap.js") as Any;
const dult = require("./lib/dult.js") as Any;

const hex = (s: string) => s.replace(/\s+/g, "").match(/../g)!.map((x) => parseInt(x, 16));
const flush = async () => { for (let i = 0; i < 5; ++i) await new Promise((r) => setTimeout(r, 0)); };
const BT = "luna://com.webos.service.bluetooth2";

function world() {
    const subs: Record<string, { params: Any; cb: (r: Any) => void; cancelled: boolean }[]> = {};
    const calls: { uri: string; params: Any }[] = [];
    const answers: Record<string, (p: Any) => Any> = {};
    const notes: Any[] = [];
    const transports: Any[] = [];
    let saved: Any = null;
    let t = 1_700_000_000_000;
    const pending: { at: number; fn: () => void; id: number }[] = [];
    let nextId = 1;
    const timers = {
        setTimeout: (fn: () => void, ms: number) => { const id = nextId++; pending.push({ at: t + ms, fn, id }); return id; },
        clearTimeout: (id: number) => { const i = pending.findIndex((p) => p.id === id); if (i >= 0) pending.splice(i, 1); },
        setInterval: (fn: () => void, ms: number) => { const id = nextId++; pending.push({ at: t + ms, fn: () => { fn(); pending.push({ at: t + ms, fn: () => {}, id }); }, id }); return id; },
        clearInterval: (id: number) => { const i = pending.findIndex((p) => p.id === id); if (i >= 0) pending.splice(i, 1); },
    };
    const bus = {
        call: (uri: string, params: Any) => {
            calls.push({ uri, params });
            const a = answers[uri];
            return Promise.resolve(a ? a(params) : { returnValue: true });
        },
        subscribe: (uri: string, params: Any, cb: (r: Any) => void) => {
            const s = { params, cb, cancelled: false };
            (subs[uri] = subs[uri] || []).push(s);
            return () => { s.cancelled = true; };
        },
    };
    const push = (uri: string, r: Any) => (subs[uri] || []).filter((s) => !s.cancelled).forEach((s) => s.cb(r));
    const store = { load: () => saved, save: (o: Any) => { saved = JSON.parse(JSON.stringify(o)); } };
    const scanner = scannerLib.createScanner({ subscribe: bus.subscribe, timers, now: () => t });
    const l2cap = (address: string, psm: number) => {
        const tr: Any = { address, psm, sent: [] as number[][], closed: false, packet: null, close: null };
        tr.send = (b: number[]) => tr.sent.push(b);
        tr.close = () => { tr.closed = true; tr.onCloseFn && tr.onCloseFn(); };
        tr.onPacket = (fn: Any) => { tr.packet = fn; };
        tr.onClose = (fn: Any) => { tr.onCloseFn = fn; };
        transports.push(tr);
        return tr;
    };
    return {
        bus, subs, calls, answers, notes, transports, store, scanner, timers, push, l2cap,
        now: () => t,
        advance(ms: number) {
            t += ms;
            pending.sort((a, b) => a.at - b.at);
            while (pending.length && pending[0].at <= t) pending.shift()!.fn();
        },
        saved: () => saved,
        notify: (n: Any) => notes.push(n),
    };
}

function adapter(w: Any, on: boolean) {
    w.push(BT + "/adapter/getStatus", { returnValue: true, adapters: [{ powered: on }] });
}
const PROXIMITY = (lid: number, ind2: number) =>
    [0x02, 0x01, 0x06, 0x1e, 0xff, 0x4c, 0x00].concat(hex("07 19 01 0e 20 55 99"), [ind2, lid, 0x00, 0x00], new Array(16).fill(0x11));

describe("AirPods (org.webosphoenix.earbuds)", () => {
    function setup() {
        const w = world();
        const e = earbudsLib.createEarbuds({ call: w.bus.call, subscribe: w.bus.subscribe, scanner: w.scanner, l2cap: w.l2cap,
                                             store: w.store, now: w.now, timers: w.timers });
        const replies: Any[] = [];
        e.service.getStatus({ subscribe: true }, "com.webos.surfacemanager", (r: Any) => replies.push(r));
        const last = () => replies[replies.length - 1];
        return { w, e, last };
    }

    it("scans only with Bluetooth on, and lists AirPods whose case opens nearby", async () => {
        const { w, e, last } = setup();
        expect(w.subs[BT + "/le/startScan"]).toBeUndefined();
        adapter(w, true);
        await flush();
        expect(w.subs[BT + "/le/startScan"]).toHaveLength(1);
        w.push(BT + "/le/startScan", { returnValue: true, device: { address: "5e:aa:bb:cc:dd:ee", rssi: -48, scanRecord: PROXIMITY(57, 0x37) } });
        await flush();
        expect(last().bluetooth).toBe(true);
        expect(last().nearby).toEqual([expect.objectContaining({ id: "5e:aa:bb:cc:dd:ee", modelName: "AirPods Pro", kind: "airpodspro",
            battery: { right: 90, left: 90, case: 70 }, lidOpen: true, lidOpenCount: 57, paired: "" })]);
        // Not heard for 15 s: gone, at the service's next tick.
        w.advance(16000);
        e.tick();
        await flush();
        expect(last().nearby).toHaveLength(0);
        // Bluetooth off: the scan stops.
        adapter(w, false);
        expect(w.subs[BT + "/le/startScan"][0].cancelled).toBe(true);
    });

    it("pairs the AirPods the card's Connect is for, through bluetooth2, then opens their control channel", async () => {
        const { w, e, last } = setup();
        adapter(w, true);
        w.push(BT + "/le/startScan", { returnValue: true, device: { address: "5e:aa", rssi: -48, scanRecord: PROXIMITY(57, 0x37) } });
        await flush();
        const r: Any[] = [];
        e.service.connect({ id: "5e:aa" }, "com.webos.surfacemanager", (x: Any) => r.push(x));
        await flush();
        expect(r[0].returnValue).toBe(true);
        expect(w.calls.map((c) => c.uri)).toContain(BT + "/adapter/startDiscovery");
        expect(last().pairing).toMatchObject({ state: "searching", modelName: "AirPods Pro" });
        // The inquiry finds a speaker, then the AirPods in pairing mode.
        const airpods = { address: "a0:b1:c2:d3:e4:f5", name: "AirPods Pro", classOfDevice: 0x240418, paired: false, connectedProfiles: [] };
        w.push(BT + "/device/getStatus", { returnValue: true, devices: [{ address: "00:1d", name: "Speaker", classOfDevice: 0x240414, paired: false }, airpods] });
        await flush();
        expect(w.calls.filter((c) => c.uri === BT + "/adapter/pair")).toEqual([{ uri: BT + "/adapter/pair", params: { address: airpods.address } }]);
        expect(last().pairing.state).toBe("pairing");
        w.push(BT + "/device/getStatus", { returnValue: true, devices: [{ ...airpods, paired: true }] });
        await flush();
        expect(w.calls.some((c) => c.uri === BT + "/a2dp/connect" && c.params.address === airpods.address)).toBe(true);
        expect(last().pairing.state).toBe("connecting");
        expect(last().devices).toEqual([expect.objectContaining({ address: airpods.address, name: "AirPods Pro", connected: false })]);
        // Connected: the pairing is done, the control channel opens.
        w.push(BT + "/device/getStatus", { returnValue: true, devices: [{ ...airpods, paired: true, connectedProfiles: ["a2dp", "hfp"] }] });
        await flush();
        expect(last().pairing).toBeNull();
        expect(w.transports).toHaveLength(1);
        const tr = w.transports[0];
        expect([tr.address, tr.psm]).toEqual([airpods.address, 0x1001]);
        expect(tr.sent[0]).toEqual(aap.connectPacket());
        // The AirPods answer and report.
        tr.packet(hex("01 00 04 00 00 00 01 00 02 00"));
        tr.packet(hex("04 00 04 00 04 00 03 04 01 50 02 01 02 01 46 02 01 08 01 28 02 01"));
        tr.packet(hex("04 00 04 00 06 00 00 00"));
        tr.packet(hex("04 00 04 00 09 00 0d 01 00 00 00"));
        tr.packet(hex("04 00 04 00 1d 00 01 b2 00 08 00").concat(Array.from(Buffer.from("Pat's AirPods\0A2084\0Apple Inc.\0")) as number[]));
        await flush();
        const d = last().devices[0];
        expect(d).toMatchObject({ connected: true, aap: true, model: "AirPods Pro", modelNumber: "A2084", kind: "airpodspro",
                                  battery: { left: 80, right: 70, case: 40, single: -1 }, inEar: { left: "ear", right: "ear" },
                                  noiseMode: "off", noiseModes: ["off", "transparency", "anc"], earDetection: true,
                                  conversationAwareness: null });
        // The advertisement nearby is taken for them (one AirPods Pro paired).
        expect(last().nearby[0].paired).toBe(airpods.address);

        // Settings: the listening mode, ear detection, a name, forgetting.
        const out: Any[] = [];
        e.service.setNoiseMode({ address: airpods.address, mode: "anc" }, "", (x: Any) => out.push(x));
        expect(tr.sent[tr.sent.length - 1]).toEqual(aap.setListeningMode("anc"));
        e.service.setNoiseMode({ address: airpods.address, mode: "adaptive" }, "", (x: Any) => out.push(x));
        expect(out[1]).toMatchObject({ returnValue: false });
        e.service.setConversationAwareness({ address: airpods.address, enabled: true }, "", (x: Any) => out.push(x));
        expect(out[2]).toMatchObject({ returnValue: false, errorText: "These AirPods do not have Conversation Awareness" });
        e.service.setEarDetection({ address: airpods.address, enabled: false }, "", (x: Any) => out.push(x));
        expect(tr.sent[tr.sent.length - 1]).toEqual(aap.setEarDetection(false));
        e.service.rename({ address: airpods.address, name: "Gym buds" }, "", (x: Any) => out.push(x));
        await flush();
        expect(last().devices[0]).toMatchObject({ name: "Gym buds", earDetection: false });
        expect(w.saved().earbuds[airpods.address]).toMatchObject({ name: "Gym buds", earDetection: false, modelName: "AirPods Pro" });
        e.service.forget({ address: airpods.address }, "", (x: Any) => out.push(x));
        await flush();
        expect(w.calls.some((c) => c.uri === BT + "/adapter/unpair")).toBe(true);
        expect(tr.closed).toBe(true);
        expect(w.saved().earbuds[airpods.address]).toBeUndefined();
    });

    it("gives up pairing after a minute with no AirPods in pairing mode", async () => {
        const { w, e, last } = setup();
        adapter(w, true);
        w.push(BT + "/le/startScan", { returnValue: true, device: { address: "5e:aa", scanRecord: PROXIMITY(57, 0x37) } });
        await flush();
        e.service.connect({ id: "5e:aa" }, "", () => {});
        w.advance(61000);
        await flush();
        expect(last().pairing).toMatchObject({ state: "failed", error: "No AirPods in pairing mode were found" });
        expect(w.calls.some((c) => c.uri === BT + "/adapter/cancelDiscovery")).toBe(true);
    });

    it("refuses with Bluetooth off, and for AirPods no longer near", async () => {
        const { w, e } = setup();
        const out: Any[] = [];
        e.service.connect({ id: "x" }, "", (x: Any) => out.push(x));
        adapter(w, true);
        e.service.connect({ id: "x" }, "", (x: Any) => out.push(x));
        expect(out.map((o) => o.errorText)).toEqual(["Bluetooth is off", "Those AirPods are no longer nearby"]);
    });

    it("forgets AirPods that went away, and reopens a dropped channel later", async () => {
        const { w, e, last } = setup();
        adapter(w, true);
        w.push(BT + "/le/startScan", { returnValue: true, device: { address: "5e:aa", scanRecord: PROXIMITY(57, 0x37) } });
        const pods = { address: "a0:b1", name: "AirPods", paired: true, connectedProfiles: ["a2dp"] };
        w.push(BT + "/device/getStatus", { returnValue: true, devices: [pods] });
        await flush();
        expect(w.transports).toHaveLength(1);
        w.transports[0].close();
        e.tick();
        expect(w.transports).toHaveLength(1);
        w.advance(31000);
        e.tick();
        await flush();
        expect(w.transports).toHaveLength(2);
        expect(last().nearby).toHaveLength(0);
    });
});

describe("Tracker alerts (org.webosphoenix.trackers)", () => {
    const LOC = "luna://com.webos.service.location/getLocationUpdates";
    const key = Array.from({ length: 22 }, (_, i) => i + 7);
    const AIRTAG = [0x02, 0x01, 0x06, 0x1e, 0xff, 0x4c, 0x00, 0x12, 0x19, 0x14].concat(key, [0x01, 0x00]);

    function setup() {
        const w = world();
        const t = trackersLib.createTrackers({ call: w.bus.call, subscribe: w.bus.subscribe, scanner: w.scanner, store: w.store,
                                               notify: w.notify, now: w.now, timers: w.timers });
        const replies: Any[] = [];
        t.service.getStatus({ subscribe: true }, "", (r: Any) => replies.push(r));
        adapter(w, true);
        w.scanner.setBluetooth(true);
        return { w, t, last: () => replies[replies.length - 1] };
    }
    // The tracker heard, then the location service's fix.
    async function sighting(w: Any, lat: number) {
        w.push(BT + "/le/startScan", { returnValue: true, device: { address: "f5:00:11:22:33:44", rssi: -70, scanRecord: AIRTAG } });
        w.push(LOC, { returnValue: true, errorCode: 0, latitude: lat, longitude: -121.89 });
        await flush();
    }

    it("alerts when an unknown AirTag has travelled with you, and opens its page", async () => {
        const { w, last } = setup();
        await sighting(w, 37.330);
        w.advance(15 * 60000);
        await sighting(w, 37.333);
        w.advance(16 * 60000);
        expect(w.notes).toHaveLength(0);
        await sighting(w, 37.336);
        expect(w.notes).toEqual([expect.objectContaining({
            appId: "org.webosphoenix.settings", title: "Unknown AirTag found moving with you",
            params: { page: "bluetooth", view: "tracker", id: "f5:00:11:22:33:44" } })]);
        expect(last().trackers[0]).toMatchObject({ id: "f5:00:11:22:33:44", type: "airtag", name: "AirTag", sightings: 3, canPlaySound: true });
        expect(last().location).toBe(true);
        // Kept for the next start.
        expect(w.saved().trackers.state["f5:00:11:22:33:44"].sightings).toBe(3);
    });

    it("plays its sound through DULT's non-owner service", async () => {
        const { w, t, last } = setup();
        await sighting(w, 37.33);
        const out: Any[] = [];
        t.service.playSound({ id: "f5:00:11:22:33:44" }, "", (x: Any) => out.push(x));
        await flush();
        expect(last().sound).toMatchObject({ state: "connecting" });
        w.push(BT + "/gatt/connect", { returnValue: true, subscribed: true, clientId: "7" });
        await flush();
        expect(w.calls.some((c) => c.uri === BT + "/gatt/discoverServices")).toBe(true);
        const write = w.calls.find((c) => c.uri === BT + "/gatt/writeCharacteristicValue");
        expect(write!.params).toEqual({ clientId: "7", service: dult.SERVICE, characteristic: dult.CHARACTERISTIC, value: { bytes: [0x00, 0x03] } });
        w.push(BT + "/gatt/monitorCharacteristic", { returnValue: true, changed: { value: { bytes: [0x02, 0x03, 0x00, 0x03, 0x00, 0x00] } } });
        await flush();
        expect(last().sound.state).toBe("playing");
        w.push(BT + "/gatt/monitorCharacteristic", { returnValue: true, changed: { value: { bytes: [0x03, 0x03] } } });
        await flush();
        expect(last().sound.state).toBe("done");
        expect(w.calls.some((c) => c.uri === BT + "/gatt/disconnect" && c.params.clientId === "7")).toBe(true);
    });

    it("says why the sound could not play: near its owner, or no answer", async () => {
        const { w, t, last } = setup();
        await sighting(w, 37.33);
        t.service.playSound({ id: "f5:00:11:22:33:44" }, "", () => {});
        w.push(BT + "/gatt/connect", { returnValue: true, clientId: "8" });
        await flush();
        w.push(BT + "/gatt/monitorCharacteristic", { returnValue: true, changed: { value: { bytes: [0x02, 0x03, 0x00, 0x03, 0x01, 0x00] } } });
        await flush();
        expect(last().sound).toMatchObject({ state: "failed", error: "The tracker is with its owner or already ringing" });
        t.service.playSound({ id: "f5:00:11:22:33:44" }, "", () => {});
        w.advance(21000);
        await flush();
        expect(last().sound.error).toMatch(/did not answer/);
    });

    it("ignores trackers when turned off, and lets the user ignore one", async () => {
        const { w, t, last } = setup();
        t.service.setEnabled({ enabled: false }, "", () => {});
        await sighting(w, 37.33);
        expect(last().trackers).toHaveLength(0);
        expect(last().enabled).toBe(false);
        t.service.setEnabled({ enabled: true }, "", () => {});
        await sighting(w, 37.33);
        t.service.ignore({ id: "f5:00:11:22:33:44" }, "", () => {});
        await flush();
        expect(last().trackers[0].ignored).toBe(true);
        t.service.clear({}, "", () => {});
        await flush();
        expect(last().trackers).toHaveLength(0);
    });

    it("scans in short windows with the screen off, only when alerts are on", () => {
        const w = world();
        w.scanner.setBluetooth(true);
        w.scanner.setScreen(false);
        expect(w.scanner.running()).toBe(false);
        w.scanner.setBackground(true);
        w.advance(3 * 60000);
        expect(w.scanner.running()).toBe(true);
        w.advance(11000);
        expect(w.scanner.running()).toBe(false);
        w.scanner.setScreen(true);
        expect(w.scanner.running()).toBe(true);
        w.scanner.setBluetooth(false);
        expect(w.scanner.running()).toBe(false);
    });
});
