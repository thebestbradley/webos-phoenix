// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.systemmanager on a device (systemmanager.js): the device lock as
// luna-sysmgr's Security.cpp and EASPolicyManager.cpp had it (the same
// cases as the simulator's runtime), the passcode kept as scrypt, the
// shell's state for the apps, and the shell's start-up preferences.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const sm = require("./systemmanager.js") as Any;

// A fast stand-in for scrypt (the real one is tested below on its own).
const fakeKdf = {
    hash: (p: string) => "fake$" + Buffer.from(p).toString("hex"),
    verify: (p: string, stored: string) => stored === "fake$" + Buffer.from(p).toString("hex")
};

function world(opts: Any = {}) {
    let saved: Any = opts.state || null;
    let now = 1000000;
    const wipes: number[] = [];
    const startup: Any[] = [];
    const docs: Any[] = opts.policies || [];
    const m = sm.createSystemManager({
        state: { load: () => (saved ? JSON.parse(JSON.stringify(saved)) : null), save: (o: Any) => { saved = JSON.parse(JSON.stringify(o)); } },
        policies: () => Promise.resolve(docs),
        kdf: opts.kdf || fakeKdf,
        now: () => now,
        wipe: () => wipes.push(now),
        startup: { write: (o: Any) => startup.push(o) },
        isShell: (s: string) => s === "com.webos.surfacemanager",
        isKeyboard: (s: string) => s.startsWith("com.webos.service.ime")
    });
    return { m, call: (name: string, p: Any = {}, sender = "com.example.app") => m.methods[name](p, sender) as Promise<Any>,
             saved: () => saved, wipes, startup, docs, advance: (ms: number) => { now += ms; } };
}

