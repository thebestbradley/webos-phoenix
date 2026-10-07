// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What DropShare says about a session (pure, so it is tested by itself).

import type { DropShareFile, DropShareStatus } from "@phoenix/luna";

export type Mode = "receive" | "send";

export function sizeText(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const files = (n: number) => (n === 1 ? "1 file" : `${n} files`);

/** The line under the code: what to do, or what happened. */
export function statusText(mode: Mode, s: DropShareStatus | null): string {
    if (!s) return mode === "receive" ? "Starting…" : "Getting the files ready…";
    const saved = s.files.filter((f) => f.saved).length;
    const sent = s.files.filter((f) => (f.downloads ?? 0) > 0).length;
    switch (s.state) {
    case "waiting":
        return mode === "receive"
            ? "On a phone or computer on this Wi-Fi network, scan the code or open the address, then choose the files to send here."
            : `On a phone or computer on this Wi-Fi network, scan the code or open the address to download ${files(s.files.length)}.`;
    case "transferring": {
        if (mode === "send") return `${sent} of ${files(s.files.length)} downloaded`;
        const coming = s.files.find((f) => !f.saved);
        return coming ? `Receiving ${coming.name}…` : `Received ${files(saved)}`;
    }
    case "done":
        return mode === "receive" ? (saved ? `Received ${files(saved)}. ${saved === 1 ? "It is" : "They are"} in Downloads.` : "Nothing was sent.")
            : `Sent ${files(s.files.length)}.`;
    case "timeout":
        return "The address expired after 10 minutes without use.";
    case "failed":
        return "DropShare could not start.";
    default:
        return "Stopped.";
    }
}

/** A session that is over: the address no longer works. */
export function ended(s: DropShareStatus | null): boolean {
    return !!s && s.state !== "waiting" && s.state !== "transferring";
}

/** A file's line under its name. */
export function fileText(mode: Mode, f: DropShareFile): string {
    if (mode === "send") return (f.downloads ?? 0) > 0 ? `${sizeText(f.size)} · Downloaded` : sizeText(f.size);
    if (f.saved) return `${sizeText(f.size)} · In Downloads`;
    if (f.size) return `${sizeText(f.received ?? 0)} of ${sizeText(f.size)}`;
    return "Receiving…";
}
