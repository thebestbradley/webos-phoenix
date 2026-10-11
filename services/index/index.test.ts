// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.index with a stand-in device (test/world.cjs: a
// db8 that keeps revisions and deletions as db8 does) and the fake
// embedder (test/fake-embedder.cjs: a furnace and a boiler share a
// concept): passages, the vectors and their file, a pass and the passes
// after it (only what changed is embedded again; deletions; a source
// turned off), when it may run, resuming, ranking, who said it, files and
// PDFs, pictures, wipe, and brute force at 50,000 passages.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";

const require = createRequire(__filename);
const chunk = require("./lib/chunk.js");
const vectors = require("./lib/vectors.js");
const store = require("./lib/store.js");
const pdftext = require("./lib/pdftext.js");
const wav = require("./lib/wav.js");
const sources = require("./lib/sources.js");
const { world } = require("./test/world.cjs");
const { embed } = require("./test/fake-embedder.cjs");

const MEMO = "com.palm.note:1", EMAIL = "com.palm.imap.email:1", SMS = "com.palm.smsmessage:1";

function seed(w: any) {
    w.put({ _id: "memo-wifi", _kind: MEMO, text: "Wi-Fi at the cabin: network Lakeview, password on the fridge", modifiedTimestamp: 3 });
    w.put({ _id: "memo-books", _kind: MEMO, text: "Books to read\n- A Field Guide to Coastal Birds", modifiedTimestamp: 2 });
    w.put({ _id: "mail-furnace", _kind: EMAIL, subject: "Your furnace visit", from: { name: "Northside Heating", addr: "jobs@northside.example" },
            timestamp: 5, flags: { visible: true }, parts: [{ type: "body", mimeType: "text/html", content: "Our engineer will service the radiators on <b>Tuesday</b>." }] });
    w.put({ _id: "mail-lunch", _kind: EMAIL, subject: "Lunch today?", from: { name: "Priya", addr: "priya@example.net" }, timestamp: 4, flags: { visible: true },
            parts: [{ type: "body", mimeType: "text/plain", content: "Bistro Verde at 12:30?" }] });
    w.put({ _id: "p-sam", _kind: "com.palm.person:1", name: { givenName: "Sam", familyName: "Delgado" }, phoneNumbers: [{ value: "(303) 555-0135" }] });
    w.put({ _id: "sms-sam", _kind: SMS, folder: "inbox", messageText: "The surprise cake for Saturday is ordered", from: { addr: "3035550135" }, localTimestamp: 6, threadId: "t-sam" });
    w.put({ _id: "sms-priya", _kind: SMS, folder: "inbox", messageText: "Birthday dinner at mine on Friday?", from: { addr: "4155550123" }, localTimestamp: 7, threadId: "t-priya" });
}
async function on(w: any, extra: any = {}) {
    const r = await w.m.setSettings({ enabled: true, ...extra });
    expect(r.returnValue).toBe(true);
    await w.settle();
}

describe("passages", () => {
    it("cuts long text into overlapping passages, at most eight, written as the model card asks", () => {
        const words = Array.from({ length: 2000 }, (_, i) => "w" + i).join(" ");
        const list = chunk.passages(words);
        expect(list.length).toBe(chunk.MAX_PASSAGES);
        expect(list[0].text.split(" ").length).toBe(chunk.MAX_WORDS);
        expect(list[1].start).toBe(chunk.MAX_WORDS - chunk.OVERLAP);
        expect(chunk.passages("short memo")).toEqual([{ text: "short memo", start: 0 }]);
        // Text without spaces (a key, a table): characters too, and words cut.
        const long = chunk.passages(Array.from({ length: 60 }, () => "x".repeat(90)).join(" "));
        expect(long.every((p: any) => p.text.length <= chunk.MAX_CHARS)).toBe(true);
        expect(long[0].text.split(" ")[0]).toHaveLength(40);
        expect(long.length).toBeGreaterThan(1);
        expect(chunk.documentInput("Lunch | today", "at noon")).toBe("title: Lunch / today | text: at noon");
        expect(chunk.documentInput("", "x")).toBe("title: none | text: x");
        expect(chunk.queryInput(" the  boiler ")).toBe("task: search result | query: the boiler");
    });
    it("reads an email's HTML as its words", () => {
        expect(chunk.htmlText("<p>Hi&nbsp;there</p><style>p{}</style><br>A &amp; B &lt;3")).toBe("Hi there\nA & B <3");
    });
});