describe("the device lock", () => {
    it("starts with none, sets a PIN, checks it, asks for it to change it", async () => {
        const w = world();
        expect(await w.call("getDeviceLockMode")).toEqual({ returnValue: true, lockMode: "none", policyState: "none", retriesLeft: 0 });
        expect((await w.call("matchDevicePasscode", { passCode: "" })).succeeded).toBe(true);
        expect((await w.call("setDevicePasscode", { lockMode: "pin", passCode: "12" })).errorText).toBe("A PIN needs at least 4 digits");
        expect((await w.call("setDevicePasscode", { lockMode: "pin", passCode: "4711" })).returnValue).toBe(true);
        expect(w.saved().lock.hash).not.toContain("4711");
        expect((await w.call("getDeviceLockMode")).lockMode).toBe("pin");
        expect((await w.call("matchDevicePasscode", { passCode: "4711" })).succeeded).toBe(true);
        expect(await w.call("matchDevicePasscode", { passCode: "0000" })).toEqual({ returnValue: true, succeeded: false, lockedOut: false, retriesLeft: 2 });
        // Changing it needs the old one.
        expect((await w.call("setDevicePasscode", { lockMode: "password", passCode: "secret1", oldPasscode: "1111" })).errorText).toBe("Incorrect passcode");
        expect((await w.call("setDevicePasscode", { lockMode: "password", passCode: "secret1", oldPasscode: "4711" })).returnValue).toBe(true);
        expect((await w.call("matchDevicePasscode", { passCode: "secret1" })).succeeded).toBe(true);
    });

    it("holds the next try off for 15 s after three wrong ones (Security.cpp:43-44)", async () => {
        const w = world();
        await w.call("setDevicePasscode", { lockMode: "pin", passCode: "4711" });
        for (const left of [2, 1, 0])
            expect((await w.call("matchDevicePasscode", { passCode: "1" })).retriesLeft).toBe(left);
        expect(await w.call("matchDevicePasscode", { passCode: "4711" })).toEqual({ returnValue: true, succeeded: false, lockedOut: true, retriesLeft: 0 });
        w.advance(15001);
        expect((await w.call("matchDevicePasscode", { passCode: "4711" })).succeeded).toBe(true);
    });

    it("follows a security policy: pending, the passcode it asks for, its tries, then the wipe", async () => {
        const w = world({ policies: [{ _id: "p1", devicePasswordEnabled: true, minDevicePasswordLength: 6, maxDevicePasswordFailedAttempts: 3,
                                       alphanumericDevicePasswordRequired: false, allowSimpleDevicePassword: false, maxInactivityTimeDeviceLock: 300 }] });
        expect(await w.call("getDeviceLockMode")).toEqual({ returnValue: true, lockMode: "none", policyState: "pending", retriesLeft: 0 });
        const pol = (await w.call("getSecurityPolicy")).policy;
        expect(pol.password).toEqual({ enabled: true, minLength: 6, maxRetries: 3, alphaNumeric: false, allowSimplePassword: false });
        expect(pol.inactivityInSeconds).toBe(300);
        expect(pol.status.enforced).toBe(false);
        // Security::validatePasscode's errors.
        expect((await w.call("setDevicePasscode", { lockMode: "pin", passCode: "1234" })).errorCode).toBe(-2);
        expect((await w.call("setDevicePasscode", { lockMode: "pin", passCode: "123456" })).errorCode).toBe(-9);
        expect((await w.call("setDevicePasscode", { lockMode: "pin", passCode: "111111" })).errorCode).toBe(-8);
        expect((await w.call("setDevicePasscode", { lockMode: "pin", passCode: "12ab56" })).errorCode).toBe(-5);
        // While pending, no old passcode is asked for.
        expect((await w.call("setDevicePasscode", { lockMode: "pin", passCode: "271828" })).returnValue).toBe(true);
        expect(await w.call("getDeviceLockMode")).toEqual({ returnValue: true, lockMode: "pin", policyState: "active", retriesLeft: 3 });
        expect((await w.call("matchDevicePasscode", { passCode: "000000" })).retriesLeft).toBe(2);
        expect((await w.call("matchDevicePasscode", { passCode: "271828" })).succeeded).toBe(true);
        expect((await w.call("getDeviceLockMode")).retriesLeft).toBe(3);
        for (const left of [2, 1, 0])
            expect((await w.call("matchDevicePasscode", { passCode: "000000" })).retriesLeft).toBe(left);
        expect(w.wipes.length).toBe(1);
    });

    it("merges policies into the strictest (EASPolicy::merge)", () => {
        const a = sm.aggregatePolicy([
            { _id: "a", devicePasswordEnabled: true, minDevicePasswordLength: 4, maxDevicePasswordFailedAttempts: 10, maxInactivityTimeDeviceLock: 600 },
            { _id: "b", devicePasswordEnabled: true, minDevicePasswordLength: 8, maxDevicePasswordFailedAttempts: 5,
              alphanumericDevicePasswordRequired: true, maxInactivityTimeDeviceLock: 95 },
            { _id: "c", devicePasswordEnabled: false, _del: true }
        ]);
        expect(a).toEqual({ passwordRequired: true, maxRetries: 5, minLength: 8, alphaNumeric: true, allowSimple: true, inactivity: 60, id: "a" });
        expect(sm.aggregatePolicy([])).toBe(null);
    });

    it("tells subscribers when the lock mode changes", async () => {
        const w = world();
        const heard: Any[] = [];
        w.m.watch("getDeviceLockMode", (r: Any) => heard.push(r));
        await w.call("setDevicePasscode", { lockMode: "pin", passCode: "4711" });
        await new Promise((r) => setTimeout(r, 0));
        expect(heard.at(-1).lockMode).toBe("pin");
    });

    it("keeps the passcode as salted scrypt", () => {
        const kdf = sm.scryptKdf(crypto, { N: 1024 });
        const a = kdf.hash("4711"), b = kdf.hash("4711");
        expect(a).toMatch(/^scrypt\$1024\$8\$1\$/);
        expect(a).not.toBe(b);
        expect(a).not.toContain("4711");
        expect(kdf.verify("4711", a)).toBe(true);
        expect(kdf.verify("4712", a)).toBe(false);
        expect(kdf.verify("4711", "djb2:1234")).toBe(false);
    });
});

