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

// The file itself: this package is an ES module, so webpack (Enact's CLI)
// resolves its imports fully specified, and @enact/webos/LS2Request is a
// folder with a package.json of its own.
import LS2RequestModule from "@enact/webos/LS2Request/LS2Request.js";

// It is CommonJS (exports.default): from an ES module, webpack gives the
// whole exports object as the default import (Node's rule), Vite the class.
const LS2Request = ((LS2RequestModule as unknown as { default?: unknown }).default ?? LS2RequestModule) as unknown as new () => Ls2RequestLike;
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

/** The theme's text in Phoenix's fonts (Prelude, then Open Sans), over the theme's own, while the root has `phx-enact`. */
export function enactFontCss(): string {
    // Not the icons: Enact draws them with an icon font (classes Icon_icon__...).
    return `.phx-enact, .phx-enact *:not([class*="icon" i]) { font-family: var(--phx-font-family) !important; }`;
}

/** Phoenix's fonts on (or off) for the whole page (PhoenixDecorator turns them on unless told not to). */
export function setPhoenixFonts(on: boolean): void {
    if (typeof document === "undefined") return;
    if (on && !document.getElementById("phoenix-enact-fonts")) {
        const style = document.createElement("style");
        style.id = "phoenix-enact-fonts";
        style.textContent = enactFontCss();
        document.head.appendChild(style);
    }
    document.documentElement.classList.toggle("phx-enact", on);
}

/**
 * The Phoenix design layer and transport for an Enact app's root: Enact's
 * LS2Request under the SDK, the tokens (--phx-*) and the classic fonts.
 * Wrap the app (usually outside Enact's ThemeDecorator).
 *
 * `fonts: false` keeps the theme's own fonts (Limestone's Museo Sans);
 * setPhoenixFonts() switches them later (a skin the user picks).
 */
export function PhoenixDecorator<P extends object>(Wrapped: ComponentType<P>, options: { fonts?: boolean } = {}): ComponentType<P> {
    installEnactTransport();
    function Phoenix(props: P) {
        useEffect(() => {
            applyTheme({ body: false });
            if (options.fonts !== false) setPhoenixFonts(true);
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