describe("vectors and their file", () => {
    it("cuts to 256 dimensions and normalizes again (Matryoshka)", () => {
        const v = vectors.prepare(Array.from({ length: 768 }, (_, i) => (i < 256 ? 1 : 5)));
        expect(v.length).toBe(256);
        expect(v.reduce((s: number, x: number) => s + x * x, 0)).toBeCloseTo(1, 5);
    });
    it("keeps 8-bit vectors whose dot products stay within 1% of the float ones", () => {
        const a = embed("furnace engineer visit"), b = embed("the boiler repair");
        const q = new Int8Array(256), scale = vectors.quantize(a, q, 0);
        const exact = a.reduce((s: number, x: number, i: number) => s + x * b[i], 0);
        expect(vectors.scores(b, q, new Float32Array([scale]), 1)[0]).toBeCloseTo(exact, 2);
    });
    it("writes a source's index and reads it back, and takes records out", () => {
        const idx = store.createSourceIndex({ source: "memos", model: "m", rev: 7 });
        for (let k = 0; k < 40; k++) {
            const q = new Int8Array(256);
            idx.add({ r: "r" + (k % 10), c: Math.floor(k / 10), h: "h" + k, t: k }, q.fill(k), 0.5 + k);
        }
        const back = store.decode(store.encode(idx));
        expect(back.rev).toBe(7);
        expect(back.count()).toBe(40);
        expect(back.scales[39]).toBe(39.5);
        expect(back.vecs[39 * 256 + 5]).toBe(39);
        expect(back.removeRecords(["r3", "r4"])).toBe(8);
        expect(back.count()).toBe(32);
        expect(back.records().has("r3")).toBe(false);
        // What moved down kept its vector.
        const k = back.items.findIndex((it: any) => it.h === "h39");
        expect(back.vecs[k * 256]).toBe(39);
        expect(back.scales[k]).toBe(39.5);
        expect(store.decode(new Uint8Array([1, 2, 3]))).toBe(null);
    });
    it("ranks 50,000 passages by brute force in well under a second", () => {
        const n = 50000, dim = 256, vecs = new Int8Array(n * dim), scales = new Float32Array(n);
        for (let i = 0; i < vecs.length; i++) vecs[i] = ((i * 2654435761) >>> 24) - 128;
        scales.fill(1 / 127 / 9);
        const q = vectors.prepare(Array.from({ length: dim }, (_, i) => Math.sin(i)));
        const t0 = performance.now();
        const sc = vectors.scores(q, vecs, scales, n, dim);
        const best = vectors.top(sc, 10);
        const ms = performance.now() - t0;
        console.log(`brute force over ${n} passages of ${dim} dimensions: ${ms.toFixed(1)} ms; the file: ${(n * (dim + 4) / 1048576).toFixed(1)} MB of vectors`);
        expect(best.length).toBe(10);
        expect(sc[best[0]]).toBeGreaterThanOrEqual(sc[best[9]]);
        expect(ms).toBeLessThan(1000);
    });
});

