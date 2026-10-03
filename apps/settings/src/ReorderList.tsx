// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Rows the user puts in order, as Enyo 1.0's reorderable lists did (Just
// Type's preferences ordered its search engines and actions this way): drag
// a row by its grip at the right and the others make room; it drops in
// the place it is over. The grip also takes the arrow keys (one place up
// or down), for keyboards and screen readers.

import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { cx } from "@phoenix/ui";

export interface ReorderListProps<T> {
    items: T[];
    keyOf: (item: T) => string;
    /** A row's content (a Row without margins of its own). */
    render: (item: T) => ReactNode;
    /** Accessible name of a row's grip. */
    label: (item: T) => string;
    onMove: (item: T, toIndex: number) => void;
    testId?: string;
}

/** Where a row dragged dy pixels from `from` lands, rows being `heights` tall. */
export function dropIndex(heights: number[], from: number, dy: number): number {
    let to = from;
    let moved = dy;
    if (moved > 0) {
        while (to < heights.length - 1 && moved > heights[to + 1] / 2) { moved -= heights[to + 1]; to++; }
    } else {
        while (to > 0 && -moved > heights[to - 1] / 2) { moved += heights[to - 1]; to--; }
    }
    return to;
}

export function ReorderList<T>({ items, keyOf, render, label, onMove, testId }: ReorderListProps<T>) {
    const rows = useRef<(HTMLDivElement | null)[]>([]);
    const [drag, setDrag] = useState<{ index: number; startY: number; dy: number; heights: number[] } | null>(null);

    const start = (i: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag({ index: i, startY: e.clientY, dy: 0, heights: rows.current.slice(0, items.length).map((r) => r?.offsetHeight || 48) });
    };
    const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (drag) setDrag({ ...drag, dy: e.clientY - drag.startY });
    };
    const end = () => {
        if (!drag) return;
        const to = dropIndex(drag.heights, drag.index, drag.dy);
        setDrag(null);
        if (to !== drag.index) onMove(items[drag.index], to);
    };
    const target = drag ? dropIndex(drag.heights, drag.index, drag.dy) : -1;

    // While dragging, the rows between the dragged one and where it would
    // land move aside by its height.
    const shift = (i: number) => {
        if (!drag || i === drag.index) return 0;
        const h = drag.heights[drag.index];
        if (drag.index < i && i <= target) return -h;
        if (target <= i && i < drag.index) return h;
        return 0;
    };

    return (
        <div className="reorder-list" data-testid={testId}>
            {items.map((item, i) => (
                <div key={keyOf(item)} ref={(el) => { rows.current[i] = el; }}
                     className={cx("reorder-row", drag?.index === i && "dragging")}
                     style={{ transform: `translateY(${drag?.index === i ? drag.dy : shift(i)}px)` }}>
                    <div className="reorder-row-body">{render(item)}</div>
                    <button type="button" className="reorder-grip" aria-label={label(item)} data-testid={`grip-${keyOf(item)}`}
                            onPointerDown={start(i)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); onMove(item, i - 1); }
                                else if (e.key === "ArrowDown" && i < items.length - 1) { e.preventDefault(); onMove(item, i + 1); }
                            }} />
                </div>
            ))}
        </div>
    );
}
