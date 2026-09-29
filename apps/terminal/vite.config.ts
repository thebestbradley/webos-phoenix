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
        // xterm.js is most of the bundle; it is one app, loaded from the device.
        chunkSizeWarningLimit: 800,
    },
    server: {
        fs: { allow: [resolve(__dirname, "../..")] },
    },
});
