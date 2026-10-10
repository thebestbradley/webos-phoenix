// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix design layer's tokens: the classic webOS look (Enyo 1.0's
// Heritage theme, as @phoenix/ui draws it: apps/shared/phoenix-ui/src/
// styles.css) as plain values, CSS custom properties and a stylesheet any
// framework can use. Enact's skin (@phoenix/enact), the React and Ionic
// bindings and the no-bundler build all read these.
//
// Fonts: Prelude, webOS's typeface, where the device has it (the Phoenix
// runtime aliases it); Open Sans otherwise (Apache-2.0, shipped with
// Phoenix: shell/assets/fonts/open-sans), then the system's sans-serif.

export interface PhoenixTokens {
    color: {
        /** Page background (Heritage theme.css body). */
        background: string;
        text: string;
        textDim: string;
        /** Field and picker labels (PickerButton.css). */
        label: string;
        /** Divider captions (Divider.css). */
        divider: string;
        /** The highlight of a selected row or a focused field. */
        accent: string;
        /** The app menu and popup menus: dark glass. */
        menu: string;
        menuText: string;
        menuDivider: string;
        menuPressed: string;
        /** The page header's band. */
        header: string;
        headerText: string;
        affirmative: string;
        negative: string;
    };
    font: {
        family: string;
        mono: string;
        /** Body text, px. */
        size: number;
        headerSize: number;
    };
    radius: {
        /** The app menu's lower corners, popups. */
        menu: number;
        /** Buttons (Enyo's palm-button art has round ends). */
        button: number;
        /** Grouped rows (Enyo's RowGroup). */
        group: number;
    };
    space: {
        gutter: number;
        row: number;
    };
    /** z-index of the app menu over the page. */
    zMenu: number;
}

export const tokens: PhoenixTokens = {
    color: {
        background: "#e4e4e2",
        text: "#282828",
        textDim: "#7a7a78",
        label: "#1f75bf",
        divider: "#2d6c94",
        accent: "#1f75bf",
        menu: "rgba(30, 30, 30, 0.92)",
        menuText: "#ffffff",
        menuDivider: "rgba(255, 255, 255, 0.14)",
        menuPressed: "rgba(255, 255, 255, 0.18)",
        header: "#d6d6d4",
        headerText: "#444444",
        affirmative: "#4c9a2a",
        negative: "#c0392b",
    },
    font: {
        family: 'Prelude, "Prelude Medium", "Helvetica Neue", Helvetica, "Open Sans", "DejaVu Sans", Arial, sans-serif',
        mono: '"DejaVu Sans Mono", Menlo, Consolas, monospace',
        size: 18,
        headerSize: 20,
    },
    radius: { menu: 12, button: 26, group: 10 },
    space: { gutter: 8, row: 52 },
    zMenu: 320,
};

/** The tokens as CSS custom properties (--phx-color-background, --phx-font-family, ...). */
export function cssVariables(t: PhoenixTokens = tokens): Record<string, string> {
    const out: Record<string, string> = {};
    const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    for (const [k, v] of Object.entries(t.color)) out[`--phx-color-${kebab(k)}`] = v;
    out["--phx-font-family"] = t.font.family;
    out["--phx-font-mono"] = t.font.mono;
    out["--phx-font-size"] = t.font.size + "px";
    out["--phx-font-header-size"] = t.font.headerSize + "px";
    for (const [k, v] of Object.entries(t.radius)) out[`--phx-radius-${k}`] = v + "px";
    for (const [k, v] of Object.entries(t.space)) out[`--phx-space-${k}`] = v + "px";
    return out;
}

/**
 * The design layer as a stylesheet: the variables on :root, the body's
 * font and colours (with `.phx-app` on the body or an app's root), a header
 * (`.phx-header`), grouped rows (`.phx-group`, `.phx-row`), buttons
 * (`.phx-button`, `.affirmative`, `.negative`) and the app menu's look.
 */
export function themeCss(t: PhoenixTokens = tokens): string {
    const vars = Object.entries(cssVariables(t)).map(([k, v]) => `${k}: ${v};`).join(" ");
    return `:root { ${vars} }
.phx-app { background: var(--phx-color-background); color: var(--phx-color-text); font-family: var(--phx-font-family); font-size: var(--phx-font-size); -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; }
.phx-header { display: flex; align-items: center; gap: 10px; min-height: 50px; padding: 13px 16px; background: linear-gradient(#ececea, var(--phx-color-header)); border-bottom: 1px solid rgba(0,0,0,0.12); color: var(--phx-color-header-text); font-size: var(--phx-font-header-size); font-weight: bold; }
.phx-header img { width: 32px; height: 32px; }
.phx-group { margin: 6px var(--phx-space-gutter); background: #fff; border-radius: var(--phx-radius-group); overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
.phx-group-title { margin: 14px calc(var(--phx-space-gutter) + 6px) 4px; color: var(--phx-color-divider); font-size: 14px; font-weight: bold; text-transform: uppercase; }
.phx-row { display: flex; align-items: center; min-height: var(--phx-space-row); padding: 0 14px; border-top: 1px solid rgba(0,0,0,0.08); }
.phx-row:first-child { border-top: 0; }
.phx-button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 20px; border: 1px solid rgba(0,0,0,0.25); border-radius: var(--phx-radius-button); background: linear-gradient(#fdfdfd, #d9d9d7); color: var(--phx-color-text); font: inherit; }
.phx-button:active { background: linear-gradient(#cfcfcd, #e9e9e7); }
.phx-button.affirmative { background: linear-gradient(#6cbf45, var(--phx-color-affirmative)); color: #fff; border-color: rgba(0,0,0,0.3); }
.phx-button.negative { background: linear-gradient(#df5a4b, var(--phx-color-negative)); color: #fff; border-color: rgba(0,0,0,0.3); }
.phx-appmenu-scrim { position: fixed; inset: 0; z-index: ${t.zMenu - 1}; }
.phx-appmenu { position: fixed; top: 0; left: 0; z-index: ${t.zMenu}; min-width: 210px; max-width: 100vw; padding: 4px 0 8px; background: var(--phx-color-menu); color: var(--phx-color-menu-text); border-radius: 0 0 var(--phx-radius-menu) var(--phx-radius-menu); box-shadow: 0 6px 18px rgba(0,0,0,0.45); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); font-family: var(--phx-font-family); font-size: 18px; -webkit-user-select: none; user-select: none; }
.phx-appmenu-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 18px; border-bottom: 1px solid var(--phx-color-menu-divider); cursor: default; outline: none; }
.phx-appmenu-item:last-child { border-bottom: 0; }
.phx-appmenu-item:active:not(.disabled), .phx-appmenu-item:focus-visible { background: var(--phx-color-menu-pressed); }
.phx-appmenu-item.disabled { opacity: 0.4; }
.phx-appmenu-item.sub { padding-left: 38px; }
.phx-appmenu-arrow { width: 0; height: 0; border: 6px solid transparent; border-top-color: currentColor; margin-top: 6px; opacity: 0.8; }
.phx-appmenu-arrow.open { transform: rotate(180deg); margin-top: -6px; }
`;
}

const STYLE_ID = "phoenix-sdk-theme";

/**
 * Put the design layer's stylesheet in the page (once), and the `phx-app`
 * class on the body unless `{body: false}`.
 */
export function applyTheme(options: { body?: boolean; tokens?: PhoenixTokens } = {}): void {
    if (typeof document === "undefined") return;
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        (document.head ?? document.documentElement).appendChild(style);
    }
    style.textContent = themeCss(options.tokens ?? tokens);
    if (options.body !== false) document.body?.classList.add("phx-app");
}
