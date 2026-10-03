// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Certificate Manager (com.palm.app.certificate, which Device Info's app menu
// and Email's "Open Certificate Manager" opened; launch params {page:
// "certificates"}): the certificate authorities the device trusts, as a list;
// a certificate's details (who it was issued to and by, when it is valid,
// its key and fingerprints, as the browser's CertificateDetail showed them);
// trusting, distrusting and deleting one; and adding one from a .crt, .pem,
// .cer or .der file on the device, picked from the files on its storage
// (/media/internal), as the original's file picker offered them.
// Service: com.palm.certificatemanager (@phoenix/luna certificates).

import { useState } from "react";
import {
    certificates, fileManager, CERTIFICATE_EXTENSIONS, LunaError,
    type CertificateDetails, type CertificateName, type CertificateSummary, type FileEntry,
} from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { AppMenu, Button, Dialog, ErrorText, Group, Note, Page, PageHeader, Row, Spinner, ToggleButton } from "@phoenix/ui";
import { useBack } from "../nav";

const STORAGE = "/media/internal";

const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
export const certName = (c: { commonname?: string; organization?: string }) => c.commonname || c.organization || "Unnamed certificate";

/** What a list row says under the name. */
export function certStatus(c: CertificateSummary, now = Date.now()): string {
    if (!c.trusted) return "Not trusted";
    if (c.expiredate && c.expiredate < now) return `Expired ${dateText(c.expiredate)}`;
    if (c.startdate && c.startdate > now) return `Not valid until ${dateText(c.startdate)}`;
    return `Issued by ${c.issuer || "unknown"}`;
}

/**
 * The certificate files on the device's storage: .crt, .pem, .cer and .der,
 * hidden folders left out, at most `depth` folders down.
 */
export async function findCertificateFiles(root = STORAGE, depth = 4): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    const walk = async (dir: string, level: number) => {
        let entries: FileEntry[];
        try { entries = await fileManager.list(dir); } catch { return; }
        for (const e of entries) {
            if (e.name.startsWith(".")) continue;
            if (e.type === "directory") {
                if (level < depth) await walk(e.path, level + 1);
            } else if (CERTIFICATE_EXTENSIONS.includes(e.name.replace(/^.*\./, "").toLowerCase())) {
                out.push(e);
            }
        }
    };
    await walk(root, 0);
    return out.sort((a, b) => a.path.localeCompare(b.path));
}

