// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// QR Scanner: a full-card viewfinder like the webOS 2.x Camera that reads
// QR codes and barcodes as soon as one is in view, then says what it is
// and offers what can be done with it:
//
//   web address      Open in the browser (http and https only; the address
//                    is shown in full first, so a code can't hide where it
//                    goes)
//   Wi-Fi network    Join in Settings > Wi-Fi (launch {page: "wifi", join})
//   contact          Add to Contacts (launch {launchType: "newContact", contact})
//   authenticator    Add to the authenticator (org.webosphoenix.authenticator,
//   key (otpauth://) launch {otpauth: uri}) when it is installed; the key is
//                    never shown or kept in the history
//   phone, email,    Call / Write / Text (applicationManager open tel:,
//   text message     mailto:, sms:)
//   anything         Copy
//
// History (newest first, on the device only; off in the app menu) opens
// any earlier result again. The torch (org.webosports.service.torch) lights
// dark codes when the device has one.
//
// Other apps can use it to scan for them: launch it with {returnTo: appId}
// and it relaunches that app with {scanned: {text, format}} after the
// first code, then closes. Nothing is decoded off the device.
//
// Services: the camera like apps/camera (com.webos.service.camera2
// getCameraList, then getUserMedia); com.webos.applicationManager launch,
// open and getAppInfo; org.webosports.service.torch.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apps, cameraService, torch, type TorchStatus } from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import {
    AppMenu, BackProvider, Button, cx, Divider, Group, IconToolButton, PageHeader, Row, Spinner, Toolbar, ToolSpacer, useBack,
} from "@phoenix/ui";
import { historyText, kindTitle, parseContent, safeUrl, summary, type Content } from "./lib/content";
import { decode, type Decoded } from "./lib/decode";
import { addScan, clearHistory, loadHistory, loadPrefs, saveHistory, savePrefs, type Prefs, type Scan } from "./lib/history";

export const AUTHENTICATOR_ID = "org.webosphoenix.authenticator";
const SETTINGS_ID = "org.webosphoenix.settings";
const CONTACTS_ID = "com.palm.app.contacts";

type CameraState = "starting" | "ready" | "none" | "denied";

interface LaunchParams {
    /** Scan for this app: relaunch it with {scanned: {text, format}}. */
    returnTo?: string;
}

function useWide(): boolean {
    const [wide, setWide] = useState(() => window.innerWidth >= 600);
    useEffect(() => {
        const on = () => setWide(window.innerWidth >= 600);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    return wide;
}

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // No async clipboard (insecure origin, old runtime): the classic way.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        ta.remove();
        return ok;
    }
}

function when(ms: number): string {
    const d = new Date(ms);
    const today = new Date().toDateString() === d.toDateString();
    return today
        ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---- The viewfinder ------------------------------------------------------------------------

function useCamera(active: boolean, video: React.RefObject<HTMLVideoElement | null>) {
    const [state, setState] = useState<CameraState>("starting");
    const stream = useRef<MediaStream | null>(null);
    useEffect(() => {
        if (!active) return;
        let live = true;
        const stop = () => {
            stream.current?.getTracks().forEach((t) => t.stop());
            stream.current = null;
            if (video.current) video.current.srcObject = null;
        };
        (async () => {
            setState("starting");
            try {
                if ((await cameraService.list()).length === 0) { setState("none"); return; }
            } catch {
                // No camera service (a browser without the runtime): ask the browser.
            }
            const md = navigator.mediaDevices;
            if (!md?.getUserMedia) { setState("none"); return; }
            try {
                const s = await md.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
                if (!live) { s.getTracks().forEach((t) => t.stop()); return; }
                stream.current = s;
                if (video.current) {
                    video.current.srcObject = s;
                    await video.current.play().catch(() => {});
                }
                setState("ready");
            } catch (e) {
                const name = (e as { name?: string }).name;
                if (live) setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "none");
            }
        })();
        const onVis = () => { if (document.hidden) stop(); };
        document.addEventListener("visibilitychange", onVis);
        return () => { live = false; document.removeEventListener("visibilitychange", onVis); stop(); };
    }, [active, video]);
    return state;
}

