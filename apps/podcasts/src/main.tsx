// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Refreshed } from "@phoenix/luna/react";
import "@phoenix/ui/styles.css";
import "./podcasts.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Refreshed>
            <App />
        </Refreshed>
    </StrictMode>,
);

// Tell the web runtime the first frame is ready (webOS stageReady).
(globalThis as { PalmSystem?: { stageReady?: () => void } }).PalmSystem?.stageReady?.();
