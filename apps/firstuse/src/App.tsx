// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// First Use: what a new phone shows before anything else, as webOS's First
// Use app did (com.palm.app.firstuse, which LunaSysMgr ran full screen in
// its minimal UI until /var/luna/preferences/ran-first-use existed; Palm
// never open-sourced the app). The steps, each but the first and last
// skippable:
//
//   Welcome (language)  ->  Wi-Fi  ->  Restore (a backup)  ->  Date & Time  ->  Accounts (Synergy)
//   ->  Passcode  ->  Privacy (location, the assistant)  ->  Cards & gestures
//   (the tutorial)  ->  All set (Help and tips)
//
// "Skip setup" on the first page ends it at once. Finishing (or skipping)
// sets the system preference firstUseComplete and closes the window: the
// shell leaves First Use for the lock screen and cards. Settings > Device
// Info runs it again as an ordinary card ({rerun: true}).
//
// Services: com.webos.settingsservice localeInfo; com.webos.service.wifi;
// com.webos.service.systemservice (timeZone, useNetworkTime, timeFormat,
// firstUseComplete); org.webosphoenix.service.backup; com.palm.service.accounts listAccounts;
// com.palm.systemmanager setDevicePasscode; com.webos.service.location.

import { useEffect, useState, type ReactNode } from "react";
import {
    apps, backup, backupErrorCode, BACKUP_PARTS, call, deviceLock, firstUse, LunaError, location, settings, system, wifi, WIFI_ERROR_INVALID_KEY,
    type BackupDestination, type BackupFile,
    type LocaleInfo, type LocationHandler, type LockMode, type SystemPreferences, type TimeZone, type WifiNetworkInfo, type WifiStatus,
} from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import {
    BackProvider, Button, Checkmark, Dialog, ErrorText, Group, icons, ListSelector, Note, Row, Spinner, srcSet, TextField, ToggleButton, useBack,
} from "@phoenix/ui";
import { LANGUAGES, nextStep, passcodeProblem, previousStep, STEPS, stepIndex, type StepId } from "./lib/flow";
import { Tutorial } from "./Tutorial";

