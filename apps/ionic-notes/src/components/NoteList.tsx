// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A folder's notes, in Apple Notes' sections (Pinned, Today, ...), with
// search and its filters. A row slides right to pin, left to move or
// delete; in Recently Deleted, to recover or delete for good.

import {
    IonButton, IonButtons, IonChip, IonContent, IonFab, IonFabButton, IonFooter, IonHeader, IonIcon,
    IonItem, IonItemDivider, IonItemGroup, IonItemOption, IonItemOptions, IonItemSliding, IonLabel,
    IonList, IonListHeader, IonMenuButton, IonPopover, IonRadio, IonRadioGroup, IonSearchbar,
    IonSkeletonText, IonText, IonTitle, IonToggle, IonToolbar, getConfig, useIonAlert,
} from "@ionic/react";
import {
    ALL_NOTES, RECENTLY_DELETED, daysLeft, isDeleted, shortDate, summarize,
    type Feature, type Note, type SortOrder,
} from "@phoenix/notes-core";
import {
    arrowUndoOutline, createOutline, ellipsisHorizontalCircleOutline, folderOutline, pin, pinOutline, trashOutline,
} from "ionicons/icons";
import { useState } from "react";

import { useNotes } from "../context";
import { useFolderDialogs } from "./folderDialogs";
import { useMoveNote } from "./MoveModal";

const FILTERS: { id: Feature; label: string }[] = [
    { id: "checklist", label: "Checklists" },
    { id: "table", label: "Tables" },
    { id: "link", label: "Links" },
    { id: "code", label: "Code" },
];

const SORTS: { id: SortOrder; label: string }[] = [
    { id: "modified", label: "Date Edited" },
    { id: "created", label: "Date Created" },
    { id: "title", label: "Title" },
];

