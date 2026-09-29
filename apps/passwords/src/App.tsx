// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Passwords: a KeePass password manager in the webOS 2.x Heritage style.
//
//   Locked      the databases found on the device (and recently opened
//               ones); pick one and type its master password, or create
//               a new one
//   Unlocked    the database's groups and entries, a search field, an
//               entry's fields with copy and show, its TOTP code with a
//               countdown ring, an editor with the password generator
//
// Databases are KDBX 4 files (kdbx.ts, kdbxweb + Argon2) under
// /media/internal (storage.ts), so KeePassXC and KeePassDX open the same
// file. Security (docs/SECURITY-APPS.md):
//   - the decrypted database exists only in this page's memory, while
//     unlocked; nothing about entries goes to db8 or localStorage, and
//     appinfo.json declares no Just Type search
//   - it locks when the screen locks, when the card is minimized (after a
//     grace the user chooses; at once by default) and after an idle time
//     (@phoenix/secrets AutoLock)
//   - copied values are cleared from the clipboard after a while
//   - nothing is logged
//
// Launch params: {target: "/media/internal/.../x.kdbx"} opens that file
// (Files' "Open with").

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { apps } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import {
    BackProvider, Button, cx, Dialog, Divider, ErrorText, Glyph, ListSelector, Note, PageHeader, PopupMenu, Row, Slider, Spinner, TextField,
    Toolbar, ToolSpacer, IconToolButton, useBack,
} from "@phoenix/ui";
import { buildOtpauth, groupCode, OtpUriError, parseOtpauth, parseSecret, secretClipboard, totpRemaining, type LockReason } from "@phoenix/secrets";
import { CountdownRing, useAutoLock, useClipboardCountdown, useNow, useTotpCode } from "@phoenix/secrets/react";
import {
    applyEdit, createDatabase, customFields, groupPath, inRecycleBin, mergeRemote, newEntry, newGroup, openDatabase,
    openWithCredentials, otpOf, otpUriOf, recycleBin, remove, saveDatabase, search, setMasterPassword, sortedEntries, sortedGroups, text,
    title as entryTitle, VaultError, type Entry, type EntryEdit, type Group, type Kdbx,
} from "./kdbx";
import {
    DEFAULT_GENERATOR, estimateBits, generatedEntropy, generatePassword, MAX_LENGTH, MIN_LENGTH, strengthOf, type GeneratorOptions,
} from "./generator";
import {
    dbName, ensureDbDir, fileNameFor, findDatabases, forgetRecent, isKdbx, loadPrefs, loadRecent, newDatabasePath, readDatabase, rememberRecent,
    sameStamp, savePrefs, stampOf, writeDatabase, type FileStamp, type Prefs,
} from "./storage";
import { DatabaseIcon, DiceIcon, EyeIcon, FolderIcon, KeyIcon, LockIcon } from "./icons";

const errorText = (e: unknown) => (e instanceof VaultError ? e.message : (e as { errorText?: string }).errorText ?? (e instanceof Error ? e.message : String(e)));

interface Session {
    db: Kdbx;
    path: string;
    stamp: FileStamp;
}

const LOCK_REASONS: Record<LockReason, string> = {
    screen: "Locked because the screen locked.",
    hidden: "Locked because the card was minimized.",
    idle: "Locked after a while without use.",
    manual: "",
};

// ---- Small pieces ----------------------------------------------------------------------

function HeaderButton({ label, onClick, children, testId }: { label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: ReactNode; testId?: string }) {
    return (
        <button type="button" className="pw-header-button" aria-label={label} data-testid={testId} onClick={onClick}>{children}</button>
    );
}

function StrengthMeter({ bits }: { bits: number }) {
    const s = strengthOf(bits);
    const label = { none: "", weak: "Weak", fair: "Fair", good: "Good", strong: "Strong" }[s];
    return (
        <div className={cx("pw-strength", s)} data-testid="strength" data-strength={s}>
            <div className="pw-strength-bar"><span style={{ width: `${Math.min(100, (bits / 100) * 100)}%` }} /></div>
            <span className="pw-strength-label">{label}{bits > 0 && ` · ${bits} bits`}</span>
        </div>
    );
}

function Toast({ children }: { children: ReactNode }) {
    return <div className="pw-toast" role="status" data-testid="toast">{children}</div>;
}

// ---- Locked: choose and unlock a database -------------------------------------------------

