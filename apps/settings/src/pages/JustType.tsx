// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Just Type: what the universal search shows, as webOS's Just Type
// preferences (com.palm.app.searchpreferences, which Just Type's own app
// menu opens with Preferences; launch params {page: "justtype"}):
//
//   Find          apps, contacts and the global address lists
//                 (SearchPreference AppSearch, ContactSearch, GAL)
//   Search        the default engine (Just Type's "Search Google" row,
//                 shown while defaultSearch is "true"), then every engine
//                 on or off and in order; Custom Engine, the user's own
//                 (Phoenix: setCustomSearchEngine; docs/M6-PLAN.md F4). The
//                 browser's Preferences choose from the same engines.
//   Content       the apps whose content Just Type searches (DBSearchItemList)
//   Quick Actions New Memo, New Task, ... (ActionList)
//
// Lists are put in order by dragging a row's grip (reorderSearchItem). All
// through com.palm.universalsearch (@phoenix/luna universalSearch, after
// openwebos/luna-universalsearchmgr); Just Type follows the changes at once
// (it subscribes to getUniversalSearchList and getAllSearchPreference).

import { universalSearch, type SearchCategory, type SearchItem, type SearchList, type SearchPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { useState } from "react";
import { Button, Dialog, ErrorText, Group, ListSelector, Note, Page, PageHeader, Row, TextField, ToggleButton } from "@phoenix/ui";
import { ReorderList } from "../ReorderList";

function ItemList({ category, items, testId }: { category: SearchCategory; items: SearchItem[]; testId: string }) {
    return (
        <ReorderList items={items} keyOf={(x) => x.id} testId={testId} label={(x) => `Move ${x.displayName}`}
                     onMove={(x, to) => void universalSearch.move(category, x.id, to)}
                     render={(x) => (
                         <Row title={x.displayName}
                              icon={x.iconFilePath ? <img className="search-icon" src={x.iconFilePath} alt="" /> : undefined}>
                             <ToggleButton value={x.enabled} label={x.displayName} testId={`${testId}-${x.id}`}
                                           onChange={(v) => void universalSearch.setEnabled(category, x.id, v)} />
                         </Row>
                     )} />
    );
}

export function JustTypePage() {
    const list = useLuna<SearchList>((cb, err) => universalSearch.watchList(cb, err), []).value;
    const prefs = useLuna<SearchPreferences>((cb, err) => universalSearch.watchPreferences(cb, err), []).value ?? {};
    const pref = (key: string, title: string, subtitle?: string) => (
        <Row title={title} subtitle={subtitle}>
            <ToggleButton value={prefs[key] === "true"} label={title} testId={`jt-${key}`}
                          onChange={(v) => void universalSearch.setPreference(key, v)} />
        </Row>
    );
    const engines = list?.engines ?? [];
    const custom = engines.find((e) => e.id === "custom");
    const [editing, setEditing] = useState(false);
    const defaultEngine = prefs.defaultSearchEngine ?? list?.defaultSearchEngine ?? "";

    return (
        <Page>
            <PageHeader title="Just Type" icon="icons/justtype.png" />
            <Note>Start typing anywhere in card view to search.</Note>
            <Group label="Find">
                {pref("AppSearch", "Applications", "Launch them by name")}
                {pref("ContactSearch", "Contacts")}
                {pref("GAL", "Global address lists", "Your work directories")}
            </Group>

            <Group label="Search">
                {engines.length > 0 && (
                    <ListSelector title="Default" value={defaultEngine} testId="jt-default-engine"
                                  options={engines.map((e) => ({ label: e.displayName, value: e.id }))}
                                  onChange={(id) => void universalSearch.setDefaultEngine(id)} />
                )}
                {pref("defaultSearch", "Show it first", "With suggestions as you type")}
                <ItemList category="search" items={engines} testId="jt-engine" />
                <Row title="Custom Engine" subtitle={custom ? custom.displayName : "Search with any site"} chevron
                     onClick={() => setEditing(true)} testId="jt-custom" />
            </Group>
            <CustomEngineDialog open={editing} engine={custom} onClose={() => setEditing(false)} />

            {list && list.content.length > 0 && (
                <Group label="Content">
                    <ItemList category="dbsearch" items={list.content} testId="jt-content" />
                </Group>
            )}
            {list && list.actions.length > 0 && (
                <Group label="Quick Actions">
                    <ItemList category="action" items={list.actions} testId="jt-action" />
                </Group>
            )}
            <Note>Drag a row by its grip to change the order Just Type lists them in.</Note>
        </Page>
    );
}

/** A search address the service takes: http(s), with %s where the words go. */
export function customEngineProblem(url: string): string | null {
    const u = url.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) return "The address starts with http:// or https://.";
    if (!u.includes("%s") && !u.includes("#{searchTerms}")) return "Put %s in the address where the words go.";
    return null;
}

function CustomEngineDialog({ open, engine, onClose }: { open: boolean; engine?: SearchItem; onClose: () => void }) {
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [shownOpen, setShownOpen] = useState(false);
    if (open !== shownOpen) {
        setShownOpen(open);
        if (open) {
            setName(engine?.displayName ?? "");
            setUrl((engine?.url ?? "").replace(/#\{searchTerms\}/g, "%s"));
            setError(null);
        }
    }
    const save = async () => {
        const problem = customEngineProblem(url);
        if (problem) return setError(problem);
        try {
            await universalSearch.setCustomEngine(name.trim() || "Custom", url.trim());
            onClose();
        } catch (e) {
            setError((e as { errorText?: string }).errorText ?? String(e));
        }
    };
    return (
        <Dialog open={open} title="Custom Engine" onClose={onClose} testId="jt-custom-dialog"
                message="Search for “phoenix” on the site and copy the address, with %s in place of phoenix.">
            <TextField label="Name" value={name} onChange={setName} placeholder="My Search" testId="jt-custom-name" />
            <TextField label="Address" value={url} onChange={(v) => { setUrl(v); setError(null); }} onSubmit={() => void save()}
                       placeholder="https://example.com/search?q=%s" testId="jt-custom-url" />
            {error && <ErrorText testId="jt-custom-error">{error}</ErrorText>}
            <Button variant="affirmative" onClick={() => void save()} data-testid="jt-custom-save">Save</Button>
            {engine && (
                <Button variant="negative" data-testid="jt-custom-remove"
                        onClick={() => void universalSearch.setCustomEngine("", "").then(onClose)}>Remove Engine</Button>
            )}
            <Button variant="dark" onClick={onClose}>Cancel</Button>
        </Dialog>
    );
}
