// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dev push in Settings > Developer Mode (docs/DEV-PUSH.md 4.7, 6.4, 7.4,
// 9.1), shown while Developer Mode is on:
//   Pushed Changes      bundles waiting for the owner (from the platform's
//                       key or a granted developer: Apply asks the device
//                       passcode, Decline drops one), what the developer
//                       overlay holds on this device (the build, its files,
//                       the bundles, by whom and when; Restart Now when a
//                       change needs it), and Revert to Image
//   Pair a Computer     the six-digit code and this device's key
//                       fingerprint, for two minutes, which `nova pair` asks
//   Paired Computers    their names, fingerprints and last use, with Remove
//   Trusted Developers  the granted developers (signed grants: the parts,
//                       until when), with Remove
//   Connections         USB debugging and Push over network
// All through org.webosphoenix.nova (@phoenix/luna nova).

import { useEffect, useState } from "react";
import { LunaError, nova, type NovaKeys, type NovaStatus, type NovaWaiting } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, ErrorText, Group, Note, Row, TextField, ToggleButton } from "@phoenix/ui";

const errText = (e: unknown) => (e instanceof LunaError ? e.errorText : String(e));

/** What part of the system a device path is in, as the owner reads it. */
export function partName(path: string): string {
    if (path.startsWith("/usr/palm/applications/")) return "Web apps";
    if (path.startsWith("/usr/palm/services/") || path.startsWith("/etc/palm/")) return "Services";
    if (path.startsWith("/usr/share/luna-service2/")) return "What services may do";
    if (/^\/usr\/share\/phoenix\/(qml|assets)\//.test(path)) return "Shell";
    if (/^\/usr\/share\/phoenix\/runtime\/|^\/usr\/palm\/frameworks\/|^\/usr\/lib\/luna\//.test(path)) return "System pages";
    return "System";
}

/** A restart, in words (the restart map, docs/DEV-PUSH.md 4.5). */
export function restartText(r: string): string {
    const [kind, ...rest] = r.split(":");
    const id = rest.join(":");
    switch (kind) {
    case "shell": return "The system UI will restart";
    case "wam": return "Every app and system page will reload";
    case "app": return `${id} will restart`;
    case "service": return `The service ${id} will restart`;
    case "hub": return "The service bus reads its permissions again";
    case "configurator": return "Database kinds and activities are read again";
    case "rescan": return "The list of apps is read again";
    case "reboot": return "The device must restart to finish";
    default: return r;
    }
}

function when(iso: string | null | undefined) {
    if (!iso) return "never";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function size(n: number) {
    return n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`;
}
const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;
function grouped(paths: string[]) {
    const out = new Map<string, string[]>();
    for (const p of paths) out.set(partName(p), [...(out.get(partName(p)) ?? []), p]);
    return [...out.entries()];
}

export function DevPushGroups() {
    const status = useLuna<NovaStatus>((cb, err) => nova.watchStatus(cb, err), []).value;
    if (!status) return null;
    if (status.available === false) {
        return (
            <Group label="Pushed Changes">
                <Note testId="devpush-unavailable">The simulator's developer tools are not running: it needs Node.js (./phoenix installs it).</Note>
            </Group>
        );
    }
    return (
        <>
            <PushedChanges status={status} />
            <PairComputer status={status} />
            <Keys version={status.paired} />
            <Connections status={status} />
        </>
    );
}

function PushedChanges({ status }: { status: NovaStatus }) {
    const [waiting, setWaiting] = useState<NovaWaiting[]>([]);
    const [applying, setApplying] = useState<NovaWaiting | null>(null);
    const [confirmRevert, setConfirmRevert] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        nova.waiting().then(setWaiting, () => setWaiting([]));
    }, [status.waiting, status.bundles.length]);
    async function act(fn: () => Promise<unknown>) {
        setError(null);
        try { await fn(); } catch (e) { setError(errText(e)); }
    }
    const count = status.files.length + status.removed.length;
    return (
        <Group label="Pushed Changes">
            {waiting.map((w) => (
                <div key={w.id} className="devpush-waiting" data-testid={`devpush-waiting-${w.id}`}>
                    <Row title={`Waiting: from ${w.name ?? w.fingerprint}`} subtitle={w.note ?? undefined} />
                    <Note>
                        {w.kind === "grant" ? "A developer you granted access" : w.kind === "master" ? "Signed by the Phoenix platform" : "A paired computer"},
                        key {w.fingerprint}. {files(w.files.length)}{w.removed.length ? `, ${w.removed.length} removed` : ""} ({size(w.size)}).
                    </Note>
                    {grouped(w.files.concat(w.removed)).map(([part, paths]) => (
                        <Row key={part} title={part} subtitle={paths.length > 3 ? `${paths.slice(0, 3).join(", ")} and ${paths.length - 3} more` : paths.join(", ")} />
                    ))}
                    {w.roles && <Note testId="devpush-roles">Changes what services may do (their Luna roles and permissions).</Note>}
                    {w.restart.map((r) => <Row key={r} subtitle={restartText(r)} />)}
                    <Button variant="affirmative" onClick={() => setApplying(w)} data-testid="devpush-apply">Apply</Button>
                    <Button variant="dark" onClick={() => void act(() => nova.decline(w.id))} data-testid="devpush-decline">Decline</Button>
                </div>
            ))}
            <Row title="On this device" value={count ? `${files(count)} changed` : "Its image"} testId="devpush-summary"
                 subtitle={`Build ${status.build ?? "unknown"}${status.compatible ? `, ${status.compatible}` : ""}`} />
            {status.files.slice(0, 50).map((f) => (
                <Row key={f.path} subtitle={`${f.path}, from ${f.name ?? f.kind}, ${when(f.at)}`} testId="devpush-file" />
            ))}
            {status.removed.slice(0, 50).map((f) => (
                <Row key={f.path} subtitle={`Removed ${f.path}, by ${f.name ?? f.kind}, ${when(f.at)}`} testId="devpush-file" />
            ))}
            {count > 100 && <Note>And {count - 100} more.</Note>}
            {status.bundles.slice(0, 5).map((b) => (
                <Row key={b.id + b.applied} title={b.note ?? "Developer changes"} testId="devpush-bundle"
                     subtitle={`${files(b.files)} from ${b.name ?? b.fingerprint}, ${when(b.applied)}`} />
            ))}
            {count > 0 && <Row title="Space used" value={`${size(status.usage)} of ${size(status.cap)}`} />}
            {status.clearing && <Note testId="devpush-clearing">The pushed changes go when the device restarts.</Note>}
            {status.pendingReboot && !status.clearing && (
                <>
                    <Note testId="devpush-pending">A change needs the device to restart to finish.</Note>
                    <Button onClick={() => void act(() => nova.restartNow())} data-testid="devpush-restart">Restart Now</Button>
                </>
            )}
            {count > 0 && !status.clearing && (
                <Button variant="negative" onClick={() => setConfirmRevert(true)} data-testid="devpush-revert">Revert to Image</Button>
            )}
            {error && <ErrorText testId="devpush-error">{error}</ErrorText>}
            <Dialog open={confirmRevert} title="Revert to Image?" onClose={() => setConfirmRevert(false)} testId="devpush-revert-confirm"
                    message="Remove every pushed change and restart? The device comes back exactly as its system image.">
                <Button variant="negative" data-testid="devpush-revert-yes"
                        onClick={() => { setConfirmRevert(false); void act(() => nova.revertToImage()); }}>Remove and Restart</Button>
                <Button variant="dark" onClick={() => setConfirmRevert(false)}>Cancel</Button>
            </Dialog>
            <ApplyDialog bundle={applying} onDone={() => setApplying(null)} />
        </Group>
    );
}

/** Apply asks the device passcode every time (decision 8). */
function ApplyDialog({ bundle, onDone }: { bundle: NovaWaiting | null; onDone: () => void }) {
    const [code, setCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { setCode(""); setError(null); }, [bundle]);
    async function apply() {
        if (!bundle) return;
        setBusy(true);
        setError(null);
        try {
            await nova.apply(bundle.id, code);
            onDone();
        } catch (e) {
            setError(errText(e));
            setCode("");
        } finally { setBusy(false); }
    }
    return (
        <Dialog open={!!bundle} title="Apply these changes?" onClose={onDone} testId="devpush-apply-dialog"
                message={bundle ? `They change the system of this device until you revert them. Enter the device passcode to apply the changes from ${bundle.name ?? bundle.fingerprint}.` : ""}>
            <TextField type="password" value={code} onChange={setCode} onSubmit={apply} placeholder="Passcode" testId="devpush-passcode" autoFocus />
            {error && <ErrorText testId="devpush-apply-error">{error}</ErrorText>}
            <Button variant="affirmative" disabled={busy} onClick={apply} data-testid="devpush-apply-confirm">Apply</Button>
            <Button variant="dark" onClick={onDone}>Cancel</Button>
        </Dialog>
    );
}

function PairComputer({ status }: { status: NovaStatus }) {
    const [now, setNow] = useState(Date.now());
    const [pairedBefore, setPairedBefore] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pairing = status.pairing;
    useEffect(() => {
        if (!pairing) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [pairing]);
    async function start() {
        setError(null);
        setPairedBefore(status.paired);
        try { await nova.pairStart(); } catch (e) { setError(errText(e)); }
    }
    const left = pairing ? Math.max(0, Math.round((Date.parse(pairing.expires) - now) / 1000)) : 0;
    const justPaired = pairedBefore !== null && !pairing && status.paired > pairedBefore;
    return (
        <Group label="Pair a Computer">
            {pairing ? (
                <>
                    <div className="devpush-code" data-testid="devpush-code" aria-label="Pairing code">{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</div>
                    <Note>
                        On the computer, run <code>nova pair</code> with this device's address and type this code. Check that the computer
                        then shows this device's key:
                    </Note>
                    <div className="devpush-fingerprint" data-testid="devpush-fingerprint">{pairing.fingerprint}</div>
                    <Row title="Time left" value={`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`} />
                    <Button variant="dark" onClick={() => void nova.pairCancel()} data-testid="devpush-pair-cancel">Cancel</Button>
                </>
            ) : (
                <>
                    {justPaired && <Note testId="devpush-paired">The computer is paired.</Note>}
                    <Note>
                        A paired computer can change this device's system files with <code>nova push</code>. Pair only your own computers.
                    </Note>
                    <Button onClick={() => void start()} data-testid="devpush-pair">Pair a Computer</Button>
                </>
            )}
            {error && <ErrorText>{error}</ErrorText>}
        </Group>
    );
}

function Keys({ version }: { version: number }) {
    const [keys, setKeys] = useState<NovaKeys | null>(null);
    const [removing, setRemoving] = useState<{ key: string; name: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [again, setAgain] = useState(0);
    useEffect(() => { nova.keys().then(setKeys, () => setKeys(null)); }, [version, again]);
    async function remove() {
        if (!removing) return;
        setError(null);
        try { await nova.removeKey(removing.key); } catch (e) { setError(errText(e)); }
        setRemoving(null);
        setAgain((v) => v + 1);
    }
    if (!keys) return null;
    return (
        <>
            <Group label="Paired Computers">
                {keys.paired.length === 0 && <Note>None.</Note>}
                {keys.paired.map((p) => (
                    <Row key={p.key} title={p.name} subtitle={`${p.fingerprint}, last used ${when(p.lastUsed)}`} testId="devpush-computer">
                        <Button variant="dark" onClick={() => setRemoving({ key: p.key, name: p.name })} data-testid="devpush-computer-remove">Remove</Button>
                    </Row>
                ))}
            </Group>
            <Group label="Trusted Developers">
                {keys.grants.length === 0 && (
                    <Note>None. A developer you grant access on your Phoenix account appears here once the grant is signed.</Note>
                )}
                {keys.grants.map((g) => (
                    <Row key={g.id} title={g.name} testId="devpush-developer"
                         subtitle={`${g.fingerprint}; ${g.parts.join(", ")}; ${g.revoked ? "withdrawn" : g.expired ? "expired " : "until "}${g.revoked ? "" : when(g.expires)}`}>
                        <Button variant="dark" onClick={() => setRemoving({ key: g.id, name: g.name })} data-testid="devpush-developer-remove">Remove</Button>
                    </Row>
                ))}
                {error && <ErrorText>{error}</ErrorText>}
            </Group>
            <Dialog open={!!removing} title={`Remove ${removing?.name ?? ""}?`} onClose={() => setRemoving(null)} testId="devpush-remove-confirm"
                    message="It can no longer send changes to this device. The changes it made stay until you revert them.">
                <Button variant="negative" onClick={() => void remove()} data-testid="devpush-remove-yes">Remove</Button>
                <Button variant="dark" onClick={() => setRemoving(null)}>Cancel</Button>
            </Dialog>
        </>
    );
}

function Connections({ status }: { status: NovaStatus }) {
    const set = (o: { network?: boolean; usb?: boolean }) => void nova.setOptions(o);
    return (
        <Group label="Developer Connections">
            <Row title="USB debugging" subtitle="nova over a USB cable">
                <ToggleButton value={!!status.options.usb} label="USB debugging" testId="devpush-usb" onChange={(v) => set({ usb: v })} />
            </Row>
            <Row title="Push over network" subtitle="nova over Wi-Fi or Ethernet, on private networks only">
                <ToggleButton value={!!status.options.network} label="Push over network" testId="devpush-network" onChange={(v) => set({ network: v })} />
            </Row>
        </Group>
    );
}
