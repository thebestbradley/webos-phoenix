// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { DropShareStatus } from "@phoenix/luna";
import { ended, fileText, sizeText, statusText } from "./status";

const st = (state: DropShareStatus["state"], files: DropShareStatus["files"] = []): DropShareStatus => ({ url: "http://x/t/", state, files });

describe("DropShare's words", () => {
    it("says what to do, and what happened", () => {
        expect(statusText("receive", null)).toBe("Starting…");
        expect(statusText("receive", st("waiting"))).toMatch(/scan the code or open the address/);
        expect(statusText("send", st("waiting", [{ id: 1, name: "a.jpg", size: 10 }, { id: 2, name: "b.jpg", size: 10 }])))
            .toMatch(/download 2 files/);
        expect(statusText("receive", st("transferring", [{ id: 1, name: "a.jpg", size: 10, saved: "/x" }, { id: 2, name: "b.pdf", size: 10 }])))
            .toBe("Receiving b.pdf…");
        expect(statusText("send", st("transferring", [{ id: 1, name: "a", size: 1, downloads: 1 }, { id: 2, name: "b", size: 1 }])))
            .toBe("1 of 2 files downloaded");
        expect(statusText("receive", st("done", [{ id: 1, name: "a", size: 1, saved: "/m/a" }]))).toBe("Received 1 file. It is in Downloads.");
        expect(statusText("receive", st("done"))).toBe("Nothing was sent.");
        expect(statusText("receive", st("timeout"))).toMatch(/expired/);
        expect(ended(st("waiting"))).toBe(false);
        expect(ended(st("transferring"))).toBe(false);
        expect(ended(st("done"))).toBe(true);
        expect(ended(null)).toBe(false);
    });

    it("tells each file's progress", () => {
        expect(sizeText(512)).toBe("512 B");
        expect(sizeText(2048)).toBe("2 KB");
        expect(sizeText(3 * 1024 * 1024)).toBe("3.0 MB");
        expect(fileText("receive", { id: 1, name: "a", size: 4096, received: 2048 })).toBe("2 KB of 4 KB");
        expect(fileText("receive", { id: 1, name: "a", size: 4096, saved: "/m/a" })).toBe("4 KB · In Downloads");
        expect(fileText("send", { id: 1, name: "a", size: 4096, downloads: 1 })).toBe("4 KB · Downloaded");
    });
});
