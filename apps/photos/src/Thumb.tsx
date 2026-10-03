// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import type { MediaItem } from "@phoenix/luna";
import { useMediaUrl } from "@phoenix/luna/react";
import { isVideo } from "./albums";

/** A picture (or a video's first frame) filling its box. */
export function Thumb({ item, fit = "cover" }: { item: MediaItem; fit?: "cover" | "contain" }) {
    const url = useMediaUrl(item.file_path);
    if (!url) return <span className="ph-thumb loading" />;
    if (isVideo(item))
        return <video className={`ph-thumb ${fit}`} src={url + "#t=0.1"} muted playsInline preload="metadata" />;
    return <img className={`ph-thumb ${fit}`} src={url} alt={item.title ?? ""} draggable={false} decoding="async" />;
}
