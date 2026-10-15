// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bluetooth LE advertisements that say "an Apple audio accessory is here"
// or "a location tracker is here", read from the bytes a scan delivers.
// Written from the protocol facts in the sources docs/ACCESSORIES.md lists
// (each cited below by its short name there); no code or text of any other
// project is used.
//
//   [SIG]       Bluetooth SIG Assigned Numbers: company identifier 0x004C
//               is Apple, Inc. (company_identifiers.yaml); 16-bit UUIDs
//               0xFCB2 and 0xFD44 Apple Inc., 0xFEAA Google LLC, 0xFD5A
//               Samsung Electronics, 0xFEEC and 0xFEED Tile, Inc.
//               (member_uuids.yaml). AD types 0x16 (service data, 16-bit
//               UUID), 0xFF (manufacturer specific), 0x02/0x03 (16-bit
//               service UUIDs) from the Core Specification Supplement.
//   [Martin19]  Martin et al., "Handoff All Your Privacy", PoPETs 2019(4):
//               Apple's manufacturer data is a run of Continuity messages,
//               each a type byte, a length byte and that many bytes.
//   [Celosia20] Celosia & Cunche, "Discontinued Privacy", PoPETs 2020(1),
//               Fig. 5 and Tables 5-7: the Proximity Pairing message (type
//               0x07) of AirPods and Beats: 0x01, the device model (two
//               bytes), the UTP byte (where the earbuds are), battery
//               indication 1 (two 4-bit levels), battery indication 2 (case
//               charging b6, right charging b5, left charging b4; the case's
//               level in b3-b0), the lid open count, the colour, 0x00, and a
//               16-byte encrypted payload. Levels are tenths (0-10); the
//               case's only shows while its lid is open; the lid open count
//               goes up by one each time the lid opens. Model codes 0x0220
//               AirPods, 0x0320 Powerbeats3, 0x0520 BeatsX, 0x0620 Beats Solo3.
//   [furiousMAC] the furiousMAC/continuity message notes (proximity
//               pairing): the right earbud's level in the four high bits of
//               battery indication 1, the left's in the four low bits;
//               levels above 10 seen (no reading); model 0x0e20 AirPods Pro.
//   [AirGuard]  Heinrich, Bittner & Hollick, "AirGuard - Protecting Android
//               Users From Stalking Attacks By Apple Find My Devices", WiSec
//               2022 (arXiv:2202.11813), Table 1 and §2.2, §3.5: the Find My
//               message (type 0x12, 25 bytes long while separated from its
//               owner: a status byte, 22 bytes of the public key, the key's
//               top bits, a hint byte); bits 2-3 of the status byte: 0b00 an
//               Apple device, 0b01 AirTag, 0b10 another maker's Find My
//               accessory, 0b11 AirPods; near its owner ("nearby" state) the
//               message is short and leaves the key out.
//   [DULT]      draft-ietf-dult-accessory-protocol-00 §3.4-3.9 (and
//               draft-ledvina-apple-google-unwanted-trackers-03 Table 31):
//               service data 0xFCB2: the network ID (0x01 Apple, 0x02
//               Google, 0x03 Samsung, 0x04 Amazon), then the near-owner bit
//               (the least significant bit of the next byte; 0: separated),
//               then the maker's own bytes.
//   [FMDN]      Google's Find Hub Network accessory specification
//               (developers.google.com/nearby/fast-pair/specifications/
//               extensions/fmdn, CC BY 4.0): service data 0xFEAA, frame
//               type 0x40, or 0x41 in "unwanted tracking protection mode"
//               (the DULT separated state), a 20- or 32-byte ephemeral
//               identifier, then the hashed flags.
//
// What a scan gives (OSE's com.webos.service.bluetooth2 le/startScan:
// BluetoothManagerAdapter::appendLeDevicesByScanId): {address, rssi, name,
// scanRecord: [bytes] (the advertising data as sent), manufacturerData:
// {companyId: [lo, hi], data: [bytes]}}. parseScan() takes either.

"use strict";

var APPLE = 0x004c;

