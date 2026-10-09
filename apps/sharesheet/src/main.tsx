// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Refreshed } from "@phoenix/luna/react";
import "@phoenix/ui/styles.css";
import "./sharesheet.css";
import { App } from "./App";
import { shareSheet, type ShareRequest } from "@phoenix/luna";

// The launcher's icon menu shares an app's link from no app's card: the
// shell opens this page by itself, see-through, with {systemShare: {title,
// url}}. It asks for the sheet as an app would (the runtime lays the sheet
// over this page and launches the app chosen), then closes its window.
const systemShare = readSystemShare();
if (systemShare) {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    void shareSheet.open(systemShare).catch(() => undefined).finally(() => window.close());
} else {
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <Refreshed>
                <App />
            </Refreshed>
        </StrictMode>,
    );
}

function readSystemShare(): ShareRequest | null {
    try {
        const raw = (globalThis as { PalmSystem?: { launchParams?: string } }).PalmSystem?.launchParams;
        const p = raw ? (JSON.parse(raw) as { systemShare?: ShareRequest }) : {};
        return p.systemShare && (p.systemShare.url || p.systemShare.text) ? p.systemShare : null;
    } catch {
        return null;
    }
}

(globalThis as { PalmSystem?: { stageReady?: () => void } }).PalmSystem?.stageReady?.();
