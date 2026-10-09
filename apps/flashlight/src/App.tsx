// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Flashlight: one big button on a dark card. Palm never shipped one (the
// Pre's flash could only be lit by homebrew torch apps); this follows the
// dark, one-control style of the webOS 2.x Camera.
//
// - LED: the camera flash LED as a steady torch through
//   org.webosports.service.torch (LuneOS's torchd, see
//   @phoenix/luna torch.ts), with a brightness slider. Other apps (and the
//   shell, later) see the same state: the app subscribes to getStatus.
// - Screen: the whole card turns white, for devices without a flash LED
//   (the TouchPad, most tablets) or when the LED is too bright. Tap
//   anywhere, or Back, to turn it off.
// - While lit the screen does not time out (setWindowProperties
//   {blockScreenTimeout}, as Mojo/Enyo apps asked for it).
// - Closing the card turns the LED off, unless "Leave LED On When Closed"
//   is ticked in the app menu (LuneOS's Torch app does the same).
//
// Launch params: {on: true} turns the light on at once.

import { useCallback, useEffect, useRef, useState } from "react";
import { torch, type TorchStatus } from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { AppMenu, cx, GroupedToolButtons, Slider, Toolbar, ToolSpacer, useBack } from "@phoenix/ui";
import { effectiveMode, isLit, loadPrefs, savePrefs, snapBrightness, statusText, type Mode, type Prefs } from "./lib/light";

type PalmWindow = { PalmSystem?: { setWindowProperties?: (p: object) => void } };

function blockScreenTimeout(on: boolean) {
    try { (globalThis as PalmWindow).PalmSystem?.setWindowProperties?.({ blockScreenTimeout: on }); } catch { /* not in a card */ }
}

function PowerIcon() {
    return (
        <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
            <path d="M22 16.5a20 20 0 1 0 20 0" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
            <path d="M32 8v24" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        </svg>
    );
}

export function App() {
    const launch = useLaunchParams<{ on?: boolean }>();
    const status = useLuna<TorchStatus>((cb, err) => torch.watch(cb, err), []);
    const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
    const [screenOn, setScreenOn] = useState(false);
    const [error, setError] = useState("");
    const [brightness, setBrightness] = useState(prefs.brightness);
    // No torch service at all (a browser without the runtime): screen only.
    const t: TorchStatus | undefined = status.error && !status.value ? { available: false, on: false, brightness: 0 } : status.value;
    const mode = effectiveMode(prefs.mode, t);
    const lit = isLit(mode, t, screenOn);
    const prefsRef = useRef(prefs);
    prefsRef.current = prefs;
    const litRef = useRef(false);
    litRef.current = mode === "led" && lit;

    // The white screen fills the card: Back turns it off too, as a tap does.
    useBack(() => { setScreenOn(false); return true; }, mode === "screen" && screenOn);

    const setPrefs = (p: Partial<Prefs>) => setPrefsState((old) => { const n = { ...old, ...p }; savePrefs(n); return n; });

    const setLed = useCallback(async (on: boolean) => {
        setError("");
        try {
            await (on ? torch.setBrightness(prefsRef.current.brightness) : torch.set(false));
        } catch (e) {
            setError((e as { errorText?: string }).errorText ?? String(e));
        }
    }, []);

    const toggle = () => {
        if (mode === "led") void setLed(!lit);
        else setScreenOn(!screenOn);
    };

    const choose = (m: Mode) => {
        if (m === mode) return;
        // Switch the light over rather than leave the other one on.
        const wasLit = lit;
        if (mode === "led" && wasLit) void setLed(false);
        setScreenOn(m === "screen" && wasLit);
        setPrefs({ mode: m });
        if (m === "led" && wasLit) void setLed(true);
    };

    // {on: true}: light up at once, once the torch's status is known.
    const handled = useRef<object | null>(null);
    useEffect(() => {
        if (handled.current === launch || !launch.on || !t) return;
        handled.current = launch;
        if (mode === "led") { if (!t.on) void setLed(true); } else setScreenOn(true);
    }, [launch, t, mode, setLed]);

    useEffect(() => { blockScreenTimeout(lit); }, [lit]);

    // Closing the card turns the LED off (the request goes out synchronously).
    useEffect(() => {
        const off = () => { if (litRef.current && !prefsRef.current.keepOn) void torch.set(false).catch(() => {}); };
        window.addEventListener("pagehide", off);
        return () => window.removeEventListener("pagehide", off);
    }, []);

    const onBrightness = (v: number) => {
        const b = snapBrightness(v);
        setBrightness(b);
        setPrefs({ brightness: b });
        if (t?.on) void torch.setBrightness(b).catch(() => {});
    };

    const modes = [
        ...(t?.available !== false ? [{ value: "led" as Mode, caption: "LED", testId: "mode-led" }] : []),
        { value: "screen" as Mode, caption: "Screen", testId: "mode-screen" },
    ];

    return (
        <div className={cx("fl-app", lit && "lit", mode)} data-testid="flashlight">
            <AppMenu items={[{
                label: <span data-testid="menu-keep-on">{prefs.keepOn ? "✓ " : ""}Leave LED On When Closed</span>,
                onSelect: () => setPrefs({ keepOn: !prefs.keepOn }),
                disabled: mode !== "led",
            }]} />
            <div className="fl-stage">
                <button type="button" className={cx("fl-power", lit && "on")} aria-pressed={lit} data-testid="power"
                        aria-label={lit ? "Turn off" : "Turn on"} onClick={toggle} disabled={!t && !status.error}>
                    <span className="fl-power-face"><PowerIcon /></span>
                </button>
                <div className="fl-status" data-testid="status">{statusText(mode, t, screenOn)}</div>
                {error && <div className="fl-error" data-testid="error">{error}</div>}
                {mode === "led" && t?.available && (
                    <div className="fl-brightness" data-testid="brightness">
                        <span className="fl-brightness-icon small" aria-hidden="true" />
                        <Slider value={t.on ? t.brightness : brightness} min={5} max={100} step={5} label="Brightness"
                                testId="brightness-slider" onChangeComplete={onBrightness} onChange={(v) => setBrightness(snapBrightness(v))} />
                        <span className="fl-brightness-icon" aria-hidden="true" />
                    </div>
                )}
            </div>
            <Toolbar kind="dark" className="fl-toolbar">
                <ToolSpacer />
                <GroupedToolButtons options={modes} value={mode} onChange={choose} />
                <ToolSpacer />
            </Toolbar>
            {mode === "screen" && screenOn && (
                <div className="fl-screen" data-testid="screen-light" role="button" aria-label="Turn off" onClick={() => setScreenOn(false)} />
            )}
        </div>
    );
}
