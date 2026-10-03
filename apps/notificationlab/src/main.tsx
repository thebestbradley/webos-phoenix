// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@phoenix/ui/styles.css";
import "./notificationlab.css";
import { Alert, App, Dashboard } from "./App";

// The same page is the card, its dashboards and its alerts (?view=).
const view = new URLSearchParams(location.search).get("view");
if (view)
    document.body.classList.add("nl-window", "nl-" + view);

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        {view === "dashboard" ? <Dashboard /> : view === "alert" ? <Alert /> : <App />}
    </StrictMode>,
);

// Tell the web runtime the first frame is ready (webOS stageReady).
(globalThis as { PalmSystem?: { stageReady?: () => void } }).PalmSystem?.stageReady?.();