function useWide(): boolean {
    const q = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 700px)") : null;
    const [wide, setWide] = useState(!!q?.matches);
    useEffect(() => {
        if (!q) return;
        const on = () => setWide(q.matches);
        q.addEventListener("change", on);
        return () => q.removeEventListener("change", on);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return wide;
}

/** One step's page: its title, what it is for, the content, and the buttons. */
function StepPage({ title, intro, children, onBack, onNext, nextLabel = "Next", onSkip, nextDisabled, testId, buttons = true }: {
    title: string; intro?: ReactNode; children?: ReactNode; onBack?: () => void; onNext: () => void; nextLabel?: string;
    onSkip?: () => void; nextDisabled?: boolean; testId: string; buttons?: boolean;
}) {
    return (
        <div className="fu-step" data-testid={`step-${testId}`}>
            <div className="fu-head">
                <div className="fu-title">{title}</div>
                {onSkip && <button type="button" className="fu-skip" data-testid="skip" onClick={onSkip}>Skip</button>}
            </div>
            {intro && <div className="fu-intro">{intro}</div>}
            <div className="fu-body">{children}</div>
            {buttons && <div className="fu-buttons">
                {onBack ? <Button variant="dark" onClick={onBack} data-testid="back">Back</Button> : <span />}
                <Button variant="affirmative" onClick={onNext} disabled={nextDisabled} data-testid="next">{nextLabel}</Button>
            </div>}
        </div>
    );
}

function Progress({ step }: { step: StepId }) {
    const i = stepIndex(step);
    return (
        <div className="fu-progress" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
            {STEPS.map((s, j) => <span key={s.id} className={`fu-pip${j < i ? " done" : j === i ? " on" : ""}`} />)}
        </div>
    );
}

// ---- Welcome ------------------------------------------------------------------------

function Welcome({ onNext, onSkipAll }: { onNext: () => void; onSkipAll: () => void }) {
    const info = useLuna<LocaleInfo | undefined>((cb, err) => settings.watch("", ["localeInfo"], (s) => cb(s.localeInfo), err), []).value;
    const ui = info?.locales?.UI ?? "en-US";
    const choose = (v: string) => void settings.set("", { localeInfo: { ...(info ?? { locales: {} }), locales: { ...info?.locales, UI: v, FMT: v } } });
    return (
        <StepPage testId="welcome" title="Welcome" onNext={onNext}
                  intro={<><div className="fu-hello"><img src="icon-256x256.png" alt="" /></div>
                      Let's get your webOS Phoenix device ready. Choose your language.</>}>
            <Group>
                {LANGUAGES.map((l) => (
                    <Row key={l.value} title={l.label} onClick={() => choose(l.value)} testId={`lang-${l.value}`}>
                        {ui === l.value && <Checkmark />}
                    </Row>
                ))}
            </Group>
            <Note>The Phoenix apps speak English for now; the language also sets how dates, times and numbers look.</Note>
            <button type="button" className="fu-link" data-testid="skip-setup" onClick={onSkipAll}>Skip setup</button>
        </StepPage>
    );
}

// ---- Wi-Fi ------------------------------------------------------------------------

function securityOf(n: WifiNetworkInfo): "none" | "psk" | "wep" {
    const t = n.availableSecurityTypes.find((s) => s !== "none");
    return t === "wep" ? "wep" : t ? "psk" : "none";
}

/** The Wi-Fi bars picture for 0..3 bars. */
function signalIcon(bars: number): string {
    return icons.wifiSignal[Math.max(0, Math.min(3, bars))];
}

function WifiStep(nav: NavProps) {
    const status = useLuna<WifiStatus>((cb, err) => wifi.watchStatus(cb, err), []).value;
    const enabled = status ? status.status !== "serviceDisabled" : undefined;
    const networks = useLuna<WifiNetworkInfo[]>((cb, err) => (enabled ? wifi.watchNetworks(cb, err) : null), [enabled]).value ?? [];
    const connected = status?.networkInfo?.connectState === "ipConfigured" ? status.networkInfo.ssid : null;
    const [join, setJoin] = useState<WifiNetworkInfo | null>(null);
    const [pass, setPass] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const connect = async (n: WifiNetworkInfo, key?: string) => {
        setBusy(n.ssid);
        setError(null);
        try {
            if (n.profileId !== undefined && key === undefined) await wifi.connectProfile(n.profileId);
            else await wifi.connect(n.ssid, securityOf(n), key);
            setJoin(null);
            setPass("");
        } catch (e) {
            setError(e instanceof LunaError && e.errorCode === WIFI_ERROR_INVALID_KEY ? "The password is incorrect." : e instanceof LunaError ? e.errorText : String(e));
        } finally {
            setBusy(null);
        }
    };
    const tap = (n: WifiNetworkInfo) => {
        if (n.ssid === connected) return;
        if (n.profileId !== undefined || securityOf(n) === "none") void connect(n);
        else { setJoin(n); setPass(""); setError(null); }
    };
    const sorted = [...networks].sort((a, b) => (b.ssid === connected ? 1 : 0) - (a.ssid === connected ? 1 : 0) || b.signalLevel - a.signalLevel);

    return (
        <StepPage testId="wifi" title="Wi-Fi" {...nav}
                  intro="Connect to a Wi-Fi network to add accounts and keep the time right.">
            <Group>
                <Row title="Wi-Fi">
                    <ToggleButton value={!!enabled} disabled={enabled === undefined} label="Wi-Fi" testId="wifi-toggle"
                                  onChange={(v) => void wifi.setEnabled(v)} />
                </Row>
            </Group>
            {enabled && (
                <Group>
                    {sorted.length === 0 && <Row title="Searching…"><Spinner /></Row>}
                    {sorted.map((n) => (
                        <Row key={n.ssid} title={n.ssid} testId={`network-${n.ssid}`} onClick={() => tap(n)}
                             subtitle={busy === n.ssid ? "Connecting…" : n.ssid === connected ? "Connected" : undefined}
                             icon={n.ssid === connected ? <Checkmark /> : <span className="fu-check-space" />}>
                            {busy === n.ssid && <Spinner />}
                            {securityOf(n) !== "none" && <img src={icons.secure} srcSet={srcSet(icons.secure)} width={14} height={25} alt="secure" />}
                            <img src={signalIcon(n.signalBars)} srcSet={srcSet(signalIcon(n.signalBars))} width={33} height={25} alt="" />
                        </Row>
                    ))}
                </Group>
            )}
            {error && !join && <ErrorText>{error}</ErrorText>}
            <Dialog open={!!join} title={join ? `Join ${join.ssid}` : ""} onClose={() => setJoin(null)} testId="wifi-join">
                <TextField type="password" value={pass} onChange={setPass} placeholder="Password" autoFocus testId="wifi-password"
                           onSubmit={() => join && void connect(join, pass)} />
                {error && <ErrorText>{error}</ErrorText>}
                <Button variant="affirmative" busy={busy !== null} disabled={!pass} data-testid="wifi-connect"
                        onClick={() => join && void connect(join, pass)}>Connect</Button>
                <Button variant="dark" onClick={() => setJoin(null)}>Cancel</Button>
            </Dialog>
        </StepPage>
    );
}

// ---- Restore -----------------------------------------------------------------------------
//
// A backup made by Settings > Backup on another (or this) device: where it
// is, which one, its passphrase. Afterwards this device backs up to the same
// place, every day, with the same passphrase.

function RestoreStep(nav: NavProps) {
    const [mode, setMode] = useState<"ask" | "where" | "list" | "restored">("ask");
    const [type, setType] = useState<"usb" | "webdav">("usb");
    const [url, setUrl] = useState("");
    const [user, setUser] = useState("");
    const [password, setPassword] = useState("");
    const [files, setFiles] = useState<BackupFile[] | null>(null);
    const [chosen, setChosen] = useState<BackupFile | null>(null);
    const [pass, setPass] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [restored, setRestored] = useState<string[]>([]);
    const text = (e: unknown) => (e instanceof LunaError ? e.errorText : String(e));

    async function look() {
        setBusy(true);
        setError(null);
        const destination: BackupDestination = type === "usb" ? { type: "usb" } : { type: "webdav", url: url.trim(), username: user.trim(), password };
        try {
            await backup.configure({ destination });
            setFiles(await backup.list());
            setMode("list");
        } catch (e) {
            setError(backupErrorCode(e) === "UNAUTHORIZED" ? "The server did not accept the user name or password." : text(e));
        } finally {
            setBusy(false);
        }
    }
    async function restore() {
        if (!chosen) return;
        setBusy(true);
        setError(null);
        try {
            const r = await backup.restore(chosen.name, pass);
            // Keep backing up there, with the same passphrase.
            await backup.configure({ passphrase: pass, auto: true });
            setRestored(r.restored);
            setChosen(null);
            setMode("restored");
        } catch (e) {
            setError(backupErrorCode(e) === "WRONG_PASSPHRASE" ? "That is not this backup's passphrase." : text(e));
        } finally {
            setBusy(false);
        }
    }

    if (mode === "restored") {
        return (
            <StepPage testId="restore" title="Restored" {...nav} onSkip={undefined}
                      intro="Your backup is back on this device. It will back up there every day.">
                <Group>{restored.map((id) => <Row key={id} title={BACKUP_PARTS[id] ?? id} icon={<Checkmark />} />)}</Group>
                <Note>Add your accounts again in the next steps: their mail, contacts and calendars sync back from the server.</Note>
            </StepPage>
        );
    }
    if (mode === "ask") {
        return (
            <StepPage testId="restore" title="Restore" {...nav} nextLabel="Set Up as New"
                      intro="Is there a backup from your old Phoenix device? It brings back your contacts, calendar, messages and settings.">
                <Group>
                    <Row title="Restore from a backup" chevron testId="restore-start" onClick={() => setMode("where")} />
                </Group>
            </StepPage>
        );
    }
    if (mode === "where") {
        return (
            <StepPage testId="restore" title="Where Is It?" onBack={() => setMode("ask")} onNext={() => void look()}
                      nextLabel={busy ? "Looking…" : "Find Backups"} nextDisabled={busy || (type === "webdav" && !url.trim())}>
                <Group>
                    <ListSelector title="Place" value={type} testId="restore-type" onChange={(v) => setType(v as "usb" | "webdav")}
                                  options={[{ label: "USB drive", value: "usb" }, { label: "WebDAV server", value: "webdav" }]} />
                </Group>
                {type === "usb"
                    ? <Note>Copy the backup file into the backups folder of this device's USB drive from your computer first.</Note>
                    : <Group>
                        <TextField label="Folder address" value={url} onChange={setUrl} testId="restore-url" />
                        <TextField label="User name" value={user} onChange={setUser} testId="restore-user" />
                        <TextField label="Password" type="password" value={password} onChange={setPassword} testId="restore-password" />
                    </Group>}
                {error && <ErrorText testId="restore-error">{error}</ErrorText>}
            </StepPage>
        );
    }
    return (
        <StepPage testId="restore" title="Choose a Backup" onBack={() => setMode("where")} onNext={nav.onNext} nextLabel="Set Up as New">
            <Group>
                {files?.length === 0 && <Row title="No backups there" />}
                {files?.map((f) => (
                    <Row key={f.name} title={f.created ? new Date(f.created).toLocaleString() : f.name} chevron
                         testId={`restore-file-${f.name}`} onClick={() => { setChosen(f); setPass(""); setError(null); }} />
                ))}
            </Group>
            <Dialog open={!!chosen} title="Restore this backup?" onClose={busy ? undefined : () => setChosen(null)} testId="restore-dialog">
                <TextField type="password" label="The backup's passphrase" value={pass} onChange={setPass} testId="restore-pass"
                           onSubmit={() => void restore()} />
                {error && <ErrorText testId="restore-pass-error">{error}</ErrorText>}
                <Button variant="affirmative" busy={busy} disabled={!pass} data-testid="restore-confirm" onClick={() => void restore()}>Restore</Button>
                <Button variant="dark" disabled={busy} onClick={() => setChosen(null)}>Cancel</Button>
            </Dialog>
        </StepPage>
    );
}

// ---- Date & Time ---------------------------------------------------------------------

function DateTimeStep(nav: NavProps) {
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(["timeZone", "useNetworkTime", "timeFormat"], cb, err), []).value ?? {};
    const [zones, setZones] = useState<TimeZone[]>([]);
    const [now, setNow] = useState(new Date());
    useEffect(() => { system.timeZones().then(setZones).catch(() => setZones([])); }, []);
    useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
    const zone = prefs.timeZone?.ZoneID ?? "";
    const h24 = prefs.timeFormat === "HH24";
    let shown = "";
    try {
        shown = new Intl.DateTimeFormat("en-US", { timeZone: zone || undefined, dateStyle: "full", timeStyle: "short", hour12: !h24 }).format(now);
    } catch { shown = now.toLocaleString(); }
    return (
        <StepPage testId="datetime" title="Date & Time" {...nav} intro="Where are you? The clock follows your time zone.">
            <div className="fu-clock" data-testid="clock">{shown}</div>
            <Group>
                <ListSelector<string> title="Time zone" value={zone} testId="timezone"
                                      options={zones.map((z) => ({ label: z.City ? `${z.City}${z.Country ? ", " + z.Country : ""}` : z.ZoneID, value: z.ZoneID }))}
                                      onChange={(id) => { const z = zones.find((x) => x.ZoneID === id); if (z) void system.setPreferences({ timeZone: z }); }} />
                <Row title="Set automatically" subtitle="From the network">
                    <ToggleButton value={prefs.useNetworkTime !== false} label="Set automatically" testId="network-time"
                                  onChange={(v) => void system.setPreferences({ useNetworkTime: v })} />
                </Row>
                <Row title="24-hour clock">
                    <ToggleButton value={h24} label="24-hour clock" testId="clock-24"
                                  onChange={(v) => void system.setPreferences({ timeFormat: v ? "HH24" : "HH12" })} />
                </Row>
            </Group>
        </StepPage>
    );
}

// ---- Accounts ------------------------------------------------------------------------

interface Account { _id: string; loc_name?: string; username?: string; alias?: string; templateId?: string }

function AccountsStep(nav: NavProps) {
    const [accounts, setAccounts] = useState<Account[] | null>(null);
    const load = () => call("luna://com.palm.service.accounts/listAccounts", {})
        .then((r) => setAccounts(((r as { results?: Account[] }).results ?? []).filter((a) => a.templateId !== "com.palm.palmprofile")))
        .catch(() => setAccounts([]));
    useEffect(() => {
        void load();
        // Back from the Accounts app: look again.
        const again = () => { if (document.visibilityState === "visible") void load(); };
        document.addEventListener("visibilitychange", again);
        const t = setInterval(load, 3000);
        return () => { document.removeEventListener("visibilitychange", again); clearInterval(t); };
    }, []);
    return (
        <StepPage testId="accounts" title="Accounts" {...nav}
                  intro={<>With <b>Synergy</b>, the contacts and calendars of all your accounts come together: one list of
                      people, one calendar.</>}>
            <Group label="Your accounts">
                {accounts === null && <Row title="Loading…"><Spinner /></Row>}
                {accounts?.length === 0 && <Row title="No accounts yet" />}
                {accounts?.map((a) => (
                    <Row key={a._id} title={a.alias || a.loc_name || a.templateId} subtitle={a.username} testId={`account-${a._id}`} />
                ))}
                <Row title="Add an account" chevron testId="add-account" onClick={() => void apps.launch("com.palm.app.accounts")} />
            </Group>
            <Note>
                Phoenix syncs contacts and calendars with CardDAV and CalDAV: iCloud, Fastmail, Nextcloud and others. Use an app
                password where your provider has them. Google, Microsoft and chat networks are planned. You can add accounts
                later in the Accounts app.
            </Note>
        </StepPage>
    );
}

// ---- Passcode ------------------------------------------------------------------------

function PasscodeStep(nav: NavProps) {
    const [mode, setMode] = useState<LockMode | null>(null);
    const [kind, setKind] = useState<LockMode>("none");
    const [code, setCode] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => { deviceLock.mode().then(setMode).catch(() => setMode("none")); }, []);

    const next = async () => {
        if (kind === "none" || (mode && mode !== "none")) return nav.onNext();
        const problem = passcodeProblem(kind, code, confirm);
        if (problem) { setError(problem); return; }
        setSaving(true);
        try {
            await deviceLock.set(kind, code);
            nav.onNext();
        } catch (e) {
            setError(e instanceof LunaError ? e.errorText : String(e));
        } finally {
            setSaving(false);
        }
    };

    if (mode && mode !== "none") {
        return (
            <StepPage testId="passcode" title="Passcode" {...nav}
                      intro={`A ${mode === "pin" ? "PIN" : "password"} already locks this device.`}>
                <Note>Change it or turn it off in Settings &gt; Screen &amp; Lock.</Note>
            </StepPage>
        );
    }
    const isPin = kind === "pin";
    return (
        <StepPage testId="passcode" title="Passcode" {...nav} onNext={next} nextLabel={kind === "none" ? "Next" : saving ? "Saving…" : "Set"}
                  nextDisabled={saving} intro="Lock the device so only you can unlock it. The lock screen asks for it after you drag the padlock up.">
            <Group>
                {([["none", "No passcode"], ["pin", "Simple PIN"], ["password", "Password"]] as [LockMode, string][]).map(([v, label]) => (
                    <Row key={v} title={label} testId={`lock-${v}`} onClick={() => { setKind(v); setError(null); setCode(""); setConfirm(""); }}>
                        {kind === v && <Checkmark />}
                    </Row>
                ))}
            </Group>
            {kind !== "none" && (
                <div className="fu-fields">
                    <TextField type="password" inputMode={isPin ? "numeric" : "text"} value={code} testId="code"
                               onChange={(v) => setCode(isPin ? v.replace(/\D/g, "") : v)} placeholder={isPin ? "PIN (4 digits or more)" : "Password"} />
                    <TextField type="password" inputMode={isPin ? "numeric" : "text"} value={confirm} testId="code-confirm" onSubmit={next}
                               onChange={(v) => setConfirm(isPin ? v.replace(/\D/g, "") : v)} placeholder={isPin ? "PIN again" : "Password again"} />
                    {error && <ErrorText>{error}</ErrorText>}
                </div>
            )}
            <Note>On the PIN pad, Emergency Call works without the passcode, and shows your Medical ID if you add one in
                Settings &gt; Emergency Info.</Note>
        </StepPage>
    );
}

