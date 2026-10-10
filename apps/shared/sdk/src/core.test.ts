// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoenixError, request, setTransport, subscribeTo, transport, toPhoenixError } from "./core";
import { available, capabilities, has, setCapabilities } from "./capabilities";
import { resetWarnings } from "./core";
import { installFakeBus } from "./testing";
import { call as lunaCall } from "../../luna/src/bridge";

type G = { PalmServiceBridge?: unknown; PalmSystem?: unknown; __phoenixRuntime?: unknown };
const g = globalThis as G;

afterEach(() => {
    setTransport(null);
    setCapabilities({});
    delete g.PalmServiceBridge;
    delete g.PalmSystem;
    delete g.__phoenixRuntime;
    resetWarnings();
    vi.restoreAllMocks();
});

describe("transport", () => {
    it("is none without PalmServiceBridge: requests fail as unavailable, with one warning per service", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(transport().name).toBe("none");
        const e = await request("luna://com.webos.service.wifi/getstatus").catch((x) => x);
        expect(e).toBeInstanceOf(PhoenixError);
        expect(e.code).toBe("unavailable");
        await request("luna://com.webos.service.wifi/setstate").catch(() => {});
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/com\.webos\.service\.wifi/);
    });

    it("uses PalmServiceBridge when the page has it", async () => {
        const sent: [string, string][] = [];
        g.PalmServiceBridge = class {
            onservicecallback: ((j: string) => void) | null = null;
            call(uri: string, json: string) { sent.push([uri, json]); queueMicrotask(() => this.onservicecallback?.('{"returnValue":true,"x":1}')); }
            cancel() {}
        };
        expect(transport().name).toBe("palm");
        await expect(request("luna://a.b/c", { y: 2 })).resolves.toMatchObject({ x: 1 });
        expect(sent).toEqual([["luna://a.b/c", '{"y":2}']]);
    });

    it("carries @phoenix/luna's own calls over a custom transport", async () => {
        const bus = installFakeBus();
        bus.handle("luna://x.y/z", (p) => ({ echo: p.v }));
        await expect(lunaCall("luna://x.y/z", { v: 7 })).resolves.toMatchObject({ echo: 7 });
        expect(bus.calls).toHaveLength(1);
    });
});

describe("errors", () => {
    it("keeps the service's errorCode and errorText and classifies them", async () => {
        const bus = installFakeBus();
        bus.handle("luna://s/denied", () => { throw { errorCode: -1, errorText: "Denied method call \"x\" for category \"/\"" }; });
        bus.handle("luna://s/missing", () => { throw { errorCode: -1, errorText: "No such file: /a" }; });
        bus.handle("luna://s/bad", () => { throw { errorCode: 42, errorText: "Nope" }; });
        expect(await request("luna://s/denied").catch((e) => e.code)).toBe("permission-denied");
        expect(await request("luna://s/missing").catch((e) => e.code)).toBe("not-found");
        const e = await request("luna://s/bad").catch((x) => x);
        expect(e).toMatchObject({ code: "failed", errorCode: 42, errorText: "Nope", uri: "luna://s/bad" });
        expect(await request("luna://s/unhandled").catch((x) => x.code)).toBe("unavailable");
    });

    it("times out", async () => {
        installFakeBus().handle("luna://s/slow", () => new Promise(() => {}));
        expect(await request("luna://s/slow", {}, { timeoutMs: 5 }).catch((e) => e.code)).toBe("timeout");
    });

    it("turns anything into a PhoenixError", () => {
        expect(toPhoenixError(new Error("boom"), "x").errorText).toBe("boom");
        expect(toPhoenixError({ returnValue: false, errorCode: 3, errorText: "t" }, "u").errorCode).toBe(3);
    });
});

describe("Watch", () => {
    it("gives every reply to the callback and to for-await loops, and cancel ends both", async () => {
        const bus = installFakeBus();
        bus.handle("luna://s/watch", () => ({ n: 0 }));
        const seen: number[] = [];
        const w = subscribeTo<{ n: number }>("luna://s/watch", {}, (r) => seen.push(r.n));
        const loop = (async () => {
            const got: number[] = [];
            for await (const r of w) { got.push(r.n); if (got.length === 3) break; }
            return got;
        })();
        await vi.waitFor(() => expect(seen).toEqual([0]));
        bus.emit("luna://s/watch", { n: 1 });
        bus.emit("luna://s/watch", { n: 2 });
        expect(await loop).toEqual([0, 1, 2]);
        expect(w.latest).toEqual(expect.objectContaining({ n: 2 }));
        expect(bus.calls[0].params).toEqual({ subscribe: true });
        w.cancel();
        expect(bus.calls[0].subscribed).toBe(false);
        bus.emit("luna://s/watch", { n: 3 });
        expect(seen).toEqual([0, 1, 2]);
    });

    it("ends a loop with the error, and keeps the callback subscription open", async () => {
        const bus = installFakeBus();
        bus.handle("luna://s/w", () => { throw { errorCode: 5, errorText: "off" }; });
        const errors: PhoenixError[] = [];
        const w = subscribeTo("luna://s/w", {}, undefined, (e) => errors.push(e));
        const it = w[Symbol.asyncIterator]();
        await expect(it.next()).rejects.toMatchObject({ errorCode: 5 });
        expect(errors).toHaveLength(1);
        expect(w.cancelled).toBe(false);
        w.cancel();
    });

    it("cancels when the last loop leaves and there is no callback", async () => {
        const bus = installFakeBus();
        bus.handle("luna://s/w", () => ({ v: 1 }));
        const w = subscribeTo<{ v: number }>("luna://s/w");
        for await (const r of w) { expect(r.v).toBe(1); break; }
        expect(w.cancelled).toBe(true);
    });
});

describe("has", () => {
    it("knows a plain browser, webOS OSE and Phoenix apart", () => {
        expect(has("bus")).toBe(false);
        expect(has("share")).toBe(false);
        expect(has("webos")).toBe(false);
        g.PalmServiceBridge = class {};
        g.PalmSystem = { setWindowOrientation() {}, addBannerMessage() { return ""; } };
        expect(has("bus")).toBe(true);
        expect(has("location")).toBe(true);
        expect(has("orientation")).toBe(true);
        expect(has("share")).toBe(false);
        g.__phoenixRuntime = {};
        expect(has("share")).toBe(true);
        expect(has("phoenix")).toBe(true);
        expect(capabilities().assistant).toBe(true);
    });

    it("follows claimed capabilities", () => {
        setCapabilities({ phoenix: true, bus: true });
        expect(has("pickers")).toBe(true);
        setCapabilities({ share: false, phoenix: true, bus: true });
        expect(has("share")).toBe(false);
    });

    it("asks the bus whether a service is registered", async () => {
        const bus = installFakeBus();
        bus.handle("luna://com.palm.bus/signal/registerServerStatus", (p) => ({ connected: p.serviceName === "com.webos.service.location" }));
        await expect(available("com.webos.service.location")).resolves.toBe(true);
        await expect(available("com.example.none")).resolves.toBe(false);
        bus.uninstall();
        await expect(available("com.webos.service.location")).resolves.toBe(false);
    });
});
