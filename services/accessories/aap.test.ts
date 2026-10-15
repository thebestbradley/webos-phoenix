// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The AirPods' control channel (lib/aap.js) and DULT's non-owner GATT
// commands (lib/dult.js). The AAP vectors are captures published in
// tyalie/AAP-Protocol-Defintion's examples/ (AirPods Pro and macOS Mojave,
// each with what Apple's PacketLogger read in it, quoted beside it); the
// version information is made up in the same shape (the published capture
// carries a real device's serial numbers).

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const aap = require("./lib/aap.js") as Any;
const dult = require("./lib/dult.js") as Any;

const hex = (s: string) => s.replace(/\s+/g, "").match(/../g)!.map((x) => parseInt(x, 16));
const str = (s: string) => Array.from(Buffer.from(s, "utf8")).concat([0]);

describe("AAP packets", () => {
    it("connects as macOS does", () => {
        // init-connection-s-00: "Connect - ServiceID: 4, Major: 0001, Minor: 0002, Features: 0".
        expect(aap.connectPacket()).toEqual(hex("00 00 04 00 01 00 02 00 00 00 00 00 00 00 00 00"));
        // init-connection-r-00: "Connect Response - ServiceID: 4 status:0".
        expect(aap.parse(hex("01 00 04 00 00 00 01 00 02 00 05 00 49 4e 05 00 a5 4f")))
            .toEqual({ kind: "connectResponse", status: 0, major: 1, minor: 2 });
        // disconnect-r-00: "Disconnect ServiceID: 4 status:0".
        expect(aap.parse(hex("02 00 04 00 00 00"))).toEqual({ kind: "disconnect" });
        // notification-filter-set-00: every notification on.
        expect(aap.notificationFilter()).toEqual(hex("04 00 04 00 0f 00 ff ff ff ff"));
        // get-in-ear-state-00.
        expect(aap.getInEar()).toEqual(hex("04 00 04 00 05 00"));
    });

    it("reads the batteries", () => {
        // battery-state-r-00: "Left - Level:100% State:Charging / Right - Level:100%
        // State:Charging / Case - Level:12% State:Discharging".
        expect(aap.parse(hex("04 00 04 00 04 00 03 04 01 64 01 01 02 01 64 01 01 08 01 0c 02 01"))).toEqual({
            kind: "battery",
            battery: { left: 100, right: 100, case: 12 },
            charging: { left: true, right: true, case: false },
        });
        // A part in another state has no reading.
        expect(aap.parse(hex("04 00 04 00 04 00 01 04 01 32 04 01")).battery).toEqual({ left: -1 });
    });

    it("reads the in-ear state and the role", () => {
        // in-ear-state-r-00: "Primary: In case, Secondary: In case".
        expect(aap.parse(hex("04 00 04 00 06 00 02 02"))).toEqual({ kind: "inEar", primary: "case", secondary: "case" });
        // role-state-r-00: "Primary Bud: Left".
        expect(aap.parse(hex("04 00 04 00 08 00 01 02 01 00"))).toEqual({ kind: "role", primary: "left" });
    });

    it("reads and writes the settings", () => {
        // config/listen-mode-r-00: "Listen Mode - Normal".
        expect(aap.parse(hex("04 00 04 00 09 00 0d 01 00 00 00"))).toMatchObject({ kind: "setting", listeningMode: "off" });
        expect(aap.setListeningMode("off")).toEqual(hex("04 00 04 00 09 00 0d 01 00 00 00"));
        // The gist's Transparency.
        expect(aap.setListeningMode("transparency")).toEqual(hex("04 00 04 00 09 00 0d 03 00 00 00"));
        // librepods-rs README: noise cancellation is 0x0D, 0x02.
        expect(aap.setListeningMode("anc")).toEqual(hex("04 00 04 00 09 00 0d 02 00 00 00"));
        expect(() => aap.setListeningMode("loud")).toThrow();
        // config/in-ear-mode-s-00: "In Ear Mode - On".
        expect(aap.setEarDetection(true)).toEqual(hex("04 00 04 00 09 00 0a 02 00 00 00"));
        expect(aap.parse(hex("04 00 04 00 09 00 0a 02 00 00 00"))).toMatchObject({ earDetection: true });
        // config/button-mode-s-00 ("Button Mode - Siri"): a setting Phoenix leaves alone.
        expect(aap.parse(hex("04 00 04 00 09 00 04 01 00 00 00"))).toEqual({ kind: "setting", id: 4, value: 1 });
    });

    it("reads the version information's strings", () => {
        const v = hex("04 00 04 00 1d 00 01 b2 00 08 00").concat(str("Pat's AirPods Pro"), str("A2084"), str("Apple Inc."),
                                                              str("XXXXXXXXXXXX"), str("6A321"));
        expect(aap.parse(v)).toEqual({ kind: "version", name: "Pat's AirPods Pro", modelNumber: "A2084", manufacturer: "Apple Inc.",
                                        serial: "XXXXXXXXXXXX", firmware: "6A321" });
    });
});

