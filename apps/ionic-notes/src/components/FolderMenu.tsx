// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The folders: beside the notes on a tablet (split pane), a side menu on a
// phone. A user folder slides for Rename and Delete.

import {
    IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonItem, IonItemOption,
    IonItemOptions, IonItemSliding, IonLabel, IonList, IonMenu, IonMenuToggle, IonNote, IonTitle,
    IonToolbar, useIonAlert, useIonRouter,
} from "@ionic/react";
import { ALL_NOTES, DEFAULT_FOLDER, RECENTLY_DELETED } from "@phoenix/notes-core";
import { addCircleOutline, albumsOutline, folderOutline, settingsOutline, trashOutline } from "ionicons/icons";

import { useNotes } from "../context";
import { useFolderDialogs } from "./folderDialogs";

export function FolderMenu() {
    const { app } = useNotes();
    const router = useIonRouter();
    const [alert] = useIonAlert();
    const { newFolder, renameFolder } = useFolderDialogs();

    const open = (id: string) => {
        app.openFolder(id);
        app.select(null);
        if (router.routeInfo.pathname !== "/") router.push("/", "root");
    };

    const row = (id: string, name: string, icon: string) => (
        <IonMenuToggle key={id} autoHide={false}>
            <IonItem
                button
                detail={false}
                className={app.folderId === id ? "selected" : undefined}
                aria-current={app.folderId === id ? "page" : undefined}
                onClick={() => open(id)}
            >
                <IonIcon slot="start" icon={icon} aria-hidden="true" />
                <IonLabel>{name}</IonLabel>
                <IonNote slot="end">{app.counts[id] ?? 0}</IonNote>
            </IonItem>
        </IonMenuToggle>
    );

    const folders = app.folders.slice().sort((a, b) => a.name.localeCompare(b.name));

    return (
        <IonMenu contentId="main" type="overlay" className="folder-menu">
            <IonHeader>
                <IonToolbar>
                    <IonTitle>Folders</IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent>
                <IonList inset>
                    {row(ALL_NOTES, "All Notes", albumsOutline)}
                    {row(DEFAULT_FOLDER, "Notes", folderOutline)}
                    {folders.map((f) => (
                        <IonItemSliding key={f._id}>
                            {row(f._id, f.name, folderOutline)}
                            <IonItemOptions side="end">
                                <IonItemOption onClick={() => renameFolder(f._id)}>Rename</IonItemOption>
                                <IonItemOption
                                    color="danger"
                                    onClick={() => void alert({
                                        header: `Delete “${f.name}”?`,
                                        message: "Its notes move to Recently Deleted.",
                                        buttons: [
                                            { text: "Cancel", role: "cancel" },
                                            { text: "Delete", role: "destructive", handler: () => app.deleteFolder(f._id) },
                                        ],
                                    })}
                                >
                                    Delete
                                </IonItemOption>
                            </IonItemOptions>
                        </IonItemSliding>
                    ))}
                    {row(RECENTLY_DELETED, "Recently Deleted", trashOutline)}
                </IonList>
            </IonContent>
            <IonFooter>
                <IonToolbar>
                    <IonButtons slot="start">
                        <IonButton onClick={newFolder}>
                            <IonIcon slot="start" icon={addCircleOutline} aria-hidden="true" />
                            New Folder
                        </IonButton>
                    </IonButtons>
                    <IonButtons slot="end">
                        <IonMenuToggle autoHide={false}>
                            <IonButton aria-label="Settings" onClick={() => router.push("/settings", "forward")}>
                                <IonIcon slot="icon-only" icon={settingsOutline} aria-hidden="true" />
                            </IonButton>
                        </IonMenuToggle>
                    </IonButtons>
                </IonToolbar>
            </IonFooter>
        </IonMenu>
    );
}
