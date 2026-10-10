// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Types of the test doubles in memdb.js.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DbApi } from "../index";

export interface MemDb extends DbApi { objects: Record<string, any> }
export interface FakeBus {
    calls: { uri: string; params: any }[];
    tempdb: MemDb;
    call(uri: string, params?: object): Promise<any>;
}
export function createMemDb(parents?: Record<string, string>): MemDb;
export function createFakeBus(options: {
    db: MemDb; tempdb?: MemDb; accounts: Record<string, any>; credentials: Record<string, any>;
    handlers?: Record<string, (params: any, uri: string) => any>;
}): FakeBus;
export const KIND_PARENTS: Record<string, string>;
