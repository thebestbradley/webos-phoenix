// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// File naming and frame capture for the Camera.

import { CAMERA_DIR } from "@phoenix/luna";

export type FlashMode = "auto" | "on" | "off";
export const FLASH_ORDER: FlashMode[] = ["auto", "on", "off"];

export function nextFlash(mode: FlashMode): FlashMode {
    return FLASH_ORDER[(FLASH_ORDER.indexOf(mode) + 1) % FLASH_ORDER.length];
}

/**
 * The next free name in the camera folder, numbered like the webOS camera
 * (CIMG0001.jpg, CIMG0002.webm, ...; photos and videos share the counter).
 */
export function nextCapturePath(existing: string[], ext: "jpg" | "webm"): string {
    let max = 0;
    for (const p of existing) {
        const m = /\/CIMG(\d{4,})\.[a-z0-9]+$/i.exec(p);
        if (m && p.startsWith(CAMERA_DIR + "/")) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${CAMERA_DIR}/CIMG${String(max + 1).padStart(4, "0")}.${ext}`;
}

/** Size of a capture of a w x h frame, the long side at most `longSide`. */
export function captureSize(w: number, h: number, longSide = 640): { width: number; height: number } {
    const s = Math.min(1, longSide / Math.max(w, h, 1));
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** A JPEG of the video's current frame. */
export function grabFrame(video: HTMLVideoElement, longSide = 640, quality = 0.85): Promise<Blob> {
    const { width, height } = captureSize(video.videoWidth, video.videoHeight, longSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
    return new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("capture failed"))), "image/jpeg", quality));
}

/** "0:07" */
export function recordingTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The best WebM type MediaRecorder offers here, if any. */
export function recorderType(): string | undefined {
    const MR = (globalThis as { MediaRecorder?: { isTypeSupported(t: string): boolean } }).MediaRecorder;
    if (!MR) return undefined;
    return ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm"].find((t) => MR.isTypeSupported(t));
}
