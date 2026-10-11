// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Screen & Lock: brightness, screen timeout, rotation lock, wallpaper,
// notifications on the lock screen, secure unlock (PIN / password).
// Services:
//   com.webos.settingsservice get/setSystemSettings {category:"picture", backlight}
//   com.webos.service.systemservice get/setPreferences
//       screenTimeout, lockTimeout (Phoenix keys), rotationLock, wallpaper, showAlertsWhenLocked,
//       blinkNotifications, sysUiEnableNextPrevGestures (Advanced gestures)
//   com.palm.systemmanager getSystemStatus {gestureArea}: whether to offer them
//   com.palm.systemmanager getDeviceLockMode / setDevicePasscode (legacy webOS;
//       Phoenix will provide it on OSE)

import { useEffect, useState } from "react";
import { deviceLock, LunaError, settings, system, systemStatus, type LockMode, type SystemPreferences, type SystemStatus } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import {
    Button, Checkmark, Dialog, ErrorText, Group, ListSelector, Page, PageHeader, Row, Slider, TextField, ToggleButton,
} from "@phoenix/ui";
import { useBack } from "../nav";

const APP_DIR = "/usr/palm/applications/org.webosphoenix.settings/";

/** Bundled wallpapers: the drawn ones (tools/wallpapers/generate.py), then
 *  photographs under open licences (tools/wallpapers/photos.py; authors and
 *  licences in public/wallpapers/PROVENANCE.md and the licences page). A
 *  square master each, which the shell crops to the screen, and a 2:3
 *  thumbnail for the picker. The first is the default (the system service's
 *  default wallpaper preference, runtime/phoenix-runtime.js), shown too while
 *  none is set. */
export const WALLPAPERS: { name: string; file: string; thumb: string }[] = [
    "Northern Lights", "Phoenix", "Twilight", "Amber", "Garden", "Sea and Sky",
    "Dawn", "Silk", "Midnight", "Bloom", "Shallows", "Linen",
    "River Stones", "Clownfish", "Jellyfish", "Raindrops", "Dandelion", "Gerbera", "Wave", "Seashells",
].map((name) => {
    const slug = name.toLowerCase().replace(/ /g, "-");
    return { name, file: `wallpapers/${slug}.jpg`, thumb: `wallpapers/thumbs/${slug}.jpg` };
});

const TIMEOUTS = [
    { label: "30 seconds", value: 30 },
    { label: "1 minute", value: 60 },
    { label: "2 minutes", value: 120 },
    { label: "3 minutes", value: 180 },
    { label: "5 minutes", value: 300 },
];

// "Lock after": how long the device stays locked before the PIN or
// password is asked for, in the steps LunaSysMgr rounds to
// (Preferences::roundLockTimeout).
const LOCK_AFTER = [
    { label: "Screen turns off", value: 0 },
    { label: "30 seconds", value: 30 },
    { label: "1 minute", value: 60 },
    { label: "2 minutes", value: 120 },
    { label: "3 minutes", value: 180 },
    { label: "5 minutes", value: 300 },
    { label: "10 minutes", value: 600 },
    { label: "30 minutes", value: 1800 },
];

const PREF_KEYS: (keyof SystemPreferences)[] = ["screenTimeout", "lockTimeout", "rotationLock", "wallpaper", "showAlertsWhenLocked", "lockScreenPreviews",
    "blinkNotifications",
    "sysUiEnableNextPrevGestures"];

