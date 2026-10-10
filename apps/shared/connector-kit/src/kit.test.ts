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

// ---- Sharing --------------------------------------------------------------------------------

// A board that takes posts: text (280 characters), a link, two pictures of
// 1 KB with descriptions, public or members only. The notes server keeps
// each post as a note.
const boardShare = {
    label: "Board",
    accountLabel: "@{username}",
    accepts: { text: { maxLength: 280 }, link: true as const, image: { max: 2, maxBytes: 1024, altText: { maxLength: 100 } } },
    audience: { options: [{ value: "public", label: "Everyone" }, { value: "members", label: "Members" }], default: "public" },
    send: async (ctx: any, content: any) => {
        const pictures = [];
        for (const f of content.files) pictures.push({ bytes: (await f.read()).bytes.length, alt: f.description });
        const r = await ctx.http.json({ method: "POST", url: "https://notes.example/notes", headers: { "Idempotency-Key": content.idempotencyKey },
                                        json: { title: content.audience, text: [content.text, content.url].filter(Boolean).join(" "), pictures, by: ctx.credentials.password } });
        return { id: r.id, url: "https://notes.example/notes/" + r.id };
    }
};
const boardConnector = kit.defineConnector(Object.assign({}, notesConnector, {
    service: "org.example.service.board", templateIds: ["org.example.board"],
    kinds: { state: "org.example.board.state:1", item: "org.example.board.item:1" },
    share: boardShare
}));
const PICTURE = "/media/internal/DCIM/100PHNX/dusk.jpg";
const boardFixture = Object.assign({}, notesFixture, {
    template: { templateId: "org.example.board", capabilityProviders: [{ id: "org.example.notes.memos", capability: "MEMOS" }] },
    share: { content: { text: "Hello, board", url: "https://example.org/", files: [{ path: PICTURE, mimeType: "image/jpeg", description: "Dusk" }] },
             audience: "members" },
    files: { [PICTURE]: { bytes: new Uint8Array(200), mimeType: "image/jpeg" } }
});

describe("conformance: a connector that shares", () => {
    const checks = conformanceChecks(boardConnector, boardFixture);
    it("has the three share checks", () => {
        expect(checks.map((c) => c.name).filter((n) => /^share/.test(n))).toHaveLength(3);
    });
    for (const check of checks) it(check.name, () => check.run());
    it("a fixture without a share fails the share checks", async () => {
        const results = await runConformance(boardConnector, Object.assign({}, boardFixture, { share: undefined }));
        expect(results.filter((r) => !r.ok).map((r) => r.name)).toEqual(results.filter((r) => /^share/.test(r.name)).map((r) => r.name));
    });
});

