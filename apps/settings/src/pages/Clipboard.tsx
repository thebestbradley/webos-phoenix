// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Clipboard: Phoenix's clipboard history (docs/M6-PLAN.md F2; launch
// params {page: "clipboard"}, which the Clipboard app's Preferences opens).
// All through org.webosphoenix.clipboard getSettings / setSettings
// (@phoenix/luna clipboard); the keyboard's clip strip and the Clipboard
// app follow at once.
//
//   History       on or off (off records nothing, drops the history and
//                 takes the clipboard key off the keyboard; saved clips
//                 stay), the keyboard key, how many clips and how long
//   Privacy       clear when the screen locks; sensitive clips (passwords,
//                 codes) kept masked and encrypted, or not kept; telling
//                 codes and passwords from their look
//   Apps          apps whose copies are never kept
//   Clear         the history, or everything

import { useEffect, useState } from "react";
import { apps, clipboard, type ClipboardSettings, type KeepFor } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, Group, ListSelector, Note, Page, PageHeader, PopupMenu, Row, ToggleButton } from "@phoenix/ui";

const KEEP: { label: string; value: KeepFor }[] = [
    { label: "1 hour", value: "hour" },
    { label: "1 day", value: "day" },
    { label: "1 week", value: "week" },
    { label: "1 month", value: "month" },
    { label: "Forever", value: "forever" },
];
const SIZES = [25, 50, 100, 200, 500];

export function ClipboardPage() {
    const s = useLuna<ClipboardSettings>((cb, err) => clipboard.watchSettings(cb, err), []).value;
    const [installed, setInstalled] = useState<{ id: string; title: string }[]>([]);
    const [adding, setAdding] = useState<HTMLElement | null>(null);
    const [clearing, setClearing] = useState<"history" | "all" | null>(null);
    const [done, setDone] = useState("");
    useEffect(() => {
        apps.list().then((l) => setInstalled(l.sort((a, b) => a.title.localeCompare(b.title)))).catch(() => setInstalled([]));
    }, []);
    if (!s) return <Page><PageHeader title="Clipboard" icon="icons/clipboard.png" /></Page>;

    const set = (changes: Partial<ClipboardSettings>) => void clipboard.setSettings(changes);
    const toggle = (key: "enabled" | "keyboardKey" | "clearOnLock" | "detectSecrets", title: string, subtitle?: string, disabled?: boolean) => (
        <Row title={title} subtitle={subtitle} disabled={disabled}>
            <ToggleButton value={s[key]} label={title} testId={`cb-${key}`} disabled={disabled} onChange={(v) => set({ [key]: v })} />
        </Row>
    );
    const titleOf = (id: string) => installed.find((a) => a.id === id)?.title ?? id;
    const addable = installed.filter((a) => !s.excludedApps.includes(a.id));
    const off = !s.enabled;

    return (
        <Page>
            <PageHeader title="Clipboard" icon="icons/clipboard.png" />
            <Note>Everything you copy is kept here and in the keyboard's clipboard key, so you can paste it again later. Pinned clips and clips in a category stay until you delete them.</Note>
            <Group label="History">
                {toggle("enabled", "Clipboard history", "Keep what you copy")}
                {toggle("keyboardKey", "Keyboard key", "Your clips above the keys", off)}
                <ListSelector title="Keep" value={s.keepFor} options={KEEP} disabled={off} testId="cb-keepFor" onChange={(v) => set({ keepFor: v })} />
                <ListSelector title="Up to" value={s.maxItems} disabled={off} testId="cb-maxItems"
                              options={SIZES.map((n) => ({ label: `${n} clips`, value: n }))} onChange={(v) => set({ maxItems: v })} />
            </Group>
            <Group label="Privacy">
                {toggle("clearOnLock", "Clear when locked", "The history goes when the screen locks", off)}
                <ListSelector title="Passwords and codes" value={s.sensitive} disabled={off} testId="cb-sensitive"
                              options={[{ label: "Keep, hidden", value: "mask" as const }, { label: "Don't keep", value: "skip" as const }]}
                              onChange={(v) => set({ sensitive: v })} />
                {toggle("detectSecrets", "Recognize secrets", "Codes and password-like text count as passwords", off)}
            </Group>
            <Note>Copies from password fields and from Passwords and Authenticator are always treated as passwords. Kept, they are encrypted and hidden, and show only after your device passcode.</Note>
            <Group label="Never keep copies from">
                {s.excludedApps.length === 0 && <Row title={<span className="cb-none">No apps</span>} />}
                {s.excludedApps.map((id) => (
                    <Row key={id} title={titleOf(id)} testId={`cb-excluded-${id}`}>
                        <button type="button" className="cb-remove" data-testid={`cb-include-${id}`}
                                onClick={() => set({ excludedApps: s.excludedApps.filter((x) => x !== id) })}>Remove</button>
                    </Row>
                ))}
            </Group>
            <Button data-testid="cb-exclude-add" disabled={off || addable.length === 0} onClick={(e) => setAdding(e.currentTarget)}>Add an App…</Button>
            <Button data-testid="cb-clear" onClick={() => setClearing("history")}>Clear History</Button>
            <Button variant="negative" data-testid="cb-clear-all" onClick={() => setClearing("all")}>Clear All Clips</Button>
            {done && <Note testId="cb-cleared">{done}</Note>}
            {adding && (
                <PopupMenu anchor={adding} options={addable.map((a) => ({ label: a.title, value: a.id }))}
                           onClose={() => setAdding(null)}
                           onSelect={(id) => { setAdding(null); set({ excludedApps: [...s.excludedApps, id] }); }} />
            )}
            <Dialog open={clearing !== null} onClose={() => setClearing(null)} testId="cb-clear-dialog"
                    title={clearing === "all" ? "Clear all clips?" : "Clear the history?"}
                    message={clearing === "all" ? "Every clip goes, pinned and saved ones too." : "Pinned clips and clips in a category stay."}>
                <Button variant="negative" data-testid="cb-clear-ok" onClick={() => {
                    const all = clearing === "all";
                    setClearing(null);
                    clipboard.clear(all).then((n) => setDone(n === 1 ? "1 clip cleared." : `${n} clips cleared.`), () => setDone(""));
                }}>{clearing === "all" ? "Clear All" : "Clear History"}</Button>
                <Button onClick={() => setClearing(null)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}