describe("the index", () => {
    it("is off until turned on, and asks for its model", async () => {
        const w = world({ noModel: true });
        seed(w);
        expect((await w.m.getStatus({})).state).toBe("off");
        expect((await w.m.search({ query: "boiler" })).enabled).toBe(false);
        await on(w);
        const st = await w.m.getStatus({});
        expect(st.state).toBe("needsModel");
        expect(st.model.text.installed).toBe(false);
        expect(st.model.text.size).toBe(309855456);
        await w.m.downloadModel({});
        await w.m.sync({});
        expect((await w.m.getStatus({})).records).toBeGreaterThan(0);
    });

    it("finds things by what they mean, each with its app and launch params", async () => {
        const w = world();
        seed(w);
        await on(w);
        const st = await w.m.getStatus({});
        expect(st.state).toBe("idle");
        expect(st.sources.find((s: any) => s.id === "memos").records).toBe(2);
        expect(st.sources.find((s: any) => s.id === "email").records).toBe(2);
        expect(st.bytes).toBeGreaterThan(0);
        const r = await w.m.search({ query: "the email about the boiler", sources: ["email"] });
        expect(r.results[0]).toMatchObject({ source: "email", id: "mail-furnace", title: "Your furnace visit", who: "Northside Heating",
                                             appId: "com.palm.app.email", icon: "/usr/palm/applications/com.palm.app.email/icon.png",
                                             open: { appId: "com.palm.app.email", params: { emailId: "mail-furnace" } } });
        expect(r.results[0].snippet).toMatch(/radiators on Tuesday/);
        // Who wrote it is shown apart, not in the snippet (the model reads "From Northside Heating.").
        expect(r.results[0].snippet).not.toMatch(/^From /);
        const wifi = await w.m.search({ query: "internet password" });
        expect(wifi.results[0]).toMatchObject({ source: "memos", id: "memo-wifi", open: { params: { memoId: "memo-wifi" } } });
        // Nothing near: nothing.
        expect((await w.m.search({ query: "quantum chromodynamics" })).results).toEqual([]);
    });

    it("embeds only what changed, and takes out what was deleted", async () => {
        const w = world();
        seed(w);
        await on(w);
        const before = w.embedder.calls.inputs;
        await w.m.sync({});
        expect(w.embedder.calls.inputs).toBe(before);
        w.merge({ _id: "memo-books", text: "Books to read\n- A Field Guide to Coastal Birds\n- Beach reads for the holiday" });
        w.merge({ _id: "memo-wifi", modifiedTimestamp: 9 });   // a change of nothing it reads
        await w.m.sync({});
        expect(w.embedder.calls.inputs).toBe(before + 1);
        expect((await w.m.search({ query: "seaside holiday" })).results[0].id).toBe("memo-books");
        w.del("mail-furnace");
        await w.m.sync({});
        expect((await w.m.search({ query: "boiler", sources: ["email"] })).results.map((x: any) => x.id)).not.toContain("mail-furnace");
        const idx = await w.svc.load("email");
        expect(idx.records().has("mail-furnace")).toBe(false);
        // Kept between starts: a new service over the same files.
        const st = await w.m.getStatus({});
        expect(st.sources.find((s: any) => s.id === "email").records).toBe(1);
    });

    it("never shows a record purged without a trace, and drops a source turned off", async () => {
        const w = world();
        seed(w);
        await on(w);
        w.purge("memo-wifi");
        expect((await w.m.search({ query: "internet password" })).results.map((x: any) => x.id)).not.toContain("memo-wifi");
        await w.m.setSettings({ sources: { email: false } });
        expect(w.kept.has("email.idx")).toBe(false);
        expect((await w.m.search({ query: "boiler" })).results.every((x: any) => x.source !== "email")).toBe(true);
        expect((await w.m.getStatus({})).sources.find((s: any) => s.id === "email")).toMatchObject({ enabled: false, records: 0 });
    });

    it("waits for the charger with a backlog, but takes a few changes at once", async () => {
        const w = world({ conditions: { charging: false, battery: 60, idle: false } });
        for (let i = 0; i < 80; i++) w.put({ _kind: MEMO, text: "Memo number " + i, modifiedTimestamp: i });
        await on(w);
        let st = await w.m.getStatus({});
        expect(st.state).toBe("waiting");
        expect(st.waiting).toBe("charging");
        expect(st.records).toBe(0);
        // Plugged in: the backlog goes in.
        w.conditions.charging = true;
        await w.m.sync({});
        expect((await w.m.getStatus({})).sources.find((s: any) => s.id === "memos").records).toBe(80);
        // Unplugged again: a few changes are fine on battery.
        w.conditions.charging = false;
        w.put({ _kind: MEMO, text: "Garage door code is 4512", modifiedTimestamp: 99 });
        await w.m.sync({});
        expect((await w.m.getStatus({})).sources.find((s: any) => s.id === "memos").records).toBe(81);
        // Never on a battery saver.
        w.conditions.saver = true;
        w.put({ _kind: MEMO, text: "Another one", modifiedTimestamp: 100 });
        await w.m.sync({});
        st = await w.m.getStatus({});
        expect(st.waiting).toBe("saver");
        expect(st.sources.find((s: any) => s.id === "memos").records).toBe(81);
    });

    it("stops between pages when it must, and goes on from there", async () => {
        const w = world();
        for (let i = 0; i < 120; i++) w.put({ _kind: MEMO, text: "Note " + i, modifiedTimestamp: i });
        let pages = 0;
        const find = w.luna.call;
        w.luna.call = (uri: string, p: any) => {
            if (/db\/find$/.test(uri) && p.query.from === MEMO && p.query.orderBy && ++pages === 2) w.conditions.saver = true;
            return find(uri, p);
        };
        await on(w);
        const idx = await w.svc.load("memos");
        expect(idx.count()).toBe(100);
        expect(w.kept.has("memos.idx")).toBe(true);
        const embedded = w.embedder.calls.inputs;
        w.conditions.saver = false;
        await w.m.sync({});
        expect((await w.svc.load("memos")).count()).toBe(120);
        expect(w.embedder.calls.inputs - embedded).toBe(20);
    });

    it("tells who said it: messages from one person", async () => {
        const w = world();
        seed(w);
        await on(w);
        const all = await w.m.search({ query: "party", sources: ["messages"] });
        expect(all.results.map((x: any) => x.id).sort()).toEqual(["sms-priya", "sms-sam"]);
        // Near the best only (the model's margin): Priya's dinner is less about a party than Sam's cake.
        expect((await w.m.search({ query: "party", sources: ["messages"], margin: 0.1 })).results.map((x: any) => x.id)).toEqual(["sms-sam"]);
        const sam = await w.m.search({ query: "party", sources: ["messages"], from: ["(303) 555-0135"] });
        expect(sam.results.map((x: any) => x.id)).toEqual(["sms-sam"]);
        expect(sam.results[0]).toMatchObject({ title: "Sam Delgado", open: { appId: "org.webosphoenix.messaging", params: { threadId: "t-sam" } } });
        expect(sam.results[0].snippet).not.toMatch(/^Sam Delgado:/);
    });

    it("reads files: names, text files and PDFs", async () => {
        const content = "BT /F1 12 Tf 72 712 Td (Boiler service contract) Tj T* [(renewal due in ) -20 (March)] TJ ET";
        const deflated = zlib.deflateSync(Buffer.from(content, "latin1"));
        const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length " + deflated.length + " /Filter /FlateDecode >>\nstream\n", "latin1"), deflated,
                                   Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")]);
        expect(await pdftext.extract(new Uint8Array(pdf), (b: Uint8Array) => zlib.inflateSync(Buffer.from(b)))).toMatch(/Boiler service contract\s+renewal due in March/);
        const w = world({ files: {
            "/media/internal/Documents/heating-contract.pdf": { bytes: new Uint8Array(pdf), text: "x".repeat(pdf.length), mtime: 5 },
            "/media/internal/Documents/packing list.txt": { text: "Sunscreen, towels and a beach umbrella", mtime: 6 },
            "/media/internal/.phoenix/models/x.gguf": { text: "never read", mtime: 1 },
        } });
        await on(w);
        const r = await w.m.search({ query: "boiler", sources: ["files"] });
        expect(r.results[0]).toMatchObject({ id: "/media/internal/Documents/heating-contract.pdf", source: "files",
                                             open: { appId: "org.webosphoenix.files", params: { path: "/media/internal/Documents" } } });
        expect((await w.m.search({ query: "seaside", sources: ["files"], minScore: 0.4 })).results[0].title).toBe("packing list.txt");
        expect((await w.svc.load("files")).records().has("/media/internal/.phoenix/models/x.gguf")).toBe(false);
        // A file removed: out of the index at the next pass.
        delete w.files["/media/internal/Documents/packing list.txt"];
        await w.m.sync({});
        expect((await w.svc.load("files")).records().size).toBe(1);
    });

    it("embeds pictures themselves with photos and voice memos included", async () => {
        const w = world({ media: true, files: { "/media/internal/DCIM/IMG_2041.jpg": { text: "sand waves ocean", mtime: 1 } } });
        w.put({ _id: "img-1", _kind: "com.palm.media.image.file:1", path: "/media/internal/DCIM/IMG_2041.jpg", createdTime: 1 });
        await on(w);
        // By its name and date alone, nothing says beach.
        expect((await w.m.search({ query: "beach", sources: ["photos"] })).results).toEqual([]);
        await w.m.setSettings({ media: true });
        await w.settle();
        const r = await w.m.search({ query: "photos of the beach", sources: ["photos"] });
        expect(r.results[0]).toMatchObject({ id: "img-1", media: "i", path: "/media/internal/DCIM/IMG_2041.jpg",
                                             open: { appId: "org.webosphoenix.photos", params: { imageList: { results: [{ file_path: "/media/internal/DCIM/IMG_2041.jpg" }] } } } });
        expect(w.embedder.calls.media).toBe(1);
        // Turned off again: the pictures' own vectors go.
        await w.m.setSettings({ media: false });
        expect((await w.m.search({ query: "beach", sources: ["photos"] })).results).toEqual([]);
    });

    it("cuts a voice memo to what the server reads at once", () => {
        const rate = 16000, secs = 30, pcm = new Uint8Array(rate * 2 * secs);
        const hdr = Buffer.alloc(44);
        hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8); hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16);
        hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 2, 28); hdr.writeUInt16LE(2, 32);
        hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
        const out = wav.clip(new Uint8Array(Buffer.concat([hdr, Buffer.from(pcm)])), 18);
        expect(out.length).toBe(44 + rate * 2 * 18);
        expect(Buffer.from(out).readUInt32LE(40)).toBe(rate * 2 * 18);
        expect(wav.clip(new Uint8Array(10), 5)).toBe(null);
    });

    it("lets only Settings change it, and the shell erase it", async () => {
        const w = world({ guarded: true });
        seed(w);
        await on(w);
        expect((await w.m.setSettings({ enabled: false }, "com.example.app")).returnValue).toBe(false);
        expect((await w.m.search({ query: "x" }, "com.example.app")).returnValue).toBe(false);
        expect((await w.m.wipe({}, "org.webosphoenix.settings")).returnValue).toBe(false);
        expect((await w.m.search({ query: "boiler" }, "org.webosphoenix.assistant")).results.length).toBeGreaterThan(0);
        expect((await w.m.search({ query: "boiler" }, "com.palm.launcher")).returnValue).toBe(true);
        expect((await w.m.wipe({}, "com.webos.surfacemanager")).returnValue).toBe(true);
        expect(w.kept.size).toBe(0);
        expect((await w.m.getStatus({})).enabled).toBe(false);
    });

    it("rebuilds from nothing, and deletes the index (turning it off)", async () => {
        const w = world();
        seed(w);
        await on(w);
        const once = w.embedder.calls.inputs;
        await w.m.rebuild({});
        await w.settle();
        expect(w.embedder.calls.inputs).toBe(once * 2);
        const st = await w.m.deleteIndex({});
        expect(st.enabled).toBe(false);
        expect(st.records).toBe(0);
        expect(w.kept.size).toBe(0);
    });
});

