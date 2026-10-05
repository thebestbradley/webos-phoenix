// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Scene transitions and Touch to Share against runtime/phoenix-runtime.js,
// loaded into jsdom the way phoenix-sim injects it into a page.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call } from "./bridge";
import { sceneTransition } from "./scene";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

interface Runtime {
    sceneTransition: { timeoutMs: number };
    sceneTransitionPrepared(): void;
}
const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;
const scenes = () => hostMessages.filter((m) => m.type === "sceneTransition").map((m) => m.payload);

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
    rt().sceneTransition.timeoutMs = 250;
});

describe("scene transitions", () => {
    it("snapshots, changes the scene once the shell has it, then runs", async () => {
        const order: string[] = [];
        const done = sceneTransition(() => order.push("change"), {});
        await Promise.resolve();
        // Mojo's ZoomFadeTransition: prepareSceneTransition(isPop) first.
        expect(scenes()).toEqual([{ op: "prepare", isPop: false }]);
        expect(order).toEqual([]);
        // The shell took its snapshot.
        rt().sceneTransitionPrepared();
        await done;
        expect(order).toEqual(["change"]);
        expect(scenes()).toEqual([
            { op: "prepare", isPop: false },
            { op: "run", transition: "zoom-fade", isPop: false },
        ]);
    });

    it("pops and cross-fades as asked", async () => {
        const done = sceneTransition(() => {}, { pop: true, type: "cross-fade" });
        await Promise.resolve();
        rt().sceneTransitionPrepared();
        await done;
        expect(scenes()[1]).toEqual({ op: "run", transition: "cross-fade", isPop: true });
    });

    it("goes on without a shell's answer", async () => {
        rt().sceneTransition.timeoutMs = 10;
        let changed = false;
        await sceneTransition(() => { changed = true; });
        expect(changed).toBe(true);
        expect(scenes().map((s) => s.op)).toEqual(["prepare", "run"]);
    });

    it("cancels when the scene change fails", async () => {
        rt().sceneTransition.timeoutMs = 10;
        await expect(sceneTransition(() => { throw new Error("no scene"); })).rejects.toThrow("no scene");
        expect(scenes().map((s) => s.op)).toEqual(["prepare", "cancel"]);
    });

    it("PalmSystem: run without prepare and unknown types do nothing", () => {
        const ps = (window as unknown as { PalmSystem: Record<string, (...a: unknown[]) => unknown> }).PalmSystem;
        ps.runSceneTransition("zoom-fade", false);
        expect(scenes()).toEqual([]);
        ps.prepareSceneTransition(false);
        ps.runSceneTransition("flip", false);
        expect(scenes().map((s) => s.op)).toEqual(["prepare", "cancel"]);
    });
});

describe("Touch to Share", () => {
    const shares = () => hostMessages.filter((m) => m.type === "touchToShare").map((m) => m.payload);

    it("passes the systemmanager calls to the shell", async () => {
        await call("luna://com.palm.systemmanager/touchToShareDeviceInRange", { inRange: true });
        await call("luna://com.palm.systemmanager/touchToShareAppUrlTransferred", { appid: "com.palm.app.browser" });
        expect(shares()).toEqual([
            { op: "inRange", inRange: true },
            { op: "transferred", appId: "com.palm.app.browser" },
        ]);
        // SystemService's schemas: inRange boolean, appid string.
        await expect(call("luna://com.palm.systemmanager/touchToShareDeviceInRange", { inRange: "yes" })).rejects.toThrow();
        await expect(call("luna://com.palm.systemmanager/touchToShareAppUrlTransferred", {})).rejects.toThrow();
        expect(shares()).toHaveLength(2);
    });

    it("hands an app's shareData to the shell (the Isis browser's answer)", async () => {
        const data = { target: "https://www.example.com/", type: "rawdata", mimetype: "text/html" };
        await call("palm://com.palm.stservice/shareData", { data });
        expect(shares()).toEqual([{ op: "shareData", data }]);
        await expect(call("palm://com.palm.stservice/shareData", {})).rejects.toThrow();
    });
});
