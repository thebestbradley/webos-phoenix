// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// List icons by file type, drawn for Phoenix in the webOS 2.x manner (a
// small illustrated object with a soft shade). A folder, or a sheet of
// paper with a coloured band and a mark for its kind; a drive (a Synergy
// account's files: Nextcloud, Dropbox, ...) is a folder with a cloud on it.
// Files and the system's save picker show them.

import { useId } from "react";

/** The kinds a file icon can show (@phoenix/luna's FileKind, and a drive). */
export type FileIconKind = "folder" | "drive" | "image" | "audio" | "video" | "text" | "code" | "archive" | "package" | "pdf" | "document" | "book" | "file";
type FileKind = Exclude<FileIconKind, "drive">;

const BANDS: Record<Exclude<FileKind, "folder">, string> = {
    image: "#3f9a4a", audio: "#e07a1f", video: "#7a4fc0", text: "#4f7fb8", code: "#4a5563",
    archive: "#9a7b2f", package: "#1f75bf", pdf: "#c8322f", document: "#2b5fa8", book: "#6b3f1f", file: "#8a8f96",
};

// A white mark in the band (16x10 area at 8,18).
const MARKS: Partial<Record<FileKind, string>> = {
    image: "M9 27l4-5 3 3 2-2 4 4zm10-7a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
    audio: "M18 19v6.3a2 2 0 1 1-1.2-1.8V21l-4 1v4.3a2 2 0 1 1-1.2-1.8V20.2z",
    video: "M10 20h8v7h-8zm9 2l4-2v7l-4-2z",
    text: "M10 20h12v1.4H10zm0 3h12v1.4H10zm0 3h8v1.4h-8z",
    code: "M13 20l-3.5 3.5L13 27l1-1-2.5-2.5L14 21zm6 0l-1 1 2.5 2.5L18 26l1 1 3.5-3.5z",
    archive: "M15 19h2v1.5h-2zm0 3h2v1.5h-2zm0 3h2v1.5h-2zm-1 1.5h4V28h-4z",
    package: "M16 18.5l6 2.5v5l-6 2.5-6-2.5v-5zm0 1.6l-4 1.6 4 1.6 4-1.6z",
    // Lines of a page beside a margin rule; an open book.
    document: "M9 20h2v8H9zm4 0h10v1.4H13zm0 2.3h10v1.4H13zm0 2.3h10v1.4H13zm0 2.3h6V28h-6z",
    book: "M16 21.2c-1.8-1.3-4-1.8-6.5-1.7V27c2.5-.1 4.7.4 6.5 1.6 1.8-1.2 4-1.7 6.5-1.6v-7.5c-2.5-.1-4.7.4-6.5 1.7zm-.6 1v5.2c-1.3-.7-2.8-1-4.6-1.1v-5c1.8.1 3.3.3 4.6.9z",
    pdf: "M10 21h3.2a1.6 1.6 0 0 1 0 3.2H11.3V26H10zm1.3 1.2v.8h1.8a.4.4 0 0 0 0-.8zM15 21h2.2a2.5 2.5 0 0 1 0 5H15zm1.3 1.2v2.6h.9a1.3 1.3 0 0 0 0-2.6zM20 21h3v1.2h-1.7v.8h1.5v1.2h-1.5V26H20z",
};

export function FileIcon({ kind, size = 32 }: { kind: FileIconKind; size?: number }) {
    const id = useId().replace(/:/g, "");
    if (kind === "drive") {
        return (
            <svg className="pui-file-icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
                <defs>
                    <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#e3a92c" />
                    </linearGradient>
                    <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#cfe0ef" />
                    </linearGradient>
                </defs>
                <path d="M2 8a2 2 0 0 1 2-2h8l3 3h13a2 2 0 0 1 2 2v2H2z" fill="#c78f1f" />
                <path d="M2 12h28v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill={`url(#${id}f)`} stroke="#a8761a" strokeWidth="0.8" />
                <path d="M11.5 26a3.3 3.3 0 0 1 .5-6.6 4.6 4.6 0 0 1 8.8-.9 3.1 3.1 0 0 1 3.2 3.1 2.2 2.2 0 0 1-.3 4.4z"
                      fill={`url(#${id}c)`} stroke="#4f6f8f" strokeWidth="0.9" />
                <path d="M16.3 24.8v-3.6m-1.4 1.3l1.4-1.4 1.4 1.4" fill="none" stroke="#2a6db0" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (kind === "folder") {
        return (
            <svg className="pui-file-icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
                <defs>
                    <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#e3a92c" />
                    </linearGradient>
                </defs>
                <path d="M2 8a2 2 0 0 1 2-2h8l3 3h13a2 2 0 0 1 2 2v2H2z" fill="#c78f1f" />
                <path d="M2 12h28v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill={`url(#${id}f)`} stroke="#a8761a" strokeWidth="0.8" />
                <path d="M3 13h26v1.2H3z" fill="#fff" opacity="0.55" />
            </svg>
        );
    }
    return (
        <svg className="pui-file-icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
            <defs>
                <linearGradient id={`${id}p`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#dcdcda" />
                </linearGradient>
            </defs>
            <path d="M6 2h14l6 6v21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill={`url(#${id}p)`} stroke="#8d8d8a" strokeWidth="0.8" />
            <path d="M20 2v5a1 1 0 0 0 1 1h5z" fill="#c9c9c6" stroke="#8d8d8a" strokeWidth="0.8" strokeLinejoin="round" />
            <rect x="7" y="17" width="18" height="12" rx="1" fill={BANDS[kind]} />
            {MARKS[kind] && <path d={MARKS[kind]} fill="#fff" fillRule="evenodd" />}
        </svg>
    );
}
