// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// DropShare (docs/M6-PLAN.md F4 item 8; docs/APP-RUNTIME.md "DropShare"):
// Phoenix's own take on the webOS Archive's LuneDrop, built on Touch to
// Share. The card shows a QR code of a one-time address on the local
// network; any phone or computer that opens it, in any browser:
//   receive  (launched by itself, or from Settings > DropShare) sends files
//            here: they land in Downloads;
//   send     (the share sheet's DropShare, launch params {share: {files}})
//            downloads the files shared.
// Touch to Share: a webOS phone touched to the device gets the address
// (tapToShareSupported; relaunched with {sendDataToShare: true}, it
// answers com.palm.stservice/shareData), and opens it.
// The address stops working once the transfer is done, after ten minutes
// without use, or when the card closes. DropShare is off until the user
// turns it on (system preference dropShareEnabled).

import { useEffect, useState } from "react";
import { apps, call, dropShare, system, type DropShareStatus, type SharedFile, type SystemPreferences } from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { Button, ErrorText, FileIcon, Group, Note, Page, PageHeader, Row, Spinner } from "@phoenix/ui";
import { qrSvg } from "./qr";
import { ended, fileText, statusText, type Mode } from "./lib/status";

interface Params { share?: { files?: SharedFile[] }; sendDataToShare?: boolean }

export function App() {
    const params = useLaunchParams<Params>();
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(["dropShareEnabled"], cb, err), []).value;
    const enabled = !!prefs?.dropShareEnabled;
    const files = params.share?.files?.filter((f) => f && f.path) ?? [];
    const mode: Mode = files.length ? "send" : "receive";
    const filesKey = JSON.stringify(files);
    const [session, setSession] = useState(0);
    const [status, setStatus] = useState<DropShareStatus | null>(null);
    const [error, setError] = useState("");
    const [qr, setQr] = useState("");

    // One session while the card is open (a new one for Start Again); it
    // ends when the card closes (the subscription goes).
    useEffect(() => {
        if (!enabled) return;
        setStatus(null);
        setError("");
        const onStatus = (s: DropShareStatus) => setStatus(s);
        const onError = (e: { errorText?: string }) => setError(e.errorText ?? String(e));
        const sub = mode === "send" ? dropShare.send(JSON.parse(filesKey), onStatus, onError) : dropShare.receive(onStatus, onError);
        return () => sub.cancel();
    }, [enabled, mode, filesKey, session]);

    const url = status?.url ?? "";
    useEffect(() => {
        if (!url) { setQr(""); return; }
        let live = true;
        qrSvg(url).then((svg) => { if (live) setQr(svg); }, (e) => console.error("[dropshare]", e));
        return () => { live = false; };
    }, [url]);

    // Touch to Share: the phone touched to the device gets the address.
    useEffect(() => {
        if (!params.sendDataToShare || !url) return;
        void call("luna://com.palm.stservice/shareData", { data: { target: url, type: "rawdata", mimetype: "text/html" } });
    }, [params, url]);

    const over = ended(status);
    const saved = status?.files.some((f) => f.saved);
    return (
        <Page>
            <PageHeader title="DropShare" icon="icon.png" />
            {!prefs ? <Spinner /> : !enabled ? (
                <>
                    <Note>DropShare sends files to and from any phone or computer on the same Wi-Fi network: it opens a web address
                        this device shows as a QR code. Nothing goes through the internet.</Note>
                    <Button variant="affirmative" data-testid="ds-enable"
                            onClick={() => void system.setPreferences({ dropShareEnabled: true })}>Turn On DropShare</Button>
                    <Group label="How it works">
                        <Row title="Receive" subtitle="Open DropShare; the other device scans the code and sends files to Downloads" />
                        <Row title="Send" subtitle="Share a file and choose DropShare; the other device scans the code to download it" />
                        <Row title="Touch to Share" subtitle="Touch a webOS phone to the device in DropShare to hand it the address" />
                    </Group>
                    <Note>You can turn it off again in Settings &gt; DropShare.</Note>
                </>
            ) : (
                <>
                    <div className="ds-code" data-testid="ds-code">
                        {qr && !over ? <div className="ds-qr" data-testid="ds-qr" dangerouslySetInnerHTML={{ __html: qr }} />
                            : <div className="ds-qr ds-qr-empty">{!status && !error ? <Spinner />
                                : <img src="icon-256x256.png" alt="" className="ds-over" />}</div>}
                        <div className="ds-side">
                            <div className="ds-mode">{mode === "receive" ? "Receive files" : `Send ${files.length === 1 ? "1 file" : `${files.length} files`}`}</div>
                            {url && !over && <div className="ds-url" data-testid="ds-url">{url}</div>}
                            <div className="ds-status" data-testid="ds-status">{error || statusText(mode, status)}</div>
                        </div>
                    </div>
                    {error && <ErrorText testId="ds-error">{error}</ErrorText>}
                    {status && status.files.length > 0 && (
                        <Group label={mode === "receive" ? "Received" : "Files"}>
                            {status.files.map((f) => (
                                <Row key={f.id} title={f.name} subtitle={fileText(mode, f)} testId={`ds-file-${f.name}`}
                                     icon={<FileIcon kind="file" size={32} />}
                                     onClick={f.saved ? () => void apps.open(f.saved!) : undefined} />
                            ))}
                        </Group>
                    )}
                    {!over ? (
                        <Button data-testid="ds-stop" onClick={() => void dropShare.stop()}>Stop</Button>
                    ) : (
                        <Button variant="affirmative" data-testid="ds-again" onClick={() => setSession((n) => n + 1)}>
                            {mode === "receive" ? "Receive More" : "Send Again"}
                        </Button>
                    )}
                    {mode === "receive" && saved && (
                        <Button data-testid="ds-downloads"
                                onClick={() => void apps.launch("org.webosphoenix.files", { path: "/media/internal/Downloads" })}>Open Downloads</Button>
                    )}
                    <Note>Only devices that know this address can reach it, and only until the transfer is done, ten minutes pass
                        without use, or you close DropShare.</Note>
                </>
            )}
        </Page>
    );
}
