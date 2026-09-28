// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        include: ["shared/*/src/**/*.test.{ts,tsx}", "settings/src/**/*.test.{ts,tsx}",
                  "{phone,messaging,camera,photos,music,files}/src/**/*.test.{ts,tsx}", "files/service/**/*.test.ts",
                  "dav/service/**/*.test.ts"],
    },
});
