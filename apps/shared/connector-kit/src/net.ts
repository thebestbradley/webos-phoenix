// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// ctx.net: the sockets a connector may open (docs/SYNERGY-SDK.md "Staying
// connected"), over what the host gives (Environment.net: a device's Node
// net, tls and dns; the simulator's WebSocket). The same rule as ctx.http
// (docs/SYNERGY-CONNECTORS.md 3.2 rule 8): only the user's server, the
// hosts the definition names, and the targets the SRV records of those
// name. While the server asked the account to wait (the backoff the kit
// keeps, a rate limit or a policy-violation), no connection is opened.

import * as synckit from "@phoenix/synckit";
import type { Net, NetEnvironment, NetSocket, SrvRecord } from "./types";

function refused(message: string, errorCode: string): Error {
    return synckit.syncError(message, errorCode);
}

export function createNet(options: {
    env?: NetEnvironment; hosts: string[]; backoff?: { retryAt: number }; now: () => number;
}): Net {
    const env = options.env || {};
    const hosts = options.hosts.slice();
    const allowed = (host: string) => hosts.some((p) => synckit.hostMatches(p, host.toLowerCase()));
    function waiting(): void {
        const b = options.backoff;
        if (b && b.retryAt && b.retryAt > options.now()) {
            const e = refused("The server asked to wait", "503_SERVICE_UNAVAILABLE") as Error & { retryAt?: number };
            e.retryAt = b.retryAt;
            throw e;
        }
    }
    return {
        supports: { srv: !!env.resolveSrv, tcp: !!env.connect, websocket: !!env.websocket },
        allowHost(host: string) { if (host && !allowed(host)) hosts.push(host.toLowerCase()); },
        async resolveSrv(name: string): Promise<SrvRecord[]> {
            const domain = name.replace(/^_[^.]+\._[^.]+\./, "");
            if (!allowed(domain)) throw refused("Not this account's server: " + domain, "PERMISSION_DENIED");
            if (!env.resolveSrv) return [];
            let records: SrvRecord[] = [];
            try { records = await env.resolveSrv(name); } catch (e) { records = []; }
            // RFC 2782: "." alone means no service here.
            records = records.filter((r) => r.name && r.name !== ".");
            records.forEach((r) => { if (!allowed(r.name)) hosts.push(r.name.toLowerCase()); });
            return records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
        },
        async connect(o): Promise<NetSocket> {
            if (!env.connect) throw refused("This device cannot open a connection to " + o.host, "UNSUPPORTED");
            if (!allowed(o.host)) throw refused("Not this account's server: " + o.host, "PERMISSION_DENIED");
            waiting();
            return env.connect(o);
        },
        async websocket(url: string, protocols?: string[]): Promise<NetSocket> {
            if (!env.websocket) throw refused("WebSockets are not available here", "UNSUPPORTED");
            let host = "";
            try { host = new URL(url).host; } catch (e) { host = ""; }
            if (!/^wss?:\/\//.test(url) || !host) throw refused("Not a WebSocket address: " + url, "400_BAD_REQUEST");
            if (!allowed(host) && !allowed(host.replace(/:\d+$/, ""))) throw refused("Not this account's server: " + host, "PERMISSION_DENIED");
            waiting();
            return env.websocket(url, protocols);
        }
    };
}
