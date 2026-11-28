// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// service.js against webos-service's own API (nodejs-module-webos-service
// lib/service.js): register(name, request, cancel); a message has
// uniqueToken, isSubscription, payload and respond, and no "cancel" event of
// its own. Revision 7 (N16): the service called message.on("cancel") and
// died on every getDevMode {subscribe}.

import { createRequire } from "node:module";
import Module from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function fakeWebosService() {
    const methods: Record<string, { request: (m: Any) => void; cancel?: (m: Any) => void }> = {};
    class Service {
        constructor(public name: string) {}
        register(name: string, request: (m: Any) => void, cancel?: (m: Any) => void) { methods[name] = { request, cancel }; return true; }
    }
    return { Service, methods };
}

function loadWith(file: string, fake: Any) {
    const M = Module as Any;
    const load = M._load;
    M._load = function (request: string, ...rest: Any[]) {
        return request === "webos-service" ? fake.Service : load.call(this, request, ...rest);
    };
    try {
        delete require.cache[require.resolve(file)];
        return require(file);
    } finally {
        M._load = load;
    }
}

afterEach(() => { delete require.cache[require.resolve("./service.js")]; });

describe("com.webos.service.devmode's service.js on webos-service", () => {
    it("a getDevMode subscription: answered, its watcher stopped through the method's cancel callback", async () => {
        const fake = fakeWebosService();
        loadWith("./service.js", fake);
        const m = fake.methods.getDevMode;
        expect(typeof m.cancel).toBe("function");
        const replies: Any[] = [];
        // No .on: as webos-service's Message.
        const message = { payload: { subscribe: true }, isSubscription: true, uniqueToken: "t1", respond: (r: Any) => replies.push(r) };
        m.request(message);
        await new Promise((r) => setTimeout(r, 20));
        expect(replies[0]).toMatchObject({ returnValue: true, subscribed: true });
        expect(() => m.cancel!(message)).not.toThrow();
        // Cancelled twice, or never subscribed: nothing to stop.
        expect(() => m.cancel!(message)).not.toThrow();
        expect(fake.methods.setDevMode.cancel).toBeUndefined();
    });
});
