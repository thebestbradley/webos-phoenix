// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One app, one launch point per pane (appinfo.json "phoenix.launchPoints"):
// the launcher's Settings tab shows Wi-Fi, Bluetooth, ... as separate icons
// and cards, as on webOS 2.x, and each starts this app with {page: "..."}.
// Without a page it shows the list of all panes.

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { sceneTransition } from "@phoenix/luna";
import { useDevModeShown, useLaunchParams } from "@phoenix/luna/react";
import { BackProvider, useBack } from "./nav";
import { Hub } from "./pages/Hub";
import { PAGES, type PageId } from "./pages";

function Router() {
    const params = useLaunchParams<{ page?: string }>();
    // Developer Mode stays out of sight until Just Type's Konami code
    // revealed it (pages/DevMode.tsx); asked for before, the list shows.
    const devModeShown = useDevModeShown();
    const asked = params.page && params.page in PAGES ? (params.page as PageId) : null;
    const launched = asked === "devmode" && devModeShown === false ? null : asked;
    // Pane opened from the list (only when not launched straight into one).
    const [opened, setOpened] = useState<PageId | null>(null);
    const [lastLaunched, setLastLaunched] = useState(launched);
    if (launched !== lastLaunched) {
        // Relaunched with another page.
        setLastLaunched(launched);
        setOpened(null);
    }
    const current = launched ?? (opened === "devmode" && devModeShown === false ? null : opened);
    // Opening a pane pushes a scene and the back gesture pops it, with the
    // card's zoom-fade (Mojo's pushScene / popScene; CardTransition.cpp).
    // Each scene has its own scroll position, as Mojo's scene scrollers
    // had: a pane opens at its top (it opened as far down as the list had
    // been scrolled, its header out of sight), and the list comes back
    // where it was.
    const listScroll = useRef(0);
    const open = (id: PageId | null, pop: boolean) =>
        void sceneTransition(() => {
            if (!pop) listScroll.current = window.scrollY;
            flushSync(() => setOpened(id));
            window.scrollTo(0, pop ? listScroll.current : 0);
        }, { pop });
    useBack(() => {
        open(null, true);
        return true;
    }, !launched && opened !== null);

    if (!current) return <Hub onOpen={(id) => open(id, false)} />;
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
