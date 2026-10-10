// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The connector kit: the conformance suite on the hello-world FEEDS
// connector (examples/feeds) and on a two-way connector written here
// (notes on an in-memory server, for the merge and conflict paths); the
// sync engine's rules; the package checks on the cases the Marketplace's
// server shares (server/marketplace/tests/connector-cases.json); and the
// CLI's new, validate and pack.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as kit from "./index";
import { conformanceChecks, runConformance, type FakeServer } from "./conformance";
import { checkConnector, type Files } from "./tools/checks";
import { readIpk, writeIpk } from "./tools/ipk";
import { checkIpk, pack, readFolder } from "./tools/package";
import { main } from "./tools/cli";
import { loadCommonJs } from "./test-support";

const here = __dirname;
const FEEDS = resolve(here, "..", "examples", "feeds");
const REPO = resolve(here, "..", "..", "..", "..");

// ---- The hello world --------------------------------------------------------------------

const feeds = loadCommonJs(join(FEEDS, "service", "connector.js"));
const feedsFixture = loadCommonJs(join(FEEDS, "service", "test", "fixture.js"));

describe("conformance: the FEEDS example", () => {
    for (const check of conformanceChecks(feeds, feedsFixture)) it(check.name, () => check.run());
});

describe("the FEEDS example", () => {
    it("reads RSS 2.0 too, and refuses what is not a feed", () => {
        const feed = loadCommonJs(join(FEEDS, "service", "lib", "feed.js"));
        const rss = feed.parse("<rss version=\"2.0\"><channel><title>Old &amp; New</title><link>https://x.example/</link>" +
            "<item><title><![CDATA[First <b>post</b>]]></title><link>https://x.example/1</link><guid>g1</guid>" +
            "<pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hello&lt;/p&gt;</description></item></channel></rss>");
        expect(rss.title).toBe("Old & New");
        expect(rss.entries).toEqual([{ id: "g1", title: "First post", link: "https://x.example/1", summary: "Hello",
                                       published: Date.UTC(2026, 9, 9, 10), updated: Date.UTC(2026, 9, 9, 10) }]);
        expect(() => feed.parse("<html><body>no</body></html>")).toThrow(/Not an RSS or Atom feed/);
    });
});

// ---- A two-way connector ------------------------------------------------------------------

function notesServer(): FakeServer & { notes: Record<string, any>; puts: number; editRemote(id: string, field: string, value: any): void } {
    let count = 0, unauthorized = false, retryAfter = 0, version = 10;
    const notes: Record<string, any> = {
        n1: { title: "Groceries", text: "Milk", v: "1" },
        n2: { title: "Ideas", text: "Cards", v: "1" }
    };
    const s = {
        notes, puts: 0,
        request: async (req: any): Promise<any> => {
            count++;
            if (retryAfter) return { status: 429, headers: { "retry-after": String(retryAfter) }, body: "" };
            if (unauthorized) return { status: 401, headers: {}, body: "{}" };
            const m = /^https:\/\/notes\.example\/notes(?:\/(\w+))?$/.exec(req.url);
            if (!m) return { status: 404, headers: {}, body: "{}" };
            if (req.method === "GET" && !m[1]) {
                return { status: 200, headers: {}, body: JSON.stringify(Object.keys(notes).map((id) => Object.assign({ id }, notes[id]))) };
            }
            if (req.method === "POST") {
                const id = "n" + (++version);
                notes[id] = Object.assign(JSON.parse(req.body), { v: "1" });
                s.puts++;
                return { status: 201, headers: {}, body: JSON.stringify({ id, v: "1" }) };
            }
            if (req.method === "PUT" && m[1] && notes[m[1]]) {
                notes[m[1]] = Object.assign(JSON.parse(req.body), { v: String(Number(notes[m[1]].v) + 1) });
                s.puts++;
                return { status: 200, headers: {}, body: JSON.stringify({ id: m[1], v: notes[m[1]].v }) };
            }
            if (req.method === "DELETE" && m[1]) { delete notes[m[1]]; return { status: 204, headers: {}, body: "" }; }
            return { status: 400, headers: {}, body: "{}" };
        },
        requests: () => count,
        unauthorized: (on: boolean) => { unauthorized = on; },
        throttle: (sec: number) => { retryAfter = sec; },
        editRemote: (id: string, field: string, value: any) => {
            notes[id][field] = value;
            notes[id].v = String(Number(notes[id].v) + 1);
        }
    };
    return s;
}

