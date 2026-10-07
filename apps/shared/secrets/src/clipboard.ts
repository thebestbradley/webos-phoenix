// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Copy a secret, and clear the clipboard again after a while, as KeePassXC
// does: only if it still holds what we put there (the user may have copied
// something else since), or when that cannot be checked.
//
// The web runtime's clipboard is the system one: phoenix-sim enables
// javascriptCanAccessClipboard; on a device WebAppMgr gives web apps
// execCommand("copy"). navigator.clipboard is tried first and
// execCommand("copy") on a hidden text area is the fallback.
//
// Limits (documented in docs/SECURITY-APPS.md): the clipboard is shared
// with every app while the secret is on it. Phoenix's clipboard history
// keeps it, marked sensitive: encrypted, masked, revealed only after the
// device passcode.

export const CLIPBOARD_CLEAR_SECONDS = [10, 20, 30, 60, 90];

// The clipboard history (org.webosphoenix.clipboard) records every copy;
// this tells it the copy is a secret, which it keeps encrypted and masked
// (or skips, as the user chose in Settings > Clipboard).
function markSensitive(text: string) {
    const rt = (globalThis as { __phoenixRuntime?: { clipboard?: { markSensitive?: (t: string) => void } } }).__phoenixRuntime;
    try { if (text) rt?.clipboard?.markSensitive?.(text); } catch { /* no history */ }
}

async function write(text: string): Promise<boolean> {
    markSensitive(text);
    try {
        if (typeof globalThis.navigator?.clipboard?.writeText === "function") {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall back */ }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.top = "0";
        document.body.appendChild(ta);
        const active = document.activeElement as HTMLElement | null;
        ta.select();
        const ok = document.execCommand("copy");
        ta.value = "";
        ta.remove();
        active?.focus?.();
        return ok;
    } catch {
        return false;
    }
}

async function read(): Promise<string | null> {
    try {
        if (typeof globalThis.navigator?.clipboard?.readText === "function") return await navigator.clipboard.readText();
    } catch { /* not allowed */ }
    return null;
}

export class SecretClipboard {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private copied: string | null = null;
    private until = 0;
    private listeners = new Set<() => void>();

    /** Copy `text`; clear it after `seconds` (0: never). Resolves false when the clipboard refused. */
    async copy(text: string, seconds: number): Promise<boolean> {
        this.cancelTimer();
        const ok = await write(text);
        if (!ok) { this.copied = null; this.emit(); return false; }
        this.copied = text;
        if (seconds > 0) {
            this.until = Date.now() + seconds * 1000;
            this.timer = setTimeout(() => void this.clear(), seconds * 1000);
        } else {
            this.until = 0;
        }
        this.emit();
        return true;
    }

    /** When the clipboard will be cleared (ms since the epoch), or 0. */
    get clearsAt(): number {
        return this.copied !== null ? this.until : 0;
    }

    /** Is a secret of ours on the clipboard (as far as we know)? */
    get holdsSecret(): boolean {
        return this.copied !== null;
    }

    /** Clear now, if the clipboard still holds our secret (or cannot be read). */
    async clear(): Promise<void> {
        this.cancelTimer();
        const ours = this.copied;
        this.copied = null;
        this.until = 0;
        if (ours !== null) {
            const now = await read();
            if (now === null || now === ours) await write("");
        }
        this.emit();
    }

    onChange(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private emit() {
        for (const fn of this.listeners) fn();
    }

    private cancelTimer() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }
}

/** One per page. */
export const secretClipboard = new SecretClipboard();

// The card is closing with a secret still on the clipboard: its timer
// would die with the page, so clear it now (synchronously, as the page may
// not get another turn).
if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
        if (!secretClipboard.holdsSecret) return;
        try {
            const ta = document.createElement("textarea");
            ta.value = " ";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
        } catch { /* nothing more to do */ }
    });
}
