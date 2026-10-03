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
//                 on or off and in order
//   Content       the apps whose content Just Type searches (DBSearchItemList)
//   Quick Actions New Memo, New Task, ... (ActionList)
//
// Lists are put in order by dragging a row's grip (reorderSearchItem). All
// through com.palm.universalsearch (@phoenix/luna universalSearch, after
// openwebos/luna-universalsearchmgr); Just Type follows the changes at once
// (it subscribes to getUniversalSearchList and getAllSearchPreference).

import { universalSearch, type SearchCategory, type SearchItem, type SearchList, type SearchPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Note, Page, PageHeader, Row, ToggleButton } from "@phoenix/ui";
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
            </Group>

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
