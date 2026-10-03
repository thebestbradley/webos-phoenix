// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Move to Folder: a modal page listing the folders (a card over the app in
// iOS mode, as Apple's folder picker).

import {
    IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonRadio,
    IonModal, IonRadioGroup, IonTitle, IonToolbar,
} from "@ionic/react";
import { DEFAULT_FOLDER, summarize, type Folder, type Note } from "@phoenix/notes-core";
import { folderOutline } from "ionicons/icons";
import { useCallback, useState, type ReactElement } from "react";

import { useNotes } from "../context";

interface Props {
    note: Note;
    folders: Folder[];
    onMove: (folderId: string) => void;
    onClose: () => void;
}

function MoveSheet({ note, folders, onMove, onClose }: Props) {
    const choices = [{ id: DEFAULT_FOLDER, name: "Notes" }, ...folders.map((f) => ({ id: f._id, name: f.name }))];
    return (
        <>
            <IonHeader>
                <IonToolbar>
                    <IonButtons slot="start">
                        <IonButton onClick={onClose}>Cancel</IonButton>
                    </IonButtons>
                    <IonTitle>Move “{summarize(note.body).title}”</IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent>
                <IonList inset>
                    <IonRadioGroup value={note.folderId} onIonChange={(e) => onMove(e.detail.value as string)}>
                        {choices.map((f) => (
                            <IonItem key={f.id}>
                                <IonIcon slot="start" icon={folderOutline} aria-hidden="true" />
                                <IonRadio value={f.id} justify="space-between">
                                    <IonLabel>{f.name}</IonLabel>
                                </IonRadio>
                            </IonItem>
                        ))}
                    </IonRadioGroup>
                </IonList>
            </IonContent>
        </>
    );
}

/** Move to Folder for a note: open(note), and the modal to render. */
export function useMoveNote(): { moveNote: (note: Note) => void; moveModal: ReactElement } {
    const { app } = useNotes();
    const [note, setNote] = useState<Note | null>(null);
    const [presenting, setPresenting] = useState<HTMLElement | null>(null);
    const moveNote = useCallback((n: Note) => {
        setPresenting(document.querySelector<HTMLElement>("ion-router-outlet"));
        setNote(n);
    }, []);
    const close = () => setNote(null);
    const moveModal = (
        <IonModal isOpen={note !== null} presentingElement={presenting ?? undefined} onDidDismiss={close}>
            {note && (
                <MoveSheet
                    note={note}
                    folders={app.folders.slice().sort((a, b) => a.name.localeCompare(b.name))}
                    onMove={(folderId) => { app.moveNote(note._id, folderId); close(); }}
                    onClose={close}
                />
            )}
        </IonModal>
    );
    return { moveNote, moveModal };
}
