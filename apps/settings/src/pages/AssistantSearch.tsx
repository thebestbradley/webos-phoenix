// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant > Search your phone: the index of the user's own
// things by what they mean (org.webosphoenix.service.index, services/index;
// @phoenix/luna semanticIndex), which the Assistant ("find the email about
// the boiler") and Just Type ("From your phone") search. Off until turned
// on; then its model (EmbeddingGemma 2, a one-time download), a switch for
// each source (one turned off takes its part of the index with it),
// "Include photos and voice memos" (the pictures and recordings themselves,
// with the model's vision and audio encoders), "Use in answers" (what it
// finds goes with a question to the model answering it), how big it is and
// what it is doing, Rebuild Index and Delete Index.

import { useState } from "react";
import { formatBytes, semanticIndex, type IndexSourceId, type IndexStatus, type LunaError } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, Group, Note, Row, ToggleButton } from "@phoenix/ui";

const errorText = (e: unknown) => (e as LunaError).errorText ?? (e instanceof Error ? e.message : String(e));
const SOURCE_NOTES: Partial<Record<IndexSourceId, string>> = {
    email: "Subjects and messages, every account",
    messages: "Texts and chats, every account",
    files: "Names, and the words of text files and PDFs",
    photos: "Names, albums and dates",
    voicememos: "Titles and transcripts",
};

function stateText(st: IndexStatus): string {
    if (!st.enabled) return "Off";
    if (st.state === "needsModel") return "Needs EmbeddingGemma 2: download it above";
    if (st.state === "indexing" && st.progress) return `Indexing ${st.progress.source}: ${st.progress.done} looked at`;
    if (st.state === "indexing") return "Indexing";
    if (st.state === "waiting") return st.waiting === "saver" ? "Paused while the battery saver is on"
        : st.waiting === "battery" ? "Paused: the battery is low" : "Waiting for the charger (or the screen off) to go on";
    if (st.state === "error") return `Stopped: ${st.error}`;
    return st.lastRun ? "Up to date" : "Starting";
}
function count(n: number, one: string, many: string) { return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`; }

export function SearchYourPhone({ off }: { off: boolean }) {
    const st = useLuna<IndexStatus>((cb, err) => semanticIndex.watchStatus(cb, err), []).value;
    const [error, setError] = useState("");
    const [deleting, setDeleting] = useState(false);
    const act = (p: Promise<unknown>) => { setError(""); p.catch((e) => setError(errorText(e))); };
    if (!st) return null;
    const on = st.enabled && !off;
    const text = st.model.text, media = st.model.media;
    const busy = !!(text.downloading || media.downloading);
    const pct = (d: { received: number; total: number } | null) => d ? ` · ${Math.round(100 * d.received / Math.max(1, d.total))}%` : "";
    const modelButton = (m: typeof text, isMedia: boolean) => m.downloading
        ? <button type="button" className="as-small" data-testid={`ix-cancel-${isMedia ? "media" : "text"}`} onClick={() => act(semanticIndex.cancelDownload())}>Cancel</button>
        : m.installed
            ? <button type="button" className="as-small negative" data-testid={`ix-remove-${isMedia ? "media" : "text"}`} onClick={() => act(semanticIndex.removeModel(isMedia))}>Remove</button>
            : <button type="button" className="as-small" disabled={busy || !st.server.available} data-testid={`ix-download-${isMedia ? "media" : "text"}`}
                      onClick={() => act(semanticIndex.downloadModel(isMedia))}>Download</button>;
    return (
        <>
            <Group label="Search your phone">
                <Row title="Search your phone" subtitle="Find your memos, email, messages, files and more by what they mean, here on the phone" disabled={off}>
                    <ToggleButton value={st.enabled} label="Search your phone" testId="ix-enabled" disabled={off}
                                  onChange={(v) => act(semanticIndex.setSettings({ enabled: v }))} />
                </Row>
                <Row testId="ix-model-text" title={text.name}
                     subtitle={`${formatBytes(text.size)} · ${text.licence} · Google, as llama.cpp converts it${text.installed ? " · downloaded" : ""}${pct(text.downloading)}`}>
                    {modelButton(text, false)}
                </Row>
                <Row title="Include photos and voice memos" subtitle="Look at the pictures and listen to the recordings themselves, not only their names" disabled={!on || !text.installed}>
                    <ToggleButton value={st.settings.media} label="Include photos and voice memos" testId="ix-media" disabled={!on || !text.installed}
                                  onChange={(v) => act(semanticIndex.setSettings({ media: v }).then(() => {
                                      if (v && !media.installed && !media.downloading) return semanticIndex.downloadModel(true);
                                  }))} />
                </Row>
                {(st.settings.media || media.installed || media.downloading) && (
                    <Row testId="ix-model-media" title={media.name}
                         subtitle={`${formatBytes(media.size)} more · ${media.licence}${media.installed ? " · downloaded" : ""}${pct(media.downloading)}`}>
                        {modelButton(media, true)}
                    </Row>
                )}
                <Row title="Use in answers" subtitle="When you ask about your things, what it finds goes with your question to the model answering it" disabled={!on}>
                    <ToggleButton value={st.settings.answers} label="Use in answers" testId="ix-answers" disabled={!on}
                                  onChange={(v) => act(semanticIndex.setSettings({ answers: v }))} />
                </Row>
            </Group>
            {!st.server.available && st.enabled && <Note testId="ix-no-server">{st.server.howToInstall || "The model needs llama.cpp's llama-server, which is not installed."}</Note>}
            <Group label="Search in">
                {st.sources.map((x) => (
                    <Row key={x.id} testId={`ix-source-${x.id}`} title={x.title} disabled={!on}
                         subtitle={[SOURCE_NOTES[x.id], x.enabled && x.records ? count(x.records, "item", "items") : ""].filter(Boolean).join(" · ") || undefined}>
                        <ToggleButton value={x.enabled} label={x.title} testId={`ix-toggle-${x.id}`} disabled={!on}
                                      onChange={(v) => act(semanticIndex.setSettings({ sources: { [x.id]: v } }))} />
                    </Row>
                ))}
            </Group>
            <Group label="Index">
                <Row testId="ix-size" title="Size" subtitle={`${count(st.records, "item", "items")} · ${count(st.passages, "passage", "passages")} · ${st.bytes ? formatBytes(st.bytes) : "0 KB"}`} />
                <Row testId="ix-state" title="Status" subtitle={stateText(st)} />
            </Group>
            <Button data-testid="ix-rebuild" disabled={!on || !text.installed} onClick={() => act(semanticIndex.rebuild())}>Rebuild Index</Button>
            <Button variant="negative" data-testid="ix-delete" disabled={!st.records && !st.enabled} onClick={() => setDeleting(true)}>Delete Index</Button>
            {error && <Note testId="ix-error">{error}</Note>}
            <Note testId="ix-privacy">Everything stays on this phone: the model runs here, and the index is kept in the system's own storage, never backed up or sent anywhere. It works in the background while the phone charges (or sleeps with battery to spare), never on a battery saver. Turning a source off deletes its part of the index; Full Erase deletes it all.</Note>
            <Dialog open={deleting} onClose={() => setDeleting(false)} testId="ix-delete-dialog" title="Delete the index?"
                    message="What it learned of your things is deleted from this phone, and Search your phone is turned off. The model stays downloaded.">
                <Button variant="negative" data-testid="ix-delete-ok" onClick={() => { setDeleting(false); act(semanticIndex.deleteIndex()); }}>Delete Index</Button>
                <Button onClick={() => setDeleting(false)}>Cancel</Button>
            </Dialog>
        </>
    );
}
