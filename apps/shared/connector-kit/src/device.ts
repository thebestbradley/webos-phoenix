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
        }
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