// AD structures: [length][type][length - 1 bytes]... A zero length ends
// the data (Core Specification Vol 3, Part C, §11).
function adStructures(bytes) {
    var out = [];
    var b = toBytes(bytes);
    for (var i = 0; i < b.length;) {
        var len = b[i];
        if (!len || i + 1 + len > b.length) break;
        out.push({ type: b[i + 1], data: b.slice(i + 2, i + 1 + len) });
        i += 1 + len;
    }
    return out;
}

function toBytes(x) {
    if (!x) return [];
    if (typeof x === "string") {
        var hex = x.replace(/[^0-9a-f]/gi, "");
        var r = [];
        for (var i = 0; i + 1 < hex.length; i += 2) r.push(parseInt(hex.substr(i, 2), 16));
        return r;
    }
    return Array.prototype.slice.call(x).map(function (v) { return Number(v) & 0xff; });
}

// The manufacturer data and service data of one advertisement:
// {manufacturer: {companyId: data[]}, services: {uuid16: data[]}, uuids: [uuid16]}.
function parseScan(scan) {
    var out = { manufacturer: {}, services: {}, uuids: [] };
    var ads = adStructures(scan && scan.scanRecord);
    ads.forEach(function (ad) {
        if (ad.type === 0xff && ad.data.length >= 2)
            out.manufacturer[ad.data[0] | (ad.data[1] << 8)] = ad.data.slice(2);
        else if (ad.type === 0x16 && ad.data.length >= 2)
            out.services[ad.data[0] | (ad.data[1] << 8)] = ad.data.slice(2);
        else if (ad.type === 0x02 || ad.type === 0x03)
            for (var i = 0; i + 1 < ad.data.length; i += 2) out.uuids.push(ad.data[i] | (ad.data[i + 1] << 8));
    });
    // bluetooth2's own split (appendManufacturerData), when there is no record.
    var md = scan && scan.manufacturerData;
    if (md && Array.isArray(md.companyId) && md.companyId.length === 2 && Array.isArray(md.data)) {
        var id = (md.companyId[0] & 0xff) | ((md.companyId[1] & 0xff) << 8);
        if (!out.manufacturer[id]) out.manufacturer[id] = toBytes(md.data);
    }
    return out;
}

// Apple's Continuity messages: [{type, data}] [Martin19].
function continuityMessages(appleData) {
    var b = toBytes(appleData), out = [];
    for (var i = 0; i + 1 < b.length;) {
        var len = b[i + 1];
        if (i + 2 + len > b.length) break;
        out.push({ type: b[i], data: b.slice(i + 2, i + 2 + len) });
        i += 2 + len;
    }
    return out;
}

// ---- Proximity Pairing (0x07): AirPods and Beats ----------------------------------------

// Model codes [Celosia20 Table 5; furiousMAC]. Other codes are Apple audio
// accessories all the same; the AAP session names them exactly once
// connected (aap.js versionInfo, the model number Apple's "Identify your
// AirPods" lists: models.js).
var MODELS = {
    0x0220: { name: "AirPods", kind: "airpods" },
    0x0e20: { name: "AirPods Pro", kind: "airpodspro" },
    0x0320: { name: "Powerbeats3", kind: "beats" },
    0x0520: { name: "BeatsX", kind: "beats" },
    0x0620: { name: "Beats Solo3", kind: "beats" }
};

// The colour byte [Celosia20 Table 7].
var COLORS = ["white", "black", "red", "blue", "pink", "gray", "silver", "gold", "rose gold", "space gray",
              "dark blue", "light blue", "yellow"];

// A tenth-level nibble as a percentage, or -1: no reading (above 10)
// [Celosia20; furiousMAC].
function level(n) { return n <= 10 ? n * 10 : -1; }

// One Proximity Pairing message, or null.
function proximityPairing(data) {
    var b = toBytes(data);
    if (b.length < 9 || b[0] !== 0x01) return null;
    var model = (b[1] << 8) | b[2];
    var known = MODELS[model] || null;
    var ind1 = b[4], ind2 = b[5];
    return {
        model: model,
        modelName: known ? known.name : "",
        family: known ? known.kind : "",
        utp: b[3],
        battery: { right: level(ind1 >> 4), left: level(ind1 & 0x0f), case: level(ind2 & 0x0f) },
        charging: { case: !!(ind2 & 0x40), right: !!(ind2 & 0x20), left: !!(ind2 & 0x10) },
        lidOpenCount: b[6],
        color: COLORS[b[7]] || "",
        // The case's level shows only while its lid is open [Celosia20 §4.2].
        lidOpen: (ind2 & 0x0f) <= 10,
        encrypted: b.length >= 25 ? b.slice(9, 25) : []
    };
}

