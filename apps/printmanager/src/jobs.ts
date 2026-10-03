// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the Print Manager shows of the print manager's jobs.

import type { PrintJob } from "@phoenix/luna";

/** The jobs printing now first (oldest first, as they queue), then the rest newest first. */
export function orderJobs(jobs: PrintJob[]): PrintJob[] {
    const printing = jobs.filter((j) => j.state === "Printing").sort((a, b) => a.created - b.created);
    const rest = jobs.filter((j) => j.state !== "Printing").sort((a, b) => (b.finished || b.created) - (a.finished || a.created));
    return printing.concat(rest);
}

/** Jobs Clear Finished Jobs takes away: done, cancelled or failed. */
export function finishedJobs(jobs: PrintJob[]): PrintJob[] {
    return jobs.filter((j) => j.state !== "Printing");
}

/** A job's name in the list. */
export function jobTitle(job: PrintJob): string {
    return job.description || (job.file ? job.file.replace(/^.*\//, "").replace(/\.pdf$/i, "") : "") || "Untitled";
}

/** "Browser" from the app's name, else where it went. */
export function jobSource(job: PrintJob): string {
    return [job.appName, job.printerName].filter(Boolean).join(" · ");
}
