// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Copy and paste. The system clipboard when the web runtime lets the page
// use it; otherwise the Terminal keeps its own (shared by its cards), so
// copy and paste between sessions always work.

const KEY = "org.webosphoenix.terminal.clipboard";

function remember(text: string) {
    try { localStorage.setItem(KEY, text); } catch { /* ignore */ }
}

function remembered(): string {
    try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export async function copyText(text: string): Promise<void> {
    if (!text) return;
    remember(text);
    try {
        await navigator.clipboard.writeText(text);
        return;
    } catch { /* not allowed here */ }
    // The older way: select the text in a hidden field and copy. Selecting
    // takes the keyboard focus, and this runs after the refusal above, when
    // the user may already be typing again, so the focus goes back to where
    // it was (the terminal); otherwise their keys would go nowhere.
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ta = document.createElement("textarea");
    try {
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
    } catch { /* the Terminal's own clipboard has it */ } finally {
        ta.remove();
        if (prev && prev.isConnected) prev.focus({ preventScroll: true });
    }
}

export async function pasteText(): Promise<string> {
    try {
        // A permission prompt nobody answers must not hang the paste.
        const t = await Promise.race([
            navigator.clipboard.readText(),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 500)),
        ]);
        if (t) return t;
    } catch { /* not allowed here */ }
    return remembered();
}
