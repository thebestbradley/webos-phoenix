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
import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const earbudsLib = require("./earbuds.js") as Any;
const trackersLib = require("./trackers.js") as Any;
const scannerLib = require("./scanner.js") as Any;
const aap = require("./lib/aap.js") as Any;
const dult = require("./lib/dult.js") as Any;
const keysLib = require("./lib/keys.js") as Any;

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
        setInterval: (fn: () => void, ms: number) => {
            const id = nextId++;
            const tick = () => { pending.push({ at: t + ms, fn: () => { tick(); fn(); }, id }); };
            tick();
            return id;
        },
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
        // Time moves to each timer as it fires, then to the end.
        advance(ms: number) {
            const end = t + ms;
            for (;;) {
                pending.sort((a, b) => a.at - b.at);
                if (!pending.length || pending[0].at > end) break;
                const e = pending.shift()!;
                t = Math.max(t, e.at);
                e.fn();
            }
            t = end;
        },
        saved: () => saved,
        notify: (n: Any) => notes.push(n),
    };
}

function adapter(w: Any, on: boolean) {
    w.push(BT + "/adapter/getStatus", { returnValue: true, adapters: [{ powered: on }] });
}
const PROXIMITY = (lid: number, ind2: number, encrypted: number[] = new Array(16).fill(0x11)) =>
    [0x02, 0x01, 0x06, 0x1e, 0xff, 0x4c, 0x00].concat(hex("07 19 01 0e 20 55 99"), [ind2, lid, 0x00, 0x00], encrypted);

