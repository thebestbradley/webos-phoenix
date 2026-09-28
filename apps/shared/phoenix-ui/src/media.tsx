// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Pieces for the media apps (Camera, Photos, Music): the bottom command
// menu (Enyo Toolbar + ToolButton, palm-menu-button.png), grouped tool
// buttons (GroupedToolButton, grouped-toolbutton.png), the progress slider
// (ProgressSlider, progress-bar.png) and white glyphs for them.

import type { ReactNode } from "react";
import { cx } from "./layout";

// ---- Glyphs --------------------------------------------------------------------------

// White 32x32 glyphs drawn for Phoenix (Palm's menu icons were not
// open-sourced). SVG path data in a 32x32 box.
const GLYPHS: Record<string, ReactNode> = {
    camera: <path d="M11 8l-2 3H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h22a2 2 0 0 0 2-2V13a2 2 0 0 0-2-2h-4l-2-3zm5 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm0 2.6a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8z" />,
    video: <path d="M4 10a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm19 5l6-4v10l-6-4z" />,
    flash: <path d="M18 3L7 18h7l-2 11 11-16h-7z" />,
    share: <path d="M17 4l8 7-8 7v-4c-6 0-9.5 2-12 7 .8-7 4.5-11.5 12-12.5zM4 25h24v3H4z" />,
    trash: <path d="M12 4h8l1 2h6v3H5V6h6zM7 11h18l-1.6 16.2A2 2 0 0 1 21.4 29H10.6a2 2 0 0 1-2-1.8zm5 3v11h2V14zm6 0v11h2V14z" />,
    wallpaper: <path d="M6 4h20a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm1 3v14l6-7 5 5 3-3 4 4V7zm16 2.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />,
    play: <path d="M9 5l18 11L9 27z" />,
    pause: <path d="M8 5h6v22H8zm10 0h6v22h-6z" />,
    next: <path d="M5 6l12 10L5 26zm12 0l10 10-10 10zM26 6h3v20h-3z" transform="translate(-1 0)" />,
    prev: <path d="M27 6L15 16l12 10zM15 6L5 16l10 10zM3 6h3v20H3z" transform="translate(1 0)" />,
    shuffle: <path d="M3 9h5c3 0 5 1.5 7 4.5l2 3c1.5 2.3 3 3.5 5 3.5h2v-3l5 4.5-5 4.5v-3h-2c-3 0-5-1.5-7-4.5l-2-3C11.5 13.2 10 12 8 12H3zm0 11h5c1.3 0 2.3-.5 3.2-1.4l1.8 2.7C11.6 22.4 10 23 8 23H3zM24 9V6l5 4.5-5 4.5v-3h-2c-1.3 0-2.3.5-3.2 1.4L17 10.7C18.4 9.6 20 9 22 9z" />,
    repeat: <path d="M7 12a3 3 0 0 1 3-3h13V5l5 5.5-5 5.5v-4H10v5H7zm18 8a3 3 0 0 1-3 3H9v4l-5-5.5L9 16v4h13v-5h3z" />,
    volume: <path d="M4 12h5l7-6v20l-7-6H4zm15.5-1.8a8 8 0 0 1 0 11.6l-2-2a5.2 5.2 0 0 0 0-7.6zm3.5-3.5a13 13 0 0 1 0 18.6l-2-2a10.2 10.2 0 0 0 0-14.6z" />,
    note: <path d="M24 4v17a4 4 0 1 1-3-3.9V9l-9 2v12a4 4 0 1 1-3-3.9V7z" />,
    photos: <path d="M3 8h19a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zm1 3v10l5-5.5 4 4 2.5-2.5L21 22V11zM7 4h21a2 2 0 0 1 2 2v14h-3V7H7z" />,
    grid: <path d="M4 4h7v7H4zm8.5 0h7v7h-7zM21 4h7v7h-7zM4 12.5h7v7H4zm8.5 0h7v7h-7zm8.5 0h7v7h-7zM4 21h7v7H4zm8.5 0h7v7h-7zM21 21h7v7h-7z" />,
    list: <path d="M4 6h4v4H4zm7 0h17v4H11zM4 14h4v4H4zm7 0h17v4H11zM4 22h4v4H4zm7 0h17v4H11z" />,
    back: <path d="M13 6L3 16l10 10v-6.5h16v-7H13z" />,
    "switch-camera": <path d="M11 8l-2 3H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h22a2 2 0 0 0 2-2V13a2 2 0 0 0-2-2h-4l-2-3zm1.5 11a4 4 0 0 1 6.9-2.8L21 15v4.5h-4.5l1.4-1.4a2 2 0 0 0-3.4 1zm7 1a4 4 0 0 1-6.9 2.8L11 24.5V20h4.5l-1.4 1.4a2 2 0 0 0 3.4-1z" />,
    // File management (Files).
    star: <path d="M16 3l3.9 8.2 9 1.1-6.6 6.2 1.7 8.9L16 23l-8 4.4 1.7-8.9-6.6-6.2 9-1.1z" />,
    up: <path d="M16 4L5 15h7v13h8V15h7z" />,
    plus: <path d="M13 5h6v8h8v6h-8v8h-6v-8H5v-6h8z" />,
    "new-folder": <path fillRule="evenodd" d="M3 8a2 2 0 0 1 2-2h7l3 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm12 5v4h-4v3h4v4h3v-4h4v-3h-4v-4z" />,
    "new-file": <path fillRule="evenodd" d="M7 3h12l7 7v17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 11v4h-4v3h4v4h3v-4h4v-3h-4v-4z" />,
    copy: <path fillRule="evenodd" d="M11 3h12l5 5v15a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1 3v16h13V9h-4V6zM4 9h3v17h14v3H6a2 2 0 0 1-2-2z" />,
    cut: <path fillRule="evenodd" d="M9 19a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM23 19a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM9.5 3h3.2L18 14.6l-1.7 3.8zm13 0h-3.2l-8 17.6 2.6 1.3 4.4-9.6z" />,
    paste: <path fillRule="evenodd" d="M12 3h8v3h5a2 2 0 0 1 2 2v19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5zm2 2v3h4V5zM8 9v17h16V9h-3v2H11V9z" />,
    rename: <path d="M21.5 4.5l6 6L12 26l-8 2 2-8zM4 29h24v-1H4z" />,
    info: <path fillRule="evenodd" d="M16 3a13 13 0 1 1 0 26 13 13 0 0 1 0-26zm-2 11v10h4V14zm2-6.5a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z" />,
    menu: <path d="M5 7h22v4H5zm0 7h22v4H5zm0 7h22v4H5z" />,
    check: <path d="M4 17l3-3 6 6L25 8l3 3-15 15z" />,
    close: <path d="M7 4l9 9 9-9 3 3-9 9 9 9-3 3-9-9-9 9-3-3 9-9-9-9z" />,
    save: <path fillRule="evenodd" d="M6 4h17l5 5v17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 2v7h13V6zm9 1h3v5h-3zM8 18v8h16v-8z" />,
    sort: <path d="M9 4l6 7h-4v17H7V11H3zm14 24l-6-7h4V4h4v17h4z" />,
};