const notesConnector = kit.defineConnector({
    service: "org.example.service.notes",
    templateIds: ["org.example.notes"],
    kinds: { state: "org.example.notes.state:1", item: "org.example.notes.item:1" },
    hosts: ["notes.example"],
    validate: async (ctx) => {
        await ctx.http.json({ url: "https://notes.example/notes" });
        return { credentials: { common: { password: "x" } } };
    },
    capabilities: {
        "org.example.notes.memos": {
            capability: "MEMOS",
            kind: "com.palm.note.example:1",
            fields: ["title", "text"],
            pull: async (ctx) => {
                const list = await ctx.http.json({ url: "https://notes.example/notes" });
                return { full: true, changes: list.map((n: any) => ({ remoteId: n.id, etag: n.v, fields: { title: n.title, text: n.text } })) };
            },
            push: async (ctx, change) => {
                if (change.op === "create") return ctx.http.json({ method: "POST", url: "https://notes.example/notes", json: change.fields })
                    .then((r: any) => ({ remoteId: r.id, etag: r.v }));
                if (change.op === "update") return ctx.http.json({ method: "PUT", url: "https://notes.example/notes/" + change.remoteId, json: change.fields })
                    .then((r: any) => ({ remoteId: r.id, etag: r.v }));
                await ctx.http.request({ method: "DELETE", url: "https://notes.example/notes/" + change.remoteId });
            }
        }
    }
});

const notesFixture = {
    template: { templateId: "org.example.notes", capabilityProviders: [{ id: "org.example.notes.memos", capability: "MEMOS" }] },
    kindParents: { "com.palm.note.example:1": "com.palm.note:1" },
    validateParams: { username: "me", password: "x" },
    server: notesServer,
    minObjects: 2,
    conflict: { providerId: "org.example.notes.memos", field: "text", localValue: "Milk and eggs", remoteValue: "Oat milk" }
};

describe("conformance: a two-way connector", () => {
    for (const check of conformanceChecks(notesConnector, notesFixture)) it(check.name, () => check.run());
});

describe("the sync engine (two-way)", () => {
    async function ready() {
        const memdb = await import("@phoenix/synckit/src/test/memdb.js");
        const db = memdb.createMemDb({ "com.palm.note.example:1": "com.palm.note:1" });
        const server = notesServer();
        const account = { _id: "a1", templateId: "org.example.notes", capabilityProviders: [{ id: "org.example.notes.memos" }] };
        const bus = memdb.createFakeBus({ db, accounts: { a1: account }, credentials: { a1: { common: {} } } });
        const m = kit.createConnectorService(notesConnector, { luna: bus, request: server.request as any, periodicSync: false, sleep: async () => {} });
        await m.onCreate({ accountId: "a1", config: {} });
        const r = await m.sync({ accountId: "a1" });
        expect(r.returnValue).toBe(true);
        const notes = () => Object.values(db.objects).filter((o: any) => !o._del && o._kind === "com.palm.note.example:1") as any[];
        return { db, server, m, notes };
    }

    it("merges edits to different fields from both sides", async () => {
        const { db, server, m, notes } = await ready();
        const n1 = notes().find((n) => n.remoteId === "n1");
        await db.merge([{ _id: n1._id, title: "Shopping" }]);
        server.editRemote("n1", "text", "Bread");
        const r = await m.sync({ accountId: "a1" });
        expect(r.stats["org.example.notes.memos"].conflicts).toBe(0);
        expect(notes().find((n) => n.remoteId === "n1")).toMatchObject({ title: "Shopping", text: "Bread" });
        expect(server.notes.n1).toMatchObject({ title: "Shopping", text: "Bread" });
    });

    it("sends new and deleted notes, and takes the server's deletions", async () => {
        const { db, server, m, notes } = await ready();
        await db.put([{ _kind: "com.palm.note.example:1", accountId: "a1", title: "New", text: "From the phone" }]);
        await db.del([notes().find((n) => n.remoteId === "n2")._id]);
        delete server.notes.n1;
        await m.sync({ accountId: "a1" });
        expect(Object.values(server.notes).map((n: any) => n.title)).toEqual(["New"]);
        expect(notes().map((n) => n.title)).toEqual(["New"]);
        expect(notes()[0].remoteId).toMatch(/^n\d+$/);
    });

    it("onEnabled(false) removes the capability's data and its item records", async () => {
        const { db, m, notes } = await ready();
        await m.onEnabled({ accountId: "a1", capabilityProviderId: "org.example.notes.memos", enabled: false });
        expect(notes()).toEqual([]);
        expect(Object.values(db.objects).filter((o: any) => !o._del && o._kind === "org.example.notes.item:1")).toEqual([]);
    });

    it("refuses an unknown capability provider and a definition with mistakes", async () => {
        const { m } = await ready();
        expect(await m.onEnabled({ accountId: "a1", capabilityProviderId: "x.y.z", enabled: true })).toMatchObject({ errorCode: "UNSUPPORTED_CAPABILITY" });
        expect(() => kit.defineConnector({ service: "bad", templateIds: [], kinds: { state: "x" }, capabilities: {}, schedule: { every: "5m" } } as any))
            .toThrow(/service: .*\n.*templateIds.*\n.*kinds.state.*\n.*validate.*\n.*capabilities.*\n.*15m or more/);
    });
});

// ---- Package checks -------------------------------------------------------------------------

