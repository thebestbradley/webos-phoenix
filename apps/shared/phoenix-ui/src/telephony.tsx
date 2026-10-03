// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phone and messaging parts of the kit: the webOS dial pad (Enyo 1.0
// lib/telephony/dialpad), the Heritage command-menu toolbar with grouped
// and round tool buttons, avatars and the incoming-call glyph.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cx } from "./layout";
import { art, srcSet } from "./assets";
import "./telephony.css";
import avatar1 from "../assets/contacts/generic-avatar-50x50.png";
import avatar2 from "../assets/contacts/generic-avatar-50x50@2x.png";
import avatar3 from "../assets/contacts/generic-avatar-50x50@3x.png";
import star1 from "../assets/contacts/favorites-star-blue.png";
import star2 from "../assets/contacts/favorites-star-blue@2x.png";
import star3 from "../assets/contacts/favorites-star-blue@3x.png";
import voicemail1 from "../assets/enyo/telephony/voicemail-key.png";
import voicemail2 from "../assets/enyo/telephony/voicemail-key@2x.png";
import voicemail3 from "../assets/enyo/telephony/voicemail-key@3x.png";
import incomingOn1 from "../assets/openwebos/screen-lock-incoming-call-on.png";
import incomingOn2 from "../assets/openwebos/screen-lock-incoming-call-on@2x.png";
import incomingOn3 from "../assets/openwebos/screen-lock-incoming-call-on@3x.png";
import incomingOff1 from "../assets/openwebos/screen-lock-incoming-call-off.png";
import incomingOff2 from "../assets/openwebos/screen-lock-incoming-call-off@2x.png";
import incomingOff3 from "../assets/openwebos/screen-lock-incoming-call-off@3x.png";

const avatarUrl = art(avatar1, avatar2, avatar3);
const voicemailUrl = art(voicemail1, voicemail2, voicemail3);

/** The phone's pictures (1x URLs; srcSet(url) gives their HiDPI variants). */
export const phoneArt = {
    avatar: avatarUrl,
    star: art(star1, star2, star3),
    voicemail: voicemailUrl,
    incomingOn: art(incomingOn1, incomingOn2, incomingOn3),
    incomingOff: art(incomingOff1, incomingOff2, incomingOff3),
};

// ---- Dial pad ------------------------------------------------------------------------

/** Keys of the dial pad, with the letters printed under them (Dialpad.js). */
export const DIALPAD_KEYS: readonly { key: string; letters: string; hold?: string }[] = [
    { key: "1", letters: "", hold: "voicemail" }, { key: "2", letters: "ABC" }, { key: "3", letters: "DEF" },
    { key: "4", letters: "GHI" }, { key: "5", letters: "JKL" }, { key: "6", letters: "MNO" },
    { key: "7", letters: "PQRS" }, { key: "8", letters: "TUV" }, { key: "9", letters: "WXYZ" },
    { key: "*", letters: "" }, { key: "0", letters: "+", hold: "+" }, { key: "#", letters: "" },
];

export interface DialpadProps {
    /** A key was tapped ("0".."9", "*", "#"). */
    onKey: (key: string) => void;
    /**
     * A key was held for half a second: "+" (on 0) or "voicemail" (on 1),
     * as on the webOS dial pad. The tap is not reported then.
     */
    onHold?: (what: string) => void;
    /** Hide the letters (in-call keypad). */
    lettersHidden?: boolean;
    /** Show the voicemail symbol on 1. */
    voicemailKey?: boolean;
    testId?: string;
}

