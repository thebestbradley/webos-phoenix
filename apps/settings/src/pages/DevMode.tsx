// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Developer Mode: lets the Marketplace install packages that run their own
// install scripts or background services, and (on a device) the Terminal's
// sudo and SSH. Turning it on shows what it allows and asks for the device
// PIN or password; with no secure unlock set, it asks for one to be set
// first in Screen & Lock. Turning it off needs nothing. Phoenix addition
// (legacy webOS had the "webos20090606" Konami code in Just Type; OSE has
// the Developer Mode app and com.webos.service.devmode).
// Services:
//   com.webos.service.devmode getDevMode {subscribe} / setDevMode {status}
//   com.palm.systemmanager getDeviceLockMode / matchDevicePasscode;
//   getDebugOverlays, enableFpsCounter, enableTouchPlot (the shell's
//   frame rate counter and touch plot, under Debugging while it is on)

import { useEffect, useState } from "react";
import { apps, call, deviceLock, devMode, LunaError, subscribe, type LockMode } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Button, Dialog, ErrorText, Group, Note, Page, PageHeader, Row, TextField, ToggleButton } from "@phoenix/ui";

export function DevModePage() {
    const on = useLuna<boolean>((cb, err) => devMode.watch(cb, err), []).value;
    const [lockMode, setLockMode] = useState<LockMode | null>(null);
    const [asking, setAsking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        deviceLock.mode().then(setLockMode).catch(() => setLockMode("none"));
    }, [asking]);

    async function turnOff() {
        setError(null);
        try { await devMode.set(false); } catch (e) { setError(e instanceof LunaError ? e.errorText : String(e)); }
    }

    return (
        <Page>
            <PageHeader title="Developer Mode" icon="icons/devmode.png" />
            <Group>
                <Row title="Developer Mode">
                    <ToggleButton value={!!on} label="Developer Mode" disabled={on === undefined} testId="devmode-toggle"
                                  onChange={(v) => { if (v) setAsking(true); else void turnOff(); }} />
                </Row>
            </Group>
            {error && <ErrorText>{error}</ErrorText>}
            <Note>
                With Developer Mode on, the Marketplace can install apps that run their own install scripts or
                background services. They run with more access to the device than other apps, so only install
                them from people you trust.
            </Note>
            {on && <DebugOverlays />}
            <DevModeDialog open={asking} lockMode={lockMode} onDone={() => setAsking(false)} />
        </Page>
    );
}

interface Overlays { fpsCounter: boolean; touchPlot: { trails: boolean; crosshairs: boolean } }

/** The shell's debugging overlays (com.palm.systemmanager enableFpsCounter / enableTouchPlot). */
function DebugOverlays() {
    const shown = useLuna<Overlays>((cb, err) =>
        subscribe("luna://com.palm.systemmanager/getDebugOverlays", {}, (r) => cb(r as unknown as Overlays), err), []).value;
    const touches = !!shown && (shown.touchPlot.trails || shown.touchPlot.crosshairs);
    return (
        <Group label="Debugging">
            <Row title="Frame rate counter">
                <ToggleButton value={!!shown?.fpsCounter} label="Frame rate counter" disabled={!shown} testId="devmode-fps"
                              onChange={(v) => void call("luna://com.palm.systemmanager/enableFpsCounter", { enable: v })} />
            </Row>
            <Row title="Touch plot">
                <ToggleButton value={touches} label="Touch plot" disabled={!shown} testId="devmode-touchplot"
                              onChange={(v) => void call("luna://com.palm.systemmanager/enableTouchPlot", { trails: v, crosshairs: v })} />
            </Row>
        </Group>
    );
}

/** The warning, then the device PIN or password. */
function DevModeDialog({ open, lockMode, onDone }: { open: boolean; lockMode: LockMode | null; onDone: () => void }) {
    const [code, setCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { setCode(""); setError(null); }, [open]);
    if (!open || lockMode === null) return null;

    if (lockMode === "none") {
        return (
            <Dialog open title="Set a PIN or password first" onClose={onDone} testId="devmode-nolock"
                    message="Developer Mode asks for the device's PIN or password before it turns on. Set one in Screen & Lock, then come back.">
                <Button variant="affirmative" data-testid="devmode-open-screen"
                        onClick={() => { void apps.launch("org.webosphoenix.settings", { page: "screen" }); onDone(); }}>
                    Open Screen &amp; Lock
                </Button>
                <Button variant="dark" onClick={onDone}>Cancel</Button>
            </Dialog>
        );
    }

    const isPin = lockMode === "pin";
    const kind = isPin ? "PIN" : "password";
    async function confirm() {
        setError(null);
        setBusy(true);
        try {
            if (!(await deviceLock.matches(code).catch(() => false))) {
                setError(`That ${kind} is not correct.`);
                setCode("");
                return;
            }
            await devMode.set(true);
            onDone();
        } catch (e) {
            setError(e instanceof LunaError ? e.errorText : String(e));
        } finally {
            setBusy(false);
        }
    }
    return (
        <Dialog open title="Turn on Developer Mode?" onClose={onDone} testId="devmode-confirm"
                message={`Apps can then run install scripts and background services that can read your data and change the system. Only install them from people you trust. Enter your ${kind} to turn it on.`}>
            <TextField type="password" inputMode={isPin ? "numeric" : "text"} value={code} autoFocus
                       onChange={(v) => setCode(isPin ? v.replace(/\D/g, "") : v)} onSubmit={confirm} maxLength={isPin ? 8 : 64}
                       placeholder={isPin ? "PIN" : "Password"} testId="devmode-passcode" />
            {error && <ErrorText>{error}</ErrorText>}
            <Button variant="negative" disabled={code.length === 0 || busy} onClick={confirm} data-testid="devmode-enable">
                Turn On
            </Button>
            <Button variant="dark" onClick={onDone}>Cancel</Button>
        </Dialog>
    );
}