describe("sharing (share.ts and the share method)", () => {
    it("the declaration makes the appinfo.json share target", () => {
        expect(kit.shareTarget(boardConnector, "Board app")).toEqual({
            types: ["text/plain", "text/uri-list", "image/*"], label: "Board",
            connector: { templateId: "org.example.board", service: "org.example.service.board", accountLabel: "@{username}",
                         accepts: { text: { maxLength: 280 }, link: true, image: { max: 2, maxBytes: 1024, altText: { maxLength: 100 } } },
                         audience: { options: [{ value: "public", label: "Everyone" }, { value: "members", label: "Members" }], default: "public" } }
        });
        expect(kit.shareTypes({ video: { mimeTypes: ["video/mp4"] }, file: true })).toEqual(["video/mp4", "*/*"]);
        expect(kit.shareTarget(notesConnector, "Notes")).toBeNull();
        expect(kit.accountLabel("@{username}", { username: "me@example.social" })).toBe("@me@example.social");
    });

    it("defineConnector refuses a share with mistakes", () => {
        const bad = (share: any, more?: any) => () => kit.defineConnector(Object.assign({}, boardConnector, { share }, more || {}));
        expect(bad({ accepts: { text: true } })).toThrow(/share\.send: a function/);
        expect(bad({ accepts: {}, send: async () => ({}) })).toThrow(/share\.accepts: what it takes/);
        expect(bad({ accepts: { poll: true }, send: async () => ({}) })).toThrow(/share\.accepts\.poll: not one of/);
        expect(bad({ accepts: { image: { max: 1.5 } }, send: async () => ({}) })).toThrow(/share\.accepts\.image\.max: a whole number/);
        expect(bad({ accepts: { text: { mimeTypes: ["text/plain"] } }, send: async () => ({}) })).toThrow(/mimeTypes: only for image, video and file/);
        expect(bad({ accepts: { text: true }, audience: { options: [{ value: "a", label: "A" }], default: "b" }, send: async () => ({}) }))
            .toThrow(/share\.audience\.default/);
        expect(bad(boardShare, { methods: { share: async () => ({}) } })).toThrow(/methods\.share: the kit makes this one/);
    });

    async function board() {
        const memdb = await import("@phoenix/synckit/src/test/memdb.js");
        const db = memdb.createMemDb({ "com.palm.note.example:1": "com.palm.note:1" });
        const server = notesServer();
        const accounts = {
            a1: { _id: "a1", templateId: "org.example.board", username: "anna", capabilityProviders: [] },
            a2: { _id: "a2", templateId: "org.example.board", username: "ben", capabilityProviders: [] },
            n1: { _id: "n1", templateId: "org.example.notes", username: "nora", capabilityProviders: [] }
        };
        const credentials = { a1: { common: { password: "anna-secret" } }, a2: { common: { password: "ben-secret" } }, n1: { common: {} } };
        const read: string[] = [];
        const files: Record<string, number> = { [PICTURE]: 200, "/media/internal/big.png": 4096, "/media/internal/private.jpg": 10 };
        const bus = memdb.createFakeBus({ db, accounts, credentials });
        const m = kit.createConnectorService(boardConnector, { luna: bus, request: server.request as any, periodicSync: false, sleep: async () => {},
            readFile: async (p: string) => { read.push(p); return { bytes: new Uint8Array(files[p]), mimeType: "image/jpeg" }; } });
        return { m, server, read };
    }

    it("posts as the account chosen, with its credentials, and keeps descriptions within the declaration", async () => {
        const { m, server, read } = await board();
        const r = await m.share({ accountId: "a2", content: { text: "Hi", url: "https://example.org/", files: [{ path: PICTURE, description: " Dusk " }] },
                                  audience: "members", idempotencyKey: "k1" });
        expect(r).toMatchObject({ returnValue: true, posted: { id: expect.any(String), url: expect.stringMatching(/^https:\/\/notes\.example\/notes\//) } });
        const post = Object.values(server.notes).find((n: any) => n.text === "Hi https://example.org/") as any;
        expect(post).toMatchObject({ title: "members", by: "ben-secret", pictures: [{ bytes: 200, alt: "Dusk" }] });
        expect(read).toEqual([PICTURE]);
        // The audience's default; the account of another template is not this connector's.
        await m.share({ accountId: "a1", content: { text: "Default audience" } });
        expect(Object.values(server.notes).find((n: any) => n.text === "Default audience")).toMatchObject({ title: "public", by: "anna-secret" });
        expect(await m.share({ accountId: "n1", content: { text: "x" } })).toMatchObject({ returnValue: false, errorCode: "ACCOUNT_NOT_FOUND" });
        expect(await m.share({ content: { text: "x" } })).toMatchObject({ returnValue: false, errorCode: "400_BAD_REQUEST" });
    });

    it("refuses what the declaration does not take before the server sees it", async () => {
        const { m, server } = await board();
        const before = server.requests();
        const refused = async (p: any) => (await m.share(Object.assign({ accountId: "a1" }, p))).errorCode;
        expect(await refused({ content: { text: "x".repeat(281) } })).toBe("SHARE_TOO_LONG");
        expect(await refused({ content: { files: [1, 2, 3].map((i) => ({ path: "/media/internal/" + i + ".jpg" })) } })).toBe("SHARE_TOO_MANY");
        expect(await refused({ content: { files: [{ path: "/media/internal/clip.mp4" }] } })).toBe("SHARE_NOT_ACCEPTED");
        expect(await refused({ content: { files: [{ path: PICTURE, description: "x".repeat(101) }] } })).toBe("SHARE_TOO_LONG");
        expect(await refused({ content: {} })).toBe("SHARE_NOTHING");
        expect(await refused({ content: { text: "x" }, audience: "friends" })).toBe("SHARE_BAD_AUDIENCE");
        // Too large shows only when the file is read: nothing posted.
        const big = await m.share({ accountId: "a1", content: { files: [{ path: "/media/internal/big.png" }] } });
        expect(big).toMatchObject({ returnValue: false, errorCode: "SHARE_TOO_LARGE", retryable: false });
        expect(server.requests()).toBe(before);
    });

    it("send reads only the files of the share", async () => {
        const sneaky = kit.defineConnector(Object.assign({}, boardConnector, { share: Object.assign({}, boardShare, {
            send: async (ctx: any) => { await ctx.readFile("/media/internal/private.jpg"); return {}; } }) }));
        const memdb = await import("@phoenix/synckit/src/test/memdb.js");
        const read: string[] = [];
        const bus = memdb.createFakeBus({ db: memdb.createMemDb({}), accounts: { a1: { _id: "a1", templateId: "org.example.board", capabilityProviders: [] } },
                                          credentials: { a1: { common: {} } } });
        const m = kit.createConnectorService(sneaky, { luna: bus, request: notesServer().request as any, periodicSync: false,
            readFile: async (p: string) => { read.push(p); return { bytes: new Uint8Array(1), mimeType: "image/jpeg" }; } });
        const r = await m.share({ accountId: "a1", content: { files: [{ path: PICTURE }] } });
        expect(r).toMatchObject({ returnValue: false, errorCode: "PERMISSION_DENIED" });
        expect(read).toEqual([]);
    });

    it("a link goes into the text for a service that takes text but no links", () => {
        const s = Object.assign({}, boardShare, { accepts: { text: { maxLength: 280 } } });
        expect(kit.checkShare(s as any, { content: { text: "Look", url: "https://example.org/" } })).toMatchObject({ text: "Look\n\nhttps://example.org/", url: "" });
        expect(() => kit.checkShare(Object.assign({}, s, { accepts: { image: true } }) as any, { content: { url: "https://example.org/" } }))
            .toThrow(/does not take links/);
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

    it("new --share writes the declaration, the compose page and the share target; pack keeps appinfo.json in step", async () => {
        const dir = mkdtempSync(join(tmpdir(), "connector-"));
        const out: string[] = [];
        const io = { log: (s: string) => out.push(s), err: (s: string) => out.push(s) };
        const w = join(dir, "w");
        try {
            expect(await main(["new", "org.example.wall", "--share", "--dir", w], io)).toBe(0);
            const info = () => JSON.parse(readFileSync(join(w, "appinfo.json"), "utf8"));
            expect(info().phoenix.shareTargets).toEqual([expect.objectContaining({ types: ["text/plain", "text/uri-list", "image/*"], label: "wall",
                connector: expect.objectContaining({ templateId: "org.example.wall", service: "org.example.service.wall" }) })]);
            expect(info().requiredPermissions).toContain("wall.share");
            expect(readFileSync(join(w, "index.html"), "utf8")).toMatch(/share\/compose\.js/);
            expect(readFileSync(join(w, "share", "compose.js"), "utf8")).toMatch(/\/share", \{ accountId/);
            expect(await main(["validate", w], io)).toBe(0);
            // The definition changes: validate says appinfo.json is behind; pack writes it.
            const connectorJs = join(w, "service", "connector.js");
            writeFileSync(connectorJs, readFileSync(connectorJs, "utf8").replace("maxLength: 500", "maxLength: 300"));
            out.length = 0;
            expect(await main(["validate", w], io)).toBe(1);
            expect(out.join("\n")).toMatch(/C14 appinfo\.json: shareTargets is not what the definition's share says/);
            const r = pack(w, dir, { vendor: false });
            expect(r.written).toEqual(["appinfo.json"]);
            expect(info().phoenix.shareTargets[0].connector.accepts.text).toEqual({ maxLength: 300 });
            expect(await main(["validate", w], io)).toBe(0);
            // A share target written by hand is refused.
            const hand = info();
            hand.phoenix.shareTargets = [{ types: ["image/*"], label: "Wall" }];
            writeFileSync(join(w, "appinfo.json"), JSON.stringify(hand));
            expect(checkConnector(readFolder(w)).errors.some((e) => /^C14 .*not by hand/.test(e))).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("signUp: checked by defineConnector, written into the template by pack, compared by validate", async () => {
        expect(() => kit.defineConnector(Object.assign({}, notesConnector, { signUp: "http://example.com/join" }))).toThrow(/signUp\.url: an https:\/\/ address/);
        expect(() => kit.defineConnector(Object.assign({}, notesConnector, { signUp: { servers: [{ name: "", url: "https://a.example/" }] } })))
            .toThrow(/signUp\.servers\[0\]/);
        expect(kit.templateSignUp("https://example.com/join")).toEqual({ url: "https://example.com/join" });
        const dir = mkdtempSync(join(tmpdir(), "connector-"));
        const out: string[] = [];
        const io = { log: (s: string) => out.push(s), err: (s: string) => out.push(s) };
        const w = join(dir, "w");
        try {
            expect(await main(["new", "org.example.club", "--dir", w], io)).toBe(0);
            const connectorJs = join(w, "service", "connector.js");
            writeFileSync(connectorJs, readFileSync(connectorJs, "utf8").replace("// signUp: \"https://example.com/join\",",
                "signUp: { url: \"https://club.example/join\", servers: [{ name: \"Club One\", url: \"https://one.club.example/signup\" }] },"));
            expect(await main(["validate", w], io)).toBe(1);
            expect(out.join("\n")).toMatch(/C16 public\/accounts\/org\.example\.club\/org\.example\.club\.json: signUp is not what the definition's signUp says/);
            const r = pack(w, dir, { vendor: false });
            expect(r.written).toEqual(["public/accounts/org.example.club/org.example.club.json"]);
            const tpl = JSON.parse(readFileSync(join(w, "public/accounts/org.example.club/org.example.club.json"), "utf8"));
            expect(tpl.signUp).toEqual({ url: "https://club.example/join", servers: [{ name: "Club One", url: "https://one.club.example/signup" }] });
            expect(await main(["validate", w], io)).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("the share examples: the Fediverse's appinfo.json is its definition's; the FEEDS example shares nothing", async () => {
        const { fromDefinition } = await import("./tools/package");
        const fedi = fromDefinition(join(REPO, "apps", "fediverse"));
        expect(fedi && fedi.sharing).toBe(true);
        expect(fedi && fedi.changed, "apps/fediverse's appinfo.json or template is not what its definition says: run phoenix-connector pack").toEqual([]);
        const f = fromDefinition(FEEDS);
        expect(f && !f.sharing && !f.changed.length).toBe(true);
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
