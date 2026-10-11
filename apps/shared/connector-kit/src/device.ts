// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// runOnDevice(definition): a connector's service.js on a device. It
// registers the kit's methods with webos-service (OSE's
// nodejs-module-webos-service, as apps/dav/service/service.js does) and
// gives the kit what run-js-service has: Luna calls, HTTP over Node's
// http / https (@phoenix/synckit createRequest), pictures kept under
// /media/internal/.phoenix/connector-photos/<service>/, and the files the
// user shares read from disk.
//
//   // service/service.js
//   require("@phoenix/connector-kit/lib/device").runOnDevice(require("./connector"));
//
// Node's modules are required here only, so the rest of the kit also runs
// in the simulator's page.

/* eslint-disable @typescript-eslint/no-require-imports */
import * as synckit from "@phoenix/synckit";
import { createConnectorService, methodNames } from "./service";
import type { ConnectorDefinition, Environment, Json } from "./types";

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
                                       mp4: "video/mp4", webm: "video/webm", txt: "text/plain" };

export function deviceEnvironment(def: ConnectorDefinition, service: Json): Environment {
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const request = synckit.createRequest({ userAgent: def.userAgent });
    const photoDir = "/media/internal/.phoenix/connector-photos/" + def.service;
    return {
        luna: {
            call: (uri: string, params?: object) => new Promise((resolve) => {
                service.call(uri, params || {}, (message: Json) => resolve(message.payload));
            })
        },
        request,
        log: (m: string) => console.log("[" + def.service + "] " + m),
        // A picture downloaded once, under a name from its address.
        cachePhoto: async (key: string, url: string) => {
            const name = crypto.createHash("sha256").update(key + "\n" + url).digest("hex").slice(0, 32);
            const ext = (/\.(png|jpe?g|gif|webp)(\?|$)/i.exec(url) || [])[1] || "img";
            const file = path.join(photoDir, name + "." + ext.toLowerCase());
            if (fs.existsSync(file)) return file;
            const r = await request({ method: "GET", url, binary: true });
            if (r.status !== 200 || !r.bytes) return url;
            fs.mkdirSync(photoDir, { recursive: true });
            fs.writeFileSync(file, Buffer.from(r.bytes));
            return file;
        },
        readFile: async (p: string) => {
            const bytes = new Uint8Array(fs.readFileSync(p));
            const ext = (/\.([a-z0-9]+)$/i.exec(p) || [])[1] || "";
            return { bytes, mimeType: MIME[ext.toLowerCase()] || "application/octet-stream" };
        },
        net: nodeNet(),
        // Build-time settings (an app id registered with a service), written
        // by the image's recipe, never in the source tree.
        settings: async (svc: string) => {
            const file = path.join(SETTINGS_DIR, svc + ".json");
            if (!fs.existsSync(file)) return null;
            return JSON.parse(fs.readFileSync(file, "utf8"));
        },
        helper: async (name: string, args?: string[]) => nodeHelper(name, args || []),
        // Pictures received, where Messaging can show them (as the MMS store keeps its own).
        writeFile: async (svc: string, name: string, bytes: Uint8Array) => {
            const dir = path.join(FILES_DIR, svc);
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, name);
            fs.writeFileSync(file, Buffer.from(bytes));
            return file;
        }
    };
}

const SETTINGS_DIR = "/etc/phoenix/connectors";
const FILES_DIR = "/media/internal/.phoenix/connector-files";
// The helper programs a first-party connector may start: the image installs
// them (meta-phoenix), a connector package cannot bring one (rule C12).
const HELPERS: Record<string, string> = {
    "phoenix-tdjson": "/usr/bin/phoenix-tdjson",
    "deltachat-rpc-server": "/usr/bin/deltachat-rpc-server"
};

