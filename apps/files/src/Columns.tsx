// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Files' column view, beside @phoenix/ui's ColumnView: the preview of the
// file marked in the last column, as the Finder's column view shows one
// (its picture or its kind's icon, its name, kind, size and date) with
// what the list does with a file: Open (a tap in the list), Share, Open
// With... and Info (the select menu's). A drive's file is not fetched for
// its picture: the kind's icon stands in until it is opened.

import type { ReactNode } from "react";
import { formatSize, kindOf, type FileEntry } from "@phoenix/luna";
import { useFileUrl } from "@phoenix/luna/react";
import { Button, ColumnPreview, FileIcon } from "@phoenix/ui";
import { kindLabel, longDate } from "./browse";

export function FilePreview({ entry, place, onOpen, onShare, onOpenWith, onInfo }: {
    entry: FileEntry;
    /** The drive the file is on (its name), for a drive's file. */
    place?: string;
    onOpen: () => void;
    onShare: () => void;
    onOpenWith: () => void;
    onInfo: () => void;
}) {
    const kind = kindOf(entry);
    const image = useFileUrl(kind === "image" && !entry.remote ? entry.path : undefined);
    const facts: [string, ReactNode][] = [["Kind", kindLabel(entry)], ["Size", formatSize(entry.size)]];
    if (entry.mtime) facts.push(["Modified", longDate(entry.mtime)]);
    if (entry.remote && place) facts.push(["On", place]);
    if (entry.readOnly) facts.push(["Access", "Read-only"]);
    return (
        <ColumnPreview testId="preview" image={image} icon={<FileIcon kind={kind} size={96} />} title={entry.name} facts={facts}>
            <Button variant="affirmative" data-testid="preview-open" onClick={onOpen}>Open</Button>
            <Button data-testid="preview-share" onClick={onShare}>Share</Button>
            <Button data-testid="preview-open-with" onClick={onOpenWith}>Open With...</Button>
            <Button data-testid="preview-info" onClick={onInfo}>Info</Button>
        </ColumnPreview>
    );
}
