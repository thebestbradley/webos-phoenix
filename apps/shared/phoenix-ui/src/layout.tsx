// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Page structure: PageHeader, Group, Row, Divider, Note.

import type { ReactNode } from "react";

function cx(...names: (string | false | null | undefined)[]): string {
    return names.filter(Boolean).join(" ");
}
export { cx };

export interface PageProps {
    children: ReactNode;
    /** Keep the content in a readable column on wide (tablet) cards. */
    narrow?: boolean;
    className?: string;
}

export function Page({ children, narrow = true, className }: PageProps) {
    return <div className={cx("pui-page", narrow && "narrow", className)}>{children}</div>;
}

export interface PageHeaderProps {
    title: ReactNode;
    /** URL of the 32px icon shown left of the title: a 64 px `name.png`
     *  with its 128 and 256 px sizes beside it (a Phoenix icon, which
     *  tools/render-app-icons.cjs draws at those sizes, or an original's
     *  that tools/upscale-app-icons.py enlarges), so dense screens get a
     *  larger one. */
    icon?: string;
    /** Extra content at the right (e.g. a toggle). */
    children?: ReactNode;
}

/** An app icon's sizes beside `name.png` (64 px), `name-<N>x<N>.png` (as
 *  tools/render-app-icons.cjs draws them), as an <img>'s srcset: the
 *  browser takes the smallest that covers the drawn size in device pixels
 *  (docs/spec/hidpi-art.md). */
export function iconSrcSet(icon: string): string | undefined {
    const m = /^(.*)\.png$/.exec(icon);
    return m ? [`${icon} 64w`, ...[128, 256].map((n) => `${m[1]}-${n}x${n}.png ${n}w`)].join(", ") : undefined;
}

/** The rounded grey page header of webOS 1.x/2.x apps (Enyo Heritage Header). */
export function PageHeader({ title, icon, children }: PageHeaderProps) {
    return (
        <header className="pui-header">
            <div className="pui-header-inner">
                {icon && <img className="pui-header-icon" src={icon} srcSet={iconSrcSet(icon)} sizes="32px" alt="" />}
                <div className="pui-header-title" role="heading" aria-level={1}>{title}</div>
                {children && <div className="pui-header-extra">{children}</div>}
            </div>
        </header>
    );
}

export interface GroupProps {
    /** Shown in the group's darker title band. */
    label?: ReactNode;
    children: ReactNode;
    className?: string;
}

/** A rounded box of rows (Enyo RowGroup / Mojo palm-group). */
export function Group({ label, children, className }: GroupProps) {
    return (
        <section className={cx("pui-group", label !== undefined && "labeled", className)}>
            {label !== undefined && <div className="pui-group-label">{label}</div>}
            <div className="pui-group-inner">{children}</div>
        </section>
    );
}

export interface RowProps {
    title?: ReactNode;
    subtitle?: ReactNode;
    /** Left icon. */
    icon?: ReactNode;
    /** Right-hand content: a toggle, a value, a spinner... */
    children?: ReactNode;
    /** Value text shown at the right in blue (list selectors). */
    value?: ReactNode;
    /** Show the small down arrow after the value (list selector). */
    arrow?: boolean;
    /** Show a ">" to say the row opens something. */
    chevron?: boolean;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    testId?: string;
}

/** One row of a group (Enyo Item). Tappable when it has onClick. */
export function Row({ title, subtitle, icon, children, value, arrow, chevron, onClick, disabled, className, testId }: RowProps) {
    return (
        <div
            className={cx("pui-row", onClick && "tappable", disabled && "disabled", className)}
            onClick={disabled ? undefined : onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick && !disabled ? 0 : undefined}
            aria-disabled={disabled || undefined}
            data-testid={testId}
            onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
        >
            {icon && <div className="pui-row-icon">{icon}</div>}
            {(title !== undefined || subtitle !== undefined) && (
                <div className="pui-row-body">
                    {title !== undefined && <div className="pui-row-title">{title}</div>}
                    {subtitle !== undefined && <div className="pui-row-subtitle">{subtitle}</div>}
                </div>
            )}
            {(children || value !== undefined || arrow || chevron) && (
                <div className="pui-row-end">
                    {value !== undefined && <span className="pui-row-value">{value}</span>}
                    {arrow && <span className="pui-row-arrow" />}
                    {children}
                    {chevron && <span className="pui-row-chevron" />}
                </div>
            )}
        </div>
    );
}

/** A labelled horizontal rule between sections (Enyo Divider). */
export function Divider({ caption }: { caption?: ReactNode }) {
    return (
        <div className="pui-divider" role="separator">
            {caption !== undefined ? (
                <>
                    <span className="pui-divider-cap-left" />
                    <span className="pui-divider-caption">{caption}</span>
                    <span className="pui-divider-cap-right" />
                </>
            ) : (
                <span className="pui-divider-line" style={{ flex: 1 }} />
            )}
        </div>
    );
}

/** Small grey explanatory text. */
export function Note({ children, testId }: { children: ReactNode; testId?: string }) {
    return <div className="pui-note" data-testid={testId}>{children}</div>;
}

/** Red error text. */
export function ErrorText({ children, testId }: { children: ReactNode; testId?: string }) {
    return <div className="pui-error" role="alert" data-testid={testId}>{children}</div>;
}

/** The blue checkmark of a selected item. */
export function Checkmark() {
    return <span className="pui-check" aria-label="selected" />;
}
