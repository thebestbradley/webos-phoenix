// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The clipboard history's service on a device (host.js): the runtime's own
// org.webosphoenix.clipboard in a page of its own, its store in a file, the
// caller taken from the bus message, the passcode from the device's
// com.palm.systemmanager.

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const host = require("./host.js") as Any;
const RUNTIME = path.join(HERE, "../../runtime/phoenix-runtime.js");

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });

function make(dir?: string) {
    const d = dir || fs.mkdtempSync(path.join(os.tmpdir(), "clip-"));
    if (!dir) dirs.push(d);
    const asked: Any[] = [];
    const h = host.createHost({
        runtimePath: RUNTIME,
        storeFile: path.join(d, "store.json"),
        busCall: (uri: string, p: Any, cb: (r: Any) => void) => { asked.push({ uri, p }); cb({ returnValue: true, succeeded: p.passCode === "4711" }); }
    });
    const call = (m: string, p: Any = {}, sender = "com.palm.app.notes 1001") =>
        new Promise<Any>((resolve) => h.call(m, p, sender, resolve, false));
    return { h, call, dir: d, asked };
}

describe("the clipboard service", () => {
    it("records with the caller as the source, newest first", async () => {
        const s = make();
        expect((await s.call("add", { text: "first" }, "com.palm.app.email 1234")).clip.source).toBe("com.palm.app.email");
        await s.call("add", { text: "second" });
        const h = await s.call("history");
        expect(h.clips.map((c: Any) => c.text)).toEqual(["second", "first"]);
        expect(h.clips[0].source).toBe("com.palm.app.notes");
    });

    it("keeps sensitive clips encrypted, masked, revealed with the device's passcode", async () => {
        const s = make();
        const added = (await s.call("add", { text: "Tr0ub4dor&3x!" })).clip;
        expect(added.sensitive).toBe(true);
        expect(added.text).toBeUndefined();
        expect((await s.call("paste", { id: added.id })).errorCode).toBe(-3);
        expect((await s.call("reveal", { id: added.id, passCode: "0000" })).errorCode).toBe(-5);
        expect((await s.call("reveal", { id: added.id, passCode: "4711" })).text).toBe("Tr0ub4dor&3x!");
        expect(s.asked.at(-1).uri).toBe("luna://com.palm.systemmanager/matchDevicePasscode");
        // The system UI (the keyboard into a password field) may paste it.
        expect((await s.call("paste", { id: added.id }, "com.palm.systemui")).clip.text).toBe("Tr0ub4dor&3x!");
        s.h.flush();
        const file = fs.readFileSync(path.join(s.dir, "store.json"), "utf8");
        expect(file).not.toContain("Tr0ub4dor");
        expect(fs.statSync(path.join(s.dir, "store.json")).mode & 0o777).toBe(0o600);
    });

    it("keeps the history across a restart", async () => {
        const s = make();
        const c = (await s.call("add", { text: "kept" })).clip;
        await s.call("pin", { id: c.id });
        const secret = (await s.call("add", { text: "123 456" })).clip;
        s.h.flush();
        const again = make(s.dir);
        const h = await again.call("history");
        expect(h.clips.find((x: Any) => x.id === c.id).pinned).toBe(true);
        expect((await again.call("reveal", { id: secret.id, passCode: "4711" })).text).toBe("123 456");
    });

    it("clears the history on locking when asked to", async () => {
        const s = make();
        await s.call("setSettings", { clearOnLock: true });
        const keep = (await s.call("add", { text: "saved" })).clip;
        await s.call("pin", { id: keep.id });
        await s.call("add", { text: "gone" });
        s.h.lockChanged(false);
        s.h.lockChanged(true);
        await new Promise((r) => setTimeout(r, 10));
        expect((await s.call("history")).clips.map((c: Any) => c.text)).toEqual(["saved"]);
    });

    it("answers every method the runtime has", () => {
        const s = make();
        const services = s.h.runtime.services["org.webosphoenix.clipboard"];
        for (const m of host.METHODS)
            expect(typeof services["/" + m], m).toBe("function");
        const api = JSON.parse(fs.readFileSync(path.join(HERE, "sysbus/org.webosphoenix.clipboard.api.json"), "utf8"));
        expect(api["phoenix.clipboard"]).toEqual(host.METHODS.map((m: string) => "org.webosphoenix.clipboard/" + m));
    });
});
