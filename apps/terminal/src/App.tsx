// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Terminal: a shell on the device, one session per card (docs/TERMINAL.md).
// xterm.js draws it; the shell runs in a PTY owned by org.webosphoenix.pty
// (services/pty on a device, phoenix-sim's SimPty on the desktop). Below the
// terminal, above the keyboard, the extras row: Esc, sticky Ctrl and Alt,
// Tab, the arrows and the characters a phone keyboard hides.
//
//   App menu (tap the app name in the status bar): New Session, Copy,
//     Paste, Select All, Clear, Preferences (shell, text size, colour
//     scheme, extra keys), Keys Help, Close Session
//   Long press on the text: selects a word, drag to select more, then Copy,
//     Paste, Select All, Open Link, Search the Web
//   Links in the output open in Web (mailto: in Email), through the
//     application manager's open
//   Back gesture: Esc to the shell (as WebOS Internals' Terminal did)
//   Hardware keyboard: Ctrl+Shift+T/W/C/V/K, Ctrl+=/-/0 (keys.ts)
//
// Services: org.webosphoenix.pty open / write / resize / ack / close /
// getShells (@phoenix/luna pty.ts); com.webos.applicationManager open.

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { call, latin1Bytes, pty, PTY_ERRORS, type LunaError, type PtySession, type ShellInfo, type ShellName } from "@phoenix/luna";
import {
    AppMenu, BackProvider, Button, cx, Dialog, ListSelector, Note, PopupMenu, Row, ToggleButton, useBack, type Option,
} from "@phoenix/ui";
import { copyText, pasteText } from "./clipboard";
import {
    afterKey, applyMods, EXTRA_PAGES, KEY_HELP, keySequence, linkAt, REPEAT_DELAY_MS, REPEAT_INTERVAL_MS, shortcutFor, tapModifier,
    wordAt, type ExtraKey, type ModState, type Shortcut,
} from "./keys";
import {
    fontPx, loadPrefs, PREFS_KEY, parsePrefs, savePrefs, SCHEMES, schemeOf, stepSize, TEXT_SIZES, type Prefs,
} from "./prefs";

const FONT = '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", Menlo, Consolas, monospace';
const SHELL_LABELS: Record<ShellName, string> = { bash: "bash", zsh: "zsh", fish: "fish", sh: "sh (POSIX)" };

let cardCount = 0;

function openLink(url: string) {
    void call("luna://com.webos.applicationManager/open", { target: url }).catch(() => {});
}

/** Another card in the Terminal's stack, with its own shell. */
function newSession() {
    window.open(location.pathname, `terminal-${Date.now()}-${++cardCount}`);
}

function describeExit(e: { exitCode: number; signal: number }): string {
    if (e.signal) return e.signal === 1 ? "hung up" : `ended by signal ${e.signal}`;
    return `exited with code ${e.exitCode}`;
}

// ---- The extras row -----------------------------------------------------------------------

interface ExtrasProps {
    ctrl: ModState;
    alt: ModState;
    onKey(key: ExtraKey): void;
}

function ExtraKeys({ ctrl, alt, onKey }: ExtrasProps) {
    const [page, setPage] = useState(0);
    const press = useRef<{ key: ExtraKey; x: number; timer?: ReturnType<typeof setTimeout>; repeating: boolean } | null>(null);

    const stop = () => {
        if (press.current?.timer) clearTimeout(press.current.timer);
        press.current = null;
    };
    useEffect(() => stop, []);

    const down = (key: ExtraKey, e: React.PointerEvent) => {
        // Keep the focus (and the keyboard) on the terminal.
        e.preventDefault();
        stop();
        const p: NonNullable<typeof press.current> = { key, x: e.clientX, repeating: false };
        press.current = p;
        if (key.repeat) {
            const again = () => {
                if (press.current !== p) return;
                p.repeating = true;
                onKey(key);
                p.timer = setTimeout(again, REPEAT_INTERVAL_MS);
            };
            p.timer = setTimeout(again, REPEAT_DELAY_MS);
        }
    };
    const up = (e: React.PointerEvent) => {
        const p = press.current;
        stop();
        if (!p) return;
        const dx = e.clientX - p.x;
        if (Math.abs(dx) > 30) {
            // A swipe along the row: the next or previous page.
            setPage((n) => (n + (dx < 0 ? 1 : EXTRA_PAGES.length - 1)) % EXTRA_PAGES.length);
            return;
        }
        if (!p.repeating) onKey(p.key);
    };

    const state = (k: ExtraKey) => (k.modifier === "ctrl" ? ctrl : k.modifier === "alt" ? alt : "off");
    return (
        <div className="term-extras" data-testid="extras" data-page={page} onPointerUp={up} onPointerCancel={stop}
             onPointerLeave={(e) => { if (press.current && e.buttons === 0) stop(); }}>
            <div className="term-extras-keys">
                {EXTRA_PAGES[page].map((k) => (
                    <button type="button" key={k.id} className={cx("term-key", k.modifier && "mod", state(k) !== "off" && state(k))}
                            data-testid={`key-${k.id}`} aria-label={k.title ?? k.label} aria-pressed={k.modifier ? state(k) !== "off" : undefined}
                            onPointerDown={(e) => down(k, e)} onContextMenu={(e) => e.preventDefault()}>
                        {k.label}
                    </button>
                ))}
            </div>
            <div className="term-extras-dots" aria-hidden="true">
                {EXTRA_PAGES.map((_, i) => (
                    <span key={i} className={cx("term-dot", i === page && "on")} data-testid={`extras-page-${i}`}
                          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onPointerUp={(e) => { e.stopPropagation(); stop(); setPage(i); }} />
                ))}
            </div>
        </div>
    );
}

