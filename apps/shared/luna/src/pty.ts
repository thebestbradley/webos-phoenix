// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.pty, the Terminal's shells (docs/TERMINAL.md). On a
// device it is the C++ Luna service in services/pty, running as the
// unprivileged device user; in phoenix-sim a real shell on your computer
// (shell/sim/simpty.cpp); in a browser through tools/serve-rootfs.py
// --terminal, or else the runtime's small simulated shell (block
// "Terminal" in runtime/phoenix-runtime.js). All speak this protocol:
//
//   open {cols, rows, shell?, cwd?, subscribe: true}
//        -> {subscribed: true, sessionId, pid, shell, shellPath, host?, simulated?}
//        -> {sessionId, output, encoding?: "latin1", bytes}   as the shell writes
//        -> {sessionId, exited: true, exitCode, signal}        then nothing more
//   write {sessionId, data}; resize {sessionId, cols, rows};
//   ack {sessionId, bytes} (flow control: the page drew this much);
//   close {sessionId, signal?}; list {}; getShells {}; exec (Developer Mode, later)
//
// Only org.webosphoenix.terminal may open a shell.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://org.webosphoenix.pty";

/** errorCode values of org.webosphoenix.pty (services/pty/src/ptycore.h). */
export const PTY_ERRORS = {
    BAD_PARAMS: -1,
    /** Only the Terminal app may open a shell. */
    NOT_ALLOWED: 1,
    /** No such session, or not the caller's. */
    NO_SESSION: 2,
    SPAWN_FAILED: 3,
    /** That shell is not installed. */
    NO_SHELL: 4,
    TOO_MANY: 5,
    /** exec, sudo and SSH need Developer Mode (not built yet). */
    DEVMODE_REQUIRED: 6,
} as const;

export type ShellName = "bash" | "zsh" | "fish" | "sh";
export const DEFAULT_SHELL: ShellName = "bash";

export interface ShellInfo {
    name: ShellName;
    path: string;
    installed: boolean;
}

export interface ShellList {
    shells: ShellInfo[];
    default: ShellName;
    /** Where shells come from: the device service (undefined), "host" (phoenix-sim), "websocket" (dev server) or "simulated". */
    mode?: "host" | "websocket" | "simulated";
}

export interface PtyOpened {
    sessionId: string;
    pid: number;
    /** The shell's name as asked for ("bash"), or "fsh" for the simulated one. */
    shell: string;
    shellPath: string;
    /** A real shell on the computer running the simulator. */
    host?: boolean;
    /** The runtime's simulated shell. */
    simulated?: boolean;
}

export interface PtyExit {
    exitCode: number;
    signal: number;
}

export interface PtyHandlers {
    onOpen?(info: PtyOpened): void;
    /** Output as it comes. A latin1 chunk holds one code point per byte (not UTF-8). */
    onOutput(text: string, bytes: number, latin1: boolean): void;
    onExit?(exit: PtyExit): void;
    onError?(e: LunaError): void;
}

export interface OpenOptions {
    cols: number;
    rows: number;
    shell?: ShellName;
    cwd?: string;
}

interface PtyReply {
    subscribed?: boolean;
    sessionId?: string;
    pid?: number;
    shell?: string;
    shellPath?: string;
    host?: boolean;
    simulated?: boolean;
    output?: string;
    encoding?: string;
    bytes?: number;
    exited?: boolean;
    exitCode?: number;
    signal?: number;
}

/** Bytes of a latin1 chunk (one code point per byte), to hand to xterm.js as raw data. */
export function latin1Bytes(text: string): Uint8Array {
    const b = new Uint8Array(text.length);
    for (let i = 0; i < text.length; ++i) b[i] = text.charCodeAt(i) & 0xff;
    return b;
}

/** One shell. Writes before the shell is up are queued. */
export class PtySession {
    private sub: Subscription | null = null;
    private id: string | null = null;
    private queue: (() => void)[] = [];
    private closed = false;
    info: PtyOpened | null = null;
    exit: PtyExit | null = null;

    constructor(private readonly opts: OpenOptions, private readonly handlers: PtyHandlers) {}

    get sessionId(): string | null { return this.id; }
    get running(): boolean { return !!this.id && !this.exit && !this.closed; }

    open(): this {
        this.sub = subscribe(`${SERVICE}/open`, { ...this.opts }, (raw) => {
            const r = raw as PtyReply;
            if (r.subscribed && r.sessionId) {
                this.id = r.sessionId;
                this.info = {
                    sessionId: r.sessionId, pid: r.pid ?? 0, shell: r.shell ?? "", shellPath: r.shellPath ?? "",
                    host: r.host, simulated: r.simulated,
                };
                this.handlers.onOpen?.(this.info);
                const q = this.queue;
                this.queue = [];
                q.forEach((f) => f());
            }
            if (typeof r.output === "string" && r.output.length)
                this.handlers.onOutput(r.output, r.bytes ?? r.output.length, r.encoding === "latin1");
            if (r.exited) {
                this.exit = { exitCode: r.exitCode ?? 0, signal: r.signal ?? 0 };
                this.sub?.cancel();
                this.handlers.onExit?.(this.exit);
            }
        }, (e) => this.handlers.onError?.(e));
        return this;
    }

    private whenOpen(f: () => void) {
        if (this.closed || this.exit) return;
        if (this.id) f(); else this.queue.push(f);
    }

    private send(method: string, params: object) {
        this.whenOpen(() => { call(`${SERVICE}/${method}`, { sessionId: this.id, ...params }).catch(() => { /* the exit reply says why */ }); });
    }

    write(data: string): void { if (data) this.send("write", { data }); }
    resize(cols: number, rows: number): void { this.send("resize", { cols, rows }); }
    /** Tell the service the page drew these bytes (flow control). */
    ack(bytes: number): void { if (bytes > 0) this.send("ack", { bytes }); }
    /** Signal the shell (it exits and onExit follows). */
    signal(signal: "SIGHUP" | "SIGINT" | "SIGTERM" | "SIGKILL" = "SIGHUP"): void { this.send("close", { signal }); }
    /** Hang up and stop listening (the card goes). */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.sub?.cancel();   // cancelling the subscription hangs the shell up
    }
}

export const pty = {
    open(opts: OpenOptions, handlers: PtyHandlers): PtySession {
        return new PtySession(opts, handlers).open();
    },
    async shells(): Promise<ShellList> {
        const r = await call(`${SERVICE}/getShells`, {}) as unknown as ShellList;
        return { shells: r.shells ?? [], default: r.default ?? DEFAULT_SHELL, mode: r.mode };
    },
    async list(): Promise<{ sessionId: string; pid: number; shell: string }[]> {
        const r = await call(`${SERVICE}/list`, {}) as unknown as { sessions?: { sessionId: string; pid: number; shell: string }[] };
        return r.sessions ?? [];
    },
};
