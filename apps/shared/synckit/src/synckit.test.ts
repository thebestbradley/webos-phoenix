// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shared sync layer's own pieces (the DAV transport's tests cover the
// rest through apps/dav): the HTTP client's host allow-list, Retry-After
// backoff and retries; the three-way merge; item records; the scheduler's
// interval rule; sync state records.

import { describe, expect, it } from "vitest";
import * as synckit from "@phoenix/synckit";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";

type Res = { status: number; headers: Record<string, string>; body: string };

function server(answers: Res[]) {
    const seen: string[] = [];
    return {
        seen,
        request: async (req: { url: string }) => {
            seen.push(req.url);
            return answers.length > 1 ? answers.shift() as Res : answers[0];
        }
    };
}

describe("http", () => {
    it("refuses hosts outside the allow-list, and allows one added later", async () => {
        const s = server([{ status: 200, headers: {}, body: "{}" }]);
        const http = synckit.createHttp({ request: s.request, hosts: ["*.example.social"] });
        await expect(http.request({ url: "https://evil.example/x" })).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
        await expect(http.request({ url: "https://a.example.social/x" })).resolves.toMatchObject({ status: 200 });
        http.allowHost("evil.example");
        await expect(http.request({ url: "https://evil.example/x" })).resolves.toMatchObject({ status: 200 });
        expect(s.seen).toEqual(["https://a.example.social/x", "https://evil.example/x"]);
    });

    it("waits out a short Retry-After and tries again", async () => {
        let clock = 1000;
        const s = server([{ status: 429, headers: { "retry-after": "5" }, body: "" }, { status: 200, headers: {}, body: "{\"ok\":1}" }]);
        const http = synckit.createHttp({ request: s.request, now: () => clock, sleep: async (ms) => { clock += ms; } });
        await expect(http.json({ url: "https://a.example/x" })).resolves.toEqual({ ok: 1 });
        expect(clock).toBe(6000);
        expect(s.seen.length).toBe(2);
    });

    it("stops at a long Retry-After and sends nothing before then", async () => {
        let clock = Date.UTC(2026, 9, 10);
        const s = server([{ status: 429, headers: { "retry-after": "3600" }, body: "" }]);
        const backoff = { retryAt: 0 };
        const http = synckit.createHttp({ request: s.request, now: () => clock, backoff, sleep: async () => {} });
        const e = await http.request({ url: "https://a.example/x" }).catch((x) => x);
        expect(e.errorCode).toBe("503_SERVICE_UNAVAILABLE");
        expect(e.retryAt).toBe(clock + 3600 * 1000);
        expect(backoff.retryAt).toBe(e.retryAt);
        clock += 60 * 1000;
        await expect(http.request({ url: "https://a.example/x" })).rejects.toMatchObject({ retryAt: e.retryAt });
        expect(s.seen.length).toBe(1);
        expect(synckit.errorCodeOf(e)).toBe("503_SERVICE_UNAVAILABLE");
    });

    it("reads Retry-After as an HTTP date too", () => {
        const now = Date.UTC(2026, 9, 10, 12, 0, 0);
        expect(synckit.retryAfterMs("Sat, 10 Oct 2026 12:01:00 GMT", now)).toBe(60000);
        expect(synckit.retryAfterMs("120", now)).toBe(120000);
        expect(synckit.retryAfterMs("soon", now)).toBeNull();
    });

    it("retries a 502 and a reset connection, then gives up", async () => {
        const s = server([{ status: 502, headers: {}, body: "" }, { status: 200, headers: {}, body: "" }]);
        const http = synckit.createHttp({ request: s.request, sleep: async () => {} });
        await expect(http.request({ url: "https://a.example/x" })).resolves.toMatchObject({ status: 200 });
        let n = 0;
        const flaky = synckit.createHttp({ request: async () => { n++; throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); },
                                           sleep: async () => {}, retries: 2 });
        await expect(flaky.request({ url: "https://a.example/x" })).rejects.toMatchObject({ code: "ECONNRESET" });
        expect(n).toBe(3);
    });

    it("json(): errors carry the status and 401 the accounts code", async () => {
        const s = server([{ status: 401, headers: {}, body: "{\"error\":\"The access token is invalid\"}" }]);
        const http = synckit.createHttp({ request: s.request });
        const e = await http.json({ url: "https://a.example/api" }).catch((x) => x);
        expect(e.status).toBe(401);
        expect(synckit.errorCodeOf(e)).toBe("401_UNAUTHORIZED");
        expect(e.message).toMatch(/access token is invalid/);
    });

    it("linkNext() follows Mastodon's Link header", () => {
        expect(synckit.linkNext("<https://a.example/api/v1/x?max_id=7>; rel=\"next\", <https://a.example/api/v1/x?min_id=9>; rel=\"prev\""))
            .toBe("https://a.example/api/v1/x?max_id=7");
        expect(synckit.linkNext("")).toBeNull();
    });
});