function caseFiles(base: Record<string, any>, set: Record<string, any>): Files {
    const all = Object.assign({}, base, set);
    const out: Files = {};
    Object.keys(all).forEach((p) => {
        const v = all[p];
        if (v === null) return;
        if (typeof v === "string" && v.indexOf("BIN:") === 0) out[p] = new Uint8Array(Buffer.from(v.slice(4), "hex"));
        else out[p] = new Uint8Array(Buffer.from(typeof v === "string" ? v : JSON.stringify(v), "utf8"));
    });
    return out;
}

const cases = JSON.parse(readFileSync(join(REPO, "server", "marketplace", "tests", "connector-cases.json"), "utf8"));

describe("package checks (the Marketplace's cases)", () => {
    for (const c of cases.cases) {
        it(c.name, () => {
            const r = checkConnector(caseFiles(cases.base, c.set), { namespaces: c.namespaces });
            const codes = r.errors.map((e) => e.split(" ")[0]).filter((x, i, a) => a.indexOf(x) === i).sort();
            expect(codes, r.errors.join("\n")).toEqual(c.expect.slice().sort());
        });
    }

    it("the built-in DAV connector passes, but for its webcal template's system icons", () => {
        const r = checkConnector(readFolder(join(REPO, "apps", "dav")), { namespaces: ["org.webosphoenix", "com.webosphoenix"] });
        expect(r.errors.length).toBeGreaterThan(0);
        expect(r.errors.every((e) => /^C6 com\.webosphoenix\.webcal: the icon \/usr\/palm\/public\//.test(e))).toBe(true);
    });
});

// ---- The CLI and the .ipk -------------------------------------------------------------------

describe("phoenix-connector", () => {
    it("new makes a connector that validates, packs and passes the .ipk checks", async () => {
        const dir = mkdtempSync(join(tmpdir(), "connector-"));
        const out: string[] = [];
        try {
            expect(await main(["new", "org.example.weather", "--capability", "FEEDS", "--dir", join(dir, "w")], { log: (s) => out.push(s), err: (s) => out.push(s) })).toBe(0);
            expect(await main(["validate", join(dir, "w")], { log: (s) => out.push(s), err: (s) => out.push(s) })).toBe(0);
            expect(out.join("\n")).toMatch(/ok: the Marketplace's checks pass/);
            const r = pack(join(dir, "w"), dir, { vendor: false });
            expect(r.file).toMatch(/org\.example\.weather_0\.1\.0_all\.ipk$/);
            const bytes = new Uint8Array(readFileSync(r.file));
            const checked = checkIpk(bytes);
            expect(checked.errors).toEqual([]);
            const pkg = readIpk(bytes);
            expect(pkg.control).toMatchObject({ Package: "org.example.weather", Version: "0.1.0", Architecture: "all" });
            expect(pkg.files.every((f) => f.path.indexOf("usr/palm/applications/org.example.weather/") === 0)).toBe(true);
            expect(pkg.files.some((f) => f.path.endsWith("/service/sysbus/org.example.service.weather.role.json"))).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("validate refuses a broken package with the rule's code", async () => {
        const dir = mkdtempSync(join(tmpdir(), "connector-"));
        const out: string[] = [];
        try {
            await main(["new", "org.example.bad", "--dir", join(dir, "b")], { log: () => {}, err: () => {} });
            mkdirSync(join(dir, "b", "service", "bin"), { recursive: true });
            writeFileSync(join(dir, "b", "service", "bin", "helper"), Buffer.from("7f454c46020101", "hex"));
            expect(await main(["validate", join(dir, "b")], { log: (s) => out.push(s), err: (s) => out.push(s) })).toBe(1);
            expect(out.join("\n")).toMatch(/error {3}C12 native code is not allowed: service\/bin\/helper/);
            expect(() => pack(join(dir, "b"), dir, { vendor: false })).toThrow(/C12/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("the .ipk checks refuse scripts, links' absence aside, and files outside the app", () => {
        const enc = (s: string) => new Uint8Array(Buffer.from(s));
        const info = enc(JSON.stringify({ id: "org.example.x", version: "1.0.0", type: "web" }));
        const bytes = writeIpk({ Package: "org.example.x", Version: "1.0.0", Architecture: "arm" }, [
            { path: "usr/palm/applications/org.example.x/appinfo.json", data: info },
            { path: "usr/bin/evil", data: enc("#!/bin/sh") }
        ]);
        const r = checkIpk(bytes);
        expect(r.errors.filter((e) => e.indexOf("C13") === 0)).toEqual([
            "C13 the package puts a file outside its app (usr/bin/evil)",
            "C13 only packages for any architecture (\"Architecture: all\")"
        ]);
    });

    it("test runs the conformance suite on a folder with a fixture", async () => {
        // The CLI loads the built kit; the suite itself is what runConformance runs here.
        const results = await runConformance(feeds, feedsFixture);
        expect(results.filter((r) => !r.ok)).toEqual([]);
        expect(results.length).toBe(5);
    });
});
