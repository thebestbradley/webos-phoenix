// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Builds the published package into dist/:
//   index.js, testing.js   ES modules for bundlers (the luna code they use bundled in)
//   phoenix-sdk.js         `vite build --mode iife`: one script for apps with no
//                          bundler, the API as the global `Phoenix`
// tsconfig.build.json writes the declarations.

import { defineConfig } from "vite";
import { resolve } from "node:path";

const src = (p: string) => resolve(import.meta.dirname, "src", p);

export default defineConfig(({ mode }) => ({
    build: {
        outDir: "dist",
        emptyOutDir: mode !== "iife",
        target: "chrome87",
        minify: mode === "iife",
        sourcemap: true,
        lib: mode === "iife"
            ? { entry: src("index.ts"), name: "Phoenix", formats: ["iife" as const], fileName: () => "phoenix-sdk.js" }
            : { entry: { index: src("index.ts"), testing: src("testing.ts") }, formats: ["es" as const] },
    },
}));