export function NoteList({ onOpen }: { onOpen: (id: string) => void }) {
    const { app, wide, deleteWithUndo } = useNotes();
    const [alert] = useIonAlert();
    const { renameFolder } = useFolderDialogs();
    const { moveNote, moveModal } = useMoveNote();
    const [searchFocus, setSearchFocus] = useState(false);
    const md = getConfig()?.get("mode") === "md";
    const now = Date.now();

    const inDeleted = app.folderId === RECENTLY_DELETED;
    const userFolder = app.folders.some((f) => f._id === app.folderId);
    const title = app.folderName(app.folderId);
    const count = app.searching ? app.matches.length : app.count;

    const row = (n: Note, context?: string) => {
        const s = summarize(n.body);
        const selected = wide && app.selected?._id === n._id;
        return (
            <IonItemSliding key={n._id}>
                {!isDeleted(n) && (
                    <IonItemOptions side="start">
                        <IonItemOption color="warning" onClick={() => app.togglePin(n._id)} aria-label={n.pinned ? "Unpin" : "Pin"}>
                            <IonIcon slot="icon-only" icon={n.pinned ? pinOutline : pin} aria-hidden="true" />
                        </IonItemOption>
                    </IonItemOptions>
                )}
                <IonItem
                    button
                    detail={false}
                    className={selected ? "note-row selected" : "note-row"}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onOpen(n._id)}
                >
                    <IonLabel>
                        <h2>{n.pinned && <IonIcon icon={pin} className="row-pin" aria-label="Pinned" />}{s.title}</h2>
                        <p>
                            <IonText className="row-date">{shortDate(n.modifiedAt, now)}</IonText>{" "}
                            {context || s.preview}
                        </p>
                        {inDeleted && <p className="row-folder">{daysLeft(n, now)} days</p>}
                        {!inDeleted && app.folderId === ALL_NOTES && (
                            <p className="row-folder">
                                <IonIcon icon={folderOutline} aria-hidden="true" /> {app.folderName(n.folderId)}
                            </p>
                        )}
                    </IonLabel>
                </IonItem>
                <IonItemOptions side="end">
                    {isDeleted(n) ? (
                        <IonItemOption color="primary" onClick={() => app.recover(n._id)}>
                            <IonIcon slot="top" icon={arrowUndoOutline} aria-hidden="true" />
                            Recover
                        </IonItemOption>
                    ) : (
                        <IonItemOption color="tertiary" onClick={() => moveNote(n)}>
                            <IonIcon slot="top" icon={folderOutline} aria-hidden="true" />
                            Move
                        </IonItemOption>
                    )}
                    <IonItemOption
                        color="danger"
                        expandable
                        onClick={() => {
                            if (!isDeleted(n)) return deleteWithUndo(n._id);
                            void alert({
                                header: "Delete this note now?",
                                message: "It will be deleted immediately. You can’t undo this.",
                                buttons: [
                                    { text: "Cancel", role: "cancel" },
                                    { text: "Delete", role: "destructive", handler: () => app.deleteNote(n._id) },
                                ],
                            });
                        }}
                    >
                        <IonIcon slot="top" icon={trashOutline} aria-hidden="true" />
                        Delete
                    </IonItemOption>
                </IonItemOptions>
            </IonItemSliding>
        );
    };

    const emptyDeleted = () => void alert({
        header: "Delete all notes in Recently Deleted?",
        message: "They will be deleted immediately. You can’t undo this.",
        buttons: [
            { text: "Cancel", role: "cancel" },
            { text: "Delete All", role: "destructive", handler: () => app.emptyRecentlyDeleted() },
        ],
    });

    // The View Options button's click, which places its popover.
    const [options, setOptions] = useState<Event | null>(null);

    return (
        <>
            <IonHeader translucent>
                <IonToolbar>
                    <IonButtons slot="start">
                        <IonMenuButton />
                    </IonButtons>
                    <IonTitle>{title}</IonTitle>
                    <IonButtons slot="end">
                        <IonButton aria-label="View Options" onClick={(e) => setOptions(e.nativeEvent)}>
                            <IonIcon slot="icon-only" icon={ellipsisHorizontalCircleOutline} aria-hidden="true" />
                        </IonButton>
                    </IonButtons>
                </IonToolbar>
            </IonHeader>
            <IonContent fullscreen>
                <IonHeader collapse="condense">
                    <IonToolbar>
                        <IonTitle size="large">{title}</IonTitle>
                    </IonToolbar>
                </IonHeader>
                <IonSearchbar
                    value={app.query}
                    debounce={150}
                    placeholder="Search"
                    onIonInput={(e) => app.setQuery(e.detail.value ?? "")}
                    onIonFocus={() => setSearchFocus(true)}
                    onIonBlur={() => setSearchFocus(false)}
                    onIonClear={() => app.setFilters([])}
                />
                {(searchFocus || app.searching) && (
                    <div className="filters" role="group" aria-label="Filters">
                        {FILTERS.map((f) => {
                            const on = app.filters.includes(f.id);
                            return (
                                <IonChip
                                    key={f.id}
                                    color={on ? "primary" : undefined}
                                    outline={!on}
                                    aria-pressed={on}
                                    // Keep the searchbar's focus (and its filters) on a tap.
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => app.setFilters(on ? app.filters.filter((x) => x !== f.id) : [...app.filters, f.id])}
                                >
                                    {f.label}
                                </IonChip>
                            );
                        })}
                    </div>
                )}

                {inDeleted && app.count > 0 && (
                    <IonText color="medium">
                        <p className="deleted-note ion-text-center">Notes are available here for 30 days. After that, they will be permanently deleted.</p>
                    </IonText>
                )}

                {!app.loaded ? (
                    <IonList inset>
                        {[0, 1, 2].map((i) => (
                            <IonItem key={i}>
                                <IonLabel>
                                    <h2><IonSkeletonText animated style={{ width: "60%" }} /></h2>
                                    <p><IonSkeletonText animated style={{ width: "85%" }} /></p>
                                </IonLabel>
                            </IonItem>
                        ))}
                    </IonList>
                ) : app.searching ? (
                    <IonList inset>
                        <IonListHeader>
                            <IonLabel>{count === 1 ? "1 found" : `${count} found`}</IonLabel>
                        </IonListHeader>
                        {app.matches.map((m) => row(m.note, m.context))}
                    </IonList>
                ) : app.count === 0 ? (
                    <div className="empty ion-text-center">
                        <IonText color="medium"><p>No Notes</p></IonText>
                    </div>
                ) : (
                    <IonList inset>
                        {app.sections.map((s) => (
                            <IonItemGroup key={s.title}>
                                <IonItemDivider sticky>
                                    <IonLabel>{s.title}</IonLabel>
                                </IonItemDivider>
                                {s.notes.map((n) => row(n))}
                            </IonItemGroup>
                        ))}
                    </IonList>
                )}

                {md && !inDeleted && (
                    <IonFab slot="fixed" vertical="bottom" horizontal="end">
                        <IonFabButton aria-label="New Note" onClick={() => void app.newNote()}>
                            <IonIcon icon={createOutline} aria-hidden="true" />
                        </IonFabButton>
                    </IonFab>
                )}
            </IonContent>
            <IonFooter translucent>
                <IonToolbar>
                    {inDeleted && app.count > 0 && (
                        <IonButtons slot="start">
                            <IonButton color="danger" onClick={emptyDeleted}>Delete All</IonButton>
                        </IonButtons>
                    )}
                    <IonTitle size="small" className="count">{count === 1 ? "1 Note" : `${count} Notes`}</IonTitle>
                    {!md && !inDeleted && (
                        <IonButtons slot="end">
                            <IonButton aria-label="New Note" onClick={() => void app.newNote()}>
                                <IonIcon slot="icon-only" icon={createOutline} aria-hidden="true" />
                            </IonButton>
                        </IonButtons>
                    )}
                </IonToolbar>
            </IonFooter>

            <IonPopover isOpen={options !== null} event={options ?? undefined} onDidDismiss={() => setOptions(null)}>
                <IonContent>
                    <IonList lines="none">
                        <IonListHeader><IonLabel>Sort By</IonLabel></IonListHeader>
                        <IonRadioGroup value={app.settings.sort} onIonChange={(e) => app.updateSettings({ sort: e.detail.value as SortOrder })}>
                            {SORTS.map((s) => (
                                <IonItem key={s.id}>
                                    <IonRadio value={s.id} justify="space-between">{s.label}</IonRadio>
                                </IonItem>
                            ))}
                        </IonRadioGroup>
                        <IonItem>
                            <IonToggle
                                checked={app.settings.groupByDate}
                                disabled={app.settings.sort === "title"}
                                onIonChange={(e) => app.updateSettings({ groupByDate: e.detail.checked })}
                            >
                                Group By Date
                            </IonToggle>
                        </IonItem>
                        {userFolder && (
                            <IonItem button detail={false} onClick={() => renameFolder(app.folderId)}>
                                <IonLabel>Rename Folder…</IonLabel>
                            </IonItem>
                        )}
                    </IonList>
                </IonContent>
            </IonPopover>
            {moveModal}
        </>
    );
}
