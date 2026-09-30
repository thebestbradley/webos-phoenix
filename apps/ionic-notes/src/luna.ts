// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Luna calls through Phoenix's own client (@phoenix/luna), as notes-core's
// LunaTransport.

import { call, subscribe, type LunaError } from "@phoenix/luna";
import type { LunaReply, LunaTransport } from "@phoenix/notes-core";

export const luna: LunaTransport = {
    call: (uri, params) => call(uri, params) as Promise<LunaReply>,
    subscribe: (uri, params, onReply, onError) =>
        subscribe(uri, params, (r) => onReply(r as LunaReply), (e: LunaError) => onError(e.reply as LunaReply)),
};

/** Opens a link in the browser (applicationManager picks the handler). */
export function openLink(url: string): void {
    void call("luna://com.webos.applicationManager/open", { target: url }).catch(() => {});
}