describe("the shell's state, for the apps", () => {
    it("only the shell reports it; subscribers hear the changes", async () => {
        const w = world();
        expect((await w.call("getLockStatus")).locked).toBe(true);
        expect((await w.call("phoenix/report", { deviceLocked: false })).errorText).toBe("Only the shell reports its state");
        const locks: Any[] = [], systems: Any[] = [];
        w.m.watch("getLockStatus", (r: Any) => locks.push(r));
        w.m.watch("getSystemStatus", (r: Any) => systems.push(r));
        await w.call("phoenix/report", { deviceLocked: false, orientation: { ui: "left", device: "left" }, ime: { visible: true } },
                     "com.webos.surfacemanager");
        await new Promise((r) => setTimeout(r, 0));
        expect(locks).toEqual([{ returnValue: true, locked: false }]);
        expect(systems.at(-1)).toEqual({ returnValue: true, ime: { visible: true }, orientation: { ui: "left", device: "left" }, learnedWords: [] });
        expect((await w.call("getDockModeStatus")).enabled).toBe(false);
        // The same again: no news.
        await w.call("phoenix/report", { deviceLocked: false }, "com.webos.surfacemanager");
        await new Promise((r) => setTimeout(r, 0));
        expect(locks.length).toBe(1);
    });
});

describe("the keyboard's learned words (GAPS V5)", () => {
    it("only the keyboard reports them; Settings hears them in getSystemStatus", async () => {
        const w = world();
        expect((await w.call("phoenix/learnedWords", { words: ["phoenix"] })).errorText).toBe("Only the keyboard reports its words");
        expect((await w.call("phoenix/learnedWords", { words: ["phoenix"] }, "com.webos.surfacemanager")).returnValue).toBe(false);
        const systems: Any[] = [];
        w.m.watch("getSystemStatus", (r: Any) => systems.push(r));
        const kb = "com.webos.service.ime.phoenixKeyboard";
        expect((await w.call("phoenix/learnedWords", { words: "phoenix" }, kb)).errorText).toBe("words must be a list");
        expect((await w.call("phoenix/learnedWords", { words: ["phoenix", 7, "", "webos"] }, kb)).returnValue).toBe(true);
        await new Promise((r) => setTimeout(r, 0));
        expect(systems.at(-1).learnedWords).toEqual(["phoenix", "webos"]);
        expect((await w.call("getSystemStatus")).learnedWords).toEqual(["phoenix", "webos"]);
        // The same again: no news.
        await w.call("phoenix/learnedWords", { words: ["phoenix", "webos"] }, kb);
        await new Promise((r) => setTimeout(r, 0));
        expect(systems.length).toBe(1);
    });
});

describe("the shell's start-up preferences", () => {
    it("writes the file when one of its preferences changes", () => {
        const w = world();
        w.m.preferences({ returnValue: true, subscribed: true, startupAnimation: "classic", rotationLock: "left", locale: "en" });
        expect(w.startup).toEqual([{ prefs: { startupAnimation: "classic", rotationLock: "left" } }]);
        w.m.preferences({ startupAnimation: "classic" });
        expect(w.startup.length).toBe(1);
        w.m.preferences({ animationSpeed: "fast" });
        expect(w.startup.at(-1).prefs).toEqual({ startupAnimation: "classic", rotationLock: "left", animationSpeed: "fast" });
    });

    it("has the shell's keys: the runtime's tweaks and the rotation lock", () => {
        const lsm = fs.readFileSync(path.join(HERE, "../../shell/qml/Phoenix/Lsm/LsmStatus.js"), "utf8");
        const runtime = fs.readFileSync(path.join(HERE, "../../runtime/phoenix-runtime.js"), "utf8");
        const list = (text: string, re: RegExp) => JSON.parse(re.exec(text)![1].replace(/\s+/g, " "));
        const tweakKeys = list(lsm, /var tweakKeys = (\[[^\]]*\]);/);
        const runtimeKeys = list(runtime, /var TWEAK_KEYS = (\[[^\]]*\]);/);
        expect(tweakKeys).toEqual(runtimeKeys);
        expect(sm.STARTUP_KEYS).toEqual(tweakKeys.concat(["rotationLock"]));
        expect(lsm).toContain('var startupFile = "/var/lib/phoenix/systemmanager/startup.json";');
    });
});
