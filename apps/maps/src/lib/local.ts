// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Reading the app's own files (the demo region, glyphs, providers.json)
// with XHR rather than fetch: phoenix-sim's phoenix:// scheme only serves
// XHR and elements, and a webOS web app runs from file://, which fetch
// cannot read either (apps/voicememos/src/samples.ts does the same).

export function getLocal(url: string, type: "json"): Promise<unknown>;
export function getLocal(url: string, type: "arraybuffer"): Promise<ArrayBuffer | null>;
export function getLocal(url: string, type: "text"): Promise<string>;
export function getLocal(url: string, type: "json" | "arraybuffer" | "text"): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const req = new XMLHttpRequest();
        req.open("GET", url, true);
        req.responseType = type === "arraybuffer" ? "arraybuffer" : "text";
        req.onload = () => {
            // file:// and phoenix:// answer status 0.
            const okStatus = (req.status >= 200 && req.status < 300) || req.status === 0;
            if (type === "arraybuffer") {
                const buf = req.response as ArrayBuffer | null;
                resolve(okStatus && buf && buf.byteLength ? buf : null);
            } else if (!okStatus) reject(new Error(`${url}: ${req.status}`));
            else if (type === "json") {
                try { resolve(JSON.parse(req.responseText)); } catch (e) { reject(e); }
            } else resolve(req.responseText);
        };
        req.onerror = () => (type === "arraybuffer" ? resolve(null) : reject(new Error(`${url}: not found`)));
        req.send();
    });
}
