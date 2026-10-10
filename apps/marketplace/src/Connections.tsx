// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Connections: the accounts Phoenix can connect to (Synergy), as the
// catalog lists them (docs/SYNERGY-CONNECTORS.md, 2.3). The home groups
// them by what they bring (Contacts & Calendars, Mail, ...); a type's page
// says where its data goes, how it signs in and how new data arrives, and
// Set up opens the Accounts app's add flow at its template. One already
// added opens Accounts instead. "Find More..." in the Accounts app opens
// the types with the capabilities it asked for (ConnectionsFiltered).

import { useCallback, useEffect, useState } from "react";
import { apps, call, marketplace, type AccountType } from "@phoenix/luna";
import { Button, Group, Note, Row, Spinner } from "@phoenix/ui";
import { Icon } from "./Icon";
import { ConnectorPackage, useConnectorInstalled } from "./ConnectorPackage";
import {
    applyFilter, capabilityChips, groupAccountTypes, openAccountsLaunch, privacyLines, pushText, serverText, setUpLaunch, signInText, statusBadge,
    addedTemplates, type ConnectorFilter,
} from "./accountTypes";

/** The catalogs' account types; null while they are read. */
export function useAccountTypes(version: number) {
    const [types, setTypes] = useState<AccountType[] | null>(null);
    useEffect(() => {
        let live = true;
        marketplace.accountTypes().then((t) => { if (live) setTypes(t); }, () => { if (live) setTypes([]); });
        return () => { live = false; };
    }, [version]);
    return types;
}

/**
 * The templates added as accounts, looked at again whenever the
 * Marketplace comes back to the front (back from Accounts after Set up).
 */
export function useAddedTemplates() {
    const [added, setAdded] = useState<Set<string>>(new Set());
    const load = useCallback(() => {
        call("luna://com.palm.service.accounts/listAccounts", {})
            .then((r) => setAdded(addedTemplates((r as { results?: { templateId?: unknown }[] }).results ?? [])), () => {});
    }, []);
    useEffect(() => {
        load();
        const again = () => { if (document.visibilityState === "visible") load(); };
        document.addEventListener("visibilitychange", again);
        window.addEventListener("focus", again);
        return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); };
    }, [load]);
    return added;
}

function Badge({ t }: { t: AccountType }) {
    const b = statusBadge(t);
    return b ? <span className={`mk-badge ${t.status}`} data-testid="status-badge">{b}</span> : null;
}

export function AccountTypeRow({ t, added, onOpen }: { t: AccountType; added: boolean; onOpen: () => void }) {
    // A connector package on the device (ConnectorPackage.tsx).
    const installed = useConnectorInstalled(t);
    return (
        <Row testId={`account-${t.templateId}`} onClick={onOpen} chevron icon={<Icon src={t.icon} title={t.title} />}
             title={t.title}
             // The badge first in the subtitle: in the title a long name's ellipsis hid it on a phone.
             subtitle={<><Badge t={t} />{statusBadge(t) ? " " : ""}{t.provider && t.provider !== t.title ? t.provider : capabilityChips(t).join(" · ")}</>}
             value={added ? "Added" : installed ? "Installed" : ""} />
    );
}

const Loading = () => <Group><Row title="Loading…"><Spinner /></Row></Group>;

export function ConnectionsHome({ types, added, open }: { types: AccountType[] | null; added: Set<string>; open: (t: AccountType) => void }) {
    if (types === null) return <Loading />;
    if (types.length === 0) {
        return (
            <div className="mk-card" data-testid="connections-empty">
                <div className="mk-card-title">No connections listed yet</div>
                <p>The accounts Phoenix connects to (contacts, calendars, mail and more, kept in step with this device) come with the catalog,
                   and this one lists none yet.</p>
            </div>
        );
    }
    return (
        <div data-testid="connections">
            <p className="mk-muted mk-intro">Accounts Phoenix keeps in step with this device: your contacts, calendars, mail and more,
               where they already are.</p>
            {groupAccountTypes(types).map((g) => (
                <Group key={g.id} label={g.label}>
                    <div data-testid={`group-${g.id}`}>
                        {g.types.map((t) => <AccountTypeRow key={t.templateId} t={t} added={added.has(t.templateId)} onOpen={() => open(t)} />)}
                    </div>
                </Group>
            ))}
        </div>
    );
}

