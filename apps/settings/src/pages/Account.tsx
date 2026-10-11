// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix Account: the device's sign-in to the Phoenix platform
// (docs/PLATFORM.md 6.3, "Settings > Pre Account"; the name is one string,
// OPEN-QUESTIONS Q40), on org.webosphoenix.service.account (@phoenix/luna
// phoenixAccount). Signing in shows a code and its QR code to approve on a
// phone or computer (the device authorization grant, RFC 8628), as TVs do;
// "Sign in on this device" uses the browser sheet where there is one.
// Signed in: the account, the plan and what it includes, Sign Out. Not set
// up (servers.json names no account server): says so, and that nothing
// else needs it. Legacy webOS kept the Palm Profile in the Backup app
// (com.palm.app.backup); Phoenix gives the account its own page and shows
// Phoenix Cloud in Backup.
//
// Launch params {page: "account"} (the "Signed in" notification opens it).

import { useEffect, useState } from "react";
import { phoenixAccount, accountErrorCode, type AccountStatus } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, ErrorText, Group, Note, Page, PageHeader, Row, Spinner } from "@phoenix/ui";
import { errorText, size } from "./Backup";


export function AccountPage() {
    const st = useLuna<AccountStatus>((cb, err) => phoenixAccount.watchStatus(cb, err), []).value;
    const [error, setError] = useState<string | null>(null);
    const name = st?.accountName ?? "Phoenix Account";

    async function run(fn: () => Promise<unknown>) {
        setError(null);
        try { await fn(); } catch (e) {
            setError(accountErrorCode(e) === "NOT_SET_UP" ? `No ${name} server is set up on this device.` : errorText(e));
        }
    }

    if (!st) return <Page><PageHeader title={name} icon="icons/backup.png" /><Row title="Loading…"><Spinner /></Row></Page>;
    return (
        <Page>
            <PageHeader title={name} icon="icons/backup.png" />
            {st.state === "notSetUp" && (
                <>
                    <Group>
                        <div className="account-status" data-testid="account-not-set-up">
                            This device is not set up for a {name}.
                        </div>
                    </Group>
                    <Note>
                        Everything on this device works without one: apps, the Marketplace and updates. A {name}{" "}
                        adds encrypted cloud backup, notifications from Google and Microsoft accounts while you are away,
                        and the Phoenix assistant service, once its server is set up.
                    </Note>
                </>
            )}
            {st.state === "signedOut" && (
                <>
                    <Group>
                        <div className="account-status" data-testid="account-signed-out">Sign in to your {name} (optional).</div>
                        <Button onClick={() => void run(() => phoenixAccount.signIn("code"))} data-testid="account-sign-in">Sign In</Button>
                        <Button variant="dark" onClick={() => void run(() => phoenixAccount.signIn("browser"))} data-testid="account-sign-in-browser">
                            Sign In on This Device
                        </Button>
                    </Group>
                    <Note>
                        Your {name} keeps encrypted backups of this device and lets you restore them on another. No account is
                        needed for anything else. You can create one at the address shown when you sign in.
                    </Note>
                </>
            )}
            {st.state === "signingIn" && <SigningIn st={st} onCancel={() => void run(() => phoenixAccount.cancelSignIn())} />}
            {st.state === "signedIn" && st.account && (
                <>
                    <Group label="Account">
                        <Row title={st.account.name || st.account.email} value={st.account.email} testId="account-email" />
                        <Row title="Plan" value={plan(st)} testId="account-plan" />
                        {st.entitlements?.features.backup && (
                            <Row title="Cloud backup" value={`${size(st.entitlements.features.backup.usedBytes)} of ${size(st.entitlements.features.backup.quotaBytes)}`}
                                 testId="account-backup" />
                        )}
                        {st.entitlements?.validUntil && (
                            <Row title="Renews" value={new Date(st.entitlements.validUntil).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                                 testId="account-until" />
                        )}
                    </Group>
                    <Group>
                        <Button variant="dark" onClick={() => void run(() => phoenixAccount.signOut())} data-testid="account-sign-out">Sign Out</Button>
                    </Group>
                    <Note>Manage your account, its devices and your plan at {st.issuer ? new URL(st.issuer).host : "the account website"}.</Note>
                </>
            )}
            {(error || st.error) && <ErrorText testId="account-error">{error ?? st.error?.errorText}</ErrorText>}
        </Page>
    );
}

function plan(st: AccountStatus): string {
    const p = st.entitlements?.plan ?? st.account?.plan ?? "free";
    const label = p === "cloud" ? "Phoenix Cloud" : p === "free" ? "Free" : p;
    return st.entitlements && !st.entitlements.current ? label + " (ended)" : label;
}

function SigningIn({ st, onCancel }: { st: AccountStatus; onCancel: () => void }) {
    const s = st.signIn;
    const [qr, setQr] = useState<string | null>(null);
    useEffect(() => {
        let gone = false;
        setQr(null);
        // The QR code writer (zxing-wasm) is loaded only for this.
        const uri = s?.verificationUriComplete;
        if (uri) import("../qr").then((m) => m.qrSvg(uri)).then((svg) => { if (!gone) setQr(svg); }, () => setQr(null));
        return () => { gone = true; };
    }, [s?.verificationUriComplete]);
    if (!s || s.method === "browser") {
        return <Group><Row title="Signing in…"><Spinner /></Row><Button variant="dark" onClick={onCancel}>Cancel</Button></Group>;
    }
    return (
        <Group label="Sign in">
            <div className="account-code-steps" data-testid="account-code-steps">
                On your phone or computer, go to <b data-testid="account-verify-uri">{s.verificationUri}</b> and enter this code:
            </div>
            <div className="account-code" data-testid="account-code">{s.userCode}</div>
            {qr && <div className="account-qr" data-testid="account-qr" dangerouslySetInnerHTML={{ __html: qr }} />}
            <Row title="Waiting for approval…"><Spinner /></Row>
            <Button variant="dark" onClick={onCancel} data-testid="account-cancel">Cancel</Button>
        </Group>
    );
}
