// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The conformance suite every connector passes to be listed
// (docs/SYNERGY-CONNECTORS.md 3.3), run against the connector's own fake
// server with db8, tempdb, the accounts service and the activity manager in
// memory (@phoenix/synckit's test/memdb.js):
//
//   validate      the validator signs in and gives credentials
//   lifecycle     create -> enable -> sync -> disable -> delete leaves no
//                 data (no object of the account in any kind, no person of
//                 its contacts, no state, no sync state), and the periodic
//                 activity is 15 minutes or more, needs the internet and is
//                 cancelled
//   idempotent    a second sync with nothing changed writes nothing to db8
//   unauthorized  a 401 gives ERROR / 401_UNAUTHORIZED in the sync state
//   rate limit    a 429 with Retry-After is honoured: the sync stops, and no
//                 request reaches the server before that time
//   conflict      (two-way capabilities) a field edited on both sides keeps
//                 both edits or records the loser
//   share         (with a share declaration) the fixture's share is posted
//                 by send, as the account chosen, with that account's
//                 credentials; an account that is not there is refused
//   share limits  what the declaration does not take (too long, too many,
//                 a kind it does not take) never reaches send or the server
//   share errors  a 401 while posting gives 401_UNAUTHORIZED; a 429 gives
//                 503_SERVICE_UNAVAILABLE, retryable, with retryAt
//
//   conformanceChecks(definition, fixture) -> [{name, run()}]   for a test runner
//   runConformance(definition, fixture) -> [{name, ok, error?}]  (phoenix-connector test)
//
// The fixture is the connector's (docs/SYNERGY-SDK.md "Testing"): its
// template, what its sign-in page sends, and a fake server that can answer
// 401 and 429 on demand.

import type { DbObject, RequestFn } from "@phoenix/synckit";
import * as memdbModule from "@phoenix/synckit/src/test/memdb.js";
import { createConnectorService } from "./service";
import type { ConnectorDefinition, Environment, Json, ServiceMethods, ValidateParams } from "./types";

export interface FakeServer {
    request: RequestFn;
    /** Requests that reached the server so far. */
    requests(): number;
    /** Every request answers 401 while on. */
    unauthorized(on: boolean): void;
    /** Every request answers 429 with this Retry-After (seconds) until called with 0. */
    throttle(retryAfterSeconds: number): void;
    /** Two-way: change one field of a remote object (the conflict check). */
    editRemote?(remoteId: string, field: string, value: Json): void;
    close?(): void | Promise<void>;
}

export interface ConformanceFixture {
    /** The account template (public/accounts/<id>/<id>.json), parsed. */
    template: Json;
    /** The connector's kinds and the generic kinds they extend. */
    kindParents?: Record<string, string>;
    /** What the sign-in page sends to the validator. */
    validateParams: ValidateParams;
    server(): FakeServer | Promise<FakeServer>;
    /** More Luna methods the connector calls (the OAuth service's token, ...). */
    handlers?(server: FakeServer): Record<string, (params: Json) => Json>;
    /** The first sync writes at least this many objects (default 1). */
    minObjects?: number;
    /** Two-way: a field to edit on both sides. */
    conflict?: { providerId: string; field: string; localValue: Json; remoteValue: Json };
    /** With a share declaration: what to post ({content: {text?, url?, files?}, audience?}). */
    share?: { content: Json; audience?: string };
    /** Files the share's content names (path -> bytes and type), for ctx.readFile. */
    files?: Record<string, { bytes: Uint8Array; mimeType: string }>;
    /**
     * More of the environment the connector runs in, from its fake server:
     * sockets (net) for a connector that keeps a connection, helpers, settings.
     * The server's unauthorized() and throttle() then concern those too.
     */
    environment?(server: FakeServer): Partial<Environment>;
}

export interface ConformanceResult { name: string; ok: boolean; error?: string }

interface Setup {
    methods: ServiceMethods;
    db: Json;
    tempdb: Json;
    bus: Json;
    server: FakeServer;
    accountId: string;
    clock: { t: number };
    providers: string[];
}

function assert(cond: unknown, message: string): void {
    if (!cond) throw new Error(message);
}

function memdb(): Json {
    return memdbModule;
}

const ACCOUNT = "conformance-account-1";

