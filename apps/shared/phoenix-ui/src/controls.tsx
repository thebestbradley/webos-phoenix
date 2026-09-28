// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Controls: ToggleButton, Slider, Button, Spinner, TextField, CheckBox.

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./layout";

// ---- ToggleButton ---------------------------------------------------------------

export interface ToggleButtonProps {
    value: boolean;
    onChange: (value: boolean) => void;
    onLabel?: string;
    offLabel?: string;
    disabled?: boolean;
    /** Accessible name (the row title, usually). */
    label?: string;
    testId?: string;
}

/** The blue/grey ON/OFF switch (Enyo ToggleButton, Heritage art). */
export function ToggleButton({ value, onChange, onLabel = "On", offLabel = "Off", disabled, label, testId }: ToggleButtonProps) {
    return (
        <button
            type="button"
            className={cx("pui-toggle", value ? "on" : "off")}
            role="switch"
            aria-checked={value}
            aria-label={label}
            disabled={disabled}
            data-testid={testId}
            onClick={(e) => { e.stopPropagation(); onChange(!value); }}
        >
            <span className="pui-toggle-label">{value ? onLabel : offLabel}</span>
        </button>
    );
}

// ---- Slider ---------------------------------------------------------------------

export interface SliderProps {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    /** While dragging. */
    onChange?: (value: number) => void;
    /** When the finger lifts (or a key press). Save here. */
    onChangeComplete?: (value: number) => void;
    disabled?: boolean;
    label?: string;
    testId?: string;
    /** Progress look (Enyo ProgressSlider): a blue bar up to the knob, e.g. a seek bar. */
    progress?: boolean;
}

function clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
}

/** Horizontal slider with the blue ball knob (Enyo Slider, Heritage art). */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, onChangeComplete, disabled, label, testId, progress }: SliderProps) {
    const track = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<number | null>(null);
    const shown = drag ?? value;
    const frac = max > min ? (clamp(shown, min, max) - min) / (max - min) : 0;

    const valueAt = useCallback((clientX: number) => {
        const r = track.current!.getBoundingClientRect();
        const f = r.width > 0 ? clamp((clientX - r.left) / r.width, 0, 1) : 0;
        const raw = min + f * (max - min);
        return clamp(Math.round(raw / step) * step, min, max);
    }, [min, max, step]);

    const onPointerDown = (e: PointerEvent) => {
        if (disabled) return;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        const v = valueAt(e.clientX);
        setDrag(v);
        onChange?.(v);
    };
    const onPointerMove = (e: PointerEvent) => {
        if (drag === null) return;
        const v = valueAt(e.clientX);
        if (v !== drag) {
            setDrag(v);
            onChange?.(v);
        }
    };
    const onPointerUp = () => {
        if (drag === null) return;
        const v = drag;
        setDrag(null);
        onChangeComplete?.(v);
    };
    const onKeyDown = (e: KeyboardEvent) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
        if (!d) return;
        e.preventDefault();
        const v = clamp(value + d * Math.max(1, Math.round((max - min) / step / 20)), min, max);
        onChange?.(v);
        onChangeComplete?.(v);
    };

    return (
        <div
            className={cx("pui-slider", drag !== null && "dragging", disabled && "disabled", progress && "progress")}
            role="slider"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={Math.round(shown)}
            aria-label={label}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : 0}
            data-testid={testId}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
        >
            <div className="pui-slider-track" ref={track}>
                {progress
                    ? <div className="pui-slider-fill" style={{ width: `calc(${frac * 100}% + 12px)` }} />
                    : <div className="pui-slider-rest" style={{ left: `${frac * 100}%` }} />}
                <div className="pui-slider-knob" style={{ left: `${frac * 100}%` }} />
            </div>
        </div>
    );
}

// ---- Button -----------------------------------------------------------------------

export type ButtonVariant = "default" | "light" | "affirmative" | "negative" | "dark";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    /** Show a spinner (e.g. while connecting) and ignore taps. */
    busy?: boolean;
}

/** The 52px glossy webOS button (palm-button-*.png). */
export function Button({ variant = "default", busy, className, children, disabled, ...rest }: ButtonProps) {
    return (
        <button type="button" className={cx("pui-button", variant !== "default" && variant, className)}
                disabled={disabled || busy} {...rest}>
            {busy && <Spinner />}
            {children}
        </button>
    );
}

// ---- Spinner --------------------------------------------------------------------

/** The activity spinner (spinner.png / spinner-large.png). */
export function Spinner({ large, label = "Working" }: { large?: boolean; label?: string }) {
    return <span className={cx("pui-spinner", large && "large")} role="progressbar" aria-label={label} />;
}

// ---- TextField ------------------------------------------------------------------

export interface TextFieldProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit?: () => void;
    label?: ReactNode;
    placeholder?: string;
    type?: "text" | "password" | "number" | "tel";
    inputMode?: "text" | "numeric";
    autoFocus?: boolean;
    maxLength?: number;
    testId?: string;
}

/** A webOS text field (Enyo Input with the Heritage focus frame). */
export function TextField({ value, onChange, onSubmit, label, placeholder, type = "text", inputMode, autoFocus, maxLength, testId }: TextFieldProps) {
    const [focused, setFocused] = useState(false);
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (autoFocus) ref.current?.focus();
    }, [autoFocus]);
    return (
        <label style={{ display: "block" }}>
            {label && <div className="pui-field-label">{label}</div>}
            <div className={cx("pui-field", focused && "focused")}>
                <input
                    ref={ref}
                    value={value}
                    type={type}
                    inputMode={inputMode}
                    placeholder={placeholder}
                    maxLength={maxLength}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-testid={testId}
                    onChange={(e) => onChange(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(e) => { if (e.key === "Enter" && onSubmit) { e.preventDefault(); onSubmit(); } }}
                />
            </div>
        </label>
    );
}

// ---- CheckBox -------------------------------------------------------------------

export interface CheckBoxProps {
    checked: boolean;
    onChange?: (checked: boolean) => void;
    disabled?: boolean;
    /** Accessible name. */
    label?: string;
    testId?: string;
}

/** The Heritage check box (Enyo CheckBox, checkbox.png), e.g. for multi-select lists. */
export function CheckBox({ checked, onChange, disabled, label, testId }: CheckBoxProps) {
    return (
        <button
            type="button"
            className={cx("pui-checkbox", checked && "checked")}
            role="checkbox"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            data-testid={testId}
            onClick={(e) => { e.stopPropagation(); onChange?.(!checked); }}
        />
    );
}
