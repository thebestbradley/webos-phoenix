// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The real decoder (zxing-wasm's reader) on codes drawn by zxing-wasm's
// writer (test only; the app ships the reader alone).

// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareZXingModule as prepareWriter, writeBarcode } from "zxing-wasm/writer";
import { decode, prepareDecoder } from "./decode";
import { parseContent } from "./content";

const require = createRequire(import.meta.url);
const wasm = (name: string) => {
    const b = readFileSync(require.resolve(`zxing-wasm/${name}/zxing_${name}.wasm`));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(() => {
    prepareDecoder(wasm("reader"));
    prepareWriter({ overrides: { wasmBinary: wasm("writer") } });
});

describe("decoding", () => {
    it("reads a Wi-Fi QR code", async () => {
        const w = await writeBarcode("WIFI:T:WPA;S:Phoenix Lab;P:webos2009;;", { format: "QRCode", scale: 4 });
        const d = await decode(w.image!);
        expect(d).toEqual({ text: "WIFI:T:WPA;S:Phoenix Lab;P:webos2009;;", format: "QRCode" });
        expect(parseContent(d!.text, d!.format)).toMatchObject({ kind: "wifi", ssid: "Phoenix Lab" });
    });

    it("reads an EAN-13 barcode as a product code", async () => {
        const w = await writeBarcode("4006381333931", { format: "EAN13", scale: 3 });
        const d = await decode(w.image!);
        expect(d?.format).toBe("EAN13");
        expect(parseContent(d!.text, d!.format)).toEqual({ kind: "product", code: "4006381333931" });
    });

    it("finds nothing in a blank picture", async () => {
        // A camera frame (ImageData) of plain grey.
        const gray = { data: new Uint8ClampedArray(64 * 64 * 4).fill(200), width: 64, height: 64, colorSpace: "srgb" } as unknown as ImageData;
        expect(await decode(gray)).toBeNull();
    });
});
