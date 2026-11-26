// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.webos.service.devmode on a device (devmode.js): Phoenix's API over
// OSE's flag file, as OSE's com.palm.service.devmode keeps it.

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const dm = require("./devmode.js") as Any;

describe("com.webos.service.devmode", () => {
    let dir: string, core: Any;
    beforeEach(() => {
        dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devmode-")), "var/luna/preferences");
        core = dm.createDevMode({ dir });
    });
    afterEach(() => { fs.rmSync(path.dirname(path.dirname(path.dirname(dir))), { recursive: true, force: true }); });

    it("is off without OSE's flag file, and turning it on writes the flag and dc0, then asks for the restart", async () => {
        expect(dm.DIR + "/" + dm.FLAG).toBe("/var/luna/preferences/devmode_enabled");
        expect(await core.methods.getDevMode({})).toEqual({ returnValue: true, status: "disabled" });
        const seen: Any[] = [];
        const stop = core.watch((r: Any) => seen.push(r));
        expect(await core.methods.setDevMode({ status: "enabled" })).toEqual({ returnValue: true, status: "enabled", restarting: true });
        expect(fs.existsSync(path.join(dir, "devmode_enabled"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "dc0"))).toBe(true);
        expect(seen).toEqual([{ returnValue: true, status: "enabled" }]);
        stop();
        expect(await core.methods.getDevMode({})).toEqual({ returnValue: true, status: "enabled" });
    });

    it("turning it off removes the flag and dc0 to dc9, as OSE's does", async () => {
        fs.mkdirSync(dir, { recursive: true });
        for (const f of ["devmode_enabled", "dc0", "dc3", "dc9", "other"]) fs.writeFileSync(path.join(dir, f), "");
        expect(await core.methods.setDevMode({ status: "disabled" })).toEqual({ returnValue: true, status: "disabled", restarting: true });
        expect(fs.readdirSync(dir)).toEqual(["other"]);
    });

    it("no change, no restart; OSE's {enabled} is understood; anything else is refused", async () => {
        expect(await core.methods.setDevMode({ status: "disabled" })).toEqual({ returnValue: true, status: "disabled", restarting: false });
        expect(await core.methods.setDevMode({ enabled: true })).toMatchObject({ status: "enabled", restarting: true });
        expect(await core.methods.setDevMode({ enabled: true })).toMatchObject({ status: "enabled", restarting: false });
        expect(await core.methods.setDevMode({ status: "on" })).toMatchObject({ returnValue: false, errorCode: "BAD_PARAMS" });
        expect(await core.methods.setDevMode({})).toMatchObject({ returnValue: false, errorCode: "BAD_PARAMS" });
    });

    it("says so when the flag cannot be written, and asks for no restart", async () => {
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        fs.writeFileSync(dir, "a file where the folder should be");
        const r = await core.methods.setDevMode({ status: "enabled" });
        expect(r).toMatchObject({ returnValue: false, errorCode: "WRITE_FAILED" });
        expect(r.restarting).toBeUndefined();
    });
});
