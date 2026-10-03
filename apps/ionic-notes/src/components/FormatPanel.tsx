// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Apple Notes' Aa panel: paragraph styles, inline styles and lists. Shown
// in a popover on a tablet and a bottom sheet on a phone; both leave the
// note in view (no focus trap), so the styles apply to its selection.

import { IonButton, IonLabel, IonSegment, IonSegmentButton } from "@ionic/react";
import { codeBlock, setBlockStyle, toggleInline, type BlockStyle, type InlineStyle, type TextState } from "@phoenix/notes-core";

const PARAGRAPH: { id: BlockStyle; label: string }[] = [
    { id: "title", label: "Title" },
    { id: "heading", label: "Heading" },
    { id: "subheading", label: "Subheading" },
    { id: "body", label: "Body" },
];

const INLINE: { id: InlineStyle; label: string; name: string }[] = [
    { id: "bold", label: "B", name: "Bold" },
    { id: "italic", label: "I", name: "Italic" },
    { id: "strikethrough", label: "S", name: "Strikethrough" },
    { id: "code", label: "</>", name: "Code" },
];

const LISTS: { id: BlockStyle; label: string }[] = [
    { id: "bulleted", label: "• Bulleted" },
    { id: "numbered", label: "1. Numbered" },
    { id: "checklist", label: "☐ Checklist" },
    { id: "quote", label: "| Quote" },
];

interface Props {
    /** The paragraph style at the caret (blockStyleAt). */
    current: BlockStyle;
    apply: (command: (s: TextState) => TextState) => void;
}

export function FormatPanel({ current, apply }: Props) {
    return (
        <div className="format-panel">
            <IonSegment
                scrollable
                value={PARAGRAPH.some((p) => p.id === current) ? current : undefined}
                onIonChange={(e) => {
                    const id = e.detail.value as BlockStyle;
                    if (id !== current) apply((s) => setBlockStyle(s, id));
                }}
            >
                {PARAGRAPH.map((p) => (
                    <IonSegmentButton key={p.id} value={p.id}>
                        <IonLabel>{p.label}</IonLabel>
                    </IonSegmentButton>
                ))}
            </IonSegment>
            <div className="format-row" role="group" aria-label="Text style">
                {INLINE.map((i) => (
                    <IonButton key={i.id} fill="outline" className={`inline-${i.id}`} aria-label={i.name}
                        onClick={() => apply((s) => toggleInline(s, i.id))}>
                        {i.label}
                    </IonButton>
                ))}
                <IonButton fill="outline" aria-label="Monostyled block" onClick={() => apply(codeBlock)}>Mono</IonButton>
            </div>
            <div className="format-row" role="group" aria-label="Lists">
                {LISTS.map((l) => (
                    <IonButton key={l.id} fill={current === l.id ? "solid" : "outline"} size="small"
                        onClick={() => apply((s) => setBlockStyle(s, l.id))}>
                        {l.label}
                    </IonButton>
                ))}
            </div>
        </div>
    );
}
