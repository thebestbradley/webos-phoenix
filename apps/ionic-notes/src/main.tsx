// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { setupIonicReact } from "@ionic/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Ionic's required CSS, its optional utilities used here, and the dark
// palette switched by a class (Settings > Appearance).
import "@ionic/react/css/core.css";
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";
import "@ionic/react/css/padding.css";
import "@ionic/react/css/text-alignment.css";
import "@ionic/react/css/palettes/dark.class.css";
import "./notes.css";

import { App } from "./App";
import { readStyle } from "./settings";

// The mode (iOS or Material Design) is fixed when Ionic starts, so a change
// in Settings reloads the app. Ionic's hardware back button (on by default
// only in Capacitor apps) takes the webOS back gesture: see below.
setupIonicReact({ mode: readStyle().mode, hardwareBackButton: true });

// webOS's back gesture reaches a web app as the Escape key. Ionic's own
// overlays close on Escape; otherwise it becomes Ionic's back button, which
// closes the side menu, then goes back a page (the note, Settings).
const OVERLAYS = ["ion-modal", "ion-popover", "ion-alert", "ion-action-sheet", "ion-loading", "ion-picker"]
    .map((tag) => `${tag}:not(.overlay-hidden)`).join(", ");
window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(OVERLAYS)) return;
    e.preventDefault();
    document.dispatchEvent(new Event("backbutton"));
});

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

// Tell the web runtime the first frame is ready (webOS stageReady).
(globalThis as { PalmSystem?: { stageReady?: () => void } }).PalmSystem?.stageReady?.();
