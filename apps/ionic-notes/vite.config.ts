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
    resolve: {
        // notes-core and the Phoenix service plugin from their sources, as
        // tsconfig.json's paths.
        alias: {
            "@phoenix/notes-core": resolve(import.meta.dirname, "../shared/notes-core/src/index.ts"),
            "@phoenix/sdk": resolve(import.meta.dirname, "../shared/sdk/src/index.ts"),
            "@phoenix/react": resolve(import.meta.dirname, "../shared/react/src/index.ts"),
            "@phoenix/capacitor": resolve(import.meta.dirname, "../shared/capacitor/src/index.ts"),
        },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "chrome100",
        assetsInlineLimit: 0,
        // @ionic/react does not mark itself free of side effects, so every
        // Ionic component ships (about 1.5 MB, 350 kB gzipped; README.md).
        // Loaded from the device, not a network, so it is not split.
        chunkSizeWarningLimit: 1600,
    },
    server: {
        fs: { allow: [resolve(import.meta.dirname, "../..")] },
    },
});
