// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A capture the preview is opened on may not be stored yet: the shell
// hands the picture to one app page, which encodes and stores it while
// the preview's page starts (a big capture takes a moment). The preview
// keeps looking for a few seconds before it says the capture is gone.

export const CAPTURE_WAIT_MS = 4000;
export const CAPTURE_RETRY_MS = 250;

/**
 * Runs `attempt` until it succeeds or `waitMs` have gone by, `retryMs`
 * between tries; rejects with the last error. `alive()` false stops it
 * (the preview moved on), and the promise then never settles.
 */
export function retryFor<T>(attempt: () => Promise<T>, waitMs = CAPTURE_WAIT_MS, retryMs = CAPTURE_RETRY_MS,
                            alive: () => boolean = () => true,
                            sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
    const tries = Math.max(1, Math.floor(waitMs / retryMs) + 1);
    return new Promise<T>((resolve, reject) => {
        let n = 0;
        const go = () => {
            if (!alive()) return;
            attempt().then(resolve, (e) => {
                if (++n >= tries || !alive()) {
                    if (alive()) reject(e);
                    return;
                }
                sleep(retryMs).then(go);
            });
        };
        go();
    });
}
