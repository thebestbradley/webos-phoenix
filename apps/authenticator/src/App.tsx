// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Authenticator: two-factor one-time codes (TOTP, RFC 6238; HOTP,
// RFC 4226) in the webOS 2.x Heritage style. A list of accounts with their
// current code and a countdown ring; tap one to copy its code.
//
// Adding: a setup key typed in, an otpauth:// link pasted, or launched by
// another app with {otpauth: "otpauth://..."} (the QR scanner does this);
// a launched code is shown for confirmation, never added silently.
// Import: an encrypted Authenticator backup, or Aegis / andOTP plain JSON
// exports and otpauth:// lists (with a warning: those files hold secrets in
// clear). Export: an encrypted backup (passphrase) into Documents.
//
// The secrets are encrypted at rest with a key protected by the device
// passcode (vault.ts; the stand-in for the Phoenix key store, see
// docs/SECURITY-APPS.md). The app asks for the passcode when it opens and
// locks again when the screen locks, when the card is minimized (after the
// grace the user picks) and after an idle time. Nothing is logged; nothing
// goes to db8 or Just Type.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { apps, deviceLock, fileManager, MEDIA_ROOT, joinPath, type FileEntry, type LockMode } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import {
    BackProvider, Button, cx, Dialog, Divider, ErrorText, Glyph, IconToolButton, ListSelector, Note, PageHeader, PopupMenu, Row, Spinner,
    TextField, Toolbar, ToolSpacer, useBack,
} from "@phoenix/ui";
import {
    groupCode, OTP_ALGORITHMS, OtpUriError, parseOtpauth, parseSecret, SealError, secretClipboard, totp, totpCounter, totpRemaining,
    validateOtp, type LockReason, type OtpAlgorithm, type OtpParams,
} from "@phoenix/secrets";
import { CountdownRing, useAutoLock, useClipboardCountdown, useNow } from "@phoenix/secrets/react";
import { DuplicateError, Session, Vault, type Token } from "./vault";
import { backupName, detect, isPlaintext, makeBackup, parsePlain, readBackup, type ImportKind, type ImportResult } from "./importers";

const errorText = (e: unknown) => (e as { errorText?: string }).errorText ?? (e instanceof Error ? e.message : String(e));