function FilePicker({ onClose, onAdded }: { onClose: () => void; onAdded: (ids: string[]) => void }) {
    const files = useLuna<FileEntry[]>((cb, err) => {
        let live = true;
        findCertificateFiles().then((f) => { if (live) cb(f); }, (e) => { if (live) err(e as LunaError); });
        return { cancel() { live = false; }, get cancelled() { return !live; } };
    }, []).value;
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const add = async (f: FileEntry) => {
        setBusy(true);
        setError(null);
        try {
            onAdded(await certificates.add(f.path));
        } catch (e) {
            setError(e instanceof LunaError ? e.errorText : String(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open title="Add Certificate" onClose={onClose} testId="cert-picker"
                message="Copy the certificate to the device's storage over USB or download it, then pick it here.">
            <div className="cert-files">
                {!files && <Spinner />}
                {files && files.length === 0 && <Note>There are no .crt, .pem, .cer or .der files on the device.</Note>}
                {files?.map((f) => (
                    <button key={f.path} type="button" className="cert-file" disabled={busy} data-testid={`cert-file-${f.name}`}
                            onClick={() => void add(f)}>
                        {f.name}
                        <span className="cert-file-folder">{f.path.slice(0, -f.name.length - 1).replace(STORAGE, "USB drive") || "/"}</span>
                    </button>
                ))}
            </div>
            {error && <ErrorText testId="cert-picker-error">{error}</ErrorText>}
            <Button variant="dark" onClick={onClose}>Cancel</Button>
        </Dialog>
    );
}

function NameRows({ n }: { n: CertificateName }) {
    const rows: [string, string | undefined][] = [
        ["Common name", n.commonname], ["Organization", n.organization], ["Unit", n.organizationalunit],
        ["Location", n.location], ["State/Province", n.state], ["Country", n.country], ["Email", n.email],
        ["Other names", n.altname?.join(", ")],
    ];
    return <>{rows.filter(([, v]) => v).map(([k, v]) => <Row key={k} title={k} subtitle={v} className="wrap-subtitle" />)}</>;
}

function Details({ id, onGone }: { id: string; onGone: () => void }) {
    const d = useLuna<CertificateDetails>((cb, err) => {
        let live = true;
        certificates.details(id).then((r) => { if (live) cb(r); }, (e) => { if (live) err(e as LunaError); });
        return { cancel() { live = false; }, get cancelled() { return !live; } };
    }, [id]);
    const [trusted, setTrusted] = useState<boolean | null>(null);
    const [deleting, setDeleting] = useState(false);
    if (!d.value) return <Page><PageHeader title="Certificate" icon="icons/certificates.png" />{d.error ? <ErrorText>{d.error.errorText}</ErrorText> : <Spinner />}</Page>;
    const c = d.value;
    const isTrusted = trusted ?? c.trusted;
    const expired = c.expiredate < Date.now();
    const key = [c.publicKey.algorithm, c.publicKey.curve, c.publicKey.bits ? `${c.publicKey.bits} bits` : ""].filter(Boolean).join(", ");
    return (
        <Page>
            <PageHeader title={certName(c.subject)} icon="icons/certificates.png" />
            <Group>
                <Row title="Trust this certificate" subtitle={c.system ? "Comes with the system" : "Added by you"}>
                    <ToggleButton value={isTrusted} label="Trust this certificate" testId="cert-trusted"
                                  onChange={(v) => { setTrusted(v); void certificates.setTrusted(c.certificateId, v); }} />
                </Row>
            </Group>
            <Group label="Issued to"><NameRows n={c.subject} /></Group>
            <Group label="Issued by"><NameRows n={c.issuer} /></Group>
            <Group label="Validity">
                <Row title="Valid from" subtitle={dateText(c.startdate)} />
                <Row title={expired ? "Expired" : "Expires"} subtitle={dateText(c.expiredate)} className={expired ? "cert-expired" : undefined} />
            </Group>
            <Group label="Details">
                <Row title="Certificate authority" subtitle={c.isCA ? "Yes" : "No"} />
                <Row className="wrap-subtitle" title="Serial number" subtitle={<span className="cert-hex">{c.serialNumber}</span>} />
                <Row title="Version" subtitle={String(c.version)} />
                <Row className="wrap-subtitle" title="Signature algorithm" subtitle={c.signature.algorithm} />
                <Row className="wrap-subtitle" title="Public key" subtitle={key} />
            </Group>
            <Group label="Fingerprints">
                <Row className="wrap-subtitle" title="SHA-256" subtitle={<span className="cert-hex" data-testid="cert-sha256">{c.fingerprints.sha256}</span>} />
                <Row className="wrap-subtitle" title="SHA-1" subtitle={<span className="cert-hex">{c.fingerprints.sha1}</span>} />
            </Group>
            <Button variant="negative" onClick={() => setDeleting(true)} data-testid="cert-delete">Delete Certificate</Button>
            <Dialog open={deleting} title="Delete this certificate?" onClose={() => setDeleting(false)} testId="cert-delete-dialog"
                    message={c.system ? "The device stops trusting it. Restore System Certificates in the menu puts it back."
                                      : "Connections that rely on it will not be trusted any more."}>
                <Button variant="negative" data-testid="cert-delete-confirm"
                        onClick={() => { setDeleting(false); void certificates.remove(c.certificateId).then(onGone); }}>Delete</Button>
                <Button variant="dark" onClick={() => setDeleting(false)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}

export function CertificatesPage() {
    const list = useLuna<CertificateSummary[]>((cb, err) => certificates.watch(cb, err), []).value;
    const [shown, setShown] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    useBack(() => { setShown(null); return true; }, shown !== null);

    if (shown) return <Details key={shown} id={shown} onGone={() => setShown(null)} />;
    const sorted = list ?? [];
    return (
        <Page>
            <AppMenu items={[{ label: "Restore System Certificates", onSelect: () => void certificates.restoreSystem() }]} />
            <PageHeader title="Certificate Manager" icon="icons/certificates.png" />
            <Note>The authorities this device trusts for secure web sites, mail, VPN and Wi-Fi networks.</Note>
            <Group label="Certificates">
                {!list && <Row title={<Spinner />} />}
                {sorted.map((c) => (
                    <Row key={c.certificateId} title={certName(c)} subtitle={certStatus(c)} chevron
                         className={!c.trusted || c.expiredate < Date.now() ? "cert-untrusted" : undefined}
                         testId={`cert-${c.certificateId}`} onClick={() => setShown(c.certificateId)} />
                ))}
                <Row title="Add Certificate" chevron testId="cert-add" onClick={() => { setNotice(null); setPicking(true); }} />
            </Group>
            {notice && <Note testId="cert-notice">{notice}</Note>}
            {picking && (
                <FilePicker onClose={() => setPicking(false)}
                            onAdded={(ids) => {
                                setPicking(false);
                                setNotice(ids.length === 1 ? "Certificate added." : `${ids.length} certificates added.`);
                            }} />
            )}
        </Page>
    );
}
