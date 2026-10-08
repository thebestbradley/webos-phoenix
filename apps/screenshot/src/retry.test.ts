// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { retryFor } from "./retry";

const now = () => Promise.resolve();

describe("waiting for a capture still being stored", () => {
    it("finds it once it is there", async () => {
        let stored = false, tries = 0;
        const found = await retryFor(() => {
            if (++tries === 3) stored = true;
            return stored ? Promise.resolve("blob:x") : Promise.reject(new Error("missing"));
        }, 4000, 250, () => true, now);
        expect(found).toBe("blob:x");
        expect(tries).toBe(3);
    });

    it("gives up after the wait, with the last error", async () => {
        let tries = 0;
        await expect(retryFor(() => { tries++; return Promise.reject(new Error("gone")); }, 1000, 250, () => true, now))
            .rejects.toThrow("gone");
        expect(tries).toBe(5);
    });

    it("stops when the preview has moved on", async () => {
        let tries = 0, alive = true;
        const p = retryFor(() => { if (++tries === 2) alive = false; return Promise.reject(new Error("x")); }, 4000, 250, () => alive, now);
        const settled = await Promise.race([p.then(() => "settled", () => "settled"), new Promise((r) => setTimeout(() => r("pending"), 20))]);
        expect(settled).toBe("pending");
        expect(tries).toBe(2);
    });
});
