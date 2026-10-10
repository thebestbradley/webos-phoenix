// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ways in from the system: Just Type and the Assistant. Both are declared
// in the app's appinfo.json and reach the app as a launch param, so they
// work whether the app was running or not:
//
//   "universalSearch": {                       (luna-universalsearchmgr; Tasks' appinfo.json)
//       "action":   {"displayName": "New Note", "url": "com.example.notes", "launchParam": "newNote"},
//       "dbsearch": {"displayName": "Notes", "url": "com.example.notes", "launchParam": "noteId",
//                    "launchParamDbField": "_id", "displayFields": ["title"],
//                    "dbQuery": {"from": "com.example.note:1", "where": [{"prop": "title", "op": "?", "val": ""}]}}
//   },
//   "assistant": {"commands": [{"id": "newNote", "displayName": "New note", "launchParam": "newNote",
//                               "phrases": {"en": ["new note {text}", "note {text}"]}, "risk": "change"}]}
//
// Just Type's action launches the app with {newNote: "<the words typed>"};
// a content result with {noteId: "<the record's _id>"}; an Assistant
// command with {newNote: "<the words in {text}>"} (risk "send" and "delete"
// are read back to the user first). docs/APP-RUNTIME.md "Just Type" and
// "Assistant".

import { app } from "./app";
import { request, watchLuna, type OnError, type OnValue, type Watch } from "./core";
import { assistant as lunaAssistant, type AssistantCommand } from "../../luna/src/assistant";

export type { AssistantCommand };

/** cb with the value of one launch param, at launch and at every relaunch that carries it. */
function onParam<T = string>(name: string, cb: (value: T, params: Record<string, unknown>) => void): () => void {
    return app.onLaunch<Record<string, unknown>>((p) => {
        if (p && name in p && p[name] !== undefined && p[name] !== null) cb(p[name] as T, p);
    });
}

export const justType = {
    /**
     * The app's Just Type action ("New Note"): cb gets the words typed. The
     * action's launchParam names the param.
     *
     *     justType.onAction("newNote", (text) => createNote(text));
     */
    onAction(launchParam: string, cb: (text: string) => void): () => void {
        return onParam<unknown>(launchParam, (v) => cb(String(v)));
    },
    /** A content result the user tapped: cb gets its launchParamDbField's value (the record's _id). */
    onResult(launchParam: string, cb: (value: string) => void): () => void {
        return onParam<unknown>(launchParam, (v) => cb(String(v)));
    },
    /** Open Just Type's preferences (Settings > Just Type), where the user turns the app's items on. */
    preferences(): Promise<void> {
        return app.launch("com.palm.app.searchpreferences", {});
    },
};

export const assistant = {
    /**
     * One of the app's Assistant commands: cb gets the words that filled
     * {text} ("" when the phrase has none).
     *
     *     assistant.onCommand("newNote", (text) => createNote(text));
     */
    onCommand(launchParam: string, cb: (text: string) => void): () => void {
        return onParam<unknown>(launchParam, (v) => cb(typeof v === "string" ? v : ""));
    },
    /** The app's commands as the Assistant knows them (from its appinfo.json), and whether the user turned each on. */
    async commands(): Promise<AssistantCommand[]> {
        const r = await request<{ commands?: AssistantCommand[] }>("luna://org.webosphoenix.assistant/commands", {});
        return (r.commands ?? []).filter((c) => c.appId === app.id);
    },
    /** Every command, kept up to date (Settings may turn them on and off). */
    watchCommands(onValue?: OnValue<AssistantCommand[]>, onError?: OnError): Watch<AssistantCommand[]> {
        return watchLuna<AssistantCommand[]>((cb, err) => lunaAssistant.watchCommands((all) => cb(all.filter((c) => c.appId === app.id)), err),
                                             onValue, onError);
    },
    /** Open the Assistant (the user's own words go there; apps cannot ask on their behalf). */
    open(): Promise<void> {
        return app.launch("org.webosphoenix.assistant", {});
    },
};
