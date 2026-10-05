// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The card's scene transition, as Mojo apps got it when they pushed or
// popped a scene: the shell snapshots the card
// (PalmSystem.prepareSceneTransition), the app changes its page, and the
// card zooms and cross-fades from the snapshot to the new page
// (PalmSystem.runSceneTransition; LunaSysMgr's CardTransition.cpp, 300 ms).
// See "Scene transitions" in runtime/phoenix-runtime.js.

export type SceneTransitionType = "zoom-fade" | "cross-fade";

export interface SceneTransitionOptions {
    /** Going back to a scene (Mojo's popScene) rather than to a new one. */
    pop?: boolean;
    /** Mojo.Transition.zoomFade (the default) or crossFade. */
    type?: SceneTransitionType;
}

interface ScenePalmSystem {
    prepareSceneTransition?(isPop: boolean): unknown;
    runSceneTransition?(type: string, isPop: boolean): void;
    cancelSceneTransition?(): void;
}

function palmSystem(): ScenePalmSystem | undefined {
    return (globalThis as { PalmSystem?: ScenePalmSystem }).PalmSystem;
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 16);
    });
}

let running = false;

/**
 * Change the scene with the card's transition. change() must update the
 * page synchronously (in React, wrap the state change in flushSync). Without
 * a shell that does transitions, or while another one runs (Mojo: "Only
 * one transition may be run at a time"), the scene just changes.
 */
export async function sceneTransition(change: () => void, options: SceneTransitionOptions = {}): Promise<void> {
    const ps = palmSystem();
    if (running || !ps || typeof ps.prepareSceneTransition !== "function" || typeof ps.runSceneTransition !== "function") {
        change();
        return;
    }
    const isPop = !!options.pop;
    running = true;
    try {
        // The snapshot shows the scene being left: change it only once the
        // shell has it.
        await ps.prepareSceneTransition(isPop);
        try {
            change();
        } catch (e) {
            ps.cancelSceneTransition?.();
            throw e;
        }
        // Once the new scene has been laid out and painted.
        await nextFrame();
        await nextFrame();
        ps.runSceneTransition(options.type ?? "zoom-fade", isPop);
    } finally {
        running = false;
    }
}
