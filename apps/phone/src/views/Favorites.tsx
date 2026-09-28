// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Favourites (com.palm.person:1 with favorite = true) and, below them,
// everyone else in Contacts. A tap calls the person's primary number.

import { personDisplayName, phoneTypeLabel, type Person } from "@phoenix/luna";
import { Avatar, formatNumber } from "@phoenix/ui";
import { Star } from "../icons";

function primaryNumber(p: Person) {
    const nums = p.phoneNumbers ?? [];
    return nums.find((n) => n.primary) ?? nums[0] ?? null;
}

function PersonRow({ p, onCall }: { p: Person; onCall: (n: string) => void }) {
    const n = primaryNumber(p);
    return (
        <div className={`phone-row person-row${n ? "" : " disabled"}`} role="button" tabIndex={0}
             data-testid="person-row" onClick={() => n && onCall(n.value)}
             onKeyDown={(e) => { if (e.key === "Enter" && n) onCall(n.value); }}>
            <Avatar src={p.photos?.localPathList || p.photos?.localPathSquare} size={40} />
            <div className="phone-row-body">
                <div className="phone-row-title">{personDisplayName(p)}</div>
                <div className="phone-row-sub">{n ? `${phoneTypeLabel(n.type)} ${formatNumber(n.value)}` : "No phone number"}</div>
            </div>
            {p.favorite && <span className="fav-star" aria-label="favorite"><Star /></span>}
        </div>
    );
}

export function Favorites({ people, onCall }: { people: readonly Person[]; onCall: (n: string) => void }) {
    const favs = people.filter((p) => p.favorite);
    const rest = people.filter((p) => !p.favorite);
    return (
        <div className="phone-list-view">
            <div className="phone-header">
                <div className="phone-header-title" role="heading" aria-level={1}>Favorites</div>
            </div>
            <div className="phone-scroll">
                {favs.length === 0 && <div className="phone-empty">Mark people as favorites in Contacts to call them from here.</div>}
                {favs.map((p) => <PersonRow key={p._id} p={p} onCall={onCall} />)}
                {rest.length > 0 && <div className="phone-divider"><span>All Contacts</span></div>}
                {rest.map((p) => <PersonRow key={p._id} p={p} onCall={onCall} />)}
            </div>
        </div>
    );
}
