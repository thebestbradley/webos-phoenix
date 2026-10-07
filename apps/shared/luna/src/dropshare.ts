// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// DropShare (org.webosphoenix.dropshare, Phoenix): files to and from any
// phone or computer on the same network, through a page the device serves
// at a one-time address (docs/APP-RUNTIME.md "DropShare"). The simulator
// implements it in runtime/phoenix-runtime.js ("DropShare") with
// phoenix-sim's server (shell/sim/simdropshare.h).
//
//   receive {subscribe}                     -> DropShareStatus as it changes
//   send {files: [{path, mimeType?}], subscribe} -> DropShareStatus
//   stop {}
//   getStatus {}

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

const DS = "luna://org.webosphoenix.dropshare";

export type DropShareState = "off" | "waiting" | "transferring" | "done" | "timeout" | "stopped" | "failed";

export interface DropShareFile {
    id: number;
    name: string;
    type?: string;
    size: number;
    /** Bytes in so far (receiving). */
    received?: number;
    done?: boolean;
    /** Times the other device downloaded it whole (sending). */
    downloads?: number;
    /** Where it was saved, in Downloads (receiving). */
    saved?: string;
}

export interface DropShareStatus {
    mode?: "receive" | "send";
    /** The address the other device opens; "" once the session is over. */
    url: string;
    state: DropShareState;
    files: DropShareFile[];
}

type OnError = (e: LunaError) => void;

export const dropShare = {
    receive(cb: (s: DropShareStatus) => void, onError?: OnError): Subscription {
        return subscribe(`${DS}/receive`, {}, (r) => cb(r as unknown as DropShareStatus), onError);
    },
    send(files: { path: string; mimeType?: string }[], cb: (s: DropShareStatus) => void, onError?: OnError): Subscription {
        return subscribe(`${DS}/send`, { files }, (r) => cb(r as unknown as DropShareStatus), onError);
    },
    stop() {
        return call(`${DS}/stop`, {});
    },
};