// ---- Find My (0x12) ---------------------------------------------------------------------

var FINDMY_TYPES = ["apple", "airtag", "findmy", "airpods"];

// One Find My message: {separated, deviceType, status, key} [AirGuard].
function findMy(data) {
    var b = toBytes(data);
    if (b.length < 1) return null;
    var status = b[0];
    return {
        status: status,
        deviceType: FINDMY_TYPES[(status >> 2) & 0x03],
        // Separated: the whole message (25 bytes), the key's other 22 bytes in it.
        separated: b.length >= 25,
        key: b.length >= 25 ? b.slice(1, 23) : []
    };
}

// ---- Trackers in other formats ------------------------------------------------------------

var NETWORKS = { 1: "apple", 2: "google", 3: "samsung", 4: "amazon" };

// DULT's location-enabled payload (service data 0xFCB2) [DULT].
function dult(data) {
    var b = toBytes(data);
    if (b.length < 2) return null;
    return { network: NETWORKS[b[0]] || "other", networkId: b[0], nearOwner: !!(b[1] & 0x01), payload: b.slice(2) };
}

// Google's Find Hub frame (service data 0xFEAA, frame 0x40 / 0x41) [FMDN].
// Eddystone's own frames (0x00 UID, 0x10 URL, 0x20 TLM, 0x30 EID) are not trackers.
function fmdn(data) {
    var b = toBytes(data);
    if (b.length < 21 || (b[0] !== 0x40 && b[0] !== 0x41)) return null;
    return { separated: b[0] === 0x41, eid: b.slice(1, b.length >= 33 ? 33 : 21) };
}

// What one scan result is: {kind: "earbuds", ...} for AirPods and Beats,
// {kind: "tracker", type, network, separated, ...} for a tracker, or null.
function classify(scan) {
    var p = parseScan(scan);
    var apple = p.manufacturer[APPLE];
    if (apple) {
        var msgs = continuityMessages(apple);
        for (var i = 0; i < msgs.length; ++i) {
            if (msgs[i].type === 0x07) {
                var pp = proximityPairing(msgs[i].data);
                if (pp) return Object.assign(pp, { kind: "earbuds" });
            }
            if (msgs[i].type === 0x12) {
                var fm = findMy(msgs[i].data);
                if (fm) return { kind: "tracker", type: fm.deviceType === "airtag" ? "airtag" : fm.deviceType === "airpods" ? "airpods" : "findmy",
                                 network: "apple", separated: fm.separated, deviceType: fm.deviceType, ident: fm.key.length ? hex(fm.key) : "" };
            }
        }
    }
    if (p.services[0xfcb2]) {
        var d = dult(p.services[0xfcb2]);
        if (d) return { kind: "tracker", type: "dult", network: d.network, separated: !d.nearOwner, ident: "" };
    }
    if (p.services[0xfeaa]) {
        var f = fmdn(p.services[0xfeaa]);
        if (f) return { kind: "tracker", type: "findhub", network: "google", separated: f.separated, ident: "" };
    }
    // Tile and Samsung's own formats say nothing of their owner: only the
    // pattern of sightings can tell (trackerdetect.js).
    if (p.services[0xfeed] || p.services[0xfeec] || p.uuids.indexOf(0xfeed) >= 0 || p.uuids.indexOf(0xfeec) >= 0)
        return { kind: "tracker", type: "tile", network: "tile", separated: null, ident: "" };
    if (p.services[0xfd5a])
        return { kind: "tracker", type: "smarttag", network: "samsung", separated: null, ident: "" };
    return null;
}

function hex(b) {
    return b.map(function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
}

module.exports = {
    APPLE: APPLE, MODELS: MODELS, NETWORKS: NETWORKS,
    toBytes: toBytes, hex: hex, adStructures: adStructures, parseScan: parseScan,
    continuityMessages: continuityMessages, proximityPairing: proximityPairing,
    findMy: findMy, dult: dult, fmdn: fmdn, classify: classify
};
