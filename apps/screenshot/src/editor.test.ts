// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { dragCrop, fit, isEdited, MIN_CROP, noEdits, normalizeCrop, penWidth, visibleRect } from "./editor";

const IMG = { width: 320, height: 480 };

describe("the preview's edits", () => {
    it("shows all of the picture until it is cropped", () => {
        expect(visibleRect(noEdits(), IMG)).toEqual({ x: 0, y: 0, width: 320, height: 480 });
        expect(isEdited(noEdits())).toBe(false);
        expect(isEdited({ crop: null, strokes: [{ color: "#fff", width: 3, points: [{ x: 1, y: 1 }] }] })).toBe(true);
    });

    it("fits a picture into the screen, centred", () => {
        expect(fit(IMG, { width: 160, height: 480 })).toEqual({ scale: 0.5, x: 0, y: 120 });
        expect(fit({ width: 0, height: 0 }, IMG)).toEqual({ scale: 1, x: 0, y: 0 });
    });

    it("drags a corner, but never smaller than the minimum or past the picture", () => {
        const all = { x: 0, y: 0, width: 320, height: 480 };
        expect(dragCrop(all, "tl", 20, 30, IMG)).toEqual({ x: 20, y: 30, width: 300, height: 450 });
        expect(dragCrop(all, "br", 100, 100, IMG)).toEqual(all);
        expect(dragCrop(all, "tl", 1000, 1000, IMG)).toEqual({ x: 320 - MIN_CROP, y: 480 - MIN_CROP, width: MIN_CROP, height: MIN_CROP });
        expect(dragCrop({ x: 10, y: 10, width: 100, height: 100 }, "bl", -50, 20, IMG)).toEqual({ x: 0, y: 10, width: 110, height: 120 });
    });

    it("moves the crop within the picture", () => {
        const r = { x: 10, y: 10, width: 100, height: 100 };
        expect(dragCrop(r, "move", 500, -50, IMG)).toEqual({ x: 220, y: 0, width: 100, height: 100 });
    });

    it("treats a crop of the whole picture as none, and rounds to pixels", () => {
        expect(normalizeCrop({ x: 0, y: 0, width: 320, height: 480 }, IMG)).toBeNull();
        expect(normalizeCrop({ x: 10.4, y: 20.6, width: 99.5, height: 100.2 }, IMG)).toEqual({ x: 10, y: 21, width: 100, height: 100 });
    });

    it("chooses a pen that reads the same at any size", () => {
        expect(penWidth(IMG)).toBe(4);
        expect(penWidth({ width: 2560, height: 1600 })).toBe(18);
        expect(penWidth({ width: 100, height: 100 })).toBe(3);
    });
});