const PREFS_KEY = "phoenix:org.webosphoenix.authenticator:prefs";
interface Prefs { clipboardSeconds: number; idleSeconds: number; hiddenSeconds: number }
const DEFAULT_PREFS: Prefs = { clipboardSeconds: 30, idleSeconds: 300, hiddenSeconds: 0 };
function loadPrefs(): Prefs {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<Prefs>;
        const n = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
        return { clipboardSeconds: n(p.clipboardSeconds, 30), idleSeconds: n(p.idleSeconds, 300), hiddenSeconds: n(p.hiddenSeconds, 0) };
    } catch { return { ...DEFAULT_PREFS }; }
}
function savePrefs(p: Prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

const IMPORT_DIRS = [MEDIA_ROOT + "/Downloads", MEDIA_ROOT + "/Documents", MEDIA_ROOT + "/authenticator", MEDIA_ROOT];
const BACKUP_DIR = MEDIA_ROOT + "/Documents";

const LOCK_REASONS: Record<LockReason, string> = {
    screen: "Locked because the screen locked.",
    hidden: "Locked because the card was minimized.",
    idle: "Locked after a while without use.",
    manual: "",
};

function ShieldIcon({ size = 22 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
            <path d="M16 2l11 4v8c0 7.5-4.6 13.4-11 16-6.4-2.6-11-8.5-11-16V6zm0 7a4 4 0 0 0-4 4v2h-1v8h10v-8h-1v-2a4 4 0 0 0-4-4zm0 2.5a1.5 1.5 0 0 1 1.5 1.5v2h-3v-2a1.5 1.5 0 0 1 1.5-1.5z" />
        </svg>
    );
}

function HeaderButton({ label, onClick, children, testId }: { label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: ReactNode; testId?: string }) {
    return <button type="button" className="au-header-button" aria-label={label} data-testid={testId} onClick={onClick}>{children}</button>;
}

// ---- No device passcode ---------------------------------------------------------------------

function NeedsPasscode() {
    return (
        <div className="au-app">
            <div className="au-scroll"><div className="au-page">
                <PageHeader icon="icon.png" title="Authenticator" />
                <div className="au-center" data-testid="needs-passcode">
                    <span className="au-big-icon"><ShieldIcon size={48} /></span>
                    <p>Authenticator keeps your codes encrypted with your device passcode.</p>
                    <p>Set a PIN or password in Screen &amp; Lock first.</p>
                    <Button variant="affirmative" onClick={() => void apps.launch("org.webosphoenix.settings", { page: "screen" })} data-testid="open-screen-lock">
                        Open Screen &amp; Lock
                    </Button>
                </div>
            </div></div>
        </div>
    );
}

// ---- Locked ----------------------------------------------------------------------------------

function LockScreen({ vault, mode, notice, pendingLabel, onUnlocked }: {
    vault: Vault; mode: LockMode; notice: string; pendingLabel: string; onUnlocked: (s: Session) => void;
}) {
    const [passcode, setPasscode] = useState("");
    const [needPrevious, setNeedPrevious] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [waitUntil, setWaitUntil] = useState(0);
    const failures = useRef(0);
    const newPasscode = useRef("");
    const now = useNow(500);
    const first = !vault.exists();
    const noDeviceCode = mode === "none";

    const fail = (msg: string) => {
        failures.current++;
        // Slow down guessing at the screen (the real limit is the device's retry count).
        if (failures.current >= 5) setWaitUntil(Date.now() + Math.min(60, 2 ** (failures.current - 5)) * 1000);
        setError(msg);
        setPasscode("");
        setBusy(false);
    };

    const unlock = async () => {
        if (busy || Date.now() < waitUntil) return;
        if (!passcode) { setError("Type your passcode."); return; }
        setBusy(true);
        setError("");
        try {
            if (needPrevious) {
                // The device passcode changed: open with the one the codes were protected with, then protect them with the new one.
                await vault.rewrap(passcode, newPasscode.current);
                const s = await vault.unlock(newPasscode.current);
                newPasscode.current = "";
                onUnlocked(s);
                return;
            }
            if (!noDeviceCode && !(await deviceLock.matches(passcode))) { fail("Wrong passcode."); return; }
            if (first) { onUnlocked(await vault.create(passcode)); return; }
            try {
                onUnlocked(await vault.unlock(passcode));
            } catch (e) {
                if (!(e instanceof SealError)) throw e;
                if (noDeviceCode) { fail("Wrong passcode."); return; }
                newPasscode.current = passcode;
                setNeedPrevious(true);
                setPasscode("");
                setBusy(false);
            }
        } catch (e) {
            if (e instanceof SealError) fail(needPrevious ? "That is not the previous passcode either." : "Wrong passcode.");
            else { setError(errorText(e)); setBusy(false); }
        }
    };
    const wait = Math.max(0, Math.ceil((waitUntil - now) / 1000));

    return (
        <div className="au-app">
            <div className="au-scroll"><div className="au-page">
                <PageHeader icon="icon.png" title="Authenticator" />
                {notice && <div className="au-notice" data-testid="lock-notice">{notice}</div>}
                <div className="au-center" data-testid="lock-screen">
                    <span className="au-big-icon"><ShieldIcon size={48} /></span>
                    <p className="au-prompt">
                        {needPrevious ? "Your device passcode has changed. Type the previous one once to protect your codes with the new one."
                            : first ? "Type your device passcode. Your codes will be encrypted with it."
                            : noDeviceCode ? "Type the passcode your codes were protected with (your former device passcode)."
                            : "Type your device passcode to see your codes."}
                    </p>
                    {pendingLabel && <p className="au-pending" data-testid="pending-add">Then add the code for <b>{pendingLabel}</b>.</p>}
                    <div className="au-passcode">
                        <TextField type="password" inputMode={mode === "pin" && !needPrevious ? "numeric" : "text"} value={passcode} autoFocus
                                   onChange={(v) => { setPasscode(v); setError(""); }} onSubmit={() => void unlock()}
                                   placeholder={needPrevious ? "Previous passcode" : "Passcode"} testId="passcode" />
                    </div>
                    {error && <ErrorText>{error}</ErrorText>}
                    <Button variant="affirmative" busy={busy} disabled={wait > 0} onClick={() => void unlock()} data-testid="unlock">
                        {wait > 0 ? `Try again in ${wait} s` : busy ? "Unlocking…" : "Unlock"}
                    </Button>
                </div>
            </div></div>
        </div>
    );
}

// ---- Adding ----------------------------------------------------------------------------------

function describe(p: OtpParams): string {
    return p.issuer && p.account ? `${p.issuer} (${p.account})` : p.issuer || p.account || "this account";
}

function AddKeyDialog({ onAdd, onClose }: { onAdd: (p: OtpParams) => Promise<void>; onClose: () => void }) {
    const [issuer, setIssuer] = useState("");
    const [account, setAccount] = useState("");
    const [secret, setSecret] = useState("");
    const [type, setType] = useState<"totp" | "hotp">("totp");
    const [algorithm, setAlgorithm] = useState<OtpAlgorithm>("SHA1");
    const [digits, setDigits] = useState(6);
    const [period, setPeriod] = useState(30);
    const [more, setMore] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        if (!issuer.trim() && !account.trim()) { setError("Name the service or the account."); return; }
        let p: OtpParams;
        try {
            p = validateOtp({ type, issuer: issuer.trim(), account: account.trim(), secret: parseSecret(secret), algorithm, digits, period, counter: 0 });
            if (p.secret.length < 10) throw new OtpUriError("The setup key is too short (at least 16 characters)");
        } catch (e) {
            setError(e instanceof OtpUriError ? e.message + "." : "The setup key is not valid."); return;
        }
        setBusy(true);
        try { await onAdd(p); onClose(); } catch (e) { setError(errorText(e)); setBusy(false); }
    };
    return (
        <Dialog open title="Enter a Setup Key" onClose={onClose} testId="add-key-dialog">
            <TextField label="Service" value={issuer} onChange={(v) => { setIssuer(v); setError(""); }} placeholder="GitHub" autoFocus maxLength={80} testId="add-issuer" />
            <TextField label="Account" value={account} onChange={(v) => { setAccount(v); setError(""); }} placeholder="you@example.org" maxLength={120} testId="add-account" />
            <TextField label="Setup key" value={secret} onChange={(v) => { setSecret(v); setError(""); }} placeholder="ABCD EFGH IJKL MNOP" testId="add-secret" />
            {more ? (
                <div className="au-prefs">
                    <ListSelector title="Type" value={type} testId="add-type" onChange={setType}
                                  options={[{ value: "totp" as const, label: "Time-based" }, { value: "hotp" as const, label: "Counter-based" }]} />
                    <ListSelector title="Algorithm" value={algorithm} onChange={setAlgorithm} options={OTP_ALGORITHMS.map((a) => ({ value: a, label: a }))} />
                    <ListSelector title="Digits" value={digits} onChange={setDigits} options={[6, 7, 8].map((d) => ({ value: d, label: String(d) }))} />
                    {type === "totp" && <ListSelector title="Period" value={period} onChange={setPeriod}
                                                      options={[30, 60].map((s) => ({ value: s, label: `${s} seconds` }))} />}
                </div>
            ) : (
                <button type="button" className="au-link" onClick={() => setMore(true)} data-testid="add-more">More options</button>
            )}
            {error && <ErrorText>{error}</ErrorText>}
            <div className="au-dialog-buttons">
                <Button variant="affirmative" busy={busy} onClick={() => void submit()} data-testid="add-ok">Add</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

function AddLinkDialog({ onAdd, onClose }: { onAdd: (p: OtpParams) => Promise<void>; onClose: () => void }) {
    const [link, setLink] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        let p: OtpParams;
        try { p = parseOtpauth(link); } catch (e) { setError(e instanceof OtpUriError ? e.message + "." : "Not a valid link."); return; }
        setBusy(true);
        try { await onAdd(p); onClose(); } catch (e) { setError(errorText(e)); setBusy(false); }
    };
    return (
        <Dialog open title="Add from a Link" onClose={onClose} testId="add-link-dialog">
            <TextField value={link} onChange={(v) => { setLink(v); setError(""); }} onSubmit={() => void submit()} placeholder="otpauth://totp/…" autoFocus testId="add-link" />
            {error && <ErrorText>{error}</ErrorText>}
            <div className="au-dialog-buttons">
                <Button variant="affirmative" busy={busy} onClick={() => void submit()} data-testid="add-link-ok">Add</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

function ConfirmAddDialog({ params, error: parseError, onAdd, onClose }: {
    params: OtpParams | null; error: string; onAdd: (p: OtpParams) => Promise<void>; onClose: () => void;
}) {
    const [error, setError] = useState(parseError);
    const [busy, setBusy] = useState(false);
    return (
        <Dialog open title={params ? "Add this code?" : "Cannot add this code"} onClose={onClose} testId="confirm-add">
            {params && (
                <div className="au-confirm">
                    <div className="au-confirm-issuer" data-testid="confirm-issuer">{params.issuer || params.account}</div>
                    {params.issuer && <div className="au-confirm-account" data-testid="confirm-account">{params.account}</div>}
                    <div className="au-hint">{params.type === "totp" ? `Time-based, ${params.digits} digits every ${params.period} s` : `Counter-based, ${params.digits} digits`}
                        {params.algorithm !== "SHA1" && `, ${params.algorithm}`}</div>
                    <Note>Only add codes for an account you are setting up right now.</Note>
                </div>
            )}
            {error && <ErrorText>{error}</ErrorText>}
            <div className="au-dialog-buttons">
                {params && (
                    <Button variant="affirmative" busy={busy} data-testid="confirm-add-ok" onClick={async () => {
                        setBusy(true);
                        try { await onAdd(params); onClose(); } catch (e) { setError(errorText(e)); setBusy(false); }
                    }}>Add</Button>
                )}
                <Button onClick={onClose} data-testid="confirm-add-cancel">{params ? "Cancel" : "Close"}</Button>
            </div>
        </Dialog>
    );
}

function RenameDialog({ token, onSave, onClose }: { token: Token; onSave: (issuer: string, account: string) => Promise<void>; onClose: () => void }) {
    const [issuer, setIssuer] = useState(token.issuer);
    const [account, setAccount] = useState(token.account);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    return (
        <Dialog open title="Edit" onClose={onClose} testId="rename-dialog">
            <TextField label="Service" value={issuer} onChange={setIssuer} autoFocus maxLength={80} testId="rename-issuer" />
            <TextField label="Account" value={account} onChange={setAccount} maxLength={120} testId="rename-account" />
            {error && <ErrorText>{error}</ErrorText>}
            <div className="au-dialog-buttons">
                <Button variant="affirmative" busy={busy} data-testid="rename-ok" onClick={async () => {
                    if (!issuer.trim() && !account.trim()) { setError("Name the service or the account."); return; }
                    setBusy(true);
                    try { await onSave(issuer, account); onClose(); } catch (e) { setError(errorText(e)); setBusy(false); }
                }}>Save</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

function DeleteDialog({ token, onConfirm, onClose }: { token: Token; onConfirm: () => Promise<void>; onClose: () => void }) {
    const [busy, setBusy] = useState(false);
    return (
        <Dialog open title={`Delete ${token.issuer || token.account}?`} testId="delete-dialog" onClose={onClose}
                message="Make sure you can still sign in: turn two-step verification off for this account first, or keep another way in.">
            <div className="au-dialog-buttons">
                <Button variant="negative" busy={busy} data-testid="delete-ok" onClick={async () => { setBusy(true); await onConfirm(); onClose(); }}>Delete</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

// ---- Import and export ------------------------------------------------------------------------

function ImportDialog({ onImport, onClose }: { onImport: (r: ImportResult) => Promise<number>; onClose: () => void }) {
    const [files, setFiles] = useState<FileEntry[] | null>(null);
    const [file, setFile] = useState<FileEntry | null>(null);
    const [kind, setKind] = useState<ImportKind | null>(null);
    const [text, setText] = useState("");
    const [passphrase, setPassphrase] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<{ added: number; found: number; skipped: number } | null>(null);
    const [deleted, setDeleted] = useState(false);

    useEffect(() => {
        void (async () => {
            const out: FileEntry[] = [];
            for (const d of IMPORT_DIRS) {
                try { out.push(...(await fileManager.list(d)).filter((e) => e.type === "file" && /\.(json|txt)$/i.test(e.name) && e.size < 1024 * 1024)); } catch { /* missing */ }
            }
            setFiles(out.sort((a, b) => b.mtime - a.mtime));
        })();
    }, []);

    const pick = async (f: FileEntry) => {
        setError("");
        setFile(f);
        try {
            const t = await fileManager.readText(f.path, 1024 * 1024);
            setText(t);
            setKind(detect(t));
        } catch (e) { setError(errorText(e)); }
    };
    const run = async () => {
        setBusy(true);
        setError("");
        try {
            const r = kind === "phoenix" ? await readBackup(text, passphrase) : parsePlain(text);
            const added = await onImport(r);
            setDone({ added, found: r.tokens.length, skipped: r.skipped });
            setText("");
            setPassphrase("");
        } catch (e) {
            setError(e instanceof SealError ? "Wrong passphrase." : errorText(e));
        }
        setBusy(false);
    };

    return (
        <Dialog open title="Import Codes" onClose={busy ? undefined : onClose} testId="import-dialog">
            {done ? (
                <>
                    <div className="au-result" data-testid="import-result">
                        Added {done.added} of {done.found} code{done.found === 1 ? "" : "s"}{done.found > done.added ? " (the rest were already here)" : ""}.
                        {done.skipped > 0 && ` ${done.skipped} could not be used (unsupported type or bad key).`}
                    </div>
                    {kind && isPlaintext(kind) && !deleted && (
                        <div className="au-warning">Delete <b>{file?.name}</b> now: it still holds your secrets unencrypted.</div>
                    )}
                    <div className="au-dialog-buttons">
                        {kind && isPlaintext(kind) && !deleted && (
                            <Button variant="negative" data-testid="import-delete-file" onClick={async () => {
                                try { await fileManager.remove(file!.path, false); setDeleted(true); } catch (e) { setError(errorText(e)); }
                            }}>Delete the File</Button>
                        )}
                        {deleted && <div className="au-hint" data-testid="import-deleted">The file was deleted.</div>}
                        <Button onClick={onClose} data-testid="import-done">Done</Button>
                    </div>
                </>
            ) : !file ? (
                <>
                    <div className="au-hint">Choose an Authenticator backup, or an export from Aegis (unencrypted JSON) or andOTP (plain JSON), from Downloads or Documents.</div>
                    {files === null && <div className="au-loading"><Spinner /></div>}
                    {files?.length === 0 && <div className="au-empty" data-testid="import-none">No .json or .txt files found.</div>}
                    <div className="au-file-list">
                        {files?.map((f) => (
                            <Row key={f.path} title={f.name} subtitle={f.path.replace(/\/[^/]*$/, "")} onClick={() => void pick(f)} testId={`import-file-${f.name}`} />
                        ))}
                    </div>
                    {error && <ErrorText>{error}</ErrorText>}
                    <div className="au-dialog-buttons"><Button onClick={onClose}>Cancel</Button></div>
                </>
            ) : (
                <>
                    <div className="au-file-chosen">{file.name}</div>
                    {kind === "phoenix" && (
                        <TextField label="Backup passphrase" type="password" value={passphrase} onChange={(v) => { setPassphrase(v); setError(""); }}
                                   onSubmit={() => void run()} autoFocus testId="import-passphrase" />
                    )}
                    {kind && isPlaintext(kind) && (
                        <div className="au-warning" data-testid="import-warning">
                            This file holds your two-factor secrets <b>unencrypted</b>. Anyone who has had a copy can make your codes.
                            Import it, then delete it (and any other copies).
                        </div>
                    )}
                    {kind === "aegis-encrypted" && <ErrorText>Encrypted Aegis vaults cannot be read yet. In Aegis, export without encryption, import that file here, then delete it.</ErrorText>}
                    {kind === "unknown" && <ErrorText>This file is not an export Authenticator knows.</ErrorText>}
                    {error && <ErrorText>{error}</ErrorText>}
                    <div className="au-dialog-buttons">
                        {(kind === "phoenix" || (kind && isPlaintext(kind))) && (
                            <Button variant="affirmative" busy={busy} disabled={kind === "phoenix" && !passphrase} onClick={() => void run()} data-testid="import-ok">Import</Button>
                        )}
                        <Button onClick={() => { setFile(null); setKind(null); setText(""); setError(""); }} disabled={busy}>Back</Button>
                    </div>
                </>
            )}
        </Dialog>
    );
}

function ExportDialog({ session, onClose }: { session: Session; onClose: () => void }) {
    const [pw, setPw] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState("");
    const run = async () => {
        if (pw.length < 8) { setError("Use a passphrase of at least 8 characters."); return; }
        if (pw !== confirm) { setError("The passphrases do not match."); return; }
        setBusy(true);
        try {
            const text = await makeBackup(await session.records(), pw);
            try { await fileManager.stat(BACKUP_DIR); } catch { await fileManager.mkdir(BACKUP_DIR); }
            const path = joinPath(BACKUP_DIR, backupName());
            await fileManager.writeText(path, text, true);
            setPw("");
            setConfirm("");
            setSaved(path);
        } catch (e) { setError(errorText(e)); }
        setBusy(false);
    };
    return (
        <Dialog open title="Export Backup" onClose={busy ? undefined : onClose} testId="export-dialog">
            {saved ? (
                <>
                    <div className="au-result" data-testid="export-result">Saved an encrypted backup of {session.tokens.length} codes to <b>{saved}</b>.</div>
                    <Note>Keep the passphrase somewhere safe: the backup cannot be opened without it.</Note>
                    <div className="au-dialog-buttons"><Button onClick={onClose} data-testid="export-done">Done</Button></div>
                </>
            ) : (
                <>
                    <div className="au-hint">The backup is encrypted with a passphrase you choose, so it can be kept on a computer or in the cloud.</div>
                    <TextField label="Passphrase" type="password" value={pw} onChange={(v) => { setPw(v); setError(""); }} autoFocus testId="export-passphrase" />
                    <TextField label="Confirm" type="password" value={confirm} onChange={(v) => { setConfirm(v); setError(""); }} onSubmit={() => void run()} testId="export-confirm" />
                    {error && <ErrorText>{error}</ErrorText>}
                    <div className="au-dialog-buttons">
                        <Button variant="affirmative" busy={busy} onClick={() => void run()} data-testid="export-ok">Export</Button>
                        <Button onClick={onClose} disabled={busy}>Cancel</Button>
                    </div>
                </>
            )}
        </Dialog>
    );
}

function PrefsDialog({ prefs, onChange, onClose }: { prefs: Prefs; onChange: (p: Prefs) => void; onClose: () => void }) {
    return (
        <Dialog open title="Preferences" onClose={onClose} testId="prefs-dialog">
            <div className="au-prefs">
                <ListSelector title="Clear clipboard" value={prefs.clipboardSeconds} testId="pref-clipboard"
                              options={[10, 20, 30, 60].map((s) => ({ value: s, label: `After ${s} seconds` }))}
                              onChange={(v) => onChange({ ...prefs, clipboardSeconds: v })} />
                <ListSelector title="Lock when idle" value={prefs.idleSeconds} testId="pref-idle"
                              options={[[60, "1 minute"], [300, "5 minutes"], [900, "15 minutes"]].map(([v, l]) => ({ value: v as number, label: `After ${l}` }))}
                              onChange={(v) => onChange({ ...prefs, idleSeconds: v })} />
                <ListSelector title="Lock when minimized" value={prefs.hiddenSeconds} testId="pref-hidden"
                              options={[{ value: 0, label: "At once" }, { value: 30, label: "After 30 seconds" }, { value: 120, label: "After 2 minutes" }]}
                              onChange={(v) => onChange({ ...prefs, hiddenSeconds: v })} />
            </div>
            <Note>Authenticator always locks when the screen locks.</Note>
            <div className="au-dialog-buttons"><Button onClick={onClose} data-testid="prefs-done">Done</Button></div>
        </Dialog>
    );
}

// ---- Unlocked: the codes ------------------------------------------------------------------------

/** Current TOTP codes, recomputed when a token's time step changes. */
function useCodes(tokens: Token[], now: number): Record<string, string> {
    const [codes, setCodes] = useState<Record<string, { step: number; code: string }>>({});
    const steps = tokens.map((t) => (t.type === "totp" ? `${t.id}:${totpCounter(now, t.period)}` : "")).join(",");
    useEffect(() => {
        let live = true;
        const t0 = Date.now();
        void Promise.all(tokens.filter((t) => t.type === "totp").map(async (t) => [t.id, { step: totpCounter(t0, t.period), code: await totp(t.key, t0, t.digits, t.period) }] as const))
            .then((list) => { if (live) setCodes(Object.fromEntries(list)); }, () => {});
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tokens, steps]);
    const out: Record<string, string> = {};
    for (const t of tokens) {
        const c = codes[t.id];
        if (c && c.step === totpCounter(now, t.period)) out[t.id] = c.code;
    }
    return out;
}

type Sheet = { kind: "key" } | { kind: "link" } | { kind: "rename"; token: Token } | { kind: "delete"; token: Token }
    | { kind: "import" } | { kind: "export" } | { kind: "prefs" } | null;

function Codes({ session, prefs, setPrefs, pending, clearPending, onLock }: {
    session: Session; prefs: Prefs; setPrefs: (p: Prefs) => void;
    pending: { params: OtpParams | null; error: string } | null; clearPending: () => void; onLock: (r: LockReason) => void;
}) {
    const [tokens, setTokens] = useState<Token[]>(session.tokens);
    const [query, setQuery] = useState("");
    const [sheet, setSheet] = useState<Sheet>(null);
    const [menu, setMenu] = useState<{ anchor: HTMLElement; kind: "app" | "add" | "token"; token?: Token } | null>(null);
    const [hotpShown, setHotpShown] = useState<Record<string, string>>({});
    const [toast, setToast] = useState("");
    const now = useNow(250);
    const codes = useCodes(tokens, now);
    const clearsIn = useClipboardCountdown();
    const refresh = () => setTokens([...session.tokens]);

    useAutoLock(true, prefs.idleSeconds, prefs.hiddenSeconds, onLock);
    useBack(() => { setQuery(""); return true; }, !!query);
    useEffect(() => { if (!clearsIn) setToast(""); }, [clearsIn]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? tokens.filter((t) => `${t.issuer}\n${t.account}`.toLowerCase().includes(q)) : tokens;
    }, [tokens, query]);

    const copy = async (t: Token, code: string) => {
        const ok = await secretClipboard.copy(code, prefs.clipboardSeconds);
        setToast(ok ? `${t.issuer || t.account} code copied` : "The clipboard is not available.");
    };
    const tap = async (t: Token) => {
        if (t.type === "hotp") {
            const code = await session.nextHotp(t.id);
            refresh();
            setHotpShown((h) => ({ ...h, [t.id]: code }));
            await copy(t, code);
        } else {
            // The shown codes are worked out after each 30 s step (and after
            // the list changes); a tap in between takes the code now rather
            // than doing nothing.
            await copy(t, codes[t.id] ?? await totp(t.key, Date.now(), t.digits, t.period));
        }
    };
    const add = async (p: OtpParams) => {
        try { await session.addOne(p); } catch (e) {
            if (e instanceof DuplicateError) throw e;
            throw new Error("Could not save: " + errorText(e));
        }
        refresh();
    };

    return (
        <div className="au-app">
            <div className="au-scroll"><div className="au-page">
                <PageHeader icon="icon.png" title="Authenticator">
                    <HeaderButton label="Lock" onClick={() => onLock("manual")} testId="lock"><ShieldIcon /></HeaderButton>
                    <HeaderButton label="Menu" onClick={(e) => setMenu({ anchor: e.currentTarget, kind: "app" })} testId="menu"><Glyph name="menu" size={22} /></HeaderButton>
                </PageHeader>
                {tokens.length > 3 && (
                    <div className="au-search"><TextField value={query} onChange={setQuery} placeholder="Search" testId="search" /></div>
                )}
                {!tokens.length && (
                    <div className="au-empty" data-testid="empty">
                        No codes yet. Tap + to enter a setup key or paste an otpauth:// link, scan a QR code with the Scanner, or import a backup.
                    </div>
                )}
                {!!tokens.length && <Divider caption="Accounts" />}
                <div className="au-list" data-testid="token-list">
                    {shown.map((t) => {
                        const code = t.type === "hotp" ? hotpShown[t.id] : codes[t.id];
                        const left = totpRemaining(now, t.period);
                        return (
                            <div key={t.id} className={cx("au-token", t.type === "totp" && left <= 5 && "expiring")} role="button" tabIndex={0}
                                 data-testid={`token-${t.issuer || t.account}`} onClick={() => void tap(t)}
                                 onKeyDown={(e) => { if (e.key === "Enter") void tap(t); }}>
                                <div className="au-token-names">
                                    <div className="au-issuer">{t.issuer || t.account}</div>
                                    {t.issuer && t.account && <div className="au-account">{t.account}</div>}
                                </div>
                                <div className="au-code" data-testid="code">
                                    {code ? groupCode(code) : t.type === "hotp" ? <span className="au-tap">Tap for code</span> : "… …"}
                                </div>
                                {t.type === "totp" && <CountdownRing remaining={left} period={t.period} size={28} testId="ring" />}
                                <button type="button" className="au-more" aria-label="More" data-testid="token-menu"
                                        onClick={(e) => { e.stopPropagation(); setMenu({ anchor: e.currentTarget, kind: "token", token: t }); }}>
                                    <Glyph name="menu" size={18} />
                                </button>
                            </div>
                        );
                    })}
                    {!!tokens.length && !shown.length && <div className="au-empty">Nothing matches "{query}".</div>}
                </div>
            </div></div>
            {toast && (
                <div className="au-toast" role="status" data-testid="toast">{toast}{clearsIn ? ` · clears in ${clearsIn} s` : ""}</div>
            )}
            <Toolbar className="au-toolbar">
                <ToolSpacer />
                <IconToolButton icon="plus" label="Add" testId="add" onClick={() => setMenu({ anchor: document.querySelector<HTMLElement>("[data-testid='add']")!, kind: "add" })} />
                <ToolSpacer />
            </Toolbar>

            {menu?.kind === "app" && (
                <PopupMenu anchor={menu.anchor} onClose={() => setMenu(null)} onSelect={(v: string) => {
                    if (v === "lock") onLock("manual"); else setSheet({ kind: v } as Sheet);
                }} options={[
                    { label: "Import", value: "import" },
                    { label: "Export Backup", value: "export", disabled: !tokens.length },
                    { label: "Preferences", value: "prefs" },
                    { label: "Lock", value: "lock" },
                ]} />
            )}
            {menu?.kind === "add" && (
                <PopupMenu anchor={menu.anchor} onClose={() => setMenu(null)} onSelect={(v: "key" | "link") => setSheet({ kind: v })}
                           options={[{ label: "Enter a Setup Key", value: "key" as const }, { label: "Add from a Link", value: "link" as const }]} />
            )}
            {menu?.kind === "token" && menu.token && (
                <PopupMenu anchor={menu.anchor} onClose={() => setMenu(null)}
                           onSelect={(v: "rename" | "delete") => setSheet({ kind: v, token: menu.token! })}
                           options={[{ label: "Edit", value: "rename" as const }, { label: "Delete", value: "delete" as const }]} />
            )}
            {sheet?.kind === "key" && <AddKeyDialog onAdd={add} onClose={() => setSheet(null)} />}
            {sheet?.kind === "link" && <AddLinkDialog onAdd={add} onClose={() => setSheet(null)} />}
            {sheet?.kind === "rename" && (
                <RenameDialog token={sheet.token} onClose={() => setSheet(null)} onSave={async (i, a) => { await session.rename(sheet.token.id, i, a); refresh(); }} />
            )}
            {sheet?.kind === "delete" && (
                <DeleteDialog token={sheet.token} onClose={() => setSheet(null)} onConfirm={async () => { await session.remove(sheet.token.id); refresh(); }} />
            )}
            {sheet?.kind === "import" && (
                <ImportDialog onClose={() => setSheet(null)} onImport={async (r) => { const n = await session.add(r.tokens); refresh(); return n; }} />
            )}
            {sheet?.kind === "export" && <ExportDialog session={session} onClose={() => setSheet(null)} />}
            {sheet?.kind === "prefs" && <PrefsDialog prefs={prefs} onClose={() => setSheet(null)} onChange={(p) => { setPrefs(p); savePrefs(p); }} />}
            {pending && !sheet && <ConfirmAddDialog params={pending.params} error={pending.error} onAdd={add} onClose={clearPending} />}
        </div>
    );
}

// ---- The app ---------------------------------------------------------------------------------

function Authenticator() {
    const vault = useMemo(() => new Vault(localStorage), []);
    const [mode, setMode] = useState<LockMode | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
    const [notice, setNotice] = useState("");
    const [pending, setPending] = useState<{ params: OtpParams | null; error: string } | null>(null);
    const [damaged, setDamaged] = useState("");
    const params = useLaunchParams<{ otpauth?: unknown }>();

    // A code handed over by another app (the QR scanner): confirm it after unlocking.
    useEffect(() => {
        if (typeof params.otpauth !== "string") return;
        try { setPending({ params: parseOtpauth(params.otpauth), error: "" }); }
        catch (e) { setPending({ params: null, error: e instanceof OtpUriError ? e.message + "." : "The link is not valid." }); }
    }, [params]);

    // Is there a device passcode? Check again when the card comes back (from Screen & Lock).
    const checkMode = useCallback(() => { deviceLock.mode().then(setMode, () => setMode("none")); }, []);
    useEffect(() => {
        checkMode();
        const on = () => { if (document.visibilityState === "visible") checkMode(); };
        document.addEventListener("visibilitychange", on);
        const t = setInterval(checkMode, 3000);
        return () => { document.removeEventListener("visibilitychange", on); clearInterval(t); };
    }, [checkMode]);
    useEffect(() => {
        try { vault.exists(); } catch (e) { setDamaged(errorText(e)); }
    }, [vault]);

    const onLock = useCallback((reason: LockReason) => {
        setSession((s) => { s?.close(); return null; });
        setNotice(LOCK_REASONS[reason]);
        if (reason !== "hidden") void secretClipboard.clear();
    }, []);

    if (damaged) return <div className="au-app"><div className="au-page"><PageHeader icon="icon.png" title="Authenticator" /><ErrorText>{damaged}</ErrorText></div></div>;
    if (mode === null) return <div className="au-app"><div className="au-loading"><Spinner large /></div></div>;
    if (!session && mode === "none" && !vault.exists()) return <NeedsPasscode />;
    if (!session)
        return <LockScreen vault={vault} mode={mode} notice={notice} pendingLabel={pending?.params ? describe(pending.params) : ""}
                           onUnlocked={(s) => { setNotice(""); setSession(s); }} />;
    return <Codes session={session} prefs={prefs} setPrefs={setPrefs} pending={pending} clearPending={() => setPending(null)} onLock={onLock} />;
}

export function App() {
    return (
        <BackProvider>
            <Authenticator />
        </BackProvider>
    );
}