async function setup(def: ConnectorDefinition, fx: ConformanceFixture, periodic: boolean): Promise<Setup> {
    const m = memdb();
    const parents = Object.assign({}, m.KIND_PARENTS, fx.kindParents || {});
    const db = m.createMemDb(parents);
    const tempdb = m.createMemDb();
    const server = await fx.server();
    const clock = { t: Date.UTC(2026, 9, 10, 12, 0, 0) };
    const providers = (fx.template.capabilityProviders || []).map((c: Json) => c.id).filter((id: string) => def.capabilities[id]);
    const account = { _id: ACCOUNT, templateId: fx.template.templateId, username: fx.validateParams.username || "user",
                      capabilityProviders: providers.map((id: string) => ({ id, capability: def.capabilities[id].capability })) };
    let methods: ServiceMethods = {};
    const handlers: Record<string, (p: Json, uri: string) => Json> = Object.assign({}, fx.handlers ? fx.handlers(server) : {});
    handlers["luna://" + def.service + "/*"] = (p: Json, uri: string) => {
        const name = uri.slice(uri.lastIndexOf("/") + 1);
        return methods[name] ? methods[name](p) : { returnValue: false, errorText: "no method " + name };
    };
    handlers["luna://com.webos.notification/createToast"] = () => ({ returnValue: true, toastId: "t" });
    handlers["luna://org.webosports.service.messaging/putMessage"] = (p: Json) => {
        const r = (db.put([Object.assign({ conversations: ["thread-" + ((p.message.from && p.message.from.addr) || "x")] }, p.message)]) as Promise<Json>);
        return r.then((x: Json) => ({ returnValue: true, threadids: ["thread-1"], id: x[0].id }));
    };
    const bus = m.createFakeBus({ db, tempdb, accounts: { [ACCOUNT]: account }, credentials: {}, handlers });
    methods = createConnectorService(def, Object.assign({}, fx.environment ? fx.environment(server) : {}, {
        luna: bus, request: server.request, log: () => {}, periodicSync: periodic, now: () => clock.t,
        sleep: async (ms: number) => { clock.t += ms; },
        readFile: async (path: string) => {
            const f = fx.files && fx.files[path];
            if (!f) throw new Error("no file " + path + " in the fixture's files");
            return f;
        }
    }));
    return { methods, db, tempdb, bus, server, accountId: ACCOUNT, clock, providers };
}

async function signIn(s: Setup, fx: ConformanceFixture): Promise<Json> {
    const r = await s.methods.checkCredentials(Object.assign({ templateId: fx.template.templateId }, fx.validateParams));
    assert(r.returnValue, "checkCredentials failed: " + (r.errorCode || "") + " " + (r.errorText || ""));
    assert(r.credentials && typeof r.credentials === "object", "checkCredentials gave no credentials");
    // What com.palm.service.accounts does with the validator's answer (handlers/create.js).
    await s.bus.call("luna://com.palm.service.accounts/writeCredentials", { accountId: s.accountId, credentials: r.credentials });
    const created = await s.methods.onCreate({ accountId: s.accountId, config: r.config || {} });
    assert(created.returnValue, "onCreate failed: " + (created.errorText || created.errorCode));
    return r;
}

async function enableAll(s: Setup): Promise<void> {
    for (const id of s.providers) {
        const r = await s.methods.onEnabled({ accountId: s.accountId, capabilityProviderId: id, enabled: true });
        assert(r.returnValue, "onEnabled(true) " + id + " failed: " + (r.errorText || r.errorCode));
    }
    // onEnabled starts a sync in the background; this one waits for it (one
    // sync at a time per account), the next one is a sync of its own.
    await s.methods.sync({ accountId: s.accountId });
    await s.methods.sync({ accountId: s.accountId });
}

async function sync(s: Setup): Promise<Json> {
    return s.methods.sync({ accountId: s.accountId });
}

function live(db: Json): DbObject[] {
    return Object.keys(db.objects).map((k) => db.objects[k]).filter((o: DbObject) => !o._del);
}

function ofAccount(db: Json, accountId: string): DbObject[] {
    return live(db).filter((o) => o.accountId === accountId);
}

function dbWrites(bus: Json, from: number): Json[] {
    return bus.calls.slice(from).filter((c: Json) => /^luna:\/\/com\.palm\.db\/(put|merge|del)$/.test(c.uri));
}

async function syncStates(tempdb: Json, accountId: string): Promise<DbObject[]> {
    return (await tempdb.find({ from: "com.palm.account.syncstate:1" })).filter((o: DbObject) => o.accountId === accountId);
}