/** The 3x4 webOS dial pad (Enyo telephony Dialpad: flexing rows; pin-grid.png's lines at 320 wide). */
export function Dialpad({ onKey, onHold, lettersHidden, voicemailKey = true, testId }: DialpadProps) {
    const [down, setDown] = useState<string | null>(null);
    const downKey = useRef<string | null>(null);
    const held = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const press = (k: { key: string; hold?: string }) => (e: ReactPointerEvent) => {
        e.preventDefault();
        setDown(k.key);
        downKey.current = k.key;
        held.current = false;
        if (timer.current) clearTimeout(timer.current);
        if (k.hold && onHold) {
            timer.current = setTimeout(() => {
                held.current = true;
                downKey.current = null;
                setDown(null);
                onHold(k.hold!);
            }, 500);
        }
    };
    const release = (k: { key: string }) => () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        const wasDown = downKey.current === k.key;
        downKey.current = null;
        setDown(null);
        if (wasDown && !held.current) onKey(k.key);
    };
    const cancel = () => {
        if (timer.current) clearTimeout(timer.current);
        downKey.current = null;
        setDown(null);
    };

    return (
        <div className="pui-dialpad" data-testid={testId} role="group" aria-label="Dial pad">
            {DIALPAD_KEYS.map((k, i) => (
                <button
                    key={k.key}
                    type="button"
                    className={cx("pui-dialpad-key", `col${i % 3}`, `row${Math.floor(i / 3)}`, down === k.key && "down")}
                    data-key={k.key}
                    aria-label={k.key}
                    onPointerDown={press(k)}
                    onPointerUp={release(k)}
                    onPointerLeave={cancel}
                    onPointerCancel={cancel}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onKey(k.key); } }}
                >
                    <span className="pui-dialpad-digit">{k.key}</span>
                    {!lettersHidden && (
                        <span className="pui-dialpad-letters">
                            {k.key === "1" && voicemailKey ? <img src={voicemailUrl} srcSet={srcSet(voicemailUrl)} alt="voicemail" /> : k.letters}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
}

export interface DialButtonProps {
    onClick: () => void;
    disabled?: boolean;
    label?: string;
    testId?: string;
}

/** The long dial button with the green handset (dial-button.png). */
export function DialButton({ onClick, disabled, label = "Call", testId }: DialButtonProps) {
    return (
        <button type="button" className="pui-dial-button" onClick={onClick} disabled={disabled}
                aria-label={label} data-testid={testId} />
    );
}

/** The dial pad's backspace key (dialpad-backspace.png). Hold to clear. */
export function BackspaceButton({ onClick, onHold, testId }: { onClick: () => void; onHold?: () => void; testId?: string }) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const held = useRef(false);
    return (
        <button type="button" className="pui-backspace" aria-label="Delete" data-testid={testId}
                onPointerDown={() => {
                    held.current = false;
                    if (onHold) timer.current = setTimeout(() => { held.current = true; onHold(); }, 600);
                }}
                onPointerUp={() => { if (timer.current) clearTimeout(timer.current); }}
                onPointerLeave={() => { if (timer.current) clearTimeout(timer.current); }}
                onClick={() => { if (!held.current) onClick(); }} />
    );
}

// ---- Toolbar ----------------------------------------------------------------------------

/**
 * The Heritage command menu: a transparent bar at the bottom of the card
 * (bottom-fade.png) holding floating tool buttons (Toolbar.css).
 */
export function ToolBar({ children, className, dark }: { children: ReactNode; className?: string; dark?: boolean }) {
    return <div className={cx("pui-toolbar", dark && "dark", className)}>{children}</div>;
}

export interface ToolOption<T extends string> {
    value: T;
    label: ReactNode;
    /** Accessible name when label is an icon. */
    title?: string;
    disabled?: boolean;
    badge?: ReactNode;
}

export interface RadioToolGroupProps<T extends string> {
    value: T;
    options: readonly ToolOption<T>[];
    onChange: (value: T) => void;
    testId?: string;
    className?: string;
}

/** A radio group of joined tool buttons (GroupedToolButton.css). The selected one looks pressed in. */
export function RadioToolGroup<T extends string>({ value, options, onChange, testId, className }: RadioToolGroupProps<T>) {
    return (
        <div className={cx("pui-toolgroup", className)} role="tablist" data-testid={testId}>
            {options.map((o, i) => {
                const pos = options.length === 1 ? "single" : i === 0 ? "first" : i === options.length - 1 ? "last" : "middle";
                return (
                    <button key={o.value} type="button" role="tab" aria-selected={o.value === value} title={o.title}
                            aria-label={o.title} disabled={o.disabled} data-value={o.value}
                            className={cx("pui-grouped-toolbutton", pos, o.value === value && "depressed")}
                            onClick={() => onChange(o.value)}>
                        {o.label}
                        {o.badge !== undefined && o.badge !== null && o.badge !== false && <span className="pui-tool-badge">{o.badge}</span>}
                    </button>
                );
            })}
        </div>
    );
}

export interface ToolButtonProps {
    children?: ReactNode;
    onClick: () => void;
    title: string;
    /** Pressed in (a toggle that is on). */
    depressed?: boolean;
    disabled?: boolean;
    testId?: string;
}

/** A round (or captioned) command-menu button (ToolButton.css, palm-menu-button.png). */
export function ToolButton({ children, onClick, title, depressed, disabled, testId }: ToolButtonProps) {
    return (
        <button type="button" className={cx("pui-tool-button", depressed && "depressed")} onClick={onClick}
                title={title} aria-label={title} aria-pressed={depressed} disabled={disabled} data-testid={testId}>
            {children}
        </button>
    );
}

// ---- Avatars ------------------------------------------------------------------------------

/** A contact picture in the webOS list frame; the generic avatar when there is none. */
export function Avatar({ src, size = 40, className }: { src?: string; size?: number; className?: string }) {
    return (
        <span className={cx("pui-avatar", className)} style={{ width: size, height: size }}>
            <img src={src || avatarUrl} srcSet={src ? undefined : srcSet(avatarUrl)} alt="" />
        </span>
    );
}