// The AirPods' keys (made up), an address of theirs (resolvable with the
// IRK: lib/keys.js) and an encrypted part with the batteries at positions
// this test chooses (keys.test.ts: the learner finds them).
const IRK = "11223344556677889900aabbccddeeff", ENC = "0f0e0d0c0b0a09080706050403020100";
const rpaOf = (irk: string, prand: string) => (prand + keysLib.hex(keysLib.ah(irk, prand))).match(/../g)!.join(":");
const AT = { left: 2, right: 5, case: 9 };
function sealed(b: { left: number; right: number; case: number }, salt: number) {
    const plain = Buffer.alloc(16);
    for (let i = 0; i < 16; ++i) plain[i] = (0x80 + i * 11 + salt * 3) & 0xff;
    plain[AT.left] = b.left; plain[AT.right] = b.right; plain[AT.case] = b.case;
    const c = createCipheriv("aes-128-ecb", Buffer.from(ENC, "hex"), null);
    c.setAutoPadding(false);
    return Array.from(Buffer.concat([c.update(plain), c.final()]));
}
const battery = (l: number, r: number, c: number) =>
    hex("04 00 04 00 04 00 03 04 01").concat([l, 0x02, 0x01, 0x02, 0x01, r, 0x02, 0x01, 0x08, 0x01, c, 0x02, 0x01]);

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

    // Paired, connected AirPods Pro with their control channel open.
    async function connected() {
        const { w, e, last } = setup();
        adapter(w, true);
        const pods = { address: "a0:b1:c2:d3:e4:f5", name: "AirPods Pro", classOfDevice: 0x240418, paired: true, connectedProfiles: ["a2dp"] };
        w.push(BT + "/device/getStatus", { returnValue: true, devices: [pods] });
        await flush();
        const tr = w.transports[0];
        tr.packet(hex("01 00 04 00 00 00 01 00 02 00"));
        await flush();
        return { w, e, last, tr, pods };
    }

    it("asks the AirPods for their keys, and knows their advertisements from others' by the key", async () => {
        const { w, last, tr, pods } = await connected();
        expect(tr.sent).toContainEqual(aap.requestProximityKeys());
        tr.packet(hex("04 00 04 00 31 00 02 01 00 10 00").concat(hex(IRK), [0x04, 0x00, 0x10, 0x00], hex(ENC)));
        await flush();
        expect(w.saved().earbuds[pods.address].keys).toEqual({ irk: IRK, encKey: ENC });
        expect(last().devices[0]).toMatchObject({ keys: true, recognition: "model", exactBattery: false });
        // Someone else's AirPods Pro: before the key has ever matched, taken
        // for these by model (the fallback).
        w.push(BT + "/le/startScan", { returnValue: true, device: { address: "4a:00:00:12:34:56", scanRecord: PROXIMITY(57, 0x37) } });
        await flush();
        expect(last().nearby[0]).toMatchObject({ paired: pods.address, match: "model" });
        // Theirs: the key matches; from now on the other pair is not them.
        const mine = rpaOf(IRK, "5a1b2c");
        w.push(BT + "/le/startScan", { returnValue: true, device: { address: mine, scanRecord: PROXIMITY(58, 0x37) } });
        await flush();
        const byId = (id: string) => last().nearby.find((n: Any) => n.id === id);
        expect(byId(mine)).toMatchObject({ paired: pods.address, match: "key" });
        expect(byId("4a:00:00:12:34:56")).toMatchObject({ paired: "", match: "" });
        expect(last().devices[0].recognition).toBe("key");
    });

    it("learns where the batteries are in their advertisement, then shows them to 1 %", async () => {
        const { w, last, tr, pods } = await connected();
        tr.packet(hex("04 00 04 00 31 00 02 01 00 10 00").concat(hex(IRK), [0x04, 0x00, 0x10, 0x00], hex(ENC)));
        const mine = rpaOf(IRK, "5a1b2c");
        const both = async (l: number, r: number, c: number, salt: number) => {
            tr.packet(battery(l, r, c));
            w.push(BT + "/le/startScan", { returnValue: true, device: { address: mine, scanRecord: PROXIMITY(57, 0x37, sealed({ left: l, right: r, case: c }, salt)) } });
            await flush();
        };
        await both(81, 77, 40, 0);
        await both(81, 77, 40, 1);
        expect(last().nearby[0].exact).toBe(false);
        expect(last().nearby[0].battery).toEqual({ right: 90, left: 90, case: 70 });   // the tenths
        await both(80, 77, 40, 2);
        expect(w.saved().earbuds[pods.address].learn.layout).toEqual({ order: "as sent", left: 2, right: 5, case: 9 });
        expect(last().devices[0].exactBattery).toBe(true);
        // Disconnected, the case opened later: the batteries to 1 %.
        w.push(BT + "/le/startScan", { returnValue: true, device: { address: mine, scanRecord: PROXIMITY(59, 0x37, sealed({ left: 64, right: 59, case: 33 }, 7)) } });
        await flush();
        expect(last().nearby[0]).toMatchObject({ exact: true, battery: { left: 64, right: 59, case: 33 } });
    });

    it("renames the AirPods themselves, and says when they keep their own name", async () => {
        const { w, e, last, tr, pods } = await connected();
        e.service.rename({ address: pods.address, name: "Gym buds" }, "", () => {});
        await flush();
        expect(tr.sent[tr.sent.length - 1]).toEqual(aap.rename("Gym buds"));
        expect(last().devices[0]).toMatchObject({ name: "Gym buds", renamed: "pending" });
        // They report the new name (their Bluetooth name, through bluetooth2).
        w.push(BT + "/device/getStatus", { returnValue: true, devices: [{ ...pods, name: "Gym buds" }] });
        await flush();
        expect(last().devices[0].renamed).toBe("done");
        // Another name, which they do not take: Phoenix keeps it for itself.
        e.service.rename({ address: pods.address, name: "Run buds" }, "", () => {});
        w.advance(10001);
        await flush();
        expect(last().devices[0]).toMatchObject({ name: "Run buds", renamed: "failed" });
    });

    it("renames AirPods that are not connected when they next connect", async () => {
        const { w, e, last } = setup();
        adapter(w, true);
        const pods = { address: "a0:b1", name: "AirPods", paired: true, connectedProfiles: [] as string[] };
        w.push(BT + "/device/getStatus", { returnValue: true, devices: [pods] });
        await flush();
        e.service.rename({ address: pods.address, name: "Kitchen" }, "", () => {});
        await flush();
        expect(last().devices[0]).toMatchObject({ name: "Kitchen", renamed: "offline" });
        w.push(BT + "/device/getStatus", { returnValue: true, devices: [{ ...pods, connectedProfiles: ["a2dp"] }] });
        await flush();
        const tr = w.transports[0];
        tr.packet(hex("01 00 04 00 00 00 01 00 02 00"));
        await flush();
        expect(tr.sent).toContainEqual(aap.rename("Kitchen"));
        expect(last().devices[0].renamed).toBe("pending");
        // Their version information carries the new name.
        tr.packet(hex("04 00 04 00 1d 00 01 b2 00 08 00").concat(Array.from(Buffer.from("Kitchen\0A2032\0Apple Inc.\0")) as number[]));
        await flush();
        expect(last().devices[0].renamed).toBe("done");
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

    it("alerts sooner or later by the sensitivity chosen [trackerdetect.js SENSITIVITY]", async () => {
        const { w, t, last } = setup();
        expect(last()).toMatchObject({ sensitivity: "medium", thresholds: { minDuration: 30 * 60000, minSightings: 3, minDistance: 400 } });
        const out: Any[] = [];
        t.service.setSensitivity({ sensitivity: "loud" }, "", (x: Any) => out.push(x));
        expect(out[0]).toMatchObject({ returnValue: false });
        // High: 10 minutes, twice, 200 m.
        t.service.setSensitivity({ sensitivity: "high" }, "", (x: Any) => out.push(x));
        await flush();
        expect(last()).toMatchObject({ sensitivity: "high", thresholds: { minDuration: 10 * 60000, minSightings: 2, minDistance: 200, realertAfter: 2 * 3600000 } });
        expect(w.saved().trackers.sensitivity).toBe("high");
        await sighting(w, 37.330);
        w.advance(11 * 60000);
        await sighting(w, 37.332);
        expect(w.notes).toHaveLength(1);
        // The alert's own sound, in the Settings app.
        expect(w.notes[0]).toMatchObject({ soundClass: "alerts", soundFile: "sounds/tracker-alert.mp3" });
    });

    it("does not alert at low sensitivity for a 35-minute walk", async () => {
        const { w, t } = setup();
        t.service.setSensitivity({ sensitivity: "low" }, "", () => {});
        for (let i = 0; i < 4; ++i) { await sighting(w, 37.330 + i * 0.004); w.advance(12 * 60000); }
        expect(w.notes).toHaveLength(0);
    });

    it("keeps the scan's mode, and reports its windows [scanner.js MODES]", async () => {
        const { w, t, last } = setup();
        expect(last()).toMatchObject({ scanMode: "balanced", scanWindows: { screenOn: null, screenOff: { window: 10000, every: 180000 } } });
        const out: Any[] = [];
        t.service.setScanMode({ mode: "turbo" }, "", (x: Any) => out.push(x));
        expect(out[0]).toMatchObject({ returnValue: false });
        t.service.setScanMode({ mode: "saver" }, "", (x: Any) => out.push(x));
        await flush();
        expect(w.scanner.mode()).toBe("saver");
        expect(last()).toMatchObject({ scanMode: "saver", scanWindows: { screenOn: { window: 10000, every: 30000 }, screenOff: { window: 20000, every: 900000 } } });
        expect(w.saved().trackers.scanMode).toBe("saver");
        // The next start takes it from the store.
        const again = trackersLib.createTrackers({ call: w.bus.call, subscribe: w.bus.subscribe, scanner: scannerLib.createScanner({ subscribe: w.bus.subscribe, timers: w.timers, now: w.now }),
                                                   store: w.store, notify: w.notify, now: w.now, timers: w.timers });
        expect(again.status()).toMatchObject({ scanMode: "saver", sensitivity: "medium" });
    });

    it("scans by the mode: battery saver in windows even with the screen on, performance every minute with it off", () => {
        const w = world();
        w.scanner.setMode("saver");
        w.scanner.setBluetooth(true);
        // Screen on: a window at once, 10 s in every 30 s.
        expect(w.scanner.running()).toBe(true);
        w.advance(11000);
        expect(w.scanner.running()).toBe(false);
        w.advance(20000);
        expect(w.scanner.running()).toBe(true);
        // Screen off, alerts on: 20 s every 15 minutes.
        w.scanner.setBackground(true);
        w.scanner.setScreen(false);
        w.advance(11000);
        expect(w.scanner.running()).toBe(false);
        w.advance(14 * 60000);
        expect(w.scanner.running()).toBe(false);
        w.advance(60000);
        expect(w.scanner.running()).toBe(true);
        w.advance(21000);
        expect(w.scanner.running()).toBe(false);
        // Performance: 10 s every minute with the screen off; on, it runs.
        w.scanner.setMode("performance");
        w.advance(60000);
        expect(w.scanner.running()).toBe(true);
        w.advance(11000);
        expect(w.scanner.running()).toBe(false);
        w.scanner.setScreen(true);
        expect(w.scanner.running()).toBe(true);
        w.advance(5 * 60000);
        expect(w.scanner.running()).toBe(true);
        expect(w.scanner.setMode("loud")).toBe(false);
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
