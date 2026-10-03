// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The folder's notes. On a tablet the open note is beside them; on a phone
// a note opens as its own page (NotePage), pushed with the mode's
// transition. Turning a tablet to portrait while a note is open opens it
// as that page; NotePage comes back here when it turns wide again.

import { IonPage, useIonRouter, useIonViewWillEnter, useIonViewWillLeave } from "@ionic/react";
import { useEffect, useState } from "react";

import { NoteEditor } from "../components/NoteEditor";
import { NoteList } from "../components/NoteList";
import { useNotes } from "../context";

export function Home() {
    const { app, wide } = useNotes();
    const router = useIonRouter();
    const [visible, setVisible] = useState(true);
    useIonViewWillEnter(() => setVisible(true));
    useIonViewWillLeave(() => setVisible(false));

    const selectedId = app.selected?._id;
    useEffect(() => {
        if (visible && !wide && selectedId) router.push(`/note/${selectedId}`, "forward");
    }, [visible, wide, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <IonPage>
            {wide ? (
                <div className="columns">
                    <div className="pane list-pane">
                        <NoteList onOpen={app.select} />
                    </div>
                    <div className="pane note-pane">
                        <NoteEditor page={false} />
                    </div>
                </div>
            ) : (
                <NoteList onOpen={app.select} />
            )}
        </IonPage>
    );
}
