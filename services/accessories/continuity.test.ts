// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The advertisement parsers (lib/continuity.js) and the tracker detector
// (lib/trackerdetect.js), on byte vectors built from the documented
// formats (docs/ACCESSORIES.md, "Sources"): each vector names the source
// its layout comes from.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const c = require("./lib/continuity.js") as Any;
const det = require("./lib/trackerdetect.js") as Any;

const hex = (s: string) => s.replace(/\s+/g, "").match(/../g)!.map((x) => parseInt(x, 16));
// An advertising record: flags (LE General Discoverable, BR/EDR not
// supported), then the structures given.
const record = (...ads: number[][]) => [0x02, 0x01, 0x06].concat(...ads.map((a) => [a.length].concat(a)));
const appleAd = (msg: number[]) => [0xff, 0x4c, 0x00].concat(msg);

// Proximity Pairing [Celosia20 Fig. 5; furiousMAC]: 0x07, length 25, 0x01,
// model 0e 20 (AirPods Pro), UTP 0x55, right 9 and left 9 tenths, case:
// right and left charging (b5, b4), case 7 tenths; lid open count 57,
// colour white, 0x00, 16 bytes encrypted.
const ENCRYPTED = "9672711ae6a965737c80d805039773d1";
const PROXIMITY = hex("07 19 01 0e 20 55 99 37 39 00 00" + ENCRYPTED);

describe("Apple's Continuity messages", () => {
    it("reads AirPods Pro's Proximity Pairing message", () => {
        const r = c.classify({ address: "4a:11:22:33:44:55", rssi: -50, scanRecord: record(appleAd(PROXIMITY)) });
        expect(r).toMatchObject({
            kind: "earbuds", model: 0x0e20, modelName: "AirPods Pro", family: "airpodspro",
            battery: { right: 90, left: 90, case: 70 }, charging: { case: false, right: true, left: true },
            lidOpenCount: 57, color: "white", lidOpen: true, utp: 0x55,
        });
        expect(c.hex(r.encrypted)).toBe(ENCRYPTED);
    });

    it("has no case level while the lid is closed, and names the models Celosia lists", () => {
        // Case nibble 0xF: no reading [furiousMAC: values above 10 seen].
        const closed = hex("01 02 20 01 f8 0f 3a 01 00" + ENCRYPTED);
        const r = c.proximityPairing(closed);
        expect(r).toMatchObject({ model: 0x0220, modelName: "AirPods", battery: { right: -1, left: 80, case: -1 },
                                  lidOpen: false, color: "black" });
        expect(c.proximityPairing(hex("01 06 20 01 77 47 01 02 00")).modelName).toBe("Beats Solo3");
        // A code not in the sources: still earbuds, unnamed until AAP names them.
        expect(c.proximityPairing(hex("01 24 20 01 77 47 01 00 00"))).toMatchObject({ model: 0x2420, modelName: "", family: "" });
    });

    it("takes bluetooth2's own split of the manufacturer data", () => {
        // appendManufacturerData: companyId [lo, hi], data after it.
        const r = c.classify({ address: "x", manufacturerData: { companyId: [0x4c, 0x00], data: PROXIMITY } });
        expect(r.kind).toBe("earbuds");
        expect(c.classify({ address: "x", manufacturerData: { companyId: [0x06, 0x00], data: PROXIMITY } })).toBeNull();
    });

    it("walks every Continuity message in the manufacturer data", () => {
        // A Nearby Info message (0x10, 5 bytes) before the Proximity Pairing one.
        const r = c.classify({ scanRecord: record(appleAd(hex("10 05 01 18 1c 2d 8f").concat(PROXIMITY))) });
        expect(r.modelName).toBe("AirPods Pro");
    });

    it("stops at a truncated structure", () => {
        expect(c.adStructures([0x05, 0xff, 0x4c])).toEqual([]);
        expect(c.continuityMessages([0x07, 0x19, 0x01])).toEqual([]);
    });
});

