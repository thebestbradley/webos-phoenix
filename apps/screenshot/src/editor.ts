// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The preview's edits, as data: a crop rectangle and pen strokes, both in
// the picture's own pixels, so the edit can be drawn at any size and saved
// at full size. Pure functions, unit-tested (editor.test.ts).

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Stroke { color: string; width: number; points: Point[] }
export interface Edits { crop: Rect | null; strokes: Stroke[] }

export const PEN_COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#000000"];

/** The smallest crop, in picture pixels. */
export const MIN_CROP = 32;

export const noEdits = (): Edits => ({ crop: null, strokes: [] });
export const isEdited = (e: Edits) => e.crop !== null || e.strokes.length > 0;

/** The part of the picture shown: the crop, or all of it. */
export function visibleRect(e: Edits, image: Size): Rect {
    return e.crop ?? { x: 0, y: 0, width: image.width, height: image.height };
}

/** How to fit `content` into `box`, centred: scale and offset. */
export function fit(content: Size, box: Size): { scale: number; x: number; y: number } {
    if (content.width <= 0 || content.height <= 0) return { scale: 1, x: 0, y: 0 };
    const scale = Math.min(box.width / content.width, box.height / content.height);
    return { scale, x: (box.width - content.width * scale) / 2, y: (box.height - content.height * scale) / 2 };
}

/** A pen width that reads the same at any picture size. */
export function penWidth(image: Size): number {
    return Math.max(3, Math.round(Math.min(image.width, image.height) / 90));
}

export type Handle = "tl" | "tr" | "bl" | "br" | "move";

/**
 * Drag a crop handle by (dx, dy) picture pixels: corners resize (never under
 * MIN_CROP, never past the picture), "move" moves it within the picture.
 */
export function dragCrop(r: Rect, handle: Handle, dx: number, dy: number, image: Size): Rect {
    let left = r.x, top = r.y, right = r.x + r.width, bottom = r.y + r.height;
    if (handle === "move") {
        const x = Math.max(0, Math.min(image.width - r.width, r.x + dx));
        const y = Math.max(0, Math.min(image.height - r.height, r.y + dy));
        return { x, y, width: r.width, height: r.height };
    }
    if (handle === "tl" || handle === "bl") left = Math.max(0, Math.min(right - MIN_CROP, left + dx));
    if (handle === "tr" || handle === "br") right = Math.min(image.width, Math.max(left + MIN_CROP, right + dx));
    if (handle === "tl" || handle === "tr") top = Math.max(0, Math.min(bottom - MIN_CROP, top + dy));
    if (handle === "bl" || handle === "br") bottom = Math.min(image.height, Math.max(top + MIN_CROP, bottom + dy));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A crop that is the whole picture is no crop. */
export function normalizeCrop(r: Rect | null, image: Size): Rect | null {
    if (!r) return null;
    const x = Math.round(r.x), y = Math.round(r.y);
    const width = Math.round(r.width), height = Math.round(r.height);
    if (x <= 0 && y <= 0 && width >= image.width && height >= image.height) return null;
    return { x, y, width, height };
}

interface Ctx2D {
    save(): void; restore(): void; translate(x: number, y: number): void; scale(x: number, y: number): void;
    beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void;
    strokeStyle: unknown; lineWidth: number; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin;
}

/** Draws the strokes (picture pixels) on a context already set to picture pixels. */
export function drawStrokes(ctx: Ctx2D, strokes: Stroke[]) {
    for (const s of strokes) {
        if (s.points.length === 0) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (const p of s.points.length === 1 ? [s.points[0], s.points[0]] : s.points.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
    }
}
