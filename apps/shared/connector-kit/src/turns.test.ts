// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An account's sync and its methods take turns with its state
// (service.ts inTurn): a method's change to the state is not written over
// by a sync that loaded the state before it (the LinkedIn import that a
// sync it asked for undid).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";
import { defineConnector } from "./define";
import { createConnectorService } from "./service";

describe("an account's turns", () => {
    it("keep a method's change to the state from a sync that started before it", async () => {
        let release: () => void = () => {};
        const slow = new Promise<void>((r) => { release = r; });
        const seen: string[] = [];
        const def = defineConnector({
            service: "org.example.service.turns", templateIds: ["org.example.turns"],
            kinds: { state: "org.example.turns.state:1", item: "org.example.turns.item:1" },
            validate: async () => ({ credentials: {} }),
            capabilities: {
                "org.example.turns.things": {
                    capability: "THINGS", kind: "org.example.turns.thing:1",
                    pull: async (ctx: any) => {
                        seen.push("pull " + JSON.stringify(ctx.state.list || []));
                        await slow;
                        ctx.state.pulls = (ctx.state.pulls || 0) + 1;
                        return { full: true, changes: (ctx.state.list || []).map((x: string) => ({ remoteId: x, fields: { name: x } })) };
                    }
                }
            },
            methods: { setList: async (ctx: any, p: any) => { ctx.state.list = p.list; seen.push("set"); return {}; } }
        });
        const db = memdb.createMemDb({});
        const tempdb = memdb.createMemDb();
        const accounts = { a1: { _id: "a1", templateId: "org.example.turns", capabilityProviders: [{ id: "org.example.turns.things" }] } };
        const bus = memdb.createFakeBus({ db, tempdb, accounts, credentials: {}, handlers: {} });
        const m = createConnectorService(def, { luna: bus, request: async () => ({ status: 200, headers: {}, body: "" }), periodicSync: false });
        const first = m.sync({ accountId: "a1" });
        await new Promise((r) => setTimeout(r, 10));
        const set = m.setList({ accountId: "a1", list: ["x", "y"] });
        release();
        await first;
        expect((await set).returnValue).toBe(true);
        expect(seen).toEqual(["pull []", "set"]);
        const again = await m.sync({ accountId: "a1" });
        expect(again.returnValue).toBe(true);
        const things = await db.find({ from: "org.example.turns.thing:1" });
        expect(things.map((t: any) => t.name).sort()).toEqual(["x", "y"]);
        const state = (await db.find({ from: "org.example.turns.state:1" }))[0] as any;
        expect(state.data).toMatchObject({ list: ["x", "y"], pulls: 2 });
    });
});
