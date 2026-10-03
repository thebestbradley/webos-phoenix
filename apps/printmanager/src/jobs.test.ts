// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { PrintJob } from "@phoenix/luna";
import { finishedJobs, jobSource, jobTitle, orderJobs } from "./jobs";

const job = (o: Partial<PrintJob>): PrintJob => ({
    jobID: "j", description: "", appName: "Browser", printerID: "phoenix-save-as-pdf", printerName: "Save as PDF",
    state: "Done", pages: 1, file: "", created: 0, finished: 0, errorText: "", ...o,
});

describe("the Print Manager's list", () => {
    it("puts what is printing first, in the order it began, then the rest newest first", () => {
        const order = orderJobs([
            job({ jobID: "old", created: 1, finished: 2 }),
            job({ jobID: "p2", state: "Printing", created: 20 }),
            job({ jobID: "new", created: 5, finished: 30 }),
            job({ jobID: "p1", state: "Printing", created: 10 }),
            job({ jobID: "cancelled", state: "Cancelled", created: 8, finished: 9 }),
        ]).map((j) => j.jobID);
        expect(order).toEqual(["p1", "p2", "new", "cancelled", "old"]);
    });

    it("clears only finished jobs", () => {
        expect(finishedJobs([job({ jobID: "a" }), job({ jobID: "b", state: "Printing" }), job({ jobID: "c", state: "Failed" })])
            .map((j) => j.jobID)).toEqual(["a", "c"]);
    });

    it("names a job by its title, else its file", () => {
        expect(jobTitle(job({ description: "Field Guide" }))).toBe("Field Guide");
        expect(jobTitle(job({ file: "/media/internal/Documents/Lunch (2).pdf" }))).toBe("Lunch (2)");
        expect(jobTitle(job({}))).toBe("Untitled");
        expect(jobSource(job({ appName: "Email" }))).toBe("Email · Save as PDF");
    });
});
