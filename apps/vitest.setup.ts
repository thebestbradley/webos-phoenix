// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Testing Library unmounts what a test rendered only by itself when the test
// API is global; ours is imported (no `globals`), so every test file gets the
// cleanup here. Without it a page stays mounted on the runtime's
// subscriptions and React can still be working once jsdom is torn down.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// The system's own services (../services/*) are plain CommonJS outside the
// workspace; their require("@phoenix/platform") (a device has a copy in
// each service's node_modules, tools/install-rootfs.py) finds the
// workspace's package here, as Node would with NODE_PATH.
if (typeof process !== "undefined" && process.versions && process.versions.node) {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const Module = req("node:module") as { _initPaths?: () => void };
    const nodeModules = new URL("./node_modules", import.meta.url).pathname;
    const paths = (process.env.NODE_PATH || "").split(":").filter(Boolean);
    if (!paths.includes(nodeModules)) {
        process.env.NODE_PATH = [nodeModules, ...paths].join(":");
        Module._initPaths?.();
    }
}

// Synchronous XMLHttpRequest to the page's own origin: the runtime reads
// the device's files that way (PalmSystem.getResource: sample-data.js, the
// services' scripts, apps.json, the media samples), and in the tests
// nothing serves them. jsdom does each such request in a child Node
// process (living-standard/xhr-sync-worker.js, spawned for every send):
// ~0.45 s apiece here, seven of them as a test file loads the runtime and
// makes its first call, and many times that on a busy machine. That spent
// the hooks' 10 s and the 1 s that waitFor and findBy wait before the page
// had drawn anything ("flaky under load"); it also asked whatever happens
// to listen on localhost:3000. Such a request now fails at once, as
// jsdom's did with nothing listening: a NetworkError, which the runtime
// takes for a missing file. Tests that serve files stub XMLHttpRequest
// themselves, which this leaves alone.
if (typeof window !== "undefined" && window.XMLHttpRequest) {
    const proto = window.XMLHttpRequest.prototype;
    const open = proto.open as (...a: unknown[]) => void;
    const send = proto.send as (...a: unknown[]) => void;
    const unserved = new WeakSet<XMLHttpRequest>();
    proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
        const [, url, async] = args;
        let local = false;
        try { local = new URL(String(url), document.baseURI).origin === window.location.origin; } catch { local = false; }
        if (async === false && local) unserved.add(this);
        else unserved.delete(this);
        open.apply(this, args);
    } as typeof proto.open;
    proto.send = function (this: XMLHttpRequest, ...args: unknown[]) {
        if (unserved.has(this))
            throw new DOMException("Nothing serves the page's origin in the tests", "NetworkError");
        send.apply(this, args);
    } as typeof proto.send;
}