function LockScreen({ initialPath, notice, onUnlocked }: { initialPath: string | null; notice: string; onUnlocked: (s: Session) => void }) {
    const [files, setFiles] = useState<{ path: string; mtime: number }[] | null>(null);
    const [selected, setSelected] = useState<string | null>(initialPath);
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [creating, setCreating] = useState(false);

    const refresh = useCallback(async () => {
        const found = await findDatabases().catch(() => []);
        const recent = loadRecent();
        const all = new Map<string, { path: string; mtime: number }>();
        for (const p of recent) all.set(p, { path: p, mtime: 0 });
        for (const f of found) all.set(f.path, { path: f.path, mtime: f.mtime });
        const list = [...all.values()].sort((a, b) => recent.indexOf(a.path) - recent.indexOf(b.path) || b.mtime - a.mtime);
        const withRecentFirst = [...list.filter((f) => recent.includes(f.path)), ...list.filter((f) => !recent.includes(f.path))];
        setFiles(withRecentFirst);
        setSelected((s) => s ?? (withRecentFirst.length === 1 ? withRecentFirst[0].path : null));
    }, []);
    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => { if (initialPath) { setSelected(initialPath); setPassword(""); setError(""); } }, [initialPath]);

    const unlock = async () => {
        if (!selected || busy) return;
        if (!password) { setError("Type the master password."); return; }
        setBusy(true);
        setError("");
        try {
            const { data, stamp } = await readDatabase(selected);
            const db = await openDatabase(data, password);
            rememberRecent(selected);
            setPassword("");
            onUnlocked({ db, path: selected, stamp });
        } catch (e) {
            setError(errorText(e));
            if (!(e instanceof VaultError) && !(await stampOf(selected))) forgetRecent(selected);
            setBusy(false);
        }
    };

    return (
        <div className="pw-app">
            <div className="pw-scroll">
                <div className="pw-page">
                    <PageHeader icon="icon.png" title="Passwords" />
                    {notice && <div className="pw-notice" data-testid="lock-notice"><LockIcon size={18} /> {notice}</div>}
                    <Divider caption="Databases" />
                    {files === null && <div className="pw-loading"><Spinner large /></div>}
                    {files?.length === 0 && (
                        <div className="pw-empty" data-testid="no-databases">
                            No password databases yet. Create one, or copy a .kdbx file from KeePassXC or KeePassDX into
                            the <b>passwords</b> folder with Files or over USB.
                        </div>
                    )}
                    <div className="pw-list" data-testid="database-list">
                        {files?.map((f) => (
                            <div key={f.path} className={cx("pw-db", selected === f.path && "open")}>
                                <Row icon={<span className="pw-db-icon"><DatabaseIcon size={22} /></span>}
                                     title={dbName(f.path)} subtitle={f.path.replace(/\/[^/]*$/, "")}
                                     onClick={() => { setSelected(selected === f.path ? null : f.path); setPassword(""); setError(""); }}
                                     testId={`db-${dbName(f.path)}`} />
                                {selected === f.path && (
                                    <div className="pw-unlock" data-testid="unlock-form">
                                        <TextField type="password" value={password} onChange={(v) => { setPassword(v); setError(""); }} onSubmit={unlock}
                                                   placeholder="Master password" autoFocus testId="master-password" />
                                        {error && <ErrorText>{error}</ErrorText>}
                                        <Button variant="affirmative" busy={busy} onClick={() => void unlock()} data-testid="unlock">
                                            {busy ? "Unlocking…" : "Unlock"}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="pw-lock-actions">
                        <Button onClick={() => setCreating(true)} data-testid="new-database">New Database</Button>
                    </div>
                    <Note>
                        Passwords keeps KeePass (.kdbx) files in /media/internal/passwords. Sync the file with KeePassXC or
                        KeePassDX; entries never leave the file and are not searchable from Just Type.
                    </Note>
                </div>
            </div>
            {creating && (
                <NewDatabaseDialog onClose={() => setCreating(false)}
                                   onCreated={(s) => { setCreating(false); rememberRecent(s.path); onUnlocked(s); }} />
            )}
        </div>
    );
}

function NewDatabaseDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Session) => void }) {
    const [name, setName] = useState("Personal");
    const [pw, setPw] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const bits = estimateBits(pw);
    const create = async () => {
        const file = fileNameFor(name);
        if (!file) { setError("Choose a name without / \\ : * ? \" < > |."); return; }
        if (pw.length < 8) { setError("Use at least 8 characters for the master password."); return; }
        if (pw !== confirm) { setError("The passwords do not match."); return; }
        setBusy(true);
        try {
            await ensureDbDir();
            const path = newDatabasePath(file);
            const db = createDatabase(name.trim().replace(/\.kdbx$/i, ""), pw);
            const stamp = await writeDatabase(path, await saveDatabase(db), true);
            setPw("");
            setConfirm("");
            onCreated({ db, path, stamp });
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
        }
    };
    return (
        <Dialog open title="New Database" onClose={busy ? undefined : onClose} testId="new-database-dialog">
            <TextField label="Name" value={name} onChange={(v) => { setName(v); setError(""); }} maxLength={80} testId="new-name" />
            <TextField label="Master password" type="password" value={pw} onChange={(v) => { setPw(v); setError(""); }} testId="new-password" />
            <StrengthMeter bits={bits} />
            <TextField label="Confirm" type="password" value={confirm} onChange={(v) => { setConfirm(v); setError(""); }} onSubmit={create} testId="new-confirm" />
            <div className="pw-hint">There is no way to recover a forgotten master password.</div>
            {error && <ErrorText>{error}</ErrorText>}
            <div className="pw-dialog-buttons">
                <Button variant="affirmative" busy={busy} onClick={() => void create()} data-testid="create-database">Create</Button>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
            </div>
        </Dialog>
    );
}

// ---- Unlocked: one entry ---------------------------------------------------------------------

function FieldRow({ label, value, secret, onCopy, testId, multiline }: {
    label: string; value: string; secret?: boolean; onCopy?: () => void; testId: string; multiline?: boolean;
}) {
    const [shown, setShown] = useState(false);
    if (!value) return null;
    return (
        <div className="pw-field" data-testid={testId}>
            <div className="pw-field-label">{label}</div>
            <div className="pw-field-row">
                <div className={cx("pw-field-value", secret && !shown && "masked", multiline && "multiline")} data-testid={`${testId}-value`}>
                    {secret && !shown ? "•".repeat(Math.min(12, Math.max(8, value.length))) : value}
                </div>
                {secret && (
                    <button type="button" className="pw-icon-button" aria-label={shown ? "Hide" : "Show"} aria-pressed={shown}
                            data-testid={`${testId}-show`} onClick={() => setShown(!shown)}>
                        <EyeIcon size={20} off={shown} />
                    </button>
                )}
                {onCopy && (
                    <button type="button" className="pw-icon-button" aria-label={`Copy ${label}`} data-testid={`${testId}-copy`} onClick={onCopy}>
                        <Glyph name="copy" size={20} />
                    </button>
                )}
            </div>
        </div>
    );
}

function TotpRow({ entry, onCopy }: { entry: Entry; onCopy: (code: string) => void }) {
    const params = useMemo(() => otpOf(entry), [entry]);
    const now = useNow(250);
    const code = useTotpCode(params, now);
    if (!params) return text(entry, "otp") || text(entry, "TOTP Seed")
        ? <div className="pw-field"><div className="pw-field-label">One-time code</div><div className="pw-hint">This TOTP setting is not supported.</div></div>
        : null;
    if (params.type !== "totp") return null;
    const left = totpRemaining(now, params.period);
    return (
        <div className="pw-field" data-testid="field-totp">
            <div className="pw-field-label">One-time code</div>
            <div className="pw-field-row">
                <div className="pw-field-value pw-totp" data-testid="field-totp-value">{code ? groupCode(code) : "…"}</div>
                <CountdownRing remaining={left} period={params.period} testId="totp-ring" />
                <button type="button" className="pw-icon-button" aria-label="Copy one-time code" data-testid="field-totp-copy"
                        disabled={!code} onClick={() => code && onCopy(code)}>
                    <Glyph name="copy" size={20} />
                </button>
            </div>
        </div>
    );
}

function EntryDetail({ db, entry, onCopy, onEdit, onDelete, onClose }: {
    db: Kdbx; entry: Entry; onCopy: (value: string, what: string) => void; onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
    useBack(() => { onClose(); return true; });
    const url = text(entry, "URL");
    const openUrl = /^https?:\/\//i.test(url) ? url : "";
    return (
        <div className="pw-detail" data-testid="entry-detail">
            <div className="pw-detail-title">
                <span className="pw-entry-icon"><KeyIcon size={22} /></span>
                <span data-testid="entry-title">{entryTitle(entry)}</span>
            </div>
            <div className="pw-path">{groupPath(entry.parentGroup).join(" › ")}</div>
            <div className="pw-fields">
                <FieldRow label="User name" value={text(entry, "UserName")} testId="field-username" onCopy={() => onCopy(text(entry, "UserName"), "User name")} />
                <FieldRow label="Password" value={text(entry, "Password")} secret testId="field-password" onCopy={() => onCopy(text(entry, "Password"), "Password")} />
                <TotpRow entry={entry} onCopy={(c) => onCopy(c, "One-time code")} />
                <FieldRow label="Website" value={url} testId="field-url" onCopy={() => onCopy(url, "Website")} />
                {customFields(entry).map((f) => (
                    <FieldRow key={f.name} label={f.name} value={text(entry, f.name)} secret={f.protected} testId={`field-custom-${f.name}`}
                              onCopy={() => onCopy(text(entry, f.name), f.name)} />
                ))}
                <FieldRow label="Notes" value={text(entry, "Notes")} multiline testId="field-notes" />
            </div>
            {entry.times.lastModTime && <div className="pw-modified">Changed {entry.times.lastModTime.toLocaleString()}</div>}
            <div className="pw-actions">
                {openUrl && <button type="button" className="pw-action" onClick={() => void apps.launch("com.palm.app.browser", { target: openUrl })}>Open Website</button>}
                <button type="button" className="pw-action" onClick={onEdit} data-testid="edit-entry">Edit</button>
                <button type="button" className="pw-action negative" onClick={onDelete} data-testid="delete-entry">
                    {inRecycleBin(db, entry) ? "Delete Forever" : "Delete"}
                </button>
            </div>
        </div>
    );
}

// ---- Unlocked: the editor -----------------------------------------------------------------

function MultiLine({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
    return (
        <label style={{ display: "block" }}>
            <div className="pui-field-label">{label}</div>
            <div className="pui-field pw-textarea">
                <textarea value={value} rows={3} onChange={(e) => onChange(e.target.value)} data-testid={testId}
                          autoComplete="off" autoCapitalize="off" spellCheck={false} />
            </div>
        </label>
    );
}

/** An otpauth:// URI, or a bare base32 setup key made into one. Throws OtpUriError. */
function otpFromInput(input: string, issuer: string, account: string): string {
    const s = input.trim();
    if (!s) return "";
    if (s.startsWith("otpauth://")) return buildOtpauth(parseOtpauth(s));
    return buildOtpauth({ type: "totp", secret: parseSecret(s), algorithm: "SHA1", digits: 6, period: 30, counter: 0, issuer, account });
}

function EntryEditor({ entry, isNew, onSave, onCancel, onGenerate }: {
    entry: Entry; isNew: boolean; onSave: (edit: EntryEdit) => Promise<void>; onCancel: () => void; onGenerate: (apply: (pw: string) => void) => void;
}) {
    const initialOtp = useMemo(() => otpUriOf(entry), [entry]);
    const [f, setF] = useState(() => ({
        title: text(entry, "Title"), username: text(entry, "UserName"), password: text(entry, "Password"), url: text(entry, "URL"),
        notes: text(entry, "Notes"), otp: initialOtp,
    }));
    const [show, setShow] = useState(isNew);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    useBack(() => { if (!busy) onCancel(); return true; });
    const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setError(""); };
    const save = async () => {
        if (!f.title.trim()) { setError("Give the entry a title."); return; }
        let otp: string | undefined;
        if (f.otp.trim() !== initialOtp) {
            try { otp = otpFromInput(f.otp, f.title.trim(), f.username.trim()); } catch (e) {
                setError(e instanceof OtpUriError ? "One-time code: " + e.message : "One-time code: not valid"); return;
            }
        }
        setBusy(true);
        try {
            await onSave({ title: f.title.trim(), username: f.username, password: f.password, url: f.url.trim(), notes: f.notes, otp });
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
        }
    };
    return (
        <div className="pw-detail pw-editor" data-testid="entry-editor">
            <div className="pw-detail-title">{isNew ? "New Entry" : "Edit Entry"}</div>
            <TextField label="Title" value={f.title} onChange={set("title")} autoFocus={isNew} maxLength={200} testId="edit-title" />
            <TextField label="User name" value={f.username} onChange={set("username")} testId="edit-username" />
            <div className="pw-password-edit">
                <div className="pw-grow">
                    <TextField label="Password" type={show ? "text" : "password"} value={f.password} onChange={set("password")} testId="edit-password" />
                </div>
                <button type="button" className="pw-icon-button" aria-label={show ? "Hide" : "Show"} onClick={() => setShow(!show)} data-testid="edit-show">
                    <EyeIcon size={20} off={show} />
                </button>
                <button type="button" className="pw-icon-button" aria-label="Generate a password" data-testid="edit-generate"
                        onClick={() => onGenerate((pw) => { setF((x) => ({ ...x, password: pw })); setShow(true); })}>
                    <DiceIcon size={20} />
                </button>
            </div>
            <StrengthMeter bits={estimateBits(f.password)} />
            <TextField label="Website" value={f.url} onChange={set("url")} placeholder="https://" testId="edit-url" />
            <TextField label="One-time code" value={f.otp} onChange={set("otp")} placeholder="Setup key or otpauth:// link" testId="edit-otp" />
            <MultiLine label="Notes" value={f.notes} onChange={set("notes")} testId="edit-notes" />
            {error && <ErrorText>{error}</ErrorText>}
            <div className="pw-dialog-buttons">
                <Button variant="affirmative" busy={busy} onClick={() => void save()} data-testid="save-entry">Save</Button>
                <Button onClick={onCancel} disabled={busy} data-testid="cancel-entry">Cancel</Button>
            </div>
        </div>
    );
}

function GeneratorDialog({ onUse, onClose }: { onUse: (pw: string) => void; onClose: () => void }) {
    const [o, setO] = useState<GeneratorOptions>(DEFAULT_GENERATOR);
    const [pw, setPw] = useState(() => generatePassword(DEFAULT_GENERATOR));
    const regen = (next: GeneratorOptions) => {
        setO(next);
        try { setPw(generatePassword(next)); } catch { setPw(""); }
    };
    const chip = (k: "lower" | "upper" | "digits" | "symbols" | "noAmbiguous", label: string) => (
        <button type="button" className={cx("pw-chip", o[k] && "on")} role="checkbox" aria-checked={o[k]} data-testid={`gen-${k}`}
                onClick={() => regen({ ...o, [k]: !o[k] })}>
            <span className="pw-chip-box">{o[k] && <Glyph name="check" size={14} />}</span>{label}
        </button>
    );
    return (
        <Dialog open title="Generate Password" onClose={onClose} testId="generator">
            <div className="pw-generated" data-testid="generated">{pw || "Choose at least one kind of character"}</div>
            <div className="pw-gen-length">
                <span>{Math.round(o.length)} characters · {generatedEntropy(o)} bits</span>
            </div>
            <Slider value={o.length} min={MIN_LENGTH} max={MAX_LENGTH} step={1} label="Length" testId="gen-length"
                    onChange={(v) => setO({ ...o, length: v })} onChangeComplete={(v) => regen({ ...o, length: v })} />
            <div className="pw-chips">
                {chip("upper", "A–Z")}
                {chip("lower", "a–z")}
                {chip("digits", "0–9")}
                {chip("symbols", "!#$%")}
                {chip("noAmbiguous", "No look-alikes")}
            </div>
            <div className="pw-dialog-row">
                <Button onClick={() => regen(o)} data-testid="gen-again">Again</Button>
                <Button variant="affirmative" disabled={!pw} onClick={() => { onUse(pw); onClose(); }} data-testid="gen-use">Use</Button>
            </div>
        </Dialog>
    );
}

// ---- Dialogs -------------------------------------------------------------------------------

function NameDialog({ title, initial, action, onSubmit, onClose }: {
    title: string; initial: string; action: string; onSubmit: (name: string) => Promise<void>; onClose: () => void;
}) {
    const [name, setName] = useState(initial);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        if (!name.trim()) { setError("Type a name."); return; }
        setBusy(true);
        try { await onSubmit(name.trim()); onClose(); } catch (e) { setError(errorText(e)); setBusy(false); }
    };
    return (
        <Dialog open title={title} onClose={onClose} testId="name-dialog">
            <TextField value={name} onChange={(v) => { setName(v); setError(""); }} onSubmit={submit} autoFocus maxLength={120} testId="name-field" />
            {error && <ErrorText>{error}</ErrorText>}
            <div className="pw-dialog-buttons">
                <Button variant="affirmative" busy={busy} onClick={() => void submit()} data-testid="name-ok">{action}</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

function ConfirmDialog({ title, message, action, onConfirm, onClose }: {
    title: string; message: string; action: string; onConfirm: () => Promise<void>; onClose: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    return (
        <Dialog open title={title} message={message} onClose={onClose} testId="confirm-dialog">
            {error && <ErrorText>{error}</ErrorText>}
            <div className="pw-dialog-buttons">
                <Button variant="negative" busy={busy} data-testid="confirm-ok" onClick={async () => {
                    setBusy(true);
                    try { await onConfirm(); onClose(); } catch (e) { setError(errorText(e)); setBusy(false); }
                }}>{action}</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

function MasterPasswordDialog({ onChange, onClose }: { onChange: (pw: string) => Promise<void>; onClose: () => void }) {
    const [pw, setPw] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        if (pw.length < 8) { setError("Use at least 8 characters."); return; }
        if (pw !== confirm) { setError("The passwords do not match."); return; }
        setBusy(true);
        try { await onChange(pw); onClose(); } catch (e) { setError(errorText(e)); setBusy(false); }
    };
    return (
        <Dialog open title="Change Master Password" onClose={busy ? undefined : onClose} testId="master-dialog">
            <TextField label="New master password" type="password" value={pw} onChange={(v) => { setPw(v); setError(""); }} testId="master-new" />
            <StrengthMeter bits={estimateBits(pw)} />
            <TextField label="Confirm" type="password" value={confirm} onChange={(v) => { setConfirm(v); setError(""); }} onSubmit={submit} testId="master-confirm" />
            <div className="pw-hint">KeePassXC and KeePassDX will need the new password for this file too.</div>
            {error && <ErrorText>{error}</ErrorText>}
            <div className="pw-dialog-buttons">
                <Button variant="affirmative" busy={busy} onClick={() => void submit()} data-testid="master-ok">Change</Button>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
            </div>
        </Dialog>
    );
}

function PrefsDialog({ prefs, onChange, onClose }: { prefs: Prefs; onChange: (p: Prefs) => void; onClose: () => void }) {
    return (
        <Dialog open title="Preferences" onClose={onClose} testId="prefs-dialog">
            <div className="pw-prefs">
                <ListSelector title="Clear clipboard" value={prefs.clipboardSeconds} testId="pref-clipboard"
                              options={[10, 20, 30, 60, 90].map((s) => ({ value: s, label: `After ${s} seconds` }))}
                              onChange={(v) => onChange({ ...prefs, clipboardSeconds: v })} />
                <ListSelector title="Lock when idle" value={prefs.idleSeconds} testId="pref-idle"
                              options={[[60, "1 minute"], [120, "2 minutes"], [300, "5 minutes"], [600, "10 minutes"], [1800, "30 minutes"]]
                                  .map(([v, l]) => ({ value: v as number, label: `After ${l}` }))}
                              onChange={(v) => onChange({ ...prefs, idleSeconds: v })} />
                <ListSelector title="Lock when minimized" value={prefs.hiddenSeconds} testId="pref-hidden"
                              options={[{ value: 0, label: "At once" }, { value: 30, label: "After 30 seconds" }, { value: 120, label: "After 2 minutes" },
                                        { value: -1, label: "Never" }]}
                              onChange={(v) => onChange({ ...prefs, hiddenSeconds: v })} />
            </div>
            <Note>The database always locks when the screen locks.</Note>
            <div className="pw-dialog-buttons">
                <Button onClick={onClose} data-testid="prefs-done">Done</Button>
            </div>
        </Dialog>
    );
}

// ---- Unlocked: the database -------------------------------------------------------------------

type Sheet =
    | { kind: "new-group" } | { kind: "rename-group"; group: Group } | { kind: "delete-group"; group: Group }
    | { kind: "delete-entry"; entry: Entry } | { kind: "master" } | { kind: "prefs" } | null;

function Database({ session, prefs, setPrefs, onLock }: {
    session: Session; prefs: Prefs; setPrefs: (p: Prefs) => void; onLock: (reason: LockReason) => void;
}) {
    const { db } = session;
    const [, setRev] = useState(0);
    const bump = () => setRev((r) => r + 1);
    const [group, setGroup] = useState<Group>(() => db.getDefaultGroup());
    const [entry, setEntry] = useState<Entry | null>(null);
    const [editing, setEditing] = useState<{ entry: Entry; isNew: boolean } | null>(null);
    const [query, setQuery] = useState("");
    const [sheet, setSheet] = useState<Sheet>(null);
    const [menu, setMenu] = useState<{ anchor: HTMLElement; kind: "app" | "add" } | null>(null);
    const [generator, setGenerator] = useState<((pw: string) => void) | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const [copied, setCopied] = useState("");
    const clearsIn = useClipboardCountdown();
    const queue = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => { if (!clearsIn) setCopied(""); }, [clearsIn]);
    // A new view starts at the top.
    const scroller = useRef<HTMLDivElement>(null);
    useEffect(() => { scroller.current?.scrollTo?.(0, 0); }, [entry, editing, group]);

    // Save now, merging first if the file changed since we read it.
    const persist = useCallback((): Promise<void> => {
        const run = async () => {
            setSaving(true);
            setSaveError("");
            try {
                const onDisk = await stampOf(session.path);
                if (onDisk && !sameStamp(onDisk, session.stamp)) {
                    const { data } = await readDatabase(session.path);
                    try {
                        mergeRemote(db, await openWithCredentials(data, db.credentials));
                    } catch {
                        // Changed with another master password (or damaged): keep both.
                        const copy = session.path.replace(/\.kdbx$/i, "") + ` (conflict ${new Date().toISOString().slice(0, 10)}).kdbx`;
                        session.path = copy;
                        rememberRecent(copy);
                    }
                }
                session.stamp = await writeDatabase(session.path, await saveDatabase(db));
            } catch (e) {
                setSaveError("Not saved: " + errorText(e));
                throw e;
            } finally {
                setSaving(false);
                bump();
            }
        };
        const p = queue.current.then(run, run);
        queue.current = p.catch(() => {});
        return p;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    const lock = useCallback((reason: LockReason) => {
        // Let a save in progress finish, then drop everything.
        void queue.current.finally(() => onLock(reason));
    }, [onLock]);

    useAutoLock(true, prefs.idleSeconds, prefs.hiddenSeconds, lock);

    useBack(() => { setQuery(""); return true; }, !entry && !editing && !!query);
    useBack(() => { if (group.parentGroup) setGroup(group.parentGroup); return true; }, !entry && !editing && !query && !!group.parentGroup);

    const copy = async (value: string, what: string) => {
        if (!value) return;
        const ok = await secretClipboard.copy(value, prefs.clipboardSeconds);
        setCopied(ok ? what : "");
        if (!ok) setSaveError("The clipboard is not available.");
    };

    const results = useMemo(() => (query.trim() ? search(db, query) : null), [db, query, entry, editing, saving]);
    const bin = recycleBin(db);
    const path = groupPath(group);

    const saveEntry = async (e: Entry, isNew: boolean, edit: EntryEdit) => {
        applyEdit(db, e, edit, isNew);
        await persist();
        setEditing(null);
        setEntry(e);
    };
    const cancelEdit = () => {
        if (editing?.isNew) db.move(editing.entry, null);   // drop the unsaved new entry
        setEditing(null);
    };

    const onAppMenu = (v: string) => {
        if (v === "lock") onLock("manual");
        else if (v === "prefs") setSheet({ kind: "prefs" });
        else if (v === "master") setSheet({ kind: "master" });
        else if (v === "rename") setSheet({ kind: "rename-group", group });
        else if (v === "delete-group") setSheet({ kind: "delete-group", group });
        else if (v === "empty-bin" && bin) setSheet({ kind: "delete-group", group: bin });
    };
    const onAdd = (v: string) => {
        if (v === "entry") {
            const target = group === bin ? db.getDefaultGroup() : group;
            setEditing({ entry: newEntry(db, target), isNew: true });
        } else if (v === "group") setSheet({ kind: "new-group" });
    };

    const entryRow = (e: Entry, showPath = false) => (
        <Row key={e.uuid.id} className="pw-entry-row" icon={<span className="pw-entry-icon"><KeyIcon size={20} /></span>}
             title={<span data-testid="entry-row-title">{entryTitle(e)}</span>}
             subtitle={showPath ? groupPath(e.parentGroup).slice(1).join(" › ") || text(e, "UserName") : text(e, "UserName")}
             onClick={() => setEntry(e)} testId={`entry-${entryTitle(e)}`} />
    );

    const main = (
        <>
            <PageHeader icon="icon.png" title={<span data-testid="db-name">{db.meta.name || dbName(session.path)}</span>}>
                <HeaderButton label="Lock" onClick={() => onLock("manual")} testId="lock"><LockIcon size={22} /></HeaderButton>
                <HeaderButton label="Menu" onClick={(e) => setMenu({ anchor: e.currentTarget, kind: "app" })} testId="menu"><Glyph name="menu" size={22} /></HeaderButton>
            </PageHeader>
            <div className="pw-search">
                <TextField value={query} onChange={setQuery} placeholder="Search" testId="search" />
            </div>
            {results ? (
                <>
                    <Divider caption={`${results.length} found`} />
                    {!results.length && <div className="pw-empty" data-testid="no-match">No entries match "{query}".</div>}
                    <div className="pw-list" data-testid="results">{results.map((e) => entryRow(e, true))}</div>
                </>
            ) : (
                <>
                    {group.parentGroup && (
                        <Row className="pw-up" icon={<Glyph name="back" size={20} />} title={path.slice(0, -1).join(" › ")}
                             onClick={() => setGroup(group.parentGroup!)} testId="group-up" />
                    )}
                    <Divider caption={group === db.getDefaultGroup() ? "All" : group.name ?? ""} />
                    <div className="pw-list" data-testid="group-list">
                        {sortedGroups(group).filter((g) => g !== bin).map((g) => (
                            <Row key={g.uuid.id} icon={<span className="pw-folder-icon"><FolderIcon size={22} /></span>} title={g.name}
                                 value={String(g.entries.length + g.groups.length)} chevron onClick={() => setGroup(g)} testId={`group-${g.name}`} />
                        ))}
                        {sortedEntries(group).map((e) => entryRow(e))}
                        {bin && group === db.getDefaultGroup() && (
                            <Row icon={<span className="pw-folder-icon bin"><Glyph name="trash" size={20} /></span>} title={bin.name}
                                 value={String(bin.entries.length + bin.groups.length)} chevron onClick={() => setGroup(bin)} testId="group-recycle-bin" />
                        )}
                        {!group.entries.length && !group.groups.filter((g) => g !== bin).length && (
                            <div className="pw-empty" data-testid="group-empty">{group === bin ? "The recycle bin is empty." : "No entries here yet. Tap + to add one."}</div>
                        )}
                    </div>
                </>
            )}
        </>
    );

    return (
        <div className="pw-app">
            <div className="pw-scroll" ref={scroller}>
                <div className="pw-page">
                    {editing ? (
                        <EntryEditor entry={editing.entry} isNew={editing.isNew} onCancel={cancelEdit}
                                     onGenerate={(apply) => setGenerator(() => apply)}
                                     onSave={(edit) => saveEntry(editing.entry, editing.isNew, edit)} />
                    ) : entry ? (
                        <EntryDetail db={db} entry={entry} onCopy={(v, w) => void copy(v, w)} onClose={() => setEntry(null)}
                                     onEdit={() => setEditing({ entry, isNew: false })} onDelete={() => setSheet({ kind: "delete-entry", entry })} />
                    ) : main}
                </div>
            </div>
            {(saving || saveError || copied) && (
                <Toast>
                    {saving ? <><Spinner /> Saving…</> : saveError ? <span className="pw-toast-error" data-testid="save-error">{saveError}</span>
                        : <span data-testid="copied">{copied} copied{clearsIn ? ` · clears in ${clearsIn} s` : ""}</span>}
                </Toast>
            )}
            {!editing && !entry && (
                <Toolbar className="pw-toolbar">
                    <ToolSpacer />
                    <IconToolButton icon="plus" label="Add" testId="add" onClick={() => {
                        const el = document.querySelector<HTMLElement>("[data-testid='add']");
                        setMenu({ anchor: el!, kind: "add" });
                    }} />
                    <ToolSpacer />
                </Toolbar>
            )}

            {menu?.kind === "app" && (
                <PopupMenu anchor={menu.anchor} onClose={() => setMenu(null)} onSelect={onAppMenu}
                           options={[
                               ...(group.parentGroup && group !== bin ? [{ label: "Rename Group", value: "rename" }, { label: "Delete Group", value: "delete-group" }] : []),
                               ...(group === bin && bin && (bin.entries.length || bin.groups.length) ? [{ label: "Empty Recycle Bin", value: "empty-bin" }] : []),
                               { label: "Change Master Password", value: "master" },
                               { label: "Preferences", value: "prefs" },
                               { label: "Lock", value: "lock" },
                           ]} />
            )}
            {menu?.kind === "add" && (
                <PopupMenu anchor={menu.anchor} onClose={() => setMenu(null)} onSelect={onAdd}
                           options={[{ label: "New Entry", value: "entry" }, { label: "New Group", value: "group" }]} />
            )}
            {generator && <GeneratorDialog onUse={generator} onClose={() => setGenerator(null)} />}
            {sheet?.kind === "new-group" && (
                <NameDialog title="New Group" initial="" action="Create" onClose={() => setSheet(null)}
                            onSubmit={async (name) => { newGroup(db, group === bin ? db.getDefaultGroup() : group, name); await persist(); }} />
            )}
            {sheet?.kind === "rename-group" && (
                <NameDialog title="Rename Group" initial={sheet.group.name ?? ""} action="Rename" onClose={() => setSheet(null)}
                            onSubmit={async (name) => { sheet.group.name = name; sheet.group.times.update(); await persist(); }} />
            )}
            {sheet?.kind === "delete-group" && (
                <ConfirmDialog title={sheet.group === bin ? "Empty the recycle bin?" : `Delete "${sheet.group.name}"?`}
                               message={sheet.group === bin ? "Its entries are deleted for good." : "The group and its entries move to the recycle bin."}
                               action={sheet.group === bin ? "Empty" : "Delete"} onClose={() => setSheet(null)}
                               onConfirm={async () => {
                                   const g = sheet.group;
                                   if (g === bin) { for (const x of [...g.entries, ...g.groups]) remove(db, x); }
                                   else { setGroup(g.parentGroup ?? db.getDefaultGroup()); remove(db, g); }
                                   await persist();
                               }} />
            )}
            {sheet?.kind === "delete-entry" && (
                <ConfirmDialog title={`Delete "${entryTitle(sheet.entry)}"?`}
                               message={inRecycleBin(db, sheet.entry) ? "It is deleted for good." : "It moves to the recycle bin."}
                               action="Delete" onClose={() => setSheet(null)}
                               onConfirm={async () => { remove(db, sheet.entry); setEntry(null); await persist(); }} />
            )}
            {sheet?.kind === "master" && (
                <MasterPasswordDialog onClose={() => setSheet(null)} onChange={async (pw) => { await setMasterPassword(db, pw); await persist(); }} />
            )}
            {sheet?.kind === "prefs" && (
                <PrefsDialog prefs={prefs} onClose={() => setSheet(null)} onChange={(p) => { setPrefs(p); savePrefs(p); }} />
            )}
        </div>
    );
}

// ---- The app ---------------------------------------------------------------------------

function Passwords() {
    const [session, setSession] = useState<Session | null>(null);
    const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
    const [notice, setNotice] = useState("");
    const params = useLaunchParams<{ target?: string }>();
    const target = typeof params.target === "string" && isKdbx(params.target) ? params.target.replace(/^file:\/\//, "") : null;
    const [lastPath, setLastPath] = useState<string | null>(null);

    const onLock = useCallback((reason: LockReason) => {
        setSession((s) => { if (s) setLastPath(s.path); return null; });
        setNotice(LOCK_REASONS[reason]);
        // The clipboard stays for a minimized card (the user is pasting elsewhere);
        // otherwise the user has left: clear it now.
        if (reason !== "hidden") void secretClipboard.clear();
    }, []);

    if (!session)
        return <LockScreen initialPath={target ?? lastPath} notice={notice} onUnlocked={(s) => { setNotice(""); setSession(s); }} />;
    return <Database key={session.path} session={session} prefs={prefs} setPrefs={setPrefs} onLock={onLock} />;
}

export function App() {
    return (
        <BackProvider>
            <Passwords />
        </BackProvider>
    );
}
