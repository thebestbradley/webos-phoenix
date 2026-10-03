// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Builds an installable webOS app into dist/: index.html, appinfo.json,
// icons and wallpapers (from public/), and hashed JS/CSS/images with
// relative paths, so it runs from /usr/palm/applications/<id>/ in
// phoenix-sim, tools/serve-rootfs.py or on a device.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
    plugins: [react()],
    base: "./",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // WebAppMgr on OSE and Qt WebEngine 6.4+ are both recent Chromium.
        target: "chrome100",
        assetsInlineLimit: 0,
    },
    server: {
        fs: { allow: [resolve(import.meta.dirname, "../..")] },
    },
});
