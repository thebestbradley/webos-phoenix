// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// db8 (com.palm.db), the webOS JSON object store. webOS OSE still ships it
// under its legacy name (webosose/db8, src/db-luna/MojDbServiceHandler.cpp:
// put, get, merge, del, find {query, count, watch}, watch, putKind), so the
// Phone and Messaging apps read and write the same kinds as the webOS 2.x
// apps (com.palm.person:1, com.palm.phonecall:1, com.palm.chatthread:1, ...).

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

export type DbOp = "=" | "!=" | "<" | "<=" | ">" | ">=" | "%" | "?";

export interface DbClause {
    prop: string;
    op: DbOp;
    val: unknown;
}

export interface DbQuery {
    from: string;
    where?: DbClause[];
    orderBy?: string;
    desc?: boolean;
    limit?: number;
    select?: string[];
    page?: string;
}

/** Every db8 object carries these. */
export interface DbObject {
    _id?: string;
    _kind: string;
    _rev?: number;
    _del?: boolean;
}

export interface DbPutResult {
    id: string;
    rev: number;
}

function makeDb(DB: string) {
    return {
        /** find {query}: one page of results (db8 caps a page at 500). */
        async find<T extends DbObject>(query: DbQuery): Promise<T[]> {
            const r = await call(`${DB}/find`, { query });
            return ((r as { results?: T[] }).results ?? []) as T[];
        },
        /** get {ids} */
        async get<T extends DbObject>(ids: string[]): Promise<T[]> {
            const r = await call(`${DB}/get`, { ids });
            return ((r as { results?: T[] }).results ?? []) as T[];
        },
        /** put {objects}: create or replace whole objects. */
        async put(objects: DbObject[]): Promise<DbPutResult[]> {
            const r = await call(`${DB}/put`, { objects });
            return (r as { results?: DbPutResult[] }).results ?? [];
        },
        /** merge {objects}: update only the given properties of existing objects (by _id). */
        async merge(objects: (Partial<DbObject> & { _id: string } & Record<string, unknown>)[]): Promise<DbPutResult[]> {
            const r = await call(`${DB}/merge`, { objects });
            return (r as { results?: DbPutResult[] }).results ?? [];
        },
        /** merge {query, props}: update every object the query matches. */
        async mergeWhere(query: DbQuery, props: Record<string, unknown>): Promise<number> {
            const r = await call(`${DB}/merge`, { query, props });
            return (r as { count?: number }).count ?? 0;
        },
        /** del {ids} */
        async del(ids: string[]): Promise<void> {
            await call(`${DB}/del`, { ids });
        },
        /** del {query} */
        async delWhere(query: DbQuery): Promise<number> {
            const r = await call(`${DB}/del`, { query });
            return (r as { count?: number }).count ?? 0;
        },
        /**
         * Keep a query's results up to date: find {query, watch: true} answers
         * with the results and later once with {fired: true} when they may have
         * changed; then we query again (the db8 watch pattern every webOS app
         * used). cb gets the full result list each time.
         */
        watch<T extends DbObject>(query: DbQuery, cb: (results: T[]) => void, onError?: (e: LunaError) => void): Subscription {
            let cancelled = false;
            let current: Subscription | null = null;
            const open = () => {
                if (cancelled) return;
                let answered = false;
                current = subscribe(`${DB}/find`, { query, watch: true }, (r) => {
                    if (cancelled) return;
                    const reply = r as { fired?: boolean; results?: T[] };
                    if (reply.fired) {
                        current?.cancel();
                        open();
                    } else if (!answered) {
                        answered = true;
                        cb(reply.results ?? []);
                    }
                }, onError);
            };
            open();
            return {
                cancel() {
                    cancelled = true;
                    current?.cancel();
                },
                get cancelled() { return cancelled; },
            };
        },
    };
}

export const db = makeDb("luna://com.palm.db");
/** com.palm.tempdb: db8's store that is emptied at every boot (presence, sync state). */
export const tempdb = makeDb("luna://com.palm.tempdb");
