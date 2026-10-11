// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A QR code (the Phoenix Account sign-in's address), drawn as DropShare draws
// its own (apps/dropshare/src/qr.ts), with zxing-wasm's writer (MIT,
// github.com/Sec-ant/zxing-wasm: zxing-cpp, Apache-2.0, compiled to
// WebAssembly), as QR Scanner reads codes with its reader. The .wasm file
// is bundled with the app and loaded with XMLHttpRequest, which reads
// phoenix-sim's phoenix:// pages and a device's file:// app folder (see
// apps/scanner/src/lib/decode.ts); it is never fetched from a CDN.

import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import wasmUrl from "zxing-wasm/writer/zxing_writer.wasm?url";

function loadBytes(url: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const req = new XMLHttpRequest();
        req.open("GET", url, true);
        req.responseType = "arraybuffer";
        req.onload = () => (req.status === 0 || (req.status >= 200 && req.status < 300)) && req.response
            ? resolve(req.response as ArrayBuffer) : reject(new Error(`zxing: ${req.status} for ${url}`));
        req.onerror = () => reject(new Error(`zxing: cannot load ${url}`));
        req.send();
    });
}

let prepared = false;

/** Set up the module once. `wasmBinary` is for tests (Node has no XHR to the file). */
export function prepareWriter(wasmBinary?: ArrayBuffer): void {
    if (prepared) return;
    prepared = true;
    if (wasmBinary) {
        prepareZXingModule({ overrides: { wasmBinary } });
        return;
    }
    prepareZXingModule({
        overrides: {
            instantiateWasm(imports: WebAssembly.Imports, success: (i: WebAssembly.Instance) => void) {
                const url = new URL(wasmUrl, document.baseURI).href;
                loadBytes(url)
                    .then((bytes) => WebAssembly.instantiate(bytes, imports))
                    .then((r) => success(r.instance))
                    .catch((e) => console.error("[settings]", e));
                return {};
            },
        },
    });
}

/**
 * zxing's SVG as an element that scales: its fixed pixel size (one per
 * module) becomes a viewBox, the modules stay sharp, and the XML prolog
 * goes (the element is put into the page).
 */
export function scalableSvg(svg: string): string {
    const body = svg.replace(/<\?xml[^>]*>/, "").replace(/<!DOCTYPE[^>]*>/i, "").trim();
    return body.replace(/<svg([^>]*)>/, (_all, attrs: string) => {
        const w = /\swidth="([\d.]+)"/.exec(attrs)?.[1] ?? "0";
        const h = /\sheight="([\d.]+)"/.exec(attrs)?.[1] ?? "0";
        const rest = attrs.replace(/\s(width|height)="[^"]*"/g, "");
        return `<svg${rest} viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">`;
    });
}

/** The address as a QR code, an SVG element (medium error correction). */
export async function qrSvg(text: string): Promise<string> {
    prepareWriter();
    const r = await writeBarcode(text, { format: "QRCode", options: "ecLevel=M" });
    if (r.error || !r.svg) throw new Error(r.error || "No QR code");
    return scalableSvg(r.svg);
}