/** Node's net, tls and dns (and WebSocket where Node has it, 22 and later) as Environment.net. */
export function nodeNet(): Json {
    const net = require("net");
    const tls = require("tls");
    const dns = require("dns");
    function wrap(sock: Json, framing: "stream", secure: boolean): Json {
        let current = sock;
        const dataFns: ((t: string) => void)[] = [];
        const closeFns: ((e?: Error) => void)[] = [];
        let closed = false;
        function attach(s: Json): void {
            s.setEncoding("utf8");
            s.on("data", (t: string) => { if (s === current) dataFns.forEach((f) => f(t)); });
            s.on("error", (e: Error) => { if (s === current && !closed) { closed = true; closeFns.forEach((f) => f(e)); } });
            s.on("close", () => { if (s === current && !closed) { closed = true; closeFns.forEach((f) => f()); } });
        }
        attach(sock);
        const out: Json = {
            framing, secure,
            write: (d: string) => current.write(d),
            onData: (f: (t: string) => void) => { dataFns.push(f); },
            onClose: (f: (e?: Error) => void) => { closeFns.push(f); },
            close: () => current.end(),
            // STARTTLS: the same socket wrapped in TLS, the certificate checked for servername.
            startTls: (servername: string) => new Promise<void>((resolve, reject) => {
                const plain = current;
                plain.removeAllListeners("data");
                const t = tls.connect({ socket: plain, servername, ALPNProtocols: undefined }, () => {
                    out.secure = true;
                    resolve();
                });
                current = t;
                t.once("error", reject);
                attach(t);
            })
        };
        return out;
    }
    const env: Json = {
        resolveSrv: (name: string) => new Promise((resolve, reject) => {
            dns.resolveSrv(name, (err: Error | null, recs: Json[]) => err ? reject(err) : resolve(recs));
        }),
        connect: (o: Json) => new Promise((resolve, reject) => {
            const s = o.tls ? tls.connect({ host: o.host, port: o.port, servername: o.servername || o.host, ALPNProtocols: ["xmpp-client"] })
                            : net.connect({ host: o.host, port: o.port });
            const ready = o.tls ? "secureConnect" : "connect";
            s.setTimeout(30000, () => s.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
            s.once(ready, () => { s.setTimeout(0); resolve(wrap(s, "stream", !!o.tls)); });
            s.once("error", reject);
        })
    };
    const WS = (globalThis as Json).WebSocket;
    if (WS) {
        env.websocket = (url: string, protocols?: string[]) => new Promise((resolve, reject) => {
            const ws = new WS(url, protocols);
            const dataFns: ((t: string) => void)[] = [], closeFns: ((e?: Error) => void)[] = [];
            ws.onopen = () => resolve({
                framing: "message", secure: /^wss:/.test(url),
                write: (d: string) => ws.send(d), close: () => ws.close(),
                onData: (f: (t: string) => void) => { dataFns.push(f); }, onClose: (f: (e?: Error) => void) => { closeFns.push(f); }
            });
            ws.onerror = () => reject(Object.assign(new Error("Could not connect to " + url), { code: "ECONNREFUSED" }));
            ws.onmessage = (m: Json) => dataFns.forEach((f) => f(String(m.data)));
            ws.onclose = () => closeFns.forEach((f) => f());
        });
    }
    return env;
}

function nodeHelper(name: string, args: string[]): Json {
    const file = HELPERS[name];
    const fs = require("fs");
    if (!file || !fs.existsSync(file))
        throw Object.assign(new Error(name + " is not installed on this device"), { errorCode: "HELPER_NOT_AVAILABLE" });
    const child = require("child_process").spawn(file, args, { stdio: ["pipe", "pipe", "inherit"] });
    const lineFns: ((l: string) => void)[] = [], exitFns: ((c: number | null) => void)[] = [];
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (t: string) => {
        buf += t;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (line.trim()) lineFns.forEach((f) => f(line));
        }
    });
    child.on("exit", (code: number | null) => exitFns.forEach((f) => f(code)));
    return {
        send: (line: string) => child.stdin.write(line + "\n"),
        onLine: (f: (l: string) => void) => { lineFns.push(f); },
        onExit: (f: (c: number | null) => void) => { exitFns.push(f); },
        kill: () => child.kill()
    };
}

export function runOnDevice(def: ConnectorDefinition): void {
    const Service = require("webos-service");
    const service = new Service(def.service);
    const methods = createConnectorService(def, deviceEnvironment(def, service));
    methodNames(def).forEach((name) => {
        service.register(name, (message: Json) => {
            methods[name](message.payload || {}).then((reply) => message.respond(reply));
        });
    });
}
