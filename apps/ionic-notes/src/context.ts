// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import type { NotesApp } from "@phoenix/notes-core";
import { createContext, useContext } from "react";

export interface NotesUi {
    /** notes-core's state and actions (shared with the Enact demos). */
    app: NotesApp;
    /** Tablet layout: the note beside the list (useWide). */
    wide: boolean;
    /** Deletes a note, offering Undo while it is in Recently Deleted. */
    deleteWithUndo(id: string): void;
}

export const NotesContext = createContext<NotesUi | null>(null);

export function useNotes(): NotesUi {
    const ui = useContext(NotesContext);
    if (!ui) throw new Error("useNotes outside NotesContext");
    return ui;
}