export function ScreenPage() {
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(PREF_KEYS, cb, err), []).value ?? {};
    // Advanced gestures need a gesture area (the TouchPad's Screen & Lock had none).
    const gestureArea = useLuna<SystemStatus>((cb, err) => systemStatus.watch(cb, err), []).value?.gestureArea === true;
    const backlight = useLuna<number | undefined>(
        (cb, err) => settings.watch("picture", ["backlight"], (s) => cb(s.backlight), err), []).value;
    const [dragging, setDragging] = useState<number | null>(null);
    const [lockMode, setLockMode] = useState<LockMode | null>(null);
    const [lockFlow, setLockFlow] = useState<LockMode | null>(null);
    const [picking, setPicking] = useState(false);

    useEffect(() => {
        deviceLock.mode().then(setLockMode).catch(() => setLockMode("none"));
    }, []);
    useBack(() => { setPicking(false); return true; }, picking);

    const setPref = (p: SystemPreferences) => void system.setPreferences(p);
    // Another picture (one Photos set): no tile is checked.
    const file = prefs.wallpaper?.wallpaperFile;
    const wallpaper = file ? WALLPAPERS.find((w) => file === APP_DIR + w.file) ?? null : WALLPAPERS[0];

    if (picking) {
        return (
            <Page>
                <PageHeader title="Wallpaper" icon="icons/screen.png" />
                <div className="wallpaper-grid">
                    {WALLPAPERS.map((w) => (
                        <button key={w.name} type="button" className={"wallpaper-tile" + (w === wallpaper ? " selected" : "")}
                                data-testid={`wallpaper-${w.name}`}
                                onClick={() => {
                                    setPref({ wallpaper: { wallpaperName: w.name, wallpaperFile: APP_DIR + w.file } });
                                    setPicking(false);
                                }}>
                            <span className="wallpaper-thumb" style={{ backgroundImage: `url(${w.thumb})` }} />
                            <span className="wallpaper-name">{w.name}</span>
                            {w === wallpaper && <Checkmark />}
                        </button>
                    ))}
                </div>
            </Page>
        );
    }

    return (
        <Page>
            <PageHeader title="Screen & Lock" icon="icons/screen.png" />

            <Group label="Brightness">
                <div className="pui-slider-row">
                    <span className="pui-slider-end brightness-less" />
                    <Slider value={dragging ?? backlight ?? 70} min={5} max={100} label="Brightness" testId="brightness"
                            disabled={backlight === undefined}
                            onChange={(v) => { setDragging(v); void settings.set("picture", { backlight: v }); }}
                            onChangeComplete={(v) => { setDragging(null); void settings.set("picture", { backlight: v }); }} />
                    <span className="pui-slider-end brightness-more" />
                </div>
            </Group>

            <Group label="Screen">
                <ListSelector title="Turn off after" value={prefs.screenTimeout ?? 60} options={TIMEOUTS}
                              onChange={(v) => setPref({ screenTimeout: v })} testId="timeout" />
                <Row title="Rotation lock">
                    <ToggleButton value={!!prefs.rotationLock} label="Rotation lock" onChange={(v) => setPref({ rotationLock: v })} />
                </Row>
            </Group>

            {gestureArea && (
                <Group label="Gestures">
                    <Row title="Advanced gestures" subtitle="Swipe across to switch apps" testId="advanced-gestures">
                        <ToggleButton value={prefs.sysUiEnableNextPrevGestures !== false} label="Advanced gestures"
                                      onChange={(v) => setPref({ sysUiEnableNextPrevGestures: v })} />
                    </Row>
                </Group>
            )}

            <Group label="Wallpaper">
                <Row title={wallpaper ? wallpaper.name : prefs.wallpaper?.wallpaperName || "Picture"} chevron
                     onClick={() => setPicking(true)} testId="wallpaper"
                     icon={<span className="wallpaper-mini"
                                 style={wallpaper ? { backgroundImage: `url(${wallpaper.thumb})` } : undefined} />} />
            </Group>

            <Group label="Notifications">
                <Row title="Show when locked">
                    <ToggleButton value={prefs.showAlertsWhenLocked !== false} label="Show notifications when locked"
                                  onChange={(v) => setPref({ showAlertsWhenLocked: v })} />
                </Row>
                <Row title="Show previews" subtitle={'Off, the lock screen says only "New Message"'} testId="lock-previews"
                     disabled={prefs.showAlertsWhenLocked === false}>
                    <ToggleButton value={prefs.lockScreenPreviews !== false} label="Show previews when locked"
                                  disabled={prefs.showAlertsWhenLocked === false} testId="lock-previews-toggle"
                                  onChange={(v) => setPref({ lockScreenPreviews: v })} />
                </Row>
                <Row title="Blink notifications">
                    <ToggleButton value={prefs.blinkNotifications !== false} label="Blink notifications"
                                  onChange={(v) => setPref({ blinkNotifications: v })} />
                </Row>
            </Group>

            <Group label="Secure unlock">
                <ListSelector<LockMode> title="Unlock with" value={lockMode ?? "none"} disabled={lockMode === null} testId="lock-mode"
                              options={[{ label: "Off", value: "none" }, { label: "Simple PIN", value: "pin" }, { label: "Password", value: "password" }]}
                              onChange={(m) => setLockFlow(m)} />
                {lockMode && lockMode !== "none" && (
                    <>
                        <ListSelector title="Lock after" value={prefs.lockTimeout ?? 0} options={LOCK_AFTER}
                                      onChange={(v) => setPref({ lockTimeout: v })} testId="lock-after" />
                        <Row title={lockMode === "pin" ? "Change PIN" : "Change password"} chevron onClick={() => setLockFlow(lockMode)} />
                    </>
                )}
            </Group>

            <PasscodeDialog
                target={lockFlow}
                current={lockMode ?? "none"}
                onDone={(m) => { if (m) setLockMode(m); setLockFlow(null); }}
            />
        </Page>
    );
}

