// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// HTTP for apps that read other sites (Podcasts' feeds and directory
// search, the viewers opening a link from the browser), and the
// download manager.
//
//   HTTP: on a device the page fetches directly (a webOS app page may
//       read other origins, as legacy webOS allowed). The simulator
//       offers __phoenixRuntime.http.request, which sends the request
//       through tools/serve-rootfs.py's proxy when the page is served over
//       HTTP (feeds rarely allow cross-origin requests) and fetches
//       directly otherwise (phoenix-sim's phoenix:// pages, which only
//       reach servers that send CORS headers).
//   com.webos.service.downloadmanager   OSE (webosose/com.webos.service.
//       downloadmanager, the legacy com.palm.downloadmanager API):
//       download {target, targetDir, targetFilename, subscribe} -> {ticket,
//       subscribed}, then progress {ticket, amountReceived, amountTotal}
//       and finally {ticket, completed: true, completionStatusCode, destPath,
//       destFile, target} (or interrupted / aborted); cancelDownload {ticket}.

import { call, subscribe, LunaError, type Subscription } from "./bridge";

export interface HttpRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** Answer the body as bytes (base64 through the simulator's proxy). */
    binary?: boolean;
    /** Follow redirects (the default; feeds and enclosures move a lot). */
    follow?: boolean;
}

export interface HttpResponse {
    status: number;
    /** Lower-case names. */
    headers: Record<string, string>;
    /** The body as text (binary: false). */
    text: string;
    /** The body (binary: true). */
    bytes?: Uint8Array;
    /** The URL after redirects. */
    url: string;
}

interface RuntimeHttp {
    request(req: HttpRequest): Promise<{ status: number; headers: Record<string, string>; body?: string; bodyBase64?: string; url?: string }>;
}

function runtimeHttp(): RuntimeHttp | undefined {
    const rt = (globalThis as { __phoenixRuntime?: { onDevice?: boolean; http?: RuntimeHttp } }).__phoenixRuntime;
    return rt && !rt.onDevice ? rt.http : undefined;
}

export function fromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i);
    return out;
}

/** One HTTP request. Rejects when the server cannot be reached; any status resolves. */
export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
    const r = { method: "GET", follow: true, ...req };
    const rt = runtimeHttp();
    if (rt) {
        const res = await rt.request(r);
        const bytes = r.binary ? (res.bodyBase64 !== undefined ? fromBase64(res.bodyBase64) : new TextEncoder().encode(res.body ?? "")) : undefined;
        return { status: res.status, headers: res.headers ?? {}, text: r.binary ? "" : res.body ?? "", bytes, url: res.url ?? r.url };
    }
    const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body, redirect: r.follow ? "follow" : "manual", credentials: "omit" });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    if (r.binary) return { status: res.status, headers, text: "", bytes: new Uint8Array(await res.arrayBuffer()), url: res.url || r.url };
    return { status: res.status, headers, text: await res.text(), url: res.url || r.url };
}

/** GET a text resource; rejects on a status other than 2xx. */
export async function httpText(url: string, headers?: Record<string, string>): Promise<string> {
    const res = await httpRequest({ url, headers });
    if (res.status < 200 || res.status > 299) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text;
}

/** GET bytes; rejects on a status other than 2xx. */
export async function httpBytes(url: string): Promise<Uint8Array> {
    const res = await httpRequest({ url, binary: true });
    if (res.status < 200 || res.status > 299) throw new Error(`${url}: HTTP ${res.status}`);
    return res.bytes ?? new Uint8Array(0);
}

// ---- Download manager ---------------------------------------------------------------

export interface DownloadStatus {
    ticket?: number;
    amountReceived?: number;
    amountTotal?: number;
    completed?: boolean;
    completionStatusCode?: number;
    interrupted?: boolean;
    aborted?: boolean;
    destPath?: string;
    destFile?: string;
    /** The file (on completion). */
    target?: string;
}

const DM = "luna://com.webos.service.downloadmanager";

export interface DownloadHandle {
    /** Settles with the finished file's path, or rejects (failed, cancelled). */
    done: Promise<string>;
    cancel(): void;
}

export const downloadManager = {
    /**
     * download {target: url, targetDir, targetFilename, subscribe}: progress
     * goes to onProgress (0..1, or -1 when the size is unknown).
     */
    download(url: string, targetDir: string, targetFilename: string, onProgress?: (fraction: number, s: DownloadStatus) => void): DownloadHandle {
        let ticket: number | undefined;
        let sub: Subscription | null = null;
        let settle: { resolve: (p: string) => void; reject: (e: Error) => void } | null = null;
        const done = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
        const finish = (err: Error | null, path = "") => {
            sub?.cancel();
            if (!settle) return;
            const s = settle;
            settle = null;
            if (err) s.reject(err); else s.resolve(path);
        };
        sub = subscribe(`${DM}/download`, { target: url, targetDir, targetFilename }, (r) => {
            const s = r as DownloadStatus;
            if (s.ticket !== undefined) ticket = s.ticket;
            if (s.completed) {
                const code = s.completionStatusCode ?? 200;
                if (s.interrupted || s.aborted || code >= 400 || code < 0) finish(new Error(s.aborted ? "Cancelled" : `Download failed (${code})`));
                else finish(null, s.target ?? (s.destPath ?? targetDir + "/") + (s.destFile ?? targetFilename));
            } else if (s.amountReceived !== undefined) {
                onProgress?.(s.amountTotal ? s.amountReceived / s.amountTotal : -1, s);
            } else if (s.interrupted || s.aborted) {
                finish(new Error(s.aborted ? "Cancelled" : "Download interrupted"));
            }
        }, (e: LunaError) => finish(e));
        return {
            done,
            cancel() {
                if (ticket !== undefined) void call(`${DM}/cancelDownload`, { ticket }).catch(() => {});
                finish(new Error("Cancelled"));
            },
        };
    },
};
