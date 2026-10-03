// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Decoding with zxing-wasm (MIT, github.com/Sec-ant/zxing-wasm): zxing-cpp
// (Apache-2.0) compiled to WebAssembly, the reader build only. It reads
// QR and Micro QR, Data Matrix, Aztec, PDF417, MaxiCode and the 1D codes
// (EAN/UPC, Code 128/39/93, Codabar, ITF, DataBar). Chromium's
// BarcodeDetector is not available on Linux, so it is not used.
//
// The .wasm file is bundled with the app (Vite copies it into dist/assets)
// and loaded with XMLHttpRequest: fetch() cannot read phoenix-sim's
// phoenix:// pages or a device's file:// app directory, XHR can. By
// default zxing-wasm would fetch it from a CDN; that never happens here.

import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

export interface Decoded {
    text: string;
    /** zxing's format name ("QRCode", "EAN13", ...). */
    format: string;
}

export const READER_OPTIONS: ReaderOptions = {
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    maxNumberOfSymbols: 1,
};

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
export function prepareDecoder(wasmBinary?: ArrayBuffer): void {
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
                    .catch((e) => console.error("[scanner]", e));
                return {};
            },
        },
    });
}

/** The first code in an image, or null. */
export async function decode(image: ImageData | Blob): Promise<Decoded | null> {
    prepareDecoder();
    const results = await readBarcodes(image, READER_OPTIONS);
    const r = results.find((x) => x.isValid && x.text);
    return r ? { text: r.text, format: r.format } : null;
}
