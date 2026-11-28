// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The USB debugging link novad follows (lib/usblink.js).

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Any = any;
const { createUsbLink, HELPER } = require("./lib/usblink.js") as Any;

function setup(results: Array<"ok" | "fail">) {
    const calls: string[] = [], logs: string[] = [];
    const st = { want: true };
    const link = createUsbLink({
        want: () => st.want,
        run: (cmd: string, args: string[]) => {
            expect(cmd).toBe(HELPER);
            calls.push(args[0]);
            const r = results.shift() || "ok";
            return r === "ok" ? Promise.resolve({ stdout: args[0] + "\n" })
                : Promise.reject(Object.assign(new Error("exit 3"), { stdout: "another gadget holds the controller\n" }));
        },
        log: (m: string) => logs.push(m),
    });
    return { link, calls, logs, st };
}

describe("the USB debugging link (lib/usblink.js)", () => {
    it("tries a failed \"up\" again at the next follow (the minute's), until it works", async () => {
        const { link, calls, logs } = setup(["fail", "fail", "ok"]);
        await link.follow();
        expect(link.state()).toBe(null);
        await link.follow();
        await link.follow();
        expect(calls).toEqual(["up", "up", "up"]);
        expect(link.state()).toBe(true);
        await link.follow();
        expect(calls).toEqual(["up", "up", "up"]);
        // The same failure is logged once.
        expect(logs.filter((l) => /another gadget/.test(l))).toHaveLength(1);
    });

    it("runs the helper once for a state it has reached, and follows a change", async () => {
        const { link, calls, st } = setup([]);
        await link.follow();
        await link.follow();
        st.want = false;
        await link.follow();
        expect(calls).toEqual(["up", "down"]);
        expect(link.state()).toBe(false);
    });

    it("one run at a time: a change asked for while one runs is made when it ends", async () => {
        const { link, calls, st } = setup([]);
        const first = link.follow();
        st.want = false;
        link.follow();
        await first;
        expect(calls).toEqual(["up", "down"]);
        expect(link.state()).toBe(false);
    });
});