export function conformanceChecks(def: ConnectorDefinition, fx: ConformanceFixture): { name: string; run(): Promise<void> }[] {
    const checks: { name: string; run(): Promise<void> }[] = [];
    const twoWay = Object.keys(def.capabilities).some((id) => typeof def.capabilities[id].push === "function");
    const withServer = (periodic: boolean, fn: (s: Setup) => Promise<void>) => async () => {
        const s = await setup(def, fx, periodic);
        try { await fn(s); } finally { if (s.server.close) await s.server.close(); }
    };

    checks.push({ name: "validate: the validator signs in and gives credentials", run: withServer(false, async (s) => {
        await signIn(s, fx);
    }) });

    checks.push({ name: "lifecycle: create, enable, sync, disable, delete leaves no data", run: withServer(true, async (s) => {
        await signIn(s, fx);
        await enableAll(s);
        // The periodic syncs (not the db8 watches, which have a trigger instead).
        const creates = s.bus.calls.filter((c: Json) => c.uri === "luna://com.palm.activitymanager/create" && c.params.activity.schedule);
        assert(creates.length > 0, "no periodic activity was created");
        creates.forEach((c: Json) => {
            const every = String(c.params.activity.schedule && c.params.activity.schedule.interval);
            const m = /^(\d+)([smhd])$/.exec(every);
            const secs = m ? Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]] : 0;
            assert(secs >= 900, "the periodic sync runs every " + every + ": 15 minutes or more");
            assert(c.params.activity.requirements && c.params.activity.requirements.internet, "the periodic sync must require the internet");
        });
        const written = ofAccount(s.db, s.accountId).length;
        assert(written >= (fx.minObjects === undefined ? 1 : fx.minObjects), "the first sync wrote " + written + " objects of the account");
        const personsBefore = live(s.db).filter((o) => o._kind === "com.palm.person:1").map((p) => p._id);
        for (const id of s.providers) {
            const r = await s.methods.onEnabled({ accountId: s.accountId, capabilityProviderId: id, enabled: false });
            assert(r.returnValue, "onEnabled(false) " + id + " failed: " + (r.errorText || r.errorCode));
        }
        const del = await s.methods.onDelete({ accountId: s.accountId });
        assert(del.returnValue, "onDelete failed: " + (del.errorText || del.errorCode));
        const left = ofAccount(s.db, s.accountId);
        assert(!left.length, "left behind: " + left.map((o) => o._kind).join(", "));
        const persons = live(s.db).filter((o) => o._kind === "com.palm.person:1" && personsBefore.indexOf(o._id) >= 0);
        const orphans = persons.filter((p) => !(p.contactIds || []).some((cid: string) => s.db.objects[cid] && !s.db.objects[cid]._del));
        assert(!orphans.length, orphans.length + " persons without contacts left behind");
        const states = await syncStates(s.tempdb, s.accountId);
        assert(!states.length, "sync state records left behind");
        assert(s.bus.calls.some((c: Json) => c.uri === "luna://com.palm.activitymanager/cancel"), "the periodic activity was not cancelled");
    }) });

    checks.push({ name: "idempotent: a second sync with nothing changed writes nothing", run: withServer(false, async (s) => {
        await signIn(s, fx);
        await enableAll(s);
        const first = await sync(s);
        assert(first.returnValue, "sync failed: " + (first.errorText || first.errorCode));
        const mark = s.bus.calls.length;
        const second = await sync(s);
        assert(second.returnValue, "second sync failed: " + (second.errorText || second.errorCode));
        const writes = dbWrites(s.bus, mark);
        assert(!writes.length, "the second sync wrote " + writes.length + " times: " +
               writes.map((w: Json) => w.uri.replace("luna://com.palm.db/", "") + " " +
                          JSON.stringify((w.params.objects || []).map((o: Json) => o._kind || o._id))).join("; "));
    }) });

    checks.push({ name: "unauthorized: a 401 gives ERROR / 401_UNAUTHORIZED", run: withServer(false, async (s) => {
        await signIn(s, fx);
        await enableAll(s);
        s.server.unauthorized(true);
        const r = await sync(s);
        assert(r.returnValue === false && r.errorCode === "401_UNAUTHORIZED", "sync answered " + JSON.stringify({ returnValue: r.returnValue, errorCode: r.errorCode }));
        const states = await syncStates(s.tempdb, s.accountId);
        assert(states.length > 0 && states.every((o) => o.syncState === "ERROR" && o.errorCode === "401_UNAUTHORIZED"),
               "sync states: " + JSON.stringify(states.map((o) => [o.syncState, o.errorCode])));
    }) });

    checks.push({ name: "rate limit: a 429 with Retry-After is honoured", run: withServer(false, async (s) => {
        await signIn(s, fx);
        await enableAll(s);
        s.server.throttle(600);
        const r = await sync(s);
        assert(r.returnValue === false && r.errorCode === "503_SERVICE_UNAVAILABLE", "sync answered " + JSON.stringify({ returnValue: r.returnValue, errorCode: r.errorCode }));
        assert(r.retryAt && r.retryAt >= s.clock.t + 590 * 1000, "no retryAt ten minutes on: " + r.retryAt);
        const before = s.server.requests();
        s.clock.t += 60 * 1000;
        const again = await sync(s);
        assert(s.server.requests() === before, "a sync within Retry-After reached the server");
        assert(again.skipped === "backoff", "the sync within Retry-After was not skipped");
        s.server.throttle(0);
        s.clock.t += 600 * 1000;
        const after = await sync(s);
        assert(after.returnValue, "the sync after Retry-After failed: " + (after.errorText || after.errorCode));
    }) });

    if (twoWay && fx.conflict) {
        const c = fx.conflict;
        checks.push({ name: "conflict: a field edited on both sides keeps both or records the loser", run: withServer(false, async (s) => {
            await signIn(s, fx);
            await enableAll(s);
            const kind = def.capabilities[c.providerId].kind as string;
            const obj = ofAccount(s.db, s.accountId).filter((o) => o._kind === kind)[0];
            assert(obj, "no object of " + kind + " to edit");
            await s.db.merge([{ _id: obj._id, [c.field]: c.localValue }]);
            assert(s.server.editRemote, "the fake server cannot edit a remote object (editRemote)");
            (s.server.editRemote as NonNullable<FakeServer["editRemote"]>)(obj.remoteId, c.field, c.remoteValue);
            const r = await sync(s);
            assert(r.returnValue, "sync failed: " + (r.errorText || r.errorCode));
            const now = s.db.objects[obj._id as string];
            const items = def.kinds.item ? live(s.db).filter((o) => o._kind === def.kinds.item && o.remoteId === obj.remoteId) : [];
            const recorded = items.some((it) => (it.conflicts || []).some((x: Json) => x.field === c.field &&
                JSON.stringify(x.lost) === JSON.stringify(now[c.field] === c.remoteValue ? c.localValue : c.remoteValue)));
            const both = JSON.stringify(now[c.field]).indexOf(JSON.stringify(c.localValue).replace(/^"|"$/g, "")) >= 0 &&
                         JSON.stringify(now[c.field]).indexOf(JSON.stringify(c.remoteValue).replace(/^"|"$/g, "")) >= 0;
            assert(recorded || both, "the losing edit of " + c.field + " was neither kept nor recorded");
        }) });
    }
    if (def.share) addShareChecks(def, fx, checks);
    return checks;
}

