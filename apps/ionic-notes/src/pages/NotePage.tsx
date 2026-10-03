// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A note as its own page (phones, and tablets in portrait). Back, or the
// note going away (deleted, or removed in another app), returns to the
// list; so does the screen turning wide, where the list shows the note.

import { IonPage, useIonRouter, useIonViewWillLeave } from "@ionic/react";
import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";

import { NoteEditor } from "../components/NoteEditor";
import { useNotes } from "../context";

export function NotePage() {
    const { app, wide } = useNotes();

    const { id } = useParams<{ id: string }>();
    const router = useIonRouter();
    // The note was open here, and this page is on its way out.
    const had = useRef(false);
    const leaving = useRef(false);

    const back = () => {
        if (leaving.current) return;
        leaving.current = true;
        if (router.canGoBack()) router.goBack();
        else router.push("/", "back", "replace");
    };

    useIonViewWillLeave(() => {
        leaving.current = true;
        // Going back to the list closes the note (an empty one is dropped);
        // turning wide keeps it open beside the list.
        if (!wide) app.select(null);
    }, [wide, app.select]);

    useEffect(() => {
        if (leaving.current || !app.loaded) return;
        if (app.selected?._id === id) {
            had.current = true;
        } else if (!had.current && app.notes.some((n) => n._id === id)) {
            app.select(id ?? null); // opened by its address (a reload)
        } else {
            back();
        }
    }); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (wide) back();
    }, [wide]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <IonPage>
            <NoteEditor page />
        </IonPage>
    );
}
