// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The stand-in device (test/device.cjs, shared with the evaluation,
// tools/eval-assistant.cjs) for vitest: each reply checked.

import { createRequire } from "node:module";
import { expect } from "vitest";

export type Reply = { returnValue: boolean; errorText?: string; [k: string]: any };
export type Msg = { id: string; role: string; text: string; status?: string; command?: string; confirm?: any; choices?: { id: string; label: string }[]; data?: any; trace?: any };
const req = createRequire(import.meta.url);
const shared = req("./device.cjs") as { device(o: object): any; NOW: number; at(d: number, h: number, m?: number): number };

export const NOW = shared.NOW;
export const at = shared.at;

type Opts = { offline?: boolean; locationAllowed?: boolean | null; seed?: (put: (o: any) => string) => void; llm?: object;
              llmRequest?: (r: object) => Promise<any>; apps?: { id: string; title: string }[]; settings?: object; deps?: object };

export function device(opts: Opts = {}) {
    const d = shared.device(opts);
    const checked = <T>(p: Promise<T>): Promise<T> => p.catch((e: Error) => { expect(e.message, e.message).toBe(""); throw e; });
    return {
        ...d,
        svc: d.svc as Record<string, (p?: object) => Promise<Reply>>,
        db: d.db as Map<string, any>,
        state: d.state as Record<string, any>,
        calls: d.calls as { uri: string; params: any }[],
        of: d.of as (kind: string) => any[],
        called: d.called as (part: string) => { uri: string; params: any }[],
        ask: (text: string, extra?: object): Promise<Msg> => checked(d.ask(text, extra)),
        askAll: (text: string, extra?: object): Promise<Msg[]> => checked(d.askAll(text, extra)),
        confirm: (m: Msg, accept = true): Promise<Msg> => checked(d.confirm(m, accept)),
        choose: (m: Msg, choice: string): Promise<Reply> => checked(d.choose(m, choice)),
    };
}
