// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The open note: its Markdown source or the rendered preview (a segment in
// the toolbar), the Aa panel and the insert buttons below it, and the note's
// actions in an action sheet. On a phone it is a page of its own, with a
// back button to the list.

import {
    IonBackButton, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonItem, IonLabel,
    IonList, IonModal, IonNote, IonPopover, IonProgressBar, IonSegment, IonSegmentButton, IonText,
    IonTitle, IonToolbar, useIonActionSheet, useIonAlert,
} from "@ionic/react";
import {
    MarkdownEditor, MarkdownPreview, blockStyleAt, codeBlock, insertLink, insertTable, isDeleted, longDate,
    setBlockStyle, taskStates, textLines, wordCount,
    type BlockStyle, type EditorHandle, type TextState,
} from "@phoenix/notes-core";
import {
    checkboxOutline, codeSlashOutline, createOutline, ellipsisHorizontalCircleOutline, gridOutline, linkOutline, pin, pinOutline,
} from "ionicons/icons";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import { useNotes } from "../context";
import { openLink } from "../luna";
import { FormatPanel } from "./FormatPanel";
import { useMoveNote } from "./MoveModal";

type Mode = "edit" | "preview";

export function NoteEditor({ page }: { page: boolean }) {
    const { app, deleteWithUndo } = useNotes();
    const note = app.selected;
    const editor = useRef<EditorHandle>(null);
    const [mode, setMode] = useState<Mode>("edit");
    const [format, setFormat] = useState(false);
    // The Aa button's click, which places the popover (tablet).
    const [formatEvent, setFormatEvent] = useState<Event | undefined>(undefined);
    const [current, setCurrent] = useState<BlockStyle>("body");
    const [info, setInfo] = useState(false);
    const [sheet] = useIonActionSheet();
    const [alert] = useIonAlert();
    const { moveNote, moveModal } = useMoveNote();

    // Each note opens as Settings says; a deleted one only as its preview.
    useEffect(() => {
        setMode(app.settings.openInPreview || (note ? isDeleted(note) : false) ? "preview" : "edit");
        setFormat(false);
    }, [note?._id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!note) {
        return (
            <>
                <IonHeader><IonToolbar /></IonHeader>
                <IonContent>
                    <div className="empty ion-text-center">
                        <IonText color="medium"><p>No note selected</p></IonText>
                        <IonButton fill="outline" onClick={() => void app.newNote()}>
                            <IonIcon slot="start" icon={createOutline} aria-hidden="true" />
                            New Note
                        </IonButton>
                    </div>
                </IonContent>
            </>
        );
    }

    const deleted = isDeleted(note);
    const apply = (command: (s: TextState) => TextState) => {
        // The editor mounts on the next render when coming from the preview.
        if (mode !== "edit") setMode("edit");
        setTimeout(() => {
            editor.current?.apply(command);
            const s = editor.current?.state();
            if (s) setCurrent(blockStyleAt(s));
        }, 0);
    };
    const openFormat = (ev: MouseEvent) => {
        setFormatEvent(ev.nativeEvent);
        const s = editor.current?.state();
        setCurrent(s ? blockStyleAt(s) : "body");
        setFormat(true);
    };
    const addLink = () => void alert({
        header: "Add Link",
        message: "The selected text becomes the link’s text.",
        inputs: [{ name: "url", type: "url", placeholder: "https://", attributes: { "aria-label": "Link address" } }],
        buttons: [
            { text: "Cancel", role: "cancel" },
            {
                text: "Add",
                handler: (data: { url: string }) => {
                    const url = data.url.trim();
                    if (url) apply((s) => insertLink(s, /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : "https://" + url));
                },
            },
        ],
    });
    const deleteForGood = () => void alert({
        header: "Delete this note now?",
        message: "It will be deleted immediately. You can’t undo this.",
        buttons: [
            { text: "Cancel", role: "cancel" },
            { text: "Delete", role: "destructive", handler: () => app.deleteNote(note._id) },
        ],
    });
    const more = () => void sheet({
        header: textLines(app.draft)[0] ?? "New Note",
        buttons: [
            { text: note.pinned ? "Unpin Note" : "Pin Note", handler: () => app.togglePin(note._id) },
            { text: "Move to Folder…", handler: () => moveNote(note) },
            { text: "Add Link…", handler: addLink },
            { text: "Note Info", handler: () => setInfo(true) },
            { text: "Delete Note", role: "destructive", handler: () => deleteWithUndo(note._id) },
            { text: "Cancel", role: "cancel" },
        ],
    });

    const tasks = taskStates(app.draft);
    const done = tasks.filter(Boolean).length;
    const formatPanel = <FormatPanel current={current} apply={apply} />;

    return (
        <>
            <IonHeader translucent>
                <IonToolbar>
                    {page && (
                        <IonButtons slot="start">
                            <IonBackButton defaultHref="/" text={app.folderName(app.folderId)} />
                        </IonButtons>
                    )}
                    {deleted ? (
                        <IonTitle>Recently Deleted</IonTitle>
                    ) : (
                        <IonSegment value={mode} onIonChange={(e) => setMode(e.detail.value as Mode)} className="mode-segment">
                            <IonSegmentButton value="edit"><IonLabel>Markdown</IonLabel></IonSegmentButton>
                            <IonSegmentButton value="preview"><IonLabel>Preview</IonLabel></IonSegmentButton>
                        </IonSegment>
                    )}
                    {!deleted && (
                        <IonButtons slot="end">
                            <IonButton aria-label={note.pinned ? "Unpin" : "Pin"} aria-pressed={note.pinned} onClick={() => app.togglePin(note._id)}>
                                <IonIcon slot="icon-only" icon={note.pinned ? pin : pinOutline} aria-hidden="true" />
                            </IonButton>
                            <IonButton aria-label="More" onClick={more}>
                                <IonIcon slot="icon-only" icon={ellipsisHorizontalCircleOutline} aria-hidden="true" />
                            </IonButton>
                        </IonButtons>
                    )}
                </IonToolbar>
                {mode === "preview" && tasks.length > 0 && (
                    <IonToolbar className="progress">
                        <div className="progress-row">
                            <IonProgressBar value={done / tasks.length} aria-label="Checklist progress" />
                            <IonNote>{done} of {tasks.length} done</IonNote>
                        </div>
                    </IonToolbar>
                )}
            </IonHeader>
            <IonContent className="note-content" scrollY={mode === "preview"}>
                <p className="note-date ion-text-center">{longDate(note.modifiedAt)}</p>
                {deleted && (
                    <p className="note-banner ion-text-center">This note is in Recently Deleted. Recover it to edit it.</p>
                )}
                {mode === "preview" ? (
                    <MarkdownPreview
                        className="note-preview"
                        source={app.draft}
                        textSize={app.settings.textSize}
                        onToggleTask={deleted ? undefined : app.toggleTask}
                        onOpenLink={openLink}
                    />
                ) : (
                    <MarkdownEditor
                        ref={editor}
                        className="note-editor"
                        value={app.draft}
                        onChange={app.setDraft}
                        textSize={app.settings.textSize}
                        placeholder="Start typing. Markdown works: # Title, **bold**, - [ ] task"
                    />
                )}
            </IonContent>
            <IonFooter translucent>
                {deleted ? (
                    <IonToolbar>
                        <IonButtons slot="start">
                            <IonButton onClick={() => app.recover(note._id)}>Recover</IonButton>
                        </IonButtons>
                        <IonButtons slot="end">
                            <IonButton color="danger" onClick={deleteForGood}>Delete</IonButton>
                        </IonButtons>
                    </IonToolbar>
                ) : (
                    <IonToolbar>
                        <IonButtons slot="start">
                            <IonButton aria-label="Format" onClick={openFormat}>
                                <span className="aa" aria-hidden="true">Aa</span>
                            </IonButton>
                            <IonButton aria-label="Checklist" onClick={() => apply((s) => setBlockStyle(s, "checklist"))}>
                                <IonIcon slot="icon-only" icon={checkboxOutline} aria-hidden="true" />
                            </IonButton>
                            <IonButton aria-label="Table" onClick={() => apply((s) => insertTable(s))}>
                                <IonIcon slot="icon-only" icon={gridOutline} aria-hidden="true" />
                            </IonButton>
                            <IonButton aria-label="Add Link" onClick={addLink}>
                                <IonIcon slot="icon-only" icon={linkOutline} aria-hidden="true" />
                            </IonButton>
                            <IonButton aria-label="Monostyled" onClick={() => apply(codeBlock)}>
                                <IonIcon slot="icon-only" icon={codeSlashOutline} aria-hidden="true" />
                            </IonButton>
                        </IonButtons>
                        <IonButtons slot="end">
                            <IonButton aria-label="New Note" onClick={() => void app.newNote()}>
                                <IonIcon slot="icon-only" icon={createOutline} aria-hidden="true" />
                            </IonButton>
                        </IonButtons>
                    </IonToolbar>
                )}
            </IonFooter>

            {page ? (
                <IonModal
                    isOpen={format}
                    breakpoints={[0, 0.4, 0.6]}
                    initialBreakpoint={0.4}
                    backdropBreakpoint={0.6}
                    focusTrap={false}
                    onDidDismiss={() => setFormat(false)}
                    className="format-sheet"
                >
                    <IonContent>{formatPanel}</IonContent>
                </IonModal>
            ) : (
                <IonPopover
                    isOpen={format}
                    event={formatEvent}
                    side="top"
                    alignment="start"
                    focusTrap={false}
                    onDidDismiss={() => setFormat(false)}
                    className="format-popover"
                >
                    <IonContent>{formatPanel}</IonContent>
                </IonPopover>
            )}

            <IonModal isOpen={info} breakpoints={[0, 0.5]} initialBreakpoint={0.5} onDidDismiss={() => setInfo(false)}>
                <IonHeader>
                    <IonToolbar>
                        <IonTitle>Note Info</IonTitle>
                        <IonButtons slot="end"><IonButton onClick={() => setInfo(false)}>Done</IonButton></IonButtons>
                    </IonToolbar>
                </IonHeader>
                <IonContent>
                    <IonList inset>
                        <IonItem><IonLabel>Folder</IonLabel><IonNote slot="end">{app.folderName(note.folderId)}</IonNote></IonItem>
                        <IonItem><IonLabel>Created</IonLabel><IonNote slot="end">{longDate(note.createdAt)}</IonNote></IonItem>
                        <IonItem><IonLabel>Modified</IonLabel><IonNote slot="end">{longDate(note.modifiedAt)}</IonNote></IonItem>
                        <IonItem><IonLabel>Words</IonLabel><IonNote slot="end">{wordCount(app.draft)}</IonNote></IonItem>
                        <IonItem><IonLabel>Characters</IonLabel><IonNote slot="end">{app.draft.length}</IonNote></IonItem>
                        <IonItem><IonLabel>Lines</IonLabel><IonNote slot="end">{textLines(app.draft).length}</IonNote></IonItem>
                    </IonList>
                </IonContent>
            </IonModal>
            {moveModal}
        </>
    );
}