/** Decode frames while active; the first code found goes to onFound. */
function useScanLoop(active: boolean, video: React.RefObject<HTMLVideoElement | null>, onFound: (d: Decoded) => void) {
    const found = useRef(onFound);
    found.current = onFound;
    useEffect(() => {
        if (!active) return;
        let stopped = false;
        let busy = false;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const tick = async () => {
            const v = video.current;
            if (stopped || busy || !ctx || !v || v.readyState < 2 || !v.videoWidth) return;
            busy = true;
            try {
                // At most 800 px across: fast enough on a phone, sharp enough for a QR code.
                const scale = Math.min(1, 800 / v.videoWidth);
                canvas.width = Math.round(v.videoWidth * scale);
                canvas.height = Math.round(v.videoHeight * scale);
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                const d = await decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
                if (d && !stopped) { stopped = true; found.current(d); }
            } catch (e) {
                console.error("[scanner]", e);
            } finally {
                busy = false;
            }
        };
        const t = setInterval(() => void tick(), 200);
        return () => { stopped = true; clearInterval(t); };
    }, [active, video]);
}

// ---- A result ---------------------------------------------------------------------------------

interface Action { label: string; run: () => void | Promise<void>; primary?: boolean; testId: string }

function actionsFor(c: Content, raw: string, authenticator: boolean | undefined, say: (s: string) => void): Action[] {
    const copy = (text: string, what = "Copied") => async () => say((await copyText(text)) ? what : "Can't copy here");
    const launch = (id: string, params: object) => () => { void apps.launch(id, params).catch((e) => say(e.errorText ?? String(e))); };
    const open = (target: string) => () => { void apps.open(target).catch((e) => say(e.errorText ?? String(e))); };
    switch (c.kind) {
    case "url": {
        const u = safeUrl(c.url);
        return [
            ...(u ? [{ label: "Open in Browser", run: open(u), primary: true, testId: "act-open" }] : []),
            { label: "Copy Address", run: copy(c.url), testId: "act-copy" },
        ];
    }
    case "wifi":
        return [
            { label: "Join Network", primary: true, testId: "act-join",
              run: launch(SETTINGS_ID, { page: "wifi", join: { ssid: c.ssid, security: c.security, passKey: c.password, hidden: c.hidden } }) },
            ...(c.password ? [{ label: "Copy Password", run: copy(c.password, "Password copied"), testId: "act-copy" }] : []),
        ];
    case "contact":
        return [
            { label: "Add to Contacts", primary: true, testId: "act-contact", run: launch(CONTACTS_ID, { launchType: "newContact", contact: c.contact }) },
            { label: "Copy", run: copy(raw), testId: "act-copy" },
        ];
    case "otpauth":
        return authenticator
            ? [{ label: "Add to Authenticator", primary: true, testId: "act-otp", run: launch(AUTHENTICATOR_ID, { otpauth: c.uri }) }]
            : [];
    case "tel":
        return [{ label: "Call", primary: true, testId: "act-call", run: open(`tel:${c.number}`) }, { label: "Copy Number", run: copy(c.number), testId: "act-copy" }];
    case "email": {
        const q = new URLSearchParams();
        if (c.subject) q.set("subject", c.subject);
        if (c.body) q.set("body", c.body);
        const qs = q.toString().replace(/\+/g, "%20");
        return [{ label: "Write Email", primary: true, testId: "act-email", run: open(`mailto:${c.to}${qs ? "?" + qs : ""}`) },
                { label: "Copy Address", run: copy(c.to), testId: "act-copy" }];
    }
    case "sms":
        return [{ label: "Send Text", primary: true, testId: "act-sms", run: open(`sms:${c.number}${c.body ? "?body=" + encodeURIComponent(c.body) : ""}`) },
                { label: "Copy", run: copy(c.body ? `${c.number}: ${c.body}` : c.number), testId: "act-copy" }];
    case "geo":
        return [{ label: "Copy Coordinates", run: copy(`${c.latitude}, ${c.longitude}`), primary: true, testId: "act-copy" }];
    case "product":
        return [{ label: "Copy Number", run: copy(c.code), primary: true, testId: "act-copy" }];
    case "text":
        return [{ label: "Copy Text", run: copy(c.text), primary: true, testId: "act-copy" }];
    }
}

