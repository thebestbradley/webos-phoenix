// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.shellhost (shellhost.js): the pages' messages reach the
// shell with the caller's app id, the shell's reach only the app they are
// for, only the shell listens and sends, and posts made before the shell
// listens are kept for it.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const sh = require("./shellhost.js") as Any;

function world() {
    let t = 1000;
    const host = sh.createShellHost({ now: () => t });
    const call = (method: string, params: Any, caller: string) => {
        const replies: Any[] = [];
        const cancel = host[method](params, caller, (r: Any) => replies.push(r));
        return { replies, cancel };
    };
    return { host, call, tick: (ms: number) => { t += ms; } };
}

describe("org.webosphoenix.shellhost", () => {
    it("gives the shell every page's message, with the caller as the app", () => {
        const w = world();
        const shell = w.call("listen", { subscribe: true }, "com.webos.surfacemanager");
        expect(shell.replies[0]).toMatchObject({ returnValue: true, subscribed: true });
        const r = w.call("post", { type: "banner", payload: { text: "Hi", appId: "com.evil" } }, "com.palm.app.email 1012");
        expect(r.replies[0]).toEqual({ returnValue: true, delivered: true });
        const m = shell.replies[1].message;
        expect(m).toMatchObject({ appId: "com.palm.app.email", type: "banner", payload: { text: "Hi" } });
    });

    it("lets only the shell listen and send", () => {
        const w = world();
        expect(w.call("listen", { subscribe: true }, "com.palm.app.email").replies[0].returnValue).toBe(false);
        expect(w.call("send", { appId: "x", type: "t" }, "com.palm.app.email").replies[0].returnValue).toBe(false);
        expect(w.call("send", { appId: "x", type: "t" }, "com.webos.surfacemanager").replies[0]).toEqual({ returnValue: true, delivered: 0 });
    });

    it("sends the shell's message only to the app it is for", () => {
        const w = world();
        const memos = w.call("events", { subscribe: true }, "com.palm.app.memos");
        const memos2 = w.call("events", { subscribe: true }, "com.palm.app.memos");
        const email = w.call("events", { subscribe: true }, "com.palm.app.email");
        const r = w.call("send", { appId: "com.palm.app.memos", type: "editAction", payload: { action: "paste" } }, "com.webos.surfacemanager");
        expect(r.replies[0]).toEqual({ returnValue: true, delivered: 2 });
        expect(memos.replies[1].event).toEqual({ type: "editAction", payload: { action: "paste" } });
        expect(memos2.replies[1].event.type).toBe("editAction");
        expect(email.replies.length).toBe(1);
        // A page that goes away hears nothing more.
        memos.cancel();
        w.call("send", { appId: "com.palm.app.memos", type: "x" }, "com.webos.surfacemanager");
        expect(memos.replies.length).toBe(2);
        expect(memos2.replies.length).toBe(3);
        expect(w.host.listening("com.palm.app.memos")).toBe(1);
    });

    it("keeps posts made before the shell listens, for a while", () => {
        const w = world();
        const r = w.call("post", { type: "banner", payload: { text: "early" } }, "com.palm.app.clock");
        expect(r.replies[0]).toEqual({ returnValue: true, delivered: false });
        w.call("post", { type: "old" }, "com.palm.app.clock");
        w.tick(sh.KEEP_MS + 1);
        w.call("post", { type: "banner", payload: { text: "late" } }, "com.palm.app.clock");
        const shell = w.call("listen", { subscribe: true }, "com.webos.surfacemanager");
        const got = shell.replies.slice(1).map((x: Any) => x.message.payload.text);
        expect(got).toEqual(["late"]);
        // Once heard, not again.
        const again = w.call("listen", { subscribe: true }, "com.webos.surfacemanager");
        expect(again.replies.length).toBe(1);
    });

    it("refuses what is not a message", () => {
        const w = world();
        expect(w.call("post", { type: "no spaces" }, "a.b").replies[0].returnValue).toBe(false);
        expect(w.call("post", { type: "t", payload: [1] }, "a.b").replies[0].returnValue).toBe(false);
        expect(w.call("post", { type: "t" }, "").replies[0].returnValue).toBe(false);
        expect(w.call("post", { type: "t", payload: { big: "x".repeat(2000001) } }, "a.b").replies[0].returnValue).toBe(false);
        expect(w.call("events", {}, "a.b").replies[0].returnValue).toBe(false);
    });

    it("serves org.webosphoenix.ongoing: the caller's ongoing activities for the shell", () => {
        const w = world();
        const shell = w.call("listen", { subscribe: true }, "com.webos.surfacemanager");
        const replies: Any[] = [];
        w.host.ongoing.set({ id: "fw", title: "Installing firmware", progress: 30 }, "org.webosphoenix.hardware", (r: Any) => replies.push(r));
        expect(replies[0]).toEqual({ returnValue: true });
        expect(shell.replies[1].message).toMatchObject({ appId: "org.webosphoenix.hardware", type: "ongoing",
            payload: { id: "fw", appId: "org.webosphoenix.hardware", title: "Installing firmware", progress: 30 } });
        w.host.ongoing.set({ id: "dl", appId: "org.webosphoenix.settings", title: "Update" }, "com.palm.update", () => {});
        expect(shell.replies[2].message.payload).toMatchObject({ appId: "org.webosphoenix.settings", progress: -1 });
        w.host.ongoing.clear({ id: "fw" }, "org.webosphoenix.hardware", (r: Any) => replies.push(r));
        expect(shell.replies[3].message.payload).toEqual({ id: "fw", clear: true });
        w.host.ongoing.set({ id: "x" }, "a.b", (r: Any) => replies.push(r));
        expect(replies.pop().returnValue).toBe(false);
    });

    it("serves org.webosphoenix.system: what plays, and a media key for the shell", () => {
        const w = world();
        const shell = w.call("listen", { subscribe: true }, "com.webos.surfacemanager");
        const r: Any[] = [];
        w.host.system.getNowPlaying({}, "org.webosphoenix.assistant", (x: Any) => r.push(x));
        expect(r[0]).toEqual({ returnValue: true, nowPlaying: null });
        w.host.system.setNowPlaying({ title: "Song", artist: "Ada", playing: true }, "org.webosphoenix.music", (x: Any) => r.push(x));
        w.host.system.getNowPlaying({}, "org.webosphoenix.assistant", (x: Any) => r.push(x));
        expect(r[2].nowPlaying).toMatchObject({ title: "Song", artist: "Ada", playing: true, appId: "org.webosphoenix.music" });
        w.host.system.mediaKey({ key: "pause" }, "org.webosphoenix.assistant", (x: Any) => r.push(x));
        expect(shell.replies[1].message).toMatchObject({ appId: "org.webosphoenix.assistant", type: "mediaKey", payload: { key: "pause" } });
        w.host.system.mediaKey({ key: "explode" }, "a.b", (x: Any) => r.push(x));
        expect(r.pop().returnValue).toBe(false);
    });

    it("has luna-service2 files for every method, apps and shell apart", () => {
        const api = JSON.parse(fs.readFileSync(path.join(HERE, "sysbus/org.webosphoenix.shellhost.api.json"), "utf8"));
        const all = [...api["phoenix.shellhost.app"], ...api["phoenix.shellhost.shell"]].map((m: string) => m.split("/")[1]).sort();
        expect(all).toEqual([...sh.METHODS].sort());
        expect(api["phoenix.shellhost.app"]).not.toContain("org.webosphoenix.shellhost/send");
        // Luna Restart (luna-systemui's power menu) is the system's, not a media app's.
        expect(api["phoenix.system.restart"]).toEqual(["org.webosphoenix.system/restartUi"]);
        expect(api["phoenix.system.media"]).not.toContain("org.webosphoenix.system/restartUi");
        const perm = JSON.parse(fs.readFileSync(path.join(HERE, "sysbus/org.webosphoenix.shellhost.perm.json"), "utf8"));
        expect(perm["com.webos.surfacemanager"]).toContain("phoenix.shellhost.shell");
        expect(fs.readFileSync(path.join(HERE, "sysbus/org.webosphoenix.shellhost.service"), "utf8"))
            .toContain("/usr/palm/services/org.webosphoenix.shellhost");
    });
});
