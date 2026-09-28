// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Back gesture handling (the same as apps/settings/src/nav.tsx). The shell
// delivers "back" as an Escape key press (runtime/phoenix-runtime.js
// runtime.back, the Mojo/Enyo convention);
// the innermost open view registers a handler and gets it first. Dialogs
// and popups handle Escape themselves in the capture phase.

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

type Handler = () => boolean;

const Ctx = createContext<{ push(h: { current: Handler }): () => void } | null>(null);

export function BackProvider({ children }: { children: ReactNode }) {
    const stack = useRef<{ current: Handler }[]>([]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            for (let i = stack.current.length - 1; i >= 0; --i) {
                if (stack.current[i].current()) {
                    e.preventDefault();
                    return;
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    const api = {
        push(h: { current: Handler }) {
            stack.current.push(h);
            return () => { stack.current = stack.current.filter((x) => x !== h); };
        },
    };
    return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** While active, the back gesture calls handler (return true if handled). */
export function useBack(handler: Handler, active = true) {
    const ctx = useContext(Ctx);
    const ref = useRef(handler);
    ref.current = handler;
    useEffect(() => {
        if (!ctx || !active) return;
        return ctx.push(ref);
    }, [ctx, active]);
}