function ResultSheet({ scan, onAgain, say }: { scan: Decoded; onAgain: () => void; say: (s: string) => void }) {
    const c = useMemo(() => parseContent(scan.text, scan.format), [scan]);
    const [authenticator, setAuthenticator] = useState<boolean | undefined>(undefined);
    const [showPassword, setShowPassword] = useState(false);
    useEffect(() => {
        if (c.kind === "otpauth") void apps.installed(AUTHENTICATOR_ID).then(setAuthenticator);
    }, [c]);
    const actions = actionsFor(c, scan.text, authenticator, say);

    return (
        <div className="sc-sheet" data-testid="result" data-kind={c.kind}>
            <div className="sc-sheet-head">
                <span className="sc-kind" data-testid="result-kind">{kindTitle(c)}</span>
                <span className="sc-format">{scan.format}</span>
            </div>
            <div className="sc-sheet-body">
                {c.kind === "url" && <div className="sc-url" data-testid="result-text"><b>{hostOf(c.url)}</b><span>{c.url}</span></div>}
                {c.kind === "wifi" && (
                    <div data-testid="result-text">
                        <div className="sc-big">{c.ssid}</div>
                        <div className="sc-detail">
                            {c.security === "none" ? "Open network" : c.security === "wep" ? "WEP" : "WPA"}{c.hidden && " · Hidden"}
                        </div>
                        {c.password && (
                            <div className="sc-detail">Password: <span className="sc-mono" data-testid="wifi-password">
                                {showPassword ? c.password : "•".repeat(Math.min(12, c.password.length))}</span>
                                <button type="button" className="sc-link" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button>
                            </div>
                        )}
                    </div>
                )}
                {c.kind === "contact" && (
                    <div data-testid="result-text">
                        <div className="sc-big">{c.name}</div>
                        {[...(c.contact.phoneNumbers ?? []), ...(c.contact.emails ?? [])].slice(0, 4).map((x, i) => (
                            <div key={i} className="sc-detail">{x.value}</div>
                        ))}
                        {c.contact.organizations?.[0]?.name && <div className="sc-detail">{c.contact.organizations[0].name}</div>}
                    </div>
                )}
                {c.kind === "otpauth" && (
                    <div data-testid="result-text">
                        <div className="sc-big">{summary(c)}</div>
                        <div className="sc-detail">
                            {authenticator === false
                                ? "Install an authenticator app to add this account. The key is not shown or saved here."
                                : "A key for two-step sign-in codes. It is not shown or saved here."}
                        </div>
                    </div>
                )}
                {(c.kind === "tel" || c.kind === "sms" || c.kind === "email" || c.kind === "geo" || c.kind === "product") && (
                    <div data-testid="result-text">
                        <div className="sc-big">{summary(c)}</div>
                        {c.kind === "email" && c.subject && <div className="sc-detail">{c.subject}</div>}
                        {(c.kind === "sms" || c.kind === "email") && c.body && <div className="sc-detail sc-pre">{c.body}</div>}
                    </div>
                )}
                {c.kind === "text" && <div className="sc-text sc-pre" data-testid="result-text">{c.text}</div>}
            </div>
            <div className="sc-actions">
                {actions.map((a) => (
                    <Button key={a.testId} variant={a.primary ? "affirmative" : "default"} data-testid={a.testId} onClick={() => void a.run()}>{a.label}</Button>
                ))}
                <Button variant="dark" data-testid="scan-again" onClick={onAgain}>Scan Again</Button>
            </div>
        </div>
    );
}

function hostOf(url: string): string {
    try { return new URL(url).host; } catch { return url; }
}

// ---- History ------------------------------------------------------------------------------------

function HistoryList({ history, keep, onOpen }: { history: Scan[]; keep: boolean; onOpen: (s: Scan) => void }) {
    return (
        <div className="sc-history" data-testid="history">
            <PageHeader title="History" />
            <div className="sc-history-scroll">
                {!keep && <div className="sc-empty">History is off. Turn it on in the app menu.</div>}
                {keep && history.length === 0 && <div className="sc-empty" data-testid="history-empty">Codes you scan appear here.</div>}
                {history.length > 0 && <Divider caption={`${history.length} ${history.length === 1 ? "code" : "codes"}`} />}
                {history.length > 0 && <Group className="sc-history-list">
                    {history.map((s) => {
                        const c = parseContent(s.text, s.format);
                        return (
                            <Row key={s.id} testId={`history-${summary(c)}`} className="sc-history-row" onClick={() => onOpen(s)}
                                 title={summary(c)} subtitle={kindTitle(c)} value={when(s.at)} />
                        );
                    })}
                </Group>}
            </div>
        </div>
    );
}