/** From the Accounts app's "Find More...": the types with its capabilities. */
export function ConnectionsFiltered({ filter, types, added, open, showAll }: {
    filter: ConnectorFilter; types: AccountType[] | null; added: Set<string>; open: (t: AccountType) => void; showAll: () => void;
}) {
    const list = types && applyFilter(types, filter);
    return (
        <div data-testid="connections-filtered">
            <div className="mk-app-title mk-filter-title" data-testid="filter-title">{filter.title}</div>
            {list === null ? <Loading />
                : (
                    <Group>
                        {list.length === 0 ? <Row title="Nothing for this yet" subtitle="The catalog lists no account of this kind." />
                            : [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || a.title.localeCompare(b.title))
                                .map((t) => <AccountTypeRow key={t.templateId} t={t} added={added.has(t.templateId)} onOpen={() => open(t)} />)}
                    </Group>
                )}
            <Button onClick={showAll} data-testid="show-all-connections">All Connections</Button>
        </div>
    );
}

/** An account type's page. */
export function AccountTypePage({ t, added }: { t: AccountType; added: boolean }) {
    const chips = capabilityChips(t);
    const signIn = signInText(t);
    const server = serverText(t);
    return (
        <div className="mk-app" data-testid="account-page">
            <div className="mk-app-head">
                <Icon src={t.icon} size={64} title={t.title} />
                <div>
                    <div className="mk-app-title" data-testid="account-title">{t.title} <Badge t={t} /></div>
                    {t.provider && <div className="mk-muted">{t.provider}</div>}
                </div>
            </div>
            {chips.length > 0 && (
                <div className="mk-chips" data-testid="capability-chips">
                    {chips.map((c) => <span key={c}>{c}</span>)}
                </div>
            )}
            {/* A connector package's: install, set up, remove (ConnectorPackage.tsx). */}
            {!t.package.builtin ? <ConnectorPackage t={t} added={added} /> : (
                <div className="mk-actions">
                    {added ? (
                        <Button variant="affirmative" data-testid="open-accounts"
                                onClick={() => { const l = openAccountsLaunch(); void apps.launch(l.id, l.params); }}>Open in Accounts</Button>
                    ) : (
                        <Button variant="affirmative" data-testid="set-up"
                                onClick={() => { const l = setUpLaunch(t); void apps.launch(l.id, l.params); }}>Set up</Button>
                    )}
                </div>
            )}
            {/* No account yet: the service's own page to get one, in the browser (docs/SYNERGY-SDK.md "Sign-up link"). */}
            {!added && t.signUp && (
                <p className="mk-signup" data-testid="sign-up-line">
                    Don't have an account?{" "}
                    <a href={t.signUp} data-testid="sign-up" onClick={(e) => { e.preventDefault(); void apps.open(t.signUp); }}>Sign up</a>
                </p>
            )}
            {t.summary && <p className="mk-desc">{t.summary}</p>}
            <div className="mk-card mk-privacy" data-testid="privacy">
                <div className="mk-card-title">Where your data goes</div>
                {privacyLines(t).map((l) => <p key={l}>{l}</p>)}
            </div>
            <Group label="Details">
                {signIn && <Row title="Sign-in" value={signIn} />}
                {server && <Row title="Server" value={server} />}
                <Row title="New data" subtitle={pushText(t)} />
                {t.protocols.length > 0 && <Row title="Protocols" value={t.protocols.join(", ")} />}
                <Row title="Provided by" value={t.package.builtin ? "Built into Phoenix" : t.package.id || "A connector package"} />
                {t.help && <Row title="Help" chevron testId="account-help" onClick={() => void apps.open(t.help)} />}
            </Group>
            {t.status !== "stable" && (
                <Note>{t.status === "beta" ? "Beta: it works, and may still change." : "Experimental: it may not work yet, and may change."}</Note>
            )}
        </div>
    );
}
