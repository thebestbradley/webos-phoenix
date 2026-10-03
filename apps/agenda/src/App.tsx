// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Agenda: an exhibition (dock mode on the Touchstone) of the calendar's
// coming days, after webOS 3.0's com.palm.app.agendaview, the "Agenda"
// exhibition listed beside Photos (ApplicationManagerService.cpp:2522-2540).
// Today's date large, then what is left of today and the next days' events
// with their calendar's colour, time and place, from the calendar the
// Calendar app keeps in db8 (com.palm.calendarevent:1, com.palm.calendar:1;
// agenda.ts). It follows changes as they are made (a db8 watch) and moves on
// as time passes, while it is the exhibition in front ("phoenixcardactivation").
// A tap on an event opens Calendar, which ends dock mode.
//
// Services: com.palm.db find {watch}; com.webos.service.systemservice
// getPreferences {timeFormat}; com.webos.applicationManager launch.

import { useEffect, useMemo, useState } from "react";
import { apps, db, system, type DbObject, type SystemPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { agenda, occurrences, startOfDay, whenLabel, type Calendar, type CalendarEvent } from "./agenda";

const DAYS = 7;
const CALENDAR_APP = "com.palm.app.calendar";

/** Now, a minute at a time, while the window is in front. */
function useNow(): number {
    const [now, setNow] = useState(() => Date.now());
    const [active, setActive] = useState(true);
    useEffect(() => {
        const onActivation = (e: Event) => setActive(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
        window.addEventListener("phoenixcardactivation", onActivation);
        return () => window.removeEventListener("phoenixcardactivation", onActivation);
    }, []);
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(t);
    }, [active]);
    return now;
}

export function App() {
    const now = useNow();
    const events = useLuna<(CalendarEvent & DbObject)[]>((cb, err) => db.watch({ from: "com.palm.calendarevent:1" }, cb, err), []);
    const calendars = useLuna<(Calendar & DbObject)[]>((cb, err) => db.watch({ from: "com.palm.calendar:1" }, cb, err), []);
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(["timeFormat"], cb, err), []).value;
    const twentyFour = prefs?.timeFormat === "HH24";
    const today = startOfDay(now);

    const days = useMemo(() => {
        const occ = occurrences(events.value ?? [], calendars.value ?? [], today, today + (DAYS + 1) * 86400000);
        return agenda(occ, now, DAYS);
    }, [events.value, calendars.value, now, today]);

    const date = new Date(now);
    const loading = events.value === undefined && events.error === undefined;
    return (
        <div className="ag-root" data-testid="agenda">
            <div className="ag-date">
                <div className="ag-weekday">{date.toLocaleDateString(undefined, { weekday: "long" })}</div>
                <div className="ag-day">{date.getDate()}</div>
                <div className="ag-month">{date.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
            </div>
            <div className="ag-list" data-testid="agenda-list">
                {events.error && <div className="ag-note">Your calendar could not be read.</div>}
                {!loading && days.map((d) => (
                    <section key={d.date} className="ag-section">
                        <h2 className="ag-section-title">{d.label}</h2>
                        {d.items.length === 0 && <div className="ag-note" data-testid="agenda-none">No more events today</div>}
                        {d.items.map((o) => (
                            <div role="button" tabIndex={0} key={o.key} className="ag-event" data-testid="agenda-event"
                                    onClick={() => { void apps.launch(CALENDAR_APP, {}).catch(() => {}); }}>
                                <span className="ag-bar" style={{ background: o.color }} />
                                <span className="ag-when">{whenLabel(o, d.date, twentyFour)}</span>
                                <span className="ag-subject">{o.subject}</span>
                                {o.location && <span className="ag-location">{o.location}</span>}
                            </div>
                        ))}
                    </section>
                ))}
            </div>
        </div>
    );
}
