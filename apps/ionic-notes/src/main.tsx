// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { setupIonicReact } from "@ionic/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Phoenix } from "@phoenix/capacitor";
import { Refreshed } from "@phoenix/react";
import { app } from "@phoenix/sdk";

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

// webOS's back gesture, through the Phoenix service plugin (app.onBack).
// Ionic's own overlays close on it (they hear the Escape key it arrives
// as); otherwise it becomes Ionic's back button, which closes the side
// menu, then goes back a page (the note, Settings). At the notes list with
// the menu closed the app does not take it, and the system minimizes the
// card (webOS's Back at an app's top level).
const OVERLAYS = ["ion-modal", "ion-popover", "ion-alert", "ion-action-sheet", "ion-loading", "ion-picker"]
    .map((tag) => `${tag}:not(.overlay-hidden)`).join(", ");
app.onBack(() => {
    if (document.querySelector(OVERLAYS)) return true;
    const route = location.hash.replace(/^#/, "") || "/";
    if (route === "/" && !document.querySelector("ion-menu.show-menu")) return false;
    document.dispatchEvent(new Event("backbutton"));
    return true;
});

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Refreshed>
            <App />
        </Refreshed>
    </StrictMode>,
);

// Tell the system the first frame is ready (webOS stageReady), the Capacitor way.
void Phoenix.stageReady();
