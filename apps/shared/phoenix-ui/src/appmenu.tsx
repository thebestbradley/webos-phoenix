// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app menu: tapping the app's name at the top left of the status bar
// opens it, as in every webOS app (enyo.AppMenu; LunaSysMgr relaunched the
// app with {"palm-command": "open-app-menu"}). The runtime turns that into
// a "phoenixAppMenu" document event (see __phoenixRuntime.openAppMenu).

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./layout";

export interface AppMenuItem {
    label: ReactNode;
    onSelect: () => void;
    disabled?: boolean;
}

export interface AppMenuProps {
    items: AppMenuItem[];
}

/** Toggles when the user taps the app name in the status bar. */
export function useAppMenuToggle(): [boolean, (open: boolean) => void] {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const toggle = () => setOpen((o) => !o);
        document.addEventListener("phoenixAppMenu", toggle);
        return () => document.removeEventListener("phoenixAppMenu", toggle);
    }, []);
    return [open, setOpen];
}

/** The app menu, dropping from the top left (Onyx AppMenu.css). Tap outside to close. */
export function AppMenu({ items }: AppMenuProps) {
    const [open, setOpen] = useAppMenuToggle();
    if (!open || items.length === 0) return null;
    return createPortal(
        <>
            <div className="pui-popup-scrim" onClick={() => setOpen(false)} />
            <div className="pui-appmenu" role="menu">
                <div className="pui-appmenu-inner">
                    {items.map((item, i) => (
                        <div
                            key={i}
                            role="menuitem"
                            aria-disabled={item.disabled || undefined}
                            className={cx("pui-appmenu-item", i === items.length - 1 && "last", item.disabled && "disabled")}
                            onClick={() => {
                                if (item.disabled) return;
                                setOpen(false);
                                item.onSelect();
                            }}
                        >
                            {item.label}
                        </div>
                    ))}
                </div>
            </div>
        </>,
        document.body,
    );
}
