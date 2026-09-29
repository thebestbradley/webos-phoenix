// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Builds an installable webOS app into dist/ (see apps/settings/vite.config.ts),
// plus dist/help-index.json: every topic's id, title, summary and search
// text, which is put into db8 (org.webosphoenix.helptopic:1) for Just Type.

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildIndex, parseTopic } from "./src/lib/topics";

function helpIndex(): Plugin {
    return {
        name: "phoenix-help-index",
        generateBundle() {
            const dir = resolve(__dirname, "topics");
            const topics = readdirSync(dir).filter((f) => f.endsWith(".md"))
                .map((f) => parseTopic(f, readFileSync(resolve(dir, f), "utf8")));
            this.emitFile({ type: "asset", fileName: "help-index.json", source: JSON.stringify(buildIndex(topics), null, 1) });
        },
    };
}

export default defineConfig({
    plugins: [react(), helpIndex()],
    base: "./",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "chrome100",
        assetsInlineLimit: 0,
    },
    server: {
        fs: { allow: [resolve(__dirname, "../..")] },
    },
});
