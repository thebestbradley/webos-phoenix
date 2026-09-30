// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings, grouped as Apple Notes' (inset lists). Style switches Ionic
// between its iOS and Material Design modes, which it fixes at start, so
// the app restarts.

import {
    IonBackButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader, IonNote,
    IonPage, IonRange, IonSelect, IonSelectOption, IonText, IonTitle, IonToggle, IonToolbar,
} from "@ionic/react";
import type { NewNoteStyle, SortOrder } from "@phoenix/notes-core";
import { useEffect, useRef } from "react";

import { useNotes } from "../context";
import { styleOf, type Mode, type Scheme } from "../settings";

export function SettingsPage() {
    const { app } = useNotes();
    const s = app.settings;
    const style = styleOf(s);

    // The new mode is saved (updateSettings) before this runs.
    const startMode = useRef(style.mode);
    useEffect(() => {
        if (style.mode !== startMode.current) location.reload();
    }, [style.mode]);

    return (
        <IonPage>
            <IonHeader translucent>
                <IonToolbar>
                    <IonButtons slot="start">
                        <IonBackButton defaultHref="/" text="Notes" />
                    </IonButtons>
                    <IonTitle>Settings</IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent fullscreen color="light">
                <IonHeader collapse="condense">
                    <IonToolbar color="light">
                        <IonTitle size="large">Settings</IonTitle>
                    </IonToolbar>
                </IonHeader>

                <IonList inset>
                    <IonListHeader><IonLabel>Appearance</IonLabel></IonListHeader>
                    <IonItem>
                        <IonSelect label="Style" interface="popover" value={style.mode}
                            onIonChange={(e) => app.updateSettings({ skin: e.detail.value as Mode })}>
                            <IonSelectOption value="ios">iOS</IonSelectOption>
                            <IonSelectOption value="md">Material Design</IonSelectOption>
                        </IonSelect>
                    </IonItem>
                    <IonItem>
                        <IonSelect label="Colours" interface="popover" value={style.scheme}
                            onIonChange={(e) => app.updateSettings({ extra: { scheme: e.detail.value as Scheme } })}>
                            <IonSelectOption value="system">Automatic</IonSelectOption>
                            <IonSelectOption value="light">Light</IonSelectOption>
                            <IonSelectOption value="dark">Dark</IonSelectOption>
                        </IonSelect>
                    </IonItem>
                </IonList>

                <IonList inset>
                    <IonListHeader><IonLabel>Viewing</IonLabel></IonListHeader>
                    <IonItem>
                        <IonSelect label="Sort Notes By" interface="popover" value={s.sort}
                            onIonChange={(e) => app.updateSettings({ sort: e.detail.value as SortOrder })}>
                            <IonSelectOption value="modified">Date Edited</IonSelectOption>
                            <IonSelectOption value="created">Date Created</IonSelectOption>
                            <IonSelectOption value="title">Title</IonSelectOption>
                        </IonSelect>
                    </IonItem>
                    <IonItem>
                        <IonToggle checked={s.groupByDate} disabled={s.sort === "title"}
                            onIonChange={(e) => app.updateSettings({ groupByDate: e.detail.checked })}>
                            Group Notes By Date
                        </IonToggle>
                    </IonItem>
                    <IonItem>
                        <IonToggle checked={s.openInPreview} onIonChange={(e) => app.updateSettings({ openInPreview: e.detail.checked })}>
                            Open Notes in Preview
                        </IonToggle>
                    </IonItem>
                </IonList>

                <IonList inset>
                    <IonListHeader><IonLabel>Editing</IonLabel></IonListHeader>
                    <IonItem>
                        <IonSelect label="New Notes Start With" interface="action-sheet" value={s.newNoteStyle}
                            onIonChange={(e) => app.updateSettings({ newNoteStyle: e.detail.value as NewNoteStyle })}>
                            <IonSelectOption value="title">Title</IonSelectOption>
                            <IonSelectOption value="heading">Heading</IonSelectOption>
                            <IonSelectOption value="body">Body</IonSelectOption>
                        </IonSelect>
                    </IonItem>
                    <IonItem>
                        <IonRange
                            label={`Text Size (${s.textSize}%)`}
                            labelPlacement="stacked"
                            aria-label="Text size"
                            min={80} max={160} step={10} snaps ticks pin
                            value={s.textSize}
                            onIonChange={(e) => app.updateSettings({ textSize: e.detail.value as number })}
                        >
                            <IonText slot="start" className="size-small">A</IonText>
                            <IonText slot="end" className="size-large">A</IonText>
                        </IonRange>
                    </IonItem>
                </IonList>

                <IonList inset>
                    <IonListHeader><IonLabel>About</IonLabel></IonListHeader>
                    <IonItem>
                        <IonLabel>Framework</IonLabel>
                        <IonNote slot="end">Ionic 9 (React)</IonNote>
                    </IonItem>
                    <IonItem>
                        <IonLabel className="ion-text-wrap">
                            <p>Your notes are shared with the other Notes demos (Enact Limestone and Agate, Flutter).</p>
                        </IonLabel>
                    </IonItem>
                </IonList>
            </IonContent>
        </IonPage>
    );
}