describe("merge3", () => {
    const fields = ["name", "phone", "note"];
    it("takes each side's own changes", () => {
        const r = synckit.merge3({ name: "Ada", phone: "1", note: "" }, { name: "Ada", phone: "2", note: "" },
                                 { name: "Ada P.", phone: "1", note: "" }, fields);
        expect(r.merged).toEqual({ name: "Ada P.", phone: "2", note: "" });
        expect(r.conflicts).toEqual([]);
        expect(r.toLocal && r.toRemote).toBe(true);
    });
    it("a field changed on both sides: the server's by default, the loser recorded", () => {
        const r = synckit.merge3({ phone: "1" }, { phone: "2" }, { phone: "3" }, ["phone"]);
        expect(r.merged.phone).toBe("3");
        expect(r.conflicts).toEqual([{ field: "phone", local: "2", remote: "3", kept: "remote" }]);
        expect(synckit.merge3({ phone: "1" }, { phone: "2" }, { phone: "3" }, ["phone"], { winner: "local" }).merged.phone).toBe("2");
    });
    it("absent, null and empty are the same", () => {
        expect(synckit.merge3({ note: "" }, { note: null }, {}, ["note"]).conflicts).toEqual([]);
        expect(synckit.sameValue({ a: 1, b: [] }, { a: 1 })).toBe(true);
    });
});

describe("items, sync state, schedule", () => {
    it("keeps item records per account and capability", async () => {
        const db = memdb.createMemDb();
        const items = synckit.createItemStore({ db, kind: "org.example.item:1", accountId: "a1" });
        await items.save({ capability: "c1", remoteId: "r1", etag: "1" });
        await items.save({ capability: "c2", remoteId: "r2", etag: "1" });
        expect(Object.keys(await items.byRemoteId("c1"))).toEqual(["r1"]);
        await items.removeAll("c1");
        expect((await items.all()).map((i) => i.remoteId)).toEqual(["r2"]);
    });
    it("writes one sync state per account and provider, with the error's code", async () => {
        const tempdb = memdb.createMemDb();
        await synckit.setSyncState(tempdb, "a1", "p1", "INCREMENTAL_SYNC");
        await synckit.setSyncState(tempdb, "a1", "p1", "ERROR", Object.assign(new Error("no"), { status: 401 }));
        const all = await synckit.syncstate.getSyncStates(tempdb, "a1");
        expect(all.map((s) => [s.syncState, s.errorCode])).toEqual([["ERROR", "401_UNAUTHORIZED"]]);
    });
    it("refuses a periodic sync shorter than 15 minutes", async () => {
        const calls: string[] = [];
        const s = synckit.createScheduler({ call: async (uri) => { calls.push(uri); return { returnValue: true }; }, service: "org.example.service.x" });
        await expect(s.schedule("a1", { every: "5m" })).rejects.toThrow(/15m or more/);
        await s.schedule("a1", { every: "15m" });
        expect(calls).toEqual(["luna://com.palm.activitymanager/create"]);
        expect(synckit.intervalSeconds("1h")).toBe(3600);
    });
    it("runs one job at a time per key", async () => {
        const run = synckit.createSerializer();
        let n = 0;
        const slow = () => new Promise<number>((r) => setTimeout(() => r(++n), 10));
        const [a, b] = await Promise.all([run("k", slow), run("k", slow)]);
        expect([a, b]).toEqual([1, 1]);
        expect(await run("k", slow)).toBe(2);
    });
});

describe("linker", () => {
    // As the contacts framework makes the key (SortKey.js:313-372), so the
    // list's divider is the first letter.
    const key = (name: { givenName?: string; familyName?: string }, extra: Record<string, unknown> = {}) =>
        synckit.linker.buildPerson(null, [{ _id: "c1", name, ...extra }]).sortKey;
    it("makes the sortKey as Contacts does: last name first, a single name alone, others last", () => {
        expect(key({ givenName: "Ada", familyName: "Palmer" })).toBe("palmer\tada");
        expect(key({ givenName: "theo" })).toBe("theo");
        expect(key({ familyName: "Okafor" })).toBe("okafor");
        expect(key({}, { nickname: "@theo@fedi.example" })).toBe("\uFAD7@theo@fedi.example");
        expect(key({})).toBe("\uFAD7\uFAD7");
    });
});
