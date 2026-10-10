// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app's part in the system, through the Phoenix service plugin:
//
//   - The app menu (the status bar's app name): Edit and Share first, as in
//     every Phoenix app, then New Note and Settings (@phoenix/react's
//     useAppMenu). Share shares the open note, the Capacitor way
//     (Phoenix.share from @phoenix/capacitor).
//   - Receiving shares: appinfo.json's shareTargets take text and links;
//     each becomes a new note (Phoenix.addListener("share")).
//   - Just Type: appinfo.json's universalSearch action "New Note" launches
//     the app with {newNote: "<the words typed>"} (useJustTypeAction).

import { useIonRouter } from "@ionic/react";
import { Phoenix } from "@phoenix/capacitor";
import { noteFromShare, shareOfNote, type NotesApp } from "@phoenix/notes-core";
import { useAppMenu, useJustTypeAction } from "@phoenix/react";
import { useEffect, useRef } from "react";

/** Runs fn once the notes are loaded (a share at launch comes before them). */
function useWhenLoaded(app: NotesApp) {
    const queue = useRef<(() => void)[]>([]);
    // A ref: listeners added once keep this function, and must see it load.
    const loaded = useRef(app.loaded);
    loaded.current = app.loaded;
    useEffect(() => {
        if (!app.loaded) return;
        for (const f of queue.current.splice(0)) f();
    }, [app.loaded]);
    return (f: () => void) => { if (loaded.current) f(); else queue.current.push(f); };
}

export function PhoenixIntegration({ app }: { app: NotesApp }) {
    const router = useIonRouter();
    const whenLoaded = useWhenLoaded(app);
    const appRef = useRef(app);
    appRef.current = app;

    useAppMenu({
        items: [
            { label: "New Note", onSelect: () => void app.newNote() },
            { label: "Settings", onSelect: () => router.push("/settings", "forward") },
        ],
        // The open note (dimmed when none is open).
        share: () => (app.selected ? shareOfNote(app.draft) : null),
        onShare: (content) => void Phoenix.share(content).catch(() => {}),
    });

    useEffect(() => {
        const handle = Phoenix.addListener("share", (s) => {
            const body = noteFromShare(s);
            if (body) whenLoaded(() => void appRef.current.newNote(body));
        });
        return () => { void handle.then((h) => h.remove()); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useJustTypeAction("newNote", (text) => whenLoaded(() => void appRef.current.newNote(text)));
    return null;
}