describe("Trackers", () => {
    // Find My [AirGuard Table 1]: 0x12, 25 bytes: status, 22 key bytes, key bits, hint.
    const key = Array.from({ length: 22 }, (_, i) => i + 1);
    const findMy = (status: number) => appleAd([0x12, 0x19, status].concat(key, [0x02, 0x00]));

    it("knows an AirTag away from its owner by its Find My message", () => {
        // Status bits 2-3: 0b01 AirTag [AirGuard Table 3].
        const r = c.classify({ address: "f4:01:02:03:04:05", scanRecord: record(findMy(0x14)) });
        expect(r).toMatchObject({ kind: "tracker", type: "airtag", network: "apple", separated: true, deviceType: "airtag" });
        expect(r.ident).toBe(c.hex(key));
        expect(c.classify({ scanRecord: record(findMy(0x18)) })).toMatchObject({ type: "findmy", deviceType: "findmy" });
        expect(c.classify({ scanRecord: record(findMy(0x1c)) })).toMatchObject({ type: "airpods" });
        expect(c.classify({ scanRecord: record(findMy(0x10)) })).toMatchObject({ type: "findmy", deviceType: "apple" });
    });

    it("leaves a Find My accessory near its owner out (the short message)", () => {
        expect(c.classify({ scanRecord: record(appleAd([0x12, 0x02, 0x14, 0x01])) })).toMatchObject({ separated: false });
    });

    it("reads DULT's location-enabled payload and its near-owner bit", () => {
        // Service data 0xFCB2: network ID, near-owner bit, the maker's bytes [DULT Table 1].
        const sep = record([0x16, 0xb2, 0xfc, 0x03, 0x00, 0xaa, 0xbb]);
        expect(c.classify({ scanRecord: sep })).toMatchObject({ kind: "tracker", type: "dult", network: "samsung", separated: true });
        expect(c.classify({ scanRecord: record([0x16, 0xb2, 0xfc, 0x02, 0x01]) })).toMatchObject({ network: "google", separated: false });
        expect(c.dult([0x09, 0x00])).toMatchObject({ network: "other", networkId: 9 });
    });

    it("reads Google's Find Hub frame: 0x41 is the protection mode", () => {
        const eid = Array.from({ length: 20 }, () => 0x5a);
        expect(c.classify({ scanRecord: record([0x16, 0xaa, 0xfe, 0x41].concat(eid, [0x80])) }))
            .toMatchObject({ type: "findhub", network: "google", separated: true });
        expect(c.classify({ scanRecord: record([0x16, 0xaa, 0xfe, 0x40].concat(eid)) })).toMatchObject({ separated: false });
        // An Eddystone URL frame is no tracker.
        expect(c.classify({ scanRecord: record([0x16, 0xaa, 0xfe, 0x10, 0x00, 0x03, 0x77]) })).toBeNull();
    });

    it("knows Tile and Samsung's own trackers by their UUIDs [SIG], which say nothing of the owner", () => {
        expect(c.classify({ scanRecord: record([0x03, 0xed, 0xfe]) })).toMatchObject({ type: "tile", separated: null });
        expect(c.classify({ scanRecord: record([0x16, 0x5a, 0xfd, 0x01, 0x02]) })).toMatchObject({ type: "smarttag", network: "samsung" });
    });
});

describe("The tracker detector", () => {
    const MIN = 60000;
    // Walking north from San Jose's centre, about 111 m per 0.001 degree.
    const at = (lat: number) => ({ lat: 37.3337 + lat, lon: -121.8907 });

    function run(steps: { min: number; dLat: number | null }[], opts: Any = {}) {
        let t = 1_000_000;
        const d = det.createDetector({ now: () => t, ...opts });
        const alerts: Any[] = [];
        for (const s of steps) {
            t = 1_000_000 + s.min * MIN;
            alerts.push(...d.sighting({ id: "aa", type: "airtag", network: "apple", separated: true, at: t,
                                        location: s.dLat === null ? null : at(s.dLat) }));
        }
        return { d, alerts };
    }

    it("alerts once a tracker has kept with you 30 minutes, 3 sightings and 400 m [AirGuard §4.1.2]", () => {
        const { alerts } = run([{ min: 0, dLat: 0 }, { min: 15, dLat: 0.002 }, { min: 29, dLat: 0.004 }, { min: 31, dLat: 0.005 }]);
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toMatchObject({ id: "aa", name: "AirTag", sightings: 4 });
        expect(alerts[0].distance).toBeGreaterThan(400);
        expect(alerts[0].duration).toBe(31 * MIN);
    });

    it("does not alert for a tracker that stays where it is (a neighbour's), or too briefly", () => {
        expect(run([{ min: 0, dLat: 0 }, { min: 20, dLat: 0.0001 }, { min: 40, dLat: 0 }, { min: 60, dLat: 0.0002 }]).alerts).toHaveLength(0);
        expect(run([{ min: 0, dLat: 0 }, { min: 10, dLat: 0.005 }, { min: 20, dLat: 0.01 }]).alerts).toHaveLength(0);
    });

    it("needs a location: time alone does not alert", () => {
        const { d, alerts } = run([{ min: 0, dLat: null }, { min: 20, dLat: null }, { min: 40, dLat: null }, { min: 60, dLat: null }]);
        expect(alerts).toHaveLength(0);
        expect(d.list()[0]).toMatchObject({ sightings: 4, distance: 0 });
    });

    it("counts one sighting per scan, alerts again only after 7 hours, and not when ignored", () => {
        let t = 0;
        const d = det.createDetector({ now: () => t });
        const see = (min: number, dLat: number) => { t = min * MIN; return d.sighting({ id: "x", type: "dult", separated: true, at: t, location: at(dLat) }); };
        see(0, 0); see(0.5, 0); see(1, 0);
        expect(d.get("x").sightings).toBe(1);
        see(20, 0.003);
        expect(see(35, 0.006)).toHaveLength(1);
        expect(see(60, 0.009)).toHaveLength(0);
        expect(see(7 * 60 + 40, 0.02)).toHaveLength(1);
        d.ignore("x");
        expect(see(15 * 60 + 40, 0.03)).toHaveLength(0);
    });

    it("leaves a tracker near its owner alone and forgets old ones after a week", () => {
        let t = 0;
        const d = det.createDetector({ now: () => t });
        expect(d.sighting({ id: "n", type: "dult", separated: false, at: 0, location: at(0) })).toEqual([]);
        expect(d.list()).toEqual([]);
        d.sighting({ id: "o", type: "tile", separated: null, at: 0, location: at(0) });
        expect(d.list()).toHaveLength(1);
        const saved = d.state();
        t = 8 * 24 * 60 * MIN;
        d.load(saved);
        expect(d.list()).toEqual([]);
    });

    it("measures distances as a sphere's", () => {
        expect(Math.round(det.distance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }))).toBe(111195);
    });
});
