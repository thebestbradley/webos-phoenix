// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Luna calls through the Phoenix service plugin (@phoenix/sdk), as
// notes-core's LunaTransport.

import { app, request, subscribeTo } from "@phoenix/sdk";
import type { LunaReply, LunaTransport } from "@phoenix/notes-core";

export const luna: LunaTransport = {
    call: (uri, params) => request(uri, params) as Promise<LunaReply>,
    subscribe: (uri, params, onReply, onError) =>
        subscribeTo(uri, params, (r) => onReply(r as LunaReply), (e) => onError(e.reply as LunaReply)),
};

/** Opens a link in the browser (applicationManager picks the handler). */
export function openLink(url: string): void {
    void app.open(url).catch(() => {});
}