// ---- Preferences and help -------------------------------------------------------------------

function PrefsDialog({ prefs, shells, mode, onChange, onClose }: {
    prefs: Prefs; shells: ShellInfo[]; mode?: string; onChange(p: Prefs): void; onClose(): void;
}) {
    const shellOptions: Option<ShellName>[] = (shells.length ? shells : (["bash", "zsh", "fish", "sh"] as ShellName[])
        .map((name) => ({ name, path: "", installed: true })))
        // The simulated shell stands in for all of them.
        .map((s) => ({ value: s.name, label: s.installed || mode === "simulated" ? SHELL_LABELS[s.name] : `${SHELL_LABELS[s.name]} (not installed)`,
                       disabled: !s.installed && mode !== "simulated" }));
    return (
        <Dialog open title="Preferences" onClose={onClose} testId="prefs-dialog">
            <div className="term-prefs">
                <ListSelector title="Shell" value={prefs.shell} options={shellOptions} testId="pref-shell"
                              onChange={(v) => onChange({ ...prefs, shell: v })} />
                <ListSelector title="Text Size" value={prefs.textSize} testId="pref-size"
                              options={TEXT_SIZES.map((s) => ({ value: s.value, label: s.label }))}
                              onChange={(v) => onChange({ ...prefs, textSize: v })} />
                <ListSelector title="Color Scheme" value={prefs.scheme} testId="pref-scheme"
                              options={SCHEMES.map((s) => ({ value: s.id, label: s.label }))}
                              onChange={(v) => onChange({ ...prefs, scheme: v })} />
                <Row title="Extra Keys">
                    <ToggleButton value={prefs.extraKeys} label="Extra keys" testId="pref-extras"
                                  onChange={(v) => onChange({ ...prefs, extraKeys: v })} />
                </Row>
            </div>
            <Note>
                New sessions use this shell.
            </Note>
            <div className="term-dialog-buttons">
                <Button onClick={onClose} data-testid="prefs-done">Done</Button>
            </div>
        </Dialog>
    );
}

