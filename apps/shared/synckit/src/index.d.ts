// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Types of @phoenix/synckit (src/index.js), for TypeScript users such as
// @phoenix/connector-kit.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type LunaReply = { returnValue?: boolean; errorCode?: string | number; errorText?: string; [k: string]: any };
export interface LunaBus { call(uri: string, params?: object): Promise<LunaReply> | LunaReply }

export interface DbObject { _id?: string; _kind?: string; _rev?: number; _del?: boolean; [k: string]: any }
export interface DbQuery { from: string; where?: { prop: string; op: string; val: any }[]; limit?: number; incDel?: boolean; page?: string }
export interface DbApi {
    find(query: DbQuery): Promise<DbObject[]>;
    get(ids: string[]): Promise<DbObject[]>;
    put(objects: DbObject[]): Promise<{ id: string; rev: number }[]>;
    merge(objects: DbObject[]): Promise<{ id: string; rev: number }[]>;
    del(ids: string[]): Promise<any>;
    delQuery(query: DbQuery): Promise<any>;
}
export interface Luna {
    call(uri: string, params?: object): Promise<LunaReply>;
    db: DbApi;
    tempdb: DbApi;
    credentials(accountId: string, name?: string): Promise<Record<string, any>>;
    writeCredentials(accountId: string, credentials: Record<string, any>): Promise<LunaReply>;
    accountInfo(accountId: string): Promise<any>;
}
export function createLuna(luna: LunaBus): Luna;

export function errorCodeOf(e: unknown): string;
export function fail(e: unknown): { returnValue: false; errorCode: string; errorText: string; retryAt?: number };
export function syncError(message: string, errorCode?: string | null, status?: number): Error & { errorCode?: string; status?: number };

export const syncstate: {
    KIND: string;
    STATES: string[];
    setSyncState(tempdb: DbApi | null, accountId: string, capabilityProvider: string, state: string, error?: any, log?: (m: string) => void): Promise<any>;
    getSyncStates(tempdb: DbApi, accountId: string): Promise<DbObject[]>;
    clearSyncStates(tempdb: DbApi, accountId: string): Promise<any>;
};
export const setSyncState: typeof syncstate.setSyncState;

export interface Scheduler {
    activityName(accountId: string): string;
    schedule(accountId: string, opts?: { every?: string; description?: string; requirements?: object }): Promise<any>;
    cancel(accountId: string): Promise<any>;
    complete(activity?: { activityId?: number | string }): Promise<any>;
}
export function createScheduler(options: { call: (uri: string, params?: object) => Promise<LunaReply>; service: string; log?: (m: string) => void }): Scheduler;
export function createSerializer(): <T>(key: string, fn: () => Promise<T> | T) => Promise<T>;
export function intervalSeconds(every: string): number;

export interface HttpRequest { method?: string; url: string; headers?: Record<string, string>; body?: string | Uint8Array; binary?: boolean; timeoutMs?: number }
export interface HttpResponse { status: number; headers: Record<string, string>; body?: string; bytes?: Uint8Array }
export type RequestFn = (req: HttpRequest) => Promise<HttpResponse>;
export interface Http {
    request(req: HttpRequest): Promise<HttpResponse>;
    json<T = any>(req: HttpRequest & { json?: unknown; withResponse?: boolean }): Promise<T>;
    backoff: { retryAt: number };
    allowHost(host: string): void;
}
export function createHttp(options: {
    request: RequestFn; hosts?: string[]; backoff?: { retryAt: number }; maxWaitMs?: number; retries?: number;
    timeoutMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; log?: (m: string) => void; userAgent?: string;
}): Http;
export function retryAfterMs(value: string | null | undefined, now: number): number | null;
export function hostMatches(pattern: string, host: string): boolean;
export function linkNext(header: string | null | undefined): string | null;

export interface ItemStore {
    kind: string;
    all(capability?: string): Promise<DbObject[]>;
    byRemoteId(capability: string): Promise<Record<string, DbObject>>;
    save(record: DbObject): Promise<DbObject>;
    remove(records: DbObject[]): Promise<any>;
    removeAll(capability?: string): Promise<any>;
}
export function createItemStore(options: { db: DbApi; kind: string; accountId: string }): ItemStore;
export interface MergeResult {
    merged: Record<string, any>;
    conflicts: { field: string; local: any; remote: any; kept: "local" | "remote" }[];
    toLocal: boolean;
    toRemote: boolean;
}
export function merge3(base: Record<string, any> | null, local: Record<string, any> | null, remote: Record<string, any> | null,
                       fields: string[], opts?: { winner?: "local" | "remote" }): MergeResult;
export function sameValue(a: unknown, b: unknown): boolean;

export const linker: {
    PERSON_KIND: string;
    updatePersons(db: DbApi, changedIds: string[], removedIds: string[]): Promise<string[]>;
    buildPerson(existing: DbObject | null, contacts: DbObject[]): DbObject;
    normalizePhone(value: string): string;
};
export const vcard: any;
export const ical: any;
export const datetime: any;
export const contentline: any;
/** A small namespace-aware XML reader (WebDAV multistatus bodies): parse, children, child, path, text, escape. */
export const xml: any;
export function createRequest(options?: { timeoutMs?: number; userAgent?: string }): RequestFn;
