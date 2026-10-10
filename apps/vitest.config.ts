// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
    plugins: [react()],
    // The Synergy kit's sources (shared/synckit is plain CommonJS; the
    // connector kit is TypeScript, built to lib/ only for devices and the
    // simulator), so its tests and the connectors' run without a build.
    resolve: {
        alias: [
            { find: /^@phoenix\/synckit$/, replacement: here("./shared/synckit/src/index.js") },
            { find: /^@phoenix\/synckit\/(.*)$/, replacement: here("./shared/synckit/") + "$1" },
            { find: /^@phoenix\/connector-kit$/, replacement: here("./shared/connector-kit/src/index.ts") },
        ],
    },
    test: {
        environment: "jsdom",
        setupFiles: ["./vitest.setup.ts"],
        include: ["shared/*/src/**/*.test.{ts,tsx}", "settings/src/**/*.test.{ts,tsx}",
                  "{phone,messaging,camera,photos,music,files,tasks,voicememos,flashlight,scanner,weather,maps,passwords,authenticator,terminal,videos,podcasts,pdfview,docview,help,firstuse,screenshot,notificationlab,agenda,printmanager,voicedial,clipboard,assistant,dropshare,marketplace}/src/**/*.test.{ts,tsx}",
                  "{files,voicememos,dav,fediverse,settings,marketplace,assistant}/service/**/*.test.ts",
                  "../services/updates/**/*.test.ts", "../services/hardware/**/*.test.ts",
                  "../services/systemmanager/**/*.test.ts", "../services/clipboard/**/*.test.ts"],
    },
});
