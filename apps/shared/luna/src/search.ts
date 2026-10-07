// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Just Type's preferences: com.palm.universalsearch, the service of
// openwebos/luna-universalsearchmgr (Src/UniversalSearchService.cpp:75-92),
// which Just Type (com.palm.launcher) reads and the original
// com.palm.app.searchpreferences changed:
//
//   getUniversalSearchList {subscribe}  -> {UniversalSearchList (web search
//       engines), ActionList (Quick Actions), DBSearchItemList (content
//       searches), defaultSearchEngine}
//   getAllSearchPreference {subscribe}  -> {SearchPreference: {key: "true" |
//       "false" | engine id}}
//   setSearchPreference {key, value}
//   updateSearchItem {category, id, enabled, setDefault?}
//   updateAllSearchItems {category, enabled}
//   reorderSearchItem {category, id, toIndex}
//   setCustomSearchEngine {displayName, url} (Phoenix): the user's own
//       engine, id "custom"; url has %s (or #{searchTerms}) for the words;
//       url "" removes it
//
// The simulator implements them in runtime/phoenix-runtime.js ("Just Type").

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

const US = "luna://com.palm.universalsearch";

/** "search": a web search engine; "action": a Quick Action; "dbsearch": an app's content. */
export type SearchCategory = "search" | "action" | "dbsearch";

export interface SearchItem {
    /** The engine's id, or the app's for actions and content searches. */
    id: string;
    displayName: string;
    iconFilePath?: string;
    enabled: boolean;
    url?: string;
    type?: string;
    category?: string;
}

export interface SearchList {
    engines: SearchItem[];
    actions: SearchItem[];
    content: SearchItem[];
    defaultSearchEngine: string;
}

/**
 * SearchPreference keys. Values are strings, as the service keeps them:
 * defaultSearch ("true": the default engine's row in Just Type),
 * ContactSearch, AppSearch, GAL (the global address list), defaultSearchEngine.
 */
export type SearchPreferences = Record<string, string>;

type OnError = (e: LunaError) => void;

export const universalSearch = {
    watchList(cb: (l: SearchList) => void, onError?: OnError): Subscription {
        return subscribe(`${US}/getUniversalSearchList`, {}, (r) => {
            const x = r as unknown as { UniversalSearchList?: SearchItem[]; ActionList?: SearchItem[]; DBSearchItemList?: SearchItem[]; defaultSearchEngine?: string };
            cb({ engines: x.UniversalSearchList ?? [], actions: x.ActionList ?? [], content: x.DBSearchItemList ?? [],
                 defaultSearchEngine: x.defaultSearchEngine ?? "" });
        }, onError);
    },
    watchPreferences(cb: (p: SearchPreferences) => void, onError?: OnError): Subscription {
        return subscribe(`${US}/getAllSearchPreference`, {}, (r) => {
            const prefs = (r as unknown as { SearchPreference?: Record<string, unknown> }).SearchPreference ?? {};
            const out: SearchPreferences = {};
            for (const k of Object.keys(prefs)) out[k] = String(prefs[k]);
            cb(out);
        }, onError);
    },
    setPreference(key: string, value: string | boolean) {
        return call(`${US}/setSearchPreference`, { key, value: String(value) });
    },
    setEnabled(category: SearchCategory, id: string, enabled: boolean) {
        return call(`${US}/updateSearchItem`, { category, id, enabled });
    },
    /** The engine Just Type offers first ("Search Google"). */
    setDefaultEngine(id: string) {
        return call(`${US}/updateSearchItem`, { category: "search", id, enabled: true, setDefault: true });
    },
    setAllEnabled(category: SearchCategory, enabled: boolean) {
        return call(`${US}/updateAllSearchItems`, { category, enabled });
    },
    /** The user's own engine (id "custom"): `url` has %s where the words go; "" removes it. */
    setCustomEngine(displayName: string, url: string) {
        return call(`${US}/setCustomSearchEngine`, { displayName, url });
    },
    /** Move an item to `toIndex` in its category's list. */
    move(category: SearchCategory, id: string, toIndex: number) {
        return call(`${US}/reorderSearchItem`, { category, id, toIndex });
    },
};