describe("sources", () => {
    it("indexes every account's messages and email through their parent kinds", () => {
        expect(sources.find("messages").kind).toBe("com.palm.message:1");
        expect(sources.find("email").kind).toBe("com.palm.email:1");
        expect(sources.normAddr("+1 (303) 555-0135")).toBe("3035550135");
        expect(sources.normAddr("Sam@Example.com")).toBe("sam@example.com");
        expect(sources.dayWords(new Date(2026, 9, 9, 14).getTime())).toBe("Friday 9 October 2026");
    });
    // Memos keeps a memo's text as the HTML it shows (com.palm.app.notes
    // app/models/Memo.js:25-31, app/views/GridView.js:262); text with a raw
    // "<" or ">" it shows as written (app/lib/DbApi.js:28-40).
    it("reads a memo's words as Memos shows them", async () => {
        const stored = "Fish &amp; chips &lt;2 people&gt;\nTom&#39;s &quot;special&quot;&nbsp;mix";
        const memo = { _id: "memo-fish", _kind: MEMO, text: stored, title: stored.substring(0, 50) };
        expect(await sources.documentOf("memos", memo, {})).toEqual({ title: "", text: "Fish & chips <2 people>\nTom's \"special\" mix" });
        expect((await sources.passagesOf("memos", memo, {}))[0].plain).toBe("Fish & chips <2 people> Tom's \"special\" mix");
        expect(sources.show("memos", memo, {}).title).toBe("Fish & chips <2 people>");
        // Written unescaped (an older build): as it was written.
        expect(sources.show("memos", { _id: "r", _kind: MEMO, text: "Tom & Jerry" }, {}).title).toBe("Tom & Jerry");
        expect(sources.show("memos", { _id: "r", _kind: MEMO, text: "Movie night <Friday> &amp; popcorn" }, {}).title).toBe("Movie night <Friday> &amp; popcorn");
        expect(sources.skip("memos", { _id: "e", _kind: MEMO, text: "&nbsp;" })).toBe(true);
        // Found, with its title and snippet in the words Memos shows.
        const w = world();
        w.put({ _id: "memo-fish", _kind: MEMO, text: "Dinner on Friday: fish &amp; chips &lt;2 people&gt;", modifiedTimestamp: 3 });
        await on(w);
        const r = await w.m.search({ query: "what's for dinner", sources: ["memos"] });
        expect(r.results[0]).toMatchObject({ source: "memos", id: "memo-fish", title: "Dinner on Friday: fish & chips <2 people>" });
        expect(r.results[0].snippet).not.toMatch(/&amp;|&lt;|&gt;/);
    });
});
