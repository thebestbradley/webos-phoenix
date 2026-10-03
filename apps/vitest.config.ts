// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        setupFiles: ["./vitest.setup.ts"],
        include: ["shared/*/src/**/*.test.{ts,tsx}", "settings/src/**/*.test.{ts,tsx}",
                  "{phone,messaging,camera,photos,music,files,tasks,voicememos,flashlight,scanner,weather,maps,passwords,authenticator,terminal,videos,podcasts,pdfview,docview,help,firstuse,screenshot,notificationlab,agenda,printmanager,voicedial}/src/**/*.test.{ts,tsx}",
                  "{files,voicememos,dav,settings,marketplace}/service/**/*.test.ts",
                  "../services/updates/**/*.test.ts"],
    },
});