describe("An AAP session", () => {
    function open() {
        const sent: number[][] = [];
        const states: Any[] = [];
        let closed = false;
        const s = aap.session({ send: (b: number[]) => sent.push(b), close: () => { closed = true; } }, (st: Any) => states.push(st));
        return { s, sent, states, closed: () => closed };
    }

    it("connects, asks for notifications, and follows the AirPods", () => {
        const { s, sent, states } = open();
        expect(sent).toEqual([aap.connectPacket()]);
        s.receive(hex("01 00 04 00 00 00 01 00 02 00 05 00 49 4e 05 00 a5 4f"));
        expect(sent.slice(1)).toEqual([aap.notificationFilter(), aap.getInEar()]);
        s.receive(hex("04 00 04 00 04 00 03 04 01 64 01 01 02 01 64 01 01 08 01 0c 02 01"));
        s.receive(hex("04 00 04 00 08 00 01 02 01 00"));
        // In ear: the community's 0x00 (UNVERIFIED), the secondary in the case.
        s.receive(hex("04 00 04 00 06 00 00 02"));
        s.receive(hex("04 00 04 00 09 00 0d 03 00 00 00"));
        const st = states[states.length - 1];
        expect(st).toMatchObject({ connected: true, battery: { left: 100, right: 100, case: 12 }, primary: "left",
                                   inEar: { left: "ear", right: "case" }, listeningMode: "transparency" });
        s.setListeningMode("anc");
        expect(sent[sent.length - 1]).toEqual(aap.setListeningMode("anc"));
        expect(states[states.length - 1].listeningMode).toBe("anc");
    });

    it("gives up on a refused connection", () => {
        const { s, closed, states } = open();
        s.receive(hex("01 00 04 00 01 00 01 00 02 00"));
        expect(closed()).toBe(true);
        expect(states).toEqual([]);
    });
});

describe("DULT's non-owner commands", () => {
    it("plays a sound and reads the answers [draft-ietf-dult-accessory-protocol-00 Table 18-19]", () => {
        expect(dult.command(dult.OP.soundStart)).toEqual([0x00, 0x03]);
        expect(dult.command(dult.OP.soundStop)).toEqual([0x01, 0x03]);
        expect(dult.parse([0x02, 0x03, 0x00, 0x03, 0x00, 0x00])).toEqual({ op: "commandResponse", command: 0x0300, status: "success" });
        expect(dult.parse([0x02, 0x03, 0x00, 0x03, 0x01, 0x00]).status).toBe("invalidState");
        expect(dult.parse([0x02, 0x03, 0x00, 0x03, 0xff, 0xff]).status).toBe("invalidCommand");
        expect(dult.parse([0x03, 0x03])).toEqual({ op: "soundCompleted" });
        expect(dult.parse([0x05, 0x08].concat(Array.from(Buffer.from("Tag 2")), [0, 0, 0]))).toEqual({ op: "modelName", text: "Tag 2" });
        expect(dult.SERVICE).toBe("15190001-12f4-c226-88ed-2ac5579f2a85");
    });
});
