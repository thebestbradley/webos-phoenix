// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@phoenix/ui/styles.css";
import "./tasks.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

// Tell the web runtime the first frame is ready (webOS stageReady).
(globalThis as { PalmSystem?: { stageReady?: () => void } }).PalmSystem?.stageReady?.();
