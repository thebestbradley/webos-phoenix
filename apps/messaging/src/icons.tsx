// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Glyphs for Messaging (Palm's were not open-sourced), and the presence dots
// of Enyo 1.0's contactsui (images/PROVENANCE.md).

import { presenceClass } from "@phoenix/luna";
import statusAvailable from "./images/status-available.png";
import statusAway from "./images/status-away.png";
import statusOffline from "./images/status-offline.png";

const PRESENCE = { available: statusAvailable, busy: statusAway, offline: statusOffline };

/** An IM buddy's presence: green available, orange busy, grey offline. */
export const Presence = ({ availability, title }: { availability: number | undefined; title?: string }) => {
    const cls = presenceClass(availability);
    return <img className={`presence-icon ${cls}`} src={PRESENCE[cls]} alt={title ?? cls} title={title} width={16} height={16} />;
};

/** A picture, to attach one (a framed landscape). */
export const AttachPicture = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M5 17l5-5 3 3 2-2 4 4" strokeLinecap="round" />
        <circle cx="16" cy="9" r="1.6" fill="currentColor" stroke="none" />
    </svg>
);

export const Compose = () => (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" fill="currentColor" fillOpacity="0.25" />
        <path d="M14.5 7.5l3 3" />
    </svg>
);

export const SendArrow = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 20.5l18-8.5L3 3.5l2.2 7.2L15 12l-9.8 1.3z" fill="currentColor" />
    </svg>
);

export const Bubbles = ({ size = 64 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" d="M30 13c-10.5 0-19 6.7-19 15 0 4.6 2.6 8.7 6.7 11.4L16 48l8.7-5.3c1.7.4 3.5.6 5.3.6 10.5 0 19-6.7 19-15.2S40.5 13 30 13z" />
        <path fill="currentColor" fillOpacity="0.6" d="M50.5 27.5c.3 1 .5 2 .5 3 0 8.6-8.2 15.7-18.7 16.8 2.6 2.1 6.3 3.4 10.2 3.4 1.2 0 2.3-.1 3.4-.4L52 53l-1.1-5.8c2.9-2.1 4.6-5 4.6-8.3 0-4.4-2-8.4-5-11.4z" />
    </svg>
);
