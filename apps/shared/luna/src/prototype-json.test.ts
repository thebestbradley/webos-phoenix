// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Prototype.js 1.6 (bundled by 2011 apps: Quickoffice's QOWT) adds
// Array.prototype.toJSON, and JSON.stringify then writes arrays as strings
// in Prototype's format. The runtime's stores are shared by every app, so
// what it saved from such a page broke the others (the VPN list:
// ".map is not a function" in every page; Photos' index: a spinner for
// ever). The runtime writes JSON without it, and repairs what was written.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "./bridge";

// What the profile held after Quickoffice ran (shapes from a real one).
const corruptedState = {
    wifi: { enabled: true, connected: "Phoenix", profiles: '[{"profileId": 1, "ssid": "Phoenix", "security": "psk"}]', nextProfileId: 2 },
    bluetooth: { powered: false, name: "Phoenix", paired: "[]" },
    vpn: { connections: '[{"path": "/net/connman/vpn/connection/vpn_example_com", "props": {"Name": "Office", "Type": "wireguard", "Host": "vpn.example.com", "State": "idle"}}]' },
    note: "[not json, a string]",
};

// Prototype 1.6.1's Array#toJSON, as QOWT installs it.
function prototypeToJSON(this: unknown[]): string {
    return "[" + this.map((v) => JSON.stringify(v)).join(", ") + "]";
}

beforeAll(() => {
    localStorage.clear();
    localStorage.setItem("phoenix:settings:state", JSON.stringify(corruptedState));
    localStorage.setItem("phoenix:media:index", JSON.stringify({ image: "[]", audio: "[]", video: "[]", videoSamples: true }));
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

afterAll(() => {
    delete (Array.prototype as unknown as { toJSON?: unknown }).toJSON;
});

describe("arrays saved by a page with Prototype.js", () => {
    it("are arrays again once the runtime loads (strings stay strings)", () => {
        const st = JSON.parse(localStorage.getItem("phoenix:settings:state")!);
        expect(Array.isArray(st.vpn.connections)).toBe(true);
        expect(st.vpn.connections[0].props.Name).toBe("Office");
        expect(st.wifi.profiles).toEqual([{ profileId: 1, ssid: "Phoenix", security: "psk" }]);
        expect(st.bluetooth.paired).toEqual([]);
        expect(st.note).toBe("[not json, a string]");
        expect(localStorage.getItem("phoenix:__arraysRepaired")).toBe("1");
    });

    it("the services work on the repaired data", async () => {
        const vpn = await call("luna://com.webos.service.vpn/getProfileList", {});
        expect((vpn.vpnProfiles as unknown[]).length).toBe(1);
        const images = await call("luna://com.webos.service.mediaindexer/getImageList", { uri: "storage:///media/internal" });
        expect(Array.isArray((images.imageList as { results: unknown[] }).results)).toBe(true);
    });

    it("the runtime's own saves stay arrays while Prototype's toJSON is installed", async () => {
        await call("luna://com.palm.db/put", { objects: [{ _kind: "org.example.proto:1", tags: ["a", "b"] }] });
        Object.defineProperty(Array.prototype, "toJSON", { value: prototypeToJSON, configurable: true, writable: true });
        expect(JSON.stringify({ a: [1, 2] })).toBe('{"a":"[1, 2]"}');      // the page's own JSON is Prototype's
        // (What the app sends is the app's: Quickoffice deletes toJSON around
        // its own calls, as it had to on a device.) A request without arrays
        // makes db8 save its store again.
        await call("luna://com.palm.db/merge", { query: { from: "org.example.proto:1" }, props: { title: "x" } });
        const found = await call("luna://com.palm.db/find", { query: { from: "org.example.proto:1" } });
        expect((found.results as { tags: unknown }[])[0].tags).toEqual(["a", "b"]);
        expect(localStorage.getItem("phoenix:db8:com.palm.db")).toContain('"tags":["a","b"]');
        expect(typeof Array.prototype.toJSON).toBe("function");               // and the page keeps it
    });
});