export type GlyphName = keyof typeof GLYPHS | string;

/** A white 32x32 glyph for tool buttons and overlays. */
export function Glyph({ name, size = 32, className }: { name: GlyphName; size?: number; className?: string }) {
    return (
        <svg className={cx("pui-glyph", className)} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
            {GLYPHS[name] ?? null}
        </svg>
    );
}

// ---- Toolbar and tool buttons -----------------------------------------------------------

export interface ToolbarProps {
    children: ReactNode;
    /** "fade": buttons over the content with the Heritage bottom fade (Mojo command menu). "dark": a solid dark bar. */
    kind?: "fade" | "dark";
    className?: string;
}

/** The command menu at the bottom of a card (Enyo Toolbar). Put ToolButtons and Spacers in it. */
export function Toolbar({ children, kind = "fade", className }: ToolbarProps) {
    return <div className={cx("pui-toolbar", kind, className)} role="toolbar">{children}</div>;
}

/** Flexible space between toolbar items. */
export function ToolSpacer() {
    return <span className="pui-tool-spacer" />;
}

export interface IconToolButtonProps {
    icon?: GlyphName;
    caption?: ReactNode;
    /** Accessible name (defaults to the caption). */
    label?: string;
    /** Held down (e.g. a toggle that is on). */
    depressed?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    testId?: string;
}

/** A round/pill command menu button (Enyo ToolButton, palm-menu-button.png). */
export function IconToolButton({ icon, caption, label, depressed, disabled, onClick, testId }: IconToolButtonProps) {
    return (
        <button type="button" className={cx("pui-icon-tool-button", depressed && "depressed", caption !== undefined && "captioned")}
                aria-label={label ?? (typeof caption === "string" ? caption : icon)} aria-pressed={depressed}
                disabled={disabled} data-testid={testId}
                onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
            {icon && <Glyph name={icon} />}
            {caption !== undefined && <span className="pui-tool-caption">{caption}</span>}
        </button>
    );
}

export interface GroupedToolButtonsProps<T> {
    options: { value: T; icon?: GlyphName; caption?: ReactNode; label?: string; testId?: string }[];
    value: T;
    onChange: (value: T) => void;
    className?: string;
}

/** Joined buttons, one of them held down (Enyo RadioToolButtonGroup, grouped-toolbutton.png). */
export function GroupedToolButtons<T>({ options, value, onChange, className }: GroupedToolButtonsProps<T>) {
    return (
        <div className={cx("pui-grouped", className)} role="radiogroup">
            {options.map((o, i) => (
                <button key={i} type="button" role="radio" aria-checked={o.value === value}
                        aria-label={o.label ?? (typeof o.caption === "string" ? o.caption : undefined)}
                        data-testid={o.testId}
                        className={cx("pui-grouped-button",
                            options.length === 1 ? "single" : i === 0 ? "first" : i === options.length - 1 ? "last" : "middle",
                            o.value === value && "depressed")}
                        onClick={(e) => { e.stopPropagation(); if (o.value !== value) onChange(o.value); }}>
                    {o.icon && <Glyph name={o.icon} size={28} />}
                    {o.caption !== undefined && <span className="pui-tool-caption">{o.caption}</span>}
                </button>
            ))}
        </div>
    );
}

/** "1:05" from seconds. */
export function formatSeconds(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(r).padStart(2, "0");
}
