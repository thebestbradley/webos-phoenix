// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A LunaTransport on Enact's LS2Request (@enact/webos/LS2Request). The
// class is passed in, so this package does not depend on Enact.

import type { LunaReply, LunaTransport } from "./store";

interface Ls2Options {
    service: string;
    method: string;
    parameters?: object;
    subscribe?: boolean;
    onSuccess?: (r: LunaReply) => void;
    onFailure?: (r: LunaReply) => void;
}

export interface Ls2RequestLike {
    send(options: Ls2Options): unknown;
    cancel(): void;
}

function split(uri: string): { service: string; method: string } {
    const m = /^((?:luna|palm):\/\/[^/]+)\/(.+)$/.exec(uri);
    if (!m) throw new Error("Bad Luna URI: " + uri);
    return { service: m[1], method: m[2] };
}

export function ls2Transport(LS2Request: new () => Ls2RequestLike): LunaTransport {
    return {
        call(uri, parameters) {
            return new Promise((resolve, reject) => {
                new LS2Request().send({ ...split(uri), parameters, onSuccess: resolve, onFailure: reject });
            });
        },
        subscribe(uri, parameters, onReply, onError) {
            const req = new LS2Request();
            req.send({ ...split(uri), parameters, subscribe: true, onSuccess: onReply, onFailure: onError });
            return { cancel: () => req.cancel() };
        },
    };
}