type Step = "current" | "enter" | "confirm";

/**
 * Setting, changing or turning off the PIN / password: enter the current
 * code (if there is one), then the new one twice.
 */
function PasscodeDialog({ target, current, onDone }: { target: LockMode | null; current: LockMode; onDone: (m: LockMode | null) => void }) {
    const [step, setStep] = useState<Step>("enter");
    const [old, setOld] = useState("");
    const [first, setFirst] = useState("");
    const [code, setCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [shownFor, setShownFor] = useState<LockMode | null>(null);
    if (target !== shownFor) {
        setShownFor(target);
        setStep(current !== "none" ? "current" : "enter");
        setOld(""); setFirst(""); setCode(""); setError(null);
    }
    if (!target) return null;

    const oldKind = current === "pin" ? "PIN" : "password";
    const kind = target === "pin" ? "PIN" : "password";
    const isPin = (step === "current" ? current : target) === "pin";

    async function next() {
        setError(null);
        if (step === "current") {
            const okCode = await deviceLock.matches(code).catch(() => false);
            if (!okCode) {
                setError(`That ${oldKind} is not correct.`);
                setCode("");
                return;
            }
            setOld(code);
            setCode("");
            if (target === "none") {
                await deviceLock.set("none", undefined, code);
                onDone("none");
            } else {
                setStep("enter");
            }
            return;
        }
        if (step === "enter") {
            if (target === "pin" && !/^\d{4,}$/.test(code)) {
                setError("A PIN needs at least 4 digits.");
                return;
            }
            if (target === "password" && code.length < 4) {
                setError("Passwords need at least 4 characters.");
                return;
            }
            setFirst(code);
            setCode("");
            setStep("confirm");
            return;
        }
        if (code !== first) {
            setError(`The ${kind}s do not match. Try again.`);
            setCode("");
            setFirst("");
            setStep("enter");
            return;
        }
        try {
            await deviceLock.set(target!, code, old || undefined);
            onDone(target);
        } catch (e) {
            setError(e instanceof LunaError ? e.errorText : String(e));
        }
    }

    const title = step === "current" ? `Enter current ${oldKind}`
        : step === "enter" ? `Enter new ${kind}` : `Confirm ${kind}`;
    return (
        <Dialog open title={title} onClose={() => onDone(null)} testId="passcode">
            <TextField type="password" inputMode={isPin ? "numeric" : "text"} value={code} autoFocus key={step}
                       onChange={(v) => setCode(isPin ? v.replace(/\D/g, "") : v)} onSubmit={next} maxLength={isPin ? 8 : 64}
                       placeholder={isPin ? "PIN" : "Password"} testId="passcode-field" />
            {error && <ErrorText>{error}</ErrorText>}
            <Button variant="affirmative" disabled={code.length === 0} onClick={next} data-testid="passcode-next">
                {step === "confirm" || (step === "current" && target === "none") ? "Done" : "Next"}
            </Button>
            <Button variant="dark" onClick={() => onDone(null)}>Cancel</Button>
        </Dialog>
    );
}
