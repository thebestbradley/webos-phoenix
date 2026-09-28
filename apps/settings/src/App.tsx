// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One app, one launch point per pane (appinfo.json "phoenix.launchPoints"):
// the launcher's Settings tab shows Wi-Fi, Bluetooth, ... as separate icons
// and cards, as on webOS 2.x, and each starts this app with {page: "..."}.
// Without a page it shows the list of all panes.

import { useState } from "react";
import { useLaunchParams } from "@phoenix/luna/react";
import { BackProvider, useBack } from "./nav";
import { Hub } from "./pages/Hub";
import { PAGES, type PageId } from "./pages";

function Router() {
    const params = useLaunchParams<{ page?: string }>();
    const launched = params.page && params.page in PAGES ? (params.page as PageId) : null;
    // Pane opened from the list (only when not launched straight into one).
    const [opened, setOpened] = useState<PageId | null>(null);
    const [lastLaunched, setLastLaunched] = useState(launched);
    if (launched !== lastLaunched) {
        // Relaunched with another page.
        setLastLaunched(launched);
        setOpened(null);
    }
    const current = launched ?? opened;
    useBack(() => {
        setOpened(null);
        return true;
    }, !launched && opened !== null);

    if (!current) return <Hub onOpen={setOpened} />;
    const Page = PAGES[current].component;
    return <Page key={current} />;
}

export function App() {
    return (
        <BackProvider>
            <Router />
        </BackProvider>
    );
}
