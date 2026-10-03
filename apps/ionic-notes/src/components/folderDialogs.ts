// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// New Folder and Rename as Ionic alerts with a text field, as Apple Notes
// asks. A name already taken keeps the alert open and says why.

import { useIonAlert, useIonToast } from "@ionic/react";
import { folderNameProblem } from "@phoenix/notes-core";
import { useCallback } from "react";

import { useNotes } from "../context";

export function useFolderDialogs() {
    const { app } = useNotes();
    const [alert] = useIonAlert();
    const [toast] = useIonToast();

    const ask = useCallback((header: string, value: string, except: string | undefined, save: (name: string) => void) => {
        void alert({
            header,
            inputs: [{ name: "name", type: "text", value, placeholder: "Name", attributes: { "aria-label": "Folder name" } }],
            buttons: [
                { text: "Cancel", role: "cancel" },
                {
                    text: "Save",
                    handler: (data: { name: string }) => {
                        const problem = folderNameProblem(data.name, app.folders, except);
                        if (problem) {
                            void toast({ message: problem, duration: 2500, position: "top", color: "warning" });
                            return false;
                        }
                        save(data.name);
                        return true;
                    },
                },
            ],
        });
    }, [alert, toast, app.folders]);

    const { createFolder, renameFolder, folderName } = app;
    return {
        newFolder: useCallback(() => ask("New Folder", "", undefined, (name) => void createFolder(name)), [ask, createFolder]),
        renameFolder: useCallback((id: string) => ask("Rename Folder", folderName(id), id, (name) => void renameFolder(id, name)),
            [ask, folderName, renameFolder]),
    };
}
