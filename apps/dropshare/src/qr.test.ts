// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// DropShare's QR code: an SVG element that scales, and a code that reads
// back as the address (zxing-wasm's reader, as QR Scanner reads codes).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareZXingModule as prepareReader, readBarcodes } from "zxing-wasm/reader";
import { writeBarcode } from "zxing-wasm/writer";
import { prepareWriter, qrSvg, scalableSvg } from "./qr";

const wasm = (p: string) => {
    const b = readFileSync(resolve(__dirname, "../../node_modules/zxing-wasm/dist", p));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("DropShare's QR code", () => {
    it("makes zxing's fixed-size SVG scale, sharp", () => {
        const s = scalableSvg('<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "x" "y">\n<svg width="33" height="33" version="1.1" xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
        expect(s.startsWith("<svg")).toBe(true);
        expect(s).toContain('viewBox="0 0 33 33"');
        expect(s).toContain('shape-rendering="crispEdges"');
        expect(s).not.toMatch(/\swidth="33"/);
    });

    it("draws the address as a code that reads back as it", async () => {
        prepareWriter(wasm("writer/zxing_writer.wasm"));
        prepareReader({ overrides: { wasmBinary: wasm("reader/zxing_reader.wasm") } });
        const url = "http://192.168.1.20:40199/hotjrzqnKQib4othVYffKw/";
        const svg = await qrSvg(url);
        expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 \d+ \d+"/);
        const png = await writeBarcode(url, { format: "QRCode", options: "ecLevel=M", scale: 4 });
        // jsdom's Blob has no arrayBuffer(): the PNG's bytes through FileReader.
        const bytes = await new Promise<ArrayBuffer>((res) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result as ArrayBuffer);
            fr.readAsArrayBuffer(png.image!);
        });
        const read = await readBarcodes(new Uint8Array(bytes), { formats: ["QRCode"] });
        expect(read[0]?.text).toBe(url);
    });
});
