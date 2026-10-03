// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.printmgr: the legacy webOS print manager, which Enyo 1.0's print
// dialog (lib/printdialog) speaks to, for the Print Manager app and for
// Phoenix apps that print (Photos). The simulator implements it in
// runtime/phoenix-runtime.js (block "Printing") with one printer, "Save as
// PDF", which puts the job in /media/internal/Documents as a PDF.
//
//   printers/list {subscribe} -> {eventType: "Add" | "Rmv", printerID,
//       printerName, printerAddress} per printer
//   printers/getCurrent, printers/setCurrent {printerID}
//   printers/getCapabilities {printerID} -> {mediaSize[], mediaType[],
//       printQuality[], canDuplex, hasColor}
//   jobs/open {printerID, description, appName} -> {jobID}
//   jobs/editPrintParams {jobID, numCopies?, mediaSize?, ...}
//   jobs/getFinalParamsAndArea {jobID}
//   jobs/addFile {jobID, pathName, currentPage, totalPages}   (pictures)
//   jobs/close {jobID}, jobs/cancel {jobID}
//   jobs/getStatus {subscribe} -> {jobID, printerState: "DONE", jobStatus}
// Phoenix additions for the Print Manager:
//   jobs/list {subscribe} -> {jobs: PrintJob[]} newest first
//   jobs/remove {jobID}
// Errors carry the print manager's codes (Enyo's PrintManagerError.js):
// -203 a printer that does not answer, -601 no such job.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://com.palm.printmgr";

export interface Printer {
    printerID: string;
    printerName: string;
    printerAddress: string;
}

export type PrintJobState = "Printing" | "Done" | "Cancelled" | "Failed";

export interface PrintJob {
    jobID: string;
    /** What was printed (the page's title). */
    description: string;
    /** The app that printed, as it named itself ("Browser", "Email"). */
    appName: string;
    printerID: string;
    printerName: string;
    state: PrintJobState;
    pages: number;
    /** The PDF it became ("Save as PDF"), when done. */
    file: string;
    created: number;
    finished: number;
    errorText: string;
}

export interface PrinterCapabilities {
    mediaSize: string[];
    mediaType: string[];
    printQuality: string[];
    canDuplex: boolean;
    hasColor: boolean;
}

/** Paper sizes by the print manager's names, for menus. */
export const PAPER_SIZES: Record<string, string> = {
    US_Letter: "Letter",
    ISO_A4: "A4",
    US_Legal: "Legal",
    Photo_4x6: "4x6",
    Photo_5x7: "5x7",
};

export const printManager = {
    /** The printers there are (printers/list sends one event per printer). */
    printers(): Promise<Printer[]> {
        return new Promise((resolve, reject) => {
            const found: Printer[] = [];
            let timer: ReturnType<typeof setTimeout> | null = null;
            const sub = subscribe(`${SERVICE}/printers/list`, {}, (r) => {
                const x = r as unknown as { eventType?: string } & Printer;
                if (x.eventType === "Add" && x.printerID && !found.some((p) => p.printerID === x.printerID))
                    found.push({ printerID: x.printerID, printerName: x.printerName || x.printerID, printerAddress: x.printerAddress || "" });
                // The list arrives as events; it is complete once they stop.
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => { sub.cancel(); resolve(found); }, 150);
            }, (e) => { sub.cancel(); reject(e); });
        });
    },
    async current(): Promise<Printer | null> {
        try {
            const r = await call(`${SERVICE}/printers/getCurrent`, {}) as unknown as Printer;
            return r.printerID ? { printerID: r.printerID, printerName: r.printerName, printerAddress: r.printerAddress } : null;
        } catch {
            return null;
        }
    },
    async setCurrent(printerID: string): Promise<void> {
        await call(`${SERVICE}/printers/setCurrent`, { printerID });
    },
    async capabilities(printerID: string): Promise<PrinterCapabilities> {
        return await call(`${SERVICE}/printers/getCapabilities`, { printerID }) as unknown as PrinterCapabilities;
    },
    /** The jobs, newest first, now and after every change (from any app). */
    watchJobs(cb: (jobs: PrintJob[]) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${SERVICE}/jobs/list`, {}, (r) => cb(((r as unknown as { jobs?: PrintJob[] }).jobs) ?? []), onError);
    },
    async cancel(jobID: string): Promise<void> {
        await call(`${SERVICE}/jobs/cancel`, { jobID });
    },
    /** Forget a finished job (its PDF stays). */
    async remove(jobID: string): Promise<void> {
        await call(`${SERVICE}/jobs/remove`, { jobID });
    },
    /**
     * Print pictures, one a page, as Enyo's ImagePrintJob does: open a job,
     * set its parameters, add each file, close it; resolves with the job
     * once the print manager says it is done.
     */
    async printImages(opts: { printerID: string; paths: string[]; appName: string; description: string;
                              numCopies?: number; mediaSize?: string }): Promise<PrintJob> {
        const { jobID } = await call(`${SERVICE}/jobs/open`, { printerID: opts.printerID, appName: opts.appName,
                                                               description: opts.description }) as unknown as { jobID: string };
        const done = new Promise<void>((resolve) => {
            const sub = subscribe(`${SERVICE}/jobs/getStatus`, {}, (r) => {
                const s = r as unknown as { jobID?: string; printerState?: string };
                if (s.jobID === jobID && s.printerState === "DONE") { sub.cancel(); resolve(); }
            }, () => { sub.cancel(); resolve(); });
        });
        try {
            await call(`${SERVICE}/jobs/editPrintParams`, { jobID, numCopies: opts.numCopies ?? 1, mediaSize: opts.mediaSize ?? "US_Letter",
                                                           autoRotate: true, autoScale: true, topInset: 0.25, leftInset: 0.25,
                                                           rightInset: 0.25, bottomInset: 0.25 });
            await call(`${SERVICE}/jobs/getFinalParamsAndArea`, { jobID });
            for (let i = 0; i < opts.paths.length; i++)
                await call(`${SERVICE}/jobs/addFile`, { jobID, pathName: opts.paths[i], currentPage: i + 1, totalPages: opts.paths.length });
            await call(`${SERVICE}/jobs/close`, { jobID });
        } catch (e) {
            await call(`${SERVICE}/jobs/cancel`, { jobID }).catch(() => undefined);
            throw e;
        }
        await done;
        const jobs = await new Promise<PrintJob[]>((resolve) => {
            const sub = subscribe(`${SERVICE}/jobs/list`, {}, (r) => { sub.cancel(); resolve((r as unknown as { jobs?: PrintJob[] }).jobs ?? []); },
                                  () => { sub.cancel(); resolve([]); });
        });
        const job = jobs.find((j) => j.jobID === jobID);
        if (!job) throw new Error("The print job went away");
        return job;
    },
};

/** "2 pages", "Saved", "Printing..." for a job's row. */
export function jobStateText(job: PrintJob): string {
    switch (job.state) {
    case "Printing": return job.pages ? `Printing ${job.pages} ${job.pages === 1 ? "page" : "pages"}...` : "Preparing to print...";
    case "Done": return `${job.pages} ${job.pages === 1 ? "page" : "pages"}, saved as PDF`;
    case "Cancelled": return "Cancelled";
    default: return job.errorText ? `Failed: ${job.errorText}` : "Failed";
    }
}
