// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The note's editor and preview, for both Enact demos; each app styles them
// for its theme (className). Enact has no multi-line text field, so the
// editor is a textarea; the formatting commands (editing.ts) work on its
// text and selection.

import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { continueList, indentLines, toggleInline, type InlineStyle, type TextState } from "./editing";
import { renderMarkdown } from "./markdown";

export interface EditorHandle {
    /** Applies a command to the text and selection. */
    apply(command: (s: TextState) => TextState): void;
    /** The text and selection now (for the style at the caret). */
    state(): TextState;
    focus(): void;
}

export interface MarkdownEditorProps {
    value: string;
    onChange: (text: string) => void;
    /** Text size, percent (the app's CSS reads --note-text-scale). */
    textSize: number;
    placeholder?: string;
    className?: string;
}

const SHORTCUTS: Record<string, InlineStyle> = { b: "bold", i: "italic", e: "code" };

export const MarkdownEditor = forwardRef<EditorHandle, MarkdownEditorProps>(
    ({ value, onChange, textSize, placeholder, className }, ref) => {
        const area = useRef<HTMLTextAreaElement>(null);
        // The selection to restore after a command's text is rendered.
        const pending = useRef<[number, number] | null>(null);

        const run = (command: (s: TextState) => TextState) => {
            const el = area.current;
            if (!el) return;
            const next = command({ text: el.value, start: el.selectionStart, end: el.selectionEnd });
            pending.current = [next.start, next.end];
            onChange(next.text);
        };

        useImperativeHandle(ref, () => ({
            apply: run,
            state: () => {
                const el = area.current;
                return el ? { text: el.value, start: el.selectionStart, end: el.selectionEnd } : { text: value, start: 0, end: 0 };
            },
            focus: () => area.current?.focus(),
        }));

        useLayoutEffect(() => {
            const el = area.current;
            if (el && pending.current) {
                el.focus();
                el.setSelectionRange(pending.current[0], pending.current[1]);
                pending.current = null;
            }
        });

        const onKeyDown = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
            // Arrow keys move the caret here, not Spotlight's focus.
            if (ev.key.startsWith("Arrow")) {
                ev.stopPropagation();
                return;
            }
            const el = ev.currentTarget;
            const state = { text: el.value, start: el.selectionStart, end: el.selectionEnd };
            let next: TextState | null = null;
            if (ev.key === "Enter" && !ev.shiftKey) next = continueList(state);
            else if (ev.key === "Tab") next = indentLines(state, ev.shiftKey);
            else if ((ev.ctrlKey || ev.metaKey) && SHORTCUTS[ev.key.toLowerCase()]) next = toggleInline(state, SHORTCUTS[ev.key.toLowerCase()]);
            if (next) {
                ev.preventDefault();
                const done = next;
                run(() => done);
            }
        };

        return (
            <textarea
                ref={area}
                className={className}
                style={{ "--note-text-scale": textSize / 100 } as CSSProperties}
                value={value}
                placeholder={placeholder}
                spellCheck
                onChange={(ev) => onChange(ev.target.value)}
                onKeyDown={onKeyDown}
            />
        );
    },
);

MarkdownEditor.displayName = "MarkdownEditor";

export interface MarkdownPreviewProps {
    source: string;
    textSize: number;
    /** Checks or unchecks a task box (its data-task index); none: read-only. */
    onToggleTask?: (index: number) => void;
    /** Opens a link (the app hands it to the system). */
    onOpenLink: (url: string) => void;
    className?: string;
}

/** The note rendered from its Markdown (sanitized by renderMarkdown). */
export function MarkdownPreview({ source, textSize, onToggleTask, onOpenLink, className }: MarkdownPreviewProps) {
    const html = useMemo(() => renderMarkdown(source), [source]);

    const onClick = (ev: MouseEvent<HTMLDivElement>) => {
        const target = ev.target as HTMLElement;
        const box = target.closest("input[data-task]");
        if (box) {
            ev.preventDefault();
            if (onToggleTask) onToggleTask(Number(box.getAttribute("data-task")));
            return;
        }
        const link = target.closest("a[href]");
        if (link) {
            ev.preventDefault();
            onOpenLink(link.getAttribute("href") as string);
        }
    };

    return (
        <div
            className={className}
            style={{ "--note-text-scale": textSize / 100 } as CSSProperties}
            onClick={onClick}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
