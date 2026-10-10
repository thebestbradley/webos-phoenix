// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes (Ionic): the Notes demo in Ionic Framework's React components, for
// phones and tablets. Ionic's split pane keeps the folders beside the notes
// on a tablet and makes them a side menu on a phone; its router outlet
// stacks the pages (a note, Settings) with each mode's transitions.

import { IonApp, IonRouterOutlet, IonSplitPane, useIonToast } from "@ionic/react";
import { IonReactHashRouter } from "@ionic/react-router";
import { isDeleted, useNotesApp } from "@phoenix/notes-core";
import { useCallback, useEffect, useMemo } from "react";
import { Navigate, Route } from "react-router-dom";

import { FolderMenu } from "./components/FolderMenu";
import { NotesContext, type NotesUi } from "./context";
import { PhoenixIntegration } from "./phoenix";
import { luna } from "./luna";
import { Home } from "./pages/Home";
import { NotePage } from "./pages/NotePage";
import { SettingsPage } from "./pages/SettingsPage";
import { APP_ID, DEFAULTS, SETTINGS_KEY, styleOf } from "./settings";
import { useWide } from "./useWide";

function Shell() {
    const app = useNotesApp({ appId: APP_ID, luna, settingsKey: SETTINGS_KEY, defaults: DEFAULTS });
    const wide = useWide();
    const [toast] = useIonToast();
    const { scheme } = styleOf(app.settings);

    // Ionic's dark palette follows the setting, or the system's.
    useEffect(() => {
        const mq = matchMedia("(prefers-color-scheme: dark)");
        const apply = () => document.documentElement.classList.toggle(
            "ion-palette-dark", scheme === "dark" || (scheme === "system" && mq.matches));
        apply();
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
    }, [scheme]);

    useEffect(() => {
        if (app.error) void toast({ message: app.error, color: "danger", duration: 4000, position: "top" });
    }, [app.error, toast]);

    // A deleted note can come back from the toast, as it can from
    // Recently Deleted. Deleting it there is for good (the caller confirms).
    const { notes, deleteNote, recover } = app;
    const deleteWithUndo = useCallback((id: string) => {
        const n = notes.find((x) => x._id === id);
        if (!n) return;
        deleteNote(id);
        if (isDeleted(n)) return;
        void toast({
            message: "Moved to Recently Deleted",
            duration: 4000,
            position: "bottom",
            buttons: [{ text: "Undo", handler: () => recover(id) }],
        });
    }, [notes, deleteNote, recover, toast]);

    const ui: NotesUi = useMemo(() => ({ app, wide, deleteWithUndo }), [app, wide, deleteWithUndo]);

    return (
        <NotesContext.Provider value={ui}>
            <IonReactHashRouter>
                <PhoenixIntegration app={app} />
                <IonSplitPane contentId="main" when="md">
                    <FolderMenu />
                    <IonRouterOutlet id="main">
                        <Route path="/" element={<Home />} />
                        <Route path="/note/:id" element={<NotePage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </IonRouterOutlet>
                </IonSplitPane>
            </IonReactHashRouter>
        </NotesContext.Provider>
    );
}

export function App() {
    return (
        <IonApp>
            <Shell />
        </IonApp>
    );
}
