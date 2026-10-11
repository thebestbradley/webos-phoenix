// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// createConnectorService(definition, environment) -> the Luna methods of a
// connector's service: the ones com.palm.service.accounts and the apps call
// on a Synergy transport (docs/SYNERGY-CONNECTORS.md 3.2), made from the
// definition, as apps/dav/service/davservice.js makes them by hand:
//
//   checkCredentials {username, password, templateId, config, accountId?}
//       the template's validator: definition.validate ->
//       {returnValue, username, credentials, config} or an errorCode
//   onCreate {accountId, config}      keeps config in the account's state
//   onEnabled {accountId, capabilityProviderId, enabled}
//       on: the periodic activity, then a first sync in the background;
//       off: the capability's data removed, and the activity cancelled
//       with the last capability
//   onCredentialsChanged {accountId}  clears the backoff, syncs
//   onDelete {accountId}              every object of the account, its
//                                     state and sync states removed
//   sync {accountId, capability?, $activity?}   one at a time per account
//   share {accountId, content: {title?, text?, url?, files?: [{path,
//       mimeType?, description?}]}, audience?, idempotencyKey?}
//       (with definition.share) the content checked against the
//       declaration (share.ts checkShare), then definition.share.send as
//       that account -> {posted: {url?, id?}, url?}; or an errorCode, with
//       retryable (and retryAt) when trying again later may work
//   + definition.methods
//
// The environment is what the host gives: luna (a device's webos-service,
// the simulator's bus, a test's fake bus), request (HTTP), and the rest of
// types.ts Environment. Everything runs on plain promises over it, so the
// same compiled file runs in run-js-service, in the simulator's page and
// in Node's tests.

import * as synckit from "@phoenix/synckit";
import type { DbObject, ItemStore } from "@phoenix/synckit";
import { emptyStats, removeObjects, syncObjects, type CapabilityStats } from "./engine";
import { createNet } from "./net";
import { checkShare, maxBytesOf } from "./share";
import type {
    AccountContext, BaseContext, ConnectorDefinition, Environment, HelperProcess, Json, LiveConnection, MethodContext, Reply, ServiceMethods,
    ValidateContext
} from "./types";

export const CALLBACKS = ["checkCredentials", "onCreate", "onEnabled", "onCredentialsChanged", "onDelete", "sync"];
const OAUTH = "luna://org.webosphoenix.service.oauth/";

function ok(extra?: Json): Reply { return Object.assign({ returnValue: true }, extra || {}); }

/** Every method name the service registers. */
export function methodNames(def: ConnectorDefinition): string[] {
    return CALLBACKS.concat(def.share ? ["share"] : [], def.connection ? ["connect", "disconnect"] : [], Object.keys(def.methods || {}));
}