function KeysHelp({ onClose }: { onClose(): void }) {
    return (
        <Dialog open title="Keys" onClose={onClose} testId="keys-help">
            <div className="term-help-scroll">
                <table className="term-help">
                    <tbody>
                        {KEY_HELP.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
                    </tbody>
                </table>
            </div>
            <Note>Drawn by xterm.js (MIT License; THIRD-PARTY-LICENSES.txt in the app).</Note>
            <div className="term-dialog-buttons">
                <Button onClick={onClose} data-testid="keys-done">Done</Button>
            </div>
        </Dialog>
    );
}

// ---- The terminal card ----------------------------------------------------------------------

type SelMenu = { x: number; y: number; link: string | null } | null;

function TerminalCard() {
    const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
    const [ctrl, setCtrl] = useState<ModState>("off");
    const [alt, setAlt] = useState<ModState>("off");
    const [sheet, setSheet] = useState<"prefs" | "keys" | null>(null);
    const [shells, setShells] = useState<{ list: ShellInfo[]; mode?: string }>({ list: [] });
    const [hasSel, setHasSel] = useState(false);
    const [selMenu, setSelMenu] = useState<SelMenu>(null);
    const [bell, setBell] = useState(false);
    const [exited, setExited] = useState(false);

    const hostRef = useRef<HTMLDivElement>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const term = useRef<Terminal | null>(null);
    const fit = useRef<FitAddon | null>(null);
    const session = useRef<PtySession | null>(null);
    const mods = useRef({ ctrl: "off" as ModState, alt: "off" as ModState, ctrlTap: 0, altTap: 0 });
    const prefsRef = useRef(prefs);
    prefsRef.current = prefs;

    const setMod = useCallback((which: "ctrl" | "alt", s: ModState) => {
        mods.current[which] = s;
        (which === "ctrl" ? setCtrl : setAlt)(s);
    }, []);
    const consumeMods = useCallback(() => {
        setMod("ctrl", afterKey(mods.current.ctrl));
        setMod("alt", afterKey(mods.current.alt));
    }, [setMod]);

    const send = useCallback((data: string) => { session.current?.write(data); }, []);

    // ---- The shell ------------------------------------------------------------------------
    const start = useCallback((shell?: ShellName) => {
        const t = term.current;
        if (!t) return;
        session.current?.close();
        setExited(false);
        const want = shell ?? prefsRef.current.shell;
        const s = pty.open({ cols: t.cols, rows: t.rows, shell: want }, {
            onOpen(info) {
                if (info.host)
                    t.write(`\x1b[2m[${info.shellPath || info.shell} on this computer (the host), not a device]\x1b[0m\r\n`);
            },
            onOutput(text, bytes, latin1) {
                t.write(latin1 ? latin1Bytes(text) : text, () => s.ack(bytes));
            },
            onExit(e) {
                t.write(`\r\n\x1b[2m[${s.info?.shell || "shell"} ${describeExit(e)}. Press Enter for a new session.]\x1b[0m\r\n`);
                setExited(true);
            },
            onError(e: LunaError) {
                if (e.errorCode === PTY_ERRORS.NO_SHELL && want !== "bash") {
                    t.write(`\x1b[33m${want} is not installed here; starting bash.\x1b[0m\r\n`);
                    start("bash");
                    return;
                }
                t.write(`\r\n\x1b[31m[Cannot start a shell: ${e.errorText}]\x1b[0m\r\n\x1b[2m[Press Enter to try again.]\x1b[0m\r\n`);
                setExited(true);
            },
        });
        session.current = s;
    }, []);

    // ---- Set up xterm.js once ----------------------------------------------------------------
    useEffect(() => {
        const host = hostRef.current!;
        const p = prefsRef.current;
        const t = new Terminal({
            fontFamily: FONT, fontSize: fontPx(p.textSize), theme: schemeOf(p.scheme).theme, cursorBlink: true,
            scrollback: 5000, allowProposedApi: false, macOptionIsMeta: true, rightClickSelectsWord: true,
        });
        const f = new FitAddon();
        t.loadAddon(f);
        t.loadAddon(new WebLinksAddon((_e, uri) => openLink(uri)));
        t.open(host);
        term.current = t;
        fit.current = f;
        try { f.fit(); } catch { /* not laid out yet */ }

        const subs = [
            t.onData((d) => {
                if (!session.current?.running) {
                    // After the shell ended: Enter starts a new one.
                    if (d === "\r") start();
                    return;
                }
                const m = mods.current;
                const out = applyMods(d, { ctrl: m.ctrl !== "off", alt: m.alt !== "off" });
                if (m.ctrl !== "off" || m.alt !== "off") consumeMods();
                send(out);
            }),
            t.onBinary((d) => send(d)),
            t.onResize(({ cols, rows }) => session.current?.resize(cols, rows)),
            t.onTitleChange((title) => { document.title = title || "Terminal"; }),
            t.onSelectionChange(() => setHasSel(t.hasSelection())),
            t.onBell(() => {
                setBell(true);
                setTimeout(() => setBell(false), 150);
                try { navigator.vibrate?.(40); } catch { /* none */ }
            }),
        ];
        t.attachCustomKeyEventHandler((e) => {
            const s = shortcutFor(e);
            if (!s) return true;
            e.preventDefault();
            runShortcut.current(s);
            return false;
        });

        const ro = new ResizeObserver(() => { try { f.fit(); } catch { /* hidden */ } });
        ro.observe(host);
        start();
        t.focus();
        return () => {
            ro.disconnect();
            subs.forEach((s) => s.dispose());
            session.current?.close();
            t.dispose();
            term.current = null;
        };
    }, [start, send, consumeMods]);

    // ---- Prefs: apply, keep, follow the other cards ----------------------------------------------
    useEffect(() => {
        const t = term.current;
        if (!t) return;
        t.options.fontSize = fontPx(prefs.textSize);
        t.options.theme = schemeOf(prefs.scheme).theme;
        try { fit.current?.fit(); } catch { /* hidden */ }
    }, [prefs.textSize, prefs.scheme, prefs.extraKeys]);
    useEffect(() => {
        const onStorage = (e: StorageEvent) => { if (e.key === PREFS_KEY) setPrefs(parsePrefs(e.newValue)); };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);
    const changePrefs = (p: Prefs) => { setPrefs(p); savePrefs(p); };
    useEffect(() => {
        if (sheet === "prefs")
            pty.shells().then((r) => setShells({ list: r.shells, mode: r.mode }), () => {});
    }, [sheet]);

    // ---- Copy, paste, shortcuts ----------------------------------------------------------------
    const copy = useCallback(() => {
        const t = term.current;
        if (t?.hasSelection()) void copyText(t.getSelection());
    }, []);
    const paste = useCallback(() => {
        void pasteText().then((text) => { if (text && session.current?.running) term.current?.paste(text); });
    }, []);
    const clear = useCallback(() => { term.current?.clear(); }, []);

    const runShortcut = useRef<(s: Shortcut) => void>(() => {});
    runShortcut.current = (s: Shortcut) => {
        switch (s) {
        case "newSession": newSession(); break;
        case "closeSession": window.close(); break;
        case "copy": copy(); break;
        case "paste": paste(); break;
        case "clear": clear(); break;
        case "biggerText": changePrefs({ ...prefsRef.current, textSize: stepSize(prefsRef.current.textSize, 1) }); break;
        case "smallerText": changePrefs({ ...prefsRef.current, textSize: stepSize(prefsRef.current.textSize, -1) }); break;
        case "resetText": changePrefs({ ...prefsRef.current, textSize: "medium" }); break;
        }
    };

    // ---- The extras row -----------------------------------------------------------------------
    const onExtraKey = useCallback((k: ExtraKey) => {
        const m = mods.current;
        const now = Date.now();
        if (k.modifier) {
            const tapKey = k.modifier === "ctrl" ? "ctrlTap" : "altTap";
            setMod(k.modifier, tapModifier(m[k.modifier], m[tapKey], now));
            m[tapKey] = now;
            return;
        }
        const t = term.current;
        if (!session.current?.running) {
            if (k.special === "esc") return;
        }
        const on = { ctrl: m.ctrl !== "off", alt: m.alt !== "off" };
        const out = k.special ? keySequence(k.special, on, !!t?.modes.applicationCursorKeysMode) : applyMods(k.text ?? "", on);
        consumeMods();
        send(out);
    }, [send, setMod, consumeMods]);

    // The back gesture: Esc for the shell. (With the terminal focused,
    // xterm.js has already sent it.)
    useBack(() => {
        if (!sheet && !selMenu) send("\x1b");
        return true;
    });

    // ---- Long press: select a word, drag for more -------------------------------------------------
    useEffect(() => {
        const host = hostRef.current!;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let origin: { x: number; y: number } | null = null;
        let anchor: { col: number; row: number } | null = null;

        const cellAt = (x: number, y: number) => {
            const t = term.current!;
            const screen = host.querySelector(".xterm-screen") as HTMLElement | null;
            const r = (screen ?? host).getBoundingClientRect();
            const col = Math.max(0, Math.min(t.cols - 1, Math.floor((x - r.left) / (r.width / t.cols))));
            const row = Math.max(0, Math.min(t.rows - 1, Math.floor((y - r.top) / (r.height / t.rows))));
            return { col, row: row + t.buffer.active.viewportY };
        };
        const lineText = (row: number) => term.current?.buffer.active.getLine(row)?.translateToString(false) ?? "";
        const selectRange = (a: { col: number; row: number }, b: { col: number; row: number }) => {
            const t = term.current!;
            const [s, e] = a.row < b.row || (a.row === b.row && a.col <= b.col) ? [a, b] : [b, a];
            t.select(s.col, s.row, (e.row - s.row) * t.cols + (e.col - s.col) + 1);
        };
        const cancel = () => { if (timer) clearTimeout(timer); timer = undefined; };

        const down = (e: PointerEvent) => {
            if (e.button !== 0) return;
            cancel();
            origin = { x: e.clientX, y: e.clientY };
            anchor = null;
            timer = setTimeout(() => {
                timer = undefined;
                const c = cellAt(origin!.x, origin!.y);
                const w = wordAt(lineText(c.row), c.col);
                anchor = w ? { col: w[0], row: c.row } : c;
                if (w) term.current?.select(w[0], c.row, w[1]);
                else selectRange(c, c);
            }, 500);
        };
        const move = (e: PointerEvent) => {
            if (timer && origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 8) cancel();
            if (anchor && e.buttons) selectRange(anchor, cellAt(e.clientX, e.clientY));
        };
        const up = (e: PointerEvent) => {
            cancel();
            if (!anchor) return;
            const c = cellAt(e.clientX, e.clientY);
            const link = linkAt(lineText(c.row), c.col);
            anchor = null;
            // The popup menu at the finger (after xterm.js's own mouseup).
            setTimeout(() => setSelMenu({ x: e.clientX, y: e.clientY, link }), 0);
        };
        const menu = (e: MouseEvent) => {
            e.preventDefault();
            const c = cellAt(e.clientX, e.clientY);
            setSelMenu({ x: e.clientX, y: e.clientY, link: linkAt(lineText(c.row), c.col) });
        };
        host.addEventListener("pointerdown", down, true);
        host.addEventListener("pointermove", move, true);
        host.addEventListener("pointerup", up, true);
        host.addEventListener("pointercancel", cancel, true);
        host.addEventListener("contextmenu", menu);
        return () => {
            cancel();
            host.removeEventListener("pointerdown", down, true);
            host.removeEventListener("pointermove", move, true);
            host.removeEventListener("pointerup", up, true);
            host.removeEventListener("pointercancel", cancel, true);
            host.removeEventListener("contextmenu", menu);
        };
    }, []);

    const selOptions: Option<string>[] = [
        { label: "Copy", value: "copy", disabled: !hasSel },
        { label: "Paste", value: "paste" },
        { label: "Select All", value: "all" },
        ...(selMenu?.link ? [{ label: "Open Link", value: "link" }] : []),
        ...(hasSel ? [{ label: "Search the Web", value: "search" }] : []),
    ];
    const onSelOption = (v: string) => {
        const t = term.current;
        if (v === "copy") copy();
        else if (v === "paste") paste();
        else if (v === "all") t?.selectAll();
        else if (v === "link" && selMenu?.link) openLink(selMenu.link);
        else if (v === "search" && t?.hasSelection())
            openLink("https://www.google.com/search?q=" + encodeURIComponent(t.getSelection().trim()));
        t?.focus();
    };

    const scheme = schemeOf(prefs.scheme);
    return (
        <div className={cx("term-app", bell && "bell")} style={{ background: scheme.theme.background }} data-scheme={scheme.id}
             data-exited={exited || undefined}>
            <div className="term-host" ref={hostRef} data-testid="terminal" />
            {prefs.extraKeys && <ExtraKeys ctrl={ctrl} alt={alt} onKey={onExtraKey} />}
            <div className="term-anchor" ref={anchorRef} style={selMenu ? { left: selMenu.x, top: selMenu.y } : undefined} />

            <AppMenu items={[
                { label: "New Session", onSelect: newSession },
                { label: "Copy", onSelect: copy, disabled: !hasSel },
                { label: "Paste", onSelect: paste },
                { label: "Select All", onSelect: () => term.current?.selectAll() },
                { label: "Clear", onSelect: clear },
                { label: "Preferences", onSelect: () => setSheet("prefs") },
                { label: "Keys Help", onSelect: () => setSheet("keys") },
                { label: "Close Session", onSelect: () => window.close() },
            ]} />
            {selMenu && (
                <PopupMenu options={selOptions} anchor={anchorRef.current} onSelect={onSelOption}
                           onClose={() => { setSelMenu(null); term.current?.focus(); }} />
            )}
            {sheet === "prefs" && (
                <PrefsDialog prefs={prefs} shells={shells.list} mode={shells.mode} onChange={changePrefs}
                             onClose={() => { setSheet(null); term.current?.focus(); }} />
            )}
            {sheet === "keys" && <KeysHelp onClose={() => { setSheet(null); term.current?.focus(); }} />}
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <TerminalCard />
        </BackProvider>
    );
}
