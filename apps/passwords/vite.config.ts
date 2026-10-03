// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Builds an installable webOS app into dist/ (see apps/settings/vite.config.ts).
//
// kdbxweb's UMD build requires Node's "crypto" and @xmldom/xmldom, but only
// uses them where the page has no WebCrypto, DOMParser or XMLSerializer:
// never in the web runtime. They are replaced by a stub that throws, so
// neither ships in the app (@xmldom/xmldom 0.7 has open advisories; see
// docs/SECURITY-APPS.md).

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const stub = resolve(import.meta.dirname, "src/node-stub.ts");

// index.html's Content-Security-Policy forbids inline scripts, which the dev
// server's hot reload needs: drop it under `vite` (dev) only; builds keep it.
const devCsp = {
    name: "phoenix-dev-csp",
    apply: "serve" as const,
    transformIndexHtml: (html: string) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/s, ""),
};

export default defineConfig({
    plugins: [react(), devCsp],
    base: "./",
    resolve: {
        alias: { "@xmldom/xmldom": stub, crypto: stub },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "chrome100",
        assetsInlineLimit: 0,
    },
    server: {
        fs: { allow: [resolve(import.meta.dirname, "../..")] },
    },
});
