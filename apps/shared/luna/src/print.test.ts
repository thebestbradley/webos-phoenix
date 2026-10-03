// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Printing against the simulated print manager (runtime/phoenix-runtime.js,
// block "Printing"): the calls Enyo 1.0's PrintDialog and DocumentPrintJob
// make, the "Save as PDF" printer, the PDF writer, and the Print Manager's
// job list.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, subscribe } from "./bridge";
import { jobStateText, printManager, type PrintJob } from "./print";

const REPO = resolve(__dirname, "../../../..");
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

interface Runtime {
    print: {
        render(jobID: string, how: { title?: string; text?: string }): boolean;
        pdf(pages: { width: number; height: number; items: unknown[] }[]): Uint8Array;
    };
    mediaFiles: { read(p: string): Promise<Blob | null> };
}
const rt = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
});

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
async function blobText(b: Blob): Promise<string> {
    const buf = await new Promise<ArrayBuffer>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as ArrayBuffer);
        r.onerror = () => rej(r.error);
        r.readAsArrayBuffer(b);
    });
    return latin1(new Uint8Array(buf));
}

// Every object the xref names starts where it says, as a reader needs.
function checkXref(pdf: string) {
    const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(start, start + 4)).toBe("xref");
    const rows = pdf.slice(start).split("\n").slice(2).filter((l) => / n $/.test(l));
    rows.forEach((row, i) => {
        const at = Number(row.slice(0, 10));
        expect(pdf.slice(at, at + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`);
    });
    return rows.length;
}

describe("the PDF writer", () => {
    it("writes pages of text with a correct cross-reference table", () => {
        const bytes = rt().print.pdf([
            { width: 612, height: 792, items: [{ text: "Hello (webOS) \\ Phoenix", x: 36, y: 36, size: 11 }] },
            { width: 595, height: 842, items: [{ text: "Page two, café ☃", x: 36, y: 36, size: 11 }] },
        ]);
        const pdf = latin1(bytes);
        expect(pdf.startsWith("%PDF-1.4")).toBe(true);
        expect(pdf).toContain("/Count 2");
        expect(pdf).toContain("(Hello \\(webOS\\) \\\\ Phoenix) Tj");
        expect(pdf).toContain("(Page two, café ?) Tj");
        expect(pdf).toContain("/MediaBox [0 0 595 842]");
        expect(checkXref(pdf)).toBe(3 + 2 * 2);
        expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    });

    it("embeds JPEG pictures as they are", () => {
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
        const pdf = latin1(rt().print.pdf([{ width: 288, height: 432, items: [{ image: { jpeg, width: 4, height: 6 }, x: 0, y: 0, w: 288, h: 432 }] }]));
        expect(pdf).toContain("/Subtype /Image /Width 4 /Height 6 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 9");
        expect(pdf).toContain("q 288.00 0 0 432.00 0.00 0.00 cm /Im1 Do Q");
        expect(checkXref(pdf)).toBe(6);
    });
});

describe("the print manager", () => {
    it("has the Save as PDF printer, current and capable", async () => {
        const printers = await printManager.printers();
        expect(printers).toEqual([{ printerID: "phoenix-save-as-pdf", printerName: "Save as PDF", printerAddress: "/media/internal/Documents" }]);
        expect((await printManager.current())?.printerID).toBe("phoenix-save-as-pdf");
        const caps = await printManager.capabilities("phoenix-save-as-pdf");
        expect(caps).toMatchObject({ hasColor: true, canDuplex: false });
        expect(caps.mediaSize).toContain("ISO_A4");
        // No network printers in the simulator.
        await expect(call("luna://com.palm.printmgr/printers/add", { printerID: "10.0.0.9", printerName: "Office" }))
            .rejects.toMatchObject({ errorCode: -203 });
    });

    it("prints a document as DocumentPrintJob does, into a PDF in Documents", async () => {
        const status: Record<string, unknown>[] = [];
        const render: Record<string, unknown>[] = [];
        const jobs: PrintJob[][] = [];
        const s1 = subscribe("luna://com.palm.printmgr/jobs/getStatus", {}, (r) => status.push(r as never));
        const s2 = subscribe("luna://com.palm.printmgr/jobs/getRenderStatus", {}, (r) => render.push(r as never));
        const s3 = printManager.watchJobs((j) => jobs.push(j));
        const { jobID } = await call("luna://com.palm.printmgr/jobs/open", { printerID: "phoenix-save-as-pdf", appName: "Browser", description: "" }) as unknown as { jobID: string };
        expect(hostMessages.find((m) => m.type === "ongoing")?.payload).toMatchObject({ id: "print-" + jobID, appId: "org.webosphoenix.printmanager" });
        await call("luna://com.palm.printmgr/jobs/editPrintParams", { jobID, mediaSize: "ISO_A4", topInset: 0.5, leftInset: 0.5, rightInset: 0.5, bottomInset: 0.5 });
        const area = await call("luna://com.palm.printmgr/jobs/getFinalParamsAndArea", { jobID }) as unknown as { width: number; height: number; pixelUnits: number };
        // A4 less half an inch all round, at 300 dpi.
        expect(area).toMatchObject({ pixelUnits: 300, width: Math.round((595 - 72) / 72 * 300), height: Math.round((842 - 72) / 72 * 300) });
        // The page view renders (here: the page's text, as a desktop browser can).
        expect(rt().print.render(jobID, { title: "Field Guide", text: "Cards, gestures and the apps you carry.\n".repeat(120) })).toBe(true);
        await new Promise((r) => setTimeout(r, 20));
        const last = render[render.length - 1];
        expect(last).toMatchObject({ jobID, renderResultCode: 0 });
        expect(last.totalPages).toBeGreaterThan(1);
        await call("luna://com.palm.printmgr/jobs/close", { jobID });
        expect(status[status.length - 1]).toMatchObject({ jobID, printerState: "DONE", jobStatus: "Success" });
        const blob = await rt().mediaFiles.read("/media/internal/Documents/Field Guide.pdf");
        expect(blob).not.toBeNull();
        const pdf = await blobText(blob!);
        expect(pdf).toContain("(Field Guide) Tj");
        expect(pdf).toContain("/MediaBox [0 0 595 842]");
        checkXref(pdf);
        const job = jobs[jobs.length - 1][0];
        expect(job).toMatchObject({ jobID, state: "Done", description: "Field Guide", appName: "Browser", file: "/media/internal/Documents/Field Guide.pdf" });
        expect(jobStateText(job)).toMatch(/pages, saved as PDF$/);
        expect(hostMessages.some((m) => m.type === "ongoing" && m.payload.id === "print-" + jobID && m.payload.clear)).toBe(true);
        expect(hostMessages.find((m) => m.type === "notification")?.payload).toMatchObject({ title: "Saved as PDF", body: "Field Guide.pdf" });
        // A second one with the same title gets its own file.
        const second = await call("luna://com.palm.printmgr/jobs/open", { printerID: "phoenix-save-as-pdf", appName: "Browser", description: "Field Guide" }) as unknown as { jobID: string };
        rt().print.render(second.jobID, { title: "Field Guide", text: "Again" });
        await new Promise((r) => setTimeout(r, 20));
        await call("luna://com.palm.printmgr/jobs/close", { jobID: second.jobID });
        expect(await rt().mediaFiles.read("/media/internal/Documents/Field Guide (2).pdf")).not.toBeNull();
        s1.cancel(); s2.cancel(); s3.cancel();
    });

    it("cancels a job, and forgets finished ones", async () => {
        const status: Record<string, unknown>[] = [];
        const s1 = subscribe("luna://com.palm.printmgr/jobs/getStatus", {}, (r) => status.push(r as never));
        const { jobID } = await call("luna://com.palm.printmgr/jobs/open", { printerID: "phoenix-save-as-pdf", appName: "Email", description: "Lunch" }) as unknown as { jobID: string };
        await printManager.cancel(jobID);
        expect(status[status.length - 1]).toMatchObject({ jobID, printerState: "DONE", jobStatus: "Cancelled" });
        // Rendering that comes back after the cancel is not printed.
        expect(rt().print.render(jobID, { text: "late" })).toBe(false);
        const jobs = await new Promise<PrintJob[]>((res) => { const s = printManager.watchJobs((j) => { s.cancel(); res(j); }); });
        expect(jobs[0]).toMatchObject({ jobID, state: "Cancelled" });
        await printManager.remove(jobID);
        const after = await new Promise<PrintJob[]>((res) => { const s = printManager.watchJobs((j) => { s.cancel(); res(j); }); });
        expect(after.some((j) => j.jobID === jobID)).toBe(false);
        await expect(call("luna://com.palm.printmgr/jobs/close", { jobID })).rejects.toMatchObject({ errorCode: -601 });
        s1.cancel();
    });

    it("prints some HTML (Email's message), as its text outside phoenix-sim", async () => {
        const { jobID } = await call("luna://com.palm.printmgr/jobs/open", { printerID: "phoenix-save-as-pdf", appName: "Email", description: "" }) as unknown as { jobID: string };
        await call("luna://com.palm.printmgr/jobs/editPrintParams", { jobID, mediaSize: "US_Letter" });
        const r = rt() as unknown as { print: { renderHtml(id: string, how: { title: string; html: string }): boolean } };
        expect(r.print.renderHtml(jobID, { title: "Lunch today?", html: "<h2>Lunch today?</h2><p>Are we still on for <b>lunch</b>?</p>" })).toBe(true);
        await new Promise((res) => setTimeout(res, 20));
        await call("luna://com.palm.printmgr/jobs/close", { jobID });
        // A "?" cannot be in a file name.
        const pdf = await blobText((await rt().mediaFiles.read("/media/internal/Documents/Lunch today.pdf"))!);
        expect(pdf).toContain("/MediaBox [0 0 612 792]");
        expect(pdf).toContain("(Lunch today?) Tj");
        // jsdom has no innerText: the text as textContent gives it.
        expect(pdf).toContain("Are we still on for lunch?) Tj");
    });

    it("fails a job whose printing page went away", async () => {
        const now = Date.now();
        localStorage.setItem("phoenix:print:jobs", JSON.stringify([
            { jobID: "orphan", page: "gone", state: "Printing", description: "Lost", appName: "Email", printerID: "phoenix-save-as-pdf",
              printerName: "Save as PDF", params: {}, created: now - 60000, pages: 0 },
            { jobID: "busy", page: "elsewhere", state: "Printing", description: "Still going", appName: "Browser", printerID: "phoenix-save-as-pdf",
              printerName: "Save as PDF", params: {}, created: now - 1000, pages: 0 },
        ]));
        // The second page still says it is there; the first never did.
        localStorage.setItem("phoenix:print:alive:elsewhere", JSON.stringify(now));
        const jobs = await new Promise<PrintJob[]>((res) => { const s = printManager.watchJobs((j) => { s.cancel(); res(j); }); });
        expect(jobs.find((j) => j.jobID === "orphan")).toMatchObject({ state: "Failed", errorText: "The app printing it closed" });
        expect(jobs.find((j) => j.jobID === "busy")).toMatchObject({ state: "Printing" });
    });

    it("lets PrintJob's headless launch of the Print Manager open no card", async () => {
        await call("luna://com.palm.applicationManager/open", { id: "com.palm.app.printmanager", params: { $disableCardPreLaunch: true, runHeadless: true } });
        expect(hostMessages.some((m) => m.type === "launch")).toBe(false);
        await call("luna://com.palm.applicationManager/open", { id: "com.palm.app.printmanager", params: {} });
        expect(hostMessages.find((m) => m.type === "launch")?.payload).toMatchObject({ id: "org.webosphoenix.printmanager" });
    });
});