// ---- The app --------------------------------------------------------------------------------------

function ScannerApp() {
    const wide = useWide();
    const launch = useLaunchParams<LaunchParams>();
    const returnTo = typeof launch.returnTo === "string" && launch.returnTo ? launch.returnTo : null;
    const video = useRef<HTMLVideoElement>(null);
    const [result, setResult] = useState<Decoded | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [history, setHistory] = useState<Scan[]>(loadHistory);
    const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
    const [toast, setToast] = useState("");
    const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const t = useLuna<TorchStatus>((cb, err) => torch.watch(cb, err), []).value;
    const litByUs = useRef(false);

    const scanning = !result && (wide || !showHistory);
    const camera = useCamera(wide || !showHistory || !!result, video);

    const say = useCallback((text: string) => {
        setToast(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 2200);
    }, []);

    const onFound = useCallback((d: Decoded) => {
        if (returnTo) {
            void apps.launch(returnTo, { scanned: { text: d.text, format: d.format } }).finally(() => window.close());
            setResult(d);
            return;
        }
        setResult(d);
        setShowHistory(false);
        if (loadPrefs().keepHistory) {
            setHistory((h) => {
                const n = addScan(h, { text: historyText(d.text, parseContent(d.text, d.format)), format: d.format, at: Date.now() });
                saveHistory(n);
                return n;
            });
        }
    }, [returnTo]);

    useScanLoop(scanning && camera === "ready", video, onFound);

    useBack(() => { setResult(null); return true; }, !!result);
    useBack(() => { setShowHistory(false); return true; }, !wide && showHistory && !result);

    // The torch goes off with the card, if we lit it.
    useEffect(() => {
        const off = () => { if (litByUs.current) void torch.set(false).catch(() => {}); };
        window.addEventListener("pagehide", off);
        return () => { window.removeEventListener("pagehide", off); off(); };
    }, []);

    const setPrefs = (p: Prefs) => {
        setPrefsState(p);
        savePrefs(p);
        if (!p.keepHistory) { clearHistory(); setHistory([]); }
    };

    const status = camera === "none" ? "No camera found." : camera === "denied" ? "Camera access is turned off for this app."
        : returnTo ? "Point the camera at a code to scan it." : "Point the camera at a QR code or barcode.";

    const viewfinder = (
        <div className="sc-view" data-testid="viewfinder">
            <video ref={video} className="sc-video" muted playsInline autoPlay />
            {camera === "starting" && <div className="sc-center"><Spinner large /></div>}
            {!result && (
                <div className="sc-overlay">
                    <div className="sc-target"><span /><span /><span /><span /></div>
                    <div className={cx("sc-hint", camera !== "ready" && camera !== "starting" && "error")} data-testid="hint">{status}</div>
                </div>
            )}
            {result && <ResultSheet key={result.text + result.format} scan={result} say={say} onAgain={() => setResult(null)} />}
            <Toolbar kind="dark" className="sc-toolbar">
                {!wide && <IconToolButton icon="history" label="History" testId="show-history" onClick={() => { setResult(null); setShowHistory(true); }} />}
                <ToolSpacer />
                {t?.available && (
                    <IconToolButton icon="flash" label="Light" testId="torch" depressed={t.on} onClick={() => {
                        litByUs.current = !t.on;
                        void torch.set(!t.on).catch((e) => say(e.errorText ?? String(e)));
                    }} />
                )}
            </Toolbar>
        </div>
    );

    return (
        <div className={cx("sc-app", wide ? "wide" : "narrow")}>
            <AppMenu items={[
                { label: <span data-testid="menu-keep">{prefs.keepHistory ? "✓ " : ""}Keep History</span>, onSelect: () => setPrefs({ keepHistory: !prefs.keepHistory }) },
                { label: "Clear History", disabled: history.length === 0, onSelect: () => { clearHistory(); setHistory([]); say("History cleared"); } },
            ]} />
            {(wide || !showHistory || result) && viewfinder}
            {(wide || (showHistory && !result)) && !returnTo && (
                <HistoryList history={history} keep={prefs.keepHistory} onOpen={(s) => { setShowHistory(false); setResult({ text: s.text, format: s.format }); }} />
            )}
            {toast && <div className="sc-toast" data-testid="toast">{toast}</div>}
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <ScannerApp />
        </BackProvider>
    );
}
