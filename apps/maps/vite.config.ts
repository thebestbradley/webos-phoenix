// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Builds an installable webOS app into dist/ (see apps/settings/vite.config.ts).

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
    plugins: [react()],
    base: "./",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "chrome100",
        assetsInlineLimit: 0,
        // MapLibre GL alone is most of the bundle; the app is installed on
        // the device, not downloaded, so one chunk is fine.
        chunkSizeWarningLimit: 1600,
    },
    server: {
        fs: { allow: [resolve(import.meta.dirname, "../..")] },
    },
});