// ---- Privacy -------------------------------------------------------------------------

function PrivacyStep(nav: NavProps) {
    const h = useLuna<Record<LocationHandler, boolean>>((cb, err) => location.watchHandlers(cb, err), []).value;
    const on = !!h && (h.gps || h.network);
    return (
        <StepPage testId="privacy" title="Privacy" {...nav} intro="Your data stays on this device unless you add an account or allow an app.">
            <Group label="Location">
                <Row title="Location services" subtitle="For maps and weather">
                    <ToggleButton value={on} disabled={!h} label="Location services" testId="location-toggle"
                                  onChange={(v) => void location.setEnabled(v)} />
                </Row>
                {on && (
                    <Row title="Network location" subtitle="Wi-Fi and cell towers too">
                        <ToggleButton value={!!h?.network} label="Network location" testId="network-location"
                                      onChange={(v) => void location.setHandler("network", v)} />
                    </Row>
                )}
            </Group>
            <Note>Each app asks before it gets your position; change your answers in Settings &gt; Location Services.</Note>
            <Group label="Assistant">
                <Row title="Coming later" subtitle="It will run on the device first, and ask before using a cloud model" />
            </Group>
        </StepPage>
    );
}

// ---- Done ----------------------------------------------------------------------------

function DoneStep({ onBack, onFinish, rerun }: { onBack: () => void; onFinish: () => void; rerun: boolean }) {
    return (
        <StepPage testId="done" title="All Set" onBack={onBack} onNext={onFinish} nextLabel={rerun ? "Done" : "Start"}
                  intro="Your device is ready.">
            <div className="fu-done">
                <div className="fu-hello"><img src="icon-256x256.png" alt="" /></div>
                <Group>
                    <Row title="Help and tips" subtitle="Gestures, cards and every app" chevron testId="open-help"
                         onClick={() => void apps.launch("org.webosphoenix.help")} />
                    <Row title="Emergency Info" subtitle="A medical ID for the lock screen" chevron
                         onClick={() => void apps.launch("org.webosphoenix.settings", { page: "emergency" })} />
                </Group>
                <Note>Run setup again at any time from Settings &gt; Device Info.</Note>
            </div>
        </StepPage>
    );
}

