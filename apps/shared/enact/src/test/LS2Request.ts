// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for Enact's @enact/webos/LS2Request in apps/'s tests (apps/
// has no Enact; vitest.config.ts aliases it here). It records each send
// and lets the test answer.

export interface SentRequest {
    service: string;
    method: string;
    parameters?: object;
    subscribe?: boolean;
    onSuccess?: (r: object) => void;
    onFailure?: (r: object) => void;
    cancelled: boolean;
}

export default class LS2Request {
    static sent: SentRequest[] = [];
    private req: SentRequest | null = null;
    send(o: Omit<SentRequest, "cancelled">): void {
        this.req = { ...o, cancelled: false };
        LS2Request.sent.push(this.req);
    }
    cancel(): void {
        if (this.req) this.req.cancelled = true;
    }
}