// The share checks: send is watched (which account, which credentials, how often).
function addShareChecks(def: ConnectorDefinition, fx: ConformanceFixture, checks: { name: string; run(): Promise<void> }[]): void {
    const share = def.share as NonNullable<ConnectorDefinition["share"]>;
    const sends: { accountId: string; credentials: Json; content: Json }[] = [];
    const watched: ConnectorDefinition = Object.assign({}, def, { share: Object.assign({}, share, {
        send: (ctx: Json, content: Json) => {
            sends.push({ accountId: ctx.accountId, credentials: ctx.credentials, content });
            return share.send(ctx, content);
        }
    }) });
    const withServer = (fn: (s: Setup) => Promise<void>) => async () => {
        sends.length = 0;
        assert(fx.share && fx.share.content, "the fixture has no share ({content, audience?}) to post");
        const s = await setup(watched, fx, false);
        try { await fn(s); } finally { if (s.server.close) await s.server.close(); }
    };
    const request = (accountId: string, content: Json, audience?: string) =>
        ({ accountId, content, audience: audience === undefined ? fx.share && fx.share.audience : audience, idempotencyKey: "conformance-share-1" });

    checks.push({ name: "share: posted by send as the account chosen, with its credentials", run: withServer(async (s) => {
        const signed = await signIn(s, fx);
        const r = await s.methods.share(request(s.accountId, (fx.share as Json).content));
        assert(r.returnValue, "share failed: " + (r.errorCode || "") + " " + (r.errorText || ""));
        assert(sends.length === 1, "send was called " + sends.length + " times");
        assert(sends[0].accountId === s.accountId, "send was called for " + sends[0].accountId + ", not the account chosen");
        assert(JSON.stringify(sends[0].credentials) === JSON.stringify((signed.credentials || {}).common || {}),
               "send did not get the chosen account's credentials");
        assert(r.posted && typeof r.posted === "object", "the reply has no posted: {url?, id?}");
        const other = await s.methods.share(request("conformance-no-such-account", (fx.share as Json).content));
        assert(other.returnValue === false && other.errorCode === "ACCOUNT_NOT_FOUND" && sends.length === 1,
               "a share for an account that is not there was not refused (" + other.errorCode + ")");
    }) });

    checks.push({ name: "share limits: what the declaration does not take never reaches the server", run: withServer(async (s) => {
        await signIn(s, fx);
        const before = s.server.requests();
        const tries: { content: Json; audience?: string; code: string }[] = [];
        const a = share.accepts as Json;
        if (a.text && a.text.maxLength) tries.push({ content: { text: "x".repeat(a.text.maxLength + 1) }, code: "SHARE_TOO_LONG" });
        ["image", "video", "file"].forEach((k) => {
            if (a[k] && a[k].max) {
                const type = k === "image" ? "image/png" : k === "video" ? "video/mp4" : "application/pdf";
                const files = [];
                for (let i = 0; i <= a[k].max; i++) files.push({ path: "/media/internal/conformance-" + i + "." + type.split("/")[1], mimeType: type });
                tries.push({ content: { files }, code: "SHARE_TOO_MANY" });
            }
        });
        if (!a.video && !a.file) tries.push({ content: { files: [{ path: "/media/internal/conformance.mp4", mimeType: "video/mp4" }] }, code: "SHARE_NOT_ACCEPTED" });
        if (!a.text && !a.link) tries.push({ content: { text: "Hello" }, code: "SHARE_NOT_ACCEPTED" });
        tries.push({ content: {}, code: "SHARE_NOTHING" });
        if (share.audience) tries.push({ content: (fx.share as Json).content, audience: "conformance-no-such-audience", code: "SHARE_BAD_AUDIENCE" });
        for (const t of tries) {
            const r = await s.methods.share(request(s.accountId, t.content, t.audience));
            assert(r.returnValue === false && r.errorCode === t.code, "a share that should give " + t.code + " gave " + (r.returnValue ? "success" : r.errorCode));
        }
        assert(!sends.length, "send was called for a share the declaration does not take");
        assert(s.server.requests() === before, "a refused share reached the server");
    }) });

    checks.push({ name: "share errors: a 401 is 401_UNAUTHORIZED, a 429 is retryable with retryAt", run: withServer(async (s) => {
        await signIn(s, fx);
        s.server.unauthorized(true);
        const r = await s.methods.share(request(s.accountId, (fx.share as Json).content));
        assert(r.returnValue === false && r.errorCode === "401_UNAUTHORIZED" && !r.retryable,
               "a 401 while posting answered " + JSON.stringify({ returnValue: r.returnValue, errorCode: r.errorCode, retryable: r.retryable }));
        s.server.unauthorized(false);
        s.server.throttle(600);
        const t = await s.methods.share(request(s.accountId, (fx.share as Json).content));
        assert(t.returnValue === false && t.errorCode === "503_SERVICE_UNAVAILABLE" && t.retryable && t.retryAt >= s.clock.t + 590 * 1000,
               "a 429 while posting answered " + JSON.stringify({ returnValue: t.returnValue, errorCode: t.errorCode, retryable: t.retryable, retryAt: t.retryAt }));
        const before = s.server.requests();
        const again = await s.methods.share(request(s.accountId, (fx.share as Json).content));
        assert(again.returnValue === false && again.retryAt && s.server.requests() === before, "a share within Retry-After reached the server");
    }) });
}

export async function runConformance(def: ConnectorDefinition, fx: ConformanceFixture): Promise<ConformanceResult[]> {
    const out: ConformanceResult[] = [];
    for (const check of conformanceChecks(def, fx)) {
        try {
            await check.run();
            out.push({ name: check.name, ok: true });
        } catch (e) {
            out.push({ name: check.name, ok: false, error: (e as Error).message });
        }
    }
    return out;
}
