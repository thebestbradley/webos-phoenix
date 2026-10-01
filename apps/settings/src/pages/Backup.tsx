// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Backup: back up every day or now, where backups go (the USB drive or a
// WebDAV server), the passphrase that encrypts them, and the backups there,
// to restore or delete. Legacy webOS's Backup app (com.palm.app.backup)
// backed up to the Palm Profile servers, which HP shut down; this keeps its
// shape (one switch, "Back Up Now", the last backup) on
// org.webosphoenix.service.backup (@phoenix/luna backup).
//
// Launch params {page: "backup"}; luna-systemui's "Backup Failure"
// dashboard opens com.palm.app.backup, which is this page.

import { useEffect, useState } from "react";
import {
    backup, backupErrorCode, BACKUP_PARTS, LunaError,
    type BackupDestination, type BackupFile, type BackupHeader, type BackupStatus,
} from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, ErrorText, Group, ListSelector, Note, Page, PageHeader, Row, Spinner, TextField, ToggleButton } from "@phoenix/ui";

export const errorText = (e: unknown) => (e instanceof LunaError ? e.errorText : e instanceof Error ? e.message : String(e));

export function when(iso: string | null | undefined): string {
    if (!iso) return "Never";
    const d = new Date(iso), now = new Date();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (d.getTime() >= day) return `Today, ${time}`;
    if (d.getTime() >= day - 86400000) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })}, ${time}`;
}

export function size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupPage() {
    const status = useLuna<BackupStatus>((cb, err) => backup.watchStatus(cb, err), []).value;
    const [backups, setBackups] = useState<BackupFile[] | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [where, setWhere] = useState(false);
    const [passphrase, setPassphrase] = useState(false);
    const [chosen, setChosen] = useState<BackupFile | null>(null);
    const busy = !!status && status.state !== "idle";
    const destKey = status?.destination ? JSON.stringify(status.destination) : "";

    // The backups where backups go, again after each backup.
    const lastTime = status?.last?.time ?? "";
    useEffect(() => {
        if (!status?.destination) { setBackups(null); return; }
        let live = true;
        setListError(null);
        backup.list().then((b) => { if (live) setBackups(b); }, (e) => { if (live) { setBackups([]); setListError(errorText(e)); } });
        return () => { live = false; };
    }, [destKey, lastTime, status?.state === "idle"]);

    async function backUpNow() {
        setError(null);
        try { await backup.backupNow(); } catch (e) { setError(errorText(e)); }
    }
    async function setAuto(on: boolean) {
        setError(null);
        try { await backup.configure({ auto: on }); } catch (e) { setError(errorText(e)); }
    }

    if (!status) return <Page><PageHeader title="Backup" icon="icons/backup.png" /><Row title="Loading…"><Spinner /></Row></Page>;
    const dest = status.destination;
    const last = status.last;

    return (
        <Page>
            <PageHeader title="Backup" icon="icons/backup.png" />
            <Group label="Backup">
                <Row title="Back up every day" subtitle={status.configured ? undefined : "Choose where backups go and a passphrase first"}>
                    <ToggleButton value={status.auto} label="Back up every day" disabled={!status.configured || busy}
                                  onChange={(on) => void setAuto(on)} testId="backup-auto" />
                </Row>
                <Row title="Last backup" testId="backup-last"
                     value={busy && status.state === "backingUp" ? "Backing up…" : when(status.lastSuccess)}>
                    {busy ? <Spinner /> : null}
                </Row>
                <Button onClick={() => void backUpNow()} disabled={!status.configured || busy} data-testid="backup-now">Back Up Now</Button>
            </Group>
            {error && <ErrorText>{error}</ErrorText>}
            {last && !last.ok && !error && <ErrorText testId="backup-failed">The last backup failed: {last.errorText}</ErrorText>}

            <Group label="Settings">
                <Row title="Back up to" chevron testId="backup-where" onClick={() => setWhere(true)}
                     value={!dest ? "Not set" : dest.type === "usb" ? "USB drive" : "WebDAV server"}
                     subtitle={dest?.type === "webdav" ? dest.url : dest?.type === "usb" ? "The backups folder" : undefined} />
                <Row title="Passphrase" chevron testId="backup-passphrase" onClick={() => setPassphrase(true)}
                     value={status.hasPassphrase ? "Set" : "Not set"} />
            </Group>
            <Note>
                Backed up: contacts, calendar, tasks, memos, messages, the call log and alarms kept on this device, your
                settings and the launcher layout, encrypted with your passphrase. Accounts sync their own data again
                when you add them back. Photos, music and other files are not in the backup: copy them from the USB drive.
            </Note>

            {dest && (
                <Group label="Backups">
                    {backups === null ? <Row title="Looking…"><Spinner /></Row>
                        : backups.length === 0 ? <Row title={listError ? "Could not look" : "No backups yet"} subtitle={listError ?? undefined} />
                        : backups.map((b) => (
                            <Row key={b.name} title={when(b.created)} subtitle={size(b.size)} chevron testId={`backup-file-${b.name}`}
                                 onClick={() => setChosen(b)} />
                        ))}
                </Group>
            )}

            {where && <WhereDialog current={dest} onClose={() => setWhere(false)} />}
            {passphrase && <PassphraseDialog first={!status.hasPassphrase} onClose={() => setPassphrase(false)} />}
            {chosen && <BackupDialog file={chosen} onClose={() => setChosen(null)} />}
        </Page>
    );
}

// Where backups go: the USB drive, or a WebDAV folder (checked, and made
// if it is not there, before it is kept).
export function WhereDialog({ current, onClose, onSaved, title }: {
    current: BackupDestination | null; onClose: () => void; onSaved?: (d: BackupDestination) => void; title?: string;
}) {
    const [type, setType] = useState<"usb" | "webdav">(current?.type ?? "usb");
    const [url, setUrl] = useState(current?.type === "webdav" ? current.url : "");
    const [user, setUser] = useState(current?.type === "webdav" ? current.username ?? "" : "");
    const [password, setPassword] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hadPassword = current?.type === "webdav";

    async function save() {
        setSaving(true);
        setError(null);
        const destination: BackupDestination = type === "usb" ? { type: "usb" } : { type: "webdav", url: url.trim(), username: user.trim(), password };
        try {
            await backup.configure({ destination });
            onSaved?.(destination);
            onClose();
        } catch (e) {
            const code = backupErrorCode(e);
            setError(code === "UNAUTHORIZED" ? "The server did not accept the user name or password." : errorText(e));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open title={title ?? "Back up to"} onClose={saving ? undefined : onClose} testId="backup-where-dialog">
            <ListSelector title="Place" value={type} testId="backup-type" onChange={(v) => setType(v as "usb" | "webdav")}
                          options={[{ label: "USB drive", value: "usb" }, { label: "WebDAV server", value: "webdav" }]} />
            {type === "usb"
                ? <Note>Backups go in the backups folder of the USB drive. Connect the device to a computer and copy them off it to keep them safe.</Note>
                : <>
                    <TextField label="Folder address" value={url} onChange={setUrl} testId="backup-url"
                               placeholder="https://cloud.example.com/remote.php/dav/files/me/Backups" />
                    <TextField label="User name" value={user} onChange={setUser} testId="backup-user" />
                    <TextField label="Password" type="password" value={password} onChange={setPassword} testId="backup-password"
                               placeholder={hadPassword ? "Unchanged" : "An app password, if the server has them"} />
                    <Note>Nextcloud and ownCloud: Settings &gt; WebDAV shows the address; add the folder's name at the end.</Note>
                </>}
            {error && <ErrorText testId="backup-where-error">{error}</ErrorText>}
            <Button onClick={() => void save()} disabled={saving || (type === "webdav" && !url.trim())} data-testid="backup-where-save">
                {saving ? "Checking…" : "Save"}
            </Button>
            <Button variant="dark" onClick={onClose} disabled={saving}>Cancel</Button>
        </Dialog>
    );
}

function PassphraseDialog({ first, onClose }: { first: boolean; onClose: () => void }) {
    const [p1, setP1] = useState("");
    const [p2, setP2] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const problem = p1.length > 0 && p1.length < 8 ? "At least 8 characters." : p2 && p1 !== p2 ? "The two do not match." : null;

    async function save() {
        setSaving(true);
        setError(null);
        try {
            await backup.configure({ passphrase: p1 });
            onClose();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open title={first ? "Set a Passphrase" : "Change Passphrase"} onClose={saving ? undefined : onClose} testId="backup-passphrase-dialog"
                message="Backups are encrypted with it, and you need it to restore one. Nobody can get it back for you: keep it somewhere safe.">
            <TextField label="Passphrase" type="password" value={p1} onChange={setP1} testId="backup-pass1" />
            <TextField label="Again" type="password" value={p2} onChange={setP2} testId="backup-pass2" />
            {!first && <Note>Backups made before keep the passphrase they were made with.</Note>}
            {(problem || error) && <ErrorText>{problem ?? error}</ErrorText>}
            <Button onClick={() => void save()} disabled={saving || !!problem || p1.length < 8 || p1 !== p2} data-testid="backup-pass-save">
                {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="dark" onClick={onClose} disabled={saving}>Cancel</Button>
        </Dialog>
    );
}

// One backup: what it holds, restore it (with its passphrase), delete it.
function BackupDialog({ file, onClose }: { file: BackupFile; onClose: () => void }) {
    const [header, setHeader] = useState<BackupHeader | null>(null);
    const [step, setStep] = useState<"info" | "restore" | "delete" | "done">("info");
    const [pass, setPass] = useState("");
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ restored: string[]; skipped: string[] } | null>(null);

    useEffect(() => {
        backup.inspect(file.name).then(setHeader, (e) => setError(errorText(e)));
    }, [file.name]);

    async function restore() {
        setWorking(true);
        setError(null);
        try {
            setResult(await backup.restore(file.name, pass));
            setStep("done");
        } catch (e) {
            setError(backupErrorCode(e) === "WRONG_PASSPHRASE" ? "That is not this backup's passphrase." : errorText(e));
        } finally {
            setWorking(false);
        }
    }
    async function remove() {
        setWorking(true);
        try {
            await backup.remove(file.name);
            onClose();
        } catch (e) {
            setError(errorText(e));
            setWorking(false);
        }
    }

    return (
        <Dialog open title={`Backup of ${when(file.created)}`} onClose={working ? undefined : onClose} testId="backup-dialog">
            {step === "info" && <>
                <Row title="From" value={header?.device.name || "—"} />
                <Row title="Size" value={size(file.size)} />
                {header?.parts.map((p) => <Row key={p.id} title={BACKUP_PARTS[p.id] ?? p.description ?? p.id} />)}
                {error && <ErrorText>{error}</ErrorText>}
                <Button onClick={() => setStep("restore")} disabled={!header} data-testid="backup-restore">Restore…</Button>
                <Button variant="negative" onClick={() => setStep("delete")} data-testid="backup-delete">Delete</Button>
                <Button variant="dark" onClick={onClose}>Close</Button>
            </>}
            {step === "restore" && <>
                <Note>Restoring puts back this backup's contacts, calendar, tasks, memos, messages, call log, alarms, settings
                    and launcher layout. Items with the same name are replaced; nothing else is deleted.</Note>
                <TextField label="The backup's passphrase" type="password" value={pass} onChange={setPass} testId="backup-restore-pass" />
                {error && <ErrorText testId="backup-restore-error">{error}</ErrorText>}
                <Button onClick={() => void restore()} disabled={working || !pass} data-testid="backup-restore-confirm">
                    {working ? "Restoring…" : "Restore"}
                </Button>
                <Button variant="dark" onClick={() => setStep("info")} disabled={working}>Back</Button>
            </>}
            {step === "delete" && <>
                <Note>The backup is deleted from where backups go. This cannot be undone.</Note>
                {error && <ErrorText>{error}</ErrorText>}
                <Button variant="negative" onClick={() => void remove()} disabled={working} data-testid="backup-delete-confirm">Delete Backup</Button>
                <Button variant="dark" onClick={() => setStep("info")} disabled={working}>Back</Button>
            </>}
            {step === "done" && result && <>
                <Row title="Restored" testId="backup-restored" />
                {result.restored.map((id) => <Row key={id} title={BACKUP_PARTS[id] ?? id} />)}
                {result.skipped.length > 0 && <Note>Not restored (nothing on this device takes them): {result.skipped.join(", ")}</Note>}
                <Button onClick={onClose} data-testid="backup-done">Done</Button>
            </>}
        </Dialog>
    );
}
