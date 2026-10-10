// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/enact: the Phoenix service plugin for Enact apps, the
// recommended base for Phoenix apps (docs/APP-SDK.md).
//
//   - Luna through Enact's own LS2Request (@enact/webos), which the SDK
//     then uses for every call, so Enact's and Phoenix's requests share
//     one path (LS2Request finds OSE's WebOSServiceBridge or
//     PalmServiceBridge itself);
//   - @phoenix/react's hooks (useBack, useAppMenu, useShareReceiver, ...),
//     which work the same in Enact's React;
//   - the Phoenix design layer for Enact: PhoenixDecorator (the tokens and
//     fonts on the app's root), Agate colours in the Phoenix palette, and a
//     header in the classic look.
//
//     import {PhoenixDecorator, useBack, share} from '@phoenix/enact';
//     export default PhoenixDecorator(ThemeDecorator(App));

import LS2Request from "@enact/webos/LS2Request";
import { createElement, useEffect, type ComponentType, type ReactNode } from "react";
import { applyTheme, noTransport, setTransport, tokens, type LunaReply, type Transport } from "@phoenix/sdk";

export * from "@phoenix/react";

/** The part of Enact's LS2Request this uses. */
export interface Ls2RequestLike {
    send(options: {
        service: string; method: string; parameters?: object; subscribe?: boolean;
        onSuccess?: (r: LunaReply) => void; onFailure?: (r: LunaReply) => void;
    }): unknown;
    cancel(): void;
}

function split(uri: string): { service: string; method: string } {
    const m = /^((?:luna|palm):\/\/[^/]+)\/(.*)$/.exec(uri);
    return m ? { service: m[1], method: m[2] } : { service: uri, method: "" };
}

function hasBridge(): boolean {
    const g = globalThis as { PalmServiceBridge?: unknown; WebOSServiceBridge?: unknown };
    return typeof g.PalmServiceBridge === "function" || typeof g.WebOSServiceBridge === "function";
}

/** An SDK Transport over an LS2Request class (Enact's, or one a test passes). */
export function ls2Transport(Request: new () => Ls2RequestLike = LS2Request as unknown as new () => Ls2RequestLike): Transport {
    return {
        name: "ls2",
        send(uri, params, onReply) {
            // Outside webOS LS2Request only logs "WebOSServiceBridge not
            // found."; the SDK's own "none" says what is missing, once.
            if (!hasBridge()) return noTransport.send(uri, params, onReply);
            const { subscribe, ...parameters } = params;
            const req = new Request();
            req.send({ ...split(uri), parameters, subscribe: !!subscribe, onSuccess: onReply, onFailure: onReply });
            return () => req.cancel();
        },
    };
}

/** Make Enact's LS2Request the SDK's transport (PhoenixDecorator does). */
export function installEnactTransport(): void {
    setTransport(ls2Transport());
}

// ---- The design layer -----------------------------------------------------------------------

/**
 * Agate's ThemeDecorator colours in the Phoenix palette: pass them as the
 * app's accent and highlight (`<App {...phoenixAgate} />`), with Agate's
 * light "carbon" skin.
 */
export const phoenixAgate = { skin: "carbon", accent: tokens.color.accent, highlight: "#2d6c94" } as const;

/** The CSS custom properties Limestone and Agate read for their fonts, set to Phoenix's (Prelude, then Open Sans). */
export function enactFontCss(): string {
    return `.phx-enact, .phx-enact * { font-family: var(--phx-font-family) !important; }`;
}

/**
 * The Phoenix design layer and transport for an Enact app's root: Enact's
 * LS2Request under the SDK, the tokens (--phx-*) and the classic fonts.
 * Wrap the app (usually outside Enact's ThemeDecorator).
 *
 * `fonts: false` keeps the theme's own fonts (Limestone's Museo Sans).
 */
export function PhoenixDecorator<P extends object>(Wrapped: ComponentType<P>, options: { fonts?: boolean } = {}): ComponentType<P> {
    installEnactTransport();
    function Phoenix(props: P) {
        useEffect(() => {
            applyTheme({ body: false });
            if (options.fonts !== false && typeof document !== "undefined") {
                let style = document.getElementById("phoenix-enact-fonts");
                if (!style) {
                    style = document.createElement("style");
                    style.id = "phoenix-enact-fonts";
                    style.textContent = enactFontCss();
                    document.head.appendChild(style);
                }
                document.documentElement.classList.add("phx-enact");
            }
        }, []);
        return createElement(Wrapped, props);
    }
    Phoenix.displayName = `PhoenixDecorator(${Wrapped.displayName ?? Wrapped.name ?? "App"})`;
    return Phoenix;
}

export interface PhoenixHeaderProps {
    title: ReactNode;
    /** The app's icon (32 px). */
    icon?: string;
    /** On the right (a button). */
    children?: ReactNode;
}

/** A page header in the classic look (Enyo's palm-page-header): icon, title, then children. */
export function PhoenixHeader({ title, icon, children }: PhoenixHeaderProps) {
    return createElement("header", { className: "phx-header" },
        icon ? createElement("img", { src: icon, alt: "" }) : null,
        createElement("span", { style: { flex: 1 } }, title),
        children);
}

export { tokens };