// ---- The flow ---------------------------------------------------------------------------

interface NavProps { onBack?: () => void; onNext: () => void; onSkip?: () => void }

function FirstUse() {
    const params = useLaunchParams<{ rerun?: boolean }>();
    const wide = useWide();
    const [step, setStep] = useState<StepId>("welcome");
    const [confirmSkip, setConfirmSkip] = useState(false);

    const finish = async () => {
        try { await firstUse.complete(); } catch { /* the shell hears the window close anyway */ }
        window.close();
    };
    const go = (s: StepId | null) => { if (s) setStep(s); };
    const nav: NavProps = {
        onBack: previousStep(step) ? () => go(previousStep(step)) : undefined,
        onNext: () => go(nextStep(step)),
        onSkip: STEPS[stepIndex(step)].skippable ? () => go(nextStep(step)) : undefined,
    };
    useBack(() => { if (previousStep(step)) go(previousStep(step)); return true; }, step !== "welcome" && !confirmSkip);

    let page: ReactNode;
    switch (step) {
    case "welcome": page = <Welcome onNext={nav.onNext} onSkipAll={() => setConfirmSkip(true)} />; break;
    case "wifi": page = <WifiStep {...nav} />; break;
    case "restore": page = <RestoreStep {...nav} />; break;
    case "datetime": page = <DateTimeStep {...nav} />; break;
    case "accounts": page = <AccountsStep {...nav} />; break;
    case "passcode": page = <PasscodeStep {...nav} />; break;
    case "privacy": page = <PrivacyStep {...nav} />; break;
    case "tutorial":
        page = (
            <StepPage testId="tutorial" title="Cards & Gestures" onNext={nav.onNext} onSkip={nav.onSkip} buttons={false}>
                <Tutorial tablet={wide} onDone={nav.onNext} onBack={nav.onBack!} />
            </StepPage>
        );
        break;
    case "done": page = <DoneStep onBack={() => go("tutorial")} onFinish={() => void finish()} rerun={!!params.rerun} />; break;
    }
    return (
        <div className={`fu-root${wide ? " wide" : ""}`}>
            <Progress step={step} />
            {page}
            <Dialog open={confirmSkip} title="Skip setup?" onClose={() => setConfirmSkip(false)} testId="skip-dialog"
                    message="You can set up Wi-Fi, accounts and a passcode later in Settings, and run setup again from Settings > Device Info.">
                <Button variant="affirmative" data-testid="skip-confirm" onClick={() => void finish()}>Skip Setup</Button>
                <Button variant="dark" onClick={() => setConfirmSkip(false)}>Continue Setup</Button>
            </Dialog>
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <FirstUse />
        </BackProvider>
    );
}
