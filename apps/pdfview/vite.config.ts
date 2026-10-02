// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Builds an installable webOS app into dist/ (see apps/settings/vite.config.ts).
// PDF.js's standard fonts and CMaps go to dist/pdfjs/, where engine.ts
// points PDF.js (pdfjs-dist, Apache-2.0; its LICENSE goes with them). The
// WebAssembly image decoders of PDF.js 5 and later would go there too.

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const pdfjsDir = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

function pdfjsAssets(): Plugin {
    let outDir = "dist";
    return {
        name: "phoenix-pdfjs-assets",
        apply: "build",
        configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
        writeBundle() {
            for (const dir of ["standard_fonts", "cmaps", "wasm"]) {
                const from = resolve(pdfjsDir, dir);
                if (existsSync(from)) cpSync(from, resolve(outDir, "pdfjs", dir), { recursive: true });
            }
            cpSync(resolve(pdfjsDir, "LICENSE"), resolve(outDir, "pdfjs", "LICENSE"));
        },
    };
}

export default defineConfig({
    plugins: [react(), pdfjsAssets()],
    base: "./",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "chrome100",
        assetsInlineLimit: 0,
        chunkSizeWarningLimit: 2000,
    },
    server: {
        fs: { allow: [resolve(import.meta.dirname, "../..")] },
    },
});
