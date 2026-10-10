// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.dropshare on a device (dropshare.js), over real sockets
// on 127.0.0.1: the same requests and states as the simulator's server
// (shell/sim/simdropshare.cpp, build/simnet-test), files straight into
// Downloads, the ongoing activity and the notification.

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const ds = require("./dropshare.js") as Any;

const made: Any[] = [];
afterEach(() => { made.splice(0).forEach((d) => d.close()); });

function world(opts: Any = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dropshare-"));
    const ongoing: Any[] = [];
    const notes: Any[] = [];
    const d = ds.createDropShare({
        downloads: path.join(dir, "Downloads"), address: () => "127.0.0.1", listenHost: "127.0.0.1",
        pages: (n: string) => Buffer.from("<html>" + n + "</html>"),
        enabled: () => Promise.resolve(opts.enabled !== false),
        ongoing: (o: Any) => ongoing.push(o), notify: (n: Any) => notes.push(n),
        limits: opts.limits, idleMs: opts.idleMs
    });
    made.push(d);
    const start = (method: string, p: Any) => new Promise<Any>((resolve) => {
        const replies: Any[] = [];
        const cancel = d.methods[method](p, (r: Any) => { replies.push(r); if (replies.length === 1) resolve({ first: r, replies, cancel }); });
    });
    return { d, dir, ongoing, notes, start };
}

describe("DropShare on a device", () => {
    it("is off until the user turns it on", async () => {
        const w = world({ enabled: false });
        const r = await w.start("receive", {});
        expect(r.first).toMatchObject({ returnValue: false, errorText: "DropShare is off. Turn it on in Settings > DropShare." });
    });

    it("receives files into Downloads, numbering a name already there", async () => {
        const w = world();
        fs.mkdirSync(path.join(w.dir, "Downloads"));
        fs.writeFileSync(path.join(w.dir, "Downloads", "photo.jpg"), "old");
        const r = await w.start("receive", { subscribe: true });
        expect(r.first).toMatchObject({ returnValue: true, state: "waiting", subscribed: true });
        const url: string = r.first.url;
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{22}\/$/);
        // The page, and nothing without the token.
        expect(await (await fetch(url)).text()).toBe("<html>receive.html</html>");
        expect((await fetch(url.replace(/\/[^/]+\/$/, "/nope/"))).status).toBe(404);
        const up = await fetch(url + "upload?name=" + encodeURIComponent("photo.jpg") + "&type=image/jpeg", { method: "POST", body: "new bytes" });
        expect(await up.json()).toEqual({ returnValue: true, name: "photo (2).jpg" });
        expect(fs.readFileSync(path.join(w.dir, "Downloads", "photo (2).jpg"), "utf8")).toBe("new bytes");
        expect(w.ongoing.some((o) => o.id === "dropshare" && o.title === "DropShare")).toBe(true);
        expect((await fetch(url + "done", { method: "POST" })).status).toBe(200);
        const lastReply = r.replies[r.replies.length - 1];
        expect(lastReply.state).toBe("done");
        expect(lastReply.files[0]).toMatchObject({ name: "photo (2).jpg", done: true, saved: path.join(w.dir, "Downloads", "photo (2).jpg") });
        expect(w.notes).toEqual([{ appId: "org.webosphoenix.files", title: "DropShare", body: "photo (2).jpg is in Downloads",
                                   params: { path: path.join(w.dir, "Downloads") }, soundClass: "notifications" }]);
        expect(w.ongoing[w.ongoing.length - 1]).toEqual({ id: "dropshare", clear: true });
        // The session is over: its address answers no more.
        await expect(fetch(url)).rejects.toThrow();
    });

    it("refuses what is over the limits, and keeps no half upload", async () => {
        const w = world({ limits: { file: 10 } });
        const r = await w.start("receive", {});
        const big = await fetch(r.first.url + "upload?name=big.bin", { method: "POST", body: "x".repeat(11) });
        expect(big.status).toBe(413);
        expect(fs.existsSync(path.join(w.dir, "Downloads", "big.bin"))).toBe(false);
    });

    it("sends files from where they are, and is done once each went", async () => {
        const w = world();
        const a = path.join(w.dir, "a.txt"), b = path.join(w.dir, "Ünïcode.txt");
        fs.writeFileSync(a, "alpha");
        fs.writeFileSync(b, "beta");
        const r = await w.start("send", { files: [{ path: a, mimeType: "text/plain" }, { path: b }], subscribe: true });
        const url: string = r.first.url;
        expect(await (await fetch(url)).text()).toBe("<html>send.html</html>");
        const list = await (await fetch(url + "files")).json();
        expect(list.files.map((f: Any) => [f.name, f.size])).toEqual([["a.txt", 5], ["Ünïcode.txt", 4]]);
        const one = await fetch(url + "file/" + list.files[0].id);
        expect(await one.text()).toBe("alpha");
        expect(one.headers.get("content-disposition")).toContain("filename=\"a.txt\"");
        expect(r.replies[r.replies.length - 1].state).toBe("transferring");
        const two = await fetch(url + "file/" + list.files[1].id);
        expect(two.headers.get("content-disposition")).toContain("filename*=UTF-8''%C3%9Cn%C3%AFcode.txt");
        expect(await two.text()).toBe("beta");
        await new Promise((res) => setTimeout(res, 20));
        expect(r.replies[r.replies.length - 1].state).toBe("done");
        // The files themselves stay where they were.
        expect(fs.readFileSync(a, "utf8")).toBe("alpha");
    });

    it("ends a session when its card goes, or after its idle time", async () => {
        const w = world({ idleMs: 50 });
        const r = await w.start("receive", { subscribe: true });
        r.cancel();
        expect(w.d.current()).toBe(null);
        const r2 = await w.start("receive", { subscribe: true });
        await new Promise((res) => setTimeout(res, 120));
        expect(r2.replies[r2.replies.length - 1].state).toBe("timeout");
        const st: Any[] = [];
        w.d.methods.getStatus({}, (x: Any) => st.push(x));
        expect(st[0]).toMatchObject({ state: "timeout", url: "" });
    });

    it("has luna-service2 files for every method", () => {
        const api = JSON.parse(fs.readFileSync(path.join(HERE, "sysbus/org.webosphoenix.dropshare.api.json"), "utf8"));
        expect(api["phoenix.dropshare"].map((m: string) => m.split("/")[1]).sort()).toEqual([...ds.METHODS].sort());
    });
});
