// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The pty client against the runtime's simulated org.webosphoenix.pty
// (runtime/phoenix-runtime.js, block "Terminal"): jsdom has no host shell,
// so it gets the small simulated shell, which answers the same way every
// time.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { call, LunaError } from "./bridge";
import { latin1Bytes, pty, PTY_ERRORS, type PtyExit, type PtySession } from "./pty";

type PS = { appIdentifier: string };
const palm = () => (window as unknown as { PalmSystem: PS }).PalmSystem;

beforeAll(() => {
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

const asTerminal = () => { palm().appIdentifier = "org.webosphoenix.terminal"; };

function open(): { s: PtySession; out: () => string; exited: Promise<PtyExit> } {
    let text = "";
    let done: (e: PtyExit) => void = () => {};
    const exited = new Promise<PtyExit>((r) => { done = r; });
    const s = pty.open({ cols: 60, rows: 20 }, { onOutput: (t) => { text += t; }, onExit: done });
    return { s, out: () => text, exited };
}

async function until(cond: () => boolean, ms = 2000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error("timed out");
        await new Promise((r) => setTimeout(r, 5));
    }
}

describe("simulated org.webosphoenix.pty", () => {
    it("opens shells only for the Terminal app", async () => {
        palm().appIdentifier = "com.palm.app.browser";
        const errors: LunaError[] = [];
        pty.open({ cols: 80, rows: 24 }, { onOutput: () => {}, onError: (e) => errors.push(e) });
        await until(() => errors.length > 0);
        expect(errors[0].errorCode).toBe(PTY_ERRORS.NOT_ALLOWED);
        asTerminal();
        await expect(call("luna://org.webosphoenix.pty/open", { cols: 80, rows: 24 })).rejects.toMatchObject({ errorCode: PTY_ERRORS.BAD_PARAMS });
    });

    it("runs commands with a prompt, and exits with a status", async () => {
        asTerminal();
        const { s, out, exited } = open();
        await until(() => out().includes("$ "));
        expect(s.info).toMatchObject({ shell: "fsh", simulated: true });
        s.write("echo hello   world\r");
        await until(() => out().includes("hello world\r\n"));
        s.write("echo -e 'a\\tb'\r");
        await until(() => out().includes("a\tb"));
        s.write("nosuch\r");
        await until(() => out().includes("fsh: nosuch: command not found"));
        expect(await pty.list()).toEqual([expect.objectContaining({ sessionId: s.sessionId })]);
        palm().appIdentifier = "com.palm.app.browser";
        expect(await pty.list()).toEqual([]);
        await expect(call("luna://org.webosphoenix.pty/write", { sessionId: s.sessionId, data: "x" }))
            .rejects.toMatchObject({ errorCode: PTY_ERRORS.NO_SESSION });
        asTerminal();
        s.write("exit 3\r");
        expect(await exited).toEqual({ exitCode: 3, signal: 0 });
        expect(s.running).toBe(false);
        expect(await pty.list()).toEqual([]);
    });

    it("edits the line: backspace, Ctrl-C, history", async () => {
        asTerminal();
        const { s, out } = open();
        await until(() => out().includes("$ "));
        s.write("echo abX\x7fc\r");
        await until(() => out().includes("abc\r\n"));
        s.write("echo gone\x03");
        await until(() => out().includes("^C"));
        s.write("\x1b[A\r");   // Up: the last command again
        // The command line redrawn and run again: abc twice more.
        await until(() => out().split("abc\r\n").length === 4);
        s.close();
    });

    it("lists the simulated filesystem and moves around it", async () => {
        asTerminal();
        const { s, out } = open();
        await until(() => out().includes("$ "));
        s.write("pwd\r");
        await until(() => out().includes("/media/internal\r\n"));
        s.write("cd /usr/palm\rpwd\r");
        await until(() => out().includes("/usr/palm\r\n"));
        s.write("cd /nowhere\r");
        await until(() => out().includes("No such file or directory"));
        s.close();
    });

    it("hangs up on close and knows its shells", async () => {
        asTerminal();
        const { s, out, exited } = open();
        await until(() => out().includes("$ "));
        s.signal("SIGHUP");
        expect(await exited).toEqual({ exitCode: -1, signal: 1 });
        const shells = await pty.shells();
        expect(shells.default).toBe("bash");
        expect(shells.mode).toBe("simulated");
        expect(shells.shells.map((x) => x.name)).toEqual(["bash", "zsh", "fish", "sh"]);
        await expect(call("luna://org.webosphoenix.pty/exec", {})).rejects.toMatchObject({ errorCode: PTY_ERRORS.DEVMODE_REQUIRED });
    });

    it("turns Latin-1 chunks back into bytes", () => {
        expect(Array.from(latin1Bytes("ÿéA"))).toEqual([0xff, 0xe9, 0x41]);
    });
});
