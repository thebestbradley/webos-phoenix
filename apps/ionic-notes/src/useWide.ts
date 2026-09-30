// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";

/**
 * Tablet layout: the folders beside the list (Ionic's split pane, from
 * 768px as its "md" breakpoint) and, from this width, the note beside the
 * list too. Narrower, the note is its own page, as on a phone.
 */
export const WIDE_QUERY = "(min-width: 900px)";

export function useWide(): boolean {
    const [wide, setWide] = useState(() => matchMedia(WIDE_QUERY).matches);
    useEffect(() => {
        const mq = matchMedia(WIDE_QUERY);
        const on = () => setWide(mq.matches);
        mq.addEventListener("change", on);
        return () => mq.removeEventListener("change", on);
    }, []);
    return wide;
}
