// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "@phoenix/ui/styles.css";
import "./terminal.css";
import { App } from "./App";

type Palm = { stageReady?: () => void; setWindowOrientation?: (o: string) => void };
const palm = (globalThis as { PalmSystem?: Palm }).PalmSystem;

// Turn with the device; the terminal reflows to the new width.
palm?.setWindowOrientation?.("free");

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

// Tell the web runtime the first frame is ready (webOS stageReady).
palm?.stageReady?.();
