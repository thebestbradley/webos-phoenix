// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Files dialogs, all Mojo-style sheets from the bottom of the card:
// name a new folder or file or rename one, confirm a delete, the info
// sheet, "Open with" and installing a package.

import { useEffect, useState } from "react";
import {
    appInstaller, formatMode, formatOctal, formatSize, mimeOf, openWith, validFileName, type FileEntry, type InstallStatus, type MimeHandler,
} from "@phoenix/luna";
import { Button, Dialog, ErrorText, Group, Note, Row, Spinner, TextField } from "@phoenix/ui";
import { kindLabel, longDate } from "./browse";

const errorText = (e: unknown) => (e as { errorText?: string }).errorText ?? (e instanceof Error ? e.message : String(e));

// ---- Name (new folder, new file, rename) ------------------------------------------------

export function NameDialog({ title, initial, action, taken, onSubmit, onClose }: {
    title: string;
    initial: string;
    action: string;
    /** Names already in the folder. */
    taken: string[];
    onSubmit: (name: string) => Promise<void>;
    onClose: () => void;
}) {
    const [name, setName] = useState(initial);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        const n = name.trim();
        if (!validFileName(n)) { setError("That name cannot be used."); return; }
        if (n !== initial && taken.includes(n)) { setError(`"${n}" already exists.`); return; }
        if (n === initial) { onClose(); return; }
        setBusy(true);
        try {
            await onSubmit(n);
            onClose();
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
        }
    };
    return (
        <Dialog open title={title} onClose={onClose} testId="name-dialog">
            <TextField value={name} onChange={(v) => { setName(v); setError(""); }} onSubmit={submit} autoFocus testId="name-field" />
            {error && <ErrorText>{error}</ErrorText>}
            <div className="fm-dialog-buttons">
                <Button variant="affirmative" busy={busy} data-testid="name-ok" onClick={submit}>{action}</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

// ---- Delete --------------------------------------------------------------------------

export function DeleteDialog({ entries, onConfirm, onClose }: { entries: FileEntry[]; onConfirm: () => Promise<void>; onClose: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const one = entries.length === 1 ? entries[0] : null;
    const title = one ? `Delete "${one.name}"?` : `Delete ${entries.length} items?`;
    const folders = entries.filter((e) => e.type === "directory").length;
    return (
        <Dialog open title={title} onClose={onClose} testId="delete-dialog"
                message={(folders ? (folders === 1 && one ? "The folder and everything in it will be deleted. " : "Folders are deleted with everything in them. ") : "") +
                         "This cannot be undone."}>
            {error && <ErrorText>{error}</ErrorText>}
            <div className="fm-dialog-buttons">
                <Button variant="negative" busy={busy} data-testid="delete-confirm" onClick={async () => {
                    setBusy(true);
                    try { await onConfirm(); onClose(); } catch (e) { setError(errorText(e)); setBusy(false); }
                }}>Delete</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

// ---- Info ------------------------------------------------------------------------------

export function InfoDialog({ entry, quota, onClose }: { entry: FileEntry; quota?: { used: number; total?: number }; onClose: () => void }) {
    const folder = entry.type === "directory";
    const type = folder ? "Folder" : `${kindLabel(entry)} (${mimeOf(entry.name)})`;
    const size = folder
        ? `${entry.count ?? 0} item${entry.count === 1 ? "" : "s"}`
        : `${formatSize(entry.size)}${entry.size >= 1024 ? ` (${entry.size.toLocaleString("en-US")} bytes)` : ""}`;
    return (
        <Dialog open title={entry.drive ? entry.drive.title : entry.name || "/"} onClose={onClose} testId="info-dialog">
            <Group className="fm-info">
                {entry.drive && <Row title="Account" value={entry.drive.account} testId="info-account" />}
                {quota && <Row title="Used" testId="info-quota"
                               value={quota.total ? `${formatSize(quota.used)} of ${formatSize(quota.total)}` : formatSize(quota.used)} />}
                <Row title="Type" value={type} testId="info-type" />
                <Row title={folder ? "Contains" : "Size"} value={size} testId="info-size" />
                <Row title="Modified" value={longDate(entry.mtime)} testId="info-modified" />
                <Row title="Permissions" value={`${formatMode(entry.mode, entry.type)} (${formatOctal(entry.mode)})${entry.readOnly ? ", read-only" : ""}`}
                     testId="info-permissions" />
                <Row title="Path" subtitle={<span className="fm-info-path" data-testid="info-path">{entry.path}</span>} />
            </Group>
            <div className="fm-dialog-buttons">
                <Button onClick={onClose} data-testid="info-close">Done</Button>
            </div>
        </Dialog>
    );
}

// ---- Open with ---------------------------------------------------------------------------

export function OpenWithDialog({ entry, onClose, onOpenAsText }: { entry: FileEntry; onClose: () => void; onOpenAsText?: () => void }) {
    const mime = mimeOf(entry.name);
    const [handlers, setHandlers] = useState<MimeHandler[] | null>(null);
    const [error, setError] = useState("");
    useEffect(() => { openWith.handlers(mime).then(setHandlers); }, [mime]);
    const run = async (p: Promise<unknown>) => {
        try { await p; onClose(); } catch (e) { setError(errorText(e)); }
    };
    return (
        <Dialog open title={`Open "${entry.name}"`} onClose={onClose} testId="open-with-dialog">
            {handlers === null ? <div className="fm-loading small"><Spinner /></div> : (
                <>
                    {handlers.length === 0 && <Note>No app says it opens {mime} files.</Note>}
                    <div className="fm-dialog-buttons">
                        {handlers.map((h) => (
                            <Button key={h.appId} variant="affirmative" data-testid={`open-with-${h.appId}`}
                                    onClick={() => run(openWith.launch(h.appId, entry.path))}>{h.title ?? h.appId}</Button>
                        ))}
                        {onOpenAsText && <Button data-testid="open-as-text" onClick={() => { onClose(); onOpenAsText(); }}>Text Editor</Button>}
                        <Button data-testid="open-default" onClick={() => run(openWith.open(entry.path))}>Open by Type</Button>
                        <Button onClick={onClose}>Cancel</Button>
                    </div>
                </>
            )}
            {error && <ErrorText>{error}</ErrorText>}
        </Dialog>
    );
}

// ---- Install a package ------------------------------------------------------------------------

const STEPS: Record<string, string> = { STARTING: "Starting...", IPKG_INSTALL: "Installing...", SUCCESS: "Installed." };

export function InstallDialog({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
    const [status, setStatus] = useState<InstallStatus | null>(null);
    const [result, setResult] = useState<"ok" | "failed" | null>(null);
    const [error, setError] = useState("");
    const start = () => {
        setStatus({ status: "STARTING" });
        appInstaller.install(entry.path, setStatus).then(() => setResult("ok"), (e) => { setResult("failed"); setError(errorText(e)); });
    };
    const busy = status !== null && result === null;
    return (
        <Dialog open title="Install Package" onClose={busy ? undefined : onClose} testId="install-dialog"
                message={status ? undefined : `Install "${entry.name}" (${formatSize(entry.size)})? Only install packages you trust.`}>
            {status && (
                <div className="fm-install-status" data-testid="install-status">
                    {busy && <Spinner />}
                    <span>{result === "failed" ? "Installation failed." : STEPS[status.status] ?? status.status}</span>
                </div>
            )}
            {error && <ErrorText>{error}</ErrorText>}
            <div className="fm-dialog-buttons">
                {!status && <Button variant="affirmative" data-testid="install-confirm" onClick={start}>Install</Button>}
                {!busy && <Button data-testid="install-close" onClick={onClose}>{status ? "Done" : "Cancel"}</Button>}
            </div>
        </Dialog>
    );
}