export function createConnectorService(def: ConnectorDefinition, env: Environment): ServiceMethods {
    const log = env.log || (() => {});
    const now = env.now || (() => Date.now());
    const bus = synckit.createLuna(env.luna);
    const scheduler = synckit.createScheduler({ call: bus.call, service: def.service, log });
    const serialize = synckit.createSerializer();
    const providerIds = Object.keys(def.capabilities);

    const oauth = {
        token: async (keyId: string): Promise<string> => {
            if (!keyId) throw synckit.syncError("The account has no sign-in token (sign in again)", "CREDENTIALS_NOT_FOUND");
            const r = await bus.call(OAUTH + "token", { keyId }).catch((e: Error & { errorCode?: string }) => {
                throw synckit.syncError(e.message, e.errorCode === "NOT_FOUND" ? "401_UNAUTHORIZED" : e.errorCode || "UNKNOWN_ERROR");
            });
            return String(r.accessToken || "");
        },
        forget: async (keyId: string): Promise<void> => {
            if (keyId) await bus.call(OAUTH + "forget", { keyId }).catch(() => {});
        }
    };

    let settingsCache: Promise<Record<string, Json> | null> | null = null;
    const helpers: Record<string, Promise<HelperProcess>> = {};
    function baseContext(hosts?: string[], backoff?: { retryAt: number }): BaseContext {
        return {
            luna: bus, db: bus.db, tempdb: bus.tempdb, log, now, service: def.service, oauth,
            http: synckit.createHttp({
                request: env.request, hosts: hosts ? (def.hosts || []).concat(hosts) : undefined, backoff,
                maxWaitMs: env.maxWaitMs, now, sleep: env.sleep, log, userAgent: def.userAgent
            }),
            net: createNet({ env: env.net, hosts: (def.hosts || []).concat(hosts || []), backoff, now }),
            cachePhoto: env.cachePhoto || (async (_key: string, url: string) => url),
            readFile: env.readFile || (async (path: string) => { throw new Error("cannot read " + path + " here"); }),
            // Only the settings the definition names, from the device's file for this service.
            setting: async (name: string) => {
                if ((def.settings || []).indexOf(name) < 0) return undefined;
                if (!settingsCache) settingsCache = env.settings ? env.settings(def.service).catch(() => null) : Promise.resolve(null);
                const all = await settingsCache;
                return all ? all[name] : undefined;
            },
            // One running helper per name and arguments, for all the service's
            // accounts (Delta Chat's accounts manager and TDLib's clients are
            // one process for many accounts); started again after it exits.
            helper: (name: string, args?: string[]) => {
                if ((def.helpers || []).indexOf(name) < 0)
                    return Promise.reject(synckit.syncError(name + " is not one of " + def.service + "'s helpers", "PERMISSION_DENIED"));
                const start = env.helper;
                if (!start) return Promise.reject(synckit.syncError(name + " is not on this device", "HELPER_NOT_AVAILABLE"));
                const key = name + "\n" + (args || []).join("\n");
                if (!helpers[key]) {
                    const started: Promise<HelperProcess> = Promise.resolve().then(() => start(name, args)).then((h) => {
                        h.onExit(() => { if (helpers[key] === started) delete helpers[key]; });
                        return h;
                    }, (e: Json) => {
                        delete helpers[key];
                        throw synckit.syncError(String((e && e.message) || e), (e && e.errorCode) || "HELPER_NOT_AVAILABLE");
                    });
                    helpers[key] = started;
                }
                return helpers[key];
            },
            writeFile: async (name: string, bytes: Uint8Array, mimeType?: string) => {
                if (!env.writeFile) throw synckit.syncError("cannot keep files here", "UNSUPPORTED");
                return env.writeFile(def.service, String(name).replace(/[^A-Za-z0-9._-]/g, "_"), bytes, mimeType);
            },
            setTimeout: (fn: () => void, ms: number) => (env.setTimeout || setTimeout)(fn, ms),
            clearTimeout: (h: Json) => (env.clearTimeout || clearTimeout)(h)
        };
    }

    // ---- Long-lived connections (definition.connection) -------------------------------------

    interface Live { handle: LiveConnection | null; opening: Promise<LiveConnection> | null }
    const lives: Record<string, Live> = {};
    const liveHere = () => !env.live || env.live();
    function liveOf(accountId: string): LiveConnection | null {
        const l = lives[accountId];
        return l && l.handle && !l.handle.closed ? l.handle : null;
    }
    // Opened with a context of its own, which lives as long as the connection.
    async function openLive(accountId: string): Promise<LiveConnection> {
        if (!def.connection) throw synckit.syncError(def.service + " keeps no connection", "UNSUPPORTED");
        const open = liveOf(accountId);
        if (open) return open;
        const l = lives[accountId] = lives[accountId] || { handle: null, opening: null };
        if (l.opening) return l.opening;
        if (!liveHere()) throw synckit.syncError("Connections are kept elsewhere", "NOT_LIVE_HERE");
        l.opening = (async () => {
            const { ctx, rec } = await accountContext(accountId);
            if (rec.retryAt && rec.retryAt > now()) {
                const e = synckit.syncError("The server asked to wait", "503_SERVICE_UNAVAILABLE") as Error & { retryAt?: number };
                e.retryAt = rec.retryAt;
                throw e;
            }
            const handle = await (def.connection as NonNullable<ConnectorDefinition["connection"]>).open(ctx);
            l.handle = handle;
            return handle;
        })();
        try {
            return await l.opening;
        } finally {
            l.opening = null;
        }
    }
    async function closeLive(accountId: string): Promise<void> {
        const l = lives[accountId];
        delete lives[accountId];
        if (l && l.opening) await l.opening.catch(() => null);
        const h = l && l.handle;
        if (h && !h.closed) await Promise.resolve(h.close()).catch((e: Error) => log("closing: " + e.message));
    }
    // After a sync: the connection open again if it dropped (a periodic sync reconnects).
    function keepLive(accountId: string): void {
        if (!def.connection || !liveHere() || liveOf(accountId)) return;
        openLive(accountId).catch((e: Error) => log("not connected: " + e.message));
    }

    // ---- The account's state (def.kinds.state) ----------------------------------------------

    interface StateRecord extends DbObject { accountId: string; config: Json; tokens: Record<string, string | null>; data: Json; retryAt?: number }

    async function loadState(accountId: string): Promise<StateRecord> {
        const r = await bus.db.find({ from: def.kinds.state, where: [{ prop: "accountId", op: "=", val: accountId }] });
        const rec = (r[0] as StateRecord) || { _kind: def.kinds.state, accountId, config: {}, tokens: {}, data: {} };
        rec.config = rec.config || {};
        rec.tokens = rec.tokens || {};
        rec.data = rec.data || {};
        bases.set(rec, keysJson(rec.data));
        return rec;
    }
    // Each key of the state's data as JSON, as it was read: a save writes the
    // keys this context changed onto the record as it is now, so a long-lived
    // connection's context and a call's do not undo each other's changes.
    const bases = new WeakMap<StateRecord, Record<string, string>>();
    function keysJson(data: Json): Record<string, string> {
        const out: Record<string, string> = {};
        Object.keys(data || {}).forEach((k) => { out[k] = JSON.stringify(data[k]); });
        return out;
    }
    // Written only when something in it changed: a sync that changed nothing writes nothing.
    async function saveState(rec: StateRecord, before: string): Promise<void> {
        const now_ = JSON.stringify({ c: rec.config, t: rec.tokens, d: rec.data, r: rec.retryAt || 0 });
        if (now_ === before && rec._id) return;
        const out: Json = Object.assign({}, rec);
        const base = bases.get(rec);
        if (rec._id && base) {
            const current = (await bus.db.find({ from: def.kinds.state, where: [{ prop: "accountId", op: "=", val: rec.accountId }] }))[0];
            if (current && current._rev !== rec._rev) {
                const data = Object.assign({}, current.data || {});
                Object.keys(Object.assign({}, base, rec.data)).forEach((k) => {
                    const mine = rec.data[k] === undefined ? undefined : JSON.stringify(rec.data[k]);
                    if (mine === base[k]) return;
                    if (mine === undefined) delete data[k];
                    else data[k] = rec.data[k];
                });
                out.data = data;
            }
        }
        delete out._rev;
        const r = await bus.db.put([out]);
        rec._id = r[0].id;
        rec._rev = r[0].rev;
        bases.set(rec, keysJson(out.data));
        if (out.data !== rec.data) Object.keys(out.data).forEach((k) => { if (!(k in rec.data)) rec.data[k] = out.data[k]; });
    }
    function snapshot(rec: StateRecord): string {
        return JSON.stringify({ c: rec.config, t: rec.tokens, d: rec.data, r: rec.retryAt || 0 });
    }

    function hostOfUrl(u: unknown): string | null {
        try { return new URL(String(u)).host; } catch (e) { return null; }
    }

    // The user's server (config.serverUrl / config.server) is always reachable.
    function userHosts(config: Json): string[] {
        const out: string[] = [];
        [config && config.serverUrl, config && config.server, config && config.url, config && config.host].forEach((v) => {
            const h = hostOfUrl(v) || (typeof v === "string" && /^[a-z0-9.-]+(:\d+)?$/i.test(v) ? v.toLowerCase() : null);
            if (h) out.push(h);
        });
        return out;
    }

    async function accountContext(accountId: string, rec?: StateRecord): Promise<{ ctx: AccountContext; rec: StateRecord }> {
        const state = rec || await loadState(accountId);
        const [account, credentials] = await Promise.all([
            bus.accountInfo(accountId).catch(() => null),
            bus.credentials(accountId).catch(() => ({}))
        ]);
        if (!state.retryAt) state.retryAt = 0;
        const backoff = { retryAt: state.retryAt || 0 };
        const base = baseContext(userHosts(state.config), backoff);
        const ctx: AccountContext = Object.assign(base, {
            accountId, account: account || { _id: accountId, capabilityProviders: [] }, credentials: credentials || {},
            config: state.config, state: state.data,
            notify: async (n: { title: string; body?: string; appId?: string; params?: Json }) => {
                const message = n.body ? n.title + ": " + n.body : n.title;
                await bus.call("luna://com.webos.notification/createToast", {
                    message, onclick: n.appId ? { appId: n.appId, params: n.params || {} } : undefined, sourceId: def.service
                }).catch((e: Error) => log("notification not shown: " + e.message));
            },
            putMessage: (message: Json) => bus.call("luna://org.webosports.service.messaging/putMessage", { message }),
            live: () => liveOf(accountId),
            connect: () => openLive(accountId),
            connectionsHere: () => liveHere(),
            saveState: async () => {
                await saveState(state, savedAs);
                savedAs = snapshot(state);
            }
        });
        let savedAs = snapshot(state);
        // The backoff object is shared with http: a 429 during the call is kept with the state.
        Object.defineProperty(state, "retryAt", { get: () => backoff.retryAt, set: (v: number) => { backoff.retryAt = v; },
                                                  enumerable: true, configurable: true });
        return { ctx, rec: state };
    }

    // The capability's db8 watch (CapabilityDefinition.watch) as an activity.
    function watchName(accountId: string, providerId: string): string { return def.service + ".watch." + providerId + "." + accountId; }
    function startWatch(accountId: string, providerId: string): Promise<unknown> {
        const w = def.capabilities[providerId].watch;
        if (!w || env.periodicSync === false) return Promise.resolve();
        return bus.call("luna://com.palm.activitymanager/create", {
            activity: {
                name: watchName(accountId, providerId),
                description: def.service + " watch for account " + accountId,
                type: { background: true, persist: true, explicit: true },
                trigger: { key: "fired", method: "luna://com.palm.db/watch", params: { query: w.query } },
                callback: { method: "luna://" + def.service + "/" + w.method, params: { accountId } }
            },
            start: true,
            replace: true
        }).catch((e: Error) => log("watch not set up: " + e.message));
    }
    function stopWatch(accountId: string, providerId: string): Promise<unknown> {
        if (!def.capabilities[providerId].watch) return Promise.resolve();
        return bus.call("luna://com.palm.activitymanager/cancel", { activityName: watchName(accountId, providerId) }).catch(() => {});
    }

    function items(accountId: string): ItemStore | null {
        return def.kinds.item ? synckit.createItemStore({ db: bus.db, kind: def.kinds.item, accountId }) : null;
    }

    function enabledProviders(account: Json): string[] {
        return ((account && account.capabilityProviders) || []).map((c: Json) => c.id).filter((id: string) => def.capabilities[id]);
    }

    function setState(accountId: string, providerId: string, state: string, error?: unknown): Promise<unknown> {
        return synckit.setSyncState(bus.tempdb, accountId, providerId, state, error, log);
    }

    // A sync the service starts itself goes through the bus like any other,
    // so whoever serializes syncs (the simulator's lock) sees it too.
    function syncOverBus(accountId: string): void {
        const params: Json = { accountId };
        Promise.resolve(env.luna.call("luna://" + def.service + "/sync", params)).then((r: Json) => {
            if (r && r.returnValue === false) log("sync of " + accountId + " failed: " + (r.errorText || r.errorCode));
        }, (e: Error) => log("sync of " + accountId + " failed: " + e.message));
    }

    async function removeCapability(ctx: AccountContext, providerId: string): Promise<void> {
        const cap = def.capabilities[providerId];
        let removed: string[] = [];
        if (cap.remove) await cap.remove(ctx);
        else removed = await removeObjects(ctx, providerId, cap, items(ctx.accountId));
        if (cap.capability === "CONTACTS" && cap.linkPersons !== false && env.linkPersons !== false && removed.length)
            await synckit.linker.updatePersons(bus.db, [], removed);
        if (cap.pull) {
            const rec = await loadState(ctx.accountId);
            if (rec._id && providerId in rec.tokens) {
                const before = snapshot(rec);
                delete rec.tokens[providerId];
                await saveState(rec, before);
            }
        }
    }

    async function syncAccount(p: Json): Promise<Reply> {
        const accountId = p.accountId;
        const { ctx, rec } = await accountContext(accountId);
        const before = snapshot(rec);
        let providers = enabledProviders(ctx.account);
        if (p.capability) providers = providers.filter((id) => def.capabilities[id].capability === p.capability || id === p.capability);
        if (!providers.length) return ok({ skipped: "no enabled capability" });
        if (rec.retryAt && rec.retryAt > now()) {
            // The server asked us to wait (Retry-After): nothing is sent before then.
            return ok({ skipped: "backoff", retryAt: rec.retryAt });
        }
        const stats: Record<string, CapabilityStats | Json> = {};
        let failure: (Error & { errorCode?: string; status?: number; retryAt?: number }) | null = null;
        for (const id of providers) {
            const cap = def.capabilities[id];
            const first = cap.pull ? !(id in rec.tokens) : false;
            await setState(accountId, id, first ? "INITIAL_SYNC" : "INCREMENTAL_SYNC");
            try {
                if (cap.pull && cap.kind) {
                    const store = items(accountId);
                    if (!store) throw new Error(def.service + ": capabilities with a kind need kinds.item for their item records");
                    const r = await syncObjects(ctx, id, cap, store, rec.tokens[id] === undefined ? null : rec.tokens[id]);
                    rec.tokens[id] = r.nextToken === undefined ? null : r.nextToken;
                    stats[id] = r.stats;
                    if (cap.capability === "CONTACTS" && cap.linkPersons !== false && env.linkPersons !== false &&
                        (r.stats.changedIds.length || r.stats.removedIds.length)) {
                        const removed = r.stats.removedIds;
                        await synckit.linker.updatePersons(bus.db, r.stats.changedIds.filter((x, i, a) => a.indexOf(x) === i && removed.indexOf(x) < 0), removed);
                    }
                } else if (cap.sync) {
                    stats[id] = (await cap.sync(ctx)) || {};
                } else {
                    stats[id] = emptyStats();
                }
                await setState(accountId, id, "IDLE");
            } catch (e) {
                failure = e as Error;
                // A wait the connector was told of other than by HTTP (a stream's policy-violation): kept as the backoff.
                if (failure.retryAt && failure.retryAt > (rec.retryAt || 0)) rec.retryAt = failure.retryAt;
                await setState(accountId, id, "ERROR", failure);
                const code = synckit.errorCodeOf(failure);
                // Credentials or a rate limit concern the whole account: stop here.
                if (code === "401_UNAUTHORIZED" || code === "503_SERVICE_UNAVAILABLE" || code === "CREDENTIALS_NOT_FOUND") {
                    // (all of its capabilities, those synced before it too: their data is as stale now).
                    for (const other of providers) if (other !== id) await setState(accountId, other, "ERROR", failure);
                    break;
                }
            }
        }
        await saveState(rec, before);
        if (failure) {
            const r = synckit.fail(failure);
            if (rec.retryAt && rec.retryAt > now()) r.retryAt = rec.retryAt;
            return Object.assign(r, { stats }) as Reply;
        }
        keepLive(accountId);
        return ok({ stats });
    }

    const methods: ServiceMethods = {
        checkCredentials: async (p: Json) => {
            try {
                const config = p.config || {};
                const vctx: ValidateContext = Object.assign(baseContext(), { templateId: p.templateId || def.templateIds[0] });
                const r = await def.validate(vctx, p);
                return ok({ username: r.username || p.username, credentials: r.credentials, config: r.config || config });
            } catch (e) {
                return synckit.fail(e) as Reply;
            }
        },

        onCreate: async (p: Json) => {
            try {
                const rec = await loadState(p.accountId);
                const before = snapshot(rec);
                rec.config = Object.assign({}, rec.config, p.config || {});
                await saveState(rec, before);
                if (def.onCreate) {
                    const { ctx, rec: r2 } = await accountContext(p.accountId, rec);
                    const b2 = snapshot(r2);
                    await def.onCreate(ctx);
                    await saveState(r2, b2);
                }
                return ok();
            } catch (e) {
                return synckit.fail(e) as Reply;
            }
        },

        onEnabled: async (p: Json) => {
            const providerId = p.capabilityProviderId;
            if (!def.capabilities[providerId]) return { returnValue: false, errorCode: "UNSUPPORTED_CAPABILITY", errorText: "not a capability of " + def.service };
            try {
                if (p.enabled) {
                    if (env.periodicSync !== false) {
                        await scheduler.schedule(p.accountId, {
                            every: (def.schedule && def.schedule.every) || "1h",
                            description: def.service + " sync for account " + p.accountId,
                            requirements: def.schedule && def.schedule.network === false ? {} : { internet: true }
                        });
                    }
                    await startWatch(p.accountId, providerId);
                    // Reply now; the first sync runs in the background (all the
                    // account's capabilities: a sync asked meanwhile joins it).
                    syncOverBus(p.accountId);
                    return ok();
                }
                const { ctx } = await accountContext(p.accountId);
                await stopWatch(p.accountId, providerId);
                await removeCapability(ctx, providerId);
                await bus.tempdb.delQuery({ from: synckit.syncstate.KIND, where: [
                    { prop: "accountId", op: "=", val: p.accountId }, { prop: "capabilityProvider", op: "=", val: providerId }] })
                    .catch(() => {});
                const left = enabledProviders(ctx.account).filter((id) => id !== providerId);
                if (!left.length) {
                    await scheduler.cancel(p.accountId);
                    await closeLive(p.accountId);
                }
                return ok();
            } catch (e) {
                return synckit.fail(e) as Reply;
            }
        },

        onCredentialsChanged: async (p: Json) => {
            const rec = await loadState(p.accountId);
            if (rec._id && rec.retryAt) {
                const before = snapshot(rec);
                rec.retryAt = 0;
                await saveState(rec, before);
            }
            syncOverBus(p.accountId);
            return ok();
        },

        onDelete: async (p: Json) => {
            try {
                await scheduler.cancel(p.accountId);
                await closeLive(p.accountId);
                const { ctx, rec } = await accountContext(p.accountId);
                if (def.onDelete) await def.onDelete(ctx).catch((e: Error) => log("onDelete: " + e.message));
                for (const id of providerIds) {
                    await stopWatch(p.accountId, id);
                    await removeCapability(ctx, id);
                }
                const store = items(p.accountId);
                if (store) await store.removeAll();
                if (rec._id) await bus.db.del([rec._id]);
                await synckit.syncstate.clearSyncStates(bus.tempdb, p.accountId);
                return ok();
            } catch (e) {
                return synckit.fail(e) as Reply;
            }
        },

        sync: (p: Json) => {
            if (!p || !p.accountId) return Promise.resolve({ returnValue: false, errorCode: "400_BAD_REQUEST", errorText: "accountId is required" });
            return serialize(p.accountId, () => syncAccount(p).catch((e) => synckit.fail(e) as Reply)).then((reply) => {
                // A periodic activity is told the run is over (legacy activity manager "complete").
                scheduler.complete(p.$activity);
                return reply;
            });
        }
    };

    // The connection, at once (the simulator's always-running page; a device's
    // activity when the network comes): {accountId} -> {connected: true}.
    if (def.connection) {
        methods.connect = async (p: Json) => {
            if (!p || !p.accountId) return { returnValue: false, errorCode: "400_BAD_REQUEST", errorText: "accountId is required" };
            try {
                const { ctx } = await accountContext(p.accountId);
                if (!enabledProviders(ctx.account).length) return ok({ connected: false, skipped: "no enabled capability" });
                await openLive(p.accountId);
                return ok({ connected: true });
            } catch (e) {
                return synckit.fail(e) as Reply;
            }
        };
        methods.disconnect = async (p: Json) => {
            if (p && p.accountId) await closeLive(p.accountId);
            else for (const id of Object.keys(lives)) await closeLive(id);
            return ok();
        };
    }

    // Sharing (definition.share): docs/SYNERGY-SDK.md "Sharing to your service".
    if (def.share) {
        const share = def.share;
        const templateIds = share.templateId ? [share.templateId] : def.templateIds;
        methods.share = async (p: Json) => {
            try {
                if (!p || !p.accountId) return { returnValue: false, errorCode: "400_BAD_REQUEST", errorText: "accountId is required" };
                const checked = checkShare(share, p);
                const { ctx, rec } = await accountContext(p.accountId);
                if (!ctx.account || templateIds.indexOf(ctx.account.templateId) < 0 || ctx.account.beingDeleted)
                    return { returnValue: false, errorCode: "ACCOUNT_NOT_FOUND", errorText: "No account " + p.accountId + " of " + templateIds.join(", ") };
                const before = snapshot(rec);
                if (rec.retryAt && rec.retryAt > now())
                    return { returnValue: false, errorCode: "503_SERVICE_UNAVAILABLE", errorText: "The server asked to wait", retryable: true, retryAt: rec.retryAt };
                // What the connector may read: the files of this share, nothing else.
                const allowed = checked.files.map((f) => f.path);
                const read = ctx.readFile;
                ctx.readFile = (path: string) => allowed.indexOf(path) >= 0 ? read(path)
                    : Promise.reject(Object.assign(new Error("Not a file of this share: " + path), { errorCode: "PERMISSION_DENIED" }));
                const content = Object.assign({}, checked, {
                    files: checked.files.map((f) => Object.assign({}, f, {
                        read: async () => {
                            const r = await read(f.path);
                            const max = maxBytesOf(share.accepts, f.kind);
                            if (max && r.bytes.length > max)
                                throw Object.assign(new Error(f.path.replace(/^.*\//, "") + " is larger than " + Math.round(max / 1048576 * 10) / 10 + " MB"),
                                                    { errorCode: "SHARE_TOO_LARGE" });
                            return r;
                        }
                    }))
                });
                let result: Json;
                try {
                    result = (await share.send(ctx, content)) || {};
                } finally {
                    if (snapshot(rec) !== before) await saveState(rec, before);
                }
                const posted: Json = {};
                if (result.url) posted.url = String(result.url);
                if (result.id !== undefined) posted.id = String(result.id);
                return ok(Object.assign({ posted }, posted.url ? { url: posted.url } : {}));
            } catch (e) {
                const r = synckit.fail(e) as Reply;
                const code = r.errorCode || "";
                // Trying again later may post it (the same idempotencyKey: once).
                r.retryable = ["503_SERVICE_UNAVAILABLE", "500_SERVER_ERROR", "CONNECTION_FAILED", "CONNECTION_TIMEOUT", "HOST_NOT_FOUND"].indexOf(code) >= 0 || !!r.retryAt;
                return r;
            }
        };
    }

    Object.keys(def.methods || {}).forEach((name) => {
        const fn = (def.methods as NonNullable<ConnectorDefinition["methods"]>)[name];
        methods[name] = async (p: Json) => {
            try {
                let ctx: MethodContext;
                let rec: StateRecord | null = null;
                let before = "";
                if (p && p.accountId) {
                    const a = await accountContext(p.accountId);
                    ctx = a.ctx;
                    rec = a.rec;
                    before = snapshot(rec);
                } else {
                    ctx = baseContext();
                }
                const r = await fn(ctx, p || {});
                if (rec && snapshot(rec) !== before) await saveState(rec, before);
                return ok(r);
            } catch (e) {
                return synckit.fail(e) as Reply;
            }
        };
    });

    return methods;
}
