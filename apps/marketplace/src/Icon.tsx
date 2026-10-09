// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An app's icon in the Marketplace's lists and pages. Never an empty
// square: the addresses are tried in order (the app's own icon on the
// device when it is installed, then the catalog's), and when none loads the
// app's initial stands in, on a colour of its own, as the catalog's
// generated icons do (server/marketplace Catalog::generatedIcon).

import { useEffect, useState } from "react";

/** The first letter of an app's title, for its stand-in icon. */
export function initialOf(title: string): string {
    const t = title.trim();
    return t ? Array.from(t)[0].toUpperCase() : "?";
}

/** A colour for an app's stand-in icon, the same every time for a title. */
export function colourOf(title: string): string {
    let h = 0;
    for (const ch of title) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
    return `hsl(${h % 360}, 45%, 42%)`;
}

export function Icon({ src, size = 48, title = "" }: { src?: string | (string | null | undefined)[]; size?: number; title?: string }) {
    const list = (Array.isArray(src) ? src : [src]).filter((s): s is string => !!s);
    const key = list.join("\n");
    const [failed, setFailed] = useState(0);
    useEffect(() => setFailed(0), [key]);
    const current = list[failed];
    return (
        <span className="mk-icon" style={{ width: size, height: size }} data-icon={current ? "image" : "initial"}>
            {current
                ? <img key={current} src={current} alt="" width={size} height={size} draggable={false} onError={() => setFailed((n) => n + 1)} />
                : <span className="mk-icon-initial" style={{ background: colourOf(title), fontSize: Math.round(size * 0.46) }}>{initialOf(title)}</span>}
        </span>
    );
}
